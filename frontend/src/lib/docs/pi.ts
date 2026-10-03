import { parse, type FrameworkDocs } from "./types";
const B = "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/";
export const piDocs: FrameworkDocs = {
  source: B + "sdk.md",
  checked: "2026-10-03",
  sections: [
    { t: "Sessions", url: B + "sdk.md", items: parse(`
createAgentSession()|function|Create a session with optional overrides|w
AgentSession|class|One conversation: model, tools, messages and extensions|w
session.prompt()|method|Send a message and wait for the run to finish|w
session.steer()|method|Queue a message after the current assistant turn
session.followUp()|method|Queue a message after the current run completes
session.abort()|method|Stop active work and wait for idle|w
session.waitForIdle()|method|Wait without aborting
session.subscribe()|method|Listen to message and lifecycle events|w
session.dispose()|method|Clean up resources and listeners|w
session.messages / model / thinkingLevel / systemPrompt|property|Live session state|w
session.getActiveToolNames()|method|List enabled tools
session.bindExtensions()|method|Attach extension servers such as MCP
`) },
    { t: "Options", url: B + "sdk.md", items: parse(`
model / modelRuntime / scopedModels|config|Default model, model access, per-tool overrides|w
thinkingLevel|config|Reasoning depth|w
tools / noTools / excludeTools|config|Choose, disable or remove default tools|w
customTools|config|Add your own tool implementations|w
settingsManager|config|Merged or in-memory settings|w
sessionManager|config|Persistent or in-memory storage|w
resourceLoader / DefaultResourceLoader / ResourceLoader|config|Discover extensions, skills, templates, context files|p
cwd|config|Workspace for discovery and grouping|w
extensionFactories / InlineExtension|config|Register extensions inline or from files
`) },
    { t: "Persistence and branching", url: B + "sdk.md", items: parse(`
SessionManager|class|Owns the persisted entry tree and branches|w
SessionManager.inMemory()|function|Non-persistent session manager
SessionManager.forkFrom()|method|Fork from an earlier session (Relay pin)|w
AgentSessionRuntime (newSession, switchSession, fork)|class|Manage several sessions
JSONL session tree|concept|Append-only log that can branch non-destructively|w
Compaction|concept|Rebuild model context from persisted entries|p
`) },
    { t: "Events", url: B + "sdk.md", items: parse(`
message_update|event|Incremental message changes|w
text_delta|event|Streamed text fragment|w
message_end|event|Authoritative completed message|w
agent_end|event|One agent run cycle finished|w
agent_settled|event|Pi won't continue automatically|w
session_start|event|Extensions initialise (e.g. MCP connects)
`) },
    { t: "Extensions", url: B + "sdk.md", items: parse(`
Extensions|concept|Self-written, hot-reloadable add-ons (disabled in Relay)
createCodemodeExtension()|function|Built-in code-mode extension
createToolSearchExtension()|function|Built-in tool search
createMcpExtension()|function|Built-in MCP support
defaultTools / additionalExtensionPaths|config|Enable built-ins like +codemode or builtin:<name>
project_trust|hook|Decide whether to trust a project
Four core tools (read, write, edit, bash)|tool|The minimal default toolset (replaced in Relay)
`) },
  ],
};
