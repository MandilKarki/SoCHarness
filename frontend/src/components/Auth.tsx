import { useEffect, useState } from "react";
import { ArrowLeft, Fingerprint, ShieldCheck, KeyRound } from "lucide-react";
import { api } from "../lib/api";
import { authError, available, ceremony, destination } from "../lib/passkeys";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, Modal, Status } from "./shared";
interface Key {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}
interface Keys {
  passkeys: Key[];
  recent_auth: boolean;
  max_keys: number;
}
export function Auth({ security = false }: { security?: boolean }) {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [local, setLocal] = useState(false),
    [ready, setReady] = useState(false),
    [keys, setKeys] = useState<Keys | null>(null),
    [label, setLabel] = useState(""),
    [remove, setRemove] = useState<Key | null>(null);
  async function load() {
    const auth = await api<{ mode: string; passkeys_available: boolean }>(
      "/api/auth",
    );
    setLocal(auth.mode === "local");
    setReady(auth.passkeys_available && available());
    if (security && auth.mode !== "local")
      setKeys(await api<Keys>("/api/passkeys"));
  }
  useEffect(() => {
    void load().catch((e) => setStatus(authError(e)));
  }, [security]);
  async function perform(fn: () => Promise<unknown>, redirect = false) {
    if (busy) return;
    setBusy(true);
    setStatus("Follow your device’s secure sign-in prompt…");
    try {
      await fn();
      if (redirect) location.assign(destination(location.search));
      else {
        setStatus("Passkey registered. It is ready to use.");
        setLabel("");
        await load();
      }
    } catch (e) {
      setStatus(authError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="identity-page">
      <div className="identity-brand">
        <span className="brand-mark">r</span>
        <strong>
          relay<span> / identity</span>
        </strong>
      </div>
      <div className="identity-layout">
        <section className="identity-intro">
          <Status tone="good">Private operator workspace</Status>
          <h1>
            Secure access.
            <br />
            <span>Less friction.</span>
          </h1>
          <p>
            Your investigation workspace, on your iPhone, Mac, or another
            trusted device.
          </p>
          <div className="identity-points">
            <p>
              <Fingerprint /> Your passkey stays with your authenticator.
            </p>
            <p>
              <ShieldCheck /> Face ID, Touch ID, or your device’s screen lock.
            </p>
            <p>
              <KeyRound /> Recovery token remains your fallback.
            </p>
          </div>
          <small>Single-operator pilot · no public account registration</small>
        </section>
        <section className="identity-card">
          <a className="back-link" href="/">
            <ArrowLeft size={15} /> Workspace
          </a>
          <h2>{security ? "Manage your passkeys" : "Welcome back"}</h2>
          <p>
            {security
              ? "Add a passkey after a fresh sign-in. Synced Apple passkeys can be used across your devices."
              : "Sign in with a registered passkey, or use your operator recovery token."}
          </p>
          {local ? (
            <div className="callout">
              Local mode has no login. Passkey enrollment is available on the
              HTTPS Fly pilot.
              <p>
                <a href="/">Open workspace →</a>
              </p>
            </div>
          ) : security ? (
            <>
              {keys && !keys.recent_auth && (
                <div className="callout warning">
                  Sign in again to manage credentials.{" "}
                  <a href="/login?next=security">Fresh sign-in →</a>
                </div>
              )}
              <div className="key-list">
                {keys?.passkeys.length === 0 && (
                  <p>No passkeys yet. Add your first below.</p>
                )}
                {keys?.passkeys.map((k) => (
                  <div className="list-row" key={k.id}>
                    <div>
                      <strong>{k.label}</strong>
                      <small>
                        Added {new Date(k.created_at).toLocaleDateString()}
                      </small>
                      <small>
                        {k.last_used_at
                          ? "Last used " +
                            new Date(k.last_used_at).toLocaleString()
                          : "Not used to sign in yet"}
                      </small>
                    </div>
                    <Button
                      variant="ghost"
                      disabled={busy || !keys.recent_auth}
                      onClick={() => setRemove(k)}
                      aria-label={"Remove " + k.label}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(() =>
                    ceremony("registration", { label: label.trim() }),
                  );
                }}
              >
                <Field label="Passkey name">
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    required
                    maxLength={80}
                    placeholder="My iPhone / iCloud Keychain"
                  />
                </Field>
                <Button
                  disabled={
                    busy ||
                    !ready ||
                    !keys?.recent_auth ||
                    keys.passkeys.length >= keys.max_keys
                  }
                >
                  <Fingerprint />
                  Add a passkey
                </Button>
              </form>
              <p className="footnote">
                You must complete the secure device prompt yourself. With iCloud
                Passwords & Keychain enabled, a synced passkey can be available
                on your iPhone and Mac. Another laptop can use your nearby phone
                when its browser supports it.
              </p>
            </>
          ) : (
            <>
              <Button
                className="full-width"
                disabled={busy || !ready}
                onClick={() =>
                  void perform(() => ceremony("authentication"), true)
                }
              >
                <Fingerprint />
                Sign in with a passkey
              </Button>
              <details className="recovery" open={!ready}>
                <summary>Use recovery token</summary>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      token = String(new FormData(form).get("token") || "");
                    form.reset();
                    void perform(() => api("/api/login", { token }), true);
                  }}
                >
                  <Field label="Operator recovery token">
                    <Input
                      name="token"
                      type="password"
                      autoComplete="off"
                      required
                      spellCheck={false}
                    />
                  </Field>
                  <Button variant="outline" disabled={busy}>
                    Sign in securely
                  </Button>
                </form>
              </details>
              <p className="footnote">
                First visit? Sign in with your recovery token, then open Account
                security to register a passkey.
              </p>
            </>
          )}
          <p role="status" className="identity-status">
            {status}
          </p>
        </section>
      </div>
      <Modal
        open={!!remove}
        onClose={() => {
          if (!busy) setRemove(null);
        }}
        title="Remove this passkey?"
        description="This removes the credential on every device it is synced to and signs out all browser sessions. Keep your recovery token available."
      >
        <strong>{remove?.label}</strong>
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRemove(null)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (!remove) return;
              setBusy(true);
              void api("/api/passkeys/remove", { id: remove.id })
                .then(() => location.assign("/login?next=security"))
                .catch((e) => {
                  setStatus(authError(e));
                  setRemove(null);
                  setBusy(false);
                });
            }}
          >
            Remove and sign out
          </Button>
        </div>
      </Modal>
    </main>
  );
}
