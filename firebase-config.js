// ============================================================
//  FORGE44 — Firebase Client SDK Configuration
//
//  SECURITY NOTE — why this file can be public:
//  ─────────────────────────────────────────────
//  The Firebase API key below is a CLIENT-SIDE web API key. This is
//  intentionally designed to be public by Google. It is NOT a secret.
//
//  Security for this project is enforced by:
//    1. Firebase Security Rules  (firestore.rules, storage.rules)
//       — Only authenticated users can access their own documents.
//    2. Firebase Authentication  (restricts who can sign in)
//    3. Firebase Console         (API key restricted to your domain)
//
//  The key cannot be used to read or write Firestore without the user
//  being signed in AND the document matching the user's UID in rules.
//
//  Reference: https://firebase.google.com/docs/projects/api-keys
//
//  What IS a secret and must NOT be public:
//    - Firebase Admin service account JSON  (FIREBASE_SERVICE_ACCOUNT_BASE64)
//    - The GEMINI_API_KEY
//    - Any future Stripe/webhook/provider secrets
//  These are stored ONLY in environment variables (never in source code).
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAu9pL8Zjq9LnyL5EsiKV2q7isI0sxuonM",
  authDomain:        "forge44.firebaseapp.com",
  projectId:         "forge44",
  storageBucket:     "forge44.firebasestorage.app",
  messagingSenderId: "969982127367",
  appId:             "1:969982127367:web:bcc08c2c77503ff1e929a2"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
