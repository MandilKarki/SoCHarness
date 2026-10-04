import type { Mechanism } from "./types";

export const context: Mechanism = {
  id: "context",
  title: "Context window management",
  question: "What does the model see once history outgrows the context window?",
  why: "Long investigations produce more evidence than fits in a context window: process trees, log pages, enrichment results. Something must decide what the model stops seeing. If that decision is a summary written by a model, an indicator can disappear silently. If it is your code, you can keep indicators verbatim, drop bulk output, and still keep the raw record for audit.",
  patterns: [
    {
      id: "auto-compaction",
      name: "Automatic compaction",
      say: "Near the context limit the harness summarises older history itself and continues from the summary.",
      tradeoff: "No effort, but the summariser decides what to forget, and that may be the one indicator that mattered.",
    },
    {
      id: "history-processor",
      name: "History processor",
      say: "Your function receives the messages before each model call and returns what the model should see.",
      tradeoff: "Deterministic and testable, but cutting a tool call from its result breaks pairing and confuses providers.",
    },
    {
      id: "non-destructive",
      name: "Non-destructive condensation",
      say: "Forgetting is recorded as an entry or event; the full history stays and only the model's view is rebuilt.",
      tradeoff: "Audit-friendly because nothing is lost, but the model still works from a lossy summary.",
    },
  ],
  dimensions: ["Trigger", "What the model loses", "Raw history kept?", "Your control point"],
  entries: {
    claude: {
      pattern: "auto-compaction",
      api: "auto-compact + PreCompact hook",
      how: "The CLI compacts the conversation automatically as it nears the context limit. A `PreCompact` hook fires first so you can archive or log, and `get_context_usage()` reports usage. Subagents keep their intermediate work out of the parent's context.",
      cells: [
        "Automatic near the limit",
        "Older turns, replaced by a summary",
        "Archive it yourself in a PreCompact hook",
        "PreCompact hook; get_context_usage()",
      ],
      code: `async def before_compact(input_data, tool_use_id, context):
    archive_transcript(input_data["session_id"])   # keep the pre-compaction record
    return {}

options = ClaudeAgentOptions(hooks={"PreCompact": [HookMatcher(hooks=[before_compact])]})`,
      lang: "python",
      chapter: "hooks",
    },
    pydantic: {
      pattern: "history-processor",
      api: "capabilities=[ProcessHistory(fn)]",
      how: "History processors run before each model request and return the messages to send. Current releases attach them as `capabilities=[ProcessHistory(fn)]`; earlier releases used `history_processors=`. The docs warn that splitting a tool call from its return forces repairs.",
      cells: [
        "Before every model request",
        "Whatever your processor drops",
        "Your stored copy is untouched",
        "ProcessHistory(fn)",
      ],
      code: `async def keep_recent(messages: list[ModelMessage]) -> list[ModelMessage]:
    return messages[-12:] if len(messages) > 12 else messages

agent = Agent('openai:gpt-5.2', capabilities=[ProcessHistory(keep_recent)])`,
      lang: "python",
      chapter: "history",
    },
    deepagents: {
      pattern: "auto-compaction",
      api: "SummarizationMiddleware + offloading",
      how: "`SummarizationMiddleware` in the default stack compresses the conversation near the model's input limit, and large tool results are offloaded to the backend so the agent can `read_file` them later. A summarisation tool middleware lets the agent compact on demand.",
      cells: [
        "Near the model's input limit",
        "Older turns; big results moved to files",
        "Yes, originals stay on the backend",
        "Middleware config; compact tool",
      ],
      code: `model = "anthropic:claude-sonnet-5"
agent = create_deep_agent(
    model=model,
    tools=[search_alerts],
    middleware=[create_summarization_tool_middleware(model, StateBackend)],
)`,
      lang: "python",
      chapter: "summarization",
    },
    pi: {
      pattern: "non-destructive",
      api: "compaction settings + compact()",
      how: "Compaction triggers on a threshold between turns, on a provider overflow error, or on `session.compact(instructions)`. It writes a `compaction` entry; `buildSessionContext()` replaces entries before `firstKeptEntryId` with the summary only when building the next request.",
      cells: [
        "Threshold, overflow error or compact()",
        "Entries before firstKeptEntryId",
        "Yes, the JSONL keeps every entry",
        "reserveTokens, keepRecentTokens; instructions",
      ],
      code: `const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
});
const { session } = await createAgentSession({ settingsManager });
await session.compact("Keep every IP, hash, hostname and account name verbatim.");`,
      lang: "ts",
      chapter: "compaction",
    },
    vercel: {
      pattern: "history-processor",
      api: "prepareStep messages + pruneMessages",
      how: "`prepareStep` runs before every model call and can return replacement `messages`, which persist for later steps. `pruneMessages()` removes reasoning, old tool calls or empty messages. There is no automatic compaction.",
      cells: [
        "prepareStep, before each step",
        "Whatever pruneMessages removes",
        "Only if you persist the unpruned list",
        "prepareStep messages; pruneMessages()",
      ],
      code: `prepareStep: async ({ messages }) => {
  if (JSON.stringify(messages).length > 400_000) {
    return { messages: pruneMessages({ messages, reasoning: 'all',
      toolCalls: 'before-last-3-messages', emptyMessages: 'remove' }) };
  }
  return {};
},`,
      lang: "ts",
      chapter: "prepare-step",
    },
    opencode: {
      pattern: "auto-compaction",
      api: "compaction config + session.summarize()",
      how: "The server compacts a session automatically when context reaches capacity (`compaction.auto`, on by default). `prune` clears outdated tool outputs, `reserved` keeps a token buffer, and `session.summarize()` condenses a session on request.",
      cells: [
        "At capacity; or session.summarize()",
        "Older turns; old tool output if prune",
        "Not documented; export messages first",
        "compaction: auto, prune, reserved",
      ],
      code: `{
  "$schema": "https://opencode.ai/config.json",
  "compaction": { "auto": true, "prune": true, "reserved": 10000 }
}`,
      lang: "json",
    },
    openai: {
      pattern: "history-processor",
      api: "call_model_input_filter / input_filter",
      how: "`RunConfig.call_model_input_filter` can trim, redact or inject before every model call. Handoff `input_filter`s decide what a specialist sees, and `OpenAIResponsesCompactionSession` compacts session history automatically through the Responses API.",
      cells: [
        "Before each model call; at handoffs",
        "Whatever your filter drops",
        "Yes, session items are not rewritten",
        "call_model_input_filter; handoff filters",
      ],
      code: `triage = Agent(
    name="Triage",
    instructions="Route the alert to the right specialist.",
    handoffs=[handoff(malware, input_filter=handoff_filters.remove_all_tools)],
)`,
      lang: "python",
      chapter: "handoffs",
    },
    google_adk: {
      pattern: "history-processor",
      api: "before_model_callback / include_contents",
      how: "A `before_model_callback` can edit `llm_request.contents` before each call, and `include_contents='none'` stops an agent receiving prior history. The docs also describe context compaction and context caching for long sessions; session events are never rewritten.",
      cells: [
        "Before each model call",
        "Whatever you remove from the request",
        "Yes, session events are unchanged",
        "Callback; include_contents; compaction",
      ],
      code: `def keep_recent(callback_context: CallbackContext, llm_request: LlmRequest):
    llm_request.contents = llm_request.contents[-20:]
    return None  # continue to the model with the trimmed request

triage = LlmAgent(name="triage", model="gemini-2.5-flash",
                  before_model_callback=keep_recent)`,
      lang: "python",
      chapter: "callbacks",
    },
    microsoft: {
      pattern: "history-processor",
      api: "ContextProvider / chat middleware",
      how: "History reaches the model through history and context providers: `before_run` decides what is added to the request and `after_run` what is stored. Chat middleware can rewrite each request. For built-in compaction the docs point to the Harness agent.",
      cells: [
        "Providers before_run; chat middleware",
        "Whatever your provider leaves out",
        "Yes, if your history provider keeps it",
        "ContextProvider; ChatMiddleware",
      ],
      code: `class CaseContext(ContextProvider):
    async def before_run(self, *, agent: Any, session: AgentSession | None,
                         context: SessionContext, state: dict[str, Any]) -> None:
        context.extend_instructions(self.source_id, case_digest(state))

agent = Agent(client=client, context_providers=[CaseContext("case_context")])`,
      lang: "python",
      chapter: "sessions",
    },
    openhands: {
      pattern: "non-destructive",
      api: "LLMSummarizingCondenser",
      how: "The condenser decides what to forget and records it as a `Condensation` event. The next step's view drops the forgotten IDs and inserts a summary that reaches the model as a user message. `max_size` counts events; `keep_first` protects the opening.",
      cells: [
        "View exceeds max_size events",
        "Forgotten events, replaced by a summary",
        "Yes, Condensation is just another event",
        "max_size, keep_first; own LLM",
      ],
      code: `condenser = LLMSummarizingCondenser(
    llm=llm.model_copy(update={"usage_id": "condenser"}),
    max_size=80,    # condense once the view passes 80 events
    keep_first=4,   # system prompt and the original alert stay verbatim
)
agent = Agent(llm=llm, tools=tools, condenser=condenser)`,
      lang: "python",
      chapter: "condenser",
    },
    hermes: {
      pattern: "auto-compaction",
      api: "compression.* + ContextEngine",
      how: "The default `ContextCompressor` summarises middle turns once usage passes `compression.threshold` (0.5 by default), protecting the opening and a recent tail, and clears old tool outputs. A pluggable `ContextEngine` can replace it.",
      cells: [
        "compression.threshold (default 0.5)",
        "Middle turns; old tool output cleared",
        "Session lineage kept across compressions",
        "compression keys; ContextEngine plugin",
      ],
      code: `# ~/.hermes/config.yaml
compression:
  enabled: true
  threshold: 0.5     # compress at 50% of the context window
auxiliary:
  compression:
    model: null      # auto-detect the summary model`,
      lang: "yaml",
    },
  },
  choose: [
    "Own the decision. Constrain or disable automatic compaction and trim in code you can test (history processor, prepareStep, input filter), keeping the original alert and analyst decisions verbatim.",
    "Keep the raw record outside the model's view (JSONL file, event log, case store) so a lossy summary never becomes the only evidence.",
    "When you must summarise, tell the summariser to keep every IP, hash, hostname and account name verbatim, and have the agent cite evidence by ID rather than from memory.",
    "Prune old tool output first. It is the bulkiest part of history and the place where injected alert text lingers across turns.",
    "Never separate a tool call from its result when trimming; providers reject or mishandle orphaned calls.",
  ],
};
