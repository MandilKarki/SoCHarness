import { startPrompt } from "./harnessView";
import type { Trace } from "./types";
export const experiments = [
  {
    id: "core",
    title: "The core loop",
    question: "How does a model turn into an agent?",
    description: "One analyst, one evidence tool, one grounded answer.",
    calls: 3,
    tools: ["query_case_evidence"],
    prompt: startPrompt,
    api: "Agent · Runner.run_streamed · FunctionTool",
  },
  {
    id: "multi_tool",
    title: "Multiple tools",
    question: "How does the agent choose its next tool?",
    description: "Find three records, inspect one in detail, then report.",
    calls: 3,
    tools: ["query_case_evidence", "get_event"],
    prompt:
      'Call query_case_evidence once with {"limit":3,"search":""}. Then call get_event once for the first returned record ID. Produce concise findings based only on these tool results, citing record IDs and stating limitations. No further tools or writes.',
    api: "FunctionTool[] · tool selection · tool-result context",
  },
  {
    id: "manager",
    title: "Manager + specialist",
    question: "What changes when an agent becomes a tool?",
    description:
      "The manager delegates evidence review, gets findings back, and owns the final answer.",
    calls: 4,
    tools: ["query_case_evidence"],
    prompt:
      "Delegate this investigation to the evidence specialist exactly once. Have it query three case records and return concise findings with IDs. Then synthesize the specialist’s returned findings into the required answer. Do not delegate again or perform writes.",
    api: "Agent.as_tool() · nested Runner · shared call budget",
  },
  {
    id: "handoff",
    title: "Transfer ownership",
    question: "How is a handoff different from delegation?",
    description:
      "Triage transfers control. The specialist queries evidence and answers you directly.",
    calls: 3,
    tools: ["query_case_evidence"],
    prompt:
      "Transfer this case to the evidence specialist. The specialist should query three records once and produce concise evidence-grounded findings with cited IDs and limitations.",
    api: "handoff() · RunHooks.on_handoff · result.last_agent",
  },
  {
    id: "guardrails",
    title: "Guardrails",
    question: "Where can an SDK tripwire stop the loop?",
    description:
      "A blocking input rule runs before the model; an output rule checks cited record IDs.",
    calls: 3,
    tools: ["query_case_evidence"],
    prompt: startPrompt,
    api: "InputGuardrail · OutputGuardrail · tripwire exceptions",
  },
  {
    id: "review",
    title: "Human approval",
    question: "What happens between a proposed tool and its execution?",
    description:
      "The SDK pauses before reading evidence. Approve or deny the exact arguments in the loop.",
    calls: 3,
    tools: ["query_case_evidence"],
    prompt: startPrompt,
    api: "needs_approval · result.interruptions · RunState.approve/reject",
  },
  {
    id: "sessions",
    title: "SDK session memory",
    question: "What survives between two runs?",
    description:
      "The SDK loads and appends history through a Session adapter. Relay commits it only after success.",
    calls: 3,
    tools: ["query_case_evidence"],
    prompt: startPrompt,
    api: "Session.get_items/add_items · Runner(session=...)",
  },
] as const;
export type ExperimentId = (typeof experiments)[number]["id"];
export const experimentFor = (id?: string) =>
  experiments.find((e) => e.id === id) || experiments[0];
export type GraphNode = {
  id: string;
  label: string;
  detail: string;
  matches: (t: Trace) => boolean;
};
const event =
  (...kinds: string[]) =>
  (t: Trace) =>
    kinds.includes(t.kind);
const actor = (name: string) => (t: Trace) =>
  [
    "model.request",
    "model.response",
    "agent.started",
    "agent.finished",
  ].includes(t.kind) && t.payload.agent === name;
const evidence: GraphNode = {
  id: "evidence",
  label: "Case evidence",
  detail: "Application tool → database",
  matches: event("tool.started", "tool.result"),
};
const answer: GraphNode = {
  id: "answer",
  label: "Final findings",
  detail: "Validated shape ≠ verified truth",
  matches: event("message.assistant"),
};
const analyst: GraphNode = {
  id: "analyst",
  label: "SOC analyst",
  detail: "Model chooses tools or answer",
  matches: actor("Relay SOC analyst"),
};
export function graphNodes(id: string): GraphNode[] {
  if (id === "manager")
    return [
      {
        id: "manager",
        label: "Investigation manager",
        detail: "Owns the final answer",
        matches: actor("Investigation manager"),
      },
      {
        id: "specialist",
        label: "Evidence specialist",
        detail: "Called through Agent.as_tool()",
        matches: actor("Evidence specialist"),
      },
      evidence,
      answer,
    ];
  if (id === "handoff")
    return [
      {
        id: "triage",
        label: "Triage agent",
        detail: "Routes, then yields ownership",
        matches: actor("Triage agent"),
      },
      {
        id: "transfer",
        label: "Handoff",
        detail: "Control transfers to specialist",
        matches: event("agent.handoff"),
      },
      {
        id: "specialist",
        label: "Evidence specialist",
        detail: "Now owns the conversation",
        matches: actor("Evidence specialist"),
      },
      evidence,
      answer,
    ];
  if (id === "guardrails")
    return [
      {
        id: "input",
        label: "Input guardrail",
        detail: "Blocking check · before model",
        matches: (t) =>
          t.kind === "guardrail.checked" && t.payload.phase === "input",
      },
      analyst,
      evidence,
      {
        id: "output",
        label: "Output guardrail",
        detail: "Citations must have been returned",
        matches: (t) =>
          t.kind === "guardrail.checked" && t.payload.phase === "output",
      },
      answer,
    ];
  if (id === "review")
    return [
      analyst,
      {
        id: "review",
        label: "Human decision",
        detail: "SDK pauses before execution",
        matches: event("approval.requested", "sdk.approval.resumed"),
      },
      evidence,
      answer,
    ];
  if (id === "sessions")
    return [
      {
        id: "history",
        label: "Retained history",
        detail: "Session.get_items()",
        matches: event("session.loaded"),
      },
      analyst,
      evidence,
      {
        id: "commit",
        label: "Continuation saved",
        detail: "SDK stages → Relay commits",
        matches: event("session.staged", "session.committed"),
      },
    ];
  return [
    {
      id: "input",
      label: "Analyst request",
      detail: "Your message + case boundary",
      matches: event("message.user"),
    },
    analyst,
    evidence,
    answer,
  ];
}
