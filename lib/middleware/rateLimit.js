'use strict';

/**
 * Forge44 — Production Rate Limiter
 *
 * Algorithm: Sliding window, in-process store.
 *
 * ─── Architecture note for Vercel Serverless ───────────────────────────────
 * Vercel can spin up multiple concurrent function instances. This store is
 * in-process, so its state is not shared between instances.
 *
 * Impact: A user who hits N different instances can exceed the per-instance
 * limit by a factor of N. For an early public beta this is acceptable:
 *   • Each instance still enforces its limit independently.
 *   • Traffic concentration (Vercel routes to warm instances first) means
 *     most requests hit the same instance during normal load.
 *   • Abuse at scale requires orchestrating hundreds of parallel requests.
 *
 * Upgrade path for strict distributed rate limiting:
 *   Replace check() with Upstash Redis (@upstash/ratelimit — free tier):
 *   https://github.com/upstash/ratelimit
 *   Required env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Bug fixed from Stage 1:
 *   The previous implementation added the request timestamp BEFORE checking
 *   the limit. This caused blocked requests to inflate the counter, meaning
 *   legitimate future requests were charged for denied ones. Fixed below by
 *   only recording the timestamp when the request is ALLOWED.
 */

const config  = require('../config');
const { Errors } = require('../errors');
const logger  = require('../logger');

// ── Store ──────────────────────────────────────────────────────────────────
// key (string) → number[] (request timestamps in ms, within the current window)
const store = new Map();

// ── Cleanup interval ────────────────────────────────────────────────────────
// Removes entries with no recent activity to prevent unbounded memory growth.
// unref() lets the process exit cleanly even if the interval is still pending.
const _cleanup = setInterval(() => {
  const cutoff  = Date.now() - config.rateLimit.windowMs;
  let   evicted = 0;
  for (const [key, timestamps] of store.entries()) {
    const fresh = timestamps.filter(t => t > cutoff);
    if (fresh.length === 0) {
      store.delete(key);
      evicted++;
    } else {
      store.set(key, fresh);
    }
  }
  if (evicted > 0) {
    logger.debug('rateLimit.sweep', { evicted, remaining: store.size });
  }
}, config.rateLimit.cleanupIntervalMs);

if (_cleanup.unref) _cleanup.unref();

// ── Core sliding-window check ──────────────────────────────────────────────

/**
 * Atomically check (and record if allowed) a request against the rate limit.
 *
 * Note on "atomicity": JavaScript is single-threaded. Between store.get() and
 * store.set() no other code can run, making this naturally race-free.
 *
 * @param   {string} key      Rate-limit key — e.g. 'ip:1.2.3.4' or 'user:uid123'
 * @param   {number} maxReqs  Max requests permitted per windowMs
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function check(key, maxReqs) {
  const now    = Date.now();
  const cutoff = now - config.rateLimit.windowMs;

  // Active requests within the current window
  const active = (store.get(key) ?? []).filter(t => t > cutoff);

  if (active.length >= maxReqs) {
    // ── DENIED ───────────────────────────────────────────────────────────────
    // Do NOT push the timestamp. The counter must only reflect allowed requests.
    // Calculate reset time from when the oldest active request expires.
    const oldest  = active[0] ?? now;
    const resetMs = Math.max(0, (oldest + config.rateLimit.windowMs) - now);
    return { allowed: false, remaining: 0, resetMs };
  }

  // ── ALLOWED ───────────────────────────────────────────────────────────────
  active.push(now);
  store.set(key, active);
  return {
    allowed:   true,
    remaining: maxReqs - active.length,
    resetMs:   config.rateLimit.windowMs,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Apply rate limiting to the current request.
 *
 * Rate limit keys:
 *   • Authenticated users → keyed by Firebase UID (higher limit, more accurate)
 *   • Anonymous requests  → keyed by client IP  (lower limit)
 *
 * @param  {string}      ip      Client IP address (always provided)
 * @param  {string|null} userId  Firebase UID if the request is authenticated
 * @throws {Forge44Error}        429 RATE_LIMITED when limit is exceeded
 * @returns {{ remaining: number, resetSeconds: number, limitMax: number }}
 */
function applyRateLimit(ip, userId) {
  const isAuth  = typeof userId === 'string' && userId.length > 0;
  const maxReqs = isAuth ? config.rateLimit.authenticatedMax : config.rateLimit.anonymousMax;
  const key     = isAuth ? `user:${userId}` : `ip:${ip}`;

  const result = check(key, maxReqs);

  if (!result.allowed) {
    const retryAfterSecs = Math.ceil(result.resetMs / 1000);

    logger.warn('rateLimit.exceeded', {
      // Log the key type but NOT the full value (IP or UID is PII)
      keyType:  isAuth ? 'user' : 'ip',
      maxReqs,
      retryAfterSecs,
    });

    throw Errors.rateLimited(
      retryAfterSecs,
      isAuth
        ? `Rate limit exceeded. Authenticated users may make ${maxReqs} compilations per minute.`
        : `Rate limit exceeded. Anonymous users may make ${maxReqs} compilations per minute. Sign in for a higher limit.`
    );
  }

  return {
    remaining:    result.remaining,
    resetSeconds: Math.ceil(result.resetMs / 1000),
    limitMax:     maxReqs,
  };
}

/**
 * Extract the real client IP from a Vercel/Node.js HTTP request.
 *
 * Vercel injects x-forwarded-for on every request. The FIRST entry in
 * x-forwarded-for is the original client IP (Vercel's infrastructure
 * appends additional entries, so we only take [0]).
 *
 * We deliberately do NOT trust x-real-ip as a fallback after x-forwarded-for,
 * because x-real-ip can be spoofed by clients before Vercel's edge layer.
 */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();

  // Local development fallback
  const socket = req.socket?.remoteAddress ?? req.connection?.remoteAddress;
  return socket ?? 'unknown';
}

module.exports = { applyRateLimit, getClientIp };
