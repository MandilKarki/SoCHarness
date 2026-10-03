import type { DeepDive } from "./types";

const B = "https://docs.openhands.dev/sdk/";

export const openhands: DeepDive = {
  intro:
    "The OpenHands SDK is event-sourced. A `Conversation` owns an append-only log of typed events; the `Agent` is stateless, and each `step()` reads that log, calls the LLM and appends actions and observations. Confirmation, condensation, persistence and remote execution are all ways of writing to, filtering or relocating that one log.",
  chapters: [
    {
      id: "event-log",
      title: "The event log is the conversation",
      hook: "Where does the agent's state actually live?",
      diagram: {
        kind: "timeline",
        legend: {
          event: "setup",
          you: "user input",
          model: "agent output",
          tool: "environment output",
          state: "internal, never sent to the LLM",
          stop: "run ends",
        },
        events: [
          { t: "SystemPromptEvent", s: "The first event holds the system prompt and tool schemas. It is LLM-convertible, so it becomes the `system` message.", tag: "event" },
          { t: "MessageEvent (user)", s: "`send_message()` appends your text with `source=\"user\"`. Nothing runs until you call `run()`.", tag: "you" },
          { t: "ActionEvent", s: "The agent's tool call, carrying its thought, reasoning and an LLM-assigned `security_risk`.", tag: "model" },
          { t: "ObservationEvent", s: "The tool result, with `source=\"environment\"`. It reaches the model as a `tool` message.", tag: "tool" },
          { t: "ConversationStateUpdateEvent", s: "A state field changed (status, stats). Callbacks receive it; the LLM never sees it.", tag: "state" },
          { t: "MessageEvent (agent)", s: "A plain text reply with no tool calls sets status to FINISHED and `run()` returns.", tag: "stop" },
        ],
      },
      explain: [
        "`Conversation` holds a `ConversationState` whose `events` field is an append-only `EventLog`. Every message, tool call and tool result is an immutable Pydantic event with an ID, a timestamp and a `source` (`user`, `agent` or `environment`). Each update takes a FIFO lock, appends, fires your callbacks, then releases, so callbacks see events in commit order.",
        "Events come in two families. `LLMConvertibleEvent`s (messages, actions, observations, condensation summaries) become LLM messages; internal events (state updates, pause, condensation requests) do not. Building the prompt is a fold over the log: filter convertible events, group parallel `ActionEvent`s by `llm_response_id`, convert each to a message.",
        "Because the log is the single source of truth, services such as persistence, stuck detection and visualisation only read it. The docs warn against inferring origin from LLM role: framework messages can be `source=\"environment\"` yet be shown to the model as `user`.",
      ],
      code: {
        lang: "python",
        caption: "Collect every event through a callback, then read the log back and see which events the model saw.",
        src: `import os
from openhands.sdk import LLM, Agent, Conversation, Event, LLMConvertibleEvent, Tool
from openhands.tools.terminal import TerminalTool

llm = LLM(usage_id="agent", model=os.getenv("LLM_MODEL"),
          api_key=os.getenv("LLM_API_KEY"))
agent = Agent(llm=llm, tools=[Tool(name=TerminalTool.name)])

audit: list[Event] = []
conversation = Conversation(agent=agent, workspace="./case-4812",
                            callbacks=[audit.append])
conversation.send_message("Count failed SSH logins per IP in auth.log")
conversation.run()

for event in conversation.state.events:
    seen = "LLM" if isinstance(event, LLMConvertibleEvent) else "internal"
    print(event.source, type(event).__name__, seen)`,
      },
      soc: "The event log is a ready-made audit trail: every tool call, its arguments and its result, in order. Use `Event.source`, not the LLM role, to tell real analyst input from text that arrived inside an alert or tool output.",
      url: B + "arch/events",
    },
    {
      id: "step",
      title: "A stateless agent, one step at a time",
      hook: "What happens each time the conversation asks the agent to move?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "Conversation.run()", s: "Calls `agent.step()` repeatedly until the status is terminal or `max_iteration_per_run` is reached.", tag: "you" },
          { t: "Pending actions?", s: "If approved actions are waiting from a confirmation pause, they execute now and the step returns.", tag: "guard" },
          { t: "Condense the view", s: "With a condenser, `condense()` returns a smaller View, or emits a Condensation event and returns early.", tag: "state" },
          { t: "Query the LLM", s: "Messages built from the view go to the `LLM`. A context-window overflow emits `CondensationRequest` instead.", tag: "model" },
          { t: "Parse the response", s: "Tool calls become `ActionEvent`s. Plain text becomes a `MessageEvent` and the conversation is FINISHED.", tag: "core" },
          { t: "Execute and observe", s: "Unless confirmation is required, tools run and `ObservationEvent`s are appended to the log.", tag: "tool" },
        ],
        back: { from: 5, to: 0, label: "next step until FINISHED or limit" },
      },
      explain: [
        "`Agent` holds configuration only: `llm`, `tools`, an optional `condenser` and `agent_context`. It keeps no mutable state between steps. Each `step()` reads the event history, writes new events and returns, which makes every step atomic: a pause, a crash or a confirmation can happen between steps without losing anything.",
        "A run ends when the model answers in plain text or calls the built-in `finish` tool (added by default with `think` through `include_default_tools`). `max_iteration_per_run` defaults to 500; when it is hit the status becomes ERROR and a `ConversationErrorEvent` with code `MaxIterationsReached` is appended. The docs say ERROR makes `run()` raise `ConversationRunError`.",
      ],
      code: {
        lang: "python",
        caption: "The documented hello-world shape, with a tighter step budget for a triage task.",
        src: `import os
from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool

llm = LLM(usage_id="agent", model=os.getenv("LLM_MODEL"),
          api_key=os.getenv("LLM_API_KEY"))
agent = Agent(llm=llm, tools=[Tool(name=TerminalTool.name),
                              Tool(name=FileEditorTool.name)])

conversation = Conversation(
    agent=agent,
    workspace="./case-4812",
    max_iteration_per_run=30,  # default is 500
)
conversation.send_message("Extract IPs, domains and hashes from alert.json into iocs.txt")
conversation.run()
print(conversation.state.execution_status)`,
      },
      soc: "Thirty steps is plenty for most triage tasks; a low `max_iteration_per_run` turns a looping investigation into a visible error instead of a large bill. Relay sets this limit today but has no USD cap yet.",
      url: B + "arch/agent",
    },
    {
      id: "tools",
      title: "Typed tools: Action in, Observation out",
      hook: "How does a JSON tool call become a validated, typed execution?",
      diagram: {
        kind: "lanes",
        actors: ["LLM", "Agent", "ToolDefinition", "ToolExecutor", "Event log"],
        msgs: [
          { from: 0, to: 1, t: "tool_call (JSON args)", s: "The model calls a tool by name with JSON arguments.", tag: "model" },
          { from: 1, to: 2, t: "action_from_arguments()", s: "Arguments are validated into the tool's Pydantic `Action`. Bad JSON or a schema mismatch becomes an `AgentErrorEvent` instead.", tag: "guard" },
          { from: 1, to: 4, t: "ActionEvent", s: "The validated action is wrapped in an `ActionEvent` and appended to the log.", tag: "event" },
          { from: 2, to: 3, t: "__call__(action)", s: "The tool passes the typed action, and the conversation, to its executor.", tag: "tool" },
          { from: 3, to: 2, t: "Observation", s: "The executor returns a typed `Observation`. Its `to_llm_content` decides what the model will read.", tag: "tool" },
          { from: 1, to: 4, t: "ObservationEvent", s: "The observation is wrapped with the tool call ID and appended.", tag: "event" },
          { from: 4, to: 0, t: "role=tool message", s: "On the next step the observation reaches the model as a tool message.", tag: "model" },
        ],
      },
      explain: [
        "The tool system knows nothing about events or LLM messages. A tool is an `Action` schema, an `Observation` schema and a `ToolExecutor`; the `Agent` does the wrapping into `ActionEvent` and `ObservationEvent`. Tool schemas for the LLM are generated from the Pydantic models, so field descriptions are the documentation the model reads.",
        "Stateful tools subclass `ToolDefinition` and implement `create(conv_state)`, which builds executors from the conversation's workspace. You register the class with `register_tool()` and give the agent a `Tool(name=...)` spec, not an instance: specs are resolved when the conversation starts, which keeps the `Agent` serialisable. A subclass named `IpLookupTool` gets the tool name `ip_lookup`.",
      ],
      code: {
        lang: "python",
        caption: "A minimal typed enrichment tool registered by name, following the custom-tools guide.",
        src: `from collections.abc import Sequence
from pydantic import Field
from openhands.sdk import Action, Agent, Observation, ToolDefinition
from openhands.sdk.tool import Tool, ToolExecutor, register_tool

class IpLookupAction(Action):
    ip: str = Field(description="IPv4 or IPv6 address to look up")

class IpLookupExecutor(ToolExecutor[IpLookupAction, Observation]):
    def __call__(self, action: IpLookupAction, conversation=None) -> Observation:
        verdict = threat_intel.lookup(action.ip)  # your TI client
        return Observation.from_text(f"{action.ip}: {verdict}")

class IpLookupTool(ToolDefinition[IpLookupAction, Observation]):
    @classmethod
    def create(cls, conv_state) -> Sequence[ToolDefinition]:
        return [cls(description="Look up IP reputation.", action_type=IpLookupAction,
                    observation_type=Observation, executor=IpLookupExecutor())]

register_tool(IpLookupTool.name, IpLookupTool)
agent = Agent(llm=llm, tools=[Tool(name=IpLookupTool.name)])`,
      },
      soc: "Pydantic validation happens before execution, so a malformed IP or hostname never reaches your SIEM or EDR client. Relay uses this pattern for its single typed gateway tool, which keeps case scoping in the executor rather than in the prompt.",
      url: B + "arch/tool-system",
    },
    {
      id: "confirmation",
      title: "Risk labels, confirmation and rejection",
      hook: "How does a risky action stop and wait for a human?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "LLM risk annotation", s: "With an analyzer set, tool schemas gain a `security_risk` field and the model labels each call LOW, MEDIUM or HIGH.", u: "The label stays on the `ActionEvent` for audit.", tag: "model" },
          { t: "SecurityAnalyzer", s: "`LLMSecurityAnalyzer.security_risk()` returns that label. It does not re-check the command itself.", u: "Risk is recorded whether or not the action ran.", tag: "guard" },
          { t: "ConfirmationPolicy", s: "`AlwaysConfirm`, `NeverConfirm` or `ConfirmRisky` (HIGH by default; UNKNOWN also confirms unless `confirm_unknown=False`).", u: "Approved actions run on the next `run()`.", tag: "guard" },
          { t: "WAITING_FOR_CONFIRMATION", s: "If confirmation is needed the step returns with actions pending, and `run()` hands control back to your code.", u: "`reject_pending_actions(reason)` appends a `UserRejectObservation` the model reads.", tag: "you" },
        ],
        core: { t: "Executor runs", s: "Only when you call `run()` again without rejecting do the pending actions execute.", tag: "tool" },
      },
      explain: [
        "Two pieces cooperate. A security analyzer assigns a `SecurityRisk` to each `ActionEvent`; a confirmation policy decides from that risk whether to pause. Both are set on the conversation with `set_security_analyzer()` and `set_confirmation_policy()`, and both can change mid-conversation.",
        "Pausing is just a status. `run()` returns with `execution_status == WAITING_FOR_CONFIRMATION`; `ConversationState.get_unmatched_actions(events)` lists actions that have no observation yet. Calling `run()` again executes them. `reject_pending_actions()` instead records a rejection observation, so the model sees why and can try another approach.",
      ],
      code: {
        lang: "python",
        caption: "The documented confirmation loop, applied to a containment request.",
        src: `from openhands.sdk.conversation.state import (ConversationExecutionStatus,
                                              ConversationState)
from openhands.sdk.security.confirmation_policy import ConfirmRisky
from openhands.sdk.security.llm_analyzer import LLMSecurityAnalyzer

conversation = Conversation(agent=agent, workspace="./case-4812")
conversation.set_security_analyzer(LLMSecurityAnalyzer())
conversation.set_confirmation_policy(ConfirmRisky())
conversation.send_message("Contain WS-114: block 203.0.113.7 on the host firewall")

Status = ConversationExecutionStatus
while conversation.state.execution_status != Status.FINISHED:
    if conversation.state.execution_status == Status.WAITING_FOR_CONFIRMATION:
        pending = ConversationState.get_unmatched_actions(conversation.state.events)
        if not analyst_approves(pending):
            conversation.reject_pending_actions("Analyst denied containment")
            continue
    conversation.run()`,
      },
      soc: "`LLMSecurityAnalyzer` trusts the model's own label, and injected alert text can talk it down. For containment, use `AlwaysConfirm` or a custom `SecurityAnalyzerBase` that rates by tool name and arguments.",
      url: B + "guides/security",
    },
    {
      id: "condenser",
      title: "Condensation: forgetting is an event too",
      hook: "How does a long investigation stay inside the context window?",
      diagram: {
        kind: "loop",
        center: "Event log",
        exit: "context overflow also emits a CondensationRequest",
        steps: [
          { t: "View.from_events()", s: "Each step builds a View: the log minus forgotten events, with the latest summary inserted.", tag: "state" },
          { t: "Over max_size?", s: "`LLMSummarizingCondenser` triggers when the view exceeds `max_size` events (120 by default).", tag: "guard" },
          { t: "Summarise the middle", s: "The first `keep_first` events and the recent tail are kept; a separate LLM summarises the middle.", tag: "model" },
          { t: "Append Condensation", s: "A `Condensation` event with `forgotten_event_ids` and the summary is appended, and the step returns early.", tag: "event" },
          { t: "Next step, smaller view", s: "The following step sees the summary instead of the forgotten events. The originals remain in the log.", tag: "core" },
        ],
      },
      explain: [
        "Condensation does not delete history. The condenser decides what to forget and records that decision as a `Condensation` event. On the next step `View.from_events()` filters out the forgotten IDs and inserts a `CondensationSummaryEvent`, which reaches the model as a `user` message. The full trail is still in the log.",
        "`max_size` counts events, not tokens. `keep_first` protects the system prompt and the original task. Give the condenser its own `LLM` (often a cheaper model) with a distinct `usage_id` so its cost shows up separately in metrics. `PipelineCondenser` can chain several condensers.",
      ],
      code: {
        lang: "python",
        caption: "A summarising condenser on its own LLM, and a check of how much was forgotten.",
        src: `from openhands.sdk import Agent, Conversation
from openhands.sdk.context.condenser import LLMSummarizingCondenser
from openhands.sdk.event import Condensation

condenser = LLMSummarizingCondenser(
    llm=llm.model_copy(update={"usage_id": "condenser"}),
    max_size=80,    # condense once the view passes 80 events
    keep_first=4,   # system prompt and the original alert stay verbatim
)
agent = Agent(llm=llm, tools=tools, condenser=condenser)

conversation = Conversation(agent=agent, workspace="./case-4812")
conversation.send_message("Walk the full process tree for alert 4812")
conversation.run()

for event in conversation.state.events:
    if isinstance(event, Condensation):
        print("forgot", len(event.forgotten_event_ids), "events")`,
      },
      soc: "Summaries are lossy, so keep the original alert in `keep_first` and write findings to the case through a tool rather than trusting the model to remember them. The raw events stay in the log for audit either way.",
      url: B + "guides/context-condenser",
    },
    {
      id: "workspaces",
      title: "Workspaces decide where actions run",
      hook: "Does the agent run in your process or somewhere isolated?",
      diagram: {
        kind: "tree",
        root: { t: "Conversation(workspace=...)", s: "The factory inspects the workspace type and returns a local or remote conversation with the same API.", tag: "core" },
        children: [
          {
            t: "Path or LocalWorkspace",
            s: "Returns `LocalConversation`: the agent loop and its tools run inside your process.",
            tag: "you",
            children: [
              { t: "Host subprocess", s: "Commands run with your user's permissions on the host. Fast, but no isolation.", tag: "tool" },
            ],
          },
          {
            t: "DockerWorkspace",
            s: "Pulls the agent-server image, starts a container, waits for it to be ready and cleans it up on exit.",
            tag: "guard",
            children: [
              { t: "RemoteConversation", s: "The loop and tools run in the container. Commands go over HTTP; events stream back over WebSocket.", tag: "event" },
            ],
          },
          {
            t: "Workspace(host=...)",
            s: "Connects to an agent server you already run, authenticated with a session API key.",
            tag: "state",
            children: [
              { t: "Same API, remote state", s: "`send_message()`, `run()` and callbacks work unchanged; state lives on the server.", tag: "core" },
            ],
          },
          { t: "Hosted sandboxes", s: "Other `RemoteWorkspace` subclasses, such as `APIRemoteWorkspace`, target hosted sandboxes. See the agent-server guides.", tag: "tool" },
        ],
      },
      explain: [
        "Tools run in the same environment as the workspace. `BaseWorkspace` defines `execute_command()`, `file_upload()` and `file_download()`; `LocalWorkspace` maps them to subprocess and file copies, while `RemoteWorkspace` maps them to agent-server HTTP endpoints. Code using the conversation does not change between the two.",
        "`DockerWorkspace` is a context manager: entering it starts a container running the agent server, exiting stops it. You can also call `execute_command()` directly, which returns a `CommandResult` with `stdout`, `stderr` and `exit_code`.",
      ],
      code: {
        lang: "python",
        caption: "Run the agent inside a disposable container, following the Docker sandbox guide.",
        src: `from openhands.sdk import Conversation, RemoteConversation
from openhands.tools.preset.default import get_default_agent
from openhands.workspace import DockerWorkspace

with DockerWorkspace(
    server_image="ghcr.io/openhands/agent-server:latest-python",
    host_port=8010,
) as workspace:
    result = workspace.execute_command("uname -a && id")
    print(result.exit_code, result.stdout)

    agent = get_default_agent(llm=llm, cli_mode=True)
    conversation = Conversation(agent=agent, workspace=workspace)
    assert isinstance(conversation, RemoteConversation)
    try:
        conversation.send_message("List strings in the uploaded sample and flag URLs")
        conversation.run()
    finally:
        conversation.close()`,
      },
      soc: "Anything that touches untrusted artefacts (samples, phishing attachments, attacker URLs) belongs in a container workspace, never a `LocalWorkspace` on the platform host. Relay runs OpenHands locally in an isolated Python worker today; remote sandboxes are a listed gap.",
      url: B + "arch/workspace",
    },
    {
      id: "persistence",
      title: "Persistence, resume and stuck detection",
      hook: "How does a conversation survive a restart, and notice when it is going in circles?",
      diagram: {
        kind: "timeline",
        legend: { state: "on disk", you: "your code", core: "agent", guard: "safety check", stop: "failure" },
        events: [
          { t: "Conversation(id, dir)", s: "With `persistence_dir` and `conversation_id`, state lives in `<dir>/<conversation-id>/`.", tag: "you" },
          { t: "base_state.json", s: "Agent configuration, execution status, statistics and metadata are saved here.", tag: "state" },
          { t: "events/event-NNNNN-<id>.json", s: "Each event is its own file, numbered in order and written incrementally.", tag: "state" },
          { t: "Process stops", s: "Nothing in memory matters any more: the files on disk are the conversation.", tag: "stop" },
          { t: "Same id + dir again", s: "Constructing a `Conversation` with the same ID and directory restores state and events.", tag: "you" },
          { t: "send_message + run()", s: "The stateless agent steps over the restored log as if it had never stopped.", tag: "core" },
          { t: "Stuck detector", s: "Repeated action/observation pairs, repeated errors or monologues set status STUCK and stop the run.", tag: "guard" },
        ],
      },
      explain: [
        "Persistence falls out of event sourcing. `base_state.json` holds the small mutable part (status, stats, agent config, activated skills, secrets); `events/` holds one JSON file per event. Restoring is just reloading those files, because the agent never held state of its own.",
        "The stuck detector is on by default (`stuck_detection=True`). It looks at history since the last user message and compares events by content, not ID: the same action and observation four times, the same action-error three times, three agent messages without user input, or a six-cycle ping-pong. You can query it with `conversation.stuck_detector.is_stuck()`.",
      ],
      code: {
        lang: "python",
        caption: "Persist a case conversation, stream events to an audit store, and resume it later.",
        src: `import uuid
from openhands.sdk import Conversation, Event

conversation_id = uuid.uuid4()  # store with the SOC case record

def on_event(event: Event) -> None:
    audit_log.write(event.model_dump_json())  # your append-only audit sink

conversation = Conversation(agent=agent, workspace="./case-4812",
                            persistence_dir="./.conversations",
                            conversation_id=conversation_id, callbacks=[on_event])
conversation.send_message("Start triage of alert 4812")
conversation.run()

del conversation  # later, possibly in another process:
conversation = Conversation(agent=agent, workspace="./case-4812",
                            persistence_dir="./.conversations",
                            conversation_id=conversation_id, callbacks=[on_event])
conversation.send_message("Continue: check lateral movement from WS-114")
conversation.run()`,
      },
      soc: "Key conversation IDs to case IDs so an investigation can pause overnight and resume on another worker. Relay stores the serialised events in `relay_native_state`. Persisted state includes secrets, so encrypt that store and scope it per tenant.",
      url: B + "guides/convo-persistence",
    },
  ],
};
