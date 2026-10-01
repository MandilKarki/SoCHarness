// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HarnessApp } from "./HarnessApp";
import { defaultConfig, type Session, type Trace } from "./lib/types";
import { publicSteps, evidenceIds } from "./lib/harnessView";
let sessions: Session[],
  trace: Trace[],
  calls: { path: string; body: Record<string, unknown> }[],
  guard: boolean;
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  sessions = [];
  trace = [];
  calls = [];
  guard = true;
  window.scrollTo = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input),
        body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ path, body });
      if (path === "/api/incidents")
        return response([
          {
            id: "IR-1",
            title: "Authentication review",
            event_count: 3,
            asset_count: 1,
          },
        ]);
      if (path === "/api/adapters")
        return response([
          {
            id: "openai",
            available: true,
            enabled: true,
            version: "0.17.7",
            default_model: "test-model",
          },
        ]);
      if (path === "/api/openai-contract")
        return response({
          instructions: "Read only",
          version: "0.17.7",
          tools: [{ name: "query_case_evidence", schema: { type: "object" } }],
          output_schema: { type: "object" },
        });
      if (path === "/api/inventory")
        return response({
          tools: [
            { name: "query_case_evidence" },
            { name: "save_case_note" },
            { name: "get_event" },
          ],
          rows: [],
          frameworks: [],
        });
      if (path === "/api/deployment")
        return response({
          trial: {
            enabled: guard,
            remaining_usd: 4.4,
            limit_usd: 5,
            model: "test-model",
          },
        });
      if (path.startsWith("/api/events?"))
        return response({
          total: 3,
          items: [
            {
              id: 1,
              host: "FINANCE-07",
              event_id: "4625",
              source: "Windows",
              occurred_at: "2026-10-01",
            },
          ],
        });
      if (path === "/api/sessions" && init?.method === "POST") {
        const session = {
          id: "ses-new",
          case_id: "IR-1",
          config: body.config,
          title: "Review",
          status: "idle",
        } as Session;
        sessions.unshift(session);
        return response(session);
      }
      if (path === "/api/sessions") return response(sessions);
      if (path.endsWith("/advanced")) return response({});
      if (path.endsWith("/messages")) {
        trace = [
          ...trace,
          {
            seq: trace.length + 1,
            kind: "message.user",
            payload: { text: body.message },
            created_at: "",
          },
          {
            seq: trace.length + 2,
            kind: "message.assistant",
            payload: { text: "Review record #1." },
            created_at: "",
          },
          {
            seq: trace.length + 3,
            kind: "run.completed",
            payload: {},
            created_at: "",
          },
        ];
        return new Response(trace.map((t) => JSON.stringify(t)).join("\n"), {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }
      if (path.startsWith("/api/sessions/"))
        return response({ session: sessions[0], trace, approvals: [] });
      throw Error("Unexpected endpoint " + path);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("starts one real OpenAI session from the default flow and follows up in it", async () => {
  render(<HarnessApp />);
  expect(await screen.findByText("FINANCE-07")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Review the agent" }));
  const run = await screen.findByRole("button", { name: "Run investigation" });
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);
  fireEvent.click(run);
  await screen.findByRole("button", { name: "Review findings & next step" });
  const creations = calls.filter(
    (c) => c.path === "/api/sessions" && c.body.config,
  );
  expect(creations).toHaveLength(1);
  expect(creations[0].body.config).toMatchObject({
    runtime: "openai",
    permission: "read_only",
    max_turns: 3,
    disabled_tools: ["save_case_note", "get_event"],
  });
  expect(calls.filter((c) => c.path.endsWith("/messages"))).toHaveLength(1);
  expect(calls.find((c) => c.path.endsWith("/messages"))!.path).toBe(
    "/api/sessions/ses-new/messages",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review findings & next step" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run follow-up" }));
  await waitFor(() =>
    expect(calls.filter((c) => c.path.endsWith("/messages"))).toHaveLength(2),
  );
  expect(
    calls.filter((c) => c.path === "/api/sessions" && c.body.config),
  ).toHaveLength(1);
});
it("fails closed without a spending guard", async () => {
  guard = false;
  render(<HarnessApp />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review the agent" }),
  );
  await screen.findByText(/protected model allowance is not enabled/);
  expect(
    screen.getByRole("button", { name: "Run investigation" }),
  ).toBeDisabled();
  expect(calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
});
it("does not auto-load another SDK’s session", async () => {
  sessions = [
    {
      id: "claude-old",
      case_id: "IR-1",
      config: { ...defaultConfig, runtime: "claude" },
      status: "idle",
    } as Session,
  ];
  render(<HarnessApp />);
  await screen.findByText("FINANCE-07");
  expect(calls.some((c) => c.path === "/api/sessions/claude-old")).toBe(false);
});
it("observes actual events only, without inventing calls or evidence", () => {
  expect(publicSteps([])).toEqual([]);
  expect(
    evidenceIds([
      {
        seq: 1,
        kind: "message.assistant",
        payload: { text: "#999" },
        created_at: "",
      },
    ]),
  ).toEqual([]);
});
