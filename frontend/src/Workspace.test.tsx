// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "./App";
import { Auth } from "./components/Auth";
import { defaultConfig, type Session } from "./lib/types";
configure({ asyncUtilTimeout: 5000 });
const cases = Array.from({ length: 7 }, (_, i) => ({
  id: "IR-" + i,
  title: "Review cohort " + i,
  severity: "high",
  event_count: 20,
  asset_count: 2,
}));
const runtime = {
  id: "simulator",
  name: "Deterministic replay",
  available: true,
  enabled: true,
  version: "1",
  verification: "Contract tested",
  detail: "No model calls",
  default_model: "sonnet",
  features: ["memory", "skills", "artifacts"],
  budget: "No model cost",
  docs: "https://example.com",
  deferred: [],
};
const calls: { path: string; body: unknown }[] = [];
let sessions: Session[] = [],
  trace: unknown[] = [];
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  calls.length = 0;
  sessions = [];
  trace = [];
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input),
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path === "/api/auth")
        return response({
          mode: "local",
          authenticated: true,
          passkeys_available: false,
        });
      if (path === "/api/incidents") return response(cases);
      if (path === "/api/capabilities")
        return response({
          tools: [
            { name: "get_event", description: "Read evidence", effect: "read" },
          ],
        });
      if (path === "/api/adapters") return response([runtime]);
      if (path === "/api/inventory")
        return response({
          frameworks: [],
          rows: [],
          tools: [],
          features: [],
          metrics: { records: 140, hosts: 2, sdk_adapters: 1, tools: 1 },
          scope: "Contract only",
          reviewed: "2026-10-01",
        });
      if (path === "/api/deployment")
        return response({
          mode: "local",
          target: "Fly pilot",
          production_ready: false,
          gates: [],
        });
      if (path.startsWith("/api/events?"))
        return response({
          items: [
            {
              id: 1,
              event_id: "4624",
              occurred_at: "2026-10-01",
              host: "LAB-01",
              source: "Security",
              raw: "<img src=x onerror=alert(1)>",
            },
          ],
          total: 20,
        });
      if (path === "/api/sessions") {
        if (body) {
          const s = {
            id: "session-test",
            case_id: body.case_id,
            title: "Replay test",
            config: body.config,
            status: "idle",
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0,
            created_at: "2026-10-01",
          };
          sessions.unshift(s);
        }
        return response(body ? sessions[0] : sessions);
      }
      if (path.endsWith("/advanced"))
        return response({
          configuration: defaultConfig,
          questions: [],
          tasks: [],
          memory: [],
          artifacts: [],
          playbooks: {},
          workspace: { enabled: false, files: [], checkpoints: [] },
        });
      if (path.endsWith("/messages")) {
        trace = [
          {
            seq: 1,
            kind: "message.user",
            payload: { text: body.message },
            created_at: "2026-10-01",
          },
          {
            seq: 2,
            kind: "message.assistant",
            payload: { text: "Observed record #1. This is a hypothesis." },
            created_at: "2026-10-01",
          },
          {
            seq: 3,
            kind: "run.completed",
            payload: { status: "completed" },
            created_at: "2026-10-01",
          },
        ];
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                new TextEncoder().encode(
                  trace.map((t) => JSON.stringify(t)).join("\n"),
                ),
              );
              c.close();
            },
          }),
        );
      }
      if (path.startsWith("/api/sessions/"))
        return response({ session: sessions[0], trace, approvals: [] });
      throw Error("Unexpected endpoint: " + path);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("React workspace", () => {
  it("does not clear evidence when selecting the current case again", async () => {
    render(<App />);
    await screen.findByText("7 open");
    await screen.findByRole("button", { name: "Inspect record 1" });
    fireEvent.click(screen.getByRole("button", { name: /^IR-0/ }));
    expect(
      screen.getByRole("button", { name: "Inspect record 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("20 records", { selector: ".muted" }),
    ).toBeInTheDocument();
  });
  it("does not report completion when a stream ends without a terminal event", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/messages")
          ? new Response(
              new ReadableStream({
                start(c) {
                  c.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({
                        seq: 1,
                        kind: "message.delta",
                        payload: { text: "Incomplete" },
                        created_at: "2026-10-01",
                      }),
                    ),
                  );
                  c.close();
                },
              }),
            )
          : originalFetch(input, init),
    );
    render(<App />);
    await screen.findByText("7 open");
    fireEvent.click(screen.getByRole("button", { name: "Open agent" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the investigation agent" }),
      { target: { value: "Review." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText("Run stopped — inspect the trace."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Run complete · audit saved"),
    ).not.toBeInTheDocument();
  });
  it("clears recovery input and never persists the token on a rejected login", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      String(input) === "/api/auth"
        ? response({ mode: "pilot", passkeys_available: false })
        : new Response(JSON.stringify({ error: "Invalid operator token" }), {
            status: 401,
          }),
    );
    render(<Auth />);
    const token = await screen.findByLabelText("Operator recovery token");
    fireEvent.change(token, {
      target: { value: "test-only-not-a-real-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
    expect(
      await screen.findByText("Invalid operator token"),
    ).toBeInTheDocument();
    expect(token).toHaveValue("");
    expect(localStorage.length).toBe(0);
  });
  it("loads all seven cases and inspects source text without executing markup", async () => {
    render(<App />);
    expect(await screen.findByText("7 open")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^IR-\d/ })).toHaveLength(7);
    fireEvent.click(
      await screen.findByRole("button", { name: "Inspect record 1" }),
    );
    expect(await screen.findByText(/onerror=alert/)).toBeInTheDocument();
    expect(document.querySelector("img[src=x]")).toBeNull();
    expect(calls.filter((c) => c.body !== undefined)).toHaveLength(0);
  });
  it("filters and paginates evidence through the API", async () => {
    render(<App />);
    await screen.findByText("7 open");
    await screen.findByRole("button", { name: "Inspect record 1" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search evidence" }), {
      target: { value: "LAB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes("search=LAB"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next evidence page" }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes("offset=15"))).toBe(true),
    );
  });
  it("guide navigation does not create a session or run a model", async () => {
    render(<App />);
    await screen.findByText("7 open");
    fireEvent.click(screen.getByRole("button", { name: /Quick start/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Start with deterministic replay/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Configure safe replay/ }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Configure an investigation",
      }),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.body !== undefined)).toHaveLength(0);
  });
  it("creates a read-only replay session and renders a streamed final record without newline", async () => {
    render(<App />);
    await screen.findByText("7 open");
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create session" }),
    );
    await waitFor(() =>
      expect(
        calls.find((c) => c.path === "/api/sessions" && c.body)?.body,
      ).toMatchObject({
        config: {
          runtime: "simulator",
          permission: "read_only",
          accept_no_usd_cap: false,
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Configure an investigation" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the investigation agent" }),
      { target: { value: "Review the evidence." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText("Observed record #1. This is a hypothesis."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Run complete · audit saved"),
    ).toBeInTheDocument();
    expect(Object.keys(localStorage)).not.toContain("token");
  });
  it("supports command palette navigation and persisted theme only", async () => {
    render(<App />);
    await screen.findByText("7 open");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
      target: { value: "matrix" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Capability matrix",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Capability coverage" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
    expect(localStorage.getItem("relay-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
  });
  it("keeps local authentication explicit without invoking credentials", async () => {
    render(<Auth security />);
    expect(
      await screen.findByText(/Local mode has no login/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add a passkey" }),
    ).not.toBeInTheDocument();
    expect(
      calls.filter((c) => c.path.startsWith("/api/passkeys")),
    ).toHaveLength(0);
  });
});
