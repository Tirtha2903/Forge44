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
 * Security properties:
 *   - rawSample is NEVER attached to error objects (would leak model output)
 *   - Provider error messages are sanitized before re-throwing
 *   - API key validity is checked lazily (on first request, not at load time)
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
      // Force JSON output at the API level — not merely via prompt instruction.
      // If the model cannot produce valid JSON, the request fails cleanly
      // rather than returning text that would silently break validation.
      responseMimeType: 'application/json',
      // Lower temperature = more deterministic, spec-conformant output.
      temperature:      config.llm.temperature,
      // Generous headroom for complex multi-page application schemas.
      maxOutputTokens:  config.llm.maxOutputTokens,
    },
  });

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

    // Generic provider error — we deliberately do NOT attach err.message to
    // the outgoing error because it may contain provider internals (model IDs,
    // internal service names, etc.) that could aid an attacker in fingerprinting.
    // The calling handler logs the original error code for internal debugging.
    const e  = new Error('AI provider returned an error. Please try again.');
    e.code   = 'PROVIDER_ERROR';
    throw e;
  }

  // ── Extract response text ────────────────────────────────────────────────
  let responseText;
  try {
    responseText = rawResult.response.text();
  } catch {
    const e  = new Error('Failed to extract text from AI provider response.');
    e.code   = 'PROVIDER_ERROR';
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
