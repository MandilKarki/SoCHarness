import { parse, type FrameworkDocs } from "./types";
const B = "https://adk.dev/";
export const googleAdkDocs: FrameworkDocs = {
  source: B,
  checked: "2026-10-03",
  sections: [
    { t: "LLM agents", url: B + "agents/llm-agents/", items: parse(`
LlmAgent (Agent)|class|Model-driven agent with instructions and tools|w
name / model / description|param|Identity, model and a routing description|w
instruction|param|Behaviour template; supports {state} templating|w
tools|param|Function tools, BaseTool instances or AgentTools|w
generate_content_config|param|Temperature, max tokens, safety settings|w
input_schema / output_schema|param|Structured input and enforced JSON output|w
output_key|param|Save the final response into session state
include_contents|param|Send history ("default") or not ("none")
planner|param|BuiltInPlanner or PlanReActPlanner
code_executor|param|Execute code blocks the model writes
sub_agents|param|Child agents for delegation/transfer
State templating {var} / {var?}|technique|Insert state values into instructions
Agent Config (YAML)|technique|Define agents declaratively
`) },
    { t: "Workflow and multi-agent", url: B + "workflows/", items: parse(`
SequentialAgent|class|Run sub-agents in order
ParallelAgent|class|Run sub-agents concurrently
LoopAgent|class|Repeat sub-agents until escalation or max iterations
BaseAgent / _run_async_impl|class|Custom agents with your own control flow
transfer_to_agent|technique|LLM-driven delegation to a sub-agent
AgentTool|class|Call another agent as a tool
Agent routing / workflow patterns|technique|Coordinator, pipeline, fan-out/gather, review loops
Graph workflows (ADK 2.0)|concept|Routes, data handling, human input, dynamic graphs
`) },
    { t: "Tools", url: B + "tools-custom/", items: parse(`
FunctionTool|class|Wrap a Python function as a tool|w
BaseTool|class|Base class for custom tools|w
ToolContext|class|State, artifacts, memory search and auth inside a tool|w
LongRunningFunctionTool|class|Tools that return later (async work, approvals)
Action confirmations|technique|Ask the user before a tool runs
MCPToolset|class|Use MCP server tools
Agent as MCP server|technique|Expose an ADK agent over MCP
OpenAPIToolset|class|Generate tools from an OpenAPI spec
Tool authentication|technique|OAuth and API-key credential flows
google_search / built-in code execution / Vertex AI Search|tool|Gemini built-in tools and grounding
Skills|concept|Packaged instructions for agents
`) },
    { t: "Runtime", url: B + "runtime/", items: parse(`
Runner|class|Runs an agent against a session service, yielding events|w
InMemoryRunner|class|Runner with in-memory services
run_async()|method|Run a turn and stream Events|w
RunConfig|class|Per-run configuration|w
max_llm_calls|config|Bound model calls in a run|w
streaming_mode (NONE / SSE / BIDI)|config|How responses stream|w
Event loop|concept|Runner ↔ agent yield/resume cycle|w
Resume / cancel agent runs|technique|Continue or stop runs
adk web / adk run / adk api_server|cli|Dev UI, terminal runner, REST API server
Ambient agents|concept|Agents triggered by events rather than chat
`) },
    { t: "Sessions, state and memory", url: B + "sessions/", items: parse(`
Session|class|One conversation: id, events and state|w
SessionService|type|Create, get, list and delete sessions|w
InMemorySessionService|class|In-memory sessions (lost on restart)|w
DatabaseSessionService / VertexAiSessionService|class|Persistent sessions
State prefixes (none, user:, app:, temp:)|concept|Scope state to session, user, app or invocation
Event|class|Record of a message, tool call or action|w
EventActions (state_delta, artifact_delta, transfer_to_agent, escalate)|class|Side effects carried by events|w
Rewind / migrate sessions|technique|Roll back or move sessions
MemoryService|type|Searchable long-term memory across sessions
InMemoryMemoryService / VertexAiMemoryBankService|class|Memory backends
load_memory / PreloadMemoryTool|tool|Retrieve memory on demand or up front
Context compaction / context caching|technique|Shrink history; cache model context
`) },
    { t: "Artifacts", url: B + "artifacts/", items: parse(`
ArtifactService|type|Store binary/named data per session or user
InMemoryArtifactService / GcsArtifactService|class|Artifact backends
save_artifact() / load_artifact()|method|Write and read artifacts from context
`) },
    { t: "Callbacks and plugins", url: B + "callbacks/", items: parse(`
before_agent_callback / after_agent_callback|hook|Around an agent's run
before_model_callback / after_model_callback|hook|Inspect or replace model requests and responses
before_tool_callback / after_tool_callback|hook|Validate arguments or rewrite results
CallbackContext|class|State and artifact access inside callbacks
BasePlugin / Plugins|class|App-wide callbacks (logging, policy, global instructions)
`) },
    { t: "Models", url: B + "agents/models/", items: parse(`
Gemini / Gemma|module|Google models (GOOGLE_API_KEY or Vertex)|w
Claude / OpenAI / Ollama / vLLM|module|Other providers
LiteLlm|class|Use LiteLLM-supported models
Model routing / Apigee AI Gateway|technique|Route requests across models
`) },
    { t: "Live and voice", url: B + "live/", items: parse(`
run_live()|method|Bidirectional streaming sessions
LiveRequestQueue|class|Send audio, video and text into a live run
Live tools / guardrails / evaluation|concept|Tool use and safety in live sessions
`) },
    { t: "A2A", url: B + "a2a/", items: parse(`
to_a2a()|function|Expose an agent over the A2A protocol
RemoteA2aAgent|class|Consume a remote A2A agent as a sub-agent
A2A extension|concept|Protocol extensions
`) },
    { t: "Evaluation, observability, deployment", url: B + "evaluate/", items: parse(`
adk eval / AgentEvaluator|cli|Run evaluation sets against an agent
Criteria / user simulation / environment simulation / custom metrics|concept|Evaluation methods
Logging / metrics / traces|concept|Observability (OpenTelemetry)
Agent Runtime / Cloud Run / GKE|concept|Deployment targets
adk deploy|cli|Deploy an agent
Safety and security|concept|Guardrails, sandboxing and auth guidance
`) },
  ],
};
