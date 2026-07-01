// ============================================================
//  FORGE44— Firebase Auth Module
//  Handles GitHub + Google sign-in, auth state, and UI updates
// ============================================================
import { auth } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const googleProvider = new GoogleAuthProvider();
const githubProvider = new GithubAuthProvider();

// ── DOM refs ──────────────────────────────────────────────────
const signInModal    = document.getElementById("signInModal");
const closeSignInBtn = document.getElementById("closeSignIn");
const navSignInBtn   = document.getElementById("navSignIn");
const navUserAvatar  = document.getElementById("navUserAvatar");
const navUserImg     = document.getElementById("navUserImg");

const modalSignedOut = document.getElementById("modalSignedOut");
const modalSignedIn  = document.getElementById("modalSignedIn");
const modalUserPhoto = document.getElementById("modalUserPhoto");
const modalUserName  = document.getElementById("modalUserName");
const modalUserEmail = document.getElementById("modalUserEmail");

const githubBtn = document.getElementById("githubSignIn");
const googleBtn = document.getElementById("googleSignIn");
const signOutBtn = document.getElementById("signOutBtn");
const authErrorMsg = document.getElementById("authErrorMsg");

// ── Helpers ───────────────────────────────────────────────────
const avatarUrl = (user) =>
  user.photoURL ||
  `https://ui-avatars.com/api/?name=${encodeURIComponent(
    user.displayName || user.email || "U"
  )}&background=FF7A1A&color=fff&bold=true`;

const showError = (msg) => {
  if (!authErrorMsg) return;
  authErrorMsg.textContent = msg;
  authErrorMsg.style.display = "block";
  setTimeout(() => (authErrorMsg.style.display = "none"), 5000);
};

// ── Modal open / close ────────────────────────────────────────
const openModal = () => {
  signInModal?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
};
const closeModal = () => {
  signInModal?.classList.add("hidden");
  document.body.style.overflow = "";
};

navSignInBtn?.addEventListener("click", openModal);
navUserAvatar?.addEventListener("click", openModal);
closeSignInBtn?.addEventListener("click", closeModal);
signInModal?.addEventListener("click", (e) => {
  if (e.target === signInModal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !signInModal?.classList.contains("hidden")) closeModal();
});

// ── Auth state observer ───────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (user) {
    // — Expose user for app.js to attach auth tokens to API calls —
    // app.js is a classic (non-module) script and cannot import from auth.js.
    // This window property is the bridge between the two execution contexts.
    // It is set BEFORE UI updates so the token is available immediately.
    window.__forge44User = user;

    // — Show user avatar in nav, hide sign-in button —
    navSignInBtn?.classList.add("hidden");
    if (navUserAvatar) {
      navUserAvatar.classList.remove("hidden");
      if (navUserImg) {
        navUserImg.src = avatarUrl(user);
        navUserImg.alt = user.displayName || "User";
      }
    }

    // — Switch modal to signed-in view —
    if (modalUserPhoto) modalUserPhoto.src = avatarUrl(user);
    if (modalUserName)  modalUserName.textContent  = user.displayName || "User";
    if (modalUserEmail) modalUserEmail.textContent = user.email || "";
    modalSignedOut?.classList.add("hidden");
    modalSignedIn?.classList.remove("hidden");
  } else {
    // — Clear the exposed user reference on sign-out —
    window.__forge44User = null;

    // — Signed out: restore default UI —
    navSignInBtn?.classList.remove("hidden");
    navUserAvatar?.classList.add("hidden");
    modalSignedOut?.classList.remove("hidden");
    modalSignedIn?.classList.add("hidden");
  }
});

// ── Sign-in helpers ────────────────────────────────────────────
const setLoading = (btn, isLoading, originalHTML) => {
  btn.disabled = isLoading;
  btn.innerHTML = isLoading
    ? `<span class="auth-spinner"></span> Connecting…`
    : originalHTML;
};

// GitHub
const githubHTML = githubBtn?.innerHTML;
githubBtn?.addEventListener("click", async () => {
  setLoading(githubBtn, true, githubHTML);
  try {
    await signInWithPopup(auth, githubProvider);
    closeModal();
  } catch (err) {
    console.error("GitHub sign-in:", err);
    showError(err.code === "auth/popup-closed-by-user"
      ? "Sign-in cancelled."
      : "GitHub sign-in failed. Please try again.");
  } finally {
    setLoading(githubBtn, false, githubHTML);
  }
});

// Google
const googleHTML = googleBtn?.innerHTML;
googleBtn?.addEventListener("click", async () => {
  setLoading(googleBtn, true, googleHTML);
  try {
    await signInWithPopup(auth, googleProvider);
    closeModal();
  } catch (err) {
    console.error("Google sign-in:", err);
    showError(err.code === "auth/popup-closed-by-user"
      ? "Sign-in cancelled."
      : "Google sign-in failed. Please try again.");
  } finally {
    setLoading(googleBtn, false, googleHTML);
  }
});

// Sign out
signOutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  closeModal();
});
