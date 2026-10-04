/*
 * Harness anatomy: authored teaching content (stable concepts), mapped onto the
 * versioned server inventory rows and the real trace event kinds. Framework
 * support is NEVER asserted here; it is read from /api/inventory at runtime.
 */
export type PartId =
  | "request"
  | "contract"
  | "policy"
  | "limits"
  | "model"
  | "runner"
  | "tools"
  | "sessions"
  | "memory"
  | "trace"
  | "multi"
  | "durable";

export interface Part {
  id: PartId;
  name: string;
  short: string;
  domain: DomainId;
  what: string;
  why: string;
  build: string[];
  relay: { file: string; role: string }[];
  rows: string[]; // inventory row ids
  events: string[]; // trace kinds that demonstrate this part in Live run
  relayStatus: "implemented" | "partial" | "target";
  experiments?: string[]; // Live run experiments that exercise this part
}
export type DomainId = "input" | "contract" | "loop" | "state" | "scale";
export const domains: { id: DomainId; name: string; caption: string }[] = [
  { id: "input", name: "Request", caption: "Where a run begins" },
  { id: "contract", name: "Harness contract", caption: "Fixed before the model speaks" },
  { id: "loop", name: "Agent loop", caption: "Repeats until an answer or a limit" },
  { id: "state", name: "State & audit", caption: "What survives the run" },
  { id: "scale", name: "Scaling out", caption: "Beyond one agent, one process" },
];

export const parts: Part[] = [
  {
    id: "request",
    name: "Request",
    short: "A person's task enters a session",
    domain: "input",
    what: "The user message that starts a run. A session can hold several runs; a run can make several model calls.",
    why: "Separating the request from the contract lets the same governed agent answer many different questions without loosening its boundaries.",
    build: [
      "Store the request as a message in a session, never as part of the system instructions.",
      "Give every run a boundary (first and last event) so you can replay or compare runs.",
      "Treat pasted evidence as data, not instructions.",
    ],
    relay: [
      { file: "services/engine.py", role: "Records message.user and starts the runtime" },
      { file: "frontend/src/useWorkspace.ts", role: "Sends the request and streams NDJSON events" },
    ],
    rows: ["sessions", "multimodal"],
    events: ["message.user"],
    relayStatus: "implemented",
    experiments: ["core"],
  },
  {
    id: "contract",
    name: "Instructions & schemas",
    short: "System prompt, tool schemas, output shape",
    domain: "contract",
    what: "Everything attached to the agent before it runs: system instructions, the JSON schema for each allowed tool, and optionally a required output schema.",
    why: "The model can only call tools it can see and can only be validated against a shape you declared. The contract is the agent's whole world.",
    build: [
      "Version the contract and record it at the start of every run (Relay emits harness.configured).",
      "Expose the narrowest tool schemas that do the job; add server-side scope the model cannot override.",
      "Validate structured output for shape. Shape is not truth; keep human verification.",
    ],
    relay: [
      { file: "services/adapters/openai_observation.py", role: "contract(): instructions, tool specs, findings schema" },
      { file: "services/adapters/openai_runtime.py", role: "Builds Agent(instructions, tools, output_type)" },
    ],
    rows: ["structured_output", "skills"],
    events: ["harness.configured"],
    relayStatus: "implemented",
    experiments: ["core"],
  },
  {
    id: "policy",
    name: "Policy & approvals",
    short: "Who may do what, and who must agree",
    domain: "contract",
    what: "Permission modes, case scoping, hooks or middleware that can deny a call, and human approval for exact tool arguments.",
    why: "Models propose actions; your application decides. This is the line between an assistant and an autonomous system you are accountable for.",
    build: [
      "Enforce policy in your tool gateway, not in the prompt.",
      "Approve exact arguments once; never a blanket 'allow this tool'.",
      "Prefer read-only defaults and make writes an explicit, logged escalation.",
    ],
    relay: [
      { file: "services/engine.py", role: "Engine.call: permission + case-scope gateway" },
      { file: "services/access.py", role: "Identity, origin protection" },
    ],
    rows: ["approvals", "native_approvals", "hooks", "sandbox", "oauth"],
    events: ["guardrail.checked", "approval.requested", "tool.started"],
    relayStatus: "implemented",
    experiments: ["guardrails", "review"],
  },
  {
    id: "limits",
    name: "Limits & budget",
    short: "Turns, tokens, money, time",
    domain: "contract",
    what: "Hard ceilings on model calls, output tokens, spend and wall-clock time, plus whether failed calls retry.",
    why: "A loop with no ceiling is an unbounded bill and an unbounded blast radius. Limits turn 'the agent decided' into 'the agent decided within X'.",
    build: [
      "Reserve budget before each call and settle after usage arrives (Relay holds $0.10 per OpenAI call).",
      "When the framework owns the HTTP client, meter at the network edge: Relay points Anthropic-key frameworks at a loopback proxy that reserves each request's worst case and keeps the real key.",
      "Cap turns in the runner and tokens per call in model settings.",
      "Turn off silent retries while learning, so every call you pay for is visible.",
    ],
    relay: [
      { file: "services/trial_budget.py", role: "Pre-call reservation and settlement ledger" },
      { file: "services/anthropic_budget.py", role: "Metering proxy and ledger for Claude, Pydantic AI, Deep Agents and Pi" },
      { file: "services/adapters/openai_runtime.py", role: "max_turns, max_tokens, retries disabled" },
    ],
    rows: ["limits", "usd_budget", "retry_policy", "cancellation"],
    events: ["orchestration.limit", "budget.reserved", "budget.settled", "budget.blocked", "run.failed", "run.cancelled"],
    relayStatus: "implemented",
    experiments: ["manager"],
  },
  {
    id: "model",
    name: "Model",
    short: "Reads context, proposes the next move",
    domain: "loop",
    what: "The LLM call. Given instructions, conversation and tool schemas, it returns either a function call or a message. It never executes anything itself.",
    why: "Everything the model 'knows' about this run is in the request you send. Inspecting that request is the fastest way to understand agent behaviour.",
    build: [
      "Log the public request and response of every call (not private reasoning).",
      "Keep provider and model choice in configuration, per session.",
      "Expect it to choose differently from your plan; observe, then constrain.",
    ],
    relay: [{ file: "services/adapters/openai_observation.py", role: "ObservedModel: records model.request / model.response" }],
    rows: ["thinking", "model_routing", "multimodal", "realtime", "embeddings"],
    events: ["model.request", "model.response"],
    relayStatus: "implemented",
    experiments: ["core"],
  },
  {
    id: "runner",
    name: "Runner",
    short: "The SDK's loop driver",
    domain: "loop",
    what: "The framework code that sends a request, reads the response, runs any requested tool, appends the result and calls the model again, until there is a final answer or a limit.",
    why: "This loop is what every agent SDK is selling. Frameworks differ mostly in how they stream it, interrupt it, and let you hook into it.",
    build: [
      "Stream events out of the loop so the UI shows progress before the answer.",
      "Make cancellation a first-class event, not a killed process.",
      "Persist after every successful turn, so a crash loses at most one step.",
    ],
    relay: [
      { file: "services/adapters/openai_runtime.py", role: "Runner.run_streamed(...) with event recording" },
      { file: "services/adapters/registry.py", role: "Chooses the runtime adapter per session" },
    ],
    rows: ["loop", "streaming", "planning"],
    events: ["run.completed"],
    relayStatus: "implemented",
    experiments: ["core", "multi_tool"],
  },
  {
    id: "tools",
    name: "Tools",
    short: "Your code, called with model-chosen arguments",
    domain: "loop",
    what: "Functions the model may request. The SDK validates arguments against the schema, your code executes, and the result goes back into the next model request as function_call_output.",
    why: "Tools are the only way an agent touches the world. Their design (scope, idempotence, output size) decides both usefulness and risk.",
    build: [
      "Return compact, citable records with stable IDs, so answers can be checked.",
      "Reject invalid arguments with a recoverable error the model can read.",
      "Separate read tools from write tools; gate the latter.",
    ],
    relay: [
      { file: "services/store.py", role: "TOOLS catalogue: 14 case-scoped tools" },
      { file: "services/engine.py", role: "tool.started / tool.result recording" },
    ],
    rows: ["tools", "mcp", "external_mcp", "file_workspace", "shell", "browser", "plugins"],
    events: ["tool.started", "tool.result", "tool.failed"],
    relayStatus: "implemented",
    experiments: ["multi_tool"],
  },
  {
    id: "sessions",
    name: "Context & sessions",
    short: "What the next call remembers",
    domain: "state",
    what: "The conversation history carried between runs: messages, tool calls and tool outputs, serialised so a follow-up continues where the last run ended.",
    why: "A follow-up only 'remembers' because the harness re-sends history. Context management is a design choice, not a model property.",
    build: [
      "Persist the SDK's own input list after successful turns (result.to_input_list()).",
      "Decide your compaction strategy before context limits decide for you.",
      "Branch by checkpoint rather than editing history in place.",
    ],
    relay: [
      { file: "services/adapters/native_state.py", role: "Native transcript continuation" },
      { file: "services/store.py", role: "SQLite sessions and messages" },
    ],
    rows: ["sessions", "native_resume", "branch", "compaction", "native_branch"],
    events: ["session.loaded", "session.committed", "run.completed"],
    relayStatus: "implemented",
    experiments: ["sessions"],
  },
  {
    id: "memory",
    name: "Memory",
    short: "Facts that outlive a session",
    domain: "state",
    what: "Knowledge kept across sessions: cited notes, playbooks, or SDK-native memory services. Distinct from conversation history.",
    why: "Without provenance, memory becomes a source of confident errors. With citations, it becomes institutional knowledge.",
    build: [
      "Store memory as approved, cited records, not free-form model output.",
      "Retrieve deliberately (by case, by entity) and show what was injected.",
    ],
    relay: [{ file: "services/advanced.py", role: "Evidence-linked notes, playbooks, tasks" }],
    rows: ["memory", "native_memory", "artifacts"],
    events: [],
    relayStatus: "partial",
  },
  {
    id: "trace",
    name: "Observability",
    short: "A durable record of every step",
    domain: "state",
    what: "An ordered event ledger: requests, responses, tool calls, results, usage, cost and failures, saved independently of the SDK.",
    why: "You cannot debug, evaluate, or defend an agent's decision you cannot replay. This view's Live run is built entirely on this ledger.",
    build: [
      "Give every event a sequence number and a kind; merge streams by sequence.",
      "Record usage and cost per call, not only per run.",
      "Exclude secrets and private reasoning by construction.",
    ],
    relay: [
      { file: "services/engine.py", role: "Engine.record(kind, payload)" },
      { file: "services/telemetry_api.py", role: "Export audit / OTLP JSON" },
    ],
    rows: ["trace", "provider_trace", "evals"],
    events: ["model.response", "tool.result"],
    relayStatus: "implemented",
    experiments: ["core"],
  },
  {
    id: "multi",
    name: "Multi-agent",
    short: "Handoffs, specialists, people",
    domain: "scale",
    what: "Patterns where one agent delegates to another (handoffs, agents-as-tools, subagents), or pauses to ask a human.",
    why: "Specialists with narrow tools are easier to govern than one agent with every tool. Each hop is also another place to lose context.",
    build: [
      "Give each specialist its own contract and limits; share a global call budget.",
      "Log the handoff itself as an event with the context passed.",
    ],
    relay: [
      { file: "services/adapters/openai_runtime.py", role: "Agent.as_tool() manager and handoff() experiments" },
      { file: "services/claude_runtime.py", role: "Two read-only named Claude specialists" },
    ],
    rows: ["subagents", "human_input", "a2a"],
    events: ["agent.delegated", "agent.handoff"],
    relayStatus: "implemented",
    experiments: ["manager", "handoff"],
  },
  {
    id: "durable",
    name: "Durable execution",
    short: "Surviving restarts and long jobs",
    domain: "scale",
    what: "Running agent workflows as resumable background jobs that survive process crashes and can wait hours for input.",
    why: "Interactive streaming is fine for a lab. A platform needs queues, checkpoints and idempotent tools.",
    build: [
      "Make tools idempotent before making runs resumable.",
      "Checkpoint between steps; never assume a tool's side effect did or did not happen.",
    ],
    relay: [{ file: "DEPLOYMENT.txt", role: "Documents the gap: no distributed queue yet" }],
    rows: ["durable", "crash_resume"],
    events: [],
    relayStatus: "target",
  },
];
export const partById = Object.fromEntries(parts.map((p) => [p.id, p])) as Record<PartId, Part>;
export function partForEvent(kind: string): Part | undefined {
  const order: PartId[] = ["request", "contract", "model", "multi", "tools", "policy", "limits", "runner", "sessions", "trace"];
  return order.map((id) => partById[id]).find((p) => p.events.includes(kind));
}
export const statusLabel: Record<string, string> = {
  native: "SDK-native",
  shared: "Built by Relay",
  partial: "Restricted",
  gap: "Not integrated",
};
export const shortName: Record<string, string> = {
  claude: "Claude",
  pydantic: "Pydantic",
  deepagents: "Deep Ag.",
  pi: "Pi",
  vercel: "Vercel",
  opencode: "OpenCode",
  openai: "OpenAI",
  google_adk: "ADK",
  microsoft: "MS Agent",
  openhands: "OpenHands",
  hermes: "Hermes",
};
