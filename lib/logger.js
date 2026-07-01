'use strict';

/**
 * Forge44 — Structured Logger
 *
 * Emits newline-delimited JSON (NDJSON) to stdout/stderr.
 * Vercel Logs, Datadog, and most modern log aggregators parse NDJSON natively.
 *
 * Security guarantees:
 *   - sanitize() replaces all known sensitive keys with [REDACTED]
 *   - User prompts are replaced with [PROMPT:Nchars] by default
 *   - Long strings are truncated to prevent log bloat and accidental data leaks
 *   - Circular references are handled gracefully (no uncaught TypeErrors)
 *
 * To add a new sensitive key: add it to SENSITIVE_KEYS below.
 */

const config = require('./config');

// ── Log level priority ──────────────────────────────────────────────────────
const PRIORITY = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_PRIORITY = PRIORITY[config.logging.level] ?? PRIORITY.info;

// ── Keys that must never appear in logs ────────────────────────────────────
const SENSITIVE_KEYS = new Set([
  // API keys / credentials
  'apiKey', 'api_key', 'GEMINI_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT_BASE64',
  'privateKey', 'private_key', 'clientSecret', 'client_secret',
  'secret', 'password', 'passwd',
  // Auth tokens
  'token', 'idToken', 'accessToken', 'refreshToken',
  'authorization', 'Authorization',
  'x-api-key', 'x_api_key', 'cookie', 'Cookie',
  // Stripe / payments (future)
  'stripeKey', 'stripe_key', 'webhookSecret', 'webhook_secret',
]);

// ── Keys whose values are prompt text (redacted by default) ────────────────
const PROMPT_KEYS = new Set(['prompt', 'userPrompt', 'raw', 'fullPrompt', 'systemPrompt']);

const REDACTED      = '[REDACTED]';
const MAX_STR_LEN   = 300;
const MAX_ARR_ITEMS = 20;
const MAX_DEPTH     = 6;

/**
 * Recursively sanitize a value before it enters a log entry.
 * Handles: primitives, strings (truncated), arrays (capped), plain objects.
 */
function sanitize(value, depth = 0) {
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STR_LEN
      ? `${value.slice(0, MAX_STR_LEN)}…[+${value.length - MAX_STR_LEN}chars]`
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARR_ITEMS).map(v => sanitize(v, depth + 1));
    if (value.length > MAX_ARR_ITEMS) items.push(`…[+${value.length - MAX_ARR_ITEMS} more]`);
    return items;
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = REDACTED;
      } else if (PROMPT_KEYS.has(k) && config.logging.redactPrompts) {
        out[k] = typeof v === 'string'
          ? `[PROMPT:${v.length}chars]`
          : REDACTED;
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }

  // Function, Symbol, etc. — omit silently
  return undefined;
}

// ── Internal write ─────────────────────────────────────────────────────────

function write(level, message, meta) {
  if (PRIORITY[level] < MIN_PRIORITY) return;

  const entry = {
    ts:      new Date().toISOString(),
    level,
    service: 'forge44-api',
    message,
    ...(meta !== undefined && meta !== null ? sanitize(meta) : {}),
  };

  let line;
  try {
    line = JSON.stringify(entry) + '\n';
  } catch {
    // Fallback if sanitize missed a circular reference
    line = JSON.stringify({ ts: entry.ts, level, service: 'forge44-api', message, error: '[log-serialization-failed]' }) + '\n';
  }

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info:  (msg, meta) => write('info',  msg, meta),
  warn:  (msg, meta) => write('warn',  msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};

module.exports = logger;
