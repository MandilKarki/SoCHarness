import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { mechanisms, type Mechanism } from "../../lib/compare";
import { frameworks, frameworkById } from "../../lib/frameworks";
import { deepDives } from "../../lib/deep";
import { chapterHash } from "../../lib/deep/live";
import { FwIcon } from "./FrameworkArt";
import { CodeView, rich } from "./DeepDive";

const PATTERN_TONES = ["cyan", "purple", "amber", "green", "rose"] as const;

function mechanismFromHash(): string {
  const [tab, id] = window.location.hash.replace("#", "").split("/");
  return tab === "compare" && mechanisms.some((m) => m.id === id) ? id : mechanisms[0].id;
}

/** FLIP: tiles glide from their old pattern zone to the new one when the mechanism changes. */
function useFlip(key: string) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    nodes.current.forEach((el, id) => {
      const before = last.current.get(id);
      const r = el.getBoundingClientRect();
      const now = { x: r.left + window.scrollX, y: r.top + window.scrollY };
      if (before && !reduce && typeof el.animate === "function") {
        const dx = before.x - now.x,
          dy = before.y - now.y;
        if (Math.abs(dx) + Math.abs(dy) > 2)
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
            duration: 520,
            easing: "cubic-bezier(.2,.8,.2,1)",
          });
      }
      last.current.set(id, now);
    });
  }, [key]);
  return (id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };
}

export function CompareView({ hidden }: { hidden: boolean }) {
  const [mid, setMid] = useState(mechanismFromHash),
    [sel, setSel] = useState("openai");
  const m: Mechanism = mechanisms.find((x) => x.id === mid) || mechanisms[0];
  const flip = useFlip(m.id);
  const strip = useRef<HTMLElement>(null);
  // Keep the chosen mechanism visible in the horizontally scrolling strip on phones.
  useEffect(() => {
    const nav = strip.current,
      on = nav?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (nav && on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = on.offsetLeft - 16;
  }, [m.id, hidden]);
  const tone = useMemo(() => new Map(m.patterns.map((p, i) => [p.id, PATTERN_TONES[i % PATTERN_TONES.length]])), [m]);
  const entry = m.entries[sel];
  const fw = frameworkById[sel];
  const chapter = entry?.chapter ? deepDives[sel]?.chapters.find((c) => c.id === entry.chapter) : undefined;

  useEffect(() => {
    const on = () => {
      if (window.location.hash.startsWith("#compare")) setMid(mechanismFromHash());
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const pick = (id: string) => {
    setMid(id);
    try {
      window.history.replaceState(null, "", "#compare/" + id);
    } catch {
      /* ignore */
    }
  };
  // Rows grouped by pattern, in pattern order.
  const rows = m.patterns.flatMap((p) => frameworks.filter((f) => m.entries[f.id]?.pattern === p.id));

  return (
    <div className="cmp" hidden={hidden}>
      <header className="cmp-head">
        <p className="dd-eyebrow">Compare · one mechanism, every framework</p>
        <h2>How do eleven frameworks solve the same problem?</h2>
        <p className="hl-fine">
          Pick a mechanism. Frameworks gather under the design pattern they use, so you can see the real choices before
          you build your own. Select a framework for its API, code and the chapter that explains it.
        </p>
      </header>

      <nav className="cmp-mechs" aria-label="Mechanisms" ref={strip}>
        {mechanisms.map((x, i) => (
          <button key={x.id} aria-pressed={x.id === m.id} onClick={() => pick(x.id)}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {x.title}
          </button>
        ))}
      </nav>

      <section className="cmp-intro" key={m.id}>
        <h3>{m.title}</h3>
        <p className="cmp-q">{rich(m.question)}</p>
        <p>{rich(m.why)}</p>
      </section>

      <div className="cmp-zones" style={{ ["--n" as string]: m.patterns.length }} aria-label="Frameworks grouped by pattern">
        {m.patterns.map((p) => {
          const members = frameworks.filter((f) => m.entries[f.id]?.pattern === p.id);
          return (
            <section key={p.id} className={"cmp-zone cmp-" + tone.get(p.id)}>
              <header>
                <strong>{p.name}</strong>
                <em>{members.length}</em>
              </header>
              <p>{rich(p.say)}</p>
              <div className="cmp-tiles">
                {members.map((f) => (
                  <button
                    key={f.id}
                    ref={flip(f.id)}
                    className={"cmp-tile" + (sel === f.id ? " is-on" : "")}
                    style={{ ["--fw-src" as string]: f.accent }}
                    aria-pressed={sel === f.id}
                    onClick={() => setSel(f.id)}
                  >
                    <FwIcon glyph={f.glyph} size={20} />
                    <span>{f.name}</span>
                  </button>
                ))}
              </div>
              <p className="cmp-trade">
                <b>Trade-off.</b> {rich(p.tradeoff)}
              </p>
            </section>
          );
        })}
      </div>

      {entry && fw && (
        <section className="cmp-detail" style={{ ["--fw-src" as string]: fw.accent }} aria-live="polite">
          <header>
            <span className="cmp-detail-icon">
              <FwIcon glyph={fw.glyph} size={26} />
            </span>
            <div>
              <small className={"cmp-pill cmp-" + tone.get(entry.pattern)}>
                {m.patterns.find((p) => p.id === entry.pattern)?.name}
              </small>
              <h3>
                {fw.name} <code>{entry.api}</code>
              </h3>
            </div>
          </header>
          <div className="cmp-detail-body">
            <div>
              <p>{rich(entry.how)}</p>
              <dl className="cmp-dims">
                {m.dimensions.map((d, i) => (
                  <div key={d}>
                    <dt>{d}</dt>
                    <dd>{rich(entry.cells[i] || "—")}</dd>
                  </div>
                ))}
              </dl>
              <p className="cmp-links">
                {chapter && (
                  <a className="hl-link" href={chapterHash(sel, chapter.id)}>
                    Under the hood: {chapter.title} →
                  </a>
                )}
                <a className="hl-link" href={"#frameworks/" + sel}>
                  {fw.name} page <ArrowUpRight size={12} />
                </a>
              </p>
            </div>
            {entry.code && <CodeView code={{ lang: entry.lang || "python", src: entry.code }} />}
          </div>
        </section>
      )}

      <section className="cmp-table-wrap" aria-label={`${m.title}: all frameworks`}>
        <table className="cmp-table">
          <thead>
            <tr>
              <th scope="col">Framework</th>
              <th scope="col">Pattern</th>
              {m.dimensions.map((d) => (
                <th key={d} scope="col">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const e = m.entries[f.id];
              return (
                <tr key={f.id} className={sel === f.id ? "is-on" : ""} onClick={() => setSel(f.id)}>
                  <th scope="row" style={{ ["--fw-src" as string]: f.accent }}>
                    <button className="cmp-row-btn" onClick={() => setSel(f.id)} aria-pressed={sel === f.id}>
                      <i className="cmp-dot" /> {f.name}
                    </button>
                  </th>
                  <td>
                    <span className={"cmp-pill cmp-" + tone.get(e.pattern)}>
                      {m.patterns.find((p) => p.id === e.pattern)?.name}
                    </span>
                  </td>
                  {m.dimensions.map((d, i) => (
                    <td key={d}>{rich(e.cells[i] || "—")}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <aside className="cmp-choose">
        <strong>For your own SOC agent platform</strong>
        <ul>
          {m.choose.map((c) => (
            <li key={c}>{rich(c)}</li>
          ))}
        </ul>
      </aside>
      <p className="hl-fine">
        Compiled from each framework's official docs and the deep-dive chapters, October 2026. Where a framework has no
        built-in mechanism, the table says so rather than stretching an API to fit.
      </p>
    </div>
  );
}
