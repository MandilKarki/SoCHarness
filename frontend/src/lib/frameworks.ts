/*
 * Framework profiles: authored teaching content. Personas are original visual
 * identities (colour + glyph + motion) derived from each framework's design
 * philosophy — never vendor logos. API names in scenes come from the pinned
 * Relay integration (services/SDK_COVERAGE.md, /api/inventory). Support status
 * is NEVER asserted here; pages read it live from the inventory.
 */
export type Glyph =
  | "hooks"
  | "typed"
  | "graph"
  | "four"
  | "stream"
  | "client"
  | "loop"
  | "events"
  | "layers"
  | "log"
  | "spiral";

export interface SceneNode {
  id: string;
  label: string;
  sub?: string;
  x: number; // 0..100 (% of scene width)
  y: number; // 0..100 (% of scene height)
  kind?: "you" | "core" | "model" | "tool" | "state" | "guard" | "off";
}
export interface SceneStep {
  from: string;
  to: string;
  api: string;
  say: string;
}
export interface Concept {
  name: string;
  api: string;
  say: string;
}
export interface FrameworkProfile {
  id: string;
  name: string;
  maker: string;
  language: "Python" | "TypeScript";
  accent: string; // persona colour (dark theme); light theme darkens via CSS
  glyph: Glyph;
  tagline: string;
  mentalModel: string;
  philosophy: string[];
  scene: { nodes: SceneNode[]; steps: SceneStep[]; note?: string };
  concepts: Concept[];
  relay: {
    adapter: string;
    bridge: string;
    integration: string;
    persistence: string;
    limits: string;
    gaps: string;
  };
  bestFor: string;
  watchOut: string;
}

export const frameworks: FrameworkProfile[] = [
  {
    id: "claude",
    name: "Claude Agent SDK",
    maker: "Anthropic",
    language: "Python",
    accent: "#E8A37A",
    glyph: "hooks",
    tagline: "The harness behind Claude Code, opened up as a library.",
    mentalModel:
      "A long-running client that streams messages while every tool call passes through hooks and a permission gate.",
    philosophy: [
      "Ship a complete agent harness — tools, permissions, sessions, subagents — rather than a thin model wrapper.",
      "Control comes from lifecycle hooks and permission modes, not from rewriting the loop.",
      "Tools are exposed as MCP servers, including in-process ones you define in Python.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "client", label: "ClaudeSDKClient", sub: "session + stream", x: 30, y: 50, kind: "core" },
        { id: "model", label: "Claude", sub: "thinking budget", x: 55, y: 18, kind: "model" },
        { id: "hook", label: "PreToolUse hook", sub: "allow / deny", x: 55, y: 82, kind: "guard" },
        { id: "mcp", label: "Relay MCP server", sub: "case-scoped tools", x: 82, y: 82, kind: "tool" },
        { id: "budget", label: "max_budget_usd", sub: "SDK estimate", x: 82, y: 18, kind: "state" },
      ],
      steps: [
        { from: "you", to: "client", api: "ClaudeSDKClient.query(prompt)", say: "Your request enters a persistent client session." },
        { from: "client", to: "model", api: "ClaudeAgentOptions(thinking=…)", say: "The SDK sends context with an explicit thinking budget." },
        { from: "model", to: "hook", api: "tool_use → HookMatcher", say: "The model asks for a tool; a PreToolUse hook sees it first." },
        { from: "hook", to: "mcp", api: "create_sdk_mcp_server", say: "Allowed calls reach Relay's embedded MCP server, scoped to one case." },
        { from: "mcp", to: "model", api: "tool_result", say: "Evidence returns to the model as a tool result." },
        { from: "model", to: "budget", api: "max_budget_usd", say: "Usage is checked against the SDK's own USD estimate." },
        { from: "model", to: "client", api: "receive_response() → ResultMessage", say: "A terminal result (or validated structured output) ends the turn." },
      ],
    },
    concepts: [
      { name: "Client session", api: "ClaudeSDKClient", say: "Bidirectional, streaming conversation you can interrupt." },
      { name: "Hooks", api: "HookMatcher / PreToolUse", say: "Intercept tool calls deterministically before they run." },
      { name: "In-process tools", api: "create_sdk_mcp_server", say: "Python functions exposed to the model as MCP tools." },
      { name: "Structured output", api: "output_format", say: "Request a JSON-schema result instead of free text." },
      { name: "Resume", api: "ClaudeAgentOptions.resume", say: "Continue an earlier SDK session by id." },
      { name: "Spend cap", api: "max_budget_usd", say: "SDK-estimated budget per run — an estimate, not an invoice." },
    ],
    relay: {
      adapter: "services/claude_runtime.py",
      bridge: "In-process Python",
      integration:
        "Explicit thinking budgets (off, 1024, 2048, 4096); rejects missing terminal results, empty successes and invalid structured findings. Two named read-only specialists; fixed skill-only plugin.",
      persistence: "SDK session resume; partial transcripts are kept after a failed turn (no rollback).",
      limits: "SDK USD estimate, turn limits, 180-second deadline.",
      gaps: "Arbitrary external MCP, third-party executable plugins, general shell/browser isolation.",
    },
    bestFor: "Agents that need a full, permissioned toolbelt with hooks — essentially Claude Code inside your app.",
    watchOut: "Session behaviour differs from the other adapters: a failed turn is not rolled back.",
  },
  {
    id: "pydantic",
    name: "Pydantic AI",
    maker: "Pydantic",
    language: "Python",
    accent: "#EE79B0",
    glyph: "typed",
    tagline: "Agents as typed Python functions: validated in, validated out.",
    mentalModel:
      "An Agent[Deps, Output] is a function whose dependencies are injected and whose result must pass validation — or the model retries.",
    philosophy: [
      "Type safety first: outputs are Pydantic models, and validation failures feed back to the model.",
      "Dependency injection via RunContext keeps tools testable and side effects explicit.",
      "Model-agnostic; message history is plain, serialisable data.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "agent", label: "Agent[Deps, Output]", sub: "agent.run()", x: 32, y: 50, kind: "core" },
        { id: "model", label: "Model", sub: "any provider", x: 58, y: 18, kind: "model" },
        { id: "tool", label: "Tool(ctx: RunContext)", sub: "deps injected", x: 58, y: 82, kind: "tool" },
        { id: "valid", label: "Output validation", sub: "output_type", x: 84, y: 50, kind: "guard" },
        { id: "hist", label: "message_history", sub: "ModelMessagesTypeAdapter", x: 84, y: 88, kind: "state" },
      ],
      steps: [
        { from: "you", to: "agent", api: "Agent.run(prompt, deps=…)", say: "The run starts with typed dependencies, not globals." },
        { from: "agent", to: "model", api: "UsageLimits(request_limit=…)", say: "The request is bounded before the model is called." },
        { from: "model", to: "tool", api: "Tool / RunContext", say: "A tool call receives the injected dependencies via RunContext." },
        { from: "tool", to: "model", api: "ToolReturnPart", say: "The tool's return goes back as a typed message part." },
        { from: "model", to: "valid", api: "Agent.output_type", say: "The final answer must validate against the output model." },
        { from: "valid", to: "model", api: "ModelRetry", say: "If validation fails, the error is sent back so the model can fix it." },
        { from: "valid", to: "hist", api: "ModelMessagesTypeAdapter", say: "History is serialised so the next turn can resume it." },
      ],
    },
    concepts: [
      { name: "Typed agent", api: "Agent[Deps, Output]", say: "Generic over dependencies and output type." },
      { name: "Dependency injection", api: "RunContext[Deps]", say: "Tools receive a context object instead of reaching for globals." },
      { name: "Output validation", api: "output_type / ModelRetry", say: "Invalid output becomes a retry prompt, not a crash." },
      { name: "Usage limits", api: "UsageLimits", say: "Cap requests and tokens per run." },
      { name: "History", api: "ModelMessagesTypeAdapter", say: "Serialise and restore conversations, tool calls included." },
      { name: "Streaming", api: "event_stream_handler", say: "Observe events as the run progresses." },
    ],
    relay: {
      adapter: "services/adapters/pydantic_runtime.py",
      bridge: "In-process Python",
      integration: "ModelMessagesTypeAdapter serialisation and restoration, preserving tool calls/results across turns.",
      persistence: "Native JSON transcript in relay_native_state; only validated successes publish a continuation.",
      limits: "UsageLimits; no USD cap (blocked during the guarded trial).",
      gaps: "Capability plugins, delegation, durable workflow providers, external MCP, multimodal, spend limits.",
    },
    bestFor: "Production code where you want the compiler and validators to catch agent mistakes.",
    watchOut: "Validation proves shape, not truth — a perfectly typed finding can still be wrong.",
  },
  {
    id: "deepagents",
    name: "Deep Agents",
    maker: "LangChain",
    language: "Python",
    accent: "#3CC7C4",
    glyph: "graph",
    tagline: "Plan, delegate, checkpoint: long-horizon agents on a LangGraph.",
    mentalModel:
      "A graph that plans with a to-do list, hands sub-tasks to specialists and checkpoints every step so it can resume.",
    philosophy: [
      "Shallow tool loops fail on long tasks; add planning, sub-agents and memory as middleware.",
      "Everything is a LangGraph graph, so state, streaming and checkpoints come for free.",
      "Middleware composes behaviours (to-dos, files, summarisation) around one agent.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "graph", label: "create_deep_agent", sub: "LangGraph", x: 30, y: 50, kind: "core" },
        { id: "todo", label: "write_todos", sub: "TodoListMiddleware", x: 52, y: 15, kind: "state" },
        { id: "model", label: "Model", x: 52, y: 50, kind: "model" },
        { id: "spec", label: "Specialist", sub: "task tool", x: 76, y: 28, kind: "core" },
        { id: "tool", label: "StructuredTool", sub: "Relay evidence", x: 76, y: 72, kind: "tool" },
        { id: "ckpt", label: "AsyncSqliteSaver", sub: "checkpoint", x: 52, y: 86, kind: "state" },
      ],
      steps: [
        { from: "you", to: "graph", api: "agent.astream(input, config)", say: "The request enters a compiled graph with a thread id." },
        { from: "graph", to: "todo", api: "write_todos", say: "The agent writes a plan as a persistent to-do list." },
        { from: "graph", to: "model", api: "AgentMiddleware", say: "Middleware wraps each model call and enforces the shared call budget." },
        { from: "model", to: "spec", api: "task(subagent_type=…)", say: "A sub-task is delegated to a named, read-only specialist." },
        { from: "spec", to: "tool", api: "StructuredTool", say: "The specialist queries evidence through a typed tool." },
        { from: "spec", to: "model", api: "ToolMessage", say: "The specialist's result returns to the parent." },
        { from: "model", to: "ckpt", api: "checkpoint_id", say: "State is checkpointed so the exact step can be resumed." },
      ],
    },
    concepts: [
      { name: "Deep agent", api: "create_deep_agent", say: "A ready-made graph with planning, files and sub-agents." },
      { name: "Planning", api: "TodoListMiddleware / write_todos", say: "The model maintains its own task list." },
      { name: "Sub-agents", api: "task tool", say: "Delegate focused work with a fresh context." },
      { name: "Middleware", api: "AgentMiddleware", say: "Compose behaviours around model and tool calls." },
      { name: "Checkpoints", api: "AsyncSqliteSaver / checkpoint_id", say: "Durable graph state per thread." },
      { name: "Typed result", api: "response_format", say: "Structured final output." },
    ],
    relay: {
      adapter: "services/adapters/deep_runtime.py",
      bridge: "In-process Python",
      integration:
        "SQLite graph checkpoints, persistent to-dos, typed findings, two named read-only specialists sharing the model-call budget (max two delegations).",
      persistence: "Checkpoint database under adapter-sessions/<session>; resumes the exact saved checkpoint.",
      limits: "Shared model-call middleware; native summarisation replaced by Relay compaction.",
      gaps: "Native skills/memory backends, sandbox filesystem, dynamic agents, interruption UI, crash recovery.",
    },
    bestFor: "Multi-step investigations that benefit from an explicit plan and specialist delegation.",
    watchOut: "Sub-agents multiply model calls; budget them globally, as Relay does.",
  },
  {
    id: "pi",
    name: "Pi",
    maker: "Earendil (Mario Zechner)",
    language: "TypeScript",
    accent: "#C9E36B",
    glyph: "four",
    tagline: "A deliberately minimal harness: four tools, a short prompt, and you extend it.",
    mentalModel:
      "A tiny loop with read, write, edit and bash; sessions are append-only JSONL trees you can fork and branch.",
    philosophy: [
      "Minimal core and the shortest possible system prompt; capability comes from code, not configuration.",
      "Extend the agent by having it write extensions, hot-reloaded inside the session.",
      "Sessions are trees: branch and navigate instead of starting over.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "sess", label: "AgentSession", sub: "createAgentSession", x: 32, y: 50, kind: "core" },
        { id: "model", label: "Model", sub: "thinkingLevel", x: 58, y: 18, kind: "model" },
        { id: "tool", label: "customTools", sub: "Relay evidence", x: 58, y: 82, kind: "tool" },
        { id: "jsonl", label: "Session JSONL", sub: "append-only", x: 84, y: 50, kind: "state" },
        { id: "fork", label: "forkFrom", sub: "new branch", x: 84, y: 88, kind: "state" },
      ],
      steps: [
        { from: "you", to: "sess", api: "session.prompt(text)", say: "The prompt enters a minimal agent session." },
        { from: "sess", to: "model", api: "thinkingLevel", say: "The model runs with a chosen thinking level." },
        { from: "model", to: "tool", api: "customTools", say: "Relay replaces the default tools with case-scoped ones." },
        { from: "tool", to: "model", api: "tool result", say: "Results stream back into the same loop." },
        { from: "sess", to: "jsonl", api: "session.subscribe", say: "Every event is appended to the session's JSONL log." },
        { from: "jsonl", to: "fork", api: "SessionManager.forkFrom", say: "Continuations fork the last successful session." },
      ],
    },
    concepts: [
      { name: "Session", api: "createAgentSession", say: "One object owns the loop, tools and log." },
      { name: "Event stream", api: "session.subscribe", say: "Subscribe to everything the agent does." },
      { name: "Custom tools", api: "customTools", say: "Replace or add tools in code." },
      { name: "Thinking", api: "thinkingLevel", say: "Per-session reasoning effort." },
      { name: "Branching", api: "SessionManager.forkFrom", say: "Sessions are JSONL trees; fork to explore." },
      { name: "Extensions", api: "extensions (disabled here)", say: "Self-written, hot-reloaded add-ons." },
    ],
    relay: {
      adapter: "services/adapters/node_runtime.py",
      bridge: "Node worker (workers/agent-bridge)",
      integration: "Native JSONL persistence; forks the last successful session before each continuation; counts only new-turn usage.",
      persistence: "JSONL under adapter-sessions/<session>; failed attempts get separate forks.",
      limits: "streamFunction request counter; native retries and compaction disabled.",
      gaps: "Native branch navigation, steering queues, compaction UI, extensions, OAuth, external MCP.",
    },
    bestFor: "Learning what an agent loop is when almost nothing is hidden.",
    watchOut: "Minimal by design: governance has to be added around it, as Relay does.",
  },
  {
    id: "vercel",
    name: "Vercel AI SDK",
    maker: "Vercel",
    language: "TypeScript",
    accent: "#E4E8EE",
    glyph: "stream",
    tagline: "Streaming-first TypeScript: from tool loop to UI parts.",
    mentalModel:
      "A ToolLoopAgent repeats model steps until a stop condition, streaming typed parts that a UI can render live.",
    philosophy: [
      "Provider-agnostic primitives with one TypeScript API across models.",
      "Streaming is the default; tool calls and results are first-class stream parts.",
      "Loop control is declarative: stopWhen conditions instead of hand-written loops.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "UI", sub: "stream consumer", x: 8, y: 50, kind: "you" },
        { id: "agent", label: "ToolLoopAgent", sub: "agent.stream()", x: 32, y: 50, kind: "core" },
        { id: "gw", label: "AI Gateway", sub: "provider routing", x: 56, y: 18, kind: "model" },
        { id: "tool", label: "tool({ inputSchema })", sub: "jsonSchema", x: 56, y: 82, kind: "tool" },
        { id: "stop", label: "stopWhen", sub: "stepCountIs(n)", x: 82, y: 30, kind: "guard" },
        { id: "msgs", label: "response.messages", sub: "Output.object", x: 82, y: 76, kind: "state" },
      ],
      steps: [
        { from: "you", to: "agent", api: "agent.stream({ prompt })", say: "The UI starts a stream." },
        { from: "agent", to: "gw", api: "model via AI Gateway", say: "Each step calls a model through the gateway." },
        { from: "gw", to: "tool", api: "tool-call part", say: "A tool-call part is emitted and executed." },
        { from: "tool", to: "agent", api: "tool-result part", say: "The result is streamed and appended to the step." },
        { from: "agent", to: "stop", api: "stepCountIs / maxOutputTokens", say: "The stop condition decides whether to loop again." },
        { from: "agent", to: "msgs", api: "Output.object", say: "The final object and messages are returned for persistence." },
        { from: "msgs", to: "you", api: "stream parts", say: "Every part reached the UI as it happened." },
      ],
    },
    concepts: [
      { name: "Agent", api: "ToolLoopAgent", say: "A reusable tool loop with model, tools and stop rules." },
      { name: "Streaming", api: "agent.stream", say: "Typed stream parts for text, tool calls and results." },
      { name: "Tools", api: "tool / jsonSchema", say: "Schema-described functions." },
      { name: "Loop control", api: "stopWhen: stepCountIs(n)", say: "Declarative stop conditions." },
      { name: "Typed output", api: "Output.object", say: "Structured final result." },
      { name: "History", api: "response.messages", say: "Serialise model messages for the next turn." },
    ],
    relay: {
      adapter: "services/adapters/node_runtime.py",
      bridge: "Node worker (workers/agent-bridge)",
      integration: "Serialises and restores native model messages, including tool receipts, through the Relay state store.",
      persistence: "Native JSON in relay_native_state.",
      limits: "stepCountIs / maxOutputTokens; no USD cap.",
      gaps: "useChat protocol, workflow durability, native sub-agent/approval APIs, MCP, multimodal, embeddings.",
    },
    bestFor: "TypeScript products where the agent's progress streams straight into the interface.",
    watchOut: "Needs an AI Gateway key here; streaming UI protocol (useChat) isn't wired in Relay.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    maker: "Open source · opencode.ai",
    language: "TypeScript",
    accent: "#7EE787",
    glyph: "client",
    tagline: "A coding agent as a server; any client drives it over HTTP and SSE.",
    mentalModel:
      "The agent lives in a server process. Clients create or fork sessions, send prompts and subscribe to an event stream.",
    philosophy: [
      "Client/server split: the terminal UI is just one client of the agent server.",
      "Sessions are server resources you can fork, abort and share.",
      "Provider-agnostic; permissions and agents are configured on the server.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "Relay", sub: "SDK client", x: 8, y: 50, kind: "you" },
        { id: "client", label: "createOpencodeClient", sub: "HTTP", x: 30, y: 50, kind: "core" },
        { id: "server", label: "OpenCode server", sub: "permission = deny", x: 56, y: 50, kind: "core" },
        { id: "model", label: "Provider model", x: 82, y: 22, kind: "model" },
        { id: "sse", label: "Event stream", sub: "SSE", x: 56, y: 88, kind: "state" },
        { id: "snap", label: "5-record snapshot", sub: "no live tools", x: 30, y: 14, kind: "off" },
      ],
      steps: [
        { from: "snap", to: "client", api: "snapshot only", say: "Relay sends five selected records; OpenCode can't call case tools." },
        { from: "client", to: "server", api: "client.session.fork", say: "A successful earlier session is forked for continuation." },
        { from: "server", to: "model", api: "client.session.prompt", say: "The server prompts its configured provider." },
        { from: "server", to: "sse", api: "client.event.subscribe", say: "Events stream out over SSE." },
        { from: "sse", to: "client", api: "session/text-part filter", say: "Relay keeps only this session's text parts." },
        { from: "server", to: "client", api: "format: json_schema", say: "Findings come back in a JSON-schema format." },
      ],
      note: "Snapshot-only connector: OpenCode receives evidence but cannot run Relay's tools.",
    },
    concepts: [
      { name: "Client", api: "createOpencodeClient", say: "Generated SDK for the server's HTTP API." },
      { name: "Sessions", api: "client.session.prompt / fork", say: "Server-side conversations you can branch." },
      { name: "Events", api: "client.event.subscribe", say: "Server-sent events for everything happening." },
      { name: "Abort", api: "client.session.abort", say: "Best-effort cancellation." },
      { name: "Structured output", api: "format: json_schema", say: "Ask for schema-shaped results." },
    ],
    relay: {
      adapter: "services/adapters/node_runtime.py",
      bridge: "Node worker → dedicated OpenCode server (RELAY_OPENCODE_URL)",
      integration: "Forks successful server sessions, reapplies deny-all permissions, filters SSE by session/text part, schema output.",
      persistence: "Remote, on the dedicated OpenCode server.",
      limits: "Server controls tokens and cost; Relay enforces the deadline only.",
      gaps: "Case-tool MCP bridge, permission UI, file rewind, plugins, sandboxed shell/filesystem.",
    },
    bestFor: "Seeing a client/server agent architecture and SSE event streams up close.",
    watchOut: "Needs its own server and provider key; it is not an autonomous tool-using SOC agent here.",
  },
  {
    id: "openai",
    name: "OpenAI Agents SDK",
    maker: "OpenAI",
    language: "Python",
    accent: "#8FD3FF",
    glyph: "loop",
    tagline: "A small set of primitives: agents, tools, handoffs, guardrails, sessions.",
    mentalModel:
      "A Runner loops an Agent: call the model, run tools or hand off, repeat until a final output — with guardrails at the edges.",
    philosophy: [
      "Few primitives, composable: Agent, Runner, tools, handoffs, guardrails.",
      "Multi-agent is first-class: agents can be tools, or hand the conversation over.",
      "Built-in tracing and sessions; you choose what persists.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "runner", label: "Runner", sub: "run_streamed", x: 30, y: 50, kind: "core" },
        { id: "guard", label: "Guardrails", sub: "input / output", x: 30, y: 12, kind: "guard" },
        { id: "model", label: "Agent → model", x: 56, y: 22, kind: "model" },
        { id: "tool", label: "FunctionTool", sub: "case evidence", x: 56, y: 82, kind: "tool" },
        { id: "spec", label: "Specialist", sub: "handoff / as_tool", x: 82, y: 22, kind: "core" },
        { id: "sess", label: "Session", sub: "to_input_list", x: 82, y: 82, kind: "state" },
      ],
      steps: [
        { from: "you", to: "runner", api: "Runner.run_streamed(agent, input)", say: "The Runner starts the loop with your input." },
        { from: "runner", to: "guard", api: "InputGuardrail", say: "An input guardrail can trip before any model call." },
        { from: "runner", to: "model", api: "Model.stream_response", say: "The agent's instructions, tools and history go to the model." },
        { from: "model", to: "tool", api: "FunctionTool", say: "A function call runs your tool." },
        { from: "tool", to: "model", api: "function_call_output", say: "The output re-enters the next request." },
        { from: "model", to: "spec", api: "handoff() / Agent.as_tool()", say: "Control can transfer, or a specialist can run as a tool." },
        { from: "spec", to: "sess", api: "result.to_input_list()", say: "History is saved for the next run." },
      ],
    },
    concepts: [
      { name: "Runner", api: "Runner.run_streamed", say: "Drives the loop and streams events." },
      { name: "Tools", api: "FunctionTool", say: "Python callables with JSON schemas." },
      { name: "Handoffs", api: "handoff()", say: "Transfer the conversation to another agent." },
      { name: "Agents as tools", api: "Agent.as_tool()", say: "Delegate and get the answer back." },
      { name: "Guardrails", api: "InputGuardrail / OutputGuardrail", say: "Tripwires at the edges of the loop." },
      { name: "Approvals", api: "needs_approval / RunState", say: "Pause before a tool executes." },
    ],
    relay: {
      adapter: "services/adapters/openai_runtime.py",
      bridge: "In-process Python",
      integration:
        "Real Runner: streamed events, case-scoped function tools, typed findings, max turns/output, cancellation, usage, input-item continuation, plus seven experiments (multi-tool, manager, handoff, guardrails, approvals, sessions).",
      persistence: "Native input items (or the SDK Session protocol) committed only after success.",
      limits: "Shared $5 trial guard: $0.10 reservation per call, settled after usage.",
      gaps: "External MCP/hosted tools, realtime, remote tracing.",
    },
    bestFor: "Learning the loop end to end — it's the one framework running live here today.",
    watchOut: "Hosted tracing is disabled; Relay's local receipts are not an OpenAI trace.",
  },
  {
    id: "google_adk",
    name: "Google ADK",
    maker: "Google",
    language: "Python",
    accent: "#7FA8FF",
    glyph: "events",
    tagline: "Everything is an event: runners, sessions and workflow agents.",
    mentalModel:
      "A Runner executes an LlmAgent against a SessionService; every step is an Event appended to the session, and state lives beside it.",
    philosophy: [
      "Event-driven: the session's event list is the single record of what happened.",
      "Compose LLM agents with deterministic workflow agents (sequential, parallel, loop).",
      "Built for deployment: services for sessions, memory and artifacts are swappable.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "runner", label: "Runner", sub: "run_async", x: 30, y: 50, kind: "core" },
        { id: "agent", label: "LlmAgent", sub: "output_schema", x: 54, y: 22, kind: "model" },
        { id: "tool", label: "BaseTool", sub: "schema bridge", x: 54, y: 80, kind: "tool" },
        { id: "events", label: "Session events", sub: "SessionService", x: 80, y: 50, kind: "state" },
        { id: "cfg", label: "RunConfig", sub: "max_llm_calls", x: 30, y: 12, kind: "guard" },
      ],
      steps: [
        { from: "you", to: "runner", api: "Runner.run_async(new_message)", say: "A new message is sent to the runner with a session id." },
        { from: "cfg", to: "runner", api: "RunConfig.max_llm_calls", say: "The run is bounded by a maximum number of LLM calls." },
        { from: "runner", to: "agent", api: "LlmAgent", say: "The agent calls the model; streaming uses SSE mode." },
        { from: "agent", to: "tool", api: "BaseTool", say: "A function call runs a tool through Relay's schema bridge." },
        { from: "tool", to: "events", api: "Event(function_response)", say: "The tool response is recorded as an event." },
        { from: "agent", to: "events", api: "Event(is_final_response)", say: "The final response is the last event; state updates with it." },
      ],
    },
    concepts: [
      { name: "Runner", api: "Runner.run_async", say: "Executes agents and yields events." },
      { name: "LLM agent", api: "LlmAgent", say: "Instructions, tools and optional output schema." },
      { name: "Sessions", api: "SessionService", say: "Event history plus key-value state." },
      { name: "Limits", api: "RunConfig.max_llm_calls", say: "Bound the number of model calls." },
      { name: "Streaming", api: "StreamingMode.SSE", say: "Partial events as they arrive." },
      { name: "Workflow agents", api: "Sequential / Parallel / LoopAgent", say: "Deterministic orchestration (not enabled here)." },
    ],
    relay: {
      adapter: "services/adapters/python_runtime.py",
      bridge: "Isolated Python worker (workers/python-bridge)",
      integration: "Runner, schema tools, streaming events, typed findings, native session events/state, call/output limits.",
      persistence: "Session events and state serialised into relay_native_state.",
      limits: "RunConfig.max_llm_calls; no USD cap.",
      gaps: "Multi-agent transfer/workflows, hosted Vertex services, MCP/A2A, live media, native memory/artifacts, evals.",
    },
    bestFor: "Understanding event-sourced agent state and deployable agent services.",
    watchOut: "Needs GOOGLE_API_KEY, and the spending guard doesn't cover it yet.",
  },
  {
    id: "microsoft",
    name: "Microsoft Agent Framework",
    maker: "Microsoft",
    language: "Python",
    accent: "#B39BFF",
    glyph: "layers",
    tagline: "The successor to Semantic Kernel and AutoGen: agents, sessions and middleware.",
    mentalModel:
      "An Agent wraps a chat client with tools and middleware; conversation state lives in an AgentSession you can serialise.",
    philosophy: [
      "One framework for single agents and graph workflows, in Python and .NET.",
      "Enterprise-oriented: middleware, telemetry and hosted integrations.",
      "Conversation state is an explicit, portable object.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "agent", label: "Agent", sub: "agent.run(stream=True)", x: 32, y: 50, kind: "core" },
        { id: "client", label: "Chat client", sub: "OpenAI provider", x: 58, y: 18, kind: "model" },
        { id: "tool", label: "FunctionTool", sub: "case evidence", x: 58, y: 82, kind: "tool" },
        { id: "fmt", label: "response_format", sub: "typed findings", x: 84, y: 30, kind: "guard" },
        { id: "sess", label: "AgentSession", sub: "to_dict / from_dict", x: 84, y: 76, kind: "state" },
      ],
      steps: [
        { from: "you", to: "agent", api: "Agent.run(…, stream=True)", say: "The agent runs and streams updates." },
        { from: "agent", to: "client", api: "chat client", say: "A bounded provider client sends the request." },
        { from: "client", to: "tool", api: "FunctionTool", say: "Tool calls execute Relay's case tools." },
        { from: "tool", to: "client", api: "function result", say: "Results return to the model." },
        { from: "client", to: "fmt", api: "response_format", say: "The final answer is parsed into the findings type." },
        { from: "agent", to: "sess", api: "AgentSession.to_dict()", say: "The session is serialised for the next turn." },
      ],
    },
    concepts: [
      { name: "Agent", api: "Agent.run", say: "Chat client + instructions + tools." },
      { name: "Streaming", api: "stream=True / get_final_response", say: "Updates now, final response later." },
      { name: "Tools", api: "FunctionTool", say: "Typed Python functions." },
      { name: "Typed output", api: "response_format", say: "Structured final results." },
      { name: "Sessions", api: "AgentSession.to_dict / from_dict", say: "Portable conversation state." },
      { name: "Workflows", api: "graph workflows (not enabled here)", say: "Executors and edges for multi-agent flows." },
    ],
    relay: {
      adapter: "services/adapters/python_runtime.py",
      bridge: "Isolated Python worker (workers/python-bridge)",
      integration: "Agent, FunctionTool, streaming, typed findings, AgentSession continuation, strict request/output bounds.",
      persistence: "AgentSession in relay_native_state.",
      limits: "Bounded provider client; no USD cap yet (uses OPENAI_API_KEY, but outside the trial guard).",
      gaps: "Workflows/handoffs, Foundry/hosted tools, MCP/A2A, durable execution, realtime.",
    },
    bestFor: "Teams heading toward .NET/Azure, or migrating from Semantic Kernel or AutoGen.",
    watchOut: "Uses your existing OpenAI key, so it's a top candidate for the next guard extension.",
  },
  {
    id: "openhands",
    name: "OpenHands SDK",
    maker: "All Hands AI",
    language: "Python",
    accent: "#FF8A80",
    glyph: "log",
    tagline: "Event-sourced conversations with typed actions and observations.",
    mentalModel:
      "A stateless Agent steps through an immutable Conversation: each Action produces an Observation, and every event is logged.",
    philosophy: [
      "Immutability and event sourcing for reproducible agents.",
      "Typed actions and observations (Pydantic) instead of free-form tool strings.",
      "Workspaces abstract where code runs: local, Docker or remote.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "conv", label: "Conversation", sub: "run()", x: 30, y: 50, kind: "core" },
        { id: "agent", label: "Agent", sub: "stateless step", x: 54, y: 18, kind: "model" },
        { id: "act", label: "RelayCaseTool", sub: "Action → Observation", x: 54, y: 82, kind: "tool" },
        { id: "log", label: "Event log", sub: "serialised", x: 80, y: 50, kind: "state" },
        { id: "fin", label: "FinishTool", sub: "ends the run", x: 80, y: 14, kind: "guard" },
      ],
      steps: [
        { from: "you", to: "conv", api: "conversation.send_message()", say: "Your message is appended as an event." },
        { from: "conv", to: "agent", api: "Conversation.run()", say: "The agent takes a step over the event history." },
        { from: "agent", to: "act", api: "ToolDefinition → Action", say: "It emits a typed Action for Relay's case tool." },
        { from: "act", to: "log", api: "Observation", say: "The Observation is recorded as an immutable event." },
        { from: "log", to: "agent", api: "next step", say: "The next step reads the updated history." },
        { from: "agent", to: "fin", api: "FinishTool", say: "A FinishTool action ends the run (bounded by max iterations)." },
      ],
    },
    concepts: [
      { name: "Conversation", api: "Conversation.run", say: "Owns state and the event stream." },
      { name: "Agent", api: "Agent", say: "Stateless reasoning over history." },
      { name: "Typed tools", api: "ToolDefinition", say: "Action/observation pairs with schemas." },
      { name: "Finishing", api: "FinishTool", say: "An explicit tool ends the task." },
      { name: "Limits", api: "max_iteration_per_run", say: "Bound the number of steps." },
      { name: "Workspace", api: "local / Docker / remote (not enabled)", say: "Where actions execute." },
    ],
    relay: {
      adapter: "services/adapters/python_runtime.py",
      bridge: "Isolated Python worker (workers/python-bridge)",
      integration: "Native Conversation/Agent, custom typed Relay gateway tool, FinishTool, lifecycle events, native event continuation.",
      persistence: "Serialised conversation events in relay_native_state.",
      limits: "max_iteration_per_run / max_output_tokens; no USD cap yet (uses OPENAI_API_KEY).",
      gaps: "Token streaming, typed findings, native terminal/browser/files, remote sandboxes, delegation.",
    },
    bestFor: "Studying event sourcing and typed action/observation design.",
    watchOut: "No token streaming here — you see lifecycle events and the final answer.",
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    maker: "Nous Research",
    language: "Python",
    accent: "#F0C674",
    glyph: "spiral",
    tagline: "An autonomous agent with a learning loop: skills, memory and many gateways.",
    mentalModel:
      "AIAgent runs a conversation loop over a toolset; around it, Hermes can create skills and memories from experience (disabled in Relay).",
    philosophy: [
      "A closed learning loop: the agent writes and refines its own skills.",
      "Persistent, agent-curated memory across sessions.",
      "Runs anywhere and talks through many messaging gateways.",
    ],
    scene: {
      nodes: [
        { id: "you", label: "You", x: 8, y: 50, kind: "you" },
        { id: "agent", label: "AIAgent", sub: "run_conversation", x: 32, y: 50, kind: "core" },
        { id: "model", label: "Model", sub: "OpenAI-compatible", x: 58, y: 18, kind: "model" },
        { id: "tool", label: "Private toolset", sub: "prefixed Relay tools", x: 58, y: 82, kind: "tool" },
        { id: "hist", label: "Messages", sub: "native history", x: 84, y: 50, kind: "state" },
        { id: "learn", label: "Skills & memory", sub: "disabled here", x: 84, y: 12, kind: "off" },
      ],
      steps: [
        { from: "you", to: "agent", api: "AIAgent.run_conversation()", say: "The conversation loop starts in an isolated profile." },
        { from: "agent", to: "model", api: "stream_delta_callback", say: "Model output streams through a delta callback." },
        { from: "model", to: "tool", api: "private prefixed tool registry", say: "Only Relay's prefixed case tools are visible." },
        { from: "tool", to: "model", api: "tool result", say: "Results continue the loop." },
        { from: "agent", to: "hist", api: "native messages", say: "Message history is kept for continuation." },
        { from: "agent", to: "learn", api: "learning loop (off)", say: "Skill creation and memory are switched off in Relay." },
      ],
      note: "max_iterations bounds the loop, but Hermes may issue one extra native final-summary request.",
    },
    concepts: [
      { name: "Agent loop", api: "AIAgent.run_conversation", say: "One call runs the whole conversation." },
      { name: "Streaming", api: "stream_delta_callback", say: "Receive output deltas." },
      { name: "Toolsets", api: "tool registry", say: "Relay registers a private, prefixed set." },
      { name: "Limits", api: "max_iterations", say: "Bound the loop (plus a possible final summary)." },
      { name: "Learning loop", api: "skills / memory (off)", say: "Hermes' signature feature, not enabled here." },
    ],
    relay: {
      adapter: "services/adapters/python_runtime.py",
      bridge: "Isolated Python worker (workers/python-bridge)",
      integration: "AIAgent, prefixed private toolset, streaming, native message continuation, usage, isolated profile, iteration/output limits.",
      persistence: "Native message history in relay_native_state.",
      limits: "max_iterations (an extra final summary is possible); no USD cap yet (uses OPENAI_API_KEY).",
      gaps: "Typed findings, native learning/memory/skills, messaging gateways, shell/browser, delegation, external MCP.",
    },
    bestFor: "Seeing where autonomous, self-improving agents push beyond a single loop.",
    watchOut: "Its most distinctive features (learning, memory, gateways) are deliberately off here.",
  },
];
export const frameworkById = Object.fromEntries(frameworks.map((f) => [f.id, f])) as Record<string, FrameworkProfile>;
/** Inventory upstream_api strings that are placeholders, not API names. */
export const isRealApi = (s?: string | null) =>
  !!s && !/^Not exposed by Relay|^Restricted integration|requires review/.test(s);
