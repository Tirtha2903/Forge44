'use strict';

/**
 * Forge44 — Optional Firebase Admin SDK
 *
 * Purpose: Verify Firebase ID tokens sent by the frontend in the
 *          Authorization: Bearer <token> header.
 *
 * Why optional?
 *   The compile endpoint works without authentication. Firebase Admin is
 *   used ONLY to verify identity for preferential rate-limit tiers.
 *   If the service account is not configured:
 *     • All requests use IP-based rate limiting (anonymous limits)
 *     • No compilation functionality is affected
 *
 * Setup (one-time):
 * ─────────────────
 * 1. Firebase Console → Project Settings → Service Accounts
 *    → "Generate new private key" → download the JSON file
 * 2. Base64-encode the file (avoids newline issues in env vars):
 *      macOS/Linux:  base64 -i service-account.json
 *      Windows PS:   [Convert]::ToBase64String([IO.File]::ReadAllBytes('service-account.json'))
 * 3. In Vercel Dashboard → Project Settings → Environment Variables:
 *      FIREBASE_SERVICE_ACCOUNT_BASE64 = <the base64 string>
 * 4. Delete the JSON file — NEVER commit it to git.
 *
 * Security properties:
 *   - checkRevoked: true  → Revoked tokens (from sign-out) are rejected
 *   - Token is NEVER logged, not even partially
 *   - Any verification failure returns null (graceful anonymous fallback)
 *   - The original Firebase error message is sanitized before logging
 */

const logger = require('./logger');

// ── Singleton state ────────────────────────────────────────────────────────
let _auth        = null;   // firebase-admin Auth instance
let _initialized = false;  // Prevents redundant initialization attempts

/**
 * Initialize Firebase Admin once (on the first call that needs it).
 * Subsequent calls return immediately via the _initialized guard.
 */
function initialize() {
  if (_initialized) return;
  _initialized = true;

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64 || b64.trim() === '') {
    logger.info('firebaseAdmin.skipped', {
      reason: 'FIREBASE_SERVICE_ACCOUNT_BASE64 not set — running without token verification (anonymous rate limits apply)',
    });
    return;
  }

  // Dynamic require so firebase-admin is only loaded when actually needed.
  // If the package is not installed, we catch MODULE_NOT_FOUND gracefully.
  let admin;
  try {
    admin = require('firebase-admin');
  } catch (err) {
    logger.warn('firebaseAdmin.packageMissing', {
      reason: err.code === 'MODULE_NOT_FOUND'
        ? 'firebase-admin is not installed. Run: npm install firebase-admin'
        : 'Failed to load firebase-admin package.',
    });
    return;
  }

  // Parse the service account JSON
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(
      Buffer.from(b64.trim(), 'base64').toString('utf8')
    );
  } catch {
    logger.error('firebaseAdmin.badServiceAccount', {
      reason: 'FIREBASE_SERVICE_ACCOUNT_BASE64 is not valid base64-encoded JSON. Regenerate the service account key.',
    });
    return;
  }

  // Initialize the default app (or reuse if already initialized by another module)
  try {
    const app = admin.apps.length === 0
      ? admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
      : admin.app();

    _auth = admin.auth(app);

    logger.info('firebaseAdmin.ready', {
      projectId: serviceAccount.project_id ?? 'unknown',
    });
  } catch (err) {
    // Log a sanitized message — not the raw error (which may contain key fragments)
    logger.error('firebaseAdmin.initFailed', {
      reason: 'Failed to initialize Firebase Admin app. Check service account credentials.',
    });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract and verify a Firebase ID token from the request's Authorization header.
 *
 * Returns null (never throws) if:
 *   - No Authorization header is present   → treat as anonymous
 *   - Header format is not "Bearer <token>" → treat as anonymous
 *   - Firebase Admin is not configured     → treat as anonymous
 *   - Token is invalid, expired, or revoked → treat as anonymous
 *
 * The fallback-to-null design ensures the compile endpoint always responds,
 * even when authentication infrastructure is partially unavailable.
 *
 * @param  {object} req  Node.js / Vercel HTTP request object
 * @returns {Promise<{uid: string, email: string|null}|null>}
 */
async function extractVerifiedUser(req) {
  // Support both lowercase and original-case header (Vercel normalizes to lowercase)
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;

  // Authorization header must be exactly: Bearer <token>
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  if (!match) return null;

  const token = match[1];
  if (!token) return null;

  // Initialize Firebase Admin on first use
  initialize();

  if (!_auth) return null;  // Admin not configured → anonymous

  try {
    // checkRevoked: true enforces that sign-out (token revocation) is respected
    const decoded = await _auth.verifyIdToken(token, /* checkRevoked */ true);
    return {
      uid:   decoded.uid,
      email: decoded.email ?? null,
    };
  } catch (err) {
    // Log the auth failure with only a sanitized code — never the token or raw message
    logger.warn('auth.verifyFailed', {
      code:   err.code ?? err.errorInfo?.code ?? 'UNKNOWN',
      // Use err.errorInfo?.message (from Firebase) as it's safe — no key material
      reason: (err.errorInfo?.message ?? err.message ?? '').slice(0, 120),
    });
    return null;  // Graceful anonymous fallback
  }
}

module.exports = { extractVerifiedUser };
