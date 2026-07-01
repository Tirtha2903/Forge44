'use strict';

/**
 * POST /api/compile  —  Forge44 AI Compilation Endpoint
 *
 * Converts a natural-language application description into a fully validated
 * application schema using the Forge44 AI compiler pipeline.
 *
 * Request:
 *   Method:       POST
 *   Content-Type: application/json
 *   Headers:      Authorization: Bearer <Firebase ID Token>  (optional)
 *   Body:         { prompt: string, planMode?: boolean }
 *
 * Response schema:
 *   200  { result: CompileResult }
 *   400  { error: 'BAD_REQUEST',            message: string }
 *   405  { error: 'METHOD_NOT_ALLOWED',     message: string }
 *   415  { error: 'UNSUPPORTED_MEDIA_TYPE', message: string }
 *   422  { error: 'INVALID_SCHEMA',         message: string }
 *   429  { error: 'RATE_LIMITED',           message: string, retryAfter: number }
 *   502  { error: 'PROVIDER_ERROR',         message: string }
 *   503  { error: 'SERVICE_UNAVAILABLE',    message: string }
 *   504  { error: 'TIMEOUT',                message: string }
 *   500  { error: 'INTERNAL_ERROR',         message: string }
 *
 * Rate limit response headers:
 *   X-RateLimit-Limit     — max requests per window for this tier
 *   X-RateLimit-Remaining — requests remaining in current window
 *   X-RateLimit-Reset     — seconds until window resets
 *   Retry-After           — seconds to wait (only on 429)
 */

const { randomBytes }  = require('crypto');

const { buildCompileResult }                                          = require('../lib/compiler/pipeline');
const { applyRateLimit, getClientIp }                                = require('../lib/middleware/rateLimit');
const { validateMethod, validateContentType, validateCompileBody }   = require('../lib/middleware/validate');
const { extractVerifiedUser }                                        = require('../lib/firebase-admin');
const { toHttpResponse }                                             = require('../lib/errors');
const logger                                                         = require('../lib/logger');
const config                                                         = require('../lib/config');

// ── Request ID ─────────────────────────────────────────────────────────────

/** Generate a short cryptographically-random request ID for log correlation. */
function newRequestId() {
  return randomBytes(5).toString('hex');  // 10-char hex, e.g. "a3f7b29e1c"
}

// ── CORS ───────────────────────────────────────────────────────────────────

/**
 * Set Access-Control headers on the response.
 *
 * Strategy:
 *   - If ALLOWED_ORIGINS is ['*'], permit any origin (safe for local dev and
 *     same-domain Vercel deployments where API and frontend share a domain).
 *   - Otherwise, echo the request origin only if it appears in the whitelist.
 *     Unrecognized origins get no Access-Control-Allow-Origin header, causing
 *     the browser to block the request.
 *
 * Authorization is explicitly allowed so the frontend can send Firebase tokens.
 * Access-Control-Max-Age caches the preflight response for 24 hours.
 */
function setCors(req, res) {
  const origin  = req.headers['origin'];
  const allowed = config.cors.allowedOrigins;

  if (allowed.length === 1 && allowed[0] === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    // Vary: Origin tells caches that the response differs by request origin
    res.setHeader('Vary', 'Origin');
  }
  // If origin is not in the whitelist: no ACAO header → browser blocks the request.

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── Security headers ───────────────────────────────────────────────────────

/**
 * Defensive HTTP security headers for every API response.
 *
 * Note: HSTS and CSP are applied globally in vercel.json for HTML pages.
 * These cover the API route specifically:
 *
 *   X-Content-Type-Options: nosniff
 *     Prevents MIME-type sniffing attacks where browsers misinterpret the
 *     response content type. Even though this is JSON, it's defensive hygiene.
 *
 *   X-Frame-Options: DENY
 *     Prevents the API response from being embedded in an iframe or frame.
 *     Belt-and-suspenders alongside CSP's frame-ancestors.
 *
 *   Referrer-Policy: strict-origin-when-cross-origin
 *     Limits what URL is sent in the Referer header on outbound requests,
 *     preventing leakage of the full URL (which may contain query params).
 *
 *   Cache-Control: no-store
 *     API responses must NEVER be cached. Compiled schemas are user-specific
 *     and time-sensitive. A cached response could serve stale data.
 */
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',         'DENY');
  res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control',           'no-store, no-cache, must-revalidate');
}

// ── Response helper ────────────────────────────────────────────────────────

/**
 * Write a JSON response. Guards against calling res.json() twice if a previous
 * middleware has already sent headers (defensive — should not occur in normal flow).
 */
function sendJson(res, statusCode, body) {
  if (res.headersSent) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(statusCode).json(body);
}

// ── Handler ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  const requestId = newRequestId();
  const startMs   = Date.now();

  // ── Always set CORS + security headers first ──────────────────────────
  // These must be set before ANY early return so every response (including
  // errors and preflight) carries them.
  setCors(req, res);
  setSecurityHeaders(res);

  // ── CORS preflight ─────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    // ── Phase 1: Method & Content-Type validation ────────────────────────
    validateMethod(req);
    validateContentType(req);

    // ── Phase 2: Firebase Auth token verification (non-blocking) ────────
    // extractVerifiedUser never throws — returns null on any failure.
    // This makes auth completely optional: anonymous users still compile,
    // they just receive lower rate limits.
    const verifiedUser = await extractVerifiedUser(req);

    // ── Phase 3: Rate limiting ───────────────────────────────────────────
    const ip     = getClientIp(req);
    const rlMeta = applyRateLimit(ip, verifiedUser?.uid ?? null);

    // Publish rate limit state to the client (useful for frontend feedback)
    res.setHeader('X-RateLimit-Limit',     rlMeta.limitMax);
    res.setHeader('X-RateLimit-Remaining', rlMeta.remaining);
    res.setHeader('X-RateLimit-Reset',     rlMeta.resetSeconds);

    // ── Phase 4: Body validation ─────────────────────────────────────────
    const validated = validateCompileBody(req.body);

    // ── Log the accepted request ─────────────────────────────────────────
    logger.info('compile.start', {
      requestId,
      promptLength:    validated.prompt.length,
      planMode:        validated.planMode,
      isAuthenticated: !!verifiedUser,
      // Log a truncated UID suffix (not the full UID) for debugging without
      // exposing the entire identifier in logs.
      userSuffix: verifiedUser?.uid
        ? `…${verifiedUser.uid.slice(-6)}`
        : null,
    });

    // ── Phase 5: Compile pipeline ─────────────────────────────────────────
    const result     = await buildCompileResult(validated.prompt, {
      planMode: validated.planMode,
    });
    const durationMs = Date.now() - startMs;

    logger.info('compile.success', {
      requestId,
      durationMs,
      pages:        result.config?.ui?.pages?.length       ?? 0,
      endpoints:    result.config?.api?.endpoints?.length  ?? 0,
      qualityScore: result.validation?.qualityScore        ?? 0,
      repairLoops:  result.repair?.loops                   ?? 0,
    });

    return sendJson(res, 200, { result });

  } catch (err) {
    const durationMs             = Date.now() - startMs;
    const { statusCode, body }   = toHttpResponse(err);

    // Set Retry-After header on 429 responses (RFC 6585)
    if (statusCode === 429 && typeof body.retryAfter === 'number') {
      res.setHeader('Retry-After', String(body.retryAfter));
    }

    if (statusCode >= 500) {
      // Server-side errors: log the Forge44 error code, and — if this was a
      // provider error — the full diagnostic bag captured in lib/compiler/llm.js.
      // _diag is a server-only field; toHttpResponse() ignores it and the
      // client never sees it. See the PROVIDER_ERROR block in llm.js for the
      // full Gemini SDK error shape that populates these fields.
      logger.error('compile.serverError', {
        requestId,
        durationMs,
        statusCode,
        errorCode: err.code ?? 'UNKNOWN',
        // err.name is safe (e.g. 'Forge44Error', 'Error') — no internals
        errorName: err.name ?? 'Error',
        // Spread provider diagnostics when present (PROVIDER_ERROR path only).
        // Fields: providerStatus, providerStatusText, providerMessage,
        //         providerDetails, providerStack (and providerFeedback on safety blocks).
        ...(err._diag != null ? { provider: err._diag } : {}),
      });
    } else {
      // Client-side rejections (4xx): log with warn severity
      logger.warn('compile.rejected', {
        requestId,
        durationMs,
        statusCode,
        errorCode: err.code ?? 'UNKNOWN',
      });
    }

    return sendJson(res, statusCode, body);
  }
};
