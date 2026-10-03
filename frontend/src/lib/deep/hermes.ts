import type { DeepDive } from "./types";

const B = "https://hermes-agent.nousresearch.com/docs/";

export const hermes: DeepDive = {
  intro:
    "Hermes Agent is one `AIAgent` loop: call the model, dispatch tool calls through a toolset-filtered registry, stop on a text reply or when the iteration budget runs out. Around that loop sit a learning layer (memory, skills, a post-turn review fork) and many front doors (CLI, messaging gateways, cron). Relay runs only the inner loop.",
  chapters: [
    {
      id: "loop",
      title: "The AIAgent turn loop",
      hook: "What happens between your message and the final response?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "run_conversation()", s: "Appends the user message, builds or reuses the cached system prompt, and starts the turn loop.", tag: "you" },
          { t: "Preflight compression", s: "If history passes 50% of the context window, memory is flushed and middle turns are summarised first.", tag: "state" },
          { t: "Interruptible API call", s: "The HTTP call runs in a background thread. A new message or `/stop` abandons it; no partial reply is stored.", tag: "model" },
          { t: "Dispatch tool calls", s: "One call runs inline; several run in a thread pool, and results are reinserted in the original order.", tag: "tool" },
          { t: "Text reply", s: "No tool calls: the session is saved to SQLite, memory is flushed, and `final_response` is returned.", tag: "stop" },
        ],
        back: { from: 3, to: 2, label: "loop until text or budget spent" },
      },
      explain: [
        "`chat()` is a thin wrapper that returns only the text; `run_conversation()` returns a dict with `final_response` and the full `messages` list. Whatever the API mode (`chat_completions`, `codex_responses`, `anthropic_messages`), history is kept in OpenAI format with strict role alternation, and converted only at the edge of each call.",
        "The loop is bounded by an `IterationBudget`. The library guide lists `max_iterations` with a default of 500; the constructor default has changed between versions, so set it explicitly. When the budget is spent the agent stops and returns a summary of the work done, which can cost one extra model call. On 429, 5xx or auth errors, configured `fallback_providers` are tried in order.",
      ],
      code: {
        lang: "python",
        caption: "Embedding AIAgent as a library: bounded, quiet, with no persistent memory or context files.",
        src: `from run_agent import AIAgent

agent = AIAgent(
    model="anthropic/claude-sonnet-4.6",
    quiet_mode=True,          # no CLI spinners when embedded
    max_iterations=12,        # bound the tool-calling loop
    skip_memory=True,         # no MEMORY.md / USER.md reads or writes
    skip_context_files=True,  # ignore AGENTS.md in the working directory
)
result = agent.run_conversation(
    user_message="Triage alert 4812: failed logins from 203.0.113.7",
    task_id="case-4812",
)
print(result["final_response"])

followup = agent.run_conversation(
    "Which accounts were targeted?",
    conversation_history=result["messages"],
)`,
      },
      soc: "Set `max_iterations` low and expect one possible summary call on top; Relay's limits account for that extra request. Create one `AIAgent` per case and thread, since the docs say instances are not thread-safe.",
      url: B + "developer-guide/agent-loop",
    },
    {
      id: "toolsets",
      title: "Toolsets: from registry to schema to dispatch",
      hook: "How does Hermes decide which tools the model can even see?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "registry.register()", s: "Each tool module declares name, toolset, schema, handler and an optional `check_fn` at import time.", tag: "tool" },
          { t: "Resolve toolsets", s: "`enabled_toolsets` whitelists, `disabled_toolsets` subtracts, and composites like `debugging` expand to core sets.", tag: "core" },
          { t: "check_fn filter", s: "Tools whose availability check fails, or raises, are silently dropped from the schema list.", tag: "guard" },
          { t: "Schemas to model", s: "Only surviving tools are described; `execute_code` and `browser_navigate` schemas are patched to match.", tag: "model" },
          { t: "Dispatch", s: "`todo`, `memory`, `session_search` and `delegate_task` are handled by the loop; the rest go through `registry.dispatch()`.", tag: "tool" },
          { t: "JSON string result", s: "Handler exceptions are caught and returned as an `error` JSON object, so the model always gets well-formed output.", tag: "stop" },
        ],
      },
      explain: [
        "Every tool belongs to exactly one toolset. Toolsets come in three kinds: core (one logical group, such as `file`), composite (several cores, such as `debugging`) and platform presets (such as `hermes-cli` or `hermes-telegram`). `model_tools.get_tool_definitions()` resolves the lists, then the registry runs each `check_fn` and returns OpenAI-format schemas.",
        "Tool modules are auto-discovered: any `tools/*.py` file with a top-level `registry.register()` call is imported at startup. A registration that would shadow a tool from a different toolset is rejected unless overridden. Handlers receive `(args, **kwargs)` and must return a JSON string; the docs require errors to be returned, not raised.",
      ],
      code: {
        lang: "python",
        caption: "A custom tool registered the documented way; add its toolset in toolsets.py before enabling it.",
        src: `import json, os
from tools.registry import registry

def check_ti() -> bool:
    return bool(os.getenv("TI_API_KEY"))

def ip_reputation(args: dict, **kw) -> str:
    ip = args.get("ip", "")
    return json.dumps({"ip": ip, "verdict": ti_client.lookup(ip)})

registry.register(
    name="relay_ip_reputation",
    toolset="relay_soc",
    schema={"name": "relay_ip_reputation",
            "description": "Look up reputation for an IP address.",
            "parameters": {"type": "object",
                           "properties": {"ip": {"type": "string"}},
                           "required": ["ip"]}},
    handler=ip_reputation,
    check_fn=check_ti,
    requires_env=["TI_API_KEY"],
)`,
      },
      soc: "Toolsets are your capability boundary: an enrichment agent should not even see `terminal` or `browser`. Relay registers its own prefixed, private tool set so the model cannot reach Hermes' built-in shell, files or browser.",
      url: B + "developer-guide/tools-runtime",
    },
    {
      id: "approvals",
      title: "Dangerous-command approval, layer by layer",
      hook: "What stands between a model-written shell command and your host?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "Hardline blocklist", s: "Catastrophic patterns (`rm -rf /`, fork bombs, raw disk writes) are refused first, even in YOLO mode.", u: "The model gets an explanatory error; nothing ran.", tag: "guard" },
          { t: "approvals.deny", s: "Your fnmatch globs block matching commands unconditionally, before YOLO or `mode: off` are consulted.", u: "The model is told BLOCKED and not to retry or rephrase.", tag: "guard" },
          { t: "DANGEROUS_PATTERNS", s: "`detect_dangerous_command()` matches regexes for recursive deletes, `DROP TABLE`, `curl | sh` and more. `command_allowlist` entries pass.", u: "Approvals are remembered per session, so a pattern does not re-prompt.", tag: "guard" },
          { t: "approvals.mode", s: "`smart` asks an auxiliary LLM, `manual` always asks a human, `off` skips. Unanswered prompts are denied after `timeout`.", u: "Cron, `-q` and webhook sessions follow `cron_mode`, `single_query_mode`, `unattended_mode`.", tag: "you" },
        ],
        core: { t: "Terminal backend runs", s: "Only now does the command execute, in whichever terminal backend is configured.", tag: "tool" },
      },
      explain: [
        "The check happens inside tool dispatch, before the terminal handler runs. In the CLI the user answers inline (once, session, or always); on messaging platforms the request is sent to the chat and a reply such as `yes` or `deny` resolves it. \"Always\" writes the pattern to `command_allowlist` in `config.yaml`.",
        "Two caveats matter. On container backends (docker, singularity, modal, daytona, vercel_sandbox) the dangerous-pattern prompt is skipped because the container is treated as the boundary; `approvals.deny` still applies everywhere. And the docs state that deny rules are a command policy, not an OS sandbox: renamed binaries or scripts can reach the same capability.",
      ],
      code: {
        lang: "yaml",
        caption: "A fail-closed approval policy for an agent that must never act unattended.",
        src: `# ~/.hermes/config.yaml
approvals:
  mode: manual            # smart | manual | off
  timeout: 300            # unanswered prompts are denied (fail-closed)
  cron_mode: deny         # scheduled runs never auto-approve
  single_query_mode: deny # one-shot hermes chat -q runs
  unattended_mode: deny   # webhook and API server sessions
  deny:
    - "iptables -F*"
    - "systemctl stop *"
    - "*curl*|*sh*"`,
      },
      soc: "Containment commands should always reach a human, so prefer `manual` over `smart` (a second model judging risk is still a model). Relay sidesteps this layer by not exposing Hermes' shell at all; case actions go through Relay's own gated tools.",
      url: B + "user-guide/security",
    },
    {
      id: "learning",
      title: "The learning loop: review, save, reload",
      hook: "How does Hermes turn a finished task into something it knows next time?",
      diagram: {
        kind: "loop",
        center: "Learning loop",
        exit: "auxiliary.background_review.enabled: false stops automatic reviews",
        steps: [
          { t: "Count turns and iterations", s: "The loop counts user turns since the last memory review and tool iterations since the last skill review.", tag: "state" },
          { t: "Nudge fires", s: "Past `memory.nudge_interval` or `skills.creation_nudge_interval`, a review is spawned after the response.", tag: "core" },
          { t: "Background review fork", s: "A forked `AIAgent` replays the conversation, or a digest on a cheaper model, without touching the live chat.", tag: "model" },
          { t: "memory / skill_manage", s: "The fork saves facts with `memory` and procedures with `skill_manage`. With `write_approval`, writes are staged instead.", tag: "guard" },
          { t: "Next session loads", s: "New sessions get the updated MEMORY.md snapshot and see new skills in `skills_list()`.", tag: "state" },
          { t: "Curator prunes", s: "When idle, the curator marks unused agent-created skills stale, then archives them. LLM consolidation is opt-in.", tag: "tool" },
        ],
      },
      explain: [
        "Learning has two channels. Memory holds small durable facts that are always in the prompt. Skills are `SKILL.md` procedures loaded on demand: `skills_list()` shows names and descriptions, `skill_view()` loads the body only when needed. The system prompt also asks the agent to save non-trivial workflows with `skill_manage` during normal turns.",
        "The background review is the automatic part. It runs on the main model by default (reusing the warm prompt cache) or on `auxiliary.background_review.model`, and `max_input_tokens` caps what one review may replay. `skill_manage` supports `create`, `patch`, `delete`, `write_file` and `remove_file`; the curator never deletes, only archives to `~/.hermes/skills/.archive/`.",
      ],
      code: {
        lang: "yaml",
        caption: "Keep the learning loop but put a human in front of every write; interval values are illustrative.",
        src: `# ~/.hermes/config.yaml
memory:
  memory_enabled: true
  write_approval: true        # stage every memory save for review
  nudge_interval: 10          # memory review every N user turns (0 = off)
skills:
  write_approval: true        # stage skill writes under ~/.hermes/pending/skills/
  creation_nudge_interval: 15 # skill review every N tool iterations (0 = off)
auxiliary:
  background_review:
    enabled: true             # false = no automatic post-turn forks
    max_input_tokens: 48000   # cap tokens one review may replay
curator:
  enabled: true
  consolidate: false          # LLM merge pass stays off`,
      },
      soc: "A self-written skill or memory is persistent prompt content, so attacker text in an alert could become a standing instruction. Relay disables learning; if you enable it, keep `write_approval` on and review staged writes.",
      url: B + "user-guide/features/skills#agent-managed-skills-skill_manage-tool",
    },
    {
      id: "memory",
      title: "Frozen memory and session search",
      hook: "Why does a fact saved now only appear in the next session?",
      diagram: {
        kind: "timeline",
        legend: { state: "storage", tool: "tool call", event: "prompt effect", you: "new session" },
        events: [
          { t: "Session start", s: "MEMORY.md and USER.md are read from `~/.hermes/memories/` and frozen into the system prompt.", tag: "state" },
          { t: "memory(action=\"add\")", s: "A save is scanned for injection patterns, checked against its character limit and written to disk immediately.", tag: "tool" },
          { t: "Prompt unchanged", s: "The running system prompt does not change mid-session, which keeps the provider prefix cache valid.", tag: "event" },
          { t: "Compression", s: "Before middle turns are summarised, memory is flushed to disk so nothing pending is lost.", tag: "state" },
          { t: "Turn persisted", s: "Every turn's messages go to SQLite (`state.db`) with an FTS5 full-text index.", tag: "state" },
          { t: "Next session", s: "The new snapshot includes the saved entry.", tag: "you" },
          { t: "session_search(query=...)", s: "FTS5 search over past sessions returns real messages around the match, with no LLM call.", tag: "tool" },
        ],
      },
      explain: [
        "Memory is deliberately small: MEMORY.md about 2,200 characters and USER.md about 1,375. It does not auto-compact; a write that overflows returns an error and the agent must consolidate first. Entries are `§`-separated, and `replace` and `remove` locate an entry by a unique substring. There is no read action, because memory is already in the prompt.",
        "Session search covers everything else. All CLI and gateway sessions are stored in `~/.hermes/state.db`. `session_search` infers its shape from its arguments: `query` for discovery, `session_id` plus `around_message_id` to scroll. Memory costs tokens every turn; search costs nothing until used.",
      ],
      code: {
        lang: "bash",
        caption: "Inspect, list and prune what Hermes remembers, using documented CLI commands.",
        src: `# What the agent will see at the start of its next session
cat ~/.hermes/memories/MEMORY.md
cat ~/.hermes/memories/USER.md

# Every CLI and gateway session lives in ~/.hermes/state.db
hermes sessions list

# Review and prune learned skills and memory entries
hermes journey list
hermes journey delete <node> -y

# Inside a chat, with memory.write_approval on:
#   /memory pending
#   /memory approve <id>`,
      },
      soc: "One Hermes home holds memory across every chat it serves, which is wrong for multi-tenant work: use one profile per tenant or `skip_memory=True`. Relay keeps its own native message history per case instead.",
      url: B + "user-guide/features/memory",
    },
    {
      id: "surfaces",
      title: "Gateways and terminal backends",
      hook: "Where do messages come in, and where do commands actually run?",
      diagram: {
        kind: "tree",
        root: { t: "Hermes process", s: "One install, many entry points. Each ends in an `AIAgent` run that uses the configured terminal backend.", tag: "core" },
        children: [
          { t: "CLI / TUI", s: "Interactive sessions. Every invocation is a new session, and approval prompts appear inline.", tag: "you" },
          {
            t: "Messaging gateway",
            s: "One background process connects Telegram, Slack, Discord and more, routing each chat to its own session.",
            tag: "event",
            children: [
              { t: "User allowlists", s: "`TELEGRAM_ALLOWED_USERS` and similar. With no allowlist configured, every user is denied.", tag: "guard" },
              { t: "Cron scheduler", s: "Ticks every 60 seconds inside the gateway and runs due jobs in fresh agent sessions.", tag: "state" },
            ],
          },
          {
            t: "Terminal backend",
            s: "`terminal.backend` decides where shell commands execute.",
            tag: "tool",
            children: [
              { t: "local / ssh", s: "No isolation on local; a separate machine for ssh. Dangerous-command checks apply.", tag: "stop" },
              { t: "docker", s: "Hardened container: all capabilities dropped, no-new-privileges, a PID limit. Pattern checks are skipped.", tag: "guard" },
              { t: "modal / daytona / vercel", s: "Cloud sandboxes. Isolation comes from the provider's environment.", tag: "tool" },
            ],
          },
        ],
      },
      explain: [
        "The gateway is a single long-running process: platform adapters receive messages, a per-chat session store keeps continuity, and the same process runs the cron scheduler. A chat is one continuous session that survives restarts, so on gateways you create session boundaries yourself with `/new`.",
        "The terminal backend is independent of the entry point. The docs recommend docker, modal, daytona or vercel_sandbox for production gateways. `docker_forward_env` is an explicit allowlist: any variable you forward can be read, and exfiltrated, by code running in the container.",
      ],
      code: {
        lang: "yaml",
        caption: "A disposable, secret-free Docker backend for agent shell commands.",
        src: `# ~/.hermes/config.yaml
terminal:
  backend: docker
  docker_image: "nousresearch/hermes-sandbox:desktop"
  docker_forward_env: []       # explicit allowlist; empty keeps secrets out
  container_cpu: 1
  container_memory: 5120       # MB
  container_persistent: false  # tmpfs workspace, discarded on cleanup
  timeout: 180                 # seconds per command`,
      },
      soc: "A chat gateway is a public entry point to a tool-using agent, so allowlists and pairing are your first control, and alert text arriving through chat is untrusted input. Relay uses none of these gateways or backends; it calls `AIAgent` directly in an isolated Python worker.",
      url: B + "user-guide/features/tools#terminal-backends",
    },
    {
      id: "delegation",
      title: "Subagents with fresh context",
      hook: "How does Hermes split work without flooding the parent's context?",
      diagram: {
        kind: "lanes",
        actors: ["Parent AIAgent", "delegate_task", "Child AIAgent", "Child terminal"],
        msgs: [
          { from: 0, to: 1, t: "goal + context", s: "The parent model calls the tool. It cannot pass toolsets, so a child never exceeds the parent's tools.", tag: "model" },
          { from: 1, to: 2, t: "fresh conversation", s: "Each child starts with no parent history: only `goal`, `context` and the workspace's project context files.", tag: "core" },
          { from: 2, to: 3, t: "own terminal session", s: "Children run commands in their own session. Leaf children cannot call `memory`, `clarify`, `send_message` or `cronjob`.", tag: "tool" },
          { from: 3, to: 2, t: "tool results", s: "The child loops under its own iteration budget, set by `delegation.max_iterations`.", tag: "tool" },
          { from: 2, to: 1, t: "summary (schema-checked)", s: "With `output_schema`, the answer is validated and the child gets one bounded correction turn if it fails.", tag: "guard" },
          { from: 1, to: 0, t: "only the summary", s: "Only the final summary enters the parent's context. Top-level calls return a handle and deliver the result later.", tag: "stop" },
        ],
      },
      explain: [
        "`delegate_task` accepts one task or a `tasks` batch (ten concurrent children by default). Delegation is flat by default: `role=\"orchestrator\"` children can delegate further only if `delegation.max_spawn_depth` is raised, and `orchestrator_enabled: false` disables that globally. Each extra level multiplies cost.",
        "Background completion is not durable execution. A Hermes restart does not resume a running child; its attempt becomes `unknown`. `/stop` interrupts children, which return partial summaries. A heartbeat monitor abandons a child that shows no progress for 450 seconds between turns. For work that must survive restarts, the docs point to cron jobs.",
      ],
      code: {
        lang: "python",
        caption: "The tool call the parent model emits, in the shape the docs show; Hermes, not your code, executes it.",
        src: `delegate_task(tasks=[
    {
        "goal": "List persistence mechanisms found on host WS-114",
        "context": "Case 4812. Read-only review of /cases/4812/ws114/. Cite file paths.",
        "output_schema": {
            "type": "object",
            "properties": {"findings": {"type": "array", "items": {"type": "string"}}},
            "required": ["findings"],
        },
    },
    {
        "goal": "Summarise authentication events for user jdoe",
        "context": "Case 4812. Logs are in /cases/4812/auth/. Report IPs and times.",
    },
])`,
      },
      soc: "Fresh-context children are a natural fit for per-host evidence collection, and `output_schema` gives you parseable findings. Delegation is a listed gap in Relay today; if you add it, account for multiplied cost and non-durable children.",
      url: B + "user-guide/features/delegation",
    },
  ],
};
