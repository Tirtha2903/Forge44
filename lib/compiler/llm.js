'use strict';

/**
 * LLM abstraction layer — Google Gemini 1.5 Flash
 *
 * Responsibilities:
 *   - Client initialisation with singleton pattern (avoid cold-start overhead)
 *   - Enforcing JSON-only output via responseMimeType at the API level
 *   - Mapping provider-specific errors to structured err.code values
 *
 * To switch providers, replace this module only.
 * No other file in the compiler pipeline needs to change.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Singleton model instance ───────────────────────────────────────────────
let _model = null;

function getModel() {
  if (_model) return _model;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'GEMINI_API_KEY environment variable is not set. ' +
      'Set it in Vercel Dashboard → Project Settings → Environment Variables.'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }

  const client = new GoogleGenerativeAI(apiKey);

  _model = client.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      // Force JSON output at the API level — not just via prompting.
      // If the model can't return valid JSON, the request fails cleanly.
      responseMimeType: 'application/json',
      // Low temperature for deterministic, spec-conformant schemas.
      temperature: 0.35,
      // Ample headroom for complex multi-page application schemas.
      maxOutputTokens: 8192,
    },
  });

  return _model;
}

/**
 * Call the LLM with the provided full prompt string.
 *
 * @param   {string}  fullPrompt  Complete prompt built by lib/compiler/prompt.js
 * @returns {Promise<object>}     Parsed JSON object from LLM
 *
 * @throws  {Error}  err.code = 'NO_API_KEY'     — GEMINI_API_KEY missing
 * @throws  {Error}  err.code = 'RATE_LIMITED'   — Provider returned 429
 * @throws  {Error}  err.code = 'PROVIDER_ERROR' — Any other provider failure
 * @throws  {Error}  err.code = 'INVALID_SCHEMA' — Response was not valid JSON
 */
async function callLLM(fullPrompt) {
  const model = getModel();

  let responseText;
  try {
    const result = await model.generateContent(fullPrompt);
    responseText = result.response.text();
  } catch (err) {
    // Gemini surfaces rate limits as RESOURCE_EXHAUSTED or HTTP 429
    if (
      err.status === 429 ||
      err.message?.includes('RESOURCE_EXHAUSTED') ||
      err.message?.includes('quota')
    ) {
      const e      = new Error('Gemini API rate limit exceeded. Please retry shortly.');
      e.code        = 'RATE_LIMITED';
      e.retryAfter  = 60;
      throw e;
    }

    const e   = new Error(`Gemini API error: ${err.message}`);
    e.code     = 'PROVIDER_ERROR';
    e.original = err;
    throw e;
  }

  // Parse — responseMimeType should guarantee JSON, but handle edge cases defensively
  try {
    return JSON.parse(responseText);
  } catch {
    const e    = new Error('LLM returned non-JSON content despite JSON mode being active.');
    e.code      = 'INVALID_SCHEMA';
    e.rawSample = responseText.slice(0, 400); // For debugging only
    throw e;
  }
}

module.exports = { callLLM };
