import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { deepDives, type Chapter, type Diagram, type DNode, type Tag } from "../../lib/deep";
import { safeLink } from "../../lib/api";

/* ---------- small helpers ---------- */

/** Render `backticks` as inline code. */
export function rich(text: string): ReactNode {
  const parts = text.split("`");
  return parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : <Fragment key={i}>{p}</Fragment>));
}

const tagLabel: Record<Tag, string> = {
  you: "caller",
  core: "runtime",
  model: "model",
  tool: "tool",
  guard: "control",
  state: "state",
  event: "event",
  stop: "end",
};

const kindLabel: Record<Diagram["kind"], string> = {
  flow: "Pipeline",
  loop: "Cycle",
  stack: "Layers",
  lanes: "Sequence",
  tree: "Branches",
  timeline: "Timeline",
};

function KindIcon({ kind }: { kind: Diagram["kind"] }) {
  const p = {
    flow: "M3 12h5m3 0h3m3 0h4M7 9l3 3-3 3M15 9l3 3-3 3",
    loop: "M20 12a8 8 0 1 1-3-6.2M20 4v4h-4",
    stack: "M4 4h16v16H4zM8 8h8v8H8z",
    lanes: "M6 3v18M18 3v18M6 8h12M18 14H6",
    tree: "M12 4v5M12 9H6v5M12 9h6v5M6 14v3M18 14v3",
    timeline: "M3 12h18M7 9v6M12 9v6M17 9v6",
  }[kind];
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={p} />
    </svg>
  );
}

interface Beat {
  key: string;
  t: string;
  s: string;
  tag?: Tag;
  dir?: "down" | "up";
}

/** Flatten a diagram into the ordered beats the animation walks through. */
export function beatsFor(d: Diagram): Beat[] {
  const b = (key: string, n: DNode, extra: Partial<Beat> = {}): Beat => ({ key, t: n.t, s: n.s, tag: n.tag, ...extra });
  switch (d.kind) {
    case "flow": {
      const out: Beat[] = [];
      d.steps.forEach((n, i) => {
        out.push(b("n" + i, n));
        if (d.back && i === d.back.from)
          out.push({ key: "back", t: "Loop back", s: `${d.back.label}: back to ${d.steps[d.back.to]?.t}.`, tag: "core" });
      });
      return out;
    }
    case "loop":
      return d.steps.map((n, i) => b("n" + i, n));
    case "stack": {
      const down = d.layers.map((n, i) => b("L" + i + "d", n, { dir: "down" }));
      const up = d.layers
        .map((n, i) => ({ ...b("L" + i + "u", n, { dir: "up" as const }), s: n.u || "The result passes back out through " + n.t + "." }))
        .reverse();
      return [...down, b("core", d.core), ...up];
    }
    case "lanes":
      return d.msgs.map((m, i) => ({ key: "m" + i, t: m.t, s: m.s, tag: m.tag }));
    case "tree": {
      const out = [b("r", d.root)];
      d.children.forEach((c, i) => {
        out.push(b("c" + i, c));
        (c.children || []).forEach((g, j) => out.push(b(`c${i}-${j}`, g)));
      });
      return out;
    }
    case "timeline":
      return d.events.map((n, i) => b("e" + i, n));
  }
}

function useReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches
    : false;
}

/* ---------- code view with light highlighting ---------- */

const KW = new Set(
  "async await def class return if elif else for while in not and or is import from as with try except finally raise lambda yield None True False pass const let var function new export default interface type extends implements of await typeof null undefined true false".split(
    " ",
  ),
);

function highlight(src: string, lang: Chapter["code"]["lang"]): ReactNode[] {
  const comment = lang === "ts" || lang === "json" ? "\\/\\/[^\\n]*" : "#[^\\n]*";
  const re = new RegExp(
    `(${comment})|("""[\\s\\S]*?"""|"(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(@[A-Za-z_][\\w.]*)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_]\\w*)`,
    "g",
  );
  const out: ReactNode[] = [];
  let last = 0,
    m: RegExpExecArray | null,
    k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const [tok] = m;
    let cls = "";
    if (m[1]) cls = "dd-tc";
    else if (m[2]) cls = "dd-ts";
    else if (m[3]) cls = "dd-td";
    else if (m[4]) cls = "dd-tn";
    else if (m[5]) {
      if (KW.has(tok)) cls = "dd-tk";
      else if (/^[A-Z]/.test(tok)) cls = "dd-tt";
      else if (src[re.lastIndex] === "(") cls = "dd-tf";
    }
    out.push(cls ? <span key={k++} className={cls}>{tok}</span> : tok);
    last = re.lastIndex;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

function CodeView({ code }: { code: Chapter["code"] }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code.src);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <figure className="dd-code">
      <figcaption>
        <span className="dd-lang">{code.lang === "ts" ? "TypeScript" : code.lang}</span>
        {code.caption && <span>{rich(code.caption)}</span>}
        <button className="dd-copy" onClick={copy} aria-label="Copy code">
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>{highlight(code.src, code.lang)}</code>
      </pre>
    </figure>
  );
}

/* ---------- diagrams ---------- */

interface DiagramProps {
  d: Diagram;
  active: string;
  seen: Set<string>;
  go: (key: string) => void;
  beat: number;
}

const st = (key: string, active: string, seen: Set<string>, tag?: Tag) =>
  "dd-n dd-t-" + (tag || "core") + (key === active ? " is-on" : seen.has(key) ? " is-seen" : "");

function NodeBtn({ k, n, p, className = "" }: { k: string; n: DNode; p: DiagramProps; className?: string }) {
  return (
    <button className={st(k, p.active, p.seen, n.tag) + " " + className} aria-pressed={k === p.active} onClick={() => p.go(k)}>
      <i className="dd-dot" aria-hidden="true" />
      <span>{n.t}</span>
    </button>
  );
}

function FlowDiagram(p: DiagramProps & { d: Extract<Diagram, { kind: "flow" }> }) {
  const { d } = p;
  const n = d.steps.length;
  return (
    <div className="dd-flow" style={{ ["--cols" as string]: n }}>
      <div className="dd-flow-row">
        {d.steps.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && <i className={"dd-arrow" + (p.active === "n" + i ? " is-on" : p.seen.has("n" + i) ? " is-seen" : "")} aria-hidden="true" />}
            <NodeBtn k={"n" + i} n={s} p={p} />
          </Fragment>
        ))}
      </div>
      {d.back && (
        <button
          className={"dd-back" + (p.active === "back" ? " is-on" : p.seen.has("back") ? " is-seen" : "")}
          style={{ ["--from" as string]: d.back.to, ["--to" as string]: d.back.from }}
          onClick={() => p.go("back")}
        >
          <span>↺ {d.back.label}</span>
        </button>
      )}
    </div>
  );
}

function LoopDiagram(p: DiagramProps & { d: Extract<Diagram, { kind: "loop" }> }) {
  const { d } = p;
  const n = d.steps.length;
  const W = 400,
    H = 250,
    rx = 158,
    ry = 92,
    cx = W / 2,
    cy = H / 2;
  const at = (i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  };
  const idx = Math.max(0, d.steps.findIndex((_, i) => "n" + i === p.active));
  const from = at((idx - 1 + n) % n),
    to = at(idx);
  const arc = `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} A ${rx} ${ry} 0 0 1 ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
  return (
    <div className="dd-loop">
      <div className="dd-loop-ring">
        <svg key={p.beat} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" preserveAspectRatio="none">
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="dd-ring" />
          <path d={arc} className="dd-ring-hot" />
          <circle r="6" className="dd-packet">
            <animateMotion dur="0.9s" fill="freeze" path={arc} />
          </circle>
        </svg>
        <span className="dd-loop-center">
          <small>cycle</small>
          {d.center}
        </span>
        {d.steps.map((s, i) => {
          const q = at(i);
          return (
            <span key={i} className="dd-loop-pos" style={{ left: `${(q.x / W) * 100}%`, top: `${(q.y / H) * 100}%` }}>
              <NodeBtn k={"n" + i} n={s} p={p} />
            </span>
          );
        })}
      </div>
      <ol className="dd-loop-list">
        {d.steps.map((s, i) => (
          <li key={i}>
            <NodeBtn k={"n" + i} n={s} p={p} />
          </li>
        ))}
      </ol>
      {d.exit && <p className="dd-exit">Exits when: {rich(d.exit)}</p>}
    </div>
  );
}

function StackDiagram(p: DiagramProps & { d: Extract<Diagram, { kind: "stack" }> }) {
  const { d } = p;
  const dir = p.active.endsWith("u") ? "up" : p.active.endsWith("d") ? "down" : "core";
  const render = (i: number): ReactNode => {
    if (i >= d.layers.length)
      return (
        <div className="dd-core">
          <NodeBtn k="core" n={d.core} p={p} />
        </div>
      );
    const L = d.layers[i];
    const on = p.active === `L${i}d` || p.active === `L${i}u`;
    const seen = p.seen.has(`L${i}d`) || p.seen.has(`L${i}u`);
    return (
      <div className={"dd-layer dd-t-" + (L.tag || "core") + (on ? " is-on" : seen ? " is-seen" : "")}>
        <button className="dd-layer-head" aria-pressed={on} onClick={() => p.go(`L${i}d`)}>
          <i className="dd-dot" aria-hidden="true" />
          <span>{L.t}</span>
          <small>layer {i + 1}</small>
        </button>
        {render(i + 1)}
      </div>
    );
  };
  return (
    <div className="dd-stack">
      <span className={"dd-dir dd-dir-" + dir} aria-hidden="true">
        {dir === "up" ? "↑ result" : dir === "down" ? "↓ request" : "● core"}
      </span>
      {render(0)}
    </div>
  );
}

function LanesDiagram(p: DiagramProps & { d: Extract<Diagram, { kind: "lanes" }> }) {
  const { d } = p;
  const n = d.actors.length;
  return (
    <div className="dd-lanes" style={{ ["--cols" as string]: n }}>
      {d.actors.map((a, i) => (
        <span key={a} className="dd-actor" style={{ gridColumn: i + 1 }}>
          {a}
        </span>
      ))}
      {d.actors.map((a, i) => (
        <i key={"life" + a} className="dd-life" style={{ gridColumn: i + 1, gridRow: `2 / span ${d.msgs.length}` }} aria-hidden="true" />
      ))}
      {d.msgs.map((m, i) => {
        const lo = Math.min(m.from, m.to),
          hi = Math.max(m.from, m.to),
          span = hi - lo + 1;
        const k = "m" + i;
        return (
          <button
            key={k}
            className={
              "dd-msg dd-t-" + (m.tag || "core") + (m.to < m.from ? " is-rev" : "") + (k === p.active ? " is-on" : p.seen.has(k) ? " is-seen" : "")
            }
            style={{ gridColumn: `${lo + 1} / span ${span}`, gridRow: i + 2, ["--inset" as string]: `${50 / span}%` }}
            aria-pressed={k === p.active}
            aria-label={`${d.actors[m.from]} to ${d.actors[m.to]}: ${m.t}`}
            onClick={() => p.go(k)}
          >
            <span className="dd-msg-t">{m.t}</span>
            <i className="dd-msg-line" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function TreeDiagram(p: DiagramProps & { d: Extract<Diagram, { kind: "tree" }> }) {
  const { d } = p;
  return (
    <div className="dd-tree">
      <div className="dd-tree-root">
        <NodeBtn k="r" n={d.root} p={p} />
      </div>
      <ul className="dd-tree-kids" style={{ ["--n" as string]: d.children.length }}>
        {d.children.map((c, i) => (
          <li key={i} className={p.active.startsWith("c" + i) || p.seen.has("c" + i) ? "is-path" : ""}>
            <NodeBtn k={"c" + i} n={c} p={p} />
            {c.children && (
              <ul className="dd-tree-grand">
                {c.children.map((g, j) => (
                  <li key={j}>
                    <NodeBtn k={`c${i}-${j}`} n={g} p={p} className="dd-n-sm" />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimelineDiagram(p: DiagramProps & { d: Extract<Diagram, { kind: "timeline" }> }) {
  const { d } = p;
  const n = d.events.length;
  const idx = d.events.findIndex((_, i) => "e" + i === p.active);
  return (
    <div className="dd-time" style={{ ["--cols" as string]: n }}>
      <div className="dd-track" aria-hidden="true">
        <i style={{ width: `${n > 1 ? (Math.max(0, idx) / (n - 1)) * 100 : 100}%` }} />
      </div>
      <ol>
        {d.events.map((e, i) => (
          <li key={i}>
            <NodeBtn k={"e" + i} n={e} p={p} />
          </li>
        ))}
      </ol>
      {d.legend && (
        <p className="dd-legend">
          {(Object.entries(d.legend) as [Tag, string][]).map(([t, l]) => (
            <span key={t} className={"dd-t-" + t}>
              <i className="dd-dot" /> {l}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function DiagramView(p: DiagramProps) {
  switch (p.d.kind) {
    case "flow":
      return <FlowDiagram {...p} d={p.d} />;
    case "loop":
      return <LoopDiagram {...p} d={p.d} />;
    case "stack":
      return <StackDiagram {...p} d={p.d} />;
    case "lanes":
      return <LanesDiagram {...p} d={p.d} />;
    case "tree":
      return <TreeDiagram {...p} d={p.d} />;
    case "timeline":
      return <TimelineDiagram {...p} d={p.d} />;
  }
}

/* ---------- the section ---------- */

export function DeepDive({ id, name }: { id: string; name: string }) {
  const dive = deepDives[id];
  const reduced = useReducedMotion();
  const [ch, setCh] = useState(0),
    [beat, setBeat] = useState(0),
    [playing, setPlaying] = useState(!reduced),
    [visible, setVisible] = useState(true);
  const ref = useRef<HTMLElement>(null);
  const chapter = dive?.chapters[Math.min(ch, (dive?.chapters.length || 1) - 1)];
  const beats = useMemo(() => (chapter ? beatsFor(chapter.diagram) : []), [chapter]);

  useEffect(() => {
    setCh(0);
  }, [id]);
  useEffect(() => {
    setBeat(0);
  }, [id, ch]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || !visible || beats.length < 2) return;
    const t = setInterval(() => setBeat((b) => (b + 1) % beats.length), 2600);
    return () => clearInterval(t);
  }, [playing, visible, beats.length]);

  if (!dive || !chapter) return null;
  const cur = beats[beat % beats.length];
  const seen = new Set(beats.slice(0, beat % beats.length).map((b) => b.key));
  const go = (key: string) => {
    const i = beats.findIndex((b) => b.key === key);
    if (i >= 0) {
      setBeat(i);
      setPlaying(false);
    }
  };
  const step = (dlt: number) => {
    setPlaying(false);
    setBeat((b) => (b + dlt + beats.length) % beats.length);
  };
  const pickChapter = (i: number) => {
    setCh(i);
    setPlaying(!reduced);
  };
  const n = dive.chapters.length;

  return (
    <section className="fw-block dd" id={`fw-deep-${id}`} ref={ref} aria-labelledby={`dd-title-${id}`}>
      <header className="dd-head">
        <div>
          <p className="dd-eyebrow">Under the hood · {n} chapters</p>
          <h3 id={`dd-title-${id}`}>How {name} really works</h3>
          <p className="dd-intro">{rich(dive.intro)}</p>
        </div>
      </header>

      <div className="dd-body">
        <nav className="dd-rail" aria-label={`${name} deep-dive chapters`}>
          <ol>
            {dive.chapters.map((c, i) => (
              <li key={c.id}>
                <button className={i === ch ? "is-on" : ""} aria-current={i === ch ? "step" : undefined} onClick={() => pickChapter(i)}>
                  <span className="dd-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="dd-rail-text">
                    <strong>{c.title}</strong>
                    <small>
                      <KindIcon kind={c.diagram.kind} /> {kindLabel[c.diagram.kind]}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article className="dd-chapter" key={chapter.id} aria-labelledby={`dd-ch-${id}-${chapter.id}`}>
          <header className="dd-ch-head">
            <p className="dd-eyebrow">
              Chapter {ch + 1} of {n} · <KindIcon kind={chapter.diagram.kind} /> {kindLabel[chapter.diagram.kind]}
            </p>
            <h4 id={`dd-ch-${id}-${chapter.id}`}>{chapter.title}</h4>
            <p className="dd-hook">{rich(chapter.hook)}</p>
          </header>

          <div className={"dd-stage dd-k-" + chapter.diagram.kind}>
            <DiagramView d={chapter.diagram} active={cur?.key || ""} seen={seen} go={go} beat={beat} />
            <div className="dd-narrate">
              <div className="dd-controls">
                <button className="hl-icon" aria-label="Previous diagram step" onClick={() => step(-1)}>
                  <ChevronLeft size={15} />
                </button>
                <button className="dd-play" aria-label={playing ? "Pause animation" : "Play animation"} onClick={() => setPlaying(!playing)}>
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button className="hl-icon" aria-label="Next diagram step" onClick={() => step(1)}>
                  <ChevronRight size={15} />
                </button>
                <span className="dd-count">
                  {(beat % beats.length) + 1}/{beats.length}
                </span>
                <span className="dd-pips" aria-hidden="true">
                  {beats.map((b, i) => (
                    <i key={b.key + i} className={i === beat % beats.length ? "is-on" : i < beat % beats.length ? "is-seen" : ""} />
                  ))}
                </span>
              </div>
              {cur && (
                <p className={"dd-caption dd-t-" + (cur.tag || "core")} aria-live="polite">
                  <span className="dd-chip">
                    <i className="dd-dot" /> {cur.dir === "up" ? "returning" : tagLabel[cur.tag || "core"]}
                  </span>
                  <strong>{cur.t}.</strong> {rich(cur.s)}
                </p>
              )}
            </div>
          </div>

          <div className="dd-cols">
            <div className="dd-explain">
              {chapter.explain.map((para, i) => (
                <p key={i}>{rich(para)}</p>
              ))}
              <aside className="dd-soc">
                <strong>In a SOC</strong>
                <p>{rich(chapter.soc)}</p>
              </aside>
              {safeLink(chapter.url) && (
                <a className="hl-ext" href={safeLink(chapter.url)} target="_blank" rel="noreferrer">
                  Read this in the official docs <ArrowUpRight size={12} />
                </a>
              )}
            </div>
            <CodeView code={chapter.code} />
          </div>

          <footer className="dd-foot">
            <button className="hl-link" disabled={ch === 0} onClick={() => pickChapter(ch - 1)}>
              <ChevronLeft size={14} /> {ch > 0 ? dive.chapters[ch - 1].title : "Start"}
            </button>
            <button className="hl-link" disabled={ch === n - 1} onClick={() => pickChapter(ch + 1)}>
              {ch < n - 1 ? dive.chapters[ch + 1].title : "End"} <ChevronRight size={14} />
            </button>
          </footer>
        </article>
      </div>
      <p className="hl-fine">
        Written from {name}'s official docs and source, checked October 2026. Internals can change between releases;
        each chapter links to its docs page.
      </p>
    </section>
  );
}
