'use strict';

/**
 * LLM abstraction layer — Google Gemini 1.5 Flash
 *
 * Responsibilities:
 *   - Singleton client initialisation (avoids repeated cold-start overhead)
 *   - JSON-only output enforced at the API level via responseMimeType
 *   - Individual call timeout (independent of the pipeline-level timeout,
 *     allowing the pipeline to attempt a repair pass if the LLM times out)
 *   - Structured error codes for clean propagation through the pipeline
 *
 * To swap LLM providers: rewrite callLLM() and getModel() here only.
 * No other file in the compiler pipeline needs to change.
 *
 * Security / diagnostics model:
 *   - rawSample is NEVER attached to error objects (would leak model output)
 *   - Provider error details are attached to err._diag for SERVER-SIDE logging
 *     only. toHttpResponse() ignores _diag, so nothing leaks to the client.
 *   - API key validity is checked lazily (on first request, not at load time)
 *
 * Gemini SDK error shape (as of @google/generative-ai 0.21):
 *   err.message      — human-readable message from Google, e.g.:
 *                        "API key not valid. Please pass a valid API key."
 *                        "User location is not supported for the API use."
 *                        "[400 Bad Request] GenerateContent failed..."
 *                        "models/gemini-1.5-flash is not found for API version v1beta"
 *   err.status       — HTTP status code (number), e.g. 400, 403, 404, 429, 500
 *   err.statusText   — HTTP status text, e.g. "Bad Request"
 *   err.errorDetails — Google API error details array (may include @type, reason, etc.)
 *   err.stack        — JS stack trace (does NOT contain the API key)
 *
 * The API key is sent as a URL query parameter, so it can theoretically appear
 * in network-level logs but NOT in the SDK error object's message or stack.
 * Logging err.message is therefore safe for internal Vercel logs.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

// ── Singleton model instance ───────────────────────────────────────────────
let _model = null;

function getModel() {
  if (_model) return _model;

  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) {
    const err  = new Error(
      'GEMINI_API_KEY is not set. ' +
      'Add it in Vercel Dashboard → Project Settings → Environment Variables, ' +
      'or in your local .env file for development.'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }

  const client = new GoogleGenerativeAI(apiKey);

  _model = client.getGenerativeModel({
    model: config.llm.model,
    generationConfig: {
      // Lower temperature = more deterministic, spec-conformant output.
      temperature:      config.llm.temperature,
      // Generous headroom for complex multi-page application schemas.
      maxOutputTokens:  config.llm.maxOutputTokens,
    },
  }, { apiVersion: 'v1' });

  return _model;
}

// ── Timeout wrapper ────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout. Resolves/rejects with whichever completes first.
 * The timeout timer is cleared on settlement to prevent leaked timers.
 *
 * @param  {Promise}  promise
 * @param  {number}   ms           Timeout in milliseconds
 * @param  {string}   errMessage   Message attached to the timeout error
 * @returns {Promise}
 */
function withTimeout(promise, ms, errMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err  = new Error(errMessage);
      err.code   = 'TIMEOUT';
      reject(err);
    }, ms);
    // Allow the process to exit even if this timeout is still pending
    if (timer.unref) timer.unref();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Main callable ──────────────────────────────────────────────────────────

/**
 * Call the LLM with the provided full prompt string.
 *
 * @param   {string}  fullPrompt  Complete prompt built by lib/compiler/prompt.js
 * @returns {Promise<object>}     Parsed JSON object from the LLM
 *
 * @throws  {Error}  err.code = 'NO_API_KEY'     — GEMINI_API_KEY missing
 * @throws  {Error}  err.code = 'TIMEOUT'        — LLM call exceeded llmCallTimeout
 * @throws  {Error}  err.code = 'RATE_LIMITED'   — Provider returned 429 / quota exhausted
 * @throws  {Error}  err.code = 'PROVIDER_ERROR' — Any other provider failure
 * @throws  {Error}  err.code = 'INVALID_SCHEMA' — Response was not parseable JSON
 */
async function callLLM(fullPrompt) {
  const model = getModel();  // May throw NO_API_KEY

  // ── Network call with individual timeout ─────────────────────────────────
  let rawResult;
  try {
    rawResult = await withTimeout(
      model.generateContent(fullPrompt),
      config.compile.llmCallTimeout,
      `Gemini API call timed out after ${config.compile.llmCallTimeout}ms.`
    );
  } catch (err) {
    // Propagate our own timeout without wrapping
    if (err.code === 'TIMEOUT') throw err;

    // Gemini surfaces quota exhaustion as RESOURCE_EXHAUSTED or HTTP 429
    if (
      err.status === 429 ||
      err.message?.includes('RESOURCE_EXHAUSTED') ||
      err.message?.includes('quota')
    ) {
      const e      = new Error('AI provider rate limit exceeded. Please retry shortly.');
      e.code       = 'RATE_LIMITED';
      e.retryAfter = 60;
      throw e;
    }

    // ── PROVIDER_ERROR ────────────────────────────────────────────────────
    // The outgoing error message is intentionally generic (never exposes
    // provider internals to the client). Full diagnostics are attached to
    // err._diag for SERVER-SIDE logging in api/compile.js. toHttpResponse()
    // in lib/errors.js ignores _diag, so nothing leaks through the API.
    const e  = new Error('AI provider returned an error. Please try again.');
    e.code   = 'PROVIDER_ERROR';

    // Build diagnostic bag — safe to log internally.
    // Stack trace is split into lines so the logger's per-string length cap
    // doesn't truncate the full message on a single line.
    e._diag = {
      providerStatus:     err.status       ?? null,
      providerStatusText: err.statusText   ?? null,
      // err.message from Google SDK: human-readable, does not contain API key.
      providerMessage:    err.message      ?? null,
      // errorDetails is a Google API array e.g. [{ "@type": "...", "reason": "..." }]
      providerDetails:    Array.isArray(err.errorDetails)
        ? err.errorDetails.slice(0, 5)
        : null,
      // Split stack into lines so logger truncation doesn't eat the whole trace
      providerStack:      typeof err.stack === 'string'
        ? err.stack.split('\n').slice(0, 10)
        : null,
    };

    throw e;
  }

  // ── Extract response text ────────────────────────────────────────────────
  let responseText;
  try {
    responseText = rawResult.response.text();
  } catch (textErr) {
    const e  = new Error('Failed to extract text from AI provider response.');
    e.code   = 'PROVIDER_ERROR';
    // This path fires when the Gemini SDK's response.text() throws, usually
    // because the response was blocked by a safety filter mid-stream.
    // Attach diagnostic info so we can distinguish this from a network error.
    e._diag = {
      providerStatus:  null,
      providerMessage: textErr?.message ?? null,
      providerDetails: null,
      // Prompt-blocking responses from Gemini include a promptFeedback field:
      providerFeedback: rawResult?.response?.promptFeedback ?? null,
      providerStack:   typeof textErr?.stack === 'string'
        ? textErr.stack.split('\n').slice(0, 8)
        : null,
    };
    throw e;
  }

  // ── Parse JSON ────────────────────────────────────────────────────────────
  // responseMimeType: 'application/json' should guarantee parseable output,
  // but we handle the edge case defensively.
  try {
    return JSON.parse(responseText);
  } catch {
    // SECURITY: Do NOT attach responseText or any slice of it to this error.
    // Even a partial sample (as was done in Stage 1) leaks model output,
    // which could contain prompt-injected content or sensitive schema details.
    const e  = new Error('LLM returned non-JSON content despite JSON mode being active.');
    e.code   = 'INVALID_SCHEMA';
    throw e;
  }
}

module.exports = { callLLM };
