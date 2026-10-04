import type { Trace } from "./types";
export const startPrompt =
  'Investigate this case by calling query_case_evidence once with {"limit":3,"search":""}. Summarize only the returned evidence. Cite record IDs, distinguish observations from hypotheses, state a limitation and recommend one next investigative step. Do not query more records or perform writes.';
export const followPrompt =
  "Using only the evidence already in this session, explain one alternative explanation and what evidence would distinguish it. Cite the previous record IDs. Do not call any tools or imply you collected new evidence.";
export const stages = ["Source", "Agent", "Loop", "Result"] as const;
export type Stage = (typeof stages)[number];
export function eventGuide(
  event: Trace,
): { title: string; owner: string; meaning: string; code: string } | null {
  const p = event.payload;
  const guides: Record<string, [string, string, string, string]> = {
    "agent.started": [
      String(p.agent) + " active",
      "SDK",
      "This agent is entering the runner. Agent activation does not itself prove a model call occurred.",
      "RunHooks.on_agent_start(context, agent)",
    ],
    "agent.finished": [
      String(p.agent) + " finished",
      "SDK",
      "This agent produced an output. A specialist output may return to a manager rather than to the user.",
      "RunHooks.on_agent_end(context, agent, output)",
    ],
    "agent.delegated": [
      "Manager delegates to specialist",
      "SDK",
      "The specialist runs as a tool with its own input. The manager keeps responsibility for the final answer.",
      "specialist.as_tool(on_stream=..., max_turns=2)",
    ],
    "agent.returned": [
      "Specialist returns to manager",
      "SDK",
      "The specialist's answer becomes a tool result in the manager's context. The manager can now synthesize its final answer.",
      "agent-as-tool result → manager function_call_output",
    ],
    "agent.handoff": [
      "Control transfers to specialist",
      "SDK",
      "Unlike delegation, this transfers the active agent. The specialist continues the conversation and owns the final answer.",
      "handoff(specialist) → RunHooks.on_handoff(...)",
    ],
    "sdk.tool.started": [
      String(p.agent) + " invokes " + String(p.tool),
      "SDK",
      "The SDK is invoking this agent's tool. Application permission and case checks still apply inside the callback.",
      "RunHooks.on_tool_start(context, agent, tool)",
    ],
    "sdk.tool.finished": [
      String(p.tool) + " returned",
      "SDK",
      "The registered tool completed. Its result can be included in the next model request.",
      "RunHooks.on_tool_end(context, agent, tool, result)",
    ],
    "guardrail.checked": [
      String(p.phase) + " guardrail · " + (p.passed ? "passed" : "blocked"),
      "SDK guardrail",
      "Inspect the exact deterministic rule below. The input rule is a narrow word policy; the output rule checks returned citation IDs, not whether every claim is true.",
      "GuardrailFunctionOutput(tripwire_triggered=...)",
    ],
    "guardrail.blocked": [
      "Guardrail tripwire stopped the run",
      "SDK",
      "No final findings were committed. An output guardrail runs after the model call, so it does not undo its cost or hide public response receipts.",
      "InputGuardrailTripwireTriggered / OutputGuardrailTripwireTriggered",
    ],
    "approval.requested": [
      "Waiting for your approval",
      "You",
      "The native SDK interrupted before executing the proposed query. Approve or deny the exact arguments shown above.",
      "FunctionTool(needs_approval=True) → result.interruptions",
    ],
    "sdk.approval.resumed": [
      "Approval decision · " + String(p.decision),
      "SDK",
      "The same native RunState is resumed. Approval permits execution; denial returns a rejection to the model without executing the tool.",
      "RunState.approve / reject → Runner.run_streamed(input=state)",
    ],
    "session.context": [
      "Session context before this run",
      "Application",
      "Compare retained conversation items with the actual model request. Local Python context is not automatically sent to the model.",
      "session.get_items() or result.to_input_list()",
    ],
    "session.loaded": [
      "SDK loads session items",
      "SDK session",
      "The native Session protocol loaded prior conversation items. This is history retrieval, not a new model call.",
      "Session.get_items()",
    ],
    "session.staged": [
      "SDK stages conversation items",
      "SDK session",
      "The SDK added items to this run's staged session. Relay only commits them for future continuation after a successful final result.",
      "Session.add_items(items)",
    ],
    "session.committed": [
      "Successful history saved",
      "Application",
      "These items and the last active agent are retained for the next follow-up. Failed runs do not replace the last successful continuation.",
      "persist successful SDK input history + last_agent",
    ],
    "orchestration.limit": [
      "Shared call limit reached",
      "Application",
      "All agents and approval resumes share one model-call counter and one monetary allowance.",
      "shared counter → stop before another model request",
    ],
    "message.user": [
      "Investigation requested",
      "You",
      "This is the user message for this run. It is not a tool result or a threat verdict.",
      "Runner.run_streamed(agent, input=items, max_turns=limit)",
    ],
    "harness.configured": [
      "Agent contract assembled",
      "Application",
      "Instructions, allowed tools, output format and limits are attached before the SDK starts. Inspect the actual contract below.",
      "Agent(instructions=SYSTEM, tools=tools, output_type=output_type)",
    ],
    "model.request": [
      `Model call ${p.call ?? ""} · context sent`,
      "SDK → OpenAI",
      "The SDK sends the visible conversation and tool schemas to the model. On a later call, look for function_call_output: that is how evidence re-enters the loop. This is public I/O, not private reasoning.",
      "Model.stream_response(input=items, tools=tools, ...)",
    ],
    "model.response": [
      `Model call ${p.call ?? ""} · response received`,
      "OpenAI → SDK",
      "A function_call requests a tool; a message may contain the answer. The model does not execute your Python function itself.",
      "response.output → function_call or message",
    ],
    "tool.started": [
      `Execute ${p.tool ?? p.name ?? "tool"}`,
      "Application",
      "The SDK invokes the registered callback with JSON arguments. Relay checks permissions and restricts this query to the selected case.",
      "FunctionTool(on_invoke_tool=handler) → Engine.call(...)",
    ],
    "tool.result": [
      "Evidence returned to the loop",
      "Database → SDK",
      "These are the records the tool actually returned. Their IDs can support citations. A successful tool result does not mean the investigation is complete.",
      "tool result → function_call_output → next model request",
    ],
    "tool.validation_error": [
      "Tool arguments rejected",
      "Application",
      "Invalid arguments are returned as an error. The model may correct them within the remaining turn and budget limits.",
      "validate arguments → recoverable tool error",
    ],
    "tool.failed": [
      "Tool execution failed",
      "Application",
      "The requested action did not return successful evidence. Inspect the error before retrying.",
      "Engine.call(...) → error",
    ],
    "message.assistant": [
      "Final answer produced",
      "OpenAI → You",
      "This is the model’s interpretation. Verify its claims against the returned evidence; formatted output alone cannot establish truth.",
      "result.final_output",
    ],
    "budget.meter": [
      "Metering proxy opened",
      "Application",
      "Relay started a loopback proxy for this run. The framework only gets a one-run token and a local URL; the real Anthropic key stays in Relay.",
      "ANTHROPIC_BASE_URL=http://127.0.0.1:<port>",
    ],
    "budget.reserved": [
      "Budget reserved · $" + Number(p.reserved_usd ?? 0).toFixed(4),
      "Application",
      "Before the provider is called, Relay holds the worst-case cost of this request in its ledger. If the allowance cannot cover it, nothing is sent.",
      p.provider === "anthropic" ? "MeterProxy → AnthropicBudget.reserve()" : "GuardedModel.reserve() → TrialBudget.reserve()",
    ],
    "budget.settled": [
      "Cost settled · $" + Number(p.cost_usd ?? 0).toFixed(5),
      "Application",
      "The provider's usage receipt replaced the hold with the exact cost. Unused reservation returns to the allowance.",
      p.provider === "anthropic" ? "usage from message_start + message_delta (cumulative)" : "response.completed usage → TrialBudget.settle()",
    ],
    "budget.released": [
      "Hold released · provider error",
      "Application",
      "The provider answered with an HTTP error before producing output, which is not billed, so the hold was released at $0.",
      "HTTP 4xx/5xx → AnthropicBudget.release()",
    ],
    "budget.retained": [
      "Hold kept · outcome unknown",
      "Application",
      "The stream broke or arrived without a usage receipt. Relay keeps the whole reservation because it cannot prove what was billed.",
      "AnthropicBudget.retain()",
    ],
    "budget.halted": [
      "Allowance halted",
      "Application",
      "The usage receipt was missing, null or implausible, so Relay kept the whole hold and stopped all further paid calls until an operator reviews the ledger.",
      "AnthropicBudget.settle() → halt()",
    ],
    "budget.blocked": [
      "Request blocked before the provider",
      "Application",
      "The meter refused this request (wrong model, paid server tool, thinking, or no allowance left). Nothing reached the provider.",
      "MeterProxy policy → HTTP 400/403",
    ],
    "sdk.tool_use": [
      "Model asks for " + String(p.tool ?? "a tool"),
      "SDK",
      "The model emitted a tool-use block. Before it runs, Claude's permission chain (hooks, rules, mode, callback) decides.",
      "ToolUseBlock(id, name, input)",
    ],
    "permission.denied": [
      "Permission denied · " + String(p.tool ?? ""),
      "SDK",
      "A hook or permission callback refused this tool. The model receives the refusal as the tool result and must continue without it.",
      "PreToolUse → permissionDecision: deny",
    ],
    "adapter.lifecycle": [
      String(p.runtime ?? "Framework") + " · " + String(p.event ?? "event"),
      "SDK",
      "A lifecycle event from the framework's own loop (session created or resumed, turn start or end, tool execution).",
      "framework event stream",
    ],
    "adapter.plan": [
      "Plan updated (write_todos)",
      "SDK",
      "Deep Agents wrote its to-do list into graph state. Planning is a tool call, so it shows up like any other step.",
      "TodoListMiddleware → write_todos",
    ],
    "sdk.result": [
      "Framework returned its result",
      "SDK",
      "The framework's loop ended and reported usage. For metered runs the authoritative cost is in the budget events.",
      "ResultMessage / RunResult / final state",
    ],
    "run.completed": [
      "Run completed · session saved",
      "Application",
      "The run ended successfully. A follow-up can reuse the successful SDK input history. A new investigation starts a separate session.",
      "result.to_input_list() → persisted session state",
    ],
    "run.failed": [
      "Run failed",
      "Application",
      "The run did not complete. Earlier requests may still incur cost. Inspect the error and saved events before deciding to retry.",
      "exception → run.failed",
    ],
    "run.cancelled": [
      "Run interrupted",
      "Application",
      "The run stopped. Closing or backgrounding a mobile connection can interrupt streaming. Refresh to inspect recorded state before retrying.",
      "cancel → run.cancelled",
    ],
  };
  const guide = guides[event.kind];
  return guide
    ? { title: guide[0], owner: guide[1], meaning: guide[2], code: guide[3] }
    : null;
}
export function publicSteps(trace: Trace[]) {
  return trace.filter((t) => eventGuide(t));
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function evidenceIds(trace: Trace[]): number[] {
  return [
    ...new Set(
      trace
        .filter((t) => t.kind === "tool.result")
        .flatMap((t) => {
          const result = object(t.payload.result);
          return Array.isArray(result.items)
            ? result.items
                .map((r) => Number(object(r).id))
                .filter(Number.isFinite)
            : Number.isFinite(Number(result.id))
              ? [Number(result.id)]
              : [];
        }),
    ),
  ];
}

/* ---- Workbench view model: lanes, summaries and the expected path ---- */
export const lanes = ["you", "app", "sdk", "model", "data"] as const;
export type Lane = (typeof lanes)[number];
export const laneLabel: Record<Lane, string> = {
  you: "You",
  app: "Your app",
  sdk: "SDK runner",
  model: "Model",
  data: "Evidence",
};
export const laneRole: Record<Lane, string> = {
  you: "Writes the request, approves tools and judges the answer.",
  app: "Relay code: assembles the contract, runs tool callbacks, enforces limits and saves state.",
  sdk: "The Agents SDK: runs agents, delegations, handoffs, guardrails and its session protocol.",
  model: "Reads the context, then proposes a tool call or writes the answer.",
  data: "Read-only case records. Returned only when a tool asks for them.",
};
const sdkKinds = new Set([
  "agent.started",
  "agent.finished",
  "agent.delegated",
  "agent.returned",
  "agent.handoff",
  "sdk.tool.started",
  "sdk.tool.finished",
  "guardrail.checked",
  "guardrail.blocked",
  "sdk.approval.resumed",
  "session.loaded",
  "session.staged",
  "sdk.tool_use",
  "permission.denied",
  "adapter.lifecycle",
  "adapter.plan",
  "sdk.result",
]);
export function laneOf(event: Trace): Lane {
  if (sdkKinds.has(event.kind)) return "sdk";
  switch (event.kind) {
    case "message.user":
    case "approval.requested":
      return "you";
    case "model.request":
    case "model.response":
    case "message.assistant":
      return "model";
    case "tool.result":
      return "data";
    default:
      return "app";
  }
}
const clip = (text: string, n = 110) =>
  text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text;
function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const o = object(value);
  return Array.isArray(o.items) ? o.items : [];
}
/** True when a captured model request carries tool output back into context. */
export function carriesToolOutput(event: Trace) {
  if (event.kind !== "model.request") return false;
  const input = event.payload.input;
  const text = typeof input === "string" ? input : JSON.stringify(input ?? "");
  return text.includes("function_call_output");
}
/** One line of real content for a step, derived only from its payload. */
export function stepSummary(event: Trace): string {
  const p = event.payload;
  const agent =
    p.agent && p.agent !== "Relay SOC analyst" ? String(p.agent) + ": " : "";
  const base = summaryFor(event);
  return ["model.request", "model.response"].includes(event.kind) ? agent + base : base;
}
function summaryFor(event: Trace): string {
  const p = event.payload;
  switch (event.kind) {
    case "agent.handoff":
    case "agent.delegated":
    case "agent.returned":
      return p.from || p.to
        ? `${String(p.from ?? "?")} → ${String(p.to ?? "?")}`
        : String(p.agent ?? "");
    case "agent.started":
    case "agent.finished":
      return String(p.agent ?? "");
    case "sdk.tool.started":
    case "sdk.tool.finished":
      return `${String(p.agent ?? "agent")} · ${String(p.tool ?? "tool")}`;
    case "guardrail.checked":
      return `${String(p.name ?? p.phase ?? "Rule")}: ${p.passed ? "passed" : "tripwire triggered"}`;
    case "guardrail.blocked":
      return `Stopped at the ${String(p.phase ?? "")} guardrail; no findings released`;
    case "approval.requested":
      return clip(`${String(p.tool ?? "tool")}(${JSON.stringify(p.arguments ?? {})}) is waiting for you`);
    case "sdk.approval.resumed":
      return `Decision: ${String(p.decision ?? "")}`;
    case "session.context":
      return `${String(p.retained_items ?? 0)} retained items before this run`;
    case "session.loaded":
      return `${String(p.items ?? 0)} prior items loaded`;
    case "session.staged":
      return `${String(p.added ?? 0)} added, ${String(p.total ?? "?")} staged (not yet saved)`;
    case "session.committed":
      return `${String(p.items ?? "?")} items saved; next owner ${String(p.last_agent ?? "")}`;
    case "orchestration.limit":
      return "No further model requests in this run";
    case "message.assistant": {
      const text = String(p.text || "");
      try {
        const o = object(JSON.parse(text));
        if (Array.isArray(o.observations)) {
          const n = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0);
          const ids = Array.isArray(o.evidence_ids) ? (o.evidence_ids as unknown[]).map((i) => "#" + String(i)).join(" ") : "";
          return `Structured findings: ${n("observations")} observations, ${n("hypotheses")} hypotheses${ids ? ", cites " + ids : ""}`;
        }
      } catch {
        /* Plain-text answer. */
      }
      return clip(text.replace(/\s+/g, " "));
    }
    case "message.user":
      return clip(String(p.text || "").replace(/\s+/g, " "));
    case "harness.configured":
      return `Model ${String(p.model ?? "—")}, limits and tool list attached`;
    case "model.request": {
      const tools = Array.isArray(p.tools) ? p.tools.length : 0;
      return `${String(p.input_items ?? "?")} input items, ${tools} tool schema${tools === 1 ? "" : "s"}${carriesToolOutput(event) ? ", including tool output" : ""}`;
    }
    case "model.response": {
      const out = items(object(p.output).excerpt ? [] : p.output).map(object);
      const call = out.find((o) => o.type === "function_call");
      const usage = object(p.usage);
      const tokens =
        usage.input_tokens != null
          ? ` (${String(usage.input_tokens)} in / ${String(usage.output_tokens)} out tokens)`
          : "";
      if (call)
        return clip(`Chose a tool: ${String(call.name)}(${String(call.arguments ?? "")})`) + tokens;
      if (out.some((o) => o.type === "message")) return "Wrote a message" + tokens;
      return "Response received" + tokens;
    }
    case "tool.started":
      return clip(`${String(p.tool ?? p.name ?? "tool")}(${JSON.stringify(p.arguments ?? {})})`);
    case "tool.result": {
      const r = object(p.result);
      const ids = items(r)
        .map((v) => object(v).id)
        .filter((v) => v !== undefined);
      return ids.length
        ? `${ids.length} record${ids.length === 1 ? "" : "s"} returned: ${ids.map((i) => "#" + String(i)).join(" ")}`
        : clip(JSON.stringify(p.result ?? ""));
    }
    case "tool.validation_error":
    case "tool.failed":
    case "run.failed":
    case "run.cancelled":
      return clip(String(p.message || p.error || "No message recorded"));
    case "run.completed":
      return "Session saved; a follow-up can continue it";
    default:
      return "";
  }
}
/** The path the default request is designed to take. Shown before any run, never as evidence. */
export const expectedPath: { lane: Lane; title: string; note: string; call?: number }[] = [
  { lane: "you", title: "Investigation requested", note: "Your request starts the run" },
  { lane: "app", title: "Agent contract assembled", note: "Instructions, one tool, limits" },
  { lane: "model", title: "Model call 1 · context sent", note: "Request plus tool schema", call: 1 },
  { lane: "model", title: "Model call 1 · response received", note: "Likely a function_call", call: 1 },
  { lane: "app", title: "Execute query_case_evidence", note: "Your code runs the tool" },
  { lane: "data", title: "Evidence returned to the loop", note: "Three records, read-only" },
  { lane: "model", title: "Model call 2 · context sent", note: "Now includes the tool output", call: 2 },
  { lane: "model", title: "Model call 2 · response received", note: "Likely the findings", call: 2 },
  { lane: "model", title: "Final answer produced", note: "Structured findings" },
  { lane: "app", title: "Run completed · session saved", note: "Ready for a follow-up" },
];
