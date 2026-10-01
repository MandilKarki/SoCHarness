import { describe, it, expect } from "vitest";
import { mergeTrace, readNDJSON, safeLink } from "./api";
import {
  decode,
  encode,
  options,
  serialize,
  destination,
  authError,
} from "./passkeys";
import type { Trace } from "./types";
const event = (seq: number): Trace => ({
  seq,
  kind: "message.delta",
  payload: { text: "héllo 🔐" },
  created_at: "2026-10-01",
});
describe("stream transport", () => {
  it("preserves split UTF-8, blank lines, and a final record without newline", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify(event(1)) + "\n\n" + JSON.stringify(event(2)),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3)
          c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const events: Trace[] = [];
    await readNDJSON(stream, (e) => events.push(e));
    expect(events).toEqual([event(1), event(2)]);
  });
  it("rejects malformed JSON instead of reporting success", async () => {
    await expect(
      readNDJSON(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("{bad}\n"));
            c.close();
          },
        }),
        () => {},
      ),
    ).rejects.toThrow();
  });
  it("merges polling and streaming without duplicate sequence IDs", () => {
    expect(
      mergeTrace([event(2), event(1)], [event(2), event(3)]).map((e) => e.seq),
    ).toEqual([1, 2, 3]);
  });
  it("handles an empty stream", async () => {
    const seen: Trace[] = [];
    await readNDJSON(
      new ReadableStream({
        start(c) {
          c.close();
        },
      }),
      (e) => seen.push(e),
    );
    expect(seen).toEqual([]);
  });
});
describe("public credential transport", () => {
  it("round-trips arbitrary binary as unpadded base64url", () => {
    const b = Uint8Array.from([0, 255, 128, 5, 250]).buffer;
    expect(new Uint8Array(decode(encode(b)))).toEqual(new Uint8Array(b));
    expect(encode(b)).not.toMatch(/[+/=]/);
  });
  it("decodes challenge, user and descriptor IDs without altering policy", () => {
    const o = options({
      challenge: "AQI",
      user: { id: "Aw", name: "operator", displayName: "Operator" },
      allowCredentials: [{ id: "BA", type: "public-key" }],
      excludeCredentials: [{ id: "BQ", type: "public-key" }],
      userVerification: "required",
    });
    expect(o.challenge).toEqual(Uint8Array.from([1, 2]).buffer);
    expect(o.userVerification).toBe("required");
    expect((o.user as { id: ArrayBuffer }).id).toEqual(
      Uint8Array.from([3]).buffer,
    );
    expect((o.allowCredentials as { id: ArrayBuffer }[])[0].id).toEqual(
      Uint8Array.from([4]).buffer,
    );
  });
  it("serializes assertions without private key material", () => {
    const b = Uint8Array.from([1]).buffer;
    const c = {
      id: "credential",
      rawId: b,
      type: "public-key",
      response: {
        clientDataJSON: b,
        authenticatorData: b,
        signature: b,
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
    expect(serialize(c)).toEqual({
      id: "credential",
      rawId: "AQ",
      type: "public-key",
      response: {
        clientDataJSON: "AQ",
        authenticatorData: "AQ",
        signature: "AQ",
        userHandle: null,
      },
      clientExtensionResults: {},
    });
  });
  it("serializes registration and transports", () => {
    const b = Uint8Array.from([1]).buffer;
    const c = {
      id: "c",
      rawId: b,
      type: "public-key",
      response: {
        clientDataJSON: b,
        attestationObject: b,
        getTransports: () => ["internal"],
      },
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
    expect(serialize(c).response.transports).toEqual(["internal"]);
  });
  it("rejects cancelled credential selection", () => {
    expect(() => serialize(null)).toThrow("No passkey");
  });
  it.each([
    "?next=https://evil.example",
    "?next=//evil.example",
    "?next=javascript:alert(1)",
    "?next=../api/logout",
    "",
  ])("does not permit open redirects (%s)", (search) =>
    expect(destination(search)).toBe("/"),
  );
  it.each(["security", "architecture"])(
    "keeps the allowed %s destination",
    (next) => expect(destination("?next=" + next)).toBe("/" + next),
  );
  it("explains cancellation with a recovery path", () =>
    expect(authError(new DOMException("cancel", "NotAllowedError"))).toContain(
      "recovery token",
    ));
});
describe("source links", () => {
  it("rejects executable and relative URLs", () => {
    expect(safeLink("javascript:alert(1)")).toBeUndefined();
    expect(safeLink("/api/logout")).toBeUndefined();
    expect(safeLink("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
  });
});
