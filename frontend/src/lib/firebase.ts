import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";
import { api } from "./api";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}
let auth: Auth | undefined;
export function prepareGoogle(config: FirebaseConfig) {
  // No persistent browser ID tokens and no Analytics SDK. Only Relay's HttpOnly
  // cookie survives a login; the Google password never reaches this application.
  auth ??= initializeAuth(initializeApp(config, "relay-login"), {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
}
export async function googleLogin() {
  if (!auth)
    throw new Error("Google sign-in is not ready. Reload and try again.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const result = await signInWithPopup(auth, provider);
    await api("/api/login/google", {
      id_token: await result.user.getIdToken(),
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/popup-blocked")
      throw new Error(
        "Allow the Google sign-in popup, then try again in Safari or Chrome.",
      );
    if (
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request"
    )
      throw new Error("Google sign-in was cancelled. You can try again.");
    if (code === "auth/unauthorized-domain")
      throw new Error(
        "This site's domain is not authorized in Firebase. Contact the operator.",
      );
    throw error;
  } finally {
    await signOut(auth).catch(() => undefined);
  }
}
