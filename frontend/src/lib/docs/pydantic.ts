import { parse, type FrameworkDocs } from "./types";
const B = "https://pydantic.dev/docs/ai/";
export const pydanticDocs: FrameworkDocs = {
  source: B + "overview/",
  checked: "2026-10-03",
  sections: [
    { t: "Agents", url: B + "core-concepts/agent/", items: parse(`
Agent|class|Container for instructions, tools, output type and model|w
model / deps_type / output_type|param|Model id, dependency type, structured result type|w
instructions / system_prompt|param|Static or dynamic directions to the model|w
tools / toolsets / capabilities|param|Functions, tool collections and reusable behaviour bundles|w
@agent.instructions / @agent.system_prompt|decorator|Dynamic prompt functions using RunContext
Agent.run()|method|Async run returning AgentRunResult|w
Agent.run_sync()|method|Blocking wrapper
Agent.run_stream()|method|Stream text or structured output
Agent.run_stream_events()|method|Stream AgentStreamEvents
Agent.iter() / AgentRun|method|Drive the agent graph node by node
agent_run.next(node)|method|Manually step, inspect or modify nodes
is_user_prompt_node / is_model_request_node / is_call_tools_node / is_end_node|function|Identify graph node types
end_strategy|param|early, graceful or exhaustive stopping when output appears
event_stream_handler|param|Callback receiving the run's event stream|w
UsageLimits|class|Cap requests and tokens per run|w
model_settings / run_metadata|param|Request tuning and custom run metadata
ModelRetry|exception|Ask the model to retry with feedback (self-correction)|w
CancellationToken / RunCancelled|class|External or in-run cancellation
override()|method|Swap model, deps or toolsets (e.g. in tests)
PartStartEvent / PartDeltaEvent|event|Model output parts start and stream
FunctionToolCallEvent / FunctionToolResultEvent|event|Tool called and returned|w
CustomEvent / CapabilityEvent / AgentRunResultEvent|event|App events, capability signals, final result
RunUsage|type|Tokens, requests and cost estimate|w
`) },
    { t: "Dependencies", url: B + "core-concepts/dependencies/", items: parse(`
deps_type|param|Type of the dependency object for a run|w
RunContext|class|Gives tools and prompts access to deps, usage and retries|w
RunContext.deps|property|Your injected dependencies|w
RunContext.enqueue()|method|Inject follow-up content mid-run
Dependency injection|technique|Pass connections and config explicitly; override in tests|w
`) },
    { t: "Function tools", url: B + "tools-toolsets/tools/", items: parse(`
@agent.tool|decorator|Tool that receives RunContext
@agent.tool_plain|decorator|Tool without context
Tool|class|Wrap a function with name, description and options|w
docstring_format / require_parameter_descriptions|param|Docstring parsing rules
prepare|param|Modify or hide a tool per step
ToolReturn|class|Return multimodal content plus metadata
retries|param|Per-tool retry budget with ModelRetry
Sequential execution|technique|Run tools one at a time
UseEnumMemberDocstrings|type|Expose enum member docs to the model
`) },
    { t: "Toolsets", url: B + "tools-toolsets/toolsets/", items: parse(`
FunctionToolset|class|Group function tools
CombinedToolset / FilteredToolset / PrefixedToolset / RenamedToolset|class|Compose, filter, prefix or rename toolsets
WrapperToolset / ApprovalRequiredToolset|class|Intercept calls or require approval for a toolset
toolsets=|param|Attach toolsets at construction or per run
`) },
    { t: "Deferred tools and approvals", url: B + "tools-toolsets/deferred-tools/", items: parse(`
DeferredToolRequests|type|Output when calls need approval or external execution
DeferredToolResults|type|Results/approvals supplied on the next run
ApprovalRequired|exception|Raise inside a tool to request approval
CallDeferred|exception|Hand a call to external execution
ToolApproved / ToolDenied|type|Approval decisions
requires_approval|param|Mark a tool as needing approval
`) },
    { t: "Output", url: B + "core-concepts/output/", items: parse(`
output_type|param|Text, structured data, images or function results|w
ToolOutput|class|Output via a tool call, with custom name and retries|w
NativeOutput|class|Use the model's native structured output
PromptedOutput|class|Schema in the prompt, parsed from text
TextOutput|class|Pass plain text through a function
Output functions|technique|The model calls a function whose result is the output
@agent.output_validator|decorator|Async validation that can trigger a retry
stream_output() / stream_text()|method|Partial validated objects or text deltas
StructuredDict() / Choices()|function|Dict outputs from JSON Schema; runtime choices
Union outputs|technique|Let the model choose among output types
BinaryImage|type|Image as the final output
`) },
    { t: "Messages and history", url: B + "core-concepts/message-history/", items: parse(`
all_messages() / new_messages()|method|Whole history or this run's messages|w
all_messages_json() / new_messages_json()|method|JSON bytes of messages|w
message_history|param|Continue from earlier messages|w
ModelMessagesTypeAdapter|class|Serialise and restore message lists|w
ModelRequest / ModelResponse|type|Request and response messages|w
UserPromptPart / SystemPromptPart / TextPart / ToolCallPart / ToolReturnPart / RetryPromptPart / ThinkingPart|type|Message parts|w
ProcessHistory (history processors)|technique|Trim or summarise history before requests
sanitize_messages() / repair_messages()|function|Strip untrusted content; fix incomplete tool calls
`) },
    { t: "Core runtime", url: B + "core-concepts/hooks/", items: parse(`
Hooks|concept|Lifecycle callbacks around runs, requests and tools
Multimodal input|concept|Images, audio, video, documents as input
Workspaces|concept|Files and environment available to agents
Agent specs|concept|Declarative agent definitions
Persistence|concept|Save and resume runs
Direct model requests|technique|Call models without an agent
Retries / Timeouts|concept|HTTP and model retries; run and tool timeouts
Multi-agent patterns|technique|Delegation via tools, programmatic hand-off, graphs
`) },
    { t: "Capabilities", url: B + "capabilities/overview/", items: parse(`
Capabilities|concept|Reusable bundles that extend agents|p
On-demand / custom capabilities|technique|Load or build your own
MCP|tool|Use MCP servers as toolsets
Web search / Web fetch / X search / Image generation|tool|Provider-native tools
Thinking|config|Reasoning settings across providers
Tool search / Prepare tools / Prefix tools / Set tool metadata|technique|Tool-list management
Provider-native compaction / Process history|technique|Context management
Instrumentation|technique|OpenTelemetry/Logfire spans
Select model / Resolve model id|technique|Choose models dynamically
Handle deferred tool calls|technique|Approval and external execution flow
`) },
    { t: "Models and providers", url: B + "models/overview/", items: parse(`
Model strings (provider:model)|concept|e.g. openai:…, anthropic:…, google:…|w
OpenAI / Anthropic / Google / Bedrock / Azure / Groq / Mistral / Cohere / Ollama / OpenRouter / xAI…|module|25+ providers and compatible APIs|p
FallbackModel|class|Try models in order
Gateway|concept|Pydantic AI Gateway for routing and spend
`) },
    { t: "MCP and A2A", url: B + "mcp/overview/", items: parse(`
MCPServerStdio / MCPServerStreamableHTTP / MCPServerSSE|class|Connect to MCP servers as toolsets
FastMCPToolset|class|Use FastMCP servers
MCP server|technique|Expose an agent as an MCP server
agent.to_a2a()|method|Serve an agent over the A2A protocol
`) },
    { t: "Harness library", url: B + "harness/", items: parse(`
Coder / Researcher|concept|Prebuilt agent harnesses
FileSystem / Shell / sandboxes (Modal, E2B, Bubblewrap…)|tool|Execution environments
Planning / Subagents / Dynamic workflow / Advisor|technique|Orchestration add-ons
Memory / Conversation search / Skills / Repo context|technique|Knowledge add-ons
Guardrails / Prompt-injection defender / Spend limits|technique|Safety add-ons
Ask user / Trajectory judge / Tool-call judge|technique|Human input and judging
Compaction strategies / Tool output limits / Step persistence|technique|Context and durability
`) },
    { t: "Durable execution", url: B + "capabilities/durable_execution/overview/", items: parse(`
TemporalAgent|class|Run agents as Temporal workflows
DBOSAgent / PrefectAgent|class|DBOS or Prefect durable execution
Restate / Kitaru / Airflow|module|Other durable backends
`) },
    { t: "Interfaces and streaming UIs", url: B + "overview/interfaces/", items: parse(`
AG-UI|module|Agent–UI event protocol adapter
Vercel AI data stream|module|Serve the Vercel AI UI protocol
Web chat UI / CLI|module|Built-in chat UI and command line
`) },
    { t: "Pydantic Evals", url: B + "evals/evals/", items: parse(`
Dataset / Case|class|Evaluation datasets and cases
Evaluator / LLMJudge|class|Custom and LLM-based evaluators
Span-based evaluators|technique|Evaluate traces, not just outputs
Online evaluation|technique|Evaluate live traffic
`) },
    { t: "Pydantic Graph", url: B + "graph/graph/", items: parse(`
GraphBuilder|class|Build typed graphs of steps
Steps / Joins & reducers / Decisions / Parallel execution|concept|Graph building blocks
`) },
    { t: "Realtime", url: B + "realtime/overview/", items: parse(`
Realtime agents|concept|Speech-to-speech with tools, turns, interruptions and handoff
OpenAI / Azure / Gemini / xAI realtime|module|Realtime providers
`) },
    { t: "Testing and observability", url: B + "guides/testing/", items: parse(`
TestModel / FunctionModel|class|Deterministic fake models for tests|w
capture_run_messages()|function|Inspect messages exchanged in a test
Logfire|module|Native observability integration
`) },
  ],
};
