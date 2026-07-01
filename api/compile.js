'use strict';

/**
 * POST /api/compile
 *
 * Accepts a natural-language application description and returns a fully
 * compiled, validated application schema produced by the Forge44 AI pipeline.
 *
 * Request body   { prompt: string, planMode?: boolean }
 * Response 200   { result: CompileResult }
 * Response 400   { error: string, message: string }     — bad input
 * Response 429   { error: string, message: string, retryAfter: number }
 * Response 5xx   { error: string, message: string }     — server / LLM error
 */

const { buildCompileResult } = require('../lib/compiler/pipeline');

// ── Constants ──────────────────────────────────────────────────────────────
const MIN_PROMPT_LENGTH = 5;
const MAX_PROMPT_LENGTH = 2000;

// ── Prompt injection patterns ──────────────────────────────────────────────
// Detect attempts to hijack the system prompt.
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /forget\s+(?:your\s+)?(?:instructions|rules|guidelines|context)/i,
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<\|(?:im_start|im_end|system|user|assistant)\|>/i,
  /act\s+as\s+(?:a|an|the)\s+(?!app|product|service|platform)/i,
  /pretend\s+(?:you\s+are|to\s+be)\s+/i,
];

function detectInjection(text) {
  return INJECTION_PATTERNS.some(p => p.test(text));
}

// ── In-memory rate limiter ─────────────────────────────────────────────────
// Sliding window per IP address.
// Note: not persistent across serverless instances (by design for v1).
// Upgrade path: Vercel KV or Upstash Redis for distributed rate limiting.
const RATE_LIMIT_MAX    = parseInt(process.env.RATE_LIMIT_MAX    ?? '5',     10);
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW ?? '60000', 10); // ms

const rateLimitStore = new Map(); // ip → number[]  (timestamps)

function isRateLimited(ip) {
  const now      = Date.now();
  const cutoff   = now - RATE_LIMIT_WINDOW;
  const existing = (rateLimitStore.get(ip) ?? []).filter(t => t > cutoff);
  existing.push(now);
  rateLimitStore.set(ip, existing);
  return existing.length > RATE_LIMIT_MAX;
}

// Periodic cleanup to prevent unbounded memory growth.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW;
  for (const [ip, timestamps] of rateLimitStore.entries()) {
    const filtered = timestamps.filter(t => t > cutoff);
    if (filtered.length === 0) {
      rateLimitStore.delete(ip);
    } else {
      rateLimitStore.set(ip, filtered);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// ── Helpers ────────────────────────────────────────────────────────────────
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getClientIp(req) {
  // Vercel sets x-forwarded-for; fall back for local dev
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ??
    req.headers['x-real-ip']                             ??
    req.socket?.remoteAddress                            ??
    'unknown'
  );
}

// ── Handler ────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Method enforcement
  if (req.method !== 'POST') {
    return res.status(405).json({
      error:   'Method Not Allowed',
      message: 'Only POST requests are accepted at /api/compile.',
    });
  }

  // Rate limiting
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      error:      'Too Many Requests',
      message:    `Rate limit exceeded: max ${RATE_LIMIT_MAX} compilations per minute per IP.`,
      retryAfter: Math.ceil(RATE_LIMIT_WINDOW / 1000),
    });
  }

  // Body validation
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({
      error:   'Bad Request',
      message: 'Request body must be a JSON object containing a "prompt" field.',
    });
  }

  const { prompt, planMode = false } = body;

  if (prompt === undefined || prompt === null) {
    return res.status(400).json({
      error:   'Bad Request',
      message: 'Missing required field: prompt.',
    });
  }
  if (typeof prompt !== 'string') {
    return res.status(400).json({
      error:   'Bad Request',
      message: 'Field "prompt" must be a string.',
    });
  }

  const sanitizedPrompt = prompt.trim();

  if (sanitizedPrompt.length < MIN_PROMPT_LENGTH) {
    return res.status(400).json({
      error:   'Bad Request',
      message: `Prompt is too short. Describe your application in at least ${MIN_PROMPT_LENGTH} characters.`,
    });
  }
  if (sanitizedPrompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      error:   'Bad Request',
      message: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer. Yours is ${sanitizedPrompt.length}.`,
    });
  }

  // Prompt injection guard
  if (detectInjection(sanitizedPrompt)) {
    return res.status(400).json({
      error:   'Bad Request',
      message: 'Prompt contains disallowed content. Please describe a real application.',
    });
  }

  // Compile
  try {
    const result = await buildCompileResult(sanitizedPrompt, {
      planMode: Boolean(planMode),
    });
    return res.status(200).json({ result });

  } catch (err) {
    switch (err.code) {

      case 'TIMEOUT':
        return res.status(504).json({
          error:   'Gateway Timeout',
          message: 'Compilation timed out. Please try a simpler or shorter prompt.',
        });

      case 'INVALID_SCHEMA':
        console.error('[/api/compile] Invalid LLM schema:', err.message, err.field ?? '');
        return res.status(422).json({
          error:   'Unprocessable Entity',
          message: 'The AI returned an invalid response. Please try rephrasing your prompt.',
        });

      case 'RATE_LIMITED':
        return res.status(429).json({
          error:      'Too Many Requests',
          message:    'The AI service rate limit was reached. Please wait a moment and try again.',
          retryAfter: err.retryAfter ?? 60,
        });

      case 'NO_API_KEY':
        console.error('[/api/compile] GEMINI_API_KEY is not configured in environment.');
        return res.status(503).json({
          error:   'Service Unavailable',
          message: 'The compiler service is not configured. Contact the administrator.',
        });

      case 'PROVIDER_ERROR':
        console.error('[/api/compile] LLM provider error:', err.message);
        return res.status(502).json({
          error:   'Bad Gateway',
          message: 'The AI service is temporarily unavailable. Please try again in a moment.',
        });

      default:
        console.error('[/api/compile] Unexpected error:', err.message, '\n', err.stack);
        return res.status(500).json({
          error:   'Internal Server Error',
          message: 'Compilation failed unexpectedly. Please try again.',
        });
    }
  }
};
