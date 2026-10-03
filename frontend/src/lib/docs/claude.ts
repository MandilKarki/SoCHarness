import { parse, type FrameworkDocs } from "./types";
const B = "https://code.claude.com/docs/en/agent-sdk/";
export const claudeDocs: FrameworkDocs = {
  source: B + "overview",
  checked: "2026-10-03",
  sections: [
    { t: "Entry points", url: B + "python", items: parse(`
query()|function|One-off session: async iterator of messages
ClaudeSDKClient|class|Multi-turn session you can stream, interrupt and reconfigure|w
connect() / disconnect()|method|Open or close the underlying Claude Code process|w
client.query(prompt, session_id)|method|Send a request in streaming mode|w
receive_messages()|method|Every message as an async iterator
receive_response()|method|Messages until the terminal ResultMessage|w
interrupt()|method|Stop the current turn (streaming mode)|w
set_permission_mode() / set_model()|method|Change permissions or model mid-session
rewind_files(user_message_id)|method|Restore files to an earlier message (needs checkpointing)|p
get_mcp_status() / reconnect_mcp_server() / toggle_mcp_server()|method|Inspect and manage MCP servers live
get_context_usage()|method|Context-window usage breakdown
stop_task(task_id)|method|Stop a background task
get_server_info()|method|Initialisation details
Transport|class|Custom transport to the Claude process
list_sessions() / get_session_messages() / get_session_info()|function|Browse past sessions
rename_session() / tag_session()|function|Label sessions
`) },
    { t: "ClaudeAgentOptions", url: B + "python", items: parse(`
ClaudeAgentOptions|class|All session configuration|w
tools / allowed_tools / disallowed_tools|config|Which tools exist, which auto-approve, which are denied|w
system_prompt|config|String, Claude Code preset (+append), custom dict or file|w
mcp_servers / strict_mcp_config|config|MCP servers; ignore project config when strict|w
permission_mode|config|default, acceptEdits, plan, dontAsk, bypassPermissions, auto|w
can_use_tool|config|Callback that allows, denies or edits each tool call|w
hooks|config|HookEvent → list of HookMatcher|w
continue_conversation / resume / session_id / fork_session|config|Continue, resume or fork sessions|w
resume_session_at / resume_drops_turn|config|Resume up to a message, drop a truncated turn
max_turns|config|Maximum agentic turns|w
max_budget_usd|config|Stop when estimated cost reaches this amount|w
task_budget|config|API-side token budget
model / fallback_model|config|Model alias, plus fallback|w
thinking|config|Adaptive, enabled with budget, or disabled|w
effort|config|low → max reasoning effort
output_format|config|JSON-schema structured output|w
include_partial_messages|config|Stream partial message events|w
include_hook_events / forward_subagent_text|config|Surface hook events and subagent text
agents|config|Programmatic subagents (AgentDefinition)|w
plugins|config|Load local plugins|p
skills|config|Which skills are available|p
setting_sources|config|Load user, project or local settings|w
sandbox|config|Sandbox behaviour for commands
enable_file_checkpointing|config|Track file changes for rewind|p
session_store / session_store_flush / load_timeout_ms|config|Mirror sessions to an external store
cwd / add_dirs / env / user / cli_path / settings / extra_args|config|Process environment and paths|w
betas|config|Beta features such as 1M context
max_buffer_size / stderr|config|CLI output buffering and stderr callback
`) },
    { t: "Agent loop", url: B + "agent-loop", items: parse(`
Agent loop|concept|Claude plans, calls tools, reads results and decides when the task is done|w
ResultMessage|type|Terminal result with cost, usage and subtype|w
Turns|concept|Each model response plus its tool calls counts toward max_turns|w
`) },
    { t: "Tools and MCP", url: B + "mcp", items: parse(`
@tool|decorator|Define a typed MCP tool in Python|w
create_sdk_mcp_server()|function|Package tools into an in-process MCP server|w
SdkMcpTool|type|Definition produced by @tool|w
ToolAnnotations|type|readOnlyHint, destructiveHint and other hints
McpStdioServerConfig / McpSSEServerConfig / McpHttpServerConfig / McpSdkServerConfig|type|External and in-process MCP server configs|p
Built-in tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch…)|tool|Claude Code's own toolset; Relay disables these
ToolsPreset|type|Use the claude_code tool preset
`) },
    { t: "Permissions", url: B + "permissions", items: parse(`
PermissionMode|type|default, acceptEdits, plan, dontAsk, bypassPermissions, auto|w
CanUseTool|type|Permission callback signature|w
ToolPermissionContext|type|Context passed to the callback|w
PermissionResultAllow / PermissionResultDeny|type|Allow (optionally edit input) or deny (optionally interrupt)|w
PermissionUpdate / PermissionRuleValue|type|Add, replace or remove permission rules programmatically
`) },
    { t: "Hooks", url: B + "hooks", items: parse(`
HookMatcher|class|Which events and tools a hook applies to|w
HookCallback / HookContext|type|Hook function signature and context|w
PreToolUse|hook|Before a tool runs: allow, deny or modify|w
PostToolUse / PostToolUseFailure|hook|After a tool succeeds or fails|w
UserPromptSubmit|hook|When a prompt is submitted
Stop / SubagentStart / SubagentStop|hook|Run or subagent lifecycle
PreCompact|hook|Before conversation compaction
Notification / PermissionRequest|hook|Notifications and permission decisions
HookJSONOutput|type|What a hook returns (decision, reason, updated input)|w
`) },
    { t: "Subagents", url: B + "subagents", items: parse(`
AgentDefinition|class|Subagent: description, prompt, tools, model, skills, memory, MCP|w
description / prompt / tools / disallowedTools|param|When to use it, its instructions and tool limits|w
model / effort / maxTurns|param|Per-subagent model and limits|w
skills / memory / mcpServers|param|Preloaded skills, memory source, MCP servers
initialPrompt / background / permissionMode|param|Auto-start, run in background, own permission mode
TaskStartedMessage / TaskProgressMessage / TaskNotificationMessage|type|Background task lifecycle messages
`) },
    { t: "Sessions", url: B + "sessions", items: parse(`
Session resume|technique|Continue a conversation by session id|w
Session fork|technique|Branch a session into a new id
File checkpointing|technique|Rewind file edits to an earlier message|p
`) },
    { t: "Messages and content", url: B + "python", items: parse(`
UserMessage / AssistantMessage / SystemMessage|type|Conversation messages|w
StreamEvent|type|Partial message update when streaming|w
RateLimitEvent / RateLimitInfo|type|Rate-limit status changes
ConversationResetMessage|type|Conversation replaced (e.g. after /clear)
TextBlock / ThinkingBlock / ToolUseBlock / ToolResultBlock|type|Content blocks|w
ServerToolUseBlock / ServerToolResultBlock|type|Server-side tool blocks
`) },
    { t: "Skills, commands, memory, plugins", url: B + "skills", items: parse(`
Skills|concept|Packaged instructions loaded from .claude/ or ~/.claude/|p
Slash commands|concept|Commands available inside SDK sessions
Memory (CLAUDE.md)|concept|Project and user memory loaded as system context
Plugins|concept|Bundle skills, agents, hooks and MCP servers; load by path|p
Modifying system prompts|technique|Preset with append, or fully custom|w
`) },
    { t: "Structured outputs, cost and errors", url: B + "python", items: parse(`
OutputFormat|type|{"type": "json_schema", "schema": …}|w
Cost tracking|technique|Read total cost and usage from ResultMessage|w
ThinkingConfig / EffortLevel|type|Thinking and effort settings|w
ClaudeSDKError|exception|Base SDK error|w
CLINotFoundError / CLIConnectionError|exception|CLI missing or connection failed
ProcessError / ResultError|exception|Process failed or run ended with an error result|w
CLIJSONDecodeError|exception|Malformed process output
`) },
  ],
};
