import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import type { Workspace } from "../useWorkspace";
import type { Cell } from "../lib/types";
import {
  eventCapability,
  eventLayer,
  layers,
  learningTrace,
  lessons,
} from "../lib/sdkLearning";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Empty, JsonView, Status } from "./shared";
import "./sdk-lab.css";
import { OpenAiWorkshop } from "./OpenAiWorkshop";

const sourceRoot = "https://github.com/MandilKarki/SoCHarness/blob/main/";
function sourceLink(path?: string | null) {
  return path &&
    /^(services|workers)\/[a-zA-Z0-9_./-]+$/.test(path) &&
    !path.includes("..")
    ? sourceRoot + path
    : undefined;
}
function httpsLink(url?: string) {
  try {
    return url && new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
function Mapping({ cell, label }: { cell?: Cell; label: string }) {
  return (
    <div className="learn-mapping">
      <div className="learn-row">
        <strong>{label}</strong>
        <Status tone={cell?.status === "gap" ? "warning" : "neutral"}>
          {cell?.status || "Not assessed"}
        </Status>
      </div>
      <code>
        {cell?.upstream_api || "No version-specific API mapping available"}
      </code>
      <p>
        {cell?.note ||
          "Wait for the server inventory before inferring implementation coverage."}
      </p>
      <small>
        Live evidence: {cell?.live_status || "not verified"}. Contract coverage
        is not live provider proof.
      </small>
      <div className="learn-links">
        {sourceLink(cell?.implementation) && (
          <a
            href={sourceLink(cell?.implementation)}
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={14} /> Relay implementation
          </a>
        )}
        {sourceLink(cell?.contract_suite) && (
          <a
            href={sourceLink(cell?.contract_suite)}
            target="_blank"
            rel="noreferrer"
          >
            Contract tests <ExternalLink size={12} />
          </a>
        )}
        {httpsLink(cell?.source) && (
          <a href={httpsLink(cell?.source)} target="_blank" rel="noreferrer">
            Upstream documentation <ExternalLink size={12} />
          </a>
        )}
      </div>
      {cell?.mapping_id && (
        <small className="learn-id">{cell.mapping_id}</small>
      )}
    </div>
  );
}

export function SdkLab({
  w,
  configure,
  draft,
}: {
  w: Workspace;
  configure: (sdk: string) => void;
  draft: (text: string) => void;
}) {
  const [sdk, setSdk] = useState("openai"),
    [mode, setMode] = useState<"lesson" | "recorded">("lesson");
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(3500);
  const [follow, setFollow] = useState(true),
    [revealed, setRevealed] = useState(false),
    [query, setQuery] = useState("");
  const [feature, setFeature] = useState<string | null>(null),
    [filter, setFilter] = useState("all");
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const change = () => {
      setReduced(media.matches);
      if (media.matches) setPlaying(false);
    };
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const frameworks = w.inventory?.frameworks || [],
    framework = frameworks.find((f) => f.id === sdk);
  const matching = w.data?.session.config.runtime === sdk;
  const receipts = useMemo(
    () => learningTrace(matching ? w.data?.trace || [] : []),
    [matching, w.data?.trace],
  );
  const count = mode === "lesson" ? lessons.length : receipts.length;
  const index = Math.min(step, Math.max(0, count - 1));
  const receipt = mode === "recorded" ? receipts[index] : undefined;
  const lesson = lessons[index % lessons.length];
  const active =
    mode === "lesson" ? lesson.layer : receipt ? eventLayer(receipt) : null;
  const capability =
    mode === "lesson"
      ? lesson.capability
      : receipt
        ? eventCapability(receipt)
        : "loop";
  const row = w.inventory?.rows.find((r) => r.id === capability),
    cell = row?.cells[sdk];
  const featureRow = w.inventory?.rows.find((r) => r.id === feature);
  const sessionId = w.data?.session.id;
  useEffect(() => {
    setStep(0);
    setPlaying(false);
    setFeature(null);
    setRevealed(false);
  }, [sdk, mode, sessionId]);
  useEffect(() => {
    setRevealed(false);
  }, [index]);
  useEffect(() => {
    if (mode === "recorded" && follow && count) setStep(count - 1);
  }, [mode, follow, count, sdk, sessionId]);
  useEffect(() => {
    if (!playing || reduced || count < 2) return;
    const timer = setInterval(
      () =>
        setStep((n) => {
          if (n >= count - 1) {
            setPlaying(false);
            return n;
          }
          return n + 1;
        }),
      speed,
    );
    return () => clearInterval(timer);
  }, [playing, reduced, count, speed]);
  const go = (n: number) => {
    setPlaying(false);
    setFollow(false);
    setFeature(null);
    setStep(Math.max(0, Math.min(count - 1, n)));
  };
  const rows = (w.inventory?.rows || []).filter(
    (r) =>
      (filter === "all" || r.cells[sdk]?.status === filter) &&
      (r.label + " " + r.category + " " + r.cells[sdk]?.upstream_api)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="sdk-learning">
      {sdk === "openai" && <OpenAiWorkshop w={w} />}
      <details className="sdk-reference">
        <summary>
          Advanced reference · diagrams, SDKs and capability coverage
        </summary>
        <div className="learn-intro">
          <div>
            <span className="eyebrow">FROM QUESTION TO EVIDENCE</span>
            <h2>An agent, opened up.</h2>
            <p>
              One investigation. Two perspectives: how Relay works, and what the
              SDK actually does.
            </p>
          </div>
          <label className="learn-sdk-picker">
            Explore an SDK
            <select
              aria-label="Learning SDK"
              value={sdk}
              onChange={(e) => setSdk(e.target.value)}
            >
              {!frameworks.length && (
                <option value="openai">
                  OpenAI Agents · loading inventory
                </option>
              )}
              {frameworks.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="learn-version">
          <Code2 size={15} />
          <span>{framework?.package || "openai-agents"}</span>
          <strong>Pinned {framework?.pinned_version || "unverified"}</strong>
          <span>
            Installed {framework?.version || "unavailable"} ·{" "}
            {framework?.version_state || "not checked"}
          </span>
        </div>
        <div className="learn-modebar">
          <div className="learn-segment" aria-label="Learning source">
            {(["lesson", "recorded"] as const).map((m) => (
              <button
                key={m}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "lesson" ? (
                  <BookOpen size={15} />
                ) : (
                  <Waypoints size={15} />
                )}
                {m === "lesson" ? "Illustrated lesson" : "Session evidence"}
              </button>
            ))}
          </div>
          <span className="learn-cost">
            <ShieldCheck size={14} /> Viewing & playback make no model calls
          </span>
        </div>
        <div className="learn-source-notice" role="status">
          {mode === "lesson" ? (
            <>
              <strong>Illustration, not a live run.</strong> OpenAI-first
              teaching sequence; other SDKs use the same architecture with their
              own support mappings. Not an exhaustive upstream API course.
            </>
          ) : (
            <>
              <strong>
                {w.busy && matching
                  ? "Following an active session"
                  : "Recorded session evidence"}
                .
              </strong>{" "}
              Only received events are shown. Animation is playback, not new
              execution. Internal model reasoning is not exposed.
            </>
          )}
        </div>
        {mode === "recorded" && (
          <div className="learn-session-controls">
            <label>
              Case
              <select
                aria-label="Learning case"
                value={w.caseId}
                disabled={w.busy}
                onChange={(e) => {
                  w.selectCase(e.target.value);
                  w.setView("sdk-lab");
                }}
              >
                {w.cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Matching session
              <select
                aria-label="Learning session"
                disabled={w.busy}
                value={matching ? sessionId : ""}
                onChange={(e) => {
                  const s = w.sessions.find((s) => s.id === e.target.value);
                  if (s) void w.safe(() => w.loadSession(s));
                }}
              >
                <option value="">
                  Choose a {framework?.name || sdk} session
                </option>
                {w.sessions
                  .filter(
                    (s) => s.case_id === w.caseId && s.config.runtime === sdk,
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="learn-follow">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => {
                  setPlaying(false);
                  setFollow(e.target.checked);
                }}
              />{" "}
              Follow new events
            </label>
          </div>
        )}
        <div className="learn-playback" aria-label="Playback controls">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Restart playback"
            onClick={() => go(0)}
            disabled={!count}
          >
            <RotateCcw size={16} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous learning step"
            onClick={() => go(index - 1)}
            disabled={index === 0 || !count}
          >
            <ChevronLeft />
          </Button>
          <Button
            disabled={reduced || count < 2}
            onClick={() => {
              setFeature(null);
              setFollow(false);
              if (index === count - 1) setStep(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause /> : <Play />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next learning step"
            onClick={() => go(index + 1)}
            disabled={index >= count - 1}
          >
            <ChevronRight />
          </Button>
          <label className="learn-scrubber">
            <span>
              {count ? index + 1 : 0} / {count}
            </span>
            <input
              aria-label="Playback position"
              type="range"
              min={0}
              max={Math.max(0, count - 1)}
              value={index}
              disabled={!count}
              onChange={(e) => go(Number(e.target.value))}
            />
          </label>
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={6000}>Slow</option>
            <option value={3500}>Normal</option>
            <option value={1500}>Fast</option>
          </select>
          {reduced && <small>Reduced motion: use step controls.</small>}
        </div>
        <div className="learn-stage">
          <section
            className="learn-canvas"
            aria-label="Top-down agent architecture"
          >
            <div className="learn-canvas-heading">
              <span>EXECUTION MAP</span>
              <Status>
                {mode === "lesson"
                  ? "Illustrated"
                  : receipt
                    ? `Receipt #${receipt.seq}`
                    : "No receipt"}
              </Status>
            </div>
            <div
              className={
                "learn-flow " + (playing && !reduced ? "is-playing" : "")
              }
            >
              {layers.map((layer, n) => (
                <div className="learn-node-wrap" key={layer.id}>
                  {n > 0 && (
                    <div className="learn-connector" aria-hidden="true">
                      <ArrowDown size={18} />
                    </div>
                  )}
                  <button
                    className={
                      "learn-node " + (active === layer.id ? "active" : "")
                    }
                    aria-pressed={active === layer.id}
                    disabled={
                      mode === "recorded" &&
                      !receipts.some((r) => eventLayer(r) === layer.id)
                    }
                    onClick={() => {
                      const next =
                        mode === "lesson"
                          ? lessons.findIndex((s) => s.layer === layer.id)
                          : receipts.findIndex(
                              (r) => eventLayer(r) === layer.id,
                            );
                      if (next >= 0) go(next);
                    }}
                  >
                    <span className="learn-node-number">0{n + 1}</span>
                    <span>
                      <strong>{layer.label}</strong>
                      <small>
                        {layer.id === "runner"
                          ? `${framework?.name || sdk} · ${layer.subtitle}`
                          : layer.subtitle}
                      </small>
                    </span>
                    <span className="learn-node-light" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="learn-loop-note">
                <RotateCcw size={15} /> Tool result → SDK → next model turn,
                until a result or limit
              </div>
            </div>
            <small className="learn-map-caption">
              Conceptual layers, not a mandatory sequence. The highlight follows
              the lesson or selected receipt; skipped layers are not inferred.
            </small>
          </section>
          <section className="learn-detail" aria-label="Current learning step">
            {mode === "lesson" ? (
              <>
                <span className="eyebrow">
                  LESSON {index + 1} / {lessons.length}
                </span>
                <h3>{lesson.title}</h3>
                <p className="learn-explanation">{lesson.explanation}</p>
                <div className="learn-soc">
                  <span>IN OUR SOC</span>
                  <p>{lesson.soc}</p>
                </div>
                <Mapping cell={cell} label={row?.label || capability} />
                <p className="learn-boundary">
                  <ShieldCheck size={16} />
                  {lesson.boundary}
                </p>
                <div className="learn-check">
                  <strong>Check your understanding</strong>
                  <p>{lesson.question}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevealed(!revealed)}
                  >
                    {revealed ? "Hide explanation" : "Reveal explanation"}
                  </Button>
                  {revealed && <p className="learn-answer">{lesson.answer}</p>}
                </div>
              </>
            ) : receipt ? (
              <>
                <span className="eyebrow">
                  RECORDED EVENT · {index + 1} / {count}
                </span>
                <h3>{receipt.kind}</h3>
                <time>{receipt.created_at}</time>
                <p className="learn-explanation">
                  {active
                    ? `Relay observed this event at the ${layers.find((l) => l.id === active)?.label.toLowerCase()} layer.`
                    : "This event has no reviewed architecture mapping. Its original payload is preserved below."}{" "}
                  This receipt does not establish execution of any missing
                  stage.
                </p>
                <Mapping cell={cell} label={row?.label || capability} />
                <details className="learn-payload" open>
                  <summary>Original received payload · #{receipt.seq}</summary>
                  <JsonView value={receipt.payload} />
                </details>
                <p className="learn-boundary">
                  Consecutive text deltas are collapsed to their last receipt
                  for readability. Full deltas remain in Execution trace /
                  Export.
                </p>
              </>
            ) : (
              <Empty
                title={
                  matching
                    ? "No events recorded yet"
                    : "Select a matching SDK session"
                }
              >
                Choose an existing session above, or configure one below. We
                never substitute illustrative events for a missing execution
                trace.
              </Empty>
            )}
          </section>
        </div>
        <section className="learn-curriculum">
          <div className="learn-row">
            <div>
              <span className="eyebrow">CAPABILITY ATLAS</span>
              <h3>What can this SDK do here?</h3>
              <p>
                Every tracked capability, including gaps.{" "}
                {w.inventory?.rows.length || 0} families—not every upstream API
                symbol.
              </p>
            </div>
            <Button variant="outline" onClick={() => w.setView("matrix")}>
              Compare all SDKs <ArrowRight size={14} />
            </Button>
          </div>
          <div className="learn-filters">
            <Input
              aria-label="Search SDK capabilities"
              placeholder="Find tools, sessions, handoffs, memory…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Capability implementation filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All implementation levels</option>
              <option value="native">Native integration</option>
              <option value="shared">Shared Relay feature</option>
              <option value="partial">Partial integration</option>
              <option value="gap">Not integrated</option>
            </select>
          </div>
          <div className="learn-feature-grid">
            {rows.map((r) => (
              <button
                key={r.id}
                aria-pressed={feature === r.id}
                onClick={() => setFeature(r.id)}
              >
                <small>{r.category}</small>
                <strong>{r.label}</strong>
                <Status
                  tone={r.cells[sdk]?.status === "gap" ? "warning" : "neutral"}
                >
                  {r.cells[sdk]?.status || "unknown"}
                </Status>
              </button>
            ))}
          </div>
          {!rows.length && <p>No matching capability mappings.</p>}
          {feature && (
            <div className="learn-feature-detail">
              <Mapping
                cell={featureRow?.cells[sdk]}
                label={featureRow?.label || feature}
              />
              <Button variant="ghost" onClick={() => setFeature(null)}>
                Close capability detail
              </Button>
            </div>
          )}
        </section>
        <section className="learn-try">
          <div>
            <h3>Ready to investigate?</h3>
            <p>
              Configure {framework?.name || sdk}, then review your prompt before
              sending. Only supported, enabled runtimes can run; the October
              guard blocks other paid adapters.
            </p>
            <small>
              {framework?.credential
                ? `Current adapter credential: ${framework.credential}. `
                : ""}
              An SDK and a model provider are different choices. Changing this
              selector does not change your session or provider.
            </small>
          </div>
          <div>
            <Button
              disabled={w.busy || !w.caseId || !framework}
              onClick={() => configure(sdk)}
            >
              Configure this SDK
            </Button>
            <Button
              variant="outline"
              disabled={w.busy || !matching}
              onClick={() =>
                draft(
                  "Review at most 3 evidence records in this case. Cite record IDs, separate observations from hypotheses, and propose one bounded next step. Do not write or contain anything.",
                )
              }
            >
              Draft a bounded investigation
            </Button>
          </div>
        </section>
        <p className="learn-footnote">
          OpenAI curriculum reviewed 2026-10-01 against the running/streaming
          guides and Relay adapter.{" "}
          <a
            href="https://openai.github.io/openai-agents-python/running_agents/"
            target="_blank"
            rel="noreferrer"
          >
            Official agent-loop guide ↗
          </a>{" "}
          Upstream documentation is rolling; pinned source and contract tests
          determine supported behavior. Other SDKs currently share this
          introductory flow—not a complete SDK-specific course.
        </p>
      </details>
    </div>
  );
}
