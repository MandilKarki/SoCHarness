import type { Trace } from "./types";

export type Layer =
  "workspace" | "server" | "runner" | "model" | "tools" | "state";
export const layers: { id: Layer; label: string; subtitle: string }[] = [
  {
    id: "workspace",
    label: "Analyst workspace",
    subtitle: "Question → session → visible events",
  },
  {
    id: "server",
    label: "Relay control plane",
    subtitle: "Identity, case scope & permission policy",
  },
  {
    id: "runner",
    label: "SDK orchestration",
    subtitle: "Messages → model → tools → next turn",
  },
  {
    id: "model",
    label: "Model provider",
    subtitle: "Bounded requests & streamed output",
  },
  {
    id: "tools",
    label: "Evidence tools",
    subtitle: "Schema → policy → execution → result",
  },
  {
    id: "state",
    label: "State & audit",
    subtitle: "SQLite history, usage & checkpoints",
  },
];
export interface Lesson {
  title: string;
  layer: Layer;
  capability: string;
  explanation: string;
  soc: string;
  boundary: string;
  question: string;
  answer: string;
}
// Authored teaching scenarios, NEVER execution receipts. Runtime-specific support
// and symbols come from the versioned server inventory, not this lesson sequence.
export const lessons: Lesson[] = [
  {
    title: "A question enters the system",
    layer: "workspace",
    capability: "sessions",
    explanation:
      "The analyst chooses a case, runtime and permission mode. Sending a message starts a run inside that session. A session can contain several runs; a run can contain several model turns.",
    soc: "Illustration: ask which logons in a review cohort need further investigation. This is a question, not a detection verdict.",
    boundary:
      "Opening this lesson or pressing Play does not send a prompt or create a session.",
    question: "Is one chat message always one model request?",
    answer:
      "No. Tool results may cause more model turns before a final response.",
  },
  {
    title: "Build a bounded context",
    layer: "server",
    capability: "compaction",
    explanation:
      "Instructions, conversation history, tool schemas and returned evidence all consume context. Relay bounds retained context and invalidates native continuation when the compaction epoch changes.",
    soc: "Query a small, relevant evidence slice instead of injecting an entire telemetry corpus. Preserve record IDs so findings can be checked.",
    boundary:
      "Relay checkpoint retention is not a lossless summary or the same as each SDK's native compaction. Context character counts are not exact token counts.",
    question: "Does compacting guarantee that every earlier fact survives?",
    answer:
      "No. Inspect retained context and re-query original evidence when needed.",
  },
  {
    title: "Enter the agent loop",
    layer: "runner",
    capability: "loop",
    explanation:
      "An SDK orchestrator submits the current input to a model. Depending on the response it may dispatch tools, continue another turn, or return a final answer. Relay adds cancellation and execution limits around that loop.",
    soc: "The analyst's question becomes an investigation run. The adapter decides how native SDK events become Relay audit records.",
    boundary:
      "SDKs have different loop semantics. The API mapping below identifies this adapter; a common picture is not identical behavior.",
    question: "Where does the next tool/model turn run?",
    answer: "In the server-side SDK runner, not in the browser animation.",
  },
  {
    title: "Reserve before requesting",
    layer: "model",
    capability: "usd_budget",
    explanation:
      "In the guarded OpenAI pilot, Relay reserves allowance in SQLite before every model request. Output and turn limits bound work; retries are disabled. Failed requests retain their reservation until safely reconciled.",
    soc: "The shared $5 October allowance covers all guarded OpenAI investigations, not $5 for each session. The UI never receives the provider key.",
    boundary:
      "This is Relay's OpenAI-specific spending guard, not a native SDK budget and not an enabled budget for the other adapters. Those paid routes remain blocked during the trial.",
    question: "Does a failed request necessarily cost zero?",
    answer:
      "No. Relay retains the hold because a provider may have processed the request.",
  },
  {
    title: "Receive output incrementally",
    layer: "model",
    capability: "streaming",
    explanation:
      "The adapter translates supported SDK events into Relay's NDJSON stream. Text deltas are output fragments; lifecycle events describe orchestration. They are not a view of private model reasoning.",
    soc: "Watch output arrive while a bounded query is being investigated. A visible final-looking sentence alone does not confirm run completion.",
    boundary:
      "Some adapters emit lifecycle and final events without token streaming. A final SDK result and completion event still matter.",
    question: "Can the last visible text delta prove the run finished?",
    answer: "No. Post-processing, state persistence or an error may follow.",
  },
  {
    title: "Request a scoped tool",
    layer: "tools",
    capability: "tools",
    explanation:
      "A tool schema describes allowed arguments. A tool call is a request for deterministic application code to execute, not proof that an action already happened. Relay checks case scope and enabled tools.",
    soc: "Illustration: query_case_evidence with a small limit, then get_event for a returned record ID. Only real tool.result events establish returned evidence.",
    boundary:
      "OpenCode's snapshot connector does not expose Relay tools. Shell, arbitrary browser actions and unrestricted external MCP are not enabled by this diagram.",
    question: "Does a tool call mean the action succeeded?",
    answer: "No. Check policy, tool.started, and the actual result or failure.",
  },
  {
    title: "Enforce the human boundary",
    layer: "server",
    capability: "approvals",
    explanation:
      "Read-only sessions deny writes. In supervised sessions, eligible writes require a one-shot decision for exact arguments. Approval authorizes an attempt; execution can still fail.",
    soc: "A suggested case note can wait for approval. The containment tool is a dry-run, not real endpoint isolation.",
    boundary:
      "These are shared Relay approvals, not SDK-native interrupt/resume parity. This lesson does not approve or execute anything.",
    question: "Can a later tool call reuse approval for different arguments?",
    answer: "No. Approval is bound to the exact proposed action.",
  },
  {
    title: "Return evidence to the loop",
    layer: "runner",
    capability: "native_resume",
    explanation:
      "Tool outputs become input for another model turn. After a successful run, the adapter saves its supported native transcript or checkpoint. Relay also keeps an independent audit history.",
    soc: "A tool result may contain attacker-controlled log content. Treat it as evidence, never as an instruction to change policy.",
    boundary:
      "Successful-turn continuation is not mid-tool crash recovery. Relay summary branches are not every SDK's native branch tree.",
    question:
      "Does a saved transcript resume an interrupted side effect safely?",
    answer:
      "Not by itself. Crash-safe effects need explicit idempotency and recovery design.",
  },
  {
    title: "Validate the finding",
    layer: "state",
    capability: "structured_output",
    explanation:
      "When enabled and supported, typed output is validated against observations, evidence IDs, hypotheses, next steps and limitations. Structure validation cannot establish factual correctness.",
    soc: "Separate observations from hypotheses and inspect the cited records before accepting an incident conclusion.",
    boundary:
      "Typed output is optional. It is not supported by every adapter and is not assumed to have run without a structured result receipt.",
    question: "Does schema-valid JSON make a finding true?",
    answer: "No. It guarantees shape, not evidence quality or accuracy.",
  },
  {
    title: "Close the loop with receipts",
    layer: "state",
    capability: "trace",
    explanation:
      "Relay stores usage, final output and a checkpoint, then records completion or failure. The recorded view below follows only events the application actually received.",
    soc: "Review the action timeline, compare findings to original records, and continue the same session for follow-up questions.",
    boundary:
      "Not every internal SDK action is instrumented. No event means no observed proof, not proof that a capability does not exist. Hosted provider tracing is disabled.",
    question: "Is replaying an old trace a new model run?",
    answer:
      "No. Reading or animating existing receipts makes no new model requests.",
  },
];

export function eventLayer(event: Trace): Layer | null {
  const k = event.kind;
  if (k === "message.user") return "workspace";
  if (
    k.startsWith("approval.") ||
    k.startsWith("hook.") ||
    k.startsWith("input.") ||
    k === "tool.denied"
  )
    return "server";
  if (k.startsWith("tool.")) return "tools";
  if (
    k.startsWith("budget.") ||
    k.startsWith("trial.") ||
    k === "message.delta"
  )
    return "model";
  if (k.startsWith("adapter.") || k.startsWith("run.")) return "runner";
  if (
    k.startsWith("context.") ||
    k === "checkpoint" ||
    k.startsWith("sdk.") ||
    k === "message.assistant" ||
    k.startsWith("session.")
  )
    return "state";
  return null; // Unknown events stay visible; never fabricate an architectural stage.
}
export function eventCapability(event: Trace): string {
  const k = event.kind;
  if (k.startsWith("approval.") || k === "tool.denied") return "approvals";
  if (k.startsWith("tool.")) return "tools";
  if (k.startsWith("budget.") || k.startsWith("trial.")) return "usd_budget";
  if (k === "message.delta") return "streaming";
  if (k === "context.usage") return "compaction";
  if (k === "sdk.result" && event.payload.structured_output)
    return "structured_output";
  if (
    k === "adapter.lifecycle" &&
    String(event.payload.event).startsWith("session.")
  )
    return "native_resume";
  return "trace";
}
export function learningTrace(trace: Trace[]): Trace[] {
  // Collapse only consecutive token deltas for readable playback. The selected
  // receipt keeps its original sequence; full deltas remain in the trace/export.
  return trace.filter(
    (event, i) =>
      event.kind !== "message.delta" || trace[i + 1]?.kind !== "message.delta",
  );
}
