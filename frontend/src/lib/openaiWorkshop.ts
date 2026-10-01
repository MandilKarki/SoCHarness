import { defaultConfig, type Config, type Tool, type Trace } from "./types";
export const missions = [
  {
    id: "loop",
    title: "1. Read three records",
    goal: "Ask your assistant to read three records. Check which facts support its answer.",
    prompt:
      'Call query_case_evidence exactly once with {"limit":3,"search":""}. Then summarize only the returned records in at most 150 words. Cite their record IDs, separate observations from hypotheses, and state one limitation. Do not request more evidence or perform writes.',
  },
  {
    id: "continuity",
    title: "2. Ask a follow-up",
    goal: "Ask a follow-up without reading new records. See what the assistant remembers.",
    prompt:
      "Using the records already returned in this session, state one observation and one uncertainty. Cite the prior record IDs. Do not call a tool or claim you queried new evidence.",
  },
  {
    id: "structured",
    title: "3. Write a handover",
    goal: "Create a structured handover. Check both its format and whether the evidence supports it.",
    prompt:
      'Call query_case_evidence exactly once with {"limit":3,"search":""}. Return the configured findings schema using only those records. Keep observations, hypotheses and next_steps short, cite evidence_ids, and state limitations. No other queries or writes.',
  },
] as const;
export type Mission = (typeof missions)[number]["id"];
export function workshopConfig(
  model: string,
  mission: Mission,
  tools: Tool[],
): Config {
  return {
    ...defaultConfig,
    runtime: "openai",
    model,
    permission: "read_only",
    max_turns: 3,
    max_output_tokens: 700,
    structured_output: mission === "structured",
    disabled_tools: tools
      .filter((t) => t.name !== "query_case_evidence")
      .map((t) => t.name),
  };
}
export function currentRun(trace: Trace[]): Trace[] {
  let start = -1;
  trace.forEach((t, i) => {
    if (t.kind === "message.user") start = i;
  });
  return start < 0 ? [] : trace.slice(start);
}
export const observations = [
  {
    id: "prompt",
    title: "Your input",
    kinds: ["message.user"],
    why: "Your prompt starts a run, not a guaranteed sequence of actions. The model still chooses its next output.",
    code: "items.append({'role': 'user', 'content': turn_prompt(...)})",
  },
  {
    id: "runner",
    title: "SDK orchestration",
    kinds: ["run.started", "adapter.lifecycle"],
    why: "Runner owns the model/tool loop. An application session can contain several runs, and each run can make several model requests.",
    code: "Runner.run_streamed(agent, input=items, max_turns=3, ...)",
  },
  {
    id: "requests",
    title: "Model requests",
    kinds: ["budget.reserved"],
    why: "Every reservation is made before a provider request. This is a Relay budget receipt—not a bill or proof of successful generation.",
    code: "model = guarded_model(model, engine)",
  },
  {
    id: "call",
    title: "Tool arguments",
    kinds: ["tool.started", "tool.failed", "tool.validation_error"],
    why: "The model requests an action with JSON arguments. Application code validates them. Invalid read-query arguments can be returned as an error for correction within the remaining limits.",
    code: "FunctionTool(..., on_invoke_tool=handler(name))",
  },
  {
    id: "result",
    title: "Returned evidence",
    kinds: ["tool.result"],
    why: "Only a successful tool.result proves what Relay returned. Source log content is untrusted evidence, never instructions. Open the payload and find the record IDs.",
    code: "await dispatch(engine, name, json.loads(arguments))",
  },
  {
    id: "answer",
    title: "Final findings",
    kinds: ["sdk.result", "message.assistant"],
    why: "The final response is a model-generated interpretation. Typed output checks shape, not truth. Compare every cited ID with the tool result.",
    code: "result.final_output / result.to_input_list()",
  },
  {
    id: "usage",
    title: "Usage & cost",
    kinds: ["budget.settled", "sdk.result"],
    why: "Token usage settles the reservation at Relay's conservative estimate. Failed or uncertain requests can retain a hold; do not confuse a hold with an invoice.",
    code: "result.context_wrapper.usage / TrialBudget.settle(...)",
  },
  {
    id: "outcome",
    title: "Run outcome",
    kinds: ["run.completed", "run.failed", "run.cancelled"],
    why: "A run is complete only when its terminal event says so. A successful tool call does not guarantee the whole run succeeded. Do not blindly retry failures.",
    code: "Engine.record('run.completed', ...)",
  },
];
