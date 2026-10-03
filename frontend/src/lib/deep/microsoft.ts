import type { DeepDive } from "./types";

const B = "https://learn.microsoft.com/en-us/agent-framework/";

export const microsoft: DeepDive = {
  intro:
    "Agent Framework has two engines. An `Agent` is a chat client wrapped in layers: middleware, context providers and a function-invocation loop. A workflow is a typed graph of executors run in Pregel-style supersteps, with checkpoints at each boundary. This deep dive follows the 1.x Python API; earlier previews used names such as `ChatAgent` and `run_stream`.",
  chapters: [
    {
      id: "agent-loop",
      title: "Agent.run and the function-invocation loop",
      hook: "Where does the tool-calling loop actually live?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "agent.run(msg, session)", s: "You call `run()` on an `Agent`: a chat client plus instructions, tools and options. `stream=True` yields updates instead.", tag: "you" },
          { t: "before_run providers", s: "Context providers add history and instructions to the request before any model call.", tag: "state" },
          { t: "Chat client call", s: "The client sends messages, instructions and tool schemas to the provider.", tag: "model" },
          { t: "Invoke functions", s: "If the response contains function calls, the client's `FunctionInvocationLayer` runs the tools and appends their results.", tag: "tool" },
          { t: "after_run providers", s: "Providers see the request and response messages, so they can store history or extract memory.", tag: "state" },
          { t: "AgentResponse", s: "No calls left: `text`, `value` for structured output, `usage_details` and `finish_reason`.", tag: "stop" },
        ],
        back: { from: 3, to: 2, label: "until max_iterations" },
      },
      explain: [
        "The tool loop is not in the `Agent`. It is a layer of the chat client: classes such as `OpenAIChatCompletionClient` are built from `FunctionInvocationLayer`, `ChatMiddlewareLayer` and a telemetry layer over a raw client. The agent prepares messages and options; the client loops model call, tool calls, model call.",
        "The loop is configured with `function_invocation_configuration`: `max_iterations` caps model round trips, `max_function_calls` caps total tool executions, `max_duration_seconds` caps wall time. The call limits are best-effort and checked after each batch of parallel calls. When one trips, the loop stops calling tools and asks the model for a text answer.",
      ],
      code: {
        lang: "python",
        caption: "An agent over the OpenAI Chat Completions client with a bounded tool loop.",
        src: `from typing import Annotated
from pydantic import Field
from agent_framework import Agent, tool
from agent_framework.openai import OpenAIChatCompletionClient

@tool(approval_mode="never_require")
def ip_reputation(ip: Annotated[str, Field(description="IPv4 address")]) -> str:
    """Return reputation for an IP address."""
    return f"{ip}: seen in 3 phishing campaigns"

client = OpenAIChatCompletionClient(
    model="gpt-4.1-mini",
    function_invocation_configuration={"max_iterations": 6, "max_function_calls": 12},
)
agent = Agent(client=client, name="triage", instructions="Triage the alert.",
              tools=[ip_reputation])

response = await agent.run("Is 203.0.113.7 malicious?")
print(response.text, response.usage_details)`,
      },
      soc: "Set `max_function_calls` and `max_duration_seconds` on every client: they are the per-request cost and runaway brakes. Relay already sets iteration and call limits and disables concurrent invocation so tool calls run in model order.",
      url: B + "concepts/agents/",
    },
    {
      id: "middleware",
      title: "Three middleware layers",
      hook: "Which layer sees the whole run, each model call, or each tool call?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "Agent middleware", s: "Wraps one `agent.run()`. `AgentContext` has the messages, session and options; skip `call_next()` to block the run.", u: "After `call_next()`, it can replace `context.result`.", tag: "guard" },
          { t: "Function invocation loop", s: "Inside the run the client loops. Each tool call passes through function middleware with `FunctionInvocationContext`.", u: "Function middleware sees `context.result` and may overwrite it.", tag: "tool" },
          { t: "Chat middleware", s: "Runs inside the loop for every model call, with `ChatContext.messages` and `options`.", u: "It sees the raw `ChatResponse` before the loop inspects it.", tag: "guard" },
        ],
        core: { t: "Provider request", s: "The HTTP call to the model provider.", tag: "model" },
      },
      explain: [
        "Every middleware is `async def mw(context, call_next)`. The type of `context` decides the layer: `AgentContext`, `FunctionInvocationContext` or `ChatContext`. Class-based (`AgentMiddleware`, `FunctionMiddleware`, `ChatMiddleware`) and decorator forms exist too. Agent-level middleware runs outside run-level middleware passed to `run()`.",
        "Failure semantics differ. An ordinary exception in function middleware becomes a tool error that the model sees, and the loop continues. `MiddlewareFailure` is the fail-closed signal: the batch is cancelled, no further tool starts, and the error reaches the caller. `MiddlewareTermination` stops gracefully, optionally with a substitute result.",
      ],
      code: {
        lang: "python",
        caption: "Run-level audit plus a fail-closed guard on host isolation.",
        src: `from collections.abc import Awaitable, Callable
from agent_framework import (Agent, AgentContext, FunctionInvocationContext,
                             MiddlewareFailure)

PROTECTED = {"10.0.0.10"}  # domain controller

async def audit_run(context: AgentContext, call_next: Callable[[], Awaitable[None]]):
    print("run start:", len(context.messages), "messages")
    await call_next()
    print("run end")

async def guard_isolation(context: FunctionInvocationContext,
                          call_next: Callable[[], Awaitable[None]]):
    if (context.function.name == "isolate_host"
            and context.arguments.get("ip") in PROTECTED):
        raise MiddlewareFailure("refusing to isolate a protected host")
    await call_next()

agent = Agent(client=client, instructions="Contain the incident.",
              tools=[isolate_host], middleware=[audit_run, guard_isolation])`,
      },
      soc: "Enforcement must use `MiddlewareFailure`; a plain exception in function middleware is fail-open, because the loop turns it into a tool error and keeps going. Use chat middleware to redact secrets from every request that leaves for the provider.",
      url: B + "concepts/agents/middleware/",
    },
    {
      id: "sessions",
      title: "AgentSession and context providers",
      hook: "Where does conversation history live between runs?",
      diagram: {
        kind: "lanes",
        actors: ["App", "Agent", "ContextProvider", "Chat client", "AgentSession"],
        msgs: [
          { from: 0, to: 1, t: "run(msg, session=s)", s: "The app passes the same `AgentSession` on every turn of a conversation.", tag: "you" },
          { from: 1, to: 2, t: "before_run(context, state)", s: "Each provider gets the `SessionContext` and its own slice of `session.state`, keyed by its `source_id`.", tag: "state" },
          { from: 2, to: 4, t: "load history / state", s: "With no service-side storage, an `InMemoryHistoryProvider` is added and keeps messages in session state.", tag: "state" },
          { from: 1, to: 3, t: "get_response(messages)", s: "The request now holds prior history and provider instructions.", tag: "model" },
          { from: 1, to: 2, t: "after_run(context, state)", s: "Providers see input and response messages, to append history or extract memory.", tag: "state" },
          { from: 0, to: 4, t: "to_dict() / from_dict()", s: "The session serialises to a plain dict and can be restored in another process.", tag: "state" },
        ],
      },
      explain: [
        "`AgentSession` (called a thread in early previews) is a small container: a `session_id`, an optional `service_session_id` for provider-stored history, and a mutable `state` dict. Providers belong to the agent, not the session, so one agent serves many sessions.",
        "If the agent has no history provider and the service does not store history, `run()` adds an `InMemoryHistoryProvider` that keeps messages in `session.state`. That is why `to_dict()` carries the whole conversation. Custom `ContextProvider` subclasses implement `before_run` and `after_run` to inject instructions or memory per call.",
      ],
      code: {
        lang: "python",
        caption: "A provider that injects case context, and a session persisted between turns.",
        src: `from typing import Any
from agent_framework import Agent, AgentSession, ContextProvider, SessionContext

class CaseContext(ContextProvider):
    async def before_run(self, *, agent: Any, session: AgentSession | None,
                         context: SessionContext, state: dict[str, Any]) -> None:
        hosts = state.setdefault("hosts", [])
        context.extend_instructions(
            self.source_id, f"Hosts already triaged: {', '.join(hosts) or 'none'}.")

agent = Agent(client=client, instructions="Triage case 4812.",
              context_providers=[CaseContext("case_context")])
session = agent.create_session(session_id="case-4812")
await agent.run("Which hosts beaconed to 203.0.113.7?", session=session)

saved = session.to_dict()  # store with the case
restored = AgentSession.from_dict(saved)
await agent.run("Which one should be isolated first?", session=restored)`,
      },
      soc: "Relay stores `AgentSession.to_dict()` in its native-state column, so a case can continue after a restart. Treat `service_session_id` as trusted app state: the docs note it is not an end-user authorisation boundary.",
      url: B + "concepts/agents/conversations/session",
    },
    {
      id: "supersteps",
      title: "Workflows run in supersteps",
      hook: "In what order do executors run, and when do they see each other's writes?",
      diagram: {
        kind: "loop",
        center: "Superstep",
        exit: "ends when no messages are pending",
        steps: [
          { t: "Deliver messages", s: "Messages sent in the previous superstep are routed along edges. Edge conditions decide which targets receive them.", tag: "event" },
          { t: "Run executors", s: "Every executor that received a message runs its `@handler`. They run concurrently within the superstep.", tag: "core" },
          { t: "Barrier", s: "The workflow waits for every triggered executor to finish before moving on.", tag: "guard" },
          { t: "Commit state", s: "Pending `ctx.set_state` writes are committed, so the next superstep sees them.", tag: "state" },
          { t: "Checkpoint", s: "If checkpoint storage is configured, a checkpoint is saved at this boundary.", tag: "state" },
        ],
      },
      explain: [
        "A workflow is a graph of `Executor`s joined by edges, built with `WorkflowBuilder(start_executor=...)`, `add_edge(source, target, condition=...)` and `build()`. Fan-out, fan-in and switch-case edge groups exist too. A handler is typed: `WorkflowContext[T]` means it may `send_message(T)`, and `WorkflowContext[Never, U]` means it may `yield_output(U)`.",
        "Execution follows Bulk Synchronous Parallel rules. Within a superstep, triggered executors run in parallel; nothing advances until all finish. Shared-state writes are buffered and committed at the barrier. The run ends when no messages are pending, or raises after `max_iterations` supersteps. A slow branch therefore holds up the whole superstep.",
      ],
      code: {
        lang: "python",
        caption: "Two executors joined by a conditional edge, run with streaming events.",
        src: `from typing_extensions import Never
from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler

class Score(Executor):
    @handler
    async def score(self, alert: dict, ctx: WorkflowContext[dict]) -> None:
        alert["severity"] = 9 if "mimikatz" in alert["cmdline"] else 3
        await ctx.send_message(alert)

class Escalate(Executor):
    @handler
    async def page(self, alert: dict, ctx: WorkflowContext[Never, str]) -> None:
        await ctx.yield_output(f"Paged on-call for host {alert['host']}")

score, escalate = Score(id="score"), Escalate(id="escalate")
workflow = (WorkflowBuilder(start_executor=score)
            .add_edge(score, escalate, condition=lambda a: a["severity"] >= 7)
            .build())

async for event in workflow.run({"host": "WS-114", "cmdline": "mimikatz.exe"},
                                stream=True):
    if event.type == "output":
        print(event.data)`,
      },
      soc: "Deterministic routing (severity thresholds, allowlists) belongs on edge conditions in code, not in a prompt. The superstep boundary gives you a natural place to log each step for audit.",
      url: B + "concepts/workflows/builder-and-execution",
    },
    {
      id: "checkpoints",
      title: "Checkpoints and resume",
      hook: "What survives if the worker dies halfway through an investigation?",
      diagram: {
        kind: "timeline",
        legend: { state: "checkpoint", core: "framework", stop: "failure", event: "resume" },
        events: [
          { t: "Entry checkpoint", s: "Since Python 1.13.0, a checkpoint is written before the first superstep, capturing the input.", tag: "state" },
          { t: "Superstep 1 ends", s: "A checkpoint captures executor state, pending messages, pending requests and shared state.", tag: "state" },
          { t: "on_checkpoint_save()", s: "Executors that keep fields in memory return them here so they are included.", tag: "core" },
          { t: "Crash in superstep 3", s: "Work done inside the unfinished superstep is in no checkpoint and will run again.", tag: "stop" },
          { t: "run(checkpoint_id=...)", s: "The workflow restores the saved state, calls `on_checkpoint_restore`, and re-queues pending messages.", tag: "core" },
          { t: "Continue", s: "Execution resumes from the last completed superstep boundary.", tag: "event" },
        ],
      },
      explain: [
        "Checkpointing is enabled by passing `checkpoint_storage` to `WorkflowBuilder` or to `run()`. Built-in stores are `InMemoryCheckpointStorage` and `FileCheckpointStorage`; a Cosmos DB store ships separately. Checkpoints are also written when responses to pending requests are delivered (Python 1.13.0 and later).",
        "Resume with `workflow.run(checkpoint_id=...)`, optionally on a fresh workflow instance built from the same graph. Because restore replays from a boundary, the unfinished superstep runs again, so executors with side effects must be idempotent. Checkpoints use a restricted unpickler; custom types need `allowed_checkpoint_types`.",
      ],
      code: {
        lang: "python",
        caption: "File-backed checkpoints and resuming from the latest one after a failure.",
        src: `from agent_framework import FileCheckpointStorage, WorkflowBuilder

storage = FileCheckpointStorage("/var/relay/checkpoints/case-4812")
workflow = (WorkflowBuilder(start_executor=score, checkpoint_storage=storage)
            .add_edge(score, escalate)
            .build())

try:
    await workflow.run({"host": "WS-114", "cmdline": "mimikatz.exe"})
except Exception:
    latest = await storage.get_latest(workflow_name=workflow.name)
    if latest:
        print("resuming after superstep", latest.iteration_count)
        await workflow.run(checkpoint_id=latest.checkpoint_id)`,
      },
      soc: "Make response actions idempotent (check whether the host is already isolated) because a resumed superstep runs again. The docs treat checkpoint storage as a trust boundary: never load checkpoints from a location an attacker could write to.",
      url: B + "workflows/checkpoints",
    },
    {
      id: "hitl",
      title: "Human input as request and response",
      hook: "How does a workflow wait for an analyst without blocking a thread?",
      diagram: {
        kind: "lanes",
        actors: ["Analyst app", "Workflow", "ContainmentGate"],
        msgs: [
          { from: 0, to: 1, t: "run(alert, stream=True)", s: "The app starts the workflow and reads its event stream.", tag: "you" },
          { from: 2, to: 1, t: "ctx.request_info(req, bool)", s: "The executor asks for outside input, naming the expected response type.", tag: "guard" },
          { from: 1, to: 0, t: "request_info event", s: "The workflow emits an event with a `request_id` and the request data, then goes idle with the request pending.", tag: "event" },
          { from: 0, to: 1, t: "run(responses={id: True})", s: "Minutes or days later, the app sends answers keyed by `request_id`, optionally with a `checkpoint_id`.", tag: "you" },
          { from: 1, to: 2, t: "@response_handler", s: "The framework calls the handler with the original request and the typed response.", tag: "core" },
          { from: 2, to: 1, t: "send_message(...)", s: "The handler continues the graph: isolate the host or record the denial.", tag: "tool" },
        ],
      },
      explain: [
        "Human-in-the-loop is part of the graph protocol. An executor calls `ctx.request_info(request_data, response_type)`; the workflow emits a `request_info` event and stops advancing that path. Early previews used a separate `RequestInfoExecutor`; in 1.x any executor can ask, and must define a matching `@response_handler`.",
        "The answer comes back through `workflow.run(responses={request_id: value})`. With checkpointing, pending requests are saved, so the response can arrive in another process after `run(checkpoint_id=..., responses=...)`. For single agents, tools declared with `approval_mode=\"always_require\"` produce approval requests instead of running.",
      ],
      code: {
        lang: "python",
        caption: "An approval gate executor, and the caller collecting and answering its requests.",
        src: `from dataclasses import dataclass
from agent_framework import Executor, WorkflowContext, handler, response_handler

@dataclass
class IsolationRequest:
    host: str
    reason: str

class ContainmentGate(Executor):
    @handler
    async def propose(self, alert: dict, ctx: WorkflowContext[str]) -> None:
        await ctx.request_info(IsolationRequest(alert["host"], "beaconing"), bool)

    @response_handler
    async def decided(self, request: IsolationRequest, approved: bool,
                      ctx: WorkflowContext[str]) -> None:
        await ctx.send_message(f"isolate {request.host}" if approved else "denied")

# Caller: collect pending requests, ask the analyst, resume with the answers.
pending = {e.request_id: e.data async for e in workflow.run(alert, stream=True)
           if e.type == "request_info"}
await workflow.run(responses={rid: analyst_approves(r) for rid, r in pending.items()})`,
      },
      soc: "This is the containment gate for multi-step playbooks: the request carries the exact host and reason, and nothing downstream runs until the analyst answers. Persist the checkpoint with the case so the approval survives a restart.",
      url: B + "workflows/human-in-the-loop",
    },
    {
      id: "orchestrations",
      title: "Orchestrations are prebuilt workflows",
      hook: "Which multi-agent pattern should you reach for?",
      diagram: {
        kind: "tree",
        root: { t: "Orchestration builders", s: "Builders in `agent_framework.orchestrations`. Each `build()` returns an ordinary `Workflow`, with the same events and checkpoints.", tag: "core" },
        children: [
          { t: "SequentialBuilder", s: "Agents run in a fixed order, each seeing the conversation so far.", tag: "core" },
          { t: "ConcurrentBuilder", s: "Agents run in parallel on the same input; their results are aggregated.", tag: "core" },
          { t: "HandoffBuilder", s: "Agents transfer control to each other. The workflow requests user input when an agent replies without a handoff.", tag: "model" },
          { t: "GroupChatBuilder", s: "A selection function or orchestrator agent picks the next speaker until a termination condition holds.", tag: "model" },
          { t: "MagenticBuilder", s: "A manager plans, tracks progress in a ledger and delegates to participants. Plan review can involve a human.", tag: "model" },
        ],
      },
      explain: [
        "Orchestrations are not a separate runtime. Each builder wires agents as executors in a graph, so supersteps, checkpoints and `request_info` all apply. Sequential and concurrent are deterministic. Handoff, group chat and Magentic let a model choose who speaks next, within `termination_condition` and turn limits you set.",
        "Use the simplest pattern that fits. Concurrent fits independent enrichment; sequential fits draft then review; handoff fits tiered escalation. Magentic is the most autonomous and the most expensive, because the manager makes extra model calls to plan and track progress. The builders ship in the `agent-framework-orchestrations` package.",
      ],
      code: {
        lang: "python",
        caption: "Concurrent enrichment and a sequential write-then-review pipeline.",
        src: `from agent_framework import Agent
from agent_framework.orchestrations import ConcurrentBuilder, SequentialBuilder

def make(name: str, job: str) -> Agent:
    return Agent(client=client, name=name, instructions=job)

enrich = ConcurrentBuilder(participants=[
    make("ip_intel", "Enrich the IPs."),
    make("host_intel", "Enrich the hosts."),
    make("identity", "Check the user's recent sign-ins."),
]).build()

report = SequentialBuilder(participants=[
    make("writer", "Draft the incident summary."),
    make("reviewer", "Check the summary against the evidence."),
]).build()

result = await enrich.run("Alert 4812: WS-114 beaconing to 203.0.113.7")
for output in result.get_outputs():
    print(output)`,
      },
      soc: "Start with concurrent enrichment and sequential review; they are predictable and their cost is fixed by the participant count. Add handoff or Magentic only with a hard termination condition and a cost limit, since the model decides how many turns they take.",
      url: B + "workflows/orchestrations/",
    },
  ],
};
