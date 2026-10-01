import { api } from "./api";
export const decode = (value: string): ArrayBuffer =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  ).buffer;
export const encode = (value: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
type WireOptions = {
  challenge: string;
  user?: { id: string; name: string; displayName: string };
  allowCredentials?: { id: string; type: "public-key" }[];
  excludeCredentials?: { id: string; type: "public-key" }[];
  [key: string]: unknown;
};
export function options(value: WireOptions) {
  const result: Record<string, unknown> = {
    ...value,
    challenge: decode(value.challenge),
  };
  if (value.user) result.user = { ...value.user, id: decode(value.user.id) };
  for (const key of ["allowCredentials", "excludeCredentials"] as const)
    if (value[key])
      result[key] = value[key].map((c) => ({ ...c, id: decode(c.id) }));
  return result;
}
export function serialize(c: PublicKeyCredential | null) {
  if (!c) throw Error("No passkey was selected. Please try again.");
  const r = c.response,
    response: Record<string, unknown> = {
      clientDataJSON: encode(r.clientDataJSON),
    };
  if ("attestationObject" in r) {
    const reg = r as AuthenticatorAttestationResponse;
    response.attestationObject = encode(reg.attestationObject);
    response.transports = reg.getTransports?.();
  } else {
    const auth = r as AuthenticatorAssertionResponse;
    response.authenticatorData = encode(auth.authenticatorData);
    response.signature = encode(auth.signature);
    response.userHandle = auth.userHandle ? encode(auth.userHandle) : null;
  }
  return {
    id: c.id,
    rawId: encode(c.rawId),
    type: c.type,
    response,
    clientExtensionResults: c.getClientExtensionResults(),
  };
}
export const available = () =>
  window.isSecureContext &&
  !!window.PublicKeyCredential &&
  !!navigator.credentials;
export async function ceremony(
  kind: "registration" | "authentication",
  body: unknown = {},
) {
  if (!available())
    throw Error(
      "Use an up-to-date browser on the HTTPS pilot to use passkeys.",
    );
  const start = await api<{ ceremony_id: string; publicKey: WireOptions }>(
    `/api/passkeys/${kind}/options`,
    body,
  );
  const credential =
    kind === "registration"
      ? await navigator.credentials.create({
          publicKey: options(
            start.publicKey,
          ) as unknown as PublicKeyCredentialCreationOptions,
        })
      : await navigator.credentials.get({
          publicKey: options(
            start.publicKey,
          ) as unknown as PublicKeyCredentialRequestOptions,
        });
  return api(`/api/passkeys/${kind}/verify`, {
    ceremony_id: start.ceremony_id,
    credential: serialize(credential as PublicKeyCredential | null),
  });
}
export function authError(error: unknown) {
  if (!(error instanceof Error)) return "Sign-in failed.";
  return (
    (
      {
        NotAllowedError:
          "Passkey request cancelled or timed out. Try again, choose your nearby iPhone, or use the recovery token.",
        InvalidStateError:
          "That passkey may already be registered. Try signing in instead.",
        SecurityError: "Open the official HTTPS Relay address to use passkeys.",
        NotSupportedError:
          "This browser or authenticator does not support these passkey options.",
      } as Record<string, string>
    )[error.name] || error.message
  );
}
export function destination(search: string) {
  const next = new URLSearchParams(search).get("next");
  return next && ["architecture", "security"].includes(next) ? "/" + next : "/";
}
