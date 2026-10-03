import { parse, type FrameworkDocs } from "./types";
const B = "https://docs.openhands.dev/sdk/";
export const openhandsDocs: FrameworkDocs = {
  source: B + "arch/sdk",
  checked: "2026-10-03",
  sections: [
    { t: "Conversation", url: B + "arch/sdk", items: parse(`
Conversation|class|Owns lifecycle, state and the event stream|w
LocalConversation / RemoteConversation|class|In-process or remote (agent server) conversations|p
send_message()|method|Append user input|w
run()|method|Run the reasoning loop until finished or paused|w
pause()|method|Pause execution
state|property|Immutable snapshot of the conversation|w
Conversation persistence|technique|Save and restore conversations|w
Pause and resume|technique|Stop mid-task and continue later
Stuck detector|technique|Detect loops and repeated failures
`) },
    { t: "Agent and LLM", url: B + "guides/agent-custom", items: parse(`
Agent|class|Stateless reasoning engine over conversation history|w
Custom agents|technique|Compose agents from tools, prompts and condensers
LLM|class|Provider-agnostic model interface|w
LLMRegistry|class|Register and reuse multiple LLMs
LLM routing|technique|Route requests between models
Reasoning and tool use|concept|Reasoning-model configuration
max_iteration_per_run|config|Bound steps per run|w
`) },
    { t: "Tools", url: B + "arch/tool-system", items: parse(`
ToolDefinition|class|Typed tool schema and executor binding|w
Action|class|Typed input for a tool call|w
Observation|class|Typed tool output|w
ToolExecutor|class|Turns an Action into an Observation|w
Custom tools|technique|Define your own action/observation pairs|w
FinishTool|tool|Signals the task is complete|w
ThinkTool|tool|Record reasoning without acting
BashTool|tool|Shell commands in the workspace
FileEditorTool|tool|Create and edit files
TaskTrackerTool|tool|Track task progress
BrowserToolSet|tool|Web navigation tools
MCP|concept|Use MCP servers as tools
`) },
    { t: "Events", url: B + "arch/sdk", items: parse(`
Event stream|concept|Immutable, serialisable timeline of everything|w
ActionEvent|event|A tool was invoked|w
ObservationEvent|event|A tool returned|w
MessageEvent|event|A conversation message|w
Callbacks|hook|Lifecycle callbacks on events|w
`) },
    { t: "Workspace", url: B + "arch/workspace", items: parse(`
Workspace|type|Where actions execute
LocalWorkspace|class|Run on the local machine
DockerWorkspace|class|Run in a container
RemoteWorkspace|class|Run via a remote agent server
Agent server|concept|Host conversations remotely over an API
`) },
    { t: "Context, security and skills", url: B + "guides/context-condenser", items: parse(`
LLMSummarizingCondenser|class|Summarise history to stay within limits
SecurityAnalyzer|class|Assess risk of actions and commands
ConfirmationPolicy|class|Require human confirmation for risky actions
Secrets management|technique|Inject and mask secrets
Skill (microagents)|class|Modular knowledge and behaviour
Metrics and observability|concept|Token, cost and latency metrics
`) },
  ],
};
