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
