// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SdkLab } from "./SdkLab";
import { eventLayer, learningTrace, lessons } from "../lib/sdkLearning";
import type { Workspace } from "../useWorkspace";
import { defaultConfig, type Trace } from "../lib/types";

function renderReference(ui: Parameters<typeof render>[0]) {
  const result = render(ui);
  fireEvent.click(
    screen.getByText(
      "Advanced reference · diagrams, SDKs and capability coverage",
    ),
  );
  return result;
}
const evt = (seq: number, kind: string): Trace => ({
  seq,
  kind,
  created_at: "2026-10-01T12:00:00Z",
  payload: { text: "Recorded content" },
});
function fixture(
  runtime = "openai",
  trace = [evt(1, "message.user"), evt(2, "run.completed")],
) {
  return {
    inventory: {
      frameworks: ["openai", "claude"].map((id) => ({
        id,
        name: id,
        pinned_version: "0.test",
        version: "0.test",
        package: id,
        version_state: "matches pin",
      })),
      rows: ["loop", "sessions", "subagents"].map((id) => ({
        id,
        label: id,
        category: "Execution",
        cells: {
          openai: {
            status: id === "subagents" ? "gap" : "native",
            upstream_api: "Runner.run_streamed",
            note: "Mapped fixture",
            mapping_id: "openai@0.test:" + id,
          },
        },
      })),
    },
    data: {
      session: {
        id: "s1",
        case_id: "c1",
        config: { ...defaultConfig, runtime },
      },
      trace,
    },
    caseId: "c1",
    cases: [{ id: "c1", title: "Fixture case" }],
    sessions: [],
    busy: false,
    setView: vi.fn(),
    newSession: vi.fn(),
    send: vi.fn(),
    tool: vi.fn(),
    safe: vi.fn(),
    selectCase: vi.fn(),
    loadSession: vi.fn(),
  } as unknown as Workspace;
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("SDK learning lab", () => {
  it("teaches without sending prompts, creating sessions or executing tools", () => {
    const w = fixture(),
      configure = vi.fn(),
      draft = vi.fn();
    renderReference(<SdkLab w={w} configure={configure} draft={draft} />);
    expect(screen.getByText("Illustration, not a live run.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next learning step" }));
    expect(screen.getByText("Build a bounded context")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reveal explanation" }));
    expect(screen.getByText(/No. Inspect retained context/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(w.send).not.toHaveBeenCalled();
    expect(w.newSession).not.toHaveBeenCalled();
    expect(w.tool).not.toHaveBeenCalled();
    expect(configure).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
  });
  it("plays to the end then stops, and can restart", () => {
    vi.useFakeTimers();
    renderReference(
      <SdkLab w={fixture()} configure={vi.fn()} draft={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    for (let n = 0; n < lessons.length + 1; n++)
      act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByText("Close the loop with receipts")).toBeVisible();
    expect(screen.getByRole("button", { name: "Play" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Restart playback" }));
    expect(screen.getByText("A question enters the system")).toBeVisible();
  });
  it("does not present another SDK's receipts as matching evidence", () => {
    renderReference(
      <SdkLab w={fixture("claude")} configure={vi.fn()} draft={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Session evidence" }));
    expect(screen.getByText("Select a matching SDK session")).toBeVisible();
    expect(screen.queryByText("run.completed")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Learning SDK"), {
      target: { value: "claude" },
    });
    expect(
      screen.getByRole("heading", { name: "run.completed" }),
    ).toBeVisible();
  });
  it("follows new receipts and pauses following when inspecting older evidence", () => {
    const w = fixture(),
      props = { configure: vi.fn(), draft: vi.fn() };
    const ui = renderReference(<SdkLab w={w} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Session evidence" }));
    expect(
      screen.getByRole("heading", { name: "run.completed" }),
    ).toBeVisible();
    const next = {
      ...w,
      busy: true,
      data: { ...w.data!, trace: [...w.data!.trace, evt(3, "tool.failed")] },
    };
    ui.rerender(<SdkLab w={next} {...props} />);
    expect(screen.getByRole("heading", { name: "tool.failed" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Previous learning step" }),
    );
    expect(screen.getByLabelText("Follow new events")).not.toBeChecked();
    ui.rerender(
      <SdkLab
        w={{
          ...next,
          data: {
            ...next.data,
            trace: [...next.data.trace, evt(4, "run.failed")],
          },
        }}
        {...props}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "run.completed" }),
    ).toBeVisible();
  });
  it("retains unknown and failure receipts without inventing a stage", () => {
    expect(eventLayer(evt(1, "unknown.internal"))).toBeNull();
    expect(eventLayer(evt(2, "tool.denied"))).toBe("server");
    expect(
      learningTrace([
        evt(1, "message.delta"),
        evt(2, "message.delta"),
        evt(3, "run.failed"),
      ]).map((e) => e.seq),
    ).toEqual([2, 3]);
  });
  it("uses manual steps under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderReference(
      <SdkLab w={fixture()} configure={vi.fn()} draft={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next learning step" }));
    expect(screen.getByText("Build a bounded context")).toBeVisible();
  });
  it("keeps missing capabilities explicit and separate from the current lesson", () => {
    renderReference(
      <SdkLab w={fixture()} configure={vi.fn()} draft={vi.fn()} />,
    );
    fireEvent.change(
      screen.getByLabelText("Capability implementation filter"),
      { target: { value: "gap" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /subagents/ }));
    expect(screen.getByText("A question enters the system")).toBeVisible();
    expect(screen.getByText("openai@0.test:subagents")).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Current learning step" }),
      ).getByText("openai@0.test:sessions"),
    ).toBeVisible();
  });
  it("only prepares configuration or drafts on explicit actions", () => {
    const configure = vi.fn(),
      draft = vi.fn(),
      w = fixture();
    renderReference(<SdkLab w={w} configure={configure} draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure this SDK" }));
    expect(configure).toHaveBeenCalledWith("openai");
    fireEvent.click(
      screen.getByRole("button", { name: "Draft a bounded investigation" }),
    );
    expect(draft).toHaveBeenCalledOnce();
    expect(w.send).not.toHaveBeenCalled();
  });
});
