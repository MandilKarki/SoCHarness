import type { DeepDive } from "./types";

const B = "https://adk.dev/";

export const google_adk: DeepDive = {
  intro:
    "ADK is an event loop. Agent code yields an `Event` and pauses; the `Runner` hands it to the `SessionService`, which commits its state and artifact changes and records it in history; only then does the agent resume. Sessions, state scopes, workflow agents, callbacks and memory are all built on that yield, commit, resume cycle.",
  chapters: [
    {
      id: "event-loop",
      title: "Yield, commit, resume",
      hook: "When does a state change actually become real?",
      diagram: {
        kind: "lanes",
        actors: ["Caller", "Runner", "Agent", "SessionService"],
        msgs: [
          { from: 0, to: 1, t: "run_async(new_message)", s: "The caller sends a user message with a user_id and session_id. The runner records it as the first event of the invocation.", tag: "you" },
          { from: 1, to: 2, t: "agent.run_async(ctx)", s: "The runner builds an `InvocationContext` with a fresh `invocation_id` and starts the root agent's async generator.", tag: "core" },
          { from: 2, to: 1, t: "yield Event(state_delta)", s: "Agent, tool or callback logic yields an `Event` and pauses. Its `actions` may carry `state_delta` and `artifact_delta`.", tag: "event" },
          { from: 1, to: 3, t: "append_event(session, event)", s: "The service applies the deltas to session state and appends the event to the session's history.", tag: "state" },
          { from: 1, to: 0, t: "forward event", s: "The processed event is yielded upstream to the caller: a UI, a log, an API response.", tag: "event" },
          { from: 1, to: 2, t: "resume generator", s: "Only now does the agent continue. Code after the yield can rely on `ctx.session.state` holding the committed value.", tag: "core" },
          { from: 2, to: 1, t: "final response event", s: "The cycle repeats until the generator is exhausted. `event.is_final_response()` marks the answer.", tag: "stop" },
        ],
      },
      explain: [
        "Everything that happens in ADK is an `Event`: the user message, each model response, each function call and function response, each state change. Execution logic never writes to storage directly. It yields an event, and execution pauses at the `yield` until the `Runner` has processed it.",
        "Processing means the `Runner` calls `SessionService.append_event`, which applies `event.actions.state_delta` to `session.state`, records `artifact_delta`, and appends the event to `session.events`. Then the event goes upstream and the agent resumes. This is why an ADK session is a complete, replayable record: state is the sum of committed deltas.",
      ],
      code: {
        lang: "python",
        caption: "A custom agent that yields a state change, then reads it back after the runner has committed it.",
        src: `from typing import AsyncGenerator
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions

class CaseOpener(BaseAgent):
    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            actions=EventActions(state_delta={"case_status": "triage"}),
        )
        # Resumed: the Runner has already passed the event to append_event.
        assert ctx.session.state["case_status"] == "triage"`,
      },
      soc: "Because every state change rides on an event, the session's event list is an audit trail by construction: which agent changed which case field, in which invocation. Persist it with a durable `SessionService`, not the in-memory one.",
      url: B + "runtime/event-loop/",
    },
    {
      id: "dirty-reads",
      title: "Dirty reads and partial events",
      hook: "What can code see before a change is committed, and what is lost on a crash?",
      diagram: {
        kind: "timeline",
        legend: { state: "state change", event: "event", stop: "failure" },
        events: [
          { t: "Tool writes state", s: "A tool sets `tool_context.state['temp:ioc_count'] = 4`. The change is tracked for the next event, not yet committed.", tag: "state" },
          { t: "Dirty read", s: "A later callback or tool in the same invocation reads the key and sees the uncommitted value.", tag: "state" },
          { t: "Partial event (SSE)", s: "Streaming text arrives as events with `partial=True`. The runner forwards them upstream but does not process their actions.", tag: "event" },
          { t: "Final event yielded", s: "The non-partial event carrying the `state_delta` is yielded and handed to `append_event`.", tag: "event" },
          { t: "Commit", s: "The delta is applied and the event stored. `temp:` keys are applied in memory for this invocation but trimmed from the stored delta.", tag: "state" },
          { t: "Crash before yield", s: "If the invocation fails before that event is processed, the dirty change is lost. Nothing was persisted.", tag: "stop" },
        ],
      },
      explain: [
        "Within one invocation, code shares the same `InvocationContext`, so a later callback or tool can read a value that an earlier step wrote but has not yet been committed. The docs call this a dirty read. It is useful for passing data between steps, but if the invocation fails before the event carrying the `state_delta` is processed, the change is gone.",
        "Streaming adds a second rule. With `StreamingMode.SSE`, the model's text arrives as many events with `partial=True`. The runner forwards them so a UI can render progressively, but it skips their actions. Only the final, non-partial event commits state. Consumers must not treat a partial event as a durable fact.",
      ],
      code: {
        lang: "python",
        caption: "Stream partial text to the analyst, but audit only committed state changes.",
        src: `from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types

msg = types.Content(role="user", parts=[types.Part(text="Triage alert 4812")])
cfg = RunConfig(streaming_mode=StreamingMode.SSE, max_llm_calls=20)

async for event in runner.run_async(
    user_id="analyst-7", session_id="case-4812", new_message=msg, run_config=cfg
):
    if event.partial:
        push_to_ui(event.content)  # forwarded only; actions not committed
        continue
    if event.actions.state_delta:
        audit_log(event.invocation_id, event.author, event.actions.state_delta)
    if event.is_final_response():
        print(event.content.parts[0].text)`,
      },
      soc: "Never trigger a containment action or a ticket update from a partial event or a dirty read. Key side effects to committed, non-partial events so a crashed invocation cannot leave the case half-updated.",
      url: B + "runtime/event-loop/",
    },
    {
      id: "runner",
      title: "Runner, sessions and invocations",
      hook: "What does one call to run_async actually own?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "Runner(agent, services)", s: "A runner binds a root agent to an `app_name` and services: a `SessionService`, plus optional artifact and memory services.", tag: "core" },
          { t: "create_session()", s: "Sessions are created through the service, keyed by app_name, user_id and session_id. A missing session is an error unless `auto_create_session` is set.", tag: "state" },
          { t: "run_async(new_message)", s: "Each call is one invocation with one `invocation_id`. The user message is appended to the session first.", tag: "you" },
          { t: "Agent tree runs", s: "The root agent and any sub-agents run. `RunConfig.max_llm_calls` bounds model calls in the invocation.", tag: "model" },
          { t: "Events stream out", s: "Every processed event is yielded to the caller by the async generator.", tag: "event" },
          { t: "Session updated", s: "`session.events` and `session.state` now hold the full record the next invocation starts from.", tag: "state" },
        ],
        back: { from: 5, to: 2, label: "next user message, same session" },
      },
      explain: [
        "A `Runner` is the only thing that drives agents. `InMemoryRunner` is a `Runner` preconfigured with in-memory session, artifact and memory services, which is convenient for tests and lost on restart. In production you pass `DatabaseSessionService` or `VertexAiSessionService` to a plain `Runner`.",
        "An invocation is everything that happens in response to one user message, tied together by `invocation_id`. A session spans many invocations. `RunConfig.max_llm_calls` caps model calls per invocation; its default can be set with the `ADK_MAX_LLM_CALLS` environment variable (version-dependent).",
      ],
      code: {
        lang: "python",
        caption: "One invocation on a case session, then the session read back from the service.",
        src: `from google.adk.agents import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

triage = LlmAgent(name="triage", model="gemini-2.5-flash",
                  instruction="Triage the alert. Cite event IDs.", tools=[ip_reputation])
runner = InMemoryRunner(agent=triage, app_name="soc")
session = await runner.session_service.create_session(
    app_name="soc", user_id="analyst-7", session_id="case-4812")

msg = types.Content(role="user", parts=[types.Part(text="Is 203.0.113.7 malicious?")])
async for event in runner.run_async(user_id="analyst-7", session_id=session.id,
                                    new_message=msg):
    print(event.invocation_id, event.author, event.is_final_response())

session = await runner.session_service.get_session(
    app_name="soc", user_id="analyst-7", session_id="case-4812")
print(len(session.events), session.state)`,
      },
      soc: "Use the case ID as `session_id` and the analyst as `user_id`, so every follow-up lands in the right case. `max_llm_calls` is the cost brake for one investigation step; Relay already sets it from its turn limit.",
      url: B + "runtime/",
    },
    {
      id: "state-scopes",
      title: "State scopes are key prefixes",
      hook: "How does one state dict hold per-case, per-analyst and global values?",
      diagram: {
        kind: "tree",
        root: { t: "session.state[key]", s: "One dict-like view. The key prefix decides where a value is stored and who else can see it.", tag: "state" },
        children: [
          { t: "no prefix", s: "Session scope: this conversation only. Survives restarts only with a persistent SessionService.", tag: "state" },
          { t: "user:", s: "Shared by every session of the same user_id in this app.", tag: "state" },
          { t: "app:", s: "Shared by every user and session of the app.", tag: "state" },
          { t: "temp:", s: "Lives for one invocation, shared with sub-agents in it, and is never persisted.", tag: "event" },
          { t: "output_key", s: "An LlmAgent writes its final text into state under this key, through the event's `state_delta`.", tag: "core" },
        ],
      },
      explain: [
        "ADK has no separate stores for user or app data. It uses prefixes on state keys: no prefix for session scope, `user:` for the user, `app:` for the whole app, and `temp:` for the current invocation. The `SessionService` merges the scopes when it loads a session and splits them again when it commits a delta.",
        "You change state through a context so the change is tracked: `tool_context.state[...]` in a tool, `callback_context.state[...]` in a callback, or `output_key` on an `LlmAgent`. Instructions can read state with `{key}` templating, and `{key?}` tolerates a missing key. Mutating a session object fetched from the service directly bypasses the event and is not tracked.",
      ],
      code: {
        lang: "python",
        caption: "One tool writing three scopes, and an agent that reads state in its instruction.",
        src: `from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext

def record_ioc(ioc: str, tool_context: ToolContext) -> dict:
    """Record an indicator of compromise on the current case."""
    iocs = tool_context.state.get("iocs", [])
    tool_context.state["iocs"] = iocs + [ioc]       # this case (session)
    tool_context.state["temp:last_ioc"] = ioc       # this invocation only
    reviewed = tool_context.state.get("user:iocs_recorded", 0)
    tool_context.state["user:iocs_recorded"] = reviewed + 1  # this analyst
    return {"recorded": ioc}

summariser = LlmAgent(
    name="summariser", model="gemini-2.5-flash",
    instruction="Summarise case {case_id}. Known IOCs: {iocs?}",
    tools=[record_ioc], output_key="case_summary",
)`,
      },
      soc: "Scope tenant-wide settings with `app:` only if one app serves one tenant; otherwise `app:` state leaks across tenants. Keep untrusted alert text out of `{key}` templates that feed instructions, or it becomes a prompt-injection path.",
      url: B + "sessions/state/",
    },
    {
      id: "multi-agent",
      title: "Workflow agents, transfer and AgentTool",
      hook: "Who decides which agent runs next: your code or the model?",
      diagram: {
        kind: "tree",
        root: { t: "Agent tree (sub_agents)", s: "Agents form a tree through `sub_agents`. An agent instance can have only one parent.", tag: "core" },
        children: [
          { t: "SequentialAgent", s: "Runs sub-agents in order with the same InvocationContext. Data passes through session state, often via `output_key`.", tag: "core" },
          { t: "ParallelAgent", s: "Runs sub-agents concurrently in separate branches with no shared history during execution. Read their outputs afterwards.", tag: "core" },
          { t: "LoopAgent", s: "Repeats sub-agents until one escalates (for example with `exit_loop`) or `max_iterations` is reached.", tag: "stop" },
          { t: "LLM transfer", s: "An LlmAgent with sub-agents gets a `transfer_to_agent` tool. The chosen agent takes over the conversation.", tag: "model" },
          { t: "AgentTool", s: "Wraps an agent as a tool. It runs as a nested call and its answer returns to the caller, which keeps control.", tag: "tool" },
        ],
      },
      explain: [
        "Workflow agents are deterministic: `SequentialAgent`, `ParallelAgent` and `LoopAgent` contain no model call and decide order in code. A loop ends when a sub-agent's event sets `actions.escalate`, which the built-in `exit_loop` tool does, or after `max_iterations`.",
        "LLM-driven delegation is different. When an `LlmAgent` has `sub_agents`, ADK adds a transfer tool and the model picks the target by its `description`. Control moves to that agent. `disallow_transfer_to_parent` and `disallow_transfer_to_peers` restrict where it can go. ADK 2.x also adds `mode` (`chat`, `task`, `single_turn`) and graph workflows; check your version.",
      ],
      code: {
        lang: "python",
        caption: "Parallel enrichment, a bounded review loop, and a lead that consults a specialist as a tool.",
        src: `from google.adk.agents import LlmAgent, LoopAgent, ParallelAgent, SequentialAgent
from google.adk.tools import AgentTool, exit_loop

M = "gemini-2.5-flash"
ip_intel = LlmAgent(name="ip_intel", model=M, instruction="Enrich IPs.", output_key="ip")
host_intel = LlmAgent(name="host_intel", model=M, instruction="Enrich hosts.",
                      output_key="host")
enrich = ParallelAgent(name="enrich", sub_agents=[ip_intel, host_intel])

draft = LlmAgent(name="draft", model=M, output_key="verdict",
                 instruction="Draft a verdict from {ip} and {host}.")
review = LlmAgent(name="review", model=M, tools=[exit_loop],
                  instruction="Check {verdict}. Call exit_loop if it is sound.")
refine = LoopAgent(name="refine", sub_agents=[draft, review], max_iterations=3)
pipeline = SequentialAgent(name="triage_pipeline", sub_agents=[enrich, refine])

malware = LlmAgent(name="malware", model=M, description="Deep malware triage.")
lead = LlmAgent(name="lead", model=M, instruction="Coordinate the case.",
                tools=[AgentTool(agent=malware)])`,
      },
      soc: "Put the steps that must always happen (enrichment, evidence capture) in workflow agents, where the order is in code. Reserve model-chosen transfer for routing, and keep `max_iterations` low so a review loop cannot spend without limit.",
      url: B + "agents/workflow-agents/",
    },
    {
      id: "callbacks",
      title: "Callbacks short-circuit by returning a value",
      hook: "How do you stop a model call or a tool call before it happens?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "before/after_agent_callback", s: "Wraps the agent's run. Returning `types.Content` from `before_agent_callback` skips the agent and uses that content instead.", u: "`after_agent_callback` can return Content that replaces the agent's output.", tag: "guard" },
          { t: "before/after_model_callback", s: "Runs before each LLM call with the `LlmRequest`. Returning an `LlmResponse` skips the model call.", u: "`after_model_callback` can return an LlmResponse that replaces the model's.", tag: "guard" },
          { t: "before/after_tool_callback", s: "Runs before each tool with `(tool, args, tool_context)`. Returning a dict skips the tool and becomes its result.", u: "`after_tool_callback` gets `tool_response`; a returned dict replaces it.", tag: "tool" },
        ],
        core: { t: "Model or tool runs", s: "Reached only when every before-callback returned None.", tag: "model" },
      },
      explain: [
        "Every callback follows one rule: return `None` to let ADK continue, return a value to replace the step. `before_model_callback(callback_context, llm_request)` returning an `LlmResponse` means the model is never called. `before_tool_callback(tool, args, tool_context)` returning a dict, even an empty one, means the tool never runs and the dict is its result.",
        "Each slot also accepts a list. ADK calls them in order until one returns a value. Callbacks receive a context with tracked `state`, so a guard can read the analyst's role from `user:` state. For policy that applies to every agent in an app, the docs point to plugins (`BasePlugin`) instead of per-agent callbacks.",
      ],
      code: {
        lang: "python",
        caption: "Block suspected prompt injection before the model, and gate containment before the tool.",
        src: `from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models import LlmRequest, LlmResponse
from google.adk.tools import BaseTool, ToolContext
from google.genai import types

def block_injection(callback_context: CallbackContext, llm_request: LlmRequest):
    text = str(llm_request.contents[-1]) if llm_request.contents else ""
    if "ignore previous instructions" in text.lower():
        return LlmResponse(content=types.Content(
            role="model", parts=[types.Part(text="Alert text flagged for review.")]))
    return None  # continue to the model

def gate_containment(tool: BaseTool, args: dict, tool_context: ToolContext):
    if tool.name == "isolate_host" and not tool_context.state.get("user:can_contain"):
        return {"status": "denied", "reason": "analyst lacks containment role"}
    return None  # run the tool

responder = LlmAgent(name="responder", model="gemini-2.5-flash", tools=[isolate_host],
                     before_model_callback=block_injection,
                     before_tool_callback=gate_containment)`,
      },
      soc: "`before_tool_callback` is where a containment permission check belongs: it sees the exact arguments and can refuse without the tool ever running. A keyword filter is not a real injection defence; use it to route alerts to review, not as the only control.",
      url: B + "callbacks/types-of-callbacks/",
    },
    {
      id: "memory",
      title: "Memory is separate from the session",
      hook: "How does an agent recall a case it handled last week?",
      diagram: {
        kind: "loop",
        center: "MemoryService",
        exit: "matches return to the model as context",
        steps: [
          { t: "Session closes", s: "A case conversation lives in its Session. Its events are not searchable from other sessions.", tag: "state" },
          { t: "add_session_to_memory()", s: "Your code, or a callback, hands the finished session to the MemoryService to ingest.", tag: "state" },
          { t: "New session starts", s: "A later session for the same app and user starts with empty history.", tag: "you" },
          { t: "load_memory tool", s: "`load_memory` lets the model search on demand; `preload_memory` injects matches before each model call.", tag: "tool" },
          { t: "search_memory()", s: "Both call the MemoryService search, scoped to the app_name and user_id of the current session.", tag: "state" },
        ],
      },
      explain: [
        "A `Session` is short-term: one conversation's events and state. A `MemoryService` is long-term and searchable across sessions. Nothing moves between them automatically: you call `add_session_to_memory(session)` (or `callback_context.add_session_to_memory()`) when a session is worth remembering.",
        "`InMemoryMemoryService` does simple keyword matching and is lost on restart. `VertexAiMemoryBankService` extracts and consolidates memories with a model. Agents read memory through the `load_memory` or `preload_memory` tools, or `tool_context.search_memory(query)` inside your own tool.",
      ],
      code: {
        lang: "python",
        caption: "Ingest a closed case into memory so later triage can search it.",
        src: `from google.adk.agents import LlmAgent
from google.adk.memory import InMemoryMemoryService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import load_memory

memory = InMemoryMemoryService()
sessions = InMemorySessionService()
agent = LlmAgent(name="triage", model="gemini-2.5-flash", tools=[load_memory],
                 instruction="Use load_memory to find prior cases on the same host.")
runner = Runner(app_name="soc", agent=agent, session_service=sessions,
                memory_service=memory)

# After case 4812 is closed:
closed = await sessions.get_session(app_name="soc", user_id="analyst-7",
                                    session_id="case-4812")
await memory.add_session_to_memory(closed)`,
      },
      soc: "Memory search is scoped by app and user, not by tenant, so a multi-tenant SOC needs its own scoping (one app per tenant, or a custom service). Decide what is ingested: closed, reviewed cases, not raw attacker-controlled alert text.",
      url: B + "sessions/memory/",
    },
  ],
};
