'use strict';

/**
 * Forge44 — Request Validation Middleware
 *
 * Validates every aspect of an incoming API request before it reaches
 * business logic. All validation errors are Forge44Errors with correct
 * HTTP status codes and user-facing messages.
 *
 * Security decisions:
 *   - Unknown/extra body properties are REJECTED (not silently ignored).
 *     This prevents future injection surfaces if new LLM-related properties
 *     are added with semantic meaning.
 *   - Injection patterns are checked on the TRIMMED prompt, after length
 *     checks, to prevent circumvention via leading/trailing whitespace.
 *   - planMode is type-checked as boolean (not cast). Sending planMode as
 *     a string would be rejected to prevent type-coercion surprises.
 */

const config     = require('../config');
const { Errors } = require('../errors');

// ── Prompt injection pattern list ──────────────────────────────────────────
// Detects attempts to break out of the system prompt or override instructions.
// Each pattern is tested against the full trimmed prompt.
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /forget\s+(?:your\s+)?(?:instructions|rules|guidelines|context|system\s+prompt)/i,
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<\|(?:im_start|im_end|system|user|assistant)\|>/i,
  /act\s+as\s+(?:a|an|the)\s+(?!app|product|service|platform|system)/i,
  /pretend\s+(?:you\s+are|to\s+be)\s+/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /developer\s+mode\s+enabled/i,
  /prompt\s+injection/i,
];

function hasInjection(text) {
  return INJECTION_PATTERNS.some(p => p.test(text));
}

// ── Allowed body properties ────────────────────────────────────────────────
const ALLOWED_BODY_KEYS = new Set(['prompt', 'planMode']);

// ── Validators ─────────────────────────────────────────────────────────────

/**
 * Enforce HTTP method = POST.
 * @throws {Forge44Error} 405 METHOD_NOT_ALLOWED
 */
function validateMethod(req) {
  if (req.method !== 'POST') {
    throw Errors.methodNotAllowed(req.method);
  }
}

/**
 * Enforce Content-Type: application/json.
 * Accepts 'application/json', 'application/json; charset=utf-8', etc.
 * @throws {Forge44Error} 415 UNSUPPORTED_MEDIA_TYPE
 */
function validateContentType(req) {
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (!ct.includes('application/json')) {
    throw Errors.unsupportedMediaType();
  }
}

/**
 * Validate the compile request body.
 *
 * Checks:
 *   1. Body is a non-null, non-array object
 *   2. No unknown properties (allowlist enforced)
 *   3. `prompt` is present, is a string, within length bounds, no injection
 *   4. `planMode` is boolean if present
 *
 * @param   {unknown} body    Parsed request body (from req.body)
 * @returns {{ prompt: string, planMode: boolean }}
 * @throws  {Forge44Error}    400 BAD_REQUEST on any violation
 */
function validateCompileBody(body) {
  // ── Type check ──────────────────────────────────────────────────────────
  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
    throw Errors.badRequest(
      'Request body must be a JSON object with a "prompt" string field.'
    );
  }

  // ── Allowlist check ────────────────────────────────────────────────────
  const extraKeys = Object.keys(body).filter(k => !ALLOWED_BODY_KEYS.has(k));
  if (extraKeys.length > 0) {
    throw Errors.badRequest(
      `Unexpected field(s) in request body: ${extraKeys.map(k => `"${k}"`).join(', ')}. ` +
      'Only "prompt" and "planMode" are accepted.'
    );
  }

  const { prompt, planMode } = body;

  // ── Prompt: required, must be a string ────────────────────────────────
  if (prompt === undefined || prompt === null) {
    throw Errors.badRequest('Missing required field: "prompt".');
  }
  if (typeof prompt !== 'string') {
    throw Errors.badRequest('Field "prompt" must be a string.');
  }

  const trimmed = prompt.trim();

  // ── Length checks ──────────────────────────────────────────────────────
  if (trimmed.length < config.compile.minPromptLength) {
    throw Errors.badRequest(
      `Prompt is too short — minimum ${config.compile.minPromptLength} character(s) required.`
    );
  }
  if (trimmed.length > config.compile.maxPromptLength) {
    throw Errors.badRequest(
      `Prompt is too long — maximum ${config.compile.maxPromptLength} characters allowed ` +
      `(received ${trimmed.length}).`
    );
  }

  // ── Injection guard ────────────────────────────────────────────────────
  if (hasInjection(trimmed)) {
    throw Errors.badRequest(
      'Prompt contains disallowed content. Please describe a real application you want to build.'
    );
  }

  // ── planMode: optional, strictly boolean ──────────────────────────────
  if (planMode !== undefined && typeof planMode !== 'boolean') {
    throw Errors.badRequest(
      'Field "planMode" must be a boolean (true or false), if provided.'
    );
  }

  return {
    prompt:   trimmed,
    planMode: planMode === true,
  };
}

module.exports = { validateMethod, validateContentType, validateCompileBody };
