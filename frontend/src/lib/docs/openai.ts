import { parse, type FrameworkDocs } from "./types";
const B = "https://openai.github.io/openai-agents-python/";
export const openaiDocs: FrameworkDocs = {
  source: B,
  checked: "2026-10-03",
  sections: [
    { t: "Agents", url: B + "agents/", items: parse(`
Agent|class|An LLM configured with instructions, tools, handoffs, guardrails and output type|w
name|param|Human-readable agent name|w
instructions|param|System prompt, or a function of (context, agent) for dynamic instructions|w
prompt|param|Responses API prompt template, static or dynamic
handoff_description|param|Short description shown when this agent is a handoff target|w
handoffs|param|Specialist agents (or Handoff objects) this agent may delegate to|w
model|param|Which model this agent uses|w
model_settings|param|Temperature, top_p, tool_choice and other tuning|w
tools|param|Tools the agent can call|w
mcp_servers|param|MCP servers that supply tools
mcp_config|param|Fine-tunes how MCP tools are prepared
input_guardrails|param|Checks run on the first user input|w
output_guardrails|param|Checks run on the final output|w
output_type|param|Structured output type instead of plain text|w
hooks|param|Agent-scoped lifecycle callbacks (AgentHooks)
tool_use_behavior|param|Whether tool results loop back to the model or end the run
reset_tool_choice|param|Reset tool_choice after a tool call to avoid loops (default True)
clone()|method|Copy an agent, overriding any properties
as_tool()|method|Expose the agent as a tool for manager-style orchestration|w
Dynamic instructions|technique|Generate the system prompt from run context at call time
`) },
    { t: "Running agents", url: B + "running_agents/", items: parse(`
Runner|class|Executes the agent loop|w
Runner.run()|method|Async run returning a RunResult
Runner.run_sync()|method|Blocking wrapper around run()
Runner.run_streamed()|method|Async run returning RunResultStreaming for event-by-event output|w
The agent loop|concept|Call LLM → final output, handoff or tool calls → repeat until done or max_turns|w
max_turns|param|Turn limit (None disables it)|w
RunConfig|class|Run-wide overrides and settings
RunConfig.model / model_provider|config|Override the model or resolve names through a custom provider
RunConfig.model_settings|config|Global model setting overrides
RunConfig.session_settings|config|History retrieval limits for session-backed runs
RunConfig.session_input_callback|config|Custom merge of new input with loaded history
RunConfig.input_guardrails / output_guardrails|config|Run-wide guardrails
RunConfig.handoff_input_filter|config|Global transform of inputs passed in handoffs
RunConfig.nest_handoff_history|config|Beta: compact history into ordered summaries across handoffs
RunConfig.handoff_history_mapper|config|Custom builder for the next agent's input items
RunConfig.call_model_input_filter|config|Pre-call hook to trim, redact or inject before every model call
RunConfig.reasoning_item_id_policy|config|Preserve or omit reasoning item ids in follow-ups
RunConfig.tracing_disabled / tracing|config|Turn tracing off or override export settings|w
RunConfig.trace_include_sensitive_data|config|Include or exclude LLM/tool I/O in traces
RunConfig.workflow_name / trace_id / group_id / trace_metadata|config|Trace naming and correlation
RunConfig.tool_execution|config|Function-tool concurrency and pre-approval guardrail timing
RunConfig.tool_not_found_behavior|config|Raise or return a model-visible error for unknown tools
RunConfig.tool_name_collision_policy|config|Warn or error on tool name collisions
RunConfig.tool_error_formatter|config|Format model-visible rejection and not-found messages
ModelInputData / CallModelData|type|Data passed through call_model_input_filter
result.to_input_list()|technique|Manual conversation management: rebuild next input from a result|w
session=|technique|Automatic history via a Session implementation|w
conversation_id|param|Server-managed conversation shared across workers
previous_response_id / auto_previous_response_id|param|Chain Responses API calls without replaying history
error_handlers|param|Recovery callbacks for max_turns, model_refusal, invalid_final_output
RunErrorHandlerInput / RunErrorHandlerResult|type|Error-handler input and fallback output (include_in_history)
set_default_openai_responses_transport()|function|Use WebSocket or HTTP transport for Responses
responses_websocket_session()|function|Reuse one WebSocket connection across runs
Dapr / Temporal / Restate / DBOS|technique|Durable-execution integrations for long-running agents
AgentsException|exception|Base class for SDK errors
MaxTurnsExceeded|exception|Run exceeded max_turns|w
ModelTimeoutError|exception|Model call exceeded ModelSettings.timeout
ModelBehaviorError|exception|Malformed output, unexpected tool failure or terminal status
ToolTimeoutError|exception|Function tool exceeded its timeout
UserError|exception|SDK misuse or invalid configuration
`) },
    { t: "Results", url: B + "results/", items: parse(`
RunResult|class|Outcome of a run|w
RunResultStreaming|class|Streaming result with events and completion state|w
final_output|property|Final output of the last agent|w
final_output_as()|method|Typed accessor for the final output
to_input_list()|method|Input-item view of the run for the next turn|w
last_agent|property|Agent that should handle the next turn|w
new_items|property|RunItems with agent, tool, handoff and approval metadata|w
raw_responses|property|Raw ModelResponse objects per model call|w
input|property|Base input for this run segment
input_guardrail_results / output_guardrail_results|property|Agent-level guardrail outcomes|w
tool_input_guardrail_results / tool_output_guardrail_results|property|Tool-level guardrail outcomes
interruptions|property|Pending approvals that must be resolved|w
to_state()|method|Capture a resumable RunState|w
last_response_id|property|Latest model response id for chaining
agent_tool_invocation|property|Metadata for nested Agent.as_tool() calls
context_wrapper|property|Your context plus SDK runtime metadata
current_agent / is_complete|property|Live state of a streamed run|w
cancel()|method|Stop now, or mode="after_turn"|w
`) },
    { t: "Streaming", url: B + "streaming/", items: parse(`
stream_events()|method|Async iterator of StreamEvents until the run completes|w
RawResponsesStreamEvent|event|Raw model events, token by token|w
RunItemStreamEvent|event|Fires when an item (message, tool call, output) finishes|w
AgentUpdatedStreamEvent|event|The current agent changed (e.g. after a handoff)|w
ResponseTextDeltaEvent|event|Text delta inside a raw event|w
tool_called / tool_output|event|Tool call issued / result returned|w
message_output_created|event|Agent message fully generated|w
handoff_requested / handoff_occured|event|Handoff started / completed (spelling kept for compatibility)|w
tool_search_called / tool_search_output_created|event|Hosted tool-search activity
`) },
    { t: "Tools", url: B + "tools/", items: parse(`
@function_tool|decorator|Turn a Python function into a tool; schema from signature and docstring
FunctionTool|class|Manual tool: name, description, params_json_schema, on_invoke_tool|w
on_invoke_tool|param|Async handler receiving ToolContext and JSON arguments|w
params_json_schema|param|JSON Schema for arguments|w
name_override / description|param|Override the tool's name or description
use_docstring_info|param|Parse google/sphinx/numpy docstrings for argument descriptions
failure_error_function|param|Model-visible message when the tool crashes
timeout / timeout_behavior / timeout_error_function|param|Per-call timeouts: return an error or raise
is_enabled|param|Bool or callable that hides the tool at runtime
needs_approval / on_approval|param|Require approval, or decide immediately without pausing|w
strict_mode|param|Strict JSON schema; disable for nested **kwargs
output_type / output_json_schema|param|Strict structured return schema
allowed_callers|param|Allow direct calls, programmatic calls, or both
defer_loading|param|Hide a tool until ToolSearchTool loads it
tool_namespace()|function|Group related tools under a namespace
Annotated[T, Field(...)]|technique|Pydantic constraints on arguments
ToolOutputText / ToolOutputImage / ToolOutputFileContent|type|Rich tool return types
WebSearchTool|tool|Hosted web search
FileSearchTool|tool|Hosted vector-store retrieval
CodeInterpreterTool|tool|Hosted sandboxed code execution
HostedMCPTool|tool|Hosted remote MCP server tools
ImageGenerationTool|tool|Hosted image generation
ToolSearchTool|tool|Model loads deferred tools or namespaces on demand
ProgrammaticToolCallingTool|tool|Model coordinates tools from generated JavaScript
ShellTool|tool|Shell commands, hosted container or local executor
ComputerTool|tool|GUI/browser automation via a Computer implementation
ApplyPatchTool|tool|Apply file diffs through an ApplyPatchEditor
LocalShellTool|tool|Legacy local shell (superseded by ShellTool)
codex_tool()|function|Experimental: run Codex CLI tasks as a tool
Agent.as_tool(tool_name, tool_description, max_turns, …)|method|Agents as tools, with nested run config and hooks|w
custom_output_extractor|param|Post-process the nested RunResult before returning
on_stream|param|Receive nested agent stream events|w
parameters / input_builder / include_input_schema|param|Structured input for nested agents
`) },
    { t: "Handoffs", url: B + "handoffs/", items: parse(`
handoff()|function|Create a customised handoff to another agent|w
Handoff|class|Handoff definition (target agent plus options)|w
on_handoff|param|Callback when the handoff is invoked
input_type|param|Structured arguments the model supplies with the handoff
input_filter|param|Rewrite the history the receiving agent sees
tool_name_override / tool_description_override|param|Rename or redescribe the transfer_to_<agent> tool
is_enabled|param|Enable the handoff conditionally
nest_handoff_history|param|Per-handoff history compaction
handoff_filters|module|Ready-made filters such as remove_all_tools
HandoffInputData|type|History and items passed to input filters
RECOMMENDED_PROMPT_PREFIX|config|Prompt text that explains handoffs to the model
prompt_with_handoff_instructions()|function|Add handoff guidance to a prompt
set_conversation_history_wrappers() / reset_…()|function|Customise nested-history summary wrappers
`) },
    { t: "Agent orchestration", url: B + "multi_agent/", items: parse(`
Orchestrating via LLM|technique|Let an agent plan and choose tools/handoffs|w
Orchestrating via code|technique|Chain agents deterministically, run in parallel, loop until a judge passes
Manager pattern (agents as tools)|technique|Manager keeps control and calls specialists|w
Handoff pattern|technique|Triage agent transfers ownership to a specialist|w
`) },
    { t: "Guardrails", url: B + "guardrails/", items: parse(`
@input_guardrail|decorator|Validate user input before (or alongside) the agent|w
@output_guardrail|decorator|Validate the final output|w
@tool_input_guardrail / @tool_output_guardrail|decorator|Validate tool arguments or results
InputGuardrail / OutputGuardrail|class|Guardrail containers attached to agents|w
GuardrailFunctionOutput|type|output_info plus tripwire_triggered|w
ToolGuardrailFunctionOutput|type|Allow/reject decision for tool guardrails
run_in_parallel|param|Run input guardrails concurrently or block first
InputGuardrailTripwireTriggered / OutputGuardrailTripwireTriggered|exception|Raised when a guardrail trips|w
ToolInputGuardrailTripwireTriggered / ToolOutputGuardrailTripwireTriggered|exception|Tool guardrail tripped
`) },
    { t: "Human-in-the-loop", url: B + "human_in_the_loop/", items: parse(`
needs_approval|param|Always require approval, or decide per call|w
interruptions|property|Paused tool calls awaiting a decision|w
RunState|class|Serialisable execution state for pause/resume|w
approve() / reject()|method|Resolve a pending call (reject can carry a message)|w
to_state()|method|Turn a result into a resumable RunState|w
to_json() / from_json() / to_string() / from_string()|method|Persist and restore RunState
ToolApprovalItem|type|Tool name, arguments and metadata to show the reviewer|w
always_approve / always_reject|param|Cache a decision for the rest of the run
require_approval|param|Approvals for MCP servers
rejection_message|param|Model-visible reason for a rejection
`) },
    { t: "Sessions", url: B + "sessions/", items: parse(`
Session|type|Protocol: get_items, add_items, pop_item, clear_session|w
get_items(limit) / add_items() / pop_item() / clear_session()|method|Read, append, undo and clear history|w
SQLiteSession / AsyncSQLiteSession|class|File or in-memory SQLite history
RedisSession|class|Shared history across distributed workers
SQLAlchemySession|class|Postgres, MySQL and other SQL databases
MongoDBSession / DaprSession|class|Document store or Dapr sidecar storage
AdvancedSQLiteSession|class|Branching, analytics and structured queries
EncryptedSession|class|Transparent encryption around any backend
OpenAIConversationsSession|class|Server-managed history via the Conversations API
OpenAIResponsesCompactionSession|class|Automatic history compaction via Responses
SessionSettings(limit)|class|Per-run retrieval limit
Custom session|technique|Implement the protocol without inheritance|w
`) },
    { t: "Context, usage and hooks", url: B + "context/", items: parse(`
RunContextWrapper|class|Wraps your context object for tools and hooks|w
wrapper.context|property|Your app's dependencies and mutable state|w
wrapper.usage|property|Aggregated requests and tokens for the run|w
wrapper.tool_input|property|Structured input inside Agent.as_tool()
wrapper.approve_tool() / reject_tool()|method|Update approval state programmatically
ToolContext|class|Adds tool_name, tool_call_id, tool_arguments, namespaces|w
Usage|type|requests, input_tokens, output_tokens, total_tokens, per-request entries|w
RunHooks|class|Run-wide lifecycle callbacks|w
AgentHooks|class|Agent-scoped lifecycle callbacks
on_agent_start / on_agent_end|hook|Agent begins or produces output|w
on_llm_start / on_llm_end|hook|Around each model call
on_tool_start / on_tool_end|hook|Around each tool call|w
on_handoff|hook|Control transferred between agents|w
Local vs LLM context|concept|Python context is never sent to the model unless you put it in a prompt|w
`) },
    { t: "Models", url: B + "models/", items: parse(`
OpenAIResponsesModel|class|Responses API model (recommended)|w
OpenAIResponsesWSModel|class|Responses API over WebSocket
OpenAIChatCompletionsModel|class|Chat Completions API model
Model / Model.stream_response|class|Interface to implement or wrap a model|w
ModelSettings|class|Request parameters for agent or run|w
temperature / top_p / tool_choice / parallel_tool_calls|config|Sampling and tool behaviour|w
truncation / reasoning / verbosity|config|Overflow handling, reasoning effort and output detail
max_tokens / store / timeout / retry / extra_args|config|Limits, persistence, timeouts, retries, provider extras|w
ModelProvider / MultiProvider|class|Resolve model names, route by prefix
LiteLLMModel / AnyLLMModel|class|Beta third-party provider adapters
set_default_openai_client() / set_default_openai_api() / set_default_openai_key()|function|Global client, API and key defaults
`) },
    { t: "MCP", url: B + "mcp/", items: parse(`
MCPServerStdio|class|Local MCP subprocess over stdio
MCPServerSse|class|HTTP + Server-Sent Events server
MCPServerStreamableHttp|class|Streamable HTTP server
MCPServerManager|class|Connect several servers and expose the healthy ones
tool_filter / create_static_tool_filter|param|Allow/block which MCP tools are visible
cache_tools_list / invalidate_tools_cache()|param|Cache or refresh tool lists
list_prompts() / get_prompt()|method|Use server-provided prompt templates
tool_meta_resolver|param|Inject per-call _meta payloads
`) },
    { t: "Tracing", url: B + "tracing/", items: parse(`
trace()|function|Group a workflow into one trace
agent_span / generation_span / function_span / guardrail_span / handoff_span / custom_span|function|Span helpers for each kind of step
set_tracing_disabled()|function|Disable tracing globally|w
set_trace_processors() / add_trace_processor()|function|Replace or add exporters
flush_traces()|function|Block until buffered traces export
TracingProcessor / BatchTraceProcessor / BackendSpanExporter|class|Processor interface and defaults
OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA|config|Environment switch for sensitive trace data
External processors|technique|25+ integrations (Logfire, Langfuse, LangSmith, Datadog, MLflow…)
`) },
    { t: "Sandbox agents", url: B + "sandbox/guide/", items: parse(`
SandboxAgent|class|Agent with a sandboxed workspace, manifest and capabilities
Manifest|class|Files, repos, mounts and environment for a fresh sandbox
SandboxRunConfig / SandboxSession|class|How a sandbox is obtained; the live environment
UnixLocalSandboxClient / DockerSandboxClient|class|Local or container sandboxes; hosted clients too
Filesystem / Shell / Memory / Skills / Compaction|tool|Sandbox-native capabilities
Permissions / SnapshotSpec / LocalSnapshotSpec / RemoteSnapshotSpec|config|File permissions and workspace snapshots
`) },
    { t: "Realtime and voice", url: B + "realtime/guide/", items: parse(`
RealtimeAgent / RealtimeRunner / RealtimeSession|class|Low-latency speech-to-speech agents
RealtimeModel|type|Transport abstraction (WebSocket by default)
OpenAIRealtimeSIPModel|class|Attach to phone calls over SIP
Session events (audio, tool_start, handoff, guardrail_tripped…)|event|Realtime event stream
semantic_vad / turn detection|config|When the user has finished speaking
VoicePipeline / SingleAgentVoiceWorkflow|class|STT → agent → TTS pipelines
AudioInput / StreamedAudioInput|class|Voice input sources
`) },
    { t: "Testing, visualization, REPL", url: B + "testing/", items: parse(`
Testing with fake models|technique|Swap in a Model implementation for deterministic tests|w
draw_graph()|function|Visualise agents, tools and handoffs
run_demo_loop()|function|Interactive REPL for an agent
`) },
  ],
};
