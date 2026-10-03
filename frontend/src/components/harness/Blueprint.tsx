import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Pause, Play, X } from "lucide-react";
import {
  blueprintFor,
  fitLabel,
  layerOrder,
  layers,
  socFlow,
  spillRole,
  type Component,
  type Fit,
  type LayerId,
} from "../../lib/blueprint";
import { safeLink } from "../../lib/api";

/** What Relay itself supplies when a framework documents nothing for a layer. */
const relaySupplies: Record<LayerId, string> = {
  interface: "Relay's analyst workspace and NDJSON streaming API",
  orchestration: "Relay's engine and runtime registry",
  agent: "Relay's per-session configuration and findings schema",
  tools: "Relay's case-scoped tool gateway",
  state: "Relay's SQLite sessions, messages and native-state store",
  governance: "Relay's policy gateway, exact-argument approvals and spending guard",
  runtime: "Relay's isolated worker processes (not OS sandboxes) and Fly deployment",
  observe: "Relay's event ledger, exports and offline contract tests",
};
/** The path a request takes through the reference architecture. */
const requestPath: LayerId[] = ["interface", "orchestration", "agent", "tools", "governance", "state", "runtime", "observe"];

function useReduced() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches
    : false;
}

export function Blueprint({ id, name }: { id: string; name: string }) {
  const { bp, total } = useMemo(() => blueprintFor(id), [id]);
  const reduced = useReduced();
  const [mode, setMode] = useState<"ref" | "soc">("ref"),
    [beat, setBeat] = useState(0),
    [playing, setPlaying] = useState(!reduced),
    [open, setOpen] = useState<{ layer: LayerId; section: string } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOpen(null);
    setBeat(0);
  }, [id, mode]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setBeat((b) => b + 1), 2000);
    return () => clearInterval(t);
  }, [playing]);
  const soc = mode === "soc";
  const stage = socFlow[beat % socFlow.length];
  const pathLayer = requestPath[beat % requestPath.length];
  const lit = (l: LayerId) => (soc ? stage.layers.includes(l) : l === pathLayer);
  const count = (l: LayerId) => bp[l].reduce((n, c) => n + c.items.length, 0);
  const allItems = layerOrder.flatMap((l) => bp[l].flatMap((c) => c.items));
  const fits = (["core", "useful", "situational", "avoid"] as Fit[]).map((f) => [f, allItems.filter((p) => p.fit === f).length] as const);
  const relayN = allItems.filter((p) => p.item.r).length;
  const selected: Component | undefined = open ? bp[open.layer].find((c) => c.section === open.section) : undefined;

  const pick = (layer: LayerId, section: string) => {
    setOpen({ layer, section });
    setPlaying(false);
    setTimeout(() => detailRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }), 30);
  };

  return (
    <section className={"fw-block bp" + (soc ? " bp-soc" : "")} id={`fw-blueprint-${id}`} aria-labelledby={`bp-title-${id}`}>
      <header className="bp-head">
        <div>
          <h3 id={`bp-title-${id}`}>{soc ? "SOC platform blueprint" : "Reference architecture blueprint"}</h3>
          <p className="hl-fine">
            {soc
              ? `All ${total} documented ${name} capabilities, cast as a security-operations platform. Each part shows how a SOC would use it and how well it fits.`
              : `All ${total} documented ${name} capabilities placed in an end-to-end agent system. Select any component to see every class, function and technique in it.`}
          </p>
        </div>
        <div className="bp-controls">
          <div className="bp-toggle" role="tablist" aria-label="Blueprint version">
            <button role="tab" aria-selected={!soc} onClick={() => setMode("ref")}>
              Reference
            </button>
            <button role="tab" aria-selected={soc} onClick={() => setMode("soc")}>
              SOC use case
            </button>
          </div>
          <button className="bp-play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause flow" : "Play flow"}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
        </div>
      </header>

      <div className="bp-summary">
        <div className="bp-bar" role="img" aria-label={layerOrder.map((l) => `${(soc ? layers[l].soc : layers[l].ref)}: ${count(l)}`).join(", ")}>
          {layerOrder.map((l) =>
            count(l) ? <i key={l} className={"bp-c-" + l} style={{ flexGrow: count(l) }} title={`${soc ? layers[l].soc : layers[l].ref}: ${count(l)}`} /> : null,
          )}
        </div>
        <div className="bp-stats">
          <span><strong>{total}</strong> capabilities</span>
          <span><strong>{layerOrder.filter((l) => count(l)).length}</strong> of 8 layers covered</span>
          <span><strong>{relayN}</strong> used by Relay today</span>
          {soc &&
            fits.map(([f, n]) => (
              <span key={f} className={"bp-fit-stat bp-fit-" + f}>
                <i /> <strong>{n}</strong> {fitLabel[f].toLowerCase()}
              </span>
            ))}
        </div>
      </div>

      {soc && (
        <ol className="bp-flow" aria-label="SOC end-to-end flow">
          {socFlow.map((s, i) => (
            <li key={s.stage} className={i === beat % socFlow.length ? "is-on" : ""}>
              <button
                onClick={() => {
                  setPlaying(false);
                  setBeat(i);
                }}
              >
                <span className="bp-flow-n">{i + 1}</span>
                <strong>{s.stage}</strong>
                <small>{s.say}</small>
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="bp-grid">
        {layerOrder.map((l) => {
          const comps = bp[l];
          const L = layers[l];
          return (
            <div key={l} className={`bp-layer bp-l-${l}` + (lit(l) ? " is-lit" : "") + (comps.length ? "" : " is-empty")}>
              {["orchestration", "agent", "tools", "runtime", "observe"].includes(l) && (
                <i className="bp-wire bp-wire-top" aria-hidden="true"><b /></i>
              )}
              {["orchestration", "agent", "tools"].includes(l) && (
                <>
                  <i className="bp-wire bp-wire-left" aria-hidden="true"><b /></i>
                  <i className="bp-wire bp-wire-right" aria-hidden="true"><b /></i>
                </>
              )}
              <header>
                <span className="bp-dot" />
                <strong>{soc ? L.soc : L.ref}</strong>
                <em>{count(l)}</em>
              </header>
              <p className="bp-say">{soc ? L.socSay : L.refSay}</p>
              {comps.length ? (
                <div className="bp-comps">
                  {comps.map((c) => {
                    const relay = c.items.filter((p) => p.item.r).length;
                    const on = open?.layer === l && open.section === c.section;
                    return (
                      <button
                        key={c.section}
                        className={"bp-comp" + (on ? " is-on" : "") + (soc ? " bp-fit-" + c.fit : "")}
                        aria-pressed={on}
                        onClick={() => pick(l, c.section)}
                      >
                        <span className="bp-comp-head">
                          <strong>{c.section}</strong>
                          <small>
                            {c.items.length}
                            {relay ? ` · ${relay} in Relay` : ""}
                          </small>
                        </span>
                        {soc && (
                          <span className="bp-comp-soc">
                            <i className={"bp-pill bp-fit-" + c.fit}>{c.fit}</i> {c.home ? c.soc : spillRole[l]}
                          </span>
                        )}
                        <span className="bp-chips">
                          {c.items.slice(0, soc ? 4 : 7).map((p) => (
                            <code key={p.item.n} className={p.item.r ? "is-relay" : ""}>
                              {p.item.n.length > 34 ? p.item.n.slice(0, 32) + "…" : p.item.n}
                            </code>
                          ))}
                          {c.items.length > (soc ? 4 : 7) && <code className="bp-more">+{c.items.length - (soc ? 4 : 7)} more</code>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="bp-empty">
                  {name} documents nothing here, so you supply it. In Relay: {relaySupplies[l]}.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="bp-caption" aria-live="polite">
        {soc ? (
          <>
            <strong>{stage.stage}.</strong> {stage.say} — carried by{" "}
            {stage.layers.map((l) => layers[l].soc).join(" and ")}.
          </>
        ) : (
          <>
            <strong>{layers[pathLayer].ref}.</strong> {layers[pathLayer].refSay}
          </>
        )}
      </p>

      {selected && open && (
        <div className={"bp-detail bp-l-" + open.layer} ref={detailRef} aria-live="polite">
          <header>
            <div>
              <small>{soc ? layers[open.layer].soc : layers[open.layer].ref}</small>
              <h4>{selected.section}</h4>
            </div>
            <span>
              {safeLink(selected.url) && (
                <a className="hl-ext" href={safeLink(selected.url)} target="_blank" rel="noreferrer">
                  Official docs <ArrowUpRight size={12} />
                </a>
              )}
              <button className="hl-icon" aria-label="Close details" onClick={() => setOpen(null)}>
                <X size={15} />
              </button>
            </span>
          </header>
          <p className="bp-detail-soc">
            <i className={"bp-pill bp-fit-" + selected.fit}>{fitLabel[selected.fit]}</i> {selected.soc}
            {!selected.home && <span className="bp-spill"> {spillRole[open.layer]}</span>}
          </p>
          <ul>
            {selected.items.map((p) => (
              <li key={p.item.n} className={p.item.r ? "is-relay" : ""}>
                <code>{p.item.n}</code>
                <span className={"fw-kind fw-kind-" + p.item.k}>{p.item.k}</span>
                {p.item.r && <span className="fw-relay">{p.item.r === "wired" ? "used by Relay" : "partly used"}</span>}
                {soc && p.fit !== selected.fit && <i className={"bp-pill bp-fit-" + p.fit}>{fitLabel[p.fit]}</i>}
                <p>{p.item.d}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="hl-fine">
        Placement and SOC fit are design judgements drawn from the official docs, not vendor claims. "Avoid unless
        isolated" marks host-level tools (shell, browser, computer use, plugins) that need a sandbox before a SOC should
        enable them.
      </p>
    </section>
  );
}
