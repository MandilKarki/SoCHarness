import type { DeepDive } from "./types";

const B = "https://code.claude.com/docs/en/agent-sdk/";

export const claude: DeepDive = {
  intro:
    "The Claude Agent SDK does not run the agent loop in Python. It starts the Claude Code CLI as a subprocess and exchanges JSON messages with it. The loop, the tools and the permission engine live in that process. Your hooks, permission callback and in-process tools are called back into your code over the same channel.",
  chapters: [
    {
      id: "transport",
      title: "A subprocess and a JSON message stream",
      hook: "Where does the loop actually run, and how does your code take part in it?",
      diagram: {
        kind: "lanes",
        actors: ["Your code", "SDK (Python)", "Claude Code CLI", "Claude API"],
        msgs: [
          { from: 0, to: 1, t: "client.query(prompt)", s: "You send a prompt. `query()` opens a one-shot session; `ClaudeSDKClient` keeps one open across turns.", tag: "you" },
          { from: 1, to: 2, t: "stream-json on stdin", s: "The SDK starts the CLI with `--output-format stream-json` and writes your prompt as a JSON line.", tag: "core" },
          { from: 2, to: 3, t: "model call", s: "The CLI runs the agent loop: system prompt, tool definitions and history go to the model.", tag: "model" },
          { from: 2, to: 1, t: "control_request", s: "When it needs you, the CLI asks over the same pipe: `can_use_tool`, `hook_callback` or `mcp_message`.", tag: "guard" },
          { from: 1, to: 2, t: "control_response", s: "The SDK runs your Python callback and writes its answer back. The CLI waits for it.", tag: "guard" },
          { from: 2, to: 1, t: "Assistant / User messages", s: "Each content block arrives as an `AssistantMessage`; each tool result as a `UserMessage`.", tag: "event" },
          { from: 1, to: 0, t: "ResultMessage", s: "The loop ends with a `ResultMessage` carrying subtype, cost, usage and `session_id`.", tag: "stop" },
        ],
      },
      explain: [
        "The Python package is a client. It launches the Claude Code CLI (a bundled binary) and talks to it over stdin and stdout using newline-delimited JSON. Messages flow out as typed objects: `SystemMessage` (subtype `init` first), `AssistantMessage`, `UserMessage` for tool results, optional `StreamEvent`s, and a final `ResultMessage`.",
        "The same pipe carries control requests in the other direction. When the CLI needs a permission decision, a hook result or a call to one of your in-process tools, it sends a request and waits for your reply. That is why your callbacks can be plain async Python functions.",
        "`query()` is one prompt, one session, then the process exits. `ClaudeSDKClient` keeps the process alive: several `client.query()` calls share one session, and you can call `interrupt()`, `set_permission_mode()` or `set_model()` between or during turns.",
      ],
      code: {
        lang: "python",
        caption: "A persistent client: two turns in one session, reading the typed message stream.",
        src: `from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient,
                              ResultMessage, SystemMessage, TextBlock)

options = ClaudeAgentOptions(tools=[], max_turns=4, permission_mode="default")

async with ClaudeSDKClient(options=options) as client:
    for prompt in ["Summarise alert 4812: 9 failed logins, then success from 203.0.113.7",
                   "Which account should be reset first?"]:
        await client.query(prompt)              # same session, same CLI process
        async for msg in client.receive_response():
            if isinstance(msg, SystemMessage) and msg.subtype == "init":
                print("session:", msg.data.get("session_id"))
            elif isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        print(block.text)
            elif isinstance(msg, ResultMessage):
                print(msg.subtype, msg.num_turns, msg.total_cost_usd)`,
      },
      soc: "The agent runs as a separate process with its own filesystem and network reach, so isolate it like any other workload (container, no ambient credentials). Relay keeps it in-process from Python's point of view but disables the CLI's built-in tools.",
      url: B + "agent-loop",
    },
    {
      id: "permissions",
      title: "The permission evaluation order",
      hook: "When Claude asks for a tool, which check decides, and in what order?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "PreToolUse hooks", s: "Hooks run first on every call. A hook deny blocks it, even in `bypassPermissions`. A hook allow does not skip the rule checks below.", u: "Hooks also see the call again in `PostToolUse` once it has run.", tag: "guard" },
          { t: "Deny and ask rules", s: "Scoped deny rules such as `Bash(rm *)` block in every mode. An ask rule sends the call straight to your callback.", u: "A denied call returns a rejection message to Claude as the tool result.", tag: "guard" },
          { t: "Permission mode", s: "`bypassPermissions` approves here; `acceptEdits` approves file edits; `plan` routes writes to your callback; `dontAsk` will deny anything still unresolved.", u: "Approved calls run without ever reaching the callback.", tag: "state" },
          { t: "Allow rules", s: "`allowed_tools` entries approve matching calls. Read-only calls a tool approves on its own also resolve here.", u: "Auto-approved calls skip `can_use_tool` completely.", tag: "state" },
        ],
        core: { t: "can_use_tool callback", s: "Only calls nothing above resolved reach your callback. It returns `PermissionResultAllow` (optionally with edited input) or `PermissionResultDeny`.", tag: "you" },
      },
      explain: [
        "Every tool request walks the same six steps: hooks, deny rules, ask rules, permission mode, allow rules, then `can_use_tool`. The first step that reaches a verdict wins, except that a hook allow still lets deny and ask rules run. `bypassPermissions` cannot override a deny rule or a hook deny.",
        "A bare name in `disallowed_tools` (for example `Bash`) removes the tool from Claude's context before evaluation starts; a scoped rule leaves it visible and blocks only matching calls. `allowed_tools` does not restrict anything: unlisted tools fall through to the mode, and `bypassPermissions` approves them.",
        "The trap is the callback. Anything approved earlier never reaches `can_use_tool`, so it is not an audit point. Put checks that must see every call in a `PreToolUse` hook. Subagents run in the parent's mode, and a subagent only runs in `bypassPermissions` when the parent does.",
      ],
      code: {
        lang: "python",
        caption: "A narrow tool surface: one tool auto-approved, one removed, the rest routed to an analyst.",
        src: `from claude_agent_sdk import ClaudeAgentOptions, PermissionResultAllow, PermissionResultDeny

async def analyst_gate(tool_name, tool_input, context):
    # Reached only by calls that no hook, rule or mode resolved.
    if tool_name == "mcp__relay__isolate_host":
        if not await analyst_approves(tool_input["host"], context.tool_use_id):
            return PermissionResultDeny(message="Analyst rejected isolation")
    return PermissionResultAllow()

options = ClaudeAgentOptions(
    tools=[],                                       # no built-in tools in context
    mcp_servers={"relay": relay_server},
    allowed_tools=["mcp__relay__lookup_ip"],        # auto-approved: skips the callback
    disallowed_tools=["mcp__relay__delete_case"],   # bare name: removed from context
    permission_mode="default",                      # set it: unset may start in auto
    can_use_tool=analyst_gate,
)`,
      },
      soc: "Containment approvals belong in `can_use_tool` only if the tool is not also in `allowed_tools` and the mode is not `bypassPermissions`. Audit and hard blocks belong in a `PreToolUse` hook, because that is the only layer that sees every call.",
      url: B + "permissions",
    },
    {
      id: "hooks",
      title: "Hook lifecycle: what fires, when, and what it can change",
      hook: "At which points can your code observe or steer a run?",
      diagram: {
        kind: "timeline",
        legend: { you: "input", guard: "can block", event: "observe or annotate", stop: "end" },
        events: [
          { t: "UserPromptSubmit", s: "Fires when a prompt is submitted. It can add `additionalContext` or block the prompt.", tag: "you" },
          { t: "PreToolUse", s: "Before each tool call. Returns `permissionDecision` allow, deny, ask or defer, and optional `updatedInput`.", tag: "guard" },
          { t: "Tool runs", s: "Only if the hook and the rest of the permission chain let it through.", tag: "event" },
          { t: "PostToolUse / Failure", s: "After success or failure. `additionalContext` appends to the result; `updatedToolOutput` replaces it before Claude reads it.", tag: "event" },
          { t: "SubagentStart / Stop", s: "Around each subagent. Tool hooks inside a subagent carry `agent_id` so you can attribute them.", tag: "event" },
          { t: "PreCompact", s: "Before older history is summarised, with `trigger` manual or auto. Archive the full transcript here.", tag: "event" },
          { t: "Stop", s: "When the agent finishes responding. Matchers are ignored for this event.", tag: "stop" },
        ],
      },
      explain: [
        "A hook is an async function `(input_data, tool_use_id, context)` registered through `HookMatcher(matcher=..., hooks=[...], timeout=...)` under an event name in `hooks=`. For tool events the matcher is tested against the tool name, so `mcp__relay__.*` style patterns target your MCP tools. No matcher means every call.",
        "Return `{}` to make no decision. To act, return `hookSpecificOutput` with `hookEventName` and the event's fields. All matching hooks run in parallel; for permission decisions deny beats defer, defer beats ask, ask beats allow. `continue_` (underscore in Python) set to False stops the agent.",
        "A `PreToolUse` callback that exceeds its timeout does not let the call through: the tool is not run and Claude gets a timeout result (current CLI behaviour; older versions differed). Python lacks some TypeScript-only events, such as `SessionStart`.",
      ],
      code: {
        lang: "python",
        caption: "A hard block for domain controllers plus an audit hook on every tool call.",
        src: `from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

CROWN_JEWELS = {"dc01", "dc02"}

async def guard_isolation(input_data, tool_use_id, context):
    host = str(input_data["tool_input"].get("host", "")).lower()
    if host in CROWN_JEWELS:
        return {"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": f"{host} is a domain controller; escalate to L3",
        }}
    return {}  # no decision: the normal permission chain continues

async def audit(input_data, tool_use_id, context):
    write_audit(input_data["session_id"], tool_use_id, input_data["hook_event_name"],
                input_data.get("tool_name"))
    return {}

options = ClaudeAgentOptions(hooks={
    "PreToolUse": [HookMatcher(matcher="mcp__relay__isolate_host", hooks=[guard_isolation]),
                   HookMatcher(hooks=[audit])],
    "PostToolUse": [HookMatcher(hooks=[audit])],
})`,
      },
      soc: "Hooks are the enforcement and audit layer: they run in your process, cost no context, and see subagent tool calls too. Relay registers an observing hook on the tool, compaction and subagent events and does the blocking in its permission callback.",
      url: B + "hooks",
    },
    {
      id: "sdk-mcp",
      title: "In-process tools are an MCP server in your process",
      hook: "How does a Python function become a tool Claude can call?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "@tool(name, desc, schema)", s: "The decorator wraps an async function. The schema is a dict like `{\"ip\": str}` or full JSON Schema.", tag: "you" },
          { t: "create_sdk_mcp_server()", s: "Tools are packed into an MCP server object that lives in your Python process, not a separate one.", tag: "core" },
          { t: "mcp_servers={\"relay\": …}", s: "The dict key becomes the server name. Tools are exposed as `mcp__relay__<tool>`.", tag: "state" },
          { t: "Permission chain", s: "The call goes through hooks and rules like any tool. List it in `allowed_tools` to skip prompting.", tag: "guard" },
          { t: "mcp_message → handler", s: "The CLI forwards the call over the control channel; your handler runs with validated arguments.", tag: "tool" },
          { t: "{content, is_error}", s: "The returned content blocks become the tool result Claude reads. Exceptions become error results too.", tag: "model" },
        ],
      },
      explain: [
        "`@tool` takes a name, a description, an input schema and optional `annotations`. The handler receives one dict of arguments, already validated, and returns `{\"content\": [...]}`. Set `\"is_error\": True` to write the error text Claude sees; an uncaught exception is also turned into an error result, and the loop continues either way.",
        "Naming and access are two layers. `tools=[]` removes every built-in tool from context; MCP tools are unaffected. `allowed_tools` takes exact names or a server wildcard such as `mcp__relay__*`. `ToolAnnotations(readOnlyHint=True)` lets read-only tools run in parallel; it is a hint, not enforcement.",
        "Because the handler runs in your process, it can read your case context, database pools and credentials directly. None of that passes through the model. Tool search, on by default, may defer tool schemas so Claude loads them on demand.",
      ],
      code: {
        lang: "python",
        caption: "A case-scoped, read-only enrichment tool; the tenant comes from your code, not the model.",
        src: `from typing import Any
from claude_agent_sdk import (ClaudeAgentOptions, ToolAnnotations, create_sdk_mcp_server,
                              tool)

@tool("lookup_ip", "Reputation and first-seen date for an IP in the current case",
      {"ip": str}, annotations=ToolAnnotations(readOnlyHint=True))
async def lookup_ip(args: dict[str, Any]) -> dict[str, Any]:
    rep = await intel.reputation(CURRENT_CASE.tenant, args["ip"])
    if rep is None:
        return {"content": [{"type": "text", "text": "No record for this IP"}],
                "is_error": True}
    return {"content": [{"type": "text", "text": rep.summary}]}

relay = create_sdk_mcp_server(name="relay", version="1.0.0", tools=[lookup_ip])
options = ClaudeAgentOptions(
    tools=[],                                   # drop Read, Bash, Edit and the rest
    mcp_servers={"relay": relay},
    allowed_tools=["mcp__relay__lookup_ip"],    # or "mcp__relay__*"
)`,
      },
      soc: "This is how Relay exposes its tool gateway: one in-process `relay` server, built-ins removed. Tenant and case scope stay in Python, so injected alert text cannot change which tenant a tool queries.",
      url: B + "custom-tools",
    },
    {
      id: "subagents",
      title: "Subagents: a fresh context behind one tool call",
      hook: "What does a subagent see, and what comes back to the parent?",
      diagram: {
        kind: "tree",
        root: { t: "Agent tool call", s: "The parent calls the `Agent` tool with a `subagent_type` and a prompt string. The subagent runs its own loop.", tag: "core" },
        children: [
          {
            t: "What it receives", s: "A new conversation, not a copy of the parent's (unless it is a fork).", tag: "state",
            children: [
              { t: "Its prompt + the task", s: "`AgentDefinition.prompt` as system prompt, plus the Agent tool's prompt string. Nothing else from the parent.", tag: "you" },
              { t: "Its tool subset", s: "`tools` limits what it can call; omitted means it inherits the tools available to subagents.", tag: "tool" },
            ],
          },
          {
            t: "What it does not get", s: "The isolation is the point: intermediate work never enters the parent's context.", tag: "guard",
            children: [
              { t: "Parent history", s: "No parent messages, tool results or system prompt. Pass file paths, IDs and decisions in the prompt.", tag: "guard" },
            ],
          },
          { t: "Final message only", s: "The parent receives the subagent's final report as the tool result. Messages from inside carry `parent_tool_use_id`.", tag: "model" },
          {
            t: "Caps", s: "Claude decides when to delegate, so the limits must be set in config.", tag: "stop",
            children: [
              { t: "Depth / concurrency env", s: "`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default 3) and `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20) via `env`.", tag: "stop" },
              { t: "max_budget_usd covers all", s: "Subagent spend counts toward the query total; at the cap, new spawns fail with `Budget limit reached`.", tag: "stop" },
            ],
          },
        ],
      },
      explain: [
        "Define subagents with `agents={\"name\": AgentDefinition(...)}`. `description` tells Claude when to use one; `prompt`, `tools`, `model`, `maxTurns` and `permissionMode` shape it (camelCase in Python, matching the wire format). Claude invokes them through the `Agent` tool, which older CLI versions named `Task`, so match both when detecting calls.",
        "Subagents can spawn their own subagents and, in current versions, run in the background by default unless Claude needs the result first or you set `background`. A completed subagent returns an `agentId`, and you can resume it by resuming the parent session.",
      ],
      code: {
        lang: "python",
        caption: "A read-only reviewer subagent, no nesting, one shared budget.",
        src: `from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions, query

reviewer = AgentDefinition(
    description="Checks each claim in a triage summary against case evidence.",
    prompt="You verify claims. Cite event IDs. Never take containment actions.",
    tools=["mcp__relay__case_events", "mcp__relay__lookup_ip"],   # read-only subset
    model="inherit",
    maxTurns=5,
)
options = ClaudeAgentOptions(
    tools=["Agent"],
    mcp_servers={"relay": relay},
    allowed_tools=["Agent", "mcp__relay__case_events", "mcp__relay__lookup_ip"],
    agents={"evidence-reviewer": reviewer},
    env={"CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "1"},   # reviewers cannot delegate
    max_budget_usd=2.0,
)
async for msg in query(prompt="Triage case 4812, then have the summary reviewed",
                       options=options):
    if getattr(msg, "parent_tool_use_id", None):
        print("inside subagent:", type(msg).__name__)`,
      },
      soc: "A reviewer subagent with read-only tools is a cheap second opinion that cannot contain or delete anything. Relay defines two such named specialists and refuses background or resumed subagent calls in its permission callback.",
      url: B + "subagents",
    },
    {
      id: "sessions",
      title: "Sessions: continue, resume and fork",
      hook: "How does a conversation survive a restart, and what does it not restore?",
      diagram: {
        kind: "loop",
        center: "Session transcript",
        exit: "a fork copies history into a new session ID",
        steps: [
          { t: "Run writes JSONL", s: "The CLI appends every prompt, tool call, result and response to a transcript on local disk.", tag: "state" },
          { t: "ResultMessage.session_id", s: "Every result, success or error, carries the session ID. Store it with the case.", tag: "event" },
          { t: "resume=session_id", s: "A later `query()` loads that transcript, so Claude has the earlier evidence and decisions in context.", tag: "core" },
          { t: "New turns appended", s: "The resumed run adds to the same session. Files on disk are not rolled back; only the conversation is restored.", tag: "state" },
        ],
      },
      explain: [
        "Three options pick an existing session. `continue_conversation=True` takes the most recent one in the working directory. `resume=<id>` takes a specific one. `fork_session=True` together with `resume` copies the history into a new session ID and leaves the original untouched.",
        "Transcripts live under `~/.claude/projects/<encoded-cwd>/` on the machine that ran them. To resume on another host, copy the file, attach a `session_store`, or skip resume and pass your own summary into a fresh session. `ClaudeSDKClient` tracks the ID for you within one process.",
      ],
      code: {
        lang: "python",
        caption: "Resume the case session for a follow-up, and fork it to test a second hypothesis.",
        src: `from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

async def ask(prompt: str, **opts) -> str | None:
    session_id = None
    try:
        async for msg in query(prompt=prompt, options=ClaudeAgentOptions(**opts)):
            if isinstance(msg, ResultMessage):
                session_id = msg.session_id
    except Exception as err:          # query() raises after an error result
        log.warning("run ended early: %s", err)
    return session_id

case_session = await ask("Triage alert 4812", max_turns=8)
await ask("Which hosts did the attacker touch?", resume=case_session)
branch = await ask("Assume the VPN login was legitimate. Re-assess.",
                   resume=case_session, fork_session=True)   # original unchanged`,
      },
      soc: "Key sessions by case and store the ID with the case record, but treat the transcript as sensitive data on the host's disk. Relay resumes SDK sessions and keeps partial transcripts after a failed turn, so a failed turn is not rolled back.",
      url: B + "sessions",
    },
    {
      id: "result",
      title: "How a run ends: ResultMessage, limits and cost",
      hook: "How do you tell a finished investigation from one that ran out of turns or money?",
      diagram: {
        kind: "tree",
        root: { t: "ResultMessage.subtype", s: "Every run ends with exactly one result. All subtypes carry `total_cost_usd`, `usage`, `num_turns` and `session_id`.", tag: "stop" },
        children: [
          { t: "success", s: "Claude finished. `result` holds the text and `structured_output` the validated JSON if you set `output_format`.", tag: "model" },
          { t: "error_max_turns", s: "`max_turns` counts tool-use round trips. No `result`; resume with a higher limit to continue.", tag: "stop" },
          { t: "error_max_budget_usd", s: "`max_budget_usd` reached. The cost is the SDK's estimate and includes subagents.", tag: "stop" },
          { t: "error_during_execution", s: "An error or cancellation interrupted the loop. After a crash, cost fields may be zero.", tag: "stop" },
          { t: "error_max_structured_…", s: "`error_max_structured_output_retries`: no output passed the schema within the retry limit.", tag: "guard" },
        ],
      },
      explain: [
        "Check `subtype` before reading `result`, which only exists on success. A single-shot `query()` yields the error result and then raises, so wrap the loop in `try` if you need to continue. `stop_reason` tells you why the model stopped on its last turn, for example `refusal`.",
        "`usage` covers only the main loop; `model_usage` covers the whole tree including subagents. The budget is checked against an estimate, not an invoice, and a single model call can overshoot the cap before the run stops.",
      ],
      code: {
        lang: "python",
        caption: "A bounded, structured verdict with every outcome handled and costed.",
        src: `from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

VERDICT = {"type": "object", "required": ["verdict", "confidence"],
           "properties": {"verdict": {"enum": ["benign", "suspicious", "malicious"]},
                          "confidence": {"type": "number"}}}
options = ClaudeAgentOptions(max_turns=8, max_budget_usd=0.50,
                             output_format={"type": "json_schema", "schema": VERDICT})
try:
    async for msg in query(prompt=alert_text, options=options):
        if isinstance(msg, ResultMessage):
            record_spend(msg.session_id, msg.total_cost_usd, msg.model_usage)
            if msg.subtype == "success":
                save_verdict(msg.structured_output)
            else:                       # error_max_turns, error_max_budget_usd, ...
                flag_for_analyst(msg.session_id, msg.subtype)
except Exception as err:                # raised after the error result was yielded
    log.warning("run ended: %s", err)`,
      },
      soc: "Treat any subtype other than `success` as \"needs an analyst\", never as a verdict. Relay applies the SDK's USD estimate, turn limits and its own 180-second deadline, and rejects missing results, empty successes and invalid structured findings.",
      url: B + "agent-loop#handle-the-result",
    },
  ],
};
