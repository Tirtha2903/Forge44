// ============================================================
//  FORGE44 — Firebase Configuration
//  How to fill this in:
//  1. Go to https://console.firebase.google.com
//  2. Open your project -> Project settings (gear icon) -> General tab
//  3. Scroll to "Your apps" -> select your web app -> copy the config
//  4. Paste the values below, replacing each "YOUR_..." placeholder
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
