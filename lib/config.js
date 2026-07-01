'use strict';

/**
 * Forge44 — Central Configuration Module
 *
 * All runtime constants live here. Nothing else should hardcode limits,
 * timeouts, or provider settings — they must reference this module.
 *
 * Architecture decision:
 *   We do NOT throw at module-load time for missing required vars.
 *   Each consuming module validates its own requirements lazily (on first use).
 *   This gives clean, structured HTTP error responses rather than a
 *   module-load crash that would cause an unhandled 500 without a body.
 *
 * Local dev:  copy .env.example → .env and fill in values, then run npx vercel dev
 * Production: Vercel Dashboard → Project Settings → Environment Variables
 */

/** Read an integer env var with a fallback. Returns fallback on NaN. */
function int(name, fallback) {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

/** Read a float env var with a fallback. Returns fallback on NaN. */
function float(name, fallback) {
  const v = parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Read a boolean env var.
 * Truthy string values: '1', 'true', 'yes', 'on'
 * Everything else (including absence) returns the fallback.
 */
function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

// ── Exported configuration object ──────────────────────────────────────────

const config = {

  // ── Compile pipeline ──────────────────────────────────────────────────────
  compile: {
    /** Minimum characters in a prompt */
    minPromptLength:  int('MIN_PROMPT_LENGTH', 5),
    /** Maximum characters in a prompt */
    maxPromptLength:  int('MAX_PROMPT_LENGTH', 2000),
    /** Maximum raw HTTP request body size in bytes (10 KB default) */
    maxBodyBytes:     int('MAX_BODY_BYTES', 10 * 1024),
    /** Total pipeline timeout — after this the whole compile is aborted */
    pipelineTimeout:  int('PIPELINE_TIMEOUT_MS', 25_000),
    /** Individual LLM network-call timeout — shorter to allow retry headroom */
    llmCallTimeout:   int('LLM_CALL_TIMEOUT_MS', 20_000),
  },

  // ── Rate limiting ─────────────────────────────────────────────────────────
  rateLimit: {
    /** Max compiles per window for unauthenticated (IP-keyed) requests */
    anonymousMax:      int('RATE_LIMIT_ANON_MAX', 5),
    /** Max compiles per window for authenticated (user-keyed) requests */
    authenticatedMax:  int('RATE_LIMIT_AUTH_MAX', 20),
    /** Sliding-window duration in milliseconds */
    windowMs:          int('RATE_LIMIT_WINDOW_MS', 60_000),
    /** How often the in-memory store is swept for expired entries */
    cleanupIntervalMs: int('RATE_CLEANUP_INTERVAL_MS', 300_000),
  },

  // ── LLM provider ──────────────────────────────────────────────────────────
  llm: {
    model:           (process.env.GEMINI_MODEL ?? 'gemini-2.0-flash').trim(),
    temperature:     float('GEMINI_TEMPERATURE', 0.35),
    maxOutputTokens: int('GEMINI_MAX_TOKENS', 8192),
  },

  // ── CORS ──────────────────────────────────────────────────────────────────
  cors: {
    /**
     * Comma-separated list of allowed origins.
     * '*' = allow all (development default).
     * For production set: ALLOWED_ORIGINS=https://forge44.app,https://www.forge44.app
     */
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '*')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  },

  // ── Logging ───────────────────────────────────────────────────────────────
  logging: {
    /** 'debug' | 'info' | 'warn' | 'error' */
    level: process.env.LOG_LEVEL ?? 'info',
    /**
     * When true (the default), user prompts in log metadata are replaced
     * with a token like [PROMPT:42chars]. Set to 'false' ONLY in a local
     * dev environment where you need to see exact prompts.
     * NEVER disable in production.
     */
    redactPrompts: bool('LOG_REDACT_PROMPTS', true),
  },
};

module.exports = config;
