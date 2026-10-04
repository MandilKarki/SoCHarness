import type { Mechanism } from "./types";

export const state: Mechanism = {
  id: "state",
  title: "Sessions, state and memory",
  question: "Where does a conversation live between runs, and what survives a restart?",
  why: "An investigation outlives one request. Analysts ask follow-ups hours later, workers restart, and auditors want the exact sequence that led to a verdict. Where a framework keeps history, how you resume or branch it, and what it calls memory decide whether you can key state to case and tenant, keep it in your region, and recover after a crash.",
  patterns: [
    {
      id: "transcript-resume",
      name: "Harness-owned transcript",
      say: "The harness writes the conversation to its own store; you keep an ID and resume, continue or fork by ID.",
      tradeoff: "No serialisation code, but storage location and format belong to the harness.",
    },
    {
      id: "history-as-data",
      name: "History as plain data",
      say: "The run returns a message list you persist and pass back next time; nothing is stored for you.",
      tradeoff: "Full control over residency and schema, but you must persist every turn yourself, tool receipts included.",
    },
    {
      id: "session-service",
      name: "Session store protocol",
      say: "A pluggable session service or protocol stores history and state per session ID; swap in SQLite, a database or a hosted store.",
      tradeoff: "Clean separation, but scoping (user, app, tenant) follows the framework's model rather than yours.",
    },
    {
      id: "checkpointed-graph",
      name: "Checkpointed graph state",
      say: "The whole graph state is checkpointed per thread, so a run resumes from the exact point it stopped.",
      tradeoff: "Strong crash recovery, but replay re-runs unfinished steps, so side effects must be idempotent.",
    },
    {
      id: "event-log",
      name: "Append-only log",
      say: "An append-only log of typed entries or events is the state; persisting is appending, resuming is reloading.",
      tradeoff: "A complete audit trail by construction, but the log grows quickly and can hold secrets unless scrubbed.",
    },
  ],
  dimensions: ["Unit of persistence", "Default store", "Branch or fork", "Long-term memory"],
  entries: {
    claude: {
      pattern: "transcript-resume",
      api: "resume / fork_session",
      how: "`continue_conversation=True` takes the latest session in the working directory, `resume=<id>` a specific one, and `fork_session=True` with `resume` copies history into a new ID. Transcripts live on the host that ran them unless you attach a `session_store`.",
      cells: [
        "Session transcript by session_id",
        "~/.claude/projects/ on the running host",
        "fork_session=True together with resume",
        "CLAUDE.md files loaded as context",
      ],
      code: `case_session = await ask("Triage alert 4812", max_turns=8)
await ask("Which hosts did the attacker touch?", resume=case_session)
branch = await ask("Assume the VPN login was legitimate. Re-assess.",
                   resume=case_session, fork_session=True)   # original unchanged`,
      lang: "python",
      chapter: "sessions",
    },
    pydantic: {
      pattern: "history-as-data",
      api: "message_history + TypeAdapter",
      how: "History is a list of `ModelMessage` objects you own. `all_messages()` and `new_messages()` return it, `message_history=` feeds it back, and `ModelMessagesTypeAdapter` serialises and restores it without losing part types.",
      cells: [
        "List of ModelMessage",
        "None; you store the JSON",
        "Copy the list and continue",
        "Not in core; add-on capabilities",
      ],
      code: `r1 = await agent.run('Summarise alert 4812')
stored = to_jsonable_python(r1.all_messages())  # save with the case

history = ModelMessagesTypeAdapter.validate_python(stored)
r2 = await agent.run('Which hosts are affected?', message_history=history)`,
      lang: "python",
      chapter: "history",
    },
    deepagents: {
      pattern: "checkpointed-graph",
      api: "checkpointer + thread_id + store",
      how: "Graph state (messages, to-dos, `StateBackend` files) is checkpointed per `thread_id`, so a run resumes in another process. `StoreBackend` routes in a `CompositeBackend` persist files across threads, and `memory=` loads AGENTS.md files.",
      cells: [
        "Graph state per thread_id",
        "The checkpointer you pass (e.g. SQLite)",
        "Resume from an earlier checkpoint",
        "StoreBackend paths; AGENTS.md memory",
      ],
      code: `agent = create_deep_agent(tools=[search_alerts], checkpointer=checkpointer)
config = {"configurable": {"thread_id": "case-4812"}}
await agent.ainvoke({"messages": [{"role": "user", "content": "Investigate 4812"}]}, config)

state = await agent.aget_state(config)
print(state.values.get("todos", []))`,
      lang: "python",
      chapter: "todos",
    },
    pi: {
      pattern: "event-log",
      api: "SessionManager (JSONL tree)",
      how: "Each line of the session file is an entry with `id` and `parentId`. `branch(id)` moves the leaf and `navigateTree()` can summarise the branch you leave; nothing is rewritten. `SessionManager.forkFrom()` writes a new file from an existing one.",
      cells: [
        "Entry tree in one JSONL file",
        "Session file; or SessionManager.inMemory()",
        "branch(), navigateTree(), forkFrom()",
        "None built in",
      ],
      code: `const sm = SessionManager.open("/cases/4812/session.jsonl");
const { session } = await createAgentSession({ sessionManager: sm });
const checkpoint = sm.getLeafId()!;
await session.prompt("Hypothesis A: credential stuffing on the VPN. Test it.");
await session.navigateTree(checkpoint, { summarize: true });   // branch A stays in the file
await session.prompt("Hypothesis B: token theft from WS-114. Test it.");`,
      lang: "ts",
      chapter: "tree",
    },
    vercel: {
      pattern: "history-as-data",
      api: "responseMessages",
      how: "The SDK is stateless. `responseMessages` holds every assistant and tool message from the run; you persist it and pass the full `messages` array next time. Approvals and multi-turn chat both depend on that saved history.",
      cells: [
        "ModelMessage[] you persist",
        "None",
        "Copy the array and continue",
        "None built in",
      ],
      code: `const { text, responseMessages } = await generateText({
  model: 'anthropic/claude-sonnet-5.5',
  tools: { lookupIp },
  stopWhen: isStepCount(6),
  messages: await caseStore.loadHistory('4812'),
});
await caseStore.appendHistory('4812', responseMessages);`,
      lang: "ts",
      chapter: "steps",
    },
    opencode: {
      pattern: "transcript-resume",
      api: "session.create / fork / revert",
      how: "Sessions, messages and parts live on the server and are addressed by ID. `session.fork()` copies messages before a given message into a new session, sharing the working directory; `revert()` rolls back messages and file patches, `unrevert()` restores them.",
      cells: [
        "Server session: messages and parts",
        "Server-side storage",
        "session.fork({ messageID })",
        "AGENTS.md rules only",
      ],
      code: `const { data: branch } = await client.session.fork({
  path: { id: caseSession },
  body: { messageID: lastQuestion.info.id },
});
await client.session.revert({ path: { id: caseSession },
  body: { messageID: lastQuestion.info.id } });`,
      lang: "ts",
      chapter: "revert",
    },
    openai: {
      pattern: "session-service",
      api: "Session protocol / SQLiteSession",
      how: "A session implements `get_items`, `add_items`, `pop_item` and `clear_session`; `SQLiteSession` is built in and any store can implement the protocol. Without a session you carry history yourself with `result.to_input_list()`.",
      cells: [
        "Items per session_id",
        "SQLiteSession; or to_input_list()",
        "Not built in; copy items",
        "Not built in",
      ],
      code: `session = SQLiteSession("case-4812", "relay.db")
r1 = await Runner.run(agent, "Summarise the alert", session=session)
r2 = await Runner.run(agent, "Which hosts are affected?", session=session)`,
      lang: "python",
      chapter: "sessions",
    },
    google_adk: {
      pattern: "session-service",
      api: "SessionService + MemoryService",
      how: "A `SessionService` stores each session's events and state; key prefixes scope state to session, `user:`, `app:` or `temp:`. A separate `MemoryService` holds searchable long-term memory, filled only when you call `add_session_to_memory`.",
      cells: [
        "Session events plus scoped state",
        "In-memory; Database or Vertex AI",
        "Not built in",
        "MemoryService via load_memory",
      ],
      code: `runner = Runner(app_name="soc", agent=agent, session_service=sessions,
                memory_service=memory)
closed = await sessions.get_session(app_name="soc", user_id="analyst-7",
                                    session_id="case-4812")
await memory.add_session_to_memory(closed)`,
      lang: "python",
      chapter: "memory",
    },
    microsoft: {
      pattern: "session-service",
      api: "AgentSession + context providers",
      how: "`AgentSession` holds a `session_id`, an optional provider-side `service_session_id` and a `state` dict. Without a history provider, an `InMemoryHistoryProvider` keeps messages in `session.state`, so `to_dict()` carries the conversation. Workflows checkpoint separately.",
      cells: [
        "AgentSession state dict",
        "InMemoryHistoryProvider in session.state",
        "Not for sessions; workflow checkpoints",
        "Context providers (before/after_run)",
      ],
      code: `session = agent.create_session(session_id="case-4812")
await agent.run("Which hosts beaconed to 203.0.113.7?", session=session)

saved = session.to_dict()  # store with the case
restored = AgentSession.from_dict(saved)
await agent.run("Which one should be isolated first?", session=restored)`,
      lang: "python",
      chapter: "sessions",
    },
    openhands: {
      pattern: "event-log",
      api: "persistence_dir + conversation_id",
      how: "The conversation is an append-only event log; the agent holds no state. `base_state.json` stores status, stats and config, and `events/` holds one JSON file per event. Recreating a `Conversation` with the same ID and directory resumes it.",
      cells: [
        "Event files plus base_state.json",
        "persistence_dir on local disk",
        "Not documented here",
        "Skills; no memory store",
      ],
      code: `conversation = Conversation(agent=agent, workspace="./case-4812",
                            persistence_dir="./.conversations",
                            conversation_id=conversation_id, callbacks=[on_event])
conversation.send_message("Continue: check lateral movement from WS-114")
conversation.run()`,
      lang: "python",
      chapter: "persistence",
    },
    hermes: {
      pattern: "history-as-data",
      api: "conversation_history + state.db",
      how: "Embedded, `run_conversation()` returns the full `messages` list and you pass it back as `conversation_history`. CLI and gateway sessions are stored in `~/.hermes/state.db`. Memory is MEMORY.md and USER.md, frozen into the prompt at session start.",
      cells: [
        "messages list from run_conversation",
        "None embedded; state.db for CLI and gateway",
        "Not built in for library use",
        "MEMORY.md, USER.md and skills",
      ],
      code: `result = agent.run_conversation(user_message=alert_text, task_id="case-4812")
followup = agent.run_conversation(
    "Which accounts were targeted?",
    conversation_history=result["messages"],
)`,
      lang: "python",
      chapter: "memory",
    },
  },
  choose: [
    "Key every session, thread or conversation ID to the case ID and store it with the case record. Two cases must never share a session.",
    "Prefer stores you control (history as data, session protocols, checkpointers) over transcripts on a worker's disk; residency and retention rules apply to alert data.",
    "Use fork, not revert, to test a second hypothesis, and keep the original branch as evidence.",
    "Keep agent-written long-term memory off by default. It can turn attacker text into a standing instruction; ingest only reviewed, closed cases, scoped per tenant.",
    "Persisted state can include secrets and raw alert payloads. Encrypt it and enforce tenant scoping at the storage layer, not in the prompt.",
  ],
};
