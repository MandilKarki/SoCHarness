import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { chapterFor, chapterHash } from "../../lib/deep/live";
import { deepDives } from "../../lib/deep";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import type { Workspace } from "../../useWorkspace";
import { api, errorText } from "../../lib/api";
import { defaultConfig, type Grade, type Json, type Playbook, type Scenario, type TestGround, type Trace } from "../../lib/types";
import { GradeBadge, GradeDetail } from "./GroundsView";
import { PlaybookFlow, SessionClaimCheck } from "./KnowledgeViews";
import { currentRun } from "../../lib/openaiWorkshop";
import {
  carriesToolOutput,
  eventGuide,
  evidenceIds,
  expectedPath,
  followPrompt,
  laneLabel,
  laneOf,
  lanes,
  object,
  publicSteps,
  stepSummary,
  type Lane,
} from "../../lib/harnessView";
import { partForEvent, type PartId } from "../../lib/anatomy";
import { experiments, experimentFor, type ExperimentId } from "../../lib/openaiExperiments";
import { OrchestrationMap } from "../OrchestrationMap";
import { frameworkById } from "../../lib/frameworks";
import { JsonView, Section } from "./shared";

function useNarrow(query = "(max-width: 1279px)") {
  const get = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [query]);
  return narrow;
}

/** Splits text on #123 citations so each can be clicked. */
function Cited({ text, onCite }: { text: string; onCite: (id: number) => void }) {
  const parts = text.split(/(#\d+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^#\d+$/.test(p) ? (
          <button key={i} className="hl-cite" onClick={() => onCite(Number(p.slice(1)))}>
            {p}
          </button>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Payload({ event }: { event: Trace }) {
  const p = event.payload;
  if (event.kind === "message.user" || event.kind === "message.assistant")
    return <p className="hl-prose">{String(p.text || "")}</p>;
  if (event.kind === "model.request")
    return (
      <>
        <dl className="hl-kv">
          <dt>Model</dt>
          <dd><code>{String(p.model)}</code></dd>
          <dt>Active agent</dt>
          <dd>{String(p.agent || "Relay SOC analyst")}</dd>
          <dt>Input items</dt>
          <dd>{String(p.input_items)}</dd>
        </dl>
        {carriesToolOutput(event) && (
          <p className="hl-callout hl-callout-data">
            This request contains <code>function_call_output</code>: the tool's
            records are now part of the model's context. That is the loop closing.
          </p>
        )}
        <h5>Conversation sent to the model</h5>
        <JsonView value={p.input} />
        <details>
          <summary>System instructions</summary>
          <JsonView value={p.instructions} />
        </details>
        <details>
          <summary>Tool schemas and request settings</summary>
          <JsonView value={{ tools: p.tools, handoffs: p.handoffs, settings: p.settings }} />
        </details>
        {p.capture && <small className="hl-fine">{String(p.capture)}</small>}
      </>
    );
  if (event.kind === "tool.result") {
    const result = object(p.result);
    return (
      <>
        <dl className="hl-kv">
          <dt>Tool</dt>
          <dd><code>{String(p.tool || p.name || "")}</code></dd>
          <dt>Matching</dt>
          <dd>{String(result.total ?? "—")} records</dd>
        </dl>
        {Array.isArray(result.items) ? (
          result.items.map((v, i) => {
            const r = object(v);
            return (
              <details key={i}>
                <summary>
                  Record #{String(r.id)}, {String(r.host)}, event {String(r.event_id)}
                </summary>
                <JsonView value={v} />
              </details>
            );
          })
        ) : (
          <JsonView value={p.result} />
        )}
      </>
    );
  }
  return <JsonView value={p} />;
}

const laneIndex = (l: Lane) => lanes.indexOf(l);
const laneShort: Record<Lane, string> = { you: "You", app: "App", sdk: "SDK", model: "Model", data: "Data" };

function Gutter({ lane, prev, ghost, fresh }: { lane: Lane; prev?: Lane; ghost?: boolean; fresh?: boolean }) {
  const a = prev ? laneIndex(prev) : -1,
    b = laneIndex(lane);
  const lo = Math.min(a, b),
    span = Math.abs(a - b);
  return (
    <span className="hl-gutter" aria-hidden="true">
      {a >= 0 && span > 0 && (
        <span
          className={"hl-hop" + (b < a ? " hl-hop-back" : "") + (fresh ? " hl-hop-fresh" : "")}
          style={{ left: `calc(${lo} * var(--lane) + var(--lane) / 2)`, width: `calc(${span} * var(--lane))` }}
        />
      )}
      <span
        className={"hl-dot hl-l-" + lane + (ghost ? " hl-dot-ghost" : "")}
        style={{ left: `calc(${b} * var(--lane) + var(--lane) / 2)` }}
      />
    </span>
  );
}

export function RunView({
  w,
  hidden,
  onPart,
  focus,
  experiment,
  setExperiment,
  prompt,
  setPrompt,
  structured,
  setStructured,
  runtime = "openai",
  setRuntime,
  runnable = [],
}: {
  w: Workspace;
  hidden: boolean;
  onPart: (id: PartId) => void;
  focus: { kind: string; nonce: number } | null;
  experiment: ExperimentId;
  setExperiment: (id: ExperimentId) => void;
  prompt: string;
  setPrompt: (p: string) => void;
  structured: boolean;
  setStructured: (v: boolean) => void;
  runtime?: string;
  setRuntime?: (id: string) => void;
  runnable?: string[];
}) {
  const narrow = useNarrow();
  const [followup, setFollowup] = useState(followPrompt),
    [deciding, setDeciding] = useState(false);
  const profile = experimentFor(experiment),
    savedProfile = experimentFor(w.data?.session.config.openai_experiment);
  const [contract, setContract] = useState<Record<string, Json> | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [pending, setPending] = useState(false),
    [newRun, setNewRun] = useState(true),
    [runChoice, setRunChoice] = useState<number | null>(null),
    [citedId, setCitedId] = useState<number | null>(null);
  const startLock = useRef(false),
    runBoundary = useRef({ session: "", seq: 0 }),
    stepRefs = useRef(new Map<number, HTMLButtonElement>()),
    recordRefs = useRef(new Map<number, HTMLDetailsElement>()),
    loopRef = useRef<HTMLElement>(null);

  const isOpenAI = runtime === "openai";
  const adapter = w.adapters.find((a) => a.id === runtime),
    // Each provider has its own fail-closed ledger: OpenAI's trial, or the metered Anthropic allowance.
    trial = isOpenAI ? w.deployment?.trial : w.deployment?.anthropic_trial?.runtimes?.includes(runtime) ? w.deployment.anthropic_trial : undefined,
    ledgerName = isOpenAI ? "OpenAI allowance" : "Anthropic allowance";
  const fwProfile = frameworkById[runtime];
  const active = pending || w.busy || w.data?.session.status === "running";
  const continuationSafe =
    !!w.data &&
    w.data.session.config.runtime === runtime &&
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
  const chosenIndex = runChoice === null ? -1 : trace.findIndex((t) => t.seq === runChoice);
  const nextIndex =
    chosenIndex < 0 ? -1 : trace.findIndex((t, i) => i > chosenIndex && t.kind === "message.user");
  const visibleRun =
    chosenIndex < 0 ? currentRun(trace) : trace.slice(chosenIndex, nextIndex < 0 ? undefined : nextIndex);
  const run =
    pending &&
    w.data?.session.id === runBoundary.current.session &&
    (visibleRun[0]?.seq || 0) <= runBoundary.current.seq
      ? []
      : visibleRun;
  const steps = publicSteps(run);
  const selectedEvent = steps.find((t) => t.seq === selected) || steps.at(-1);
  const selIndex = selectedEvent ? steps.indexOf(selectedEvent) : -1;
  const result = [...run].reverse().find((t) => t.kind === "sdk.result");
  const answer = [...run].reverse().find((t) => t.kind === "message.assistant");
  const completed = run.some((t) => t.kind === "run.completed"),
    failed = run.some((t) => ["run.failed", "run.cancelled"].includes(t.kind));
  const requests = run.filter((t) => t.kind === "model.request");
  const returned = useMemo(() => evidenceIds(run), [run]);
  const sessionIds = evidenceIds(trace);
  const settled = run.filter((t) => t.kind === "budget.settled");
  // Labelled test-ground cases are graded against their answer key once a run finishes.
  const sessionId = w.data?.session.id,
    isScenario = !!w.data?.session.case_id?.startsWith("TG-"),
    lastSeq = trace.at(-1)?.seq || 0;
  const [grade, setGrade] = useState<Grade | null>(null),
    [scenarioInfo, setScenarioInfo] = useState<Scenario | undefined>(undefined),
    [playbookInfo, setPlaybookInfo] = useState<Playbook | undefined>(undefined);
  useEffect(() => {
    setGrade(null);
    if (!isScenario || !sessionId || !completed || active) return;
    let alive = true;
    void Promise.all([
      api<{ grade: Grade | null }>("/api/test-ground/grade?session=" + encodeURIComponent(sessionId)),
      api<TestGround>("/api/test-ground"),
    ])
      .then(([g, tg]) => {
        if (!alive) return;
        setGrade(g.grade);
        const sc = tg.scenarios.find((x) => x.id === g.grade?.case_id);
        setScenarioInfo(sc);
        setPlaybookInfo(sc ? tg.playbooks?.[sc.playbook] : undefined);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isScenario, sessionId, completed, active, lastSeq]);
  const estimated = settled.reduce(
    (sum, t) => sum + Number(t.payload.estimated_usd ?? t.payload.cost_usd ?? 0),
    0,
  );
  // Metered frameworks report one settled receipt per model request and usage on their final result.
  const meteredCalls = settled.filter((t) => t.payload.provider === "anthropic").length;
  const frameworkUsage = object([...run].reverse().find((t) => t.kind === "sdk.result")?.payload.usage);
  const tokens = run
    .filter((t) => t.kind === "model.response")
    .reduce(
      (s, t) => {
        const u = object(t.payload.usage);
        return [s[0] + Number(u.input_tokens || 0), s[1] + Number(u.output_tokens || 0)];
      },
      [0, 0],
    );
  const blocked =
    !w.deployment || !adapter
      ? "Checking the model connection and spending safeguard…"
      : !adapter.available || !adapter.enabled
        ? adapter.detail || `The ${adapter.name || runtime} adapter is unavailable.`
        : !isOpenAI && !adapter.trial_guard
          ? "This adapter isn't covered by the spending guard yet, so it can't make paid calls here."
        : !trial?.enabled
          ? `The protected ${ledgerName} is not enabled. No unprotected call will be made.`
          : trial.blocked || !Number.isFinite(trial.remaining_usd) || Number(trial.remaining_usd) < 0.1
            ? `The ${ledgerName} is unavailable or too low for another request.`
            : !w.caseId
              ? "No evidence case is available."
              : (isOpenAI && !contract) || !w.inventory || !w.tools.some((t) => t.name === "query_case_evidence")
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
  // Arriving from Anatomy: select the first step of the requested kind.
  useEffect(() => {
    if (!focus) return;
    const hit = steps.find((s) => s.kind === focus.kind);
    if (hit) select(hit.seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  async function execute(continuation = false) {
    if (startLock.current || active || blocked || (continuation && !continuationSafe)) return;
    startLock.current = true;
    runBoundary.current = { session: w.data?.session.id || "", seq: trace.at(-1)?.seq || 0 };
    setRunChoice(null);
    setPending(true);
    w.setNotice("");
    setSelected(null);
    setCitedId(null);
    loopRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    try {
      if (!continuation) {
        await w.newSession({
          ...defaultConfig,
          runtime,
          model: isOpenAI ? trial!.model || adapter!.default_model : adapter!.default_model,
          permission: "read_only",
          ...(isOpenAI ? { openai_experiment: experiment } : {}),
          max_turns: isOpenAI ? profile.calls : 3,
          max_output_tokens: 1000,
          structured_output: structured || (isOpenAI && experiment === "guardrails"),
          disabled_tools: w.tools
            .filter((t) => !(isOpenAI ? profile.tools : ["query_case_evidence"]).some((name) => name === t.name))
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
  function select(seq: number, focusButton = false) {
    setSelected(seq);
    if (focusButton) stepRefs.current.get(seq)?.focus();
  }
  function step(delta: number) {
    const next = steps[Math.min(steps.length - 1, Math.max(0, selIndex + delta))];
    if (next) select(next.seq, true);
  }
  function cite(id: number) {
    setCitedId(id);
    const tr = run.find(
      (t) =>
        t.kind === "tool.result" &&
        Array.isArray(object(t.payload.result).items) &&
        (object(t.payload.result).items as unknown[]).some((r) => Number(object(r).id) === id),
    );
    if (tr) select(tr.seq);
    const rec = recordRefs.current.get(id);
    if (rec) {
      rec.open = true;
      rec.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  }

  // Pending approvals: saved state, plus live trace receipts not yet resumed (the
  // approvals list is only re-synced after a stream ends).
  const resumed = new Set(
    trace.filter((t) => t.kind === "sdk.approval.resumed").map((t) => String(t.payload.id)),
  );
  const pendingApprovals = [
    ...(w.data?.approvals || [])
      .filter((a) => a.status === "pending")
      .map((a) => ({ id: a.id, tool: a.tool, arguments: a.arguments as unknown })),
    ...trace
      .filter((t) => t.kind === "approval.requested" && !resumed.has(String(t.payload.id)))
      .map((t) => ({
        id: String(t.payload.id),
        tool: String(t.payload.tool || "tool"),
        arguments: t.payload.arguments as unknown,
      })),
  ].filter(
    (a, i, all) =>
      !resumed.has(a.id) &&
      all.findIndex((b) => b.id === a.id) === i &&
      !(w.data?.approvals || []).some((x) => x.id === a.id && x.status !== "pending"),
  );
  const toolContract = Array.isArray(contract?.tools)
    ? contract!.tools.filter((t) => profile.tools.some((name) => name === object(t).name))
    : [];
  const status = active ? "Running" : completed ? "Complete" : failed ? "Stopped" : steps.length ? "Recorded" : "Not started";

  const inspector = selectedEvent ? (
    <Inspector
      event={selectedEvent}
      index={selIndex}
      total={steps.length}
      onStep={step}
      onPart={onPart}
      runtime={w.data?.session.config.runtime || runtime}
    />
  ) : null;

  return (
    <div className="hl-run" hidden={hidden}>
      {/* ---------- Setup column ---------- */}
      <aside className="hl-setup" aria-label="Investigation setup">
        <section className="hl-block">
          <header className="hl-block-head">
            <h3>Request</h3>
            <span className="hl-tag hl-l-you">You</span>
          </header>
          <div className="hl-runtime">
            <label className="hl-label" htmlFor="runtime-select">Framework</label>
            <select
              id="runtime-select"
              value={runtime}
              disabled={!!active || !setRuntime}
              onChange={(e) => setRuntime?.(e.target.value)}
            >
              {[...new Set(["openai", ...runnable, runtime])].map((id) => (
                <option key={id} value={id}>
                  {frameworkById[id]?.name || id}
                </option>
              ))}
            </select>
            {runnable.filter((id) => id !== "openai").length === 0 && (
              <small className="hl-fine">Other frameworks appear here once their key and spending guard are in place.</small>
            )}
          </div>
          <div className="hl-exp" hidden={!isOpenAI}>
            <label className="hl-label" htmlFor="experiment-select">
              Experiment
            </label>
            <select
              id="experiment-select"
              value={experiment}
              disabled={!!active}
              onChange={(e) => {
                const next = experimentFor(e.target.value);
                setExperiment(next.id);
                setPrompt(next.prompt);
                setNewRun(true);
              }}
            >
              {experiments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <p className="hl-exp-q">{profile.question}</p>
            <p className="hl-fine">{profile.description}</p>
            <code className="hl-exp-api">{profile.api}</code>
          </div>
          <label className="hl-label" htmlFor="task-prompt">
            What should the agent investigate?
          </label>
          <textarea
            id="task-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={active}
            rows={6}
          />
          {experiment === "guardrails" && (
            <div className="hl-guard">
              <button className="hl-secondary hl-small" disabled={!!active} onClick={() => setPrompt(profile.prompt)}>
                Evidence-only request
              </button>
              <button
                className="hl-secondary hl-small"
                disabled={!!active}
                onClick={() => setPrompt("Isolate FINANCE-07 and disable its account.")}
              >
                Try a blocked request
              </button>
              <small className="hl-fine">
                Literal-word demo policy, not a complete security classifier. A blocked input makes
                no model call.
              </small>
            </div>
          )}
          <button
            className="hl-primary"
            disabled={!!blocked || !!active || !prompt.trim()}
            onClick={() => void execute()}
          >
            {active ? <LoaderCircle size={16} className="hl-spin" /> : <Play size={16} />}
            Run investigation
          </button>
          {blocked ? (
            <p className="hl-blocked" role="status">{blocked}</p>
          ) : (
            <p className="hl-fine">
              Starts a fresh session. {profile.tools.length} read-only tool
              {profile.tools.length > 1 ? "s" : ""}, at most {profile.calls} model calls across all
              agents, up to 1,000 output tokens each, $0.10 reserved per call.
            </p>
          )}
        </section>

        <section className="hl-block">
          <header className="hl-block-head">
            <h3>Evidence</h3>
            <span className="hl-tag hl-l-data">Evidence</span>
          </header>
          <label className="hl-label" htmlFor="case-select">Collection</label>
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
            <optgroup label="Imported evidence (unlabelled)">
              {w.cases
                .filter((c) => c.kind !== "test_ground")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}: {c.title}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Test ground (labelled, graded)">
              {w.cases
                .filter((c) => c.kind === "test_ground")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}: {c.title.replace("Test ground: ", "")}
                  </option>
                ))}
            </optgroup>
          </select>
          <div className="hl-meta">
            <span><strong>{caseItem?.event_count?.toLocaleString() || "—"}</strong> records</span>
            <span><strong>{caseItem?.asset_count || "—"}</strong> hosts</span>
          </div>
          <p className="hl-fine">
            {caseItem?.kind === "test_ground"
              ? "Labelled synthetic scenario from Defense Collective. The answer key never reaches the agent; it grades the run when it finishes."
              : "Imported benchmark records, not live sensors. The model only sees a record when the tool returns it."}
          </p>
          <div className="hl-records">
            {w.evidenceLoading ? (
              <p role="status">Loading evidence…</p>
            ) : w.events.length ? (
              w.events.map((r) => (
                <details
                  key={r.id}
                  className={
                    "hl-record" +
                    (returned.includes(r.id) ? " is-returned" : "") +
                    (citedId === r.id ? " is-cited" : "")
                  }
                  ref={(el) => {
                    if (el) recordRefs.current.set(r.id, el);
                    else recordRefs.current.delete(r.id);
                  }}
                >
                  <summary>
                    <code>#{r.id}</code>
                    <span>
                      <strong>{r.host}</strong>
                      <small>{r.source}, event {r.event_id}</small>
                    </span>
                    {returned.includes(r.id) && <em>returned</em>}
                  </summary>
                  <JsonView value={r} />
                </details>
              ))
            ) : (
              <p>
                No records loaded.{" "}
                <button className="hl-link" onClick={() => void w.safe(w.refresh)}>
                  Retry evidence loading
                </button>
              </p>
            )}
          </div>
        </section>

        <section className="hl-block">
          <header className="hl-block-head">
            <h3>Contract</h3>
            <span className="hl-tag hl-l-app">Your app</span>
          </header>
          <dl className="hl-owners">
            <dt className="hl-l-model">Model</dt>
            <dd>{(isOpenAI ? trial?.model : "") || adapter?.default_model || "Loading…"}</dd>
            <dt className="hl-l-app">Runner</dt>
            <dd>
              {fwProfile?.name || runtime} {String(adapter?.version || (isOpenAI ? contract?.version : "") || "")}
            </dd>
            <dt className="hl-l-app">Tools</dt>
            <dd>
              {profile.tools.map((t) => (
                <code key={t}>{t} </code>
              ))}
              read-only, scoped to this case
            </dd>
          </dl>
          <label className="hl-check">
            <input
              type="checkbox"
              checked={structured || experiment === "guardrails"}
              disabled={!!active || experiment === "guardrails"}
              onChange={(e) => setStructured(e.target.checked)}
            />
            <span>
              Require structured findings
              <small>Validates the answer's shape, not whether it is true.</small>
            </span>
          </label>
          <details>
            <summary>Tool schemas</summary>
            <JsonView value={toolContract} />
          </details>
          <details>
            <summary>Agent instructions</summary>
            <p className="hl-prose">
              {String(contract?.instructions || "Loading the server contract…")}
            </p>
          </details>
          <details>
            <summary>Output schema</summary>
            <JsonView value={contract?.output_schema} />
          </details>
          <button className="hl-link" onClick={() => onPart("contract")}>
            How contracts work in other frameworks
          </button>
        </section>
      </aside>

      {/* ---------- Loop column ---------- */}
      <section className="hl-loop" ref={loopRef} aria-label="Agent loop">
        <header className="hl-loop-head">
          <div>
            <h3>The loop, step by step</h3>
            <p>Each dot sits in the lane of whoever acted. Lines show the hand-off.</p>
          </div>
          <span className={"hl-state" + (active ? " is-live" : completed ? " is-done" : failed ? " is-failed" : "")}>
            {status}
          </span>
        </header>

        {runStarts.length > 1 && (
          <div className="hl-runs" role="tablist" aria-label="Runs in this session">
            {runStarts.map((t, i) => {
              const latest = i === runStarts.length - 1;
              const on = latest ? runChoice === null : runChoice === t.seq;
              return (
                <button
                  key={t.seq}
                  role="tab"
                  aria-selected={on}
                  disabled={!!active}
                  title={String(t.payload.text || "")}
                  onClick={() => {
                    setRunChoice(latest ? null : t.seq);
                    setSelected(null);
                  }}
                >
                  Run {i + 1}
                  {i > 0 && <small>follow-up</small>}
                </button>
              );
            })}
          </div>
        )}

        {pendingApprovals.map((a) => (
            <section className="hl-approval" key={a.id} aria-label="Human approval required">
              <header className="hl-block-head">
                <h3>Your decision is needed</h3>
                <span className="hl-tag hl-l-you">You</span>
              </header>
              <p>
                The SDK paused before running <code>{a.tool}</code>. Approve this read-only query
                or deny it; a denial goes back to the model without executing the tool.
              </p>
              <JsonView value={a.arguments} />
              <div className="hl-row">
                {(["approve", "deny"] as const).map((decision) => (
                  <button
                    key={decision}
                    className={decision === "approve" ? "hl-primary" : "hl-secondary"}
                    disabled={deciding}
                    onClick={() => {
                      setDeciding(true);
                      void w
                        .safe(() => w.sessionAction("approval", { id: a.id, decision }))
                        .finally(() => setDeciding(false));
                    }}
                  >
                    {decision === "approve" ? "Approve query" : "Deny query"}
                  </button>
                ))}
              </div>
              <small className="hl-fine">Approval expires after 90 seconds. Keep this tab open.</small>
            </section>
          ))}

        <details className="hl-map" hidden={!isOpenAI} open={experiment !== "core" || savedProfile.id !== "core"}>
          <summary>
            Agent map <small>{(run.length ? savedProfile : profile).title}</small>
          </summary>
          <OrchestrationMap
            experiment={run.length ? savedProfile.id : experiment}
            trace={run}
            active={!!active}
            sessionId={w.data?.session.id}
            onInspect={(seq) => select(seq)}
          />
        </details>

        <div className="hl-swim">
          <div className="hl-lanes-head" aria-hidden="true">
            {lanes.map((l) => (
              <span key={l} className={"hl-l-" + l}>{laneShort[l]}</span>
            ))}
          </div>

          {!steps.length ? (
            <>
              <p className="hl-ghost-note">
                {active
                  ? "Starting the SDK runner. Waiting for the first saved event; keep this tab open."
                  : experiment === "core"
                    ? "Nothing has run yet. This is the path the default request is designed to take; the model may choose differently."
                    : "Nothing has run yet. The agent map above shows this experiment's configured route; the steps will appear here as they happen."}
              </p>
              <ol className="hl-steps is-ghost" hidden={experiment !== "core" || !!active}>
                {expectedPath.map((g, i) => (
                  <Fragment key={i}>
                    {g.call && g.title.endsWith("context sent") && (
                      <li className="hl-iter">
                        Model call {g.call}
                        {g.call > 1 && <span>tool output goes back to the model</span>}
                      </li>
                    )}
                    <li className="hl-step">
                      <div className="hl-step-btn">
                        <Gutter lane={g.lane} prev={expectedPath[i - 1]?.lane} ghost />
                        <span className="hl-step-text">
                          <strong>{g.title}</strong>
                          <small>{g.note}</small>
                        </span>
                      </div>
                    </li>
                  </Fragment>
                ))}
              </ol>
            </>
          ) : (
            <ol
              className="hl-steps"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "j") {
                  e.preventDefault();
                  step(1);
                } else if (e.key === "ArrowUp" || e.key === "k") {
                  e.preventDefault();
                  step(-1);
                }
              }}
            >
              {steps.map((t, i) => {
                const g = eventGuide(t)!;
                const lane = laneOf(t);
                const call = t.kind === "model.request" ? Number(t.payload.call || 0) : 0;
                const on = selectedEvent?.seq === t.seq;
                return (
                  <Fragment key={t.seq}>
                    {call > 0 && (
                      <li className="hl-iter">
                        Model call {call}
                        {call > 1 && <span>tool output goes back to the model</span>}
                      </li>
                    )}
                    <li className={"hl-step" + (on ? " is-on" : "")}>
                      <button
                        className="hl-step-btn"
                        ref={(el) => {
                          if (el) stepRefs.current.set(t.seq, el);
                          else stepRefs.current.delete(t.seq);
                        }}
                        aria-pressed={on}
                        onClick={() => select(t.seq)}
                      >
                        <Gutter
                          lane={lane}
                          prev={i ? laneOf(steps[i - 1]) : undefined}
                          fresh={!!active && i === steps.length - 1}
                        />
                        <span className="hl-step-text">
                          <strong>{g.title}</strong>
                          <small>{stepSummary(t)}</small>
                        </span>
                        <span className="hl-seq">{t.seq}</span>
                      </button>
                      {narrow && on && <div className="hl-inline">{inspector}</div>}
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          )}
        </div>

        {active && (
          <div className="hl-running" role="status">
            <LoaderCircle size={15} className="hl-spin" />
            <span>
              {steps.length ? eventGuide(steps.at(-1)!)?.title : "Connecting…"}
              <small>Keep this tab in the foreground while it streams.</small>
            </span>
            <button onClick={() => void w.safe(() => w.sessionAction("cancel"))}>
              <Square size={13} /> Stop
            </button>
          </div>
        )}
        {failed && (
          <p className="hl-callout hl-callout-warn">
            This run did not finish. Select the last step to read why.{" "}
            <button className="hl-link" onClick={() => void w.safe(w.refresh)}>
              Refresh saved state
            </button>{" "}
            (no model call).
          </p>
        )}

        {answer && (
          <section className="hl-findings" aria-label="Findings">
            <header className="hl-block-head">
              <h3>Findings</h3>
              <span className="hl-tag hl-l-model">Model</span>
            </header>
            <dl className="hl-metrics">
              <div><dt>Model calls</dt><dd>{requests.length || meteredCalls || "—"}</dd></div>
              <div><dt>Records returned</dt><dd>{returned.length}</dd></div>
              <div><dt>Tokens in / out</dt><dd>
                {tokens[0] || tokens[1]
                  ? `${tokens[0]} / ${tokens[1]}`
                  : frameworkUsage.input_tokens || frameworkUsage.output_tokens
                    ? `${Number(frameworkUsage.input_tokens || 0)} / ${Number(frameworkUsage.output_tokens || 0)}`
                    : "—"}
              </dd></div>
              <div><dt>Settled estimate</dt><dd>{settled.length ? `$${estimated.toFixed(4)}` : "—"}</dd></div>
            </dl>
            <Answer result={result} answer={answer} onCite={cite} />
            {grade && (
              <section className="pg-live" aria-label="Test ground check">
                <header>
                  <strong>Test ground check · {grade.case_id}</strong>
                  <GradeBadge g={grade} />
                </header>
                <GradeDetail g={grade} scenario={scenarioInfo} />
                {scenarioInfo && <PlaybookFlow scenario={scenarioInfo} playbook={playbookInfo} readIds={grade.read_ids} />}
              </section>
            )}
            <SessionClaimCheck sessionId={sessionId} ready={completed && !active} nonce={lastSeq} />
            <p className="hl-callout">
              Check before you trust. Records returned in this session:{" "}
              {sessionIds.length
                ? sessionIds.map((id) => (
                    <button key={id} className="hl-cite" onClick={() => cite(id)}>#{id}</button>
                  ))
                : "none"}
              . A valid citation means the record was available, not that the conclusion is right.
            </p>
            <div className="hl-follow">
              <label className="hl-label" htmlFor="follow-prompt">
                Continue this session
              </label>
              <p className="hl-fine">
                The next request re-sends this whole conversation, tool results included. Open its
                first model call to see the carried context.
              </p>
              <textarea
                id="follow-prompt"
                rows={3}
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
                disabled={active}
              />
              <div className="hl-row">
                <button
                  className="hl-primary"
                  disabled={!!active || !!blocked || !completed || !continuationSafe || !followup.trim()}
                  onClick={() => void execute(true)}
                >
                  Run follow-up
                </button>
                <button
                  className="hl-secondary"
                  disabled={!!active}
                  onClick={() => {
                    setNewRun(true);
                    document.getElementById("task-prompt")?.focus();
                  }}
                >
                  New investigation
                </button>
              </div>
              {!continuationSafe && (
                <p className="hl-fine">
                  This older session uses different limits or tools. Start a new investigation to
                  continue under this workbench's contract.
                </p>
              )}
            </div>
            <details>
              <summary>Token usage and output validation</summary>
              <JsonView value={result?.payload} />
            </details>
          </section>
        )}

        <footer className="hl-session">
          <span>{newRun ? "Next run starts a fresh session." : "Follow-ups continue this session."}</span>
          {w.data && <code>{w.data.session.id}</code>}
          <button className="hl-link" onClick={() => void w.safe(w.refresh)}>
            <RefreshCw size={13} /> Refresh
          </button>
          {w.data && (
            <button className="hl-link" onClick={() => void w.safe(() => w.exportSession())}>
              Export JSON
            </button>
          )}
          {steps.length > 0 && (
            <details className="hl-ledger">
              <summary>Full event ledger ({run.length} events)</summary>
              <JsonView value={run} />
            </details>
          )}
        </footer>
      </section>

      {/* ---------- Inspector column (wide screens) ---------- */}
      {!narrow && (
        <aside className="hl-inspector" aria-live="polite" aria-label="Selected step">
          {inspector || (
            <div className="hl-inspector-empty">
              <h3>Inspector</h3>
              <p>
                Run an investigation, then select any step to see who owns it, what the SDK call
                looks like, and the exact payload that was recorded.
              </p>
              <ul className="hl-lane-key">
                {lanes.map((l) => (
                  <li key={l}>
                    <i className={"hl-dot-key hl-l-" + l} />
                    <strong>{laneLabel[l]}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function Answer({ result, answer, onCite }: { result?: Trace; answer: Trace; onCite: (id: number) => void }) {
  const so = result?.payload.structured_output;
  if (!so || typeof so !== "object") return <p className="hl-prose"><Cited text={String(answer.payload.text)} onCite={onCite} /></p>;
  const r = object(so);
  const keys = ["observations", "hypotheses", "next_steps", "limitations"].filter((k) => k in r);
  return (
    <div className="hl-answer">
      {keys.map((k) => (
        <section key={k}>
          <h5>{k.replace("_", " ")}</h5>
          {Array.isArray(r[k]) ? (
            <ul>
              {(r[k] as unknown[]).map((v, i) => (
                <li key={i}><Cited text={String(v)} onCite={onCite} /></li>
              ))}
            </ul>
          ) : (
            <p><Cited text={String(r[k])} onCite={onCite} /></p>
          )}
        </section>
      ))}
      {Array.isArray(r.evidence_ids) && (
        <section>
          <h5>Cited evidence</h5>
          <p>
            {(r.evidence_ids as unknown[]).map((id) => (
              <button key={String(id)} className="hl-cite" onClick={() => onCite(Number(id))}>#{String(id)}</button>
            ))}
          </p>
        </section>
      )}
    </div>
  );
}

function Inspector({
  event,
  index,
  total,
  onStep,
  onPart,
  runtime,
}: {
  event: Trace;
  index: number;
  total: number;
  onStep: (d: number) => void;
  onPart: (id: PartId) => void;
  runtime: string;
}) {
  const g = eventGuide(event)!;
  const chapterId = chapterFor(runtime, event);
  const chapter = chapterId ? deepDives[runtime]?.chapters.find((c) => c.id === chapterId) : undefined;
  const lane = laneOf(event);
  const part = partForEvent(event.kind);
  return (
    <div className="hl-insp">
      <div className="hl-insp-nav">
        <span className={"hl-tag hl-l-" + lane}>{laneLabel[lane]}</span>
        <span className="hl-insp-count">Step {index + 1} of {total}</span>
        <button aria-label="Previous step" disabled={index <= 0} onClick={() => onStep(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button aria-label="Next step" disabled={index >= total - 1} onClick={() => onStep(1)}>
          <ChevronRight size={15} />
        </button>
      </div>
      <h3>{g.title}</h3>
      <p className="hl-desc">{g.meaning}</p>
      <Section title="Who acts">
        <p>{g.owner}</p>
      </Section>
      <Section title="SDK equivalent">
        <code className="hl-code">{g.code}</code>
      </Section>
      {chapter && (
        <Section title="Under the hood">
          <a className="hl-link hl-deep-link" href={chapterHash(runtime, chapter.id)}>
            {frameworkById[runtime]?.name || runtime}: {chapter.title} →
          </a>
        </Section>
      )}
      {part && (
        <Section title="Harness part">
          <button className="hl-link" onClick={() => onPart(part.id)}>
            {part.name}: how it works and how other frameworks do it
          </button>
        </Section>
      )}
      <Section title={`Recorded payload, event ${event.seq}`}>
        <Payload event={event} />
      </Section>
    </div>
  );
}
