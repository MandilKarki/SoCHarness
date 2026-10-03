import { parse, type FrameworkDocs } from "./types";
const B = "https://learn.microsoft.com/en-us/agent-framework/";
export const microsoftDocs: FrameworkDocs = {
  source: B + "overview/agent-framework-overview",
  checked: "2026-10-03",
  sections: [
    { t: "Agents", url: B + "concepts/agents/", items: parse(`
Agent|class|Standard agent over any supported chat client|w
ChatAgent|class|Conversational agent variant|p
client|param|Chat client that performs inference|w
instructions|param|System instructions|w
tools|param|Function, hosted and MCP tools|w
response_format|param|Structured output schema|w
run()|method|Execute and return an AgentResponse|w
stream=True|param|Stream AgentResponseUpdate items|w
AgentResponse / AgentResponseUpdate|class|Final response / streaming update|w
get_final_response()|method|Collect the final response from a stream|w
Harness agent|class|Batteries-included agent: planning, to-dos, compaction, files, memory, approvals
Declarative agents|technique|Define agents from configuration
`) },
    { t: "Sessions and memory", url: B + "concepts/agents/conversations/session", items: parse(`
AgentSession|class|Conversation state container (formerly threads)|w
create_session()|method|Start a new session|w
to_dict() / from_dict()|method|Serialise and restore a session|w
Service-managed history|concept|Provider stores history (Responses/Foundry)
In-memory / custom history|concept|Your app stores history|w
Context providers|concept|Inject memory or retrieved context per call
`) },
    { t: "Tools", url: B + "agents/tools/", items: parse(`
@tool / function tools|decorator|Plain Python functions as tools|w
FunctionTool|class|Explicit tool definition|w
approval_mode|param|Require human approval before a tool runs
Hosted tools|tool|Provider tools: code interpreter, file search, web search
MCP tools|tool|Local and hosted MCP servers
`) },
    { t: "Middleware", url: B + "concepts/agents/middleware/", items: parse(`
Agent middleware|hook|Wrap whole agent runs
Function middleware|hook|Wrap individual tool invocations
Chat middleware|hook|Wrap chat-client requests and responses
Filters / termination|technique|Enforce policy, redact, or stop runs
`) },
    { t: "Chat clients and providers", url: B + "integrations/by-component/model-providers/", items: parse(`
OpenAIChatClient|class|OpenAI Chat Completions client|w
OpenAIResponsesClient|class|OpenAI Responses client
AzureOpenAIChatClient / AzureOpenAIResponsesClient|class|Azure OpenAI clients
FoundryChatClient|class|Microsoft Foundry client
Anthropic / Ollama / Gemini / Bedrock / Mistral|module|Other providers
Background responses|concept|Long-running provider-side responses
`) },
    { t: "Workflows", url: B + "concepts/workflows/", items: parse(`
Executor / @executor|class|Workflow node that receives input and emits output
WorkflowContext|class|send_message(), yield_output(), state and events
WorkflowBuilder|class|Build typed graphs: add_edge(), set_start_executor(), build()
Direct / conditional / switch-case / fan-out / fan-in edges|concept|Routing between executors
run() / run_stream()|method|Execute a workflow, optionally streaming events
WorkflowOutputEvent|event|Workflow produced output
@workflow (functional)|decorator|Workflows with native Python control flow
Sub-workflows / agent executors|technique|Nest workflows; use agents as nodes
CheckpointStorage|class|Durable workflow state and resume
RequestInfoExecutor|class|Human-in-the-loop request/response
Shared state|concept|Workflow-scoped variables
`) },
    { t: "Orchestrations", url: B + "concepts/workflows/", items: parse(`
Sequential|technique|Agents in a fixed order
Concurrent|technique|Agents in parallel, results aggregated
Handoff|technique|Agents transfer control
Group chat|technique|Managed multi-agent conversation
Magentic|technique|Manager-led planning across agents
`) },
    { t: "Observability, tooling and migration", url: B + "overview/agent-framework-overview", items: parse(`
Observability (OpenTelemetry)|concept|Traces, logs and metrics
DevUI|cli|Local UI to test agents and workflows
A2A|concept|Agent-to-agent interoperability
Migration from Semantic Kernel / AutoGen|technique|Guides for existing projects
`) },
  ],
};
