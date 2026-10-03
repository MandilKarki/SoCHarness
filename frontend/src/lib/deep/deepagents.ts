import type { DeepDive } from "./types";

const B = "https://docs.langchain.com/oss/python/deepagents/";
const MW = "https://docs.langchain.com/oss/python/langchain/middleware/";

export const deepagents: DeepDive = {
  intro:
    "`create_deep_agent` returns an ordinary LangGraph agent: a model node and a tools node in a loop, wrapped in a fixed stack of middleware. Files, subagents, summarisation and approvals are all middleware hooks around that loop, and the graph state is checkpointed per thread. Learn the hook order and the stack, and the rest is configuration.",
  chapters: [
    {
      id: "onion",
      title: "A LangGraph agent in a middleware onion",
      hook: "What does create_deep_agent actually build?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "FilesystemMiddleware", s: "Adds `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep` and routes them to the configured backend.", u: "Large tool results can be offloaded to files on the way back.", tag: "state" },
          { t: "SubAgentMiddleware", s: "Adds the `task` tool and the subagent catalogue to the system prompt.", u: "A subagent's final answer returns as a single tool message.", tag: "core" },
          { t: "SummarizationMiddleware", s: "Watches context size before model calls and compacts history when it nears the limit.", u: "Summaries and offloaded history are written back to state.", tag: "state" },
          { t: "HumanInTheLoopMiddleware", s: "Only present with `interrupt_on`. It is placed last in the stack.", u: "After the model responds, it can pause before listed tools run.", tag: "guard" },
        ],
        core: { t: "model ⇄ tools loop", s: "The same agent loop as `create_agent`: call the model, run requested tools, repeat until no tool calls.", tag: "model" },
      },
      explain: [
        "The docs give the main agent's stack in a fixed order: `SkillsMiddleware` (only with `skills`), `FilesystemMiddleware`, `SubAgentMiddleware`, `SummarizationMiddleware`, `PatchToolCallsMiddleware`, your `middleware=` list, harness profile extras, prompt caching, `MemoryMiddleware` (only with `memory`), then `HumanInTheLoopMiddleware` (only with `interrupt_on`). The order is version-dependent; check your release.",
        "Your middleware lands after `PatchToolCallsMiddleware`. A custom instance whose `.name` matches a built-in replaces that built-in in place instead of being added twice. Because the result is a compiled LangGraph graph, `invoke`, `astream`, checkpointers and `thread_id` all work as in any LangGraph app.",
      ],
      code: {
        lang: "python",
        caption: "The smallest deep agent: one evidence tool on top of the default stack.",
        src: `from langchain.tools import tool
from deepagents import create_deep_agent

@tool
def search_alerts(query: str) -> str:
    """Search SIEM alerts for the current case."""
    return siem.search(query)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-5",
    tools=[search_alerts],
    system_prompt="You are a SOC investigator. Cite alert IDs for every claim.",
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "Investigate alert 4812"}]}
)
print(result["messages"][-1].content)`,
      },
      soc: "You inherit a filesystem and a subagent tool you may not want on a production SOC agent. Read the stack before you ship: every layer is a capability the model can use against untrusted alert text.",
      url: B + "customization",
    },
    {
      id: "hooks",
      title: "Middleware hook order and jump_to",
      hook: "When three middleware all hook the model call, who runs first?",
      diagram: {
        kind: "timeline",
        legend: { core: "node hook", guard: "wrap hook", model: "model or tools", stop: "jump" },
        events: [
          { t: "before_agent A, B", s: "Runs once per invocation, in list order: A then B.", tag: "core" },
          { t: "before_model A, B", s: "Runs before every model call, in list order. A hook may return `jump_to` to skip ahead.", tag: "core" },
          { t: "wrap_model_call A(B(·))", s: "Wrap hooks nest: A wraps B, which wraps the real call. Each can retry, edit the request or short-circuit.", tag: "guard" },
          { t: "after_model B, A", s: "After hooks run in reverse order: the last middleware sees the response first.", tag: "core" },
          { t: "wrap_tool_call A(B(·))", s: "Each tool call is wrapped the same way; a wrapper may return a `ToolMessage` or a `Command`.", tag: "model" },
          { t: "jump_to 'end'", s: "A hook declared with `can_jump_to` returns `{\"jump_to\": \"end\"}` and the loop stops.", tag: "stop" },
          { t: "after_agent B, A", s: "Runs once when the agent finishes, again in reverse order.", tag: "core" },
        ],
      },
      explain: [
        "LangChain middleware has node-style hooks (`before_agent`, `before_model`, `after_model`, `after_agent`) that receive `state` and `runtime` and return a state update, and wrap-style hooks (`wrap_model_call`, `wrap_tool_call`) that receive a request and a `handler` to call the next layer.",
        "Ordering is fixed: before hooks run first to last, wrap hooks nest with the first middleware outermost, after hooks run last to first. With `HumanInTheLoopMiddleware` at the end of the deep agent stack, its `after_model` sees the model's tool calls before the other after hooks.",
        "A node hook decorated with `@hook_config(can_jump_to=[...])` can return `jump_to` with `'end'`, `'model'` or `'tools'` to redirect the loop.",
      ],
      code: {
        lang: "python",
        caption: "A model-call budget that ends the run cleanly instead of raising.",
        src: `from typing import Any
from langchain.agents.middleware import AgentMiddleware, AgentState, hook_config
from langchain.messages import AIMessage
from langgraph.runtime import Runtime

class ModelCallBudget(AgentMiddleware):
    def __init__(self, max_calls: int):
        super().__init__()
        self.max_calls = max_calls

    @hook_config(can_jump_to=["end"])
    def before_model(
        self, state: AgentState, runtime: Runtime
    ) -> dict[str, Any] | None:
        calls = sum(1 for m in state["messages"] if m.type == "ai")
        if calls >= self.max_calls:
            return {"messages": [AIMessage("Model-call budget exhausted.")],
                    "jump_to": "end"}
        return None

agent = create_deep_agent(tools=[search_alerts], middleware=[ModelCallBudget(12)])`,
      },
      soc: "Budgets, tenant checks and redaction belong in middleware so they apply to every model and tool call, including those made by subagents you configure with the same middleware. Relay enforces its shared model-call budget this way.",
      url: MW + "custom",
    },
    {
      id: "todos",
      title: "Planning with write_todos",
      hook: "Where does the agent's plan live, and why does it survive a restart?",
      diagram: {
        kind: "loop",
        center: "todos in state",
        exit: "all items completed, then a final answer",
        steps: [
          { t: "Model calls write_todos", s: "The model sends the whole list each time: every item with its content and status.", tag: "model" },
          { t: "State update", s: "The tool returns a `Command` that replaces the `todos` key in graph state.", tag: "state" },
          { t: "Checkpoint", s: "With a checkpointer, the list is saved with the rest of the thread's state after the step.", tag: "state" },
          { t: "Next model call", s: "The tool result in history shows the current list, so the model plans the next step against it.", tag: "model" },
          { t: "Mark progress", s: "Items move from `pending` to `in_progress` to `completed` as work is done.", tag: "core" },
        ],
      },
      explain: [
        "`TodoListMiddleware` adds the `write_todos` tool and prompt guidance on when to use it. The list is ordinary graph state, not a separate service, so it streams, checkpoints and resumes like any other key. `system_prompt` and `tool_description` let you change the guidance.",
        "The current Deep Agents docs say planning is opt-in: add `TodoListMiddleware` yourself. Earlier releases included it by default. Because a custom instance with a built-in's name replaces it rather than duplicating it, adding it explicitly is safe on either version.",
      ],
      code: {
        lang: "python",
        caption: "Opt in to planning and read the plan back from the checkpointed state.",
        src: `from langchain.agents.middleware import TodoListMiddleware
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-5",
    tools=[search_alerts, host_timeline],
    middleware=[TodoListMiddleware()],
    checkpointer=checkpointer,
)

config = {"configurable": {"thread_id": "case-4812"}}
await agent.ainvoke(
    {"messages": [{"role": "user", "content": "Investigate alert 4812"}]}, config
)

state = await agent.aget_state(config)
for todo in state.values.get("todos", []):
    print(todo["status"], todo["content"])`,
      },
      soc: "A persisted plan is a readable investigation checklist an analyst can review mid-case, and the thing you resume from after a crash. Relay keeps to-dos across turns for exactly this reason.",
      url: MW + "built-in",
    },
    {
      id: "backends",
      title: "The virtual filesystem and its backends",
      hook: "When the agent writes a file, where does it actually go?",
      diagram: {
        kind: "tree",
        root: { t: "write_file('/notes.md')", s: "File tools never touch disk directly. `FilesystemMiddleware` hands each call to the configured backend.", tag: "tool" },
        children: [
          { t: "StateBackend (default)", s: "Files live in graph state: scoped to one thread and persisted only through the checkpointer.", tag: "state" },
          { t: "StoreBackend", s: "Files live in a LangGraph `BaseStore`, so they survive across threads.", tag: "state" },
          { t: "FilesystemBackend", s: "Real files under a configured root directory, with an optional virtual mode that confines paths.", tag: "guard" },
          {
            t: "CompositeBackend",
            s: "Routes each path prefix to a different backend.",
            tag: "core",
            children: [
              { t: "/memories/ → StoreBackend", s: "Durable notes shared by every case thread.", tag: "state" },
              { t: "default → StateBackend", s: "Scratch files that die with the thread.", tag: "state" },
            ],
          },
          { t: "Shell / sandbox backends", s: "`LocalShellBackend` and sandbox providers also expose an `execute` tool for commands.", tag: "stop" },
        ],
      },
      explain: [
        "The filesystem is an abstraction, not your disk. Tools such as `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep` and `delete` call a backend protocol. The default `StateBackend` stores files in graph state, so they persist across turns within a thread via the checkpointer and are invisible to other threads.",
        "`CompositeBackend` mixes storage by path. Current docs pass backend instances directly (`backend=StateBackend()`); the older factory form `lambda rt: StateBackend(rt)` is deprecated but still accepted, so examples differ by version.",
      ],
      code: {
        lang: "python",
        caption: "Scratch files per case thread, durable playbook notes across all threads.",
        src: `from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langgraph.store.memory import InMemoryStore

agent = create_deep_agent(
    model="anthropic:claude-sonnet-5",
    tools=[search_alerts],
    backend=CompositeBackend(
        default=StateBackend(),
        routes={
            "/memories/": StoreBackend(namespace=lambda _rt: ("playbook-notes",)),
        },
    ),
    store=InMemoryStore(),
)`,
      },
      soc: "Prefer `StateBackend` or a store over `FilesystemBackend` for anything driven by untrusted alert text: a prompt-injected agent can only write inside its own thread. Never give a triage agent a shell backend.",
      url: B + "backends",
    },
    {
      id: "subagents",
      title: "Subagents through the task tool",
      hook: "How does a specialist work on a sub-task without flooding the parent's context?",
      diagram: {
        kind: "lanes",
        actors: ["Parent agent", "task tool", "host-analyst", "host_timeline"],
        msgs: [
          { from: 0, to: 1, t: "task(description, subagent_type)", s: "The parent delegates by calling `task` with a self-contained description and the subagent's name.", tag: "model" },
          { from: 1, to: 2, t: "fresh context", s: "The subagent starts isolated: it gets only the task description, not the parent's conversation.", tag: "core" },
          { from: 2, to: 3, t: "host_timeline('WS-114')", s: "It runs its own loop with its own prompt and tools.", tag: "tool" },
          { from: 3, to: 2, t: "events", s: "Intermediate tool calls and results stay inside the subagent.", tag: "tool" },
          { from: 2, to: 1, t: "final message", s: "Only the subagent's final result is kept.", tag: "model" },
          { from: 1, to: 0, t: "ToolMessage", s: "The parent sees one tool result instead of dozens of tool calls.", tag: "state" },
        ],
      },
      explain: [
        "`SubAgentMiddleware` exposes the `task` tool. Each entry in `subagents=` is a dict with `name`, `description`, `system_prompt` and optional `tools` and `model`. The `description` is what the parent reads when choosing whom to delegate to, so write it as an action.",
        "By default subagents run isolated: no parent history, no shared skill state, and only the final result goes back. A `general-purpose` subagent with the filesystem tools is added unless you define one with that name. Subagent graphs have no `SubAgentMiddleware` of their own, so they cannot delegate further.",
      ],
      code: {
        lang: "python",
        caption: "Two read-only specialists the lead investigator can delegate to.",
        src: `from deepagents import create_deep_agent

host_analyst = {
    "name": "host-analyst",
    "description": "Investigate one host: processes, logons and network connections.",
    "system_prompt": "You are a read-only host analyst. Return findings with event IDs.",
    "tools": [host_timeline, process_tree],
}
network_analyst = {
    "name": "network-analyst",
    "description": "Investigate IPs and domains: flows, DNS and reputation.",
    "system_prompt": "You are a read-only network analyst. Cite flow IDs.",
    "tools": [flow_search, ip_reputation],
}

agent = create_deep_agent(
    model="anthropic:claude-sonnet-5",
    tools=[search_alerts],
    subagents=[host_analyst, network_analyst],
)`,
      },
      soc: "Isolation keeps raw evidence out of the lead agent's context, but every delegation is another full agent loop. Budget model calls across parent and subagents together; Relay caps delegations at two and shares one call budget.",
      url: B + "subagents",
    },
    {
      id: "hitl",
      title: "Checkpoints, threads and interrupt_on",
      hook: "How does a pause for approval survive until the analyst answers?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "ainvoke(thread_id)", s: "Every call names a `thread_id`; the checkpointer stores graph state per thread after each step.", tag: "you" },
          { t: "Model: isolate_host", s: "The model requests a tool listed in `interrupt_on`.", tag: "model" },
          { t: "HITL interrupt", s: "`HumanInTheLoopMiddleware` raises a LangGraph interrupt before the tool runs; state is checkpointed.", tag: "guard" },
          { t: "__interrupt__", s: "The result carries `action_requests` (tool and args) and `review_configs` (allowed decisions).", tag: "event" },
          { t: "Command(resume=...)", s: "Same `thread_id`, one decision per request: approve, edit, reject or respond, as allowed.", tag: "you" },
          { t: "Tool runs or is refused", s: "Approved calls execute; a rejection message goes back to the model instead.", tag: "tool" },
        ],
        back: { from: 5, to: 1, label: "next model turn" },
      },
      explain: [
        "Human approval is a LangGraph interrupt, so a checkpointer is required. `interrupt_on` maps tool names to `True` (all decisions allowed), `False` (never pause) or a config such as `{\"allowed_decisions\": [\"approve\", \"reject\"]}`.",
        "When the run pauses, the state up to that point is already checkpointed. You resume by invoking with `Command(resume={\"decisions\": [...]})` and the same config. Decisions are matched to `action_requests` by position. Because state is on disk, the resume can happen in a different process.",
      ],
      code: {
        lang: "python",
        caption: "Host isolation gated by an analyst, with state in SQLite.",
        src: `from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command
from deepagents import create_deep_agent

async with AsyncSqliteSaver.from_conn_string("case-4812.db") as saver:
    agent = create_deep_agent(
        model="anthropic:claude-sonnet-5",
        tools=[search_alerts, isolate_host],
        interrupt_on={"isolate_host": {"allowed_decisions": ["approve", "reject"]}},
        checkpointer=saver,
    )
    config = {"configurable": {"thread_id": "case-4812"}}
    msg = {"role": "user", "content": "Contain WS-114"}
    result = await agent.ainvoke({"messages": [msg]}, config)

    if result.get("__interrupt__"):
        requests = result["__interrupt__"][0].value["action_requests"]
        decisions = [{"type": "approve"} if analyst_ok(r["args"])
                     else {"type": "reject", "message": "Analyst declined"}
                     for r in requests]
        result = await agent.ainvoke(Command(resume={"decisions": decisions}), config)`,
      },
      soc: "Map every containment tool (isolate, disable, block) to an approval and key threads by case ID, so the pending action and its exact arguments are durable evidence. Relay uses `AsyncSqliteSaver` per session and resumes from the exact checkpoint.",
      url: B + "human-in-the-loop",
    },
    {
      id: "summarization",
      title: "Summarisation and offloading",
      hook: "What happens when an investigation outgrows the context window?",
      diagram: {
        kind: "timeline",
        legend: { tool: "tool output", state: "written to backend", guard: "compaction" },
        events: [
          { t: "Large tool result", s: "A result above about 20,000 tokens is saved to the backend and replaced by a file path and a 10-line preview.", tag: "tool" },
          { t: "Old file-write args", s: "As context fills, older `write_file` and `edit_file` calls are truncated to pointers to the file.", tag: "state" },
          { t: "85% of max_input_tokens", s: "Summarisation triggers when context reaches 85% of the model's input limit.", tag: "guard" },
          { t: "History to filesystem", s: "A text rendering of the original messages is written to the backend as the canonical record.", tag: "state" },
          { t: "Summary replaces history", s: "A structured summary replaces older messages; about 10% of tokens of recent context are kept.", tag: "guard" },
          { t: "No model profile", s: "Fallback: trigger at 170,000 tokens and keep the last 6 messages.", tag: "guard" },
        ],
      },
      explain: [
        "Context management is two mechanisms. Offloading keeps single huge results out of the prompt: the agent can still `read_file` the full output later. Summarisation compresses the conversation as a whole near the model's input limit, while the full original stays on the backend.",
        "`SummarizationMiddleware` is in the default stack. The docs also show `create_summarization_tool_middleware`, which adds a `compact_conversation` tool so the agent can compact on demand. Thresholds come from the model profile and may change between releases.",
      ],
      code: {
        lang: "python",
        caption: "Let the agent compact its own context on demand, as in the docs.",
        src: `from deepagents import create_deep_agent
from deepagents.backends import StateBackend
from deepagents.middleware.summarization import create_summarization_tool_middleware

model = "anthropic:claude-sonnet-5"
agent = create_deep_agent(
    model=model,
    tools=[search_alerts],
    middleware=[create_summarization_tool_middleware(model, StateBackend)],
)`,
      },
      soc: "A summary can silently drop the one IOC that mattered, so keep the canonical record and cite evidence by ID, not from memory. Relay replaces native summarisation with its own compaction for this reason.",
      url: B + "context-engineering",
    },
  ],
};
