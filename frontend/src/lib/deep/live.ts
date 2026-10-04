/*
 * Maps recorded Live run events onto the "Under the hood" chapter that explains
 * the mechanism behind them, so a real run can be read against the diagrams.
 */
import type { Trace } from "../types";

interface Rule {
  kinds: string[];
  /** optional match on payload.event (framework lifecycle names) */
  event?: RegExp;
  chapter: string;
}

const rules: Record<string, Rule[]> = {
  openai: [
    { kinds: ["guardrail.checked", "guardrail.blocked"], chapter: "guardrails" },
    { kinds: ["approval.requested", "sdk.approval.resumed"], chapter: "approvals" },
    { kinds: ["agent.handoff", "agent.delegated", "agent.returned"], chapter: "handoffs" },
    { kinds: ["sdk.tool.started", "sdk.tool.finished"], chapter: "tool-use" },
    { kinds: ["session.context", "session.loaded", "session.staged", "session.committed"], chapter: "sessions" },
    { kinds: ["harness.configured"], chapter: "context" },
    {
      kinds: ["model.request", "model.response", "tool.started", "tool.result", "tool.failed", "tool.validation_error", "orchestration.limit"],
      chapter: "loop",
    },
  ],
  claude: [
    { kinds: ["sdk.system"], chapter: "transport" },
    { kinds: ["sdk.tool_use", "permission.denied", "approval.requested"], chapter: "permissions" },
    { kinds: ["sdk.hook"], chapter: "hooks" },
    { kinds: ["tool.started", "tool.result", "tool.failed"], chapter: "sdk-mcp" },
    { kinds: ["agent.delegated", "agent.lifecycle"], chapter: "subagents" },
    { kinds: ["sdk.result", "budget.settled", "budget.reserved"], chapter: "result" },
  ],
  pydantic: [
    { kinds: ["adapter.lifecycle"], event: /^session\./, chapter: "history" },
    { kinds: ["adapter.lifecycle", "tool.started", "tool.result", "tool.failed"], chapter: "graph" },
    { kinds: ["sdk.result", "budget.reserved", "budget.settled"], chapter: "limits" },
    { kinds: ["approval.requested"], chapter: "deferred" },
  ],
  deepagents: [
    { kinds: ["adapter.plan"], chapter: "todos" },
    { kinds: ["agent.delegated"], chapter: "subagents" },
    { kinds: ["tool.denied"], chapter: "hooks" },
    { kinds: ["adapter.lifecycle"], event: /^session\./, chapter: "hitl" },
    { kinds: ["approval.requested"], chapter: "hitl" },
    { kinds: ["tool.started", "tool.result", "tool.failed", "sdk.result", "budget.reserved", "budget.settled"], chapter: "onion" },
  ],
  pi: [
    { kinds: ["adapter.lifecycle"], event: /^session\./, chapter: "tree" },
    { kinds: ["adapter.lifecycle"], event: /^tool_execution|auto_compaction/, chapter: "events" },
    { kinds: ["adapter.lifecycle", "tool.started", "tool.result", "tool.failed", "sdk.result"], chapter: "loop" },
  ],
};

/** Which chapter explains this recorded event, if any. */
export function chapterFor(runtime: string, event: Trace): string | undefined {
  const ev = String((event.payload as Record<string, unknown>)?.event ?? "");
  return rules[runtime]?.find((r) => r.kinds.includes(event.kind) && (!r.event || r.event.test(ev)))?.chapter;
}

/** Group a run's events by the chapter that explains them, preserving order. */
export function runDigest(runtime: string, trace: Trace[]): Map<string, Trace[]> {
  const out = new Map<string, Trace[]>();
  for (const t of trace) {
    const c = chapterFor(runtime, t);
    if (!c) continue;
    if (!out.has(c)) out.set(c, []);
    out.get(c)!.push(t);
  }
  return out;
}

/** Hash that opens a framework page on a specific chapter. */
export const chapterHash = (runtime: string, chapter: string) => `#frameworks/${runtime}/deep/${chapter}`;
