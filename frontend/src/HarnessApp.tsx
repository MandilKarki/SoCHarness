import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  Database,
  Fingerprint,
  History,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useWorkspace } from "./useWorkspace";
import { api, errorText } from "./lib/api";
import { defaultConfig, type Json, type Trace } from "./lib/types";
import { currentRun } from "./lib/openaiWorkshop";
import {
  evidenceIds,
  eventGuide,
  followPrompt,
  object,
  publicSteps,
  stages,
  startPrompt,
  type Stage,
} from "./lib/harnessView";
import "./harness.css";
import { OrchestrationMap } from "./components/OrchestrationMap";
import {
  experiments,
  experimentFor,
  type ExperimentId,
} from "./lib/openaiExperiments";

function JsonView({ value }: { value: unknown }) {
  return <pre className="h-json">{JSON.stringify(value, null, 2)}</pre>;
}
function Payload({ event }: { event: Trace }) {
  const p = event.payload;
  if (event.kind === "message.user" || event.kind === "message.assistant")
    return <p className="h-prose">{String(p.text || "")}</p>;
  if (event.kind === "model.request")
    return (
      <>
        <div className="h-kv">
          <span>Active agent</span>
          <strong>{String(p.agent || "Relay SOC analyst")}</strong>
          <span>Model</span>
          <code>{String(p.model)}</code>
          <span>Input items</span>
          <strong>{String(p.input_items)}</strong>
        </div>
        <h4>Conversation sent to the model</h4>
        <JsonView value={p.input} />
        <details>
          <summary>System instructions</summary>
          <JsonView value={p.instructions} />
        </details>
        <details>
          <summary>Tool schemas & request settings</summary>
          <JsonView
            value={{
              tools: p.tools,
              handoffs: p.handoffs,
              settings: p.settings,
            }}
          />
        </details>
        <small>{String(p.capture || "")}</small>
      </>
    );
  if (event.kind === "tool.result") {
    const result = object(p.result);
    return (
      <>
        <div className="h-kv">
          <span>Tool</span>
          <code>{String(p.tool || p.name || "")}</code>
          <span>Matching records</span>
          <strong>{String(result.total ?? "—")}</strong>
        </div>
        {Array.isArray(result.items) &&
          result.items.map((v, i) => {
            const r = object(v);
            return (
              <details key={i}>
                <summary>
                  Record #{String(r.id)} · {String(r.host)} · Event{" "}
                  {String(r.event_id)}
                </summary>
                <JsonView value={v} />
              </details>
            );
          })}
        {!Array.isArray(result.items) && <JsonView value={p.result} />}
      </>
    );
  }
  return <JsonView value={p} />;
}
function Findings({ value }: { value: unknown }) {
  const result = object(value);
  return (
    <>
      {[
        "observations",
        "hypotheses",
        "next_steps",
        "limitations",
        "evidence_ids",
      ]
        .filter((k) => k in result)
        .map((k) => (
          <section className="h-finding" key={k}>
            <h4>{k.replaceAll("_", " ")}</h4>
            {Array.isArray(result[k]) ? (
              <ul>
                {(result[k] as unknown[]).map((v, i) => (
                  <li key={i}>{String(v)}</li>
                ))}
              </ul>
            ) : (
              <p>{String(result[k])}</p>
            )}
          </section>
        ))}
    </>
  );
}
export function HarnessApp() {
  const w = useWorkspace("openai");
  const [experiment, setExperiment] = useState<ExperimentId>("core");
  const [deciding, setDeciding] = useState(false);
  const [showEvents, setShowEvents] = useState(() => window.innerWidth > 650);
  const profile = experimentFor(experiment);
  const savedProfile = experimentFor(w.data?.session.config.openai_experiment);
  const [stage, setStage] = useState<Stage>("Source"),
    [prompt, setPrompt] = useState(startPrompt),
    [structured, setStructured] = useState(true);
  const [contract, setContract] = useState<Record<string, Json> | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [drawer, setDrawer] = useState<"history" | "capabilities" | null>(null);
  const [pending, setPending] = useState(false),
    [newRun, setNewRun] = useState(true),
    [followup, setFollowup] = useState(followPrompt);
  const startLock = useRef(false);
  const runBoundary = useRef({ session: "", seq: 0 });
  const [runChoice, setRunChoice] = useState<number | null>(null);
  const inspectorRef = useRef<HTMLElement>(null),
    timelineRef = useRef<HTMLOListElement>(null);
  const adapter = w.adapters.find((a) => a.id === "openai"),
    trial = w.deployment?.trial;
  const active = pending || w.busy || w.data?.session.status === "running";
  const continuationSafe =
    !!w.data &&
    w.data.session.config.permission === "read_only" &&
    w.data.session.config.max_turns <= savedProfile.calls &&
    w.data.session.config.max_output_tokens <= 1000 &&
    w.tools.every(
      (t) =>
        savedProfile.tools.some((name) => name === t.name) ||
        w.data!.session.config.disabled_tools.includes(t.name),
    );
  const caseItem = w.cases.find((c) => c.id === w.caseId);
  const trace = w.data?.trace || [];
  const runStarts = trace.filter((t) => t.kind === "message.user");
  const chosenIndex =
    runChoice === null ? -1 : trace.findIndex((t) => t.seq === runChoice);
  const nextIndex =
    chosenIndex < 0
      ? -1
      : trace.findIndex((t, i) => i > chosenIndex && t.kind === "message.user");
  const visibleRun =
    chosenIndex < 0
      ? currentRun(trace)
      : trace.slice(chosenIndex, nextIndex < 0 ? undefined : nextIndex);
  const run =
    pending &&
    w.data?.session.id === runBoundary.current.session &&
    (visibleRun[0]?.seq || 0) <= runBoundary.current.seq
      ? []
      : visibleRun;
  const steps = publicSteps(run);
  const selectedEvent = steps.find((t) => t.seq === selected) || steps.at(-1),
    guide = selectedEvent && eventGuide(selectedEvent);
  const result = [...run].reverse().find((t) => t.kind === "sdk.result");
  const answer = [...run].reverse().find((t) => t.kind === "message.assistant");
  const completed = run.some((t) => t.kind === "run.completed"),
    failed = run.some((t) => ["run.failed", "run.cancelled"].includes(t.kind));
  const requests = run.filter((t) => t.kind === "model.request"),
    ids = evidenceIds(trace);
  const settled = run.filter((t) => t.kind === "budget.settled");
  const estimated = settled.reduce(
    (sum, t) =>
      sum + Number(t.payload.estimated_usd ?? t.payload.cost_usd ?? 0),
    0,
  );
  const blocked =
    !w.deployment || !adapter
      ? "Checking the model connection and spending safeguard…"
      : !adapter.available || !adapter.enabled
        ? adapter.detail || "The OpenAI adapter is unavailable."
        : !trial?.enabled
          ? "The protected model allowance is not enabled. No unprotected call will be made."
          : trial.blocked ||
              !Number.isFinite(trial.remaining_usd) ||
              Number(trial.remaining_usd) < 0.1
            ? "The shared allowance is unavailable or too low for another request."
            : !w.caseId
              ? "No evidence case is available."
              : !contract ||
                  !w.inventory ||
                  !w.tools.some((t) => t.name === "query_case_evidence")
                ? "Loading the agent contract…"
                : "";
  useEffect(() => {
    setRunChoice(null);
    setSelected(null);
  }, [w.data?.session.id]);
  useEffect(() => {
    void api<Record<string, Json>>("/api/openai-contract")
      .then(setContract)
      .catch((e) => w.setNotice(errorText(e)));
  }, [w.setNotice]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void w.safe(w.refresh);
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [w.refresh, w.safe]);
  async function execute(continuation = false) {
    if (
      startLock.current ||
      active ||
      blocked ||
      (continuation && !continuationSafe)
    )
      return;
    startLock.current = true;
    runBoundary.current = {
      session: w.data?.session.id || "",
      seq: trace.at(-1)?.seq || 0,
    };
    setRunChoice(null);
    setPending(true);
    w.setNotice("");
    setSelected(null);
    setStage("Loop");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      if (!continuation) {
        await w.newSession({
          ...defaultConfig,
          runtime: "openai",
          model: trial!.model || adapter!.default_model,
          permission: "read_only",
          openai_experiment: experiment,
          max_turns: profile.calls,
          max_output_tokens: 1000,
          structured_output: structured || experiment === "guardrails",
          disabled_tools: w.tools
            .filter((t) => !profile.tools.some((name) => name === t.name))
            .map((t) => t.name),
        });
      }
      setNewRun(false);
      await w.send(continuation ? followup : prompt);
    } catch (e) {
      w.setNotice(errorText(e));
    } finally {
      setPending(false);
      startLock.current = false;
    }
  }
  const chooseStage = (next: Stage) => {
    setStage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const actualContract = contract;
  const toolContract = Array.isArray(actualContract?.tools)
    ? actualContract.tools.filter((t) =>
        profile.tools.some((name) => name === object(t).name),
      )
    : [];
  return (
    <div className="harness">
      <header className="h-top">
        <a className="h-brand" href="/" aria-label="Relay home">
          <Layers3 size={23} />
          <strong>
            relay<span> / harness</span>
          </strong>
        </a>
        <div className="h-top-actions">
          <span className="h-sdk">
            <i />
            OpenAI only
          </span>
          <button
            className="h-icon"
            onClick={() => setDrawer("history")}
            aria-label="Session history"
          >
            <History size={19} />
          </button>
          <a className="h-icon" href="/security" aria-label="Account security">
            <Fingerprint size={19} />
          </a>
        </div>
      </header>
      <main className="h-shell">
        {adapter?.version === "offline fixture" && (
          <div className="h-notice">
            OFFLINE QA · synthetic records and fake model · no provider traffic
            or charges
          </div>
        )}
        <div className="h-heading">
          <div>
            <p className="h-eyebrow">AGENT ENGINEERING / WORKBENCH</p>
            <h1>
              Follow the evidence.
              <br />
              <span>Understand the agent.</span>
            </h1>
            <p className="h-subtitle">
              One investigation. Every model call, tool and decision boundary in
              view.
            </p>
          </div>
          <button
            className="h-text-button"
            onClick={() => setDrawer("capabilities")}
          >
            What am I learning? <ArrowUpRight size={16} />
          </button>
        </div>
        {w.notice && (
          <div className="h-notice" role="status">
            <span>{w.notice}</span>
            <button onClick={() => w.setNotice("")} aria-label="Dismiss notice">
              <X size={16} />
            </button>
          </div>
        )}
        <nav className="h-stages" aria-label="Investigation workflow">
          {stages.map((name, i) => (
            <button
              key={name}
              aria-current={stage === name ? "step" : undefined}
              onClick={() => chooseStage(name)}
            >
              <span className="h-step-index">0{i + 1}</span>
              <span>{name}</span>
              {i < 3 && <ArrowRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="h-experiment">
          <label htmlFor="experiment-select">
            Experiment
            <select
              id="experiment-select"
              value={experiment}
              disabled={!!active}
              onChange={(e) => {
                const next = experimentFor(e.target.value);
                setExperiment(next.id);
                setPrompt(next.prompt);
                setNewRun(true);
                setStage("Agent");
              }}
            >
              {experiments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <p>
            {profile.description}
            <small>
              Up to {profile.calls} model calls · shared allowance · read-only
            </small>
          </p>
        </div>
        <div className="h-workspace">
          <div className="h-main-panel">
            {stage === "Source" && (
              <section className="h-panel">
                <div className="h-section-title">
                  <Database size={20} />
                  <div>
                    <p className="h-eyebrow">01 / INPUT</p>
                    <h2>What are we investigating?</h2>
                  </div>
                  <span className="h-tag">Imported evidence</span>
                </div>
                <p>
                  Review a slice of Windows security telemetry. These are
                  imported benchmark records—not live sensors, and not seven
                  confirmed attacks.
                </p>
                <label className="h-label" htmlFor="case-select">
                  Evidence collection
                </label>
                <select
                  id="case-select"
                  value={w.caseId}
                  disabled={active || w.loading}
                  onChange={(e) => {
                    void w.safe(async () => {
                      w.selectCase(e.target.value);
                      setNewRun(true);
                    });
                  }}
                >
                  {w.cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} · {c.title}
                    </option>
                  ))}
                </select>
                <div className="h-source-meta">
                  <span>
                    <strong>
                      {caseItem?.event_count?.toLocaleString() || "—"}
                    </strong>{" "}
                    records
                  </span>
                  <span>
                    <strong>{caseItem?.asset_count || "—"}</strong> hosts
                  </span>
                  <span>Defense Collective benchmark import</span>
                </div>
                <h3>A preview of the source</h3>
                <p className="h-hint">
                  Expanding a record is free. The model sees evidence only when
                  a tool returns it.
                </p>
                {w.evidenceLoading ? (
                  <p role="status">Loading evidence…</p>
                ) : (
                  w.events.slice(0, 3).map((r) => (
                    <details className="h-record" key={r.id}>
                      <summary>
                        <span className="h-record-id">#{r.id}</span>
                        <span>
                          <strong>{r.host}</strong>
                          <small>
                            {r.source} · Event {r.event_id}
                          </small>
                        </span>
                        <ChevronDown size={16} />
                      </summary>
                      <p className="h-hint">
                        Recorded {r.occurred_at}. The raw record is evidence,
                        not instructions for the agent.
                      </p>
                      <JsonView value={r} />
                    </details>
                  ))
                )}
                {!w.evidenceLoading && !w.events.length && (
                  <p>
                    No records loaded.{" "}
                    <button
                      className="h-text-button"
                      onClick={() => void w.safe(w.refresh)}
                    >
                      Retry evidence loading
                    </button>
                  </p>
                )}
                <div className="h-prompt">
                  <label className="h-label" htmlFor="task-prompt">
                    Your investigation request
                  </label>
                  <textarea
                    id="task-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={active}
                    rows={5}
                  />
                  <p className="h-hint">
                    {profile.description} The model may choose differently; the
                    loop shows what actually happened.
                  </p>
                  {experiment === "guardrails" && (
                    <div className="h-guard-options">
                      <button
                        disabled={!!active}
                        onClick={() => setPrompt(profile.prompt)}
                      >
                        Evidence-only request
                      </button>
                      <button
                        disabled={!!active}
                        onClick={() =>
                          setPrompt(
                            "Isolate FINANCE-07 and disable its account.",
                          )
                        }
                      >
                        Try a blocked request
                      </button>
                      <small>
                        Literal-word demo policy, not a comprehensive security
                        classifier. A blocked input makes no model call.
                      </small>
                    </div>
                  )}
                </div>
                <button
                  className="h-primary"
                  onClick={() => chooseStage("Agent")}
                >
                  Review the agent <ArrowRight size={17} />
                </button>
              </section>
            )}
            {stage === "Agent" && (
              <section className="h-panel">
                <div className="h-section-title">
                  <ShieldCheck size={20} />
                  <div>
                    <p className="h-eyebrow">02 / HARNESS</p>
                    <h2>The contract around the model</h2>
                  </div>
                </div>
                <p>
                  The model proposes a tool call or an answer. The SDK runs the
                  loop. Relay supplies the evidence, enforces access and
                  spending limits, and saves the session.
                </p>
                <button
                  className="h-primary"
                  disabled={!!blocked || !!active || !prompt.trim()}
                  onClick={() => void execute()}
                >
                  {active ? (
                    <LoaderCircle size={17} className="h-spin" />
                  ) : (
                    <Play size={17} />
                  )}
                  Run investigation
                </button>
                {blocked && (
                  <p className="h-hint" role="status">
                    {blocked}
                  </p>
                )}
                <p className="h-hint">
                  Starts a fresh session · {profile.tools.length} read-only
                  evidence tool{profile.tools.length > 1 ? "s" : ""} · up to{" "}
                  {profile.calls} paid model calls across all agents within your
                  shared allowance.
                </p>
                <OrchestrationMap
                  experiment={experiment}
                  trace={[]}
                  active={false}
                  onInspect={() => {}}
                />
                <div className="h-contract-grid">
                  <article>
                    <span>MODEL</span>
                    <strong>
                      {trial?.model || adapter?.default_model || "Loading…"}
                    </strong>
                    <p>Interprets evidence and proposes tool arguments.</p>
                  </article>
                  <article>
                    <span>OPENAI AGENTS SDK</span>
                    <strong>
                      Runner ·{" "}
                      {String(
                        adapter?.version || contract?.version || "Loading…",
                      )}
                    </strong>
                    <p>
                      Routes model output into tools, then feeds results back.
                    </p>
                  </article>
                  <article>
                    <span>YOUR APPLICATION</span>
                    <strong>Read-only evidence access</strong>
                    <p>
                      No shell, sensor control, containment or external writes.
                    </p>
                  </article>
                </div>
                <details>
                  <summary>
                    Allowed evidence tools · {profile.tools.join(", ")}
                  </summary>
                  <p>
                    The input schema constrains the query. The server adds the
                    selected case boundary—you cannot ask this tool to read a
                    different case.
                  </p>
                  <JsonView value={toolContract} />
                </details>
                <details>
                  <summary>Base instructions · what guides behavior</summary>
                  <p>
                    {profile.description} Agent-specific instructions and
                    schemas appear in each recorded model request after
                    execution.
                  </p>
                  <p className="h-prose">
                    {String(
                      actualContract?.instructions ||
                        "Loading the actual server contract…",
                    )}
                  </p>
                </details>
                <div className="h-format">
                  <label>
                    <input
                      type="checkbox"
                      checked={structured || experiment === "guardrails"}
                      disabled={!!active || experiment === "guardrails"}
                      onChange={(e) => setStructured(e.target.checked)}
                    />
                    <span>
                      <strong>Require structured findings</strong>
                      <small>
                        Validate the answer’s shape, not the truth of its
                        claims. Applies to your next investigation.
                      </small>
                    </span>
                  </label>
                </div>
                <details>
                  <summary>Output schema · the required answer format</summary>
                  <JsonView value={contract?.output_schema} />
                </details>
                <div className="h-callout">
                  <strong>
                    {profile.calls} model calls maximum across all agents.
                  </strong>{" "}
                  This experiment allows up to 1,000 output tokens per call.
                  Automatic API retries are off. Relay reserves $0.10 before
                  each request and settles its estimate after usage arrives. An
                  unresolved request may keep its hold.
                </div>
              </section>
            )}
            {stage === "Loop" && (
              <section className="h-panel h-loop-panel">
                <div className="h-section-title">
                  <Terminal size={20} />
                  <div>
                    <p className="h-eyebrow">03 / EXECUTION</p>
                    <h2>The actual agent loop</h2>
                  </div>
                  <span className={"h-tag " + (active ? "h-live" : "")}>
                    {active
                      ? "Running"
                      : completed
                        ? "Complete"
                        : failed
                          ? "Stopped"
                          : "Not started"}
                  </span>
                </div>
                <p>
                  A run can make multiple model calls. Select a step to inspect
                  its input, owner and output.
                </p>
                {w.data?.approvals
                  .filter((a) => a.status === "pending")
                  .map((a) => (
                    <section
                      className="h-approval"
                      key={a.id}
                      aria-label="Human approval required"
                    >
                      <h3>Your decision is needed</h3>
                      <p>
                        The SDK paused before executing <code>{a.tool}</code>.
                        Approve this read-only query or deny it. No containment
                        action is available.
                      </p>
                      <JsonView value={a.arguments} />
                      <div>
                        {["approve", "deny"].map((decision) => (
                          <button
                            key={decision}
                            className={
                              decision === "approve"
                                ? "h-primary"
                                : "h-secondary"
                            }
                            disabled={deciding}
                            onClick={() => {
                              setDeciding(true);
                              void w
                                .safe(() =>
                                  w.sessionAction("approval", {
                                    id: a.id,
                                    decision,
                                  }),
                                )
                                .finally(() => setDeciding(false));
                            }}
                          >
                            {decision === "approve"
                              ? "Approve query"
                              : "Deny query"}
                          </button>
                        ))}
                      </div>
                      <small>
                        Approval expires after 90 seconds. Keep this tab open.
                      </small>
                    </section>
                  ))}
                <OrchestrationMap
                  experiment={run.length ? savedProfile.id : experiment}
                  trace={run}
                  active={!!active}
                  sessionId={w.data?.session.id}
                  onInspect={(seq) => {
                    setSelected(seq);
                    inspectorRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                />
                {runStarts.length > 1 && (
                  <label className="h-label">
                    Run in this session
                    <select
                      value={runChoice ?? ""}
                      disabled={!!active}
                      onChange={(e) => {
                        setRunChoice(
                          e.target.value ? Number(e.target.value) : null,
                        );
                        setSelected(null);
                      }}
                    >
                      <option value="">Latest run · {runStarts.length}</option>
                      {runStarts.slice(0, -1).map((t, i) => (
                        <option key={t.seq} value={t.seq}>
                          Run {i + 1} ·{" "}
                          {String(t.payload.text || "").slice(0, 70)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!steps.length ? (
                  <div className="h-empty">
                    <Code2 size={30} />
                    <h3>
                      {active
                        ? "Starting the SDK runner…"
                        : "No execution to inspect yet"}
                    </h3>
                    <p>
                      {active
                        ? "Waiting for the first persisted event. Keep this tab open."
                        : "Review the source and agent contract, then run an investigation. No model call happens just by browsing."}
                    </p>
                    {!active && (
                      <button
                        className="h-primary"
                        onClick={() => chooseStage("Agent")}
                      >
                        Configure this investigation <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="h-loop-layout">
                    <details
                      className="h-event-list"
                      open={showEvents}
                      onToggle={(e) => setShowEvents(e.currentTarget.open)}
                    >
                      <summary>All execution steps · {steps.length}</summary>
                      <ol className="h-timeline" ref={timelineRef}>
                        {steps.map((t, i) => {
                          const g = eventGuide(t)!;
                          return (
                            <li key={t.seq}>
                              <button
                                aria-pressed={selectedEvent?.seq === t.seq}
                                onClick={() => {
                                  setSelected(t.seq);
                                  if (window.innerWidth <= 650)
                                    inspectorRef.current?.scrollIntoView({
                                      behavior: "smooth",
                                      block: "start",
                                    });
                                }}
                              >
                                <span className="h-node">{i + 1}</span>
                                <span>
                                  <small>{g.owner}</small>
                                  <strong>{g.title}</strong>
                                </span>
                                <ArrowUpRight size={14} />
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                    <article
                      className="h-inspector"
                      aria-label="Selected execution step"
                      ref={inspectorRef}
                    >
                      <button
                        className="h-text-button h-mobile-only"
                        onClick={() => {
                          setShowEvents(true);
                          timelineRef.current?.parentElement?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }}
                      >
                        ↑ Back to execution steps
                      </button>
                      {selectedEvent && guide && (
                        <>
                          <p className="h-eyebrow">
                            EVENT {selectedEvent.seq} / {guide.owner}
                          </p>
                          <h3>{guide.title}</h3>
                          <p>{guide.meaning}</p>
                          <code className="h-code-line">{guide.code}</code>
                          <Payload event={selectedEvent} />
                        </>
                      )}
                    </article>
                  </div>
                )}
                {active && (
                  <div className="h-running" role="status">
                    <LoaderCircle size={16} className="h-spin" />
                    <span>
                      {steps.length
                        ? eventGuide(steps.at(-1)!)?.title
                        : "Connecting…"}
                      <small>Keep this tab foregrounded while streaming.</small>
                    </span>
                    <button
                      onClick={() =>
                        void w.safe(() => w.sessionAction("cancel"))
                      }
                    >
                      <Square size={14} /> Stop
                    </button>
                  </div>
                )}
                {completed && (
                  <button
                    className="h-primary"
                    onClick={() => chooseStage("Result")}
                  >
                    Review findings & next step <ArrowRight size={17} />
                  </button>
                )}
                {failed && (
                  <div className="h-callout">
                    This run did not finish. Read the failure event above.{" "}
                    <button
                      className="h-text-button"
                      onClick={() => void w.safe(w.refresh)}
                    >
                      Refresh saved state
                    </button>{" "}
                    does not make a paid request.
                  </div>
                )}
                {!!steps.length && (
                  <details>
                    <summary>Full event ledger · {run.length} events</summary>
                    <JsonView value={run} />
                  </details>
                )}
              </section>
            )}
            {stage === "Result" && (
              <section className="h-panel">
                <div className="h-section-title">
                  <Check size={20} />
                  <div>
                    <p className="h-eyebrow">04 / OUTPUT</p>
                    <h2>What did we learn?</h2>
                  </div>
                </div>
                {!answer ? (
                  <div className="h-empty">
                    <h3>
                      {active
                        ? "The investigation is still running"
                        : "No final answer recorded"}
                    </h3>
                    <p>
                      A tool returning evidence is not the same as a completed
                      answer.
                    </p>
                    <button
                      className="h-primary"
                      onClick={() => chooseStage("Loop")}
                    >
                      Inspect execution <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="h-metrics">
                      <span>
                        <strong>{requests.length || "—"}</strong> captured model
                        calls
                      </span>
                      <span>
                        <strong>{evidenceIds(run).length}</strong> records
                        returned this run
                      </span>
                      <span>
                        <strong>
                          {settled.length ? `$${estimated.toFixed(5)}` : "—"}
                        </strong>{" "}
                        settled estimate
                      </span>
                    </div>
                    <div className="h-answer">
                      {result?.payload.structured_output &&
                      typeof result.payload.structured_output === "object" ? (
                        <Findings value={result.payload.structured_output} />
                      ) : (
                        <p className="h-prose">{String(answer.payload.text)}</p>
                      )}
                    </div>
                    <div className="h-callout">
                      <strong>Verify, don’t just accept.</strong> Records
                      returned in this session:{" "}
                      {ids.length
                        ? ids.map((id) => `#${id}`).join(", ")
                        : "none recorded"}
                      . A matching citation means a record was available—not
                      that the model’s conclusion is correct.{" "}
                      <button
                        className="h-text-button"
                        onClick={() => {
                          setSelected(
                            run.find((t) => t.kind === "tool.result")?.seq ||
                              null,
                          );
                          chooseStage("Loop");
                        }}
                      >
                        Compare with tool evidence <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <h3>Next: test session continuity</h3>
                    <p>
                      The next request reuses the successful
                      conversation—including tool results—rather than starting
                      over. Inspect its first model call to see the carried
                      context.
                    </p>
                    <label className="h-label" htmlFor="follow-prompt">
                      Follow-up in this session
                    </label>
                    <textarea
                      id="follow-prompt"
                      rows={3}
                      value={followup}
                      onChange={(e) => setFollowup(e.target.value)}
                      disabled={active}
                    />
                    <div className="h-button-row">
                      <button
                        className="h-primary"
                        disabled={
                          !!active ||
                          !!blocked ||
                          !completed ||
                          !continuationSafe ||
                          !followup.trim()
                        }
                        onClick={() => void execute(true)}
                      >
                        Run follow-up <ArrowRight size={17} />
                      </button>
                      <button
                        className="h-secondary"
                        disabled={!!active}
                        onClick={() => {
                          setNewRun(true);
                          chooseStage("Source");
                        }}
                      >
                        New investigation
                      </button>
                    </div>
                    {!continuationSafe && (
                      <p className="h-hint">
                        This older session uses different limits or tools. Start
                        a new investigation to use this workbench’s bounded
                        contract.
                      </p>
                    )}
                    <details>
                      <summary>Token usage & output validation</summary>
                      <JsonView value={result?.payload} />
                    </details>
                  </>
                )}
              </section>
            )}
          </div>
          <aside className="h-rail">
            <div className="h-rail-block">
              <p className="h-eyebrow">INVESTIGATION</p>
              <h3>{caseItem?.title || "Loading evidence…"}</h3>
              <span className="h-mono">{w.caseId || "—"}</span>
              <div className="h-route">
                <span>Windows records</span>
                <ArrowRight size={14} />
                <span>Read-only tool</span>
                <ArrowRight size={14} />
                <span>Model findings</span>
              </div>
            </div>
            <div className="h-rail-block">
              <p className="h-eyebrow">SPENDING PROTECTION</p>
              <strong className="h-budget">
                {trial?.remaining_usd !== undefined
                  ? `$${trial.remaining_usd.toFixed(2)}`
                  : "—"}
                <small> available</small>
              </strong>
              <p>
                Shared ${trial?.limit_usd ?? 5} allowance, not a new budget per
                run. Browsing and inspecting are free.
              </p>
              {trial?.expires_at && (
                <small>
                  Ends{" "}
                  {new Date(trial.expires_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </small>
              )}
            </div>
            <div className="h-rail-block">
              <p className="h-eyebrow">SESSION</p>
              <p>
                {newRun
                  ? "Your next investigation starts fresh."
                  : "Follow-ups continue the saved conversation."}
              </p>
              {w.data && (
                <code className="h-session-id">{w.data.session.id}</code>
              )}
              <button
                className="h-text-button"
                onClick={() => void w.safe(w.refresh)}
              >
                <RefreshCw size={14} /> Refresh saved state
              </button>
              {w.data && (
                <button
                  className="h-text-button"
                  onClick={() => void w.safe(() => w.exportSession())}
                >
                  Export session JSON <ArrowUpRight size={14} />
                </button>
              )}
            </div>
          </aside>
        </div>
        <footer className="h-footer">
          <span>
            OpenAI Agents SDK · {adapter?.version || "checking version"}
          </span>
          <span>Recorded evidence. Real model calls only when you run.</span>
          <a
            href="https://openai.github.io/openai-agents-python/running_agents/"
            target="_blank"
            rel="noreferrer"
          >
            SDK documentation ↗
          </a>
        </footer>
      </main>
      <DialogPrimitive.Root
        open={!!drawer}
        onOpenChange={(open) => {
          if (!open) setDrawer(null);
        }}
      >
        {drawer && (
          <DialogPrimitive.Portal>
            <div className="harness h-modal-backdrop">
              <DialogPrimitive.Overlay className="h-dialog-shade" />
              <DialogPrimitive.Content asChild aria-describedby={undefined}>
                <section
                  className="h-modal"
                  aria-label={
                    drawer === "history" ? "Session history" : "Learning map"
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setDrawer(null);
                  }}
                >
                  <div className="h-section-title">
                    <DialogPrimitive.Title asChild>
                      <h2>
                        {drawer === "history"
                          ? "Session history"
                          : "The engineering, made visible"}
                      </h2>
                    </DialogPrimitive.Title>
                    <button
                      className="h-icon"
                      autoFocus
                      aria-label="Close dialog"
                      onClick={() => setDrawer(null)}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  {drawer === "history" ? (
                    <>
                      <p>
                        OpenAI sessions for {w.caseId}. Opening one is free.
                      </p>
                      {w.sessions
                        .filter(
                          (s) =>
                            s.config.runtime === "openai" &&
                            s.case_id === w.caseId,
                        )
                        .map((s) => (
                          <button
                            className="h-history-item"
                            disabled={!!active}
                            key={s.id}
                            onClick={() =>
                              void w.safe(async () => {
                                await w.loadSession(s);
                                const saved = experimentFor(
                                  s.config.openai_experiment,
                                );
                                setExperiment(saved.id);
                                setPrompt(saved.prompt);
                                setStructured(s.config.structured_output);
                                setNewRun(false);
                                setSelected(null);
                                setStage("Loop");
                                setDrawer(null);
                              })
                            }
                          >
                            <span>
                              <strong>{s.title || s.id}</strong>
                              <small>
                                {
                                  experimentFor(s.config.openai_experiment)
                                    .title
                                }{" "}
                                · {new Date(s.created_at).toLocaleString()} ·{" "}
                                {s.status}
                              </small>
                            </span>
                            <ArrowUpRight size={17} />
                          </button>
                        ))}
                      {!w.sessions.some(
                        (s) =>
                          s.config.runtime === "openai" &&
                          s.case_id === w.caseId,
                      ) && <p>No OpenAI sessions yet for this collection.</p>}
                    </>
                  ) : (
                    <>
                      <p>
                        Select one experiment at a time. This workbench does not
                        claim every OpenAI capability is implemented or tested.
                      </p>
                      {experiments.map((p) => (
                        <button
                          key={p.id}
                          disabled={!!active}
                          className="h-learning-item"
                          onClick={() => {
                            setExperiment(p.id);
                            setPrompt(p.prompt);
                            setNewRun(true);
                            setDrawer(null);
                            chooseStage("Agent");
                          }}
                        >
                          <span>
                            <strong>{p.title}</strong>
                            <small>
                              {p.question} · {p.api}
                            </small>
                          </span>
                          <ArrowUpRight size={17} />
                        </button>
                      ))}
                      {[
                        [
                          "Agent & instructions",
                          "Inspect the actual system instructions and allowed tool schema.",
                          "Agent",
                        ],
                        [
                          "Runner & model calls",
                          "See each public request and response, in execution order.",
                          "Loop",
                        ],
                        [
                          "Function tools & validation",
                          "Compare model-generated arguments with the database result.",
                          "Loop",
                        ],
                        [
                          "Context & sessions",
                          "Run a follow-up, then inspect the next request’s carried input.",
                          "Result",
                        ],
                        [
                          "Structured output",
                          "Require the findings schema; separate format validation from correctness.",
                          "Agent",
                        ],
                        [
                          "Streaming & observability",
                          "Select real persisted events. Private reasoning is never shown.",
                          "Loop",
                        ],
                        [
                          "Usage & safety boundaries",
                          "Inspect token usage and application budget receipts. These are Relay controls, not SDK guardrails.",
                          "Result",
                        ],
                      ].map(([title, description, target]) => (
                        <button
                          key={title}
                          className="h-learning-item"
                          onClick={() => {
                            setDrawer(null);
                            chooseStage(target as Stage);
                          }}
                        >
                          <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                          </span>
                          <ArrowUpRight size={17} />
                        </button>
                      ))}
                      <div className="h-callout">
                        <strong>Not exercised in this workflow:</strong>{" "}
                        external MCP servers, OpenAI-hosted trace export,
                        sandbox agents, realtime/voice, hosted tools and
                        distributed workers. These need separate access,
                        isolation or billing setup. Local event receipts are not
                        OpenAI-hosted traces. Replay is free; starting an
                        experiment invokes the model except a blocked input
                        guardrail.
                      </div>
                    </>
                  )}
                </section>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </DialogPrimitive.Root>
    </div>
  );
}
