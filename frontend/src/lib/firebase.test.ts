import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({})),
  initializeAuth: vi.fn(() => ({})),
  popup: vi.fn(),
  signOut: vi.fn(async () => {}),
  api: vi.fn(async () => ({})),
  parameters: vi.fn(),
}));
vi.mock("firebase/app", () => ({ initializeApp: mocks.initializeApp }));
vi.mock("firebase/auth", () => ({
  initializeAuth: mocks.initializeAuth,
  inMemoryPersistence: "memory",
  browserPopupRedirectResolver: "popup",
  GoogleAuthProvider: class {
    setCustomParameters = mocks.parameters;
  },
  signInWithPopup: mocks.popup,
  signOut: mocks.signOut,
}));
vi.mock("./api", () => ({ api: mocks.api }));
import { prepareGoogle, googleLogin } from "./firebase";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.popup.mockResolvedValue({
    user: { getIdToken: async () => "test-id-token" },
  });
});
describe("Google sign-in", () => {
  it("does not dispatch before configuration", async () => {
    await expect(googleLogin()).rejects.toThrow("not ready");
    expect(mocks.popup).not.toHaveBeenCalled();
  });
  it("uses memory-only identity and exchanges a token for the backend cookie", async () => {
    prepareGoogle({
      projectId: "test",
      authDomain: "test.firebaseapp.com",
      apiKey: "public",
      appId: "web",
    });
    expect(mocks.initializeAuth).toHaveBeenCalledWith(
      {},
      { persistence: "memory", popupRedirectResolver: "popup" },
    );
    await googleLogin();
    expect(mocks.parameters).toHaveBeenCalledWith({ prompt: "select_account" });
    expect(mocks.api).toHaveBeenCalledWith("/api/login/google", {
      id_token: "test-id-token",
    });
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("clears Firebase state when backend rejects the account", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Unapproved account"));
    await expect(googleLogin()).rejects.toThrow("Unapproved");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("explains blocked popups without sending a token", async () => {
    mocks.popup.mockRejectedValueOnce({ code: "auth/popup-blocked" });
    await expect(googleLogin()).rejects.toThrow(
      "Allow the Google sign-in popup",
    );
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
