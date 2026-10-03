import { parse, type FrameworkDocs } from "./types";
const B = "https://docs.langchain.com/oss/python/deepagents/";
export const deepagentsDocs: FrameworkDocs = {
  source: B + "overview",
  checked: "2026-10-03",
  sections: [
    { t: "create_deep_agent", url: B + "customization", items: parse(`
create_deep_agent()|function|Factory for a deep agent graph|w
model|param|"provider:model" string or chat model|w
system_prompt|param|Base instructions|w
tools|param|Custom functions, LangChain tools or MCP tools|w
subagents|param|Declarative child agents|w
middleware|param|Extra middleware merged into the stack|w
backend|param|Storage for the virtual filesystem
interrupt_on|param|Tool names that pause for human approval
response_format|param|Structured output schema|w
checkpointer|param|LangGraph persistence for threads|w
store|param|Cross-thread long-term store
memory|param|AGENTS.md files loaded at start
skills|param|Directory of SKILL.md knowledge loaded on demand
permissions|param|Path-level filesystem access rules
state_schema / context_schema|param|Custom graph state and per-run context
cache / debug / name|param|Model caching, verbose tracing, agent name
`) },
    { t: "Built-in tools", url: B + "tools", items: parse(`
write_todos|tool|Planning: maintain a to-do list with statuses|w
ls / read_file / write_file / edit_file|tool|Virtual filesystem operations
glob / grep|tool|Find files and search contents
delete|tool|Remove files or directories
execute|tool|Shell commands (sandbox backends only)
task|tool|Spawn an ephemeral subagent for isolated work|w
MCP tools|tool|Connect databases, APIs and file systems via MCP
`) },
    { t: "Middleware", url: B + "customization", items: parse(`
TodoListMiddleware|class|Opt-in planning with status tracking|w
FilesystemMiddleware|class|Virtual filesystem with permissions and allowlists
SubAgentMiddleware|class|Spawn subagents and gather their results|w
AsyncSubAgentMiddleware|class|Asynchronous subagent execution
SummarizationMiddleware|class|Compress history and offload large results
PatchToolCallsMiddleware|class|Repair malformed tool calls
SkillsMiddleware / MemoryMiddleware|class|Inject skills catalog and memory files
AnthropicPromptCachingMiddleware / BedrockPromptCachingMiddleware|class|Prompt caching
HumanInTheLoopMiddleware|class|Approval gates before sensitive tools
AgentMiddleware|class|Base class for custom middleware|w
Middleware order|concept|Skills → Filesystem → SubAgent → Summarization → Patch → custom → caching → memory → HITL
`) },
    { t: "Subagents", url: B + "subagents", items: parse(`
SubAgent (name, description, system_prompt, tools, model, middleware)|type|Declarative subagent definition|w
CompiledSubAgent|type|Use any prebuilt LangGraph graph as a subagent
Context isolation|technique|Subagents start fresh so the parent context stays small|w
`) },
    { t: "Backends and sandboxes", url: B + "backends", items: parse(`
StateBackend|class|Thread-scoped files in graph state (default)
FilesystemBackend|class|Real local or network directories
LocalShellBackend|class|Filesystem plus shell execution
StoreBackend|class|Files persisted across threads in a LangGraph store
CompositeBackend|class|Route paths to different backends
ContextHubBackend|class|Durable storage in a LangSmith Hub repository
LangSmith / Daytona / E2B / Modal / Runloop / Vercel sandboxes|class|Isolated execution backends
Interpreters (QuickJS)|technique|Deterministic code execution
`) },
    { t: "Human-in-the-loop and permissions", url: B + "human-in-the-loop", items: parse(`
interrupt_on|config|Map tools to approval requirements
InterruptOnConfig|class|Allowed decisions (approve, edit, reject) per tool
Command(resume=…)|technique|Resume an interrupted graph with decisions
Permission rules|config|Glob allow/deny for reads and writes; first match wins
`) },
    { t: "Context engineering", url: B + "context-engineering", items: parse(`
Skills (SKILL.md)|concept|Progressive disclosure of domain knowledge
Memory (AGENTS.md)|concept|Persistent conventions and preferences
Summarization|technique|Compress history near token limits|p
Prompt caching|technique|Cache static prompts on Anthropic/Bedrock
Large result offloading|technique|Write big tool outputs to files instead of context
`) },
    { t: "LangGraph runtime", url: B + "event-streaming", items: parse(`
astream()/stream()|method|Stream messages, updates and subagent events|w
stream_mode="messages" / "updates"|config|What the stream emits|w
stream.subagents|technique|Typed projection of subagent messages and tool calls
AsyncSqliteSaver / checkpoint_id|class|Durable checkpoints; resume an exact step|w
thread_id|config|Conversation identity for checkpoints|w
Durable execution|concept|Resumable, observable runs on the LangGraph runtime|p
Going to production|concept|Deploy with LangGraph Platform / LangSmith
`) },
  ],
};
