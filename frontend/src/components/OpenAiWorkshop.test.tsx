// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OpenAiWorkshop } from "./OpenAiWorkshop";
import { Settings } from "./Settings";
import { currentRun, workshopConfig } from "../lib/openaiWorkshop";
import type { Workspace } from "../useWorkspace";
import type { Trace } from "../lib/types";

const tools = [
  { name: "query_case_evidence", description: "Read", effect: "read" },
  { name: "get_event", description: "Read one", effect: "read" },
];
function state(withSession = false): Workspace {
  return {
    adapters: [
      {
        id: "openai",
        name: "OpenAI",
        available: true,
        trial_guard: true,
        default_model: "nano-fixture",
        features: [],
      },
    ],
    deployment: {
      trial: { enabled: true, blocked: false, remaining_usd: 4.3 },
    },
    cases: [{ id: "c1", title: "Case" }],
    caseId: "c1",
    sessions: [],
    tools,
    busy: false,
    data: withSession
      ? {
          session: {
            id: "s1",
            config: workshopConfig("nano-fixture", "loop", tools),
          },
          trace: [],
        }
      : null,
    newSession: vi.fn().mockResolvedValue({ id: "s1" }),
    send: vi.fn().mockResolvedValue(undefined),
    refreshRegistry: vi.fn(),
    setView: vi.fn(),
    setNotice: vi.fn(),
    safe: async (fn: () => Promise<unknown>) => fn(),
  } as unknown as Workspace;
}
const evt = (seq: number, kind: string, payload = {}): Trace => ({
  seq,
  kind,
  payload,
  created_at: "2026-10-01",
});
afterEach(cleanup);
describe("guided OpenAI exercises", () => {
  it("does not call the model while preparing a bounded session", async () => {
    const w = state();
    render(<OpenAiWorkshop w={w} />);
    expect(
      screen.queryByRole("button", { name: "Read three records" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start exercise" }));
    await waitFor(() =>
      expect(w.newSession).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: "openai",
          permission: "read_only",
          max_turns: 3,
          max_output_tokens: 700,
          disabled_tools: ["get_event"],
        }),
      ),
    );
    expect(w.send).not.toHaveBeenCalled();
  });
  it("runs only after an explicit click with a matching bounded config", async () => {
    const w = state(true);
    render(<OpenAiWorkshop w={w} />);
    expect(w.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Read three records" }));
    await waitFor(() => expect(w.send).toHaveBeenCalledOnce());
    expect(w.send).toHaveBeenCalledWith(expect.stringContaining('"limit":3'));
  });
  it("shows preparation failures inline without sending", async () => {
    const w = state();
    vi.mocked(w.newSession).mockRejectedValue(
      new Error("Session configuration rejected"),
    );
    render(<OpenAiWorkshop w={w} />);
    fireEvent.click(screen.getByRole("button", { name: "Start exercise" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session configuration rejected",
    );
    expect(w.send).not.toHaveBeenCalled();
  });
  it("requires the shared guard and never silently uses an uncapped runtime", () => {
    const w = state(true);
    w.deployment!.trial!.enabled = false;
    render(<OpenAiWorkshop w={w} />);
    expect(
      screen.getByRole("button", { name: "Read three records" }),
    ).toBeDisabled();
    expect(screen.getByText(/will not run uncapped/)).toBeVisible();
  });
  it("does not infer success from an earlier successful run", () => {
    const trace = [
      evt(1, "message.user"),
      evt(2, "run.completed"),
      evt(3, "message.user"),
      evt(4, "run.failed", { message: "limit must be 1–25" }),
    ];
    expect(currentRun(trace).map((t) => t.seq)).toEqual([3, 4]);
    const w = state(true);
    w.data!.trace = trace;
    render(<OpenAiWorkshop w={w} />);
    expect(screen.getByRole("alert")).toHaveTextContent("limit must be 1–25");
    expect(screen.getByText("This run stopped")).toBeVisible();
  });
  it("requires a completed session for a follow-up", () => {
    render(<OpenAiWorkshop w={state(true)} />);
    fireEvent.change(screen.getByLabelText("OpenAI lesson"), {
      target: { value: "continuity" },
    });
    expect(
      screen.getByRole("button", { name: "Ask the follow-up" }),
    ).toBeDisabled();
  });
  it("prepares a fresh typed configuration for the handover", async () => {
    const w = state(true);
    render(<OpenAiWorkshop w={w} />);
    fireEvent.change(screen.getByLabelText("OpenAI lesson"), {
      target: { value: "structured" },
    });
    expect(
      screen.queryByRole("button", { name: "Create the handover" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start exercise" }));
    await waitFor(() =>
      expect(w.newSession).toHaveBeenCalledWith(
        expect.objectContaining({ structured_output: true }),
      ),
    );
  });
  it("keeps technical details closed and shows no empty results", () => {
    const { container } = render(<OpenAiWorkshop w={state()} />);
    expect(screen.getByText("Is this worth escalating?")).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Exercise results" }),
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll("details[open]")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Start exercise" }),
    ).toBeEnabled();
  });
  it("keeps session-creation errors inside the configuration dialog", async () => {
    const w = state();
    vi.mocked(w.newSession).mockRejectedValue(new Error("Incorrect model"));
    render(<Settings w={w} initialRuntime="openai" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect model",
    );
  });
});
