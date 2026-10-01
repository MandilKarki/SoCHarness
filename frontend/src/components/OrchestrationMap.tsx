import { useEffect, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Trace } from "../lib/types";
import { experimentFor, graphNodes } from "../lib/openaiExperiments";
import { publicSteps, eventGuide } from "../lib/harnessView";
import "./orchestration-map.css";

export function OrchestrationMap({
  experiment,
  trace,
  active,
  onInspect,
  sessionId,
}: {
  experiment: string;
  trace: Trace[];
  active: boolean;
  onInspect: (seq: number) => void;
  sessionId?: string;
}) {
  const profile = experimentFor(experiment),
    nodes = graphNodes(experiment),
    events = publicSteps(trace);
  const [cursor, setCursor] = useState<number | null>(null),
    [playing, setPlaying] = useState(false),
    [overlay, setOverlay] = useState(false);
  const first = trace[0]?.seq;
  useEffect(() => {
    setCursor(null);
    setPlaying(false);
  }, [first, experiment]);
  useEffect(() => {
    if (active) {
      setCursor(null);
      setPlaying(false);
    }
  }, [active]);
  useEffect(() => {
    if (!playing || active) return;
    const timer = setInterval(
      () =>
        setCursor((old) => {
          const next = (old ?? -1) + 1;
          if (next >= events.length - 1) {
            setPlaying(false);
            return Math.max(0, events.length - 1);
          }
          return next;
        }),
      1100,
    );
    return () => clearInterval(timer);
  }, [playing, active, events.length]);
  const current = cursor === null ? events.at(-1) : events[cursor];
  const shown =
    cursor === null ? trace : trace.filter((t) => t.seq <= (current?.seq ?? 0));
  const context = shown.find((t) => t.kind === "session.context");
  const lastRequest = [...shown]
    .reverse()
    .find((t) => t.kind === "model.request");
  const committed = shown.find((t) => t.kind === "session.committed");
  const draw = (mobile: boolean) => {
    const manager = experiment === "manager";
    const width = mobile ? 360 : 1020,
      height = manager
        ? mobile
          ? 444
          : 240
        : mobile
          ? nodes.length * 96 + 20
          : 210;
    const points = manager
      ? mobile
        ? [
            { x: 180, y: 52 },
            { x: 180, y: 158 },
            { x: 180, y: 264 },
            { x: 180, y: 390 },
          ]
        : [
            { x: 170, y: 60 },
            { x: 430, y: 150 },
            { x: 750, y: 150 },
            { x: 750, y: 45 },
          ]
      : nodes.map((_, i) => ({
          x: mobile ? 180 : 110 + i * (800 / (nodes.length - 1)),
          y: mobile ? 52 + i * 96 : 84,
        }));
    return (
      <svg
        className={mobile ? "o-map o-mobile" : "o-map o-desktop"}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`${profile.title} ${mobile ? "mobile" : "desktop"} execution graph`}
      >
        <defs>
          <marker
            id={`arrow-${experiment}-${mobile}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="o-arrow" />
          </marker>
        </defs>
        {!manager &&
          points.slice(0, -1).map((p, i) => {
            const next = points[i + 1];
            return (
              <path
                key={i}
                className="o-edge"
                d={
                  mobile
                    ? `M${p.x},${p.y + 32} L${next.x},${next.y - 32}`
                    : `M${p.x + 84},${p.y} L${next.x - 84},${next.y}`
                }
                markerEnd={`url(#arrow-${experiment}-${mobile})`}
              />
            );
          })}
        {manager && (
          <>
            <path
              className="o-edge"
              d={
                mobile
                  ? "M180,84 L180,126 M180,190 L180,232 M34,52 C10,52 10,52 10,80 L10,370 Q10,390 34,390"
                  : "M255,70 L345,138 M515,150 L665,150 M255,45 L665,45"
              }
              markerEnd={`url(#arrow-${experiment}-${mobile})`}
            />
            <path
              className={
                "o-return " +
                (shown.some((t) => t.kind === "agent.returned")
                  ? "o-observed"
                  : "")
              }
              d={
                mobile
                  ? "M326,158 C351,158 351,52 326,52"
                  : "M430,182 C430,230 170,230 170,92"
              }
              markerEnd={`url(#arrow-${experiment}-${mobile})`}
            />
            <path
              className={
                "o-return " +
                (shown.some((t) => t.kind === "tool.result")
                  ? "o-observed"
                  : "")
              }
              d={
                mobile
                  ? "M326,264 C351,264 351,158 326,158"
                  : "M750,182 C750,218 515,218 515,170"
              }
              markerEnd={`url(#arrow-${experiment}-${mobile})`}
            />
            {!mobile && (
              <>
                <text x="465" y="30" className="o-edge-label">
                  manager owns final answer
                </text>
                <text x="290" y="232" className="o-edge-label">
                  specialist returns
                </text>
              </>
            )}
          </>
        )}
        {nodes.map((node, i) => {
          const hits = shown.filter(node.matches),
            latest = hits.at(-1),
            failed = latest?.payload.passed === false;
          const highlighted = current && node.matches(current);
          const p = points[i],
            w = mobile ? 292 : 170;
          return (
            <g
              key={node.id}
              role="button"
              aria-label={`${node.label}: ${failed ? "blocked" : hits.length ? `${hits.length} observed events` : "not observed"}`}
              tabIndex={latest ? 0 : -1}
              aria-disabled={!latest}
              className={`o-node ${hits.length ? "o-seen" : ""} ${highlighted ? "o-selected" : ""} ${failed ? "o-blocked" : ""}`}
              onClick={() => {
                if (latest) onInspect(latest.seq);
              }}
              onKeyDown={(e) => {
                if (latest && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onInspect(latest.seq);
                }
              }}
            >
              <rect x={p.x - w / 2} y={p.y - 32} width={w} height="64" rx="9" />
              <text x={p.x} y={p.y - 9} className="o-node-title">
                {node.label}
              </text>
              <text x={p.x} y={p.y + 8} className="o-node-detail">
                {mobile
                  ? node.detail
                  : failed
                    ? "Tripwire triggered"
                    : hits.length
                      ? `${hits.length} observed events`
                      : "Not observed yet"}
              </text>
              {mobile && (
                <text x={p.x} y={p.y + 24} className="o-node-state">
                  {failed
                    ? "Blocked"
                    : hits.length
                      ? `${hits.length} observed events`
                      : "Configured · not observed"}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  };
  return (
    <section className="o-workbench" aria-label="Orchestration visualization">
      <div className="o-header">
        <div>
          <p className="h-eyebrow">
            {trace.length
              ? "RECORDED EXECUTION"
              : "CONFIGURED ROUTE · NOT EXECUTED"}
          </p>
          <h3>{profile.question}</h3>
        </div>
        <button
          className="h-secondary"
          aria-pressed={overlay}
          onClick={() => setOverlay(!overlay)}
        >
          Session overlay
        </button>
      </div>
      <p className="h-hint">
        {profile.description} Select an observed node to inspect its receipt.
      </p>
      {draw(false)}
      {draw(true)}
      {overlay && (
        <div className="o-session" aria-label="Session context overlay">
          <span>
            <small>Retained before run</small>
            <strong>
              {String(context?.payload.retained_items ?? "—")} items
            </strong>
          </span>
          <span>
            <small>Latest request context</small>
            <strong>
              {String(lastRequest?.payload.input_items ?? "—")} items
            </strong>
          </span>
          <span>
            <small>Saved after success</small>
            <strong>
              {committed
                ? String(committed.payload.items) + " items"
                : "Not committed yet"}
            </strong>
          </span>
          <p>
            {String(context?.payload.method || "No session has run yet.")} ·{" "}
            {sessionId || "New session on start"}
            <br />
            Item counts are not token counts or the model’s context-window
            capacity. Python context stays local unless serialized into a model
            request.
          </p>
        </div>
      )}
      {!!events.length && (
        <div className="o-replay">
          <button
            aria-label="Previous recorded event"
            disabled={active || cursor === 0}
            onClick={() => {
              setPlaying(false);
              setCursor(Math.max(0, (cursor ?? events.length - 1) - 1));
            }}
          >
            <SkipBack size={16} />
          </button>
          <button
            disabled={active}
            onClick={() => {
              if (playing) {
                setPlaying(false);
                return;
              }
              setCursor(0);
              if (
                !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
              )
                setPlaying(true);
            }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}{" "}
            {playing ? "Pause" : "Replay"}
          </button>
          <button
            aria-label="Next recorded event"
            disabled={active || cursor === null || cursor >= events.length - 1}
            onClick={() => {
              setPlaying(false);
              setCursor(Math.min(events.length - 1, (cursor ?? 0) + 1));
            }}
          >
            <SkipForward size={16} />
          </button>
          <span>
            {cursor === null
              ? "Latest"
              : `${(cursor ?? 0) + 1} / ${events.length}`}{" "}
            · {active ? "live events" : "free replay"}
          </span>
          {cursor !== null && (
            <button
              onClick={() => {
                setCursor(null);
                setPlaying(false);
              }}
            >
              Latest
            </button>
          )}
        </div>
      )}
      {current && (
        <button className="o-current" onClick={() => onInspect(current.seq)}>
          <small>
            {eventGuide(current)?.owner} · event {current.seq}
          </small>
          <strong>{eventGuide(current)?.title}</strong>
          <span>{eventGuide(current)?.meaning}</span>
        </button>
      )}
      <code className="o-api">{profile.api}</code>
      <p className="h-hint">
        Lines describe the configured route, not proof of execution. Highlighted
        nodes have recorded receipts. No hidden model reasoning is displayed.
      </p>
    </section>
  );
}
