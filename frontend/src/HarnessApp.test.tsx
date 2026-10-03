// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HarnessApp } from "./HarnessApp";
import { defaultConfig, type Session, type Trace } from "./lib/types";
import { publicSteps, evidenceIds, laneOf, stepSummary } from "./lib/harnessView";
import { OrchestrationMap } from "./components/OrchestrationMap";
let sessions: Session[],
  trace: Trace[],
  calls: { path: string; body: Record<string, unknown> }[],
  guard: boolean;
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
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
const openLiveRun = async () =>
  fireEvent.click(await screen.findByRole("tab", { name: /Live run/ }));
it("starts one real OpenAI session from the default flow and follows up in it", async () => {
  render(<HarnessApp />);
  await openLiveRun();
  expect(await screen.findByText("FINANCE-07")).toBeVisible();
  const run = await screen.findByRole("button", { name: "Run investigation" });
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);
  fireEvent.click(run);
  const follow = await screen.findByRole("button", { name: "Run follow-up" });
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
  await waitFor(() => expect(follow).toBeEnabled());
  fireEvent.click(follow);
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
  await openLiveRun();
  await screen.findByText(/protected model allowance is not enabled/);
  expect(
    screen.getByRole("button", { name: "Run investigation" }),
  ).toBeDisabled();
  expect(calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
});
it("opens on the anatomy view and inspects a selected harness part", async () => {
  render(<HarnessApp />);
  expect(screen.getByRole("tab", { name: /Anatomy/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
  expect(
    screen.getByRole("heading", { level: 3, name: "Tools" }),
  ).toBeVisible();
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
it.each([
  ["manager", 4],
  ["handoff", 3],
  ["guardrails", 3],
  ["review", 3],
  ["sessions", 3],
  ["multi_tool", 3],
])(
  "starts the %s experiment with bounded read-only configuration",
  async (id, limit) => {
    render(<HarnessApp />);
    await openLiveRun();
    await screen.findByText("FINANCE-07");
    fireEvent.change(screen.getByLabelText("Experiment"), {
      target: { value: id },
    });
    const start = screen.getByRole("button", { name: "Run investigation" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByRole("button", { name: "Run follow-up" });
    const creation = calls.find(
      (c) => c.path === "/api/sessions" && c.body.config,
    )!;
    expect(creation.body.config).toMatchObject({
      openai_experiment: id,
      max_turns: limit,
      permission: "read_only",
      structured_output: true,
    });
    const disabled = (creation.body.config as { disabled_tools: string[] })
      .disabled_tools;
    expect(disabled).toContain("save_case_note");
    expect(disabled.includes("get_event")).toBe(id !== "multi_tool");
  },
);
it("replays receipts without making requests and exposes session context", () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  const inspect = vi.fn();
  const events: Trace[] = [
    {
      seq: 1,
      kind: "session.context",
      payload: { retained_items: 4, method: "SDK Session protocol" },
      created_at: "",
    },
    {
      seq: 2,
      kind: "agent.handoff",
      payload: { from: "Triage agent", to: "Evidence specialist" },
      created_at: "",
    },
  ];
  render(
    <OrchestrationMap
      experiment="handoff"
      trace={events}
      active={false}
      onInspect={inspect}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Session overlay" }));
  expect(screen.getByText("4 items")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Replay" }));
  expect(screen.getByText("1 / 2 · free replay")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next recorded event" }));
  fireEvent.click(
    screen.getByRole("button", { name: /Control transfers to specialist/ }),
  );
  expect(inspect).toHaveBeenCalledWith(2);
  expect(calls).toEqual([]);
});
it("summarises steps from their recorded payload only", () => {
  const ev = (kind: string, payload: Record<string, unknown>): Trace =>
    ({ seq: 1, kind, payload, created_at: "" }) as Trace;
  expect(laneOf(ev("tool.result", {}))).toBe("data");
  expect(laneOf(ev("model.response", {}))).toBe("model");
  expect(laneOf(ev("agent.handoff", {}))).toBe("sdk");
  expect(laneOf(ev("approval.requested", {}))).toBe("you");
  expect(
    stepSummary(ev("agent.handoff", { from: "Triage agent", to: "Evidence specialist" })),
  ).toBe("Triage agent → Evidence specialist");
  expect(
    stepSummary(
      ev("tool.result", { result: { items: [{ id: 4 }, { id: 9 }] } }),
    ),
  ).toBe("2 records returned: #4 #9");
  expect(
    stepSummary(
      ev("model.response", {
        output: [{ type: "function_call", name: "q", arguments: "{}" }],
      }),
    ),
  ).toBe("Chose a tool: q({})");
});
it("opens a framework page from the gallery and keeps an unguarded framework locked", async () => {
  render(<HarnessApp />);
  fireEvent.click(await screen.findByRole("tab", { name: /Frameworks/ }));
  const cards = screen.getAllByRole("button", { name: /Claude Agent SDK|Pydantic AI|Deep Agents|Hermes Agent/ });
  expect(cards.length).toBeGreaterThanOrEqual(4);
  fireEvent.click(screen.getByRole("button", { name: /^Claude Agent SDK/ }));
  expect(
    await screen.findByRole("heading", { level: 2, name: "Claude Agent SDK" }),
  ).toBeVisible();
  expect(screen.getByText("Covered by the spending guard")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open in Live run" })).toBeNull();
  expect(window.location.hash).toBe("#frameworks/claude");
  expect(calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
});
it("lists a framework's documented surface with search and a Relay-only filter", async () => {
  render(<HarnessApp />);
  fireEvent.click(await screen.findByRole("tab", { name: /Frameworks/ }));
  fireEvent.click(screen.getByRole("button", { name: /^OpenAI Agents SDK/ }));
  expect(
    await screen.findByRole("heading", { level: 3, name: "From the official docs" }),
  ).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox", { name: /Search OpenAI Agents SDK docs/ }), {
    target: { value: "RunState" },
  });
  expect(screen.getAllByText("RunState").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("checkbox", { name: "Only what Relay uses" }));
  expect(screen.queryByText("prompt")).toBeNull();
  expect(calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
});
it("places every documented capability in reference and SOC blueprints", async () => {
  render(<HarnessApp />);
  fireEvent.click(await screen.findByRole("tab", { name: /Frameworks/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Google ADK/ }));
  expect(
    await screen.findByRole("heading", { level: 3, name: "Reference architecture blueprint" }),
  ).toBeVisible();
  expect(screen.getByText(/All 78 documented Google ADK capabilities/)).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "SOC use case" }));
  expect(screen.getByRole("heading", { level: 3, name: "SOC platform blueprint" })).toBeVisible();
  expect(screen.getByRole("list", { name: "SOC end-to-end flow" })).toBeVisible();
  expect(calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
});

it("walks the under-the-hood deep dive chapter by chapter", async () => {
  render(<HarnessApp />);
  fireEvent.click(await screen.findByRole("tab", { name: /Frameworks/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Google ADK/ }));
  expect(await screen.findByRole("heading", { level: 3, name: "How Google ADK really works" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 4, name: "Yield, commit, resume" })).toBeVisible();
  const chapters = screen.getByRole("navigation", { name: "Google ADK deep-dive chapters" });
  fireEvent.click(within(chapters).getByRole("button", { name: /Dirty reads and partial events/ }));
  expect(screen.getByRole("heading", { level: 4, name: "Dirty reads and partial events" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next diagram step" }));
  expect(document.querySelector(".dd-count")?.textContent).toMatch(/^2\//);
  expect(screen.getByText("In a SOC")).toBeVisible();
  expect(calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
});
