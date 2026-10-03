import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { FrameworkProfile, Glyph } from "../../lib/frameworks";

/** Original glyphs: each encodes the framework's core idea, never a vendor logo. */
export function FwIcon({ glyph, size = 24 }: { glyph: Glyph; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (glyph) {
    case "hooks": // a loop ring with interception notches
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2.5v3M21.5 12h-3M12 21.5v-3M2.5 12h3" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      );
    case "typed": // braces around a validation check
      return (
        <svg {...p}>
          <path d="M8 4C6 4 6 6 6 8s-1 4-2.5 4C5 12 6 14 6 16s0 4 2 4" />
          <path d="M16 4c2 0 2 2 2 4s1 4 2.5 4C19 12 18 14 18 16s0 4-2 4" />
          <path d="m9.5 12.2 1.8 1.8 3.4-3.6" />
        </svg>
      );
    case "graph": // a plan feeding a small graph
      return (
        <svg {...p}>
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="18" cy="8" r="2.2" />
          <circle cx="11" cy="18" r="2.2" />
          <path d="M8 7l7.8.8M7 8l3 8M16.6 10l-4 6.2" />
        </svg>
      );
    case "four": // four tools, nothing else
      return (
        <svg {...p}>
          <rect x="4" y="4" width="7" height="7" rx="1.6" />
          <rect x="13" y="4" width="7" height="7" rx="1.6" />
          <rect x="4" y="13" width="7" height="7" rx="1.6" />
          <rect x="13" y="13" width="7" height="7" rx="1.6" />
        </svg>
      );
    case "stream": // parts flowing out over time
      return (
        <svg {...p}>
          <path d="M3 7h9M3 12h13M3 17h6" />
          <circle cx="15.5" cy="7" r="1.4" fill="currentColor" />
          <circle cx="19.5" cy="12" r="1.4" fill="currentColor" />
          <circle cx="12.5" cy="17" r="1.4" fill="currentColor" />
        </svg>
      );
    case "client": // a client and a server joined by an event line
      return (
        <svg {...p}>
          <rect x="2.5" y="6" width="7" height="11" rx="1.5" />
          <rect x="14.5" y="4" width="7" height="15" rx="1.5" />
          <path d="M9.5 11.5h5" strokeDasharray="1.6 1.8" />
          <path d="M17 8h2M17 11h2" />
        </svg>
      );
    case "loop": // a run loop that can branch out
      return (
        <svg {...p}>
          <path d="M17.5 8A7 7 0 1 0 19 13" />
          <path d="M19.5 4.5v4h-4" />
          <path d="M14 14l5 5M19 15v4h-4" />
        </svg>
      );
    case "events": // an event timeline feeding state
      return (
        <svg {...p}>
          <path d="M6 3v18" />
          <circle cx="6" cy="6.5" r="1.6" fill="currentColor" />
          <circle cx="6" cy="12" r="1.6" fill="currentColor" />
          <circle cx="6" cy="17.5" r="1.6" fill="currentColor" />
          <path d="M10 6.5h9M10 12h6M10 17.5h8" />
        </svg>
      );
    case "layers": // middleware layers around an agent
      return (
        <svg {...p}>
          <path d="M12 3 21 8l-9 5-9-5 9-5Z" />
          <path d="m3 12.5 9 5 9-5" />
          <path d="m3 16.5 9 5 9-5" />
        </svg>
      );
    case "log": // an immutable log, checked step by step
      return (
        <svg {...p}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M8.5 8h7M8.5 12h7" />
          <path d="m8.5 16 1.6 1.6 3-3" />
        </svg>
      );
    case "spiral": // a learning loop that widens
      return (
        <svg {...p}>
          <path d="M12 12c0-1 1-1.6 1.8-1.2 1.4.6 1.2 2.8-.4 3.4-2.2.9-4.4-1-4-3.4.5-3.2 4-4.6 6.8-3.2 3.6 1.8 3.8 6.8.4 9-3.8 2.4-9 .6-10-3.8" />
        </svg>
      );
  }
}

const clampPos = (n: { x: number; y: number }) => ({
  x: Math.min(89.5, Math.max(10.5, n.x)),
  y: Math.min(88, Math.max(12, n.y)),
});
const W = 1000,
  H = 400,
  NW = 176,
  NH = 58;
function edgePoints(pa: { x: number; y: number }, pb: { x: number; y: number }) {
  const a = clampPos(pa),
    b = clampPos(pb);
  const ax = (a.x / 100) * W,
    ay = (a.y / 100) * H,
    bx = (b.x / 100) * W,
    by = (b.y / 100) * H;
  const dx = bx - ax,
    dy = by - ay;
  const clip = (sx: number, sy: number, ddx: number, ddy: number) => {
    const t = Math.min(
      ddx ? NW / 2 / Math.abs(ddx) : Infinity,
      ddy ? NH / 2 / Math.abs(ddy) : Infinity,
    );
    return [sx + ddx * (t + 0.02), sy + ddy * (t + 0.02)];
  };
  const [x1, y1] = clip(ax, ay, dx, dy);
  const [x2, y2] = clip(bx, by, -dx, -dy);
  return { x1, y1, x2, y2 };
}

function useReducedMotion() {
  const [r, setR] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(m.matches);
    m?.addEventListener?.("change", on);
    return () => m?.removeEventListener?.("change", on);
  }, []);
  return r;
}

/** Animated walkthrough of a framework's own topology. Illustrative, not a run. */
export function Scene({ fw }: { fw: FrameworkProfile }) {
  const reduced = useReducedMotion();
  const { nodes, steps } = fw.scene;
  const [i, setI] = useState(0),
    [playing, setPlaying] = useState(!reduced);
  useEffect(() => {
    setI(0);
    setPlaying(!reduced);
  }, [fw.id, reduced]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((n) => (n + 1) % steps.length), 2200);
    return () => clearInterval(t);
  }, [playing, steps.length]);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const edges = useMemo(() => {
    const seen = new Map<string, { from: string; to: string }>();
    steps.forEach((s) => {
      const k = [s.from, s.to].sort().join("|");
      if (!seen.has(k)) seen.set(k, { from: s.from, to: s.to });
    });
    return [...seen.values()];
  }, [steps]);
  const step = steps[i];
  const a = byId[step.from],
    b = byId[step.to];
  const live = a && b ? edgePoints(a, b) : null;
  return (
    <section className="fw-scene" aria-label={`${fw.name} walkthrough`}>
      <div className="fw-stage" aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} className="fw-edges">
          <defs>
            <marker id={`fw-arrow-${fw.id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 8 4 0 8z" className="fw-arrowhead" />
            </marker>
          </defs>
          {edges.map((e) => {
            const pa = byId[e.from],
              pb = byId[e.to];
            if (!pa || !pb) return null;
            const p = edgePoints(pa, pb);
            return <line key={e.from + e.to} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} className="fw-edge" />;
          })}
          {live && (
            <g key={i}>
              <line
                x1={live.x1}
                y1={live.y1}
                x2={live.x2}
                y2={live.y2}
                className="fw-edge fw-edge-on"
                markerEnd={`url(#fw-arrow-${fw.id})`}
              />
              {!reduced && (
                <circle r="7" className="fw-packet">
                  <animateMotion
                    dur="1.1s"
                    fill="freeze"
                    path={`M${live.x1},${live.y1} L${live.x2},${live.y2}`}
                  />
                </circle>
              )}
            </g>
          )}
        </svg>
        {nodes.map((n) => (
          <div
            key={n.id}
            className={
              "fw-node fw-k-" +
              (n.kind || "core") +
              (n.id === step.from ? " is-from" : "") +
              (n.id === step.to ? " is-to" : "")
            }
            style={{ left: clampPos(n).x + "%", top: clampPos(n).y + "%" }}
          >
            <strong>{n.label}</strong>
            {n.sub && <small>{n.sub}</small>}
          </div>
        ))}
      </div>
      <ol className="fw-steps-list">
        {steps.map((s, n) => (
          <li key={n} className={n === i ? "is-on" : ""}>
            <button onClick={() => (setPlaying(false), setI(n))}>
              <span>{n + 1}</span>
              <span>
                <strong>{byId[s.from]?.label} → {byId[s.to]?.label}</strong>
                <code>{s.api}</code>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="fw-caption" aria-live="polite">
        <div className="fw-controls">
          <button aria-label="Previous step" onClick={() => (setPlaying(false), setI((i - 1 + steps.length) % steps.length))}>
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button aria-label="Next step" onClick={() => (setPlaying(false), setI((i + 1) % steps.length))}>
            <ChevronRight size={15} />
          </button>
          <span className="fw-count">
            Step {i + 1} of {steps.length}
          </span>
        </div>
        <p>{step.say}</p>
        <code>{step.api}</code>
      </div>
      <p className="hl-fine">
        Illustration of how {fw.name} is wired in Relay, using its real API names. It is not a recorded run.
        {fw.scene.note ? " " + fw.scene.note : ""}
      </p>
    </section>
  );
}
