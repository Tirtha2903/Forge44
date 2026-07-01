'use strict';

/**
 * Forge44 — Centralized Error Types
 *
 * Design principles:
 *
 *  1. Forge44Error is the only Error subclass in the backend.
 *     Every intentional error thrown by Forge44 code is a Forge44Error.
 *
 *  2. Errors produced by third-party libraries (Google AI, Firebase) are
 *     caught, sanitized, and re-thrown as Forge44Errors with codes that
 *     map to correct HTTP status codes.
 *
 *  3. toHttpResponse() is the SINGLE place that converts any error into
 *     an HTTP response body. It must NEVER expose:
 *       - Stack traces
 *       - Internal file paths
 *       - Provider error messages
 *       - Library internals
 *       - Environment details
 *
 *  4. Factory functions in Errors{} produce pre-typed instances.
 *     Use them instead of constructing Forge44Error directly.
 */

class Forge44Error extends Error {
  /**
   * @param {string} message     Safe, user-facing message
   * @param {string} code        Machine-readable code (SCREAMING_SNAKE_CASE)
   * @param {number} statusCode  HTTP status code
   * @param {object} [meta]      Internal metadata (never surfaced to clients)
   */
  constructor(message, code, statusCode, meta = {}) {
    super(message);
    this.name       = 'Forge44Error';
    this.code       = code;
    this.statusCode = statusCode;
    this.meta       = meta;
    // Suppress stack traces in non-development environments.
    // This prevents accidentally logging a trace that contains file paths.
    if (process.env.NODE_ENV !== 'development') {
      this.stack = `${this.name}: ${this.message}`;
    }
  }
}

/** Factory functions — always prefer these over `new Forge44Error(...)`. */
const Errors = {
  /** 400 — Malformed request (wrong type, missing field, constraint violation) */
  badRequest: (msg) =>
    new Forge44Error(msg, 'BAD_REQUEST', 400),

  /** 401 — Authentication required */
  unauthorized: (msg) =>
    new Forge44Error(msg ?? 'Authentication required.', 'UNAUTHORIZED', 401),

  /** 403 — Authenticated but not authorised */
  forbidden: (msg) =>
    new Forge44Error(msg ?? 'Access denied.', 'FORBIDDEN', 403),

  /** 405 — Wrong HTTP method */
  methodNotAllowed: (method) =>
    new Forge44Error(
      `Method ${method} is not allowed. Use POST.`,
      'METHOD_NOT_ALLOWED', 405
    ),

  /** 413 — Request body exceeds size limit */
  payloadTooLarge: (maxBytes) =>
    new Forge44Error(
      `Request body exceeds the ${maxBytes}-byte limit.`,
      'PAYLOAD_TOO_LARGE', 413
    ),

  /** 415 — Wrong Content-Type */
  unsupportedMediaType: () =>
    new Forge44Error(
      'Content-Type must be application/json.',
      'UNSUPPORTED_MEDIA_TYPE', 415
    ),

  /** 422 — LLM returned a schema that failed validation */
  invalidSchema: (msg) =>
    new Forge44Error(
      msg ?? 'AI returned an invalid response. Please try rephrasing your prompt.',
      'INVALID_SCHEMA', 422
    ),

  /** 429 — Rate limit exceeded */
  rateLimited: (retryAfterSecs, msg) =>
    new Forge44Error(
      msg ?? 'Rate limit exceeded. Please wait before trying again.',
      'RATE_LIMITED', 429,
      { retryAfter: retryAfterSecs }
    ),

  /** 500 — Unexpected internal error */
  internal: (msg) =>
    new Forge44Error(msg ?? 'An unexpected error occurred.', 'INTERNAL_ERROR', 500),

  /** 502 — LLM provider returned an error */
  providerError: (msg) =>
    new Forge44Error(
      msg ?? 'AI service temporarily unavailable. Please try again.',
      'PROVIDER_ERROR', 502
    ),

  /** 503 — Service not configured (e.g., missing API key) */
  serviceUnavailable: (msg) =>
    new Forge44Error(
      msg ?? 'The compiler service is not configured. Contact support.',
      'SERVICE_UNAVAILABLE', 503
    ),

  /** 504 — Request or pipeline timed out */
  timeout: (msg) =>
    new Forge44Error(
      msg ?? 'Request timed out. Try a shorter or simpler prompt.',
      'TIMEOUT', 504
    ),
};

/**
 * Convert any error — Forge44Error or pipeline-code error — into a safe
 * { statusCode, body } pair suitable for writing directly to the HTTP response.
 *
 * SECURITY CONTRACT:
 *   This function is the boundary between internal errors and the client.
 *   It MUST NOT include stack traces, file paths, library names, provider
 *   error messages, raw error.message values from third-party packages,
 *   or any internal implementation detail in the returned body.
 *
 * @param  {Error} err
 * @returns {{ statusCode: number, body: object }}
 */
function toHttpResponse(err) {
  // Structured Forge44Error — message is pre-vetted as safe to surface
  if (err instanceof Forge44Error) {
    const body = { error: err.code, message: err.message };
    if (err.meta?.retryAfter !== undefined) {
      body.retryAfter = err.meta.retryAfter;
    }
    return { statusCode: err.statusCode, body };
  }

  // Map pipeline error codes (from lib/compiler/*) to safe HTTP responses.
  // These codes come from our own code, so we trust them; but we still use
  // canned messages to avoid leaking any provider-specific text.
  switch (err.code) {
    case 'NO_API_KEY':
      return {
        statusCode: 503,
        body: {
          error:   'SERVICE_UNAVAILABLE',
          message: 'The compiler service is not configured. Contact the site administrator.',
        },
      };
    case 'RATE_LIMITED':
      return {
        statusCode: 429,
        body: {
          error:      'RATE_LIMITED',
          message:    'AI service rate limit reached. Please wait a moment and try again.',
          retryAfter: typeof err.retryAfter === 'number' ? err.retryAfter : 60,
        },
      };
    case 'PROVIDER_ERROR':
      return {
        statusCode: 502,
        body: {
          error:   'PROVIDER_ERROR',
          message: 'AI service temporarily unavailable. Please try again.',
        },
      };
    case 'INVALID_SCHEMA':
      return {
        statusCode: 422,
        body: {
          error:   'INVALID_SCHEMA',
          message: 'AI returned an invalid response. Try rephrasing your prompt.',
        },
      };
    case 'TIMEOUT':
      return {
        statusCode: 504,
        body: {
          error:   'TIMEOUT',
          message: 'Compilation timed out. Try a shorter or simpler prompt.',
        },
      };
    default:
      // Unknown error — return the safest possible message.
      // The actual error details are logged by the handler (with requestId for correlation).
      return {
        statusCode: 500,
        body: {
          error:   'INTERNAL_ERROR',
          message: 'An unexpected error occurred. Please try again.',
        },
      };
  }
}

module.exports = { Forge44Error, Errors, toHttpResponse };
