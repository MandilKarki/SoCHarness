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
    "message.user": [
      "Investigation requested",
      "You",
      "This is the user message for this run. It is not a tool result or a threat verdict.",
      "Runner.run_streamed(agent, input=items, max_turns=3)",
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
            : [];
        }),
    ),
  ];
}
