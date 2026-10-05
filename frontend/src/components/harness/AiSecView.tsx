import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Search, Star } from "lucide-react";
import { api, errorText, safeLink } from "../../lib/api";
import { InventoryView } from "./InventoryView";
import { IntelView } from "./IntelView";
import {
  BUILT,
  FRAMEWORK_LABEL,
  PLATFORMS,
  SUBVIEWS,
  type Catalog,
  type Framework,
  type Inventory,
  type SubView,
  type TechniqueDetail,
  type TechniqueRecord,
  type Tracked,
  type Workspaces,
} from "../../lib/aisec";

type Lens = Framework;
const WS_KEY = "relay-aisec-workspace";
const ATLAS_SITE = "https://atlas.mitre.org";

function readWs(): string {
  try {
    return localStorage.getItem(WS_KEY) || "socharness";
  } catch {
    return "socharness";
  }
}
function saveWs(id: string) {
  try {
    localStorage.setItem(WS_KEY, id);
  } catch {
    /* per-viewer convenience only */
  }
}

function parseHash(): { sub: SubView; id: string | null } {
  const [tab, sub, ...more] = window.location.hash.replace("#", "").split("/");
  if (tab !== "aisec") return { sub: "threats", id: null };
  const s = (SUBVIEWS.some((v) => v.id === sub) ? sub : "threats") as SubView;
  const id = more.map((m) => decodeURIComponent(m)).join("/");
  return { sub: s, id: (s === "threats" || s === "inventory" || s === "intel") && id ? id : null };
}
function go(sub: SubView, id?: string | null) {
  const h = "#aisec/" + sub + (id ? "/" + id.split("/").map(encodeURIComponent).join("/") : "");
  if (window.location.hash !== h) window.location.hash = h;
}

const lensOf = (id: string): Lens => (id.startsWith("LLM") ? "owasp-llm" : id.startsWith("ASI") ? "owasp-agentic" : "atlas");

/** ATLAS descriptions are Markdown with site-relative links; internal technique links open in the lab. */
function inline(text: string, open: (id: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0,
    m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, label, href] = m;
    const tech = href.match(/^\/techniques\/(AML\.T[\d.]+)$/);
    if (tech) {
      const id = tech[1];
      out.push(
        <button key={m.index} type="button" className="as-inlink" onClick={() => open(id)}>
          {label}
        </button>,
      );
    } else {
      const url = safeLink(href.startsWith("/") ? ATLAS_SITE + href : href);
      out.push(
        url ? (
          <a key={m.index} href={url} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function AtlasText({ text, open }: { text: string; open: (id: string) => void }) {
  return (
    <div className="as-prose">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""), open)}</li>
              ))}
            </ul>
          );
        return <p key={i}>{inline(lines.join(" "), open)}</p>;
      })}
    </div>
  );
}

/** The 16 ATLAS tactics in matrix order, with the ones a technique reaches lit in sequence. */
function TacticStrip({ tactics, lit, names, compact }: { tactics: Catalog["tactics"]; lit: string[]; names?: boolean; compact?: boolean }) {
  let n = 0;
  return (
    <ol className={"as-strip" + (compact ? " is-compact" : "")} aria-label={`Reaches ${lit.length} of ${tactics.length} ATLAS tactics`}>
      {tactics.map((t, i) => {
        const on = lit.includes(t.id);
        return (
          <li key={t.id} className={on ? "is-on" : ""} style={{ ["--i" as string]: i, ["--n" as string]: on ? n++ : 0 }} title={t.name}>
            {names && <span>{t.name}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Badge({ id }: { id: string }) {
  return <i className={"as-b as-b-" + (id.startsWith("LLM") ? "llm" : "asi")}>{id}</i>;
}

function Tile({
  t,
  onOpen,
  tracked,
  state,
  style,
}: {
  t: TechniqueRecord;
  onOpen: (id: string) => void;
  tracked: boolean;
  state: "" | "is-hit" | "is-dim";
  style?: Record<string, string | number>;
}) {
  return (
    <button type="button" className={"as-tile as-m-" + (t.maturity || "none").toLowerCase() + " " + state} style={style} onClick={() => onOpen(t.id)}>
      <span className="as-tile-name">{t.name}</span>
      <span className="as-tile-meta">
        <code>{t.id}</code>
        {!!t.subtechniques.length && <em>{t.subtechniques.length} sub</em>}
        {tracked && <Star size={12} className="as-star" />}
      </span>
      {!!t.refs.length && (
        <span className="as-badges">
          {t.refs.slice(0, 2).map((r) => (
            <Badge key={r} id={r} />
          ))}
          {t.refs.length > 2 && <i className="as-b">+{t.refs.length - 2}</i>}
        </span>
      )}
    </button>
  );
}

function ThreatMap({
  cat,
  open,
  tracked,
  query,
  platforms,
  trackedOnly,
  highlight,
}: {
  cat: Catalog;
  open: (id: string) => void;
  tracked: Set<string>;
  query: string;
  platforms: string[];
  trackedOnly: boolean;
  highlight: string;
}) {
  const subName = useMemo(() => new Map(cat.techniques.map((t) => [t.id, t.name.toLowerCase()])), [cat]);
  const hit = useMemo(() => {
    const item = cat.owasp.flatMap((l) => l.items).find((i) => i.id === highlight);
    return new Set(item ? item.refs.map((r) => r.split(".").slice(0, 2).join(".")) : []);
  }, [cat, highlight]);
  const q = query.trim().toLowerCase();
  const show = (t: TechniqueRecord) =>
    (!platforms.length || t.platforms.some((p) => platforms.includes(p))) &&
    (!trackedOnly || tracked.has(t.id) || t.subtechniques.some((s) => tracked.has(s))) &&
    (!q ||
      t.name.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.summary.toLowerCase().includes(q) ||
      t.subtechniques.some((s) => (subName.get(s) || "").includes(q) || s.toLowerCase().includes(q)));
  const top = cat.techniques.filter((t) => !t.parent);
  const cols = cat.tactics.map((tac) => ({ tac, items: top.filter((t) => t.tactics.includes(tac.id) && show(t)).sort((a, b) => a.name.localeCompare(b.name)) }));
  const total = new Set(cols.flatMap((c) => c.items.map((t) => t.id))).size;
  return (
    <>
      <p className="as-count" aria-live="polite">
        {total} of {top.length} techniques{highlight && ` · ${hit.size} linked to ${highlight}`}
        <span className="as-swipe"> · swipe sideways for all {cols.length} tactics</span>
      </p>
      <div className="as-matrix-wrap" tabIndex={0} aria-label="ATLAS matrix, scroll sideways for all 16 tactics">
        <div className="as-matrix" style={{ ["--cols" as string]: cols.length }}>
          {cols.map(({ tac, items }, c) => (
            <section key={tac.id} className="as-col" aria-label={tac.name}>
              <header title={tac.summary}>
                <strong>{tac.name}</strong>
                <small>
                  {tac.id} · {items.length}
                </small>
              </header>
              {items.map((t, r) => (
                <Tile
                  key={t.id}
                  t={t}
                  onOpen={open}
                  tracked={tracked.has(t.id)}
                  state={highlight ? (hit.has(t.id) ? "is-hit" : "is-dim") : ""}
                  style={{ ["--c" as string]: c, ["--r" as string]: Math.min(r, 12) }}
                />
              ))}
              {!items.length && <p className="as-empty">None match</p>}
            </section>
          ))}
        </div>
      </div>
      <p className="as-legend">
        <span className="as-m-realized">Realized</span> seen in the wild · <span className="as-m-demonstrated">Demonstrated</span> shown by
        researchers · <span className="as-m-feasible">Feasible</span> plausible, not yet shown. Badges are OWASP risks linked by the
        SoCHarness crosswalk.
      </p>
    </>
  );
}

function OwaspBoard({ cat, lens, open, tracked }: { cat: Catalog; lens: Lens; open: (id: string) => void; tracked: Set<string> }) {
  const list = cat.owasp.find((l) => l.id === lens);
  const byId = useMemo(() => new Map(cat.techniques.map((t) => [t.id, t])), [cat]);
  if (!list) return null;
  return (
    <>
      <p className="as-count">
        {list.name} · {list.edition} edition · {list.license}{" "}
        {safeLink(list.url) && (
          <a href={safeLink(list.url)} target="_blank" rel="noreferrer">
            official list <ArrowUpRight size={11} />
          </a>
        )}
      </p>
      <div className="as-owasp">
        {list.items.map((item, i) => {
          const lit = [...new Set(item.refs.flatMap((r) => byId.get(r)?.tactics || []))];
          return (
            <button key={item.id} type="button" className="as-risk" style={{ ["--i" as string]: i }} onClick={() => open(item.id)}>
              <span className="as-risk-id">
                {item.id}
                {tracked.has(item.id) && <Star size={13} className="as-star" />}
              </span>
              <strong>{item.name}</strong>
              <span className="as-risk-sum">{item.summary}</span>
              <TacticStrip tactics={cat.tactics} lit={lit} compact />
              <small>
                {item.refs.length
                  ? `${item.refs.length} ATLAS technique${item.refs.length > 1 ? "s" : ""} across ${lit.length} tactic${lit.length === 1 ? "" : "s"}`
                  : "No direct ATLAS technique yet"}
              </small>
            </button>
          );
        })}
      </div>
      <p className="hl-fine">{cat.crosswalk_note}</p>
    </>
  );
}

function DetailView({
  id,
  cat,
  open,
  back,
  tracked,
  note,
  canTrack,
  onTrack,
  inModels,
  wsName,
}: {
  inModels?: string[];
  wsName?: string;
  id: string;
  cat: Catalog;
  open: (id: string) => void;
  back: () => void;
  tracked: boolean;
  note: string;
  canTrack: boolean;
  onTrack: (tracked: boolean, note?: string) => Promise<void>;
}) {
  const [d, setD] = useState<TechniqueDetail | null>(null),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(note),
    [busy, setBusy] = useState(false);
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    setD(null);
    setError("");
    api<TechniqueDetail>("/api/aisec/technique?id=" + encodeURIComponent(id))
      .then((x) => alive && setD(x))
      .catch((e) => alive && setError(errorText(e)));
    top.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => setDraft(note), [note, id]);
  const track = async (on: boolean, n?: string) => {
    setBusy(true);
    try {
      await onTrack(on, n);
    } finally {
      setBusy(false);
    }
  };
  const subs = (d?.subtechniques || []) as { id: string; name: string }[];
  const lit = d ? (d.framework === "atlas" ? d.tactics : [...new Set((d.atlas || []).flatMap((t) => t.tactics))]) : [];
  return (
    <article className="as-detail" ref={top} aria-busy={!d && !error}>
      <nav className="as-crumbs">
        <button type="button" className="hl-secondary hl-small" onClick={back}>
          <ArrowLeft size={14} /> Threat map
        </button>
        {d?.parent && (
          <button type="button" className="as-inlink" onClick={() => open(d.parent!)}>
            {d.parent_name}
          </button>
        )}
      </nav>
      {error && <p className="as-error">{error}</p>}
      {!d && !error && <p className="pg-empty">Loading {id}…</p>}
      {d && (
        <>
          <header className="as-detail-head">
            <div>
              <small className="pg-kind">
                {FRAMEWORK_LABEL[d.framework]} · {d.kind === "risk" ? "risk" : d.kind}
              </small>
              <h3>{d.name}</h3>
              <p className="as-tags">
                <code>{d.id}</code>
                {d.maturity && <span className={"as-mat as-m-" + d.maturity.toLowerCase()}>{d.maturity}</span>}
                {d.platforms.map((p) => (
                  <span key={p} className="as-plat">
                    {p}
                  </span>
                ))}
                {d.modified && <span className="as-dim">updated {d.modified}</span>}
              </p>
            </div>
            <div className="as-track">
              <button
                type="button"
                className={tracked ? "hl-secondary hl-small is-on" : "hl-primary hl-small"}
                disabled={!canTrack || busy}
                aria-pressed={tracked}
                onClick={() => track(!tracked, draft)}
                title={canTrack ? "" : "This role cannot track techniques"}
              >
                <Star size={14} /> {tracked ? "Tracked" : "Track for this workspace"}
              </button>
            </div>
          </header>
          {tracked && canTrack && (
            <form
              className="as-note"
              onSubmit={(e) => {
                e.preventDefault();
                void track(true, draft);
              }}
            >
              <label>
                <span>Why it matters here</span>
                <textarea value={draft} maxLength={2000} rows={2} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. our support assistant reads customer emails" />
              </label>
              <button className="hl-secondary hl-small" disabled={busy || draft === note}>
                Save note
              </button>
            </form>
          )}
          <p className="as-lead">{d.summary}</p>
          {!!inModels?.length && (
            <p className="as-inmodel">
              Accepted in {wsName}'s threat model{inModels.length > 1 ? "s" : ""} for <b>{inModels.join(", ")}</b>.
            </p>
          )}
          <section className="as-sec as-where">
            <h4>Where it lands in ATLAS</h4>
            <TacticStrip tactics={cat.tactics} lit={lit} names />
          </section>
          {d.framework === "atlas" && d.description && (
            <section className="as-sec">
              <h4>Description</h4>
              <AtlasText text={d.description} open={open} />
            </section>
          )}
          {d.framework !== "atlas" && (
            <section className="as-sec">
              <h4>Linked ATLAS techniques</h4>
              {d.atlas?.length ? (
                <div className="as-grid">
                  {d.atlas.map((t) => (
                    <Tile key={t.id} t={t} onOpen={open} tracked={false} state="" />
                  ))}
                </div>
              ) : (
                <p className="as-dim">No ATLAS technique maps directly to this risk yet; it shows up as a consequence of others.</p>
              )}
              <p className="hl-fine">{d.crosswalk_note}</p>
            </section>
          )}
          {!!subs.length && (
            <section className="as-sec">
              <h4>Sub-techniques</h4>
              <ul className="as-chips">
                {subs.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => open(s.id)}>
                      <code>{s.id}</code> {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!d.owasp?.length && (
            <section className="as-sec">
              <h4>OWASP risks</h4>
              <ul className="as-chips">
                {d.owasp.map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => open(o.id)}>
                      <Badge id={o.id} /> {o.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!d.mitigations?.length && (
            <section className="as-sec">
              <h4>Mitigations · {d.mitigations.length}</h4>
              <ul className="as-cards">
                {d.mitigations.map((m, i) => (
                  <li key={m.id} style={{ ["--i" as string]: i }}>
                    <strong>
                      {safeLink(m.url) ? (
                        <a href={safeLink(m.url)} target="_blank" rel="noreferrer">
                          {m.name} <ArrowUpRight size={11} />
                        </a>
                      ) : (
                        m.name
                      )}
                    </strong>
                    <code>{m.id}</code>
                    {m.how && <span>{m.how}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!d.case_studies?.length && (
            <section className="as-sec">
              <h4>Case studies · {d.case_studies.length}</h4>
              <ul className="as-cases">
                {d.case_studies.map((c) => (
                  <li key={c.id}>
                    <details>
                      <summary>
                        <strong>{c.name}</strong>
                        <small>
                          {c.type} · {c.date.slice(0, 4)}
                        </small>
                      </summary>
                      <p>{c.summary}</p>
                      {safeLink(c.url) && (
                        <a href={safeLink(c.url)} target="_blank" rel="noreferrer">
                          {c.id} on ATLAS <ArrowUpRight size={11} />
                        </a>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!d.references?.length && (
            <section className="as-sec">
              <h4>References</h4>
              <ul className="as-refs">
                {d.references.map((r) =>
                  safeLink(r.url) ? (
                    <li key={r.url}>
                      <a href={safeLink(r.url)} target="_blank" rel="noreferrer">
                        {r.title || r.url} <ArrowUpRight size={11} />
                      </a>
                    </li>
                  ) : null,
                )}
              </ul>
            </section>
          )}
          <section className="as-sec as-sources">
            <h4>Sources</h4>
            <ul className="as-refs">
              {d.sources.map((s) =>
                safeLink(s.url) ? (
                  <li key={s.url}>
                    <a href={safeLink(s.url)} target="_blank" rel="noreferrer">
                      {s.label} <ArrowUpRight size={11} />
                    </a>
                  </li>
                ) : null,
              )}
            </ul>
            {d.license && <p className="hl-fine">Licence of the source list: {d.license}.</p>}
          </section>
        </>
      )}
    </article>
  );
}

function PhaseCard({ v, onHash }: { v: (typeof SUBVIEWS)[number]; onHash: (h: string) => void }) {
  return (
    <section className="as-phase" aria-label={`${v.label}, planned for phase ${v.phase}`}>
      <p className="dd-eyebrow">Phase {v.phase} · not built yet</p>
      <h3>{v.label}</h3>
      <p>{v.what}</p>
      <p className="as-gate">
        <b>Gate</b> {v.gate}
      </p>
      {v.today && (
        <button type="button" className="hl-secondary hl-small" onClick={() => onHash(v.today!.hash)}>
          Today: {v.today.label} <ArrowUpRight size={12} />
        </button>
      )}
    </section>
  );
}

function RolesPanel({
  cat,
  ws,
  wsId,
  onChanged,
}: {
  cat: Catalog;
  ws: Workspaces;
  wsId: string;
  onChanged: (w: Workspaces) => void;
}) {
  const w = ws.workspaces.find((x) => x.id === wsId);
  const [member, setMember] = useState(""),
    [role, setRole] = useState("app_owner"),
    [error, setError] = useState("");
  const set = async (m: string, r: string | null) => {
    setError("");
    try {
      await api("/api/aisec/members", { workspace: wsId, member: m, role: r });
      onChanged(await api<Workspaces>("/api/aisec/workspaces"));
      if (r && m === member) setMember("");
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (!w) return null;
  const roles = Object.entries(cat.roles);
  return (
    <section className="as-roles" aria-label="Roles in this workspace">
      <div className="as-members">
        <h4>People in {w.name}</h4>
        <ul>
          {w.members.map((m) => (
            <li key={m.member}>
              <span>{m.member === ws.operator ? "You (signed-in operator)" : m.member}</span>
              {m.member === ws.operator ? (
                <em>{cat.roles[m.role]?.label}</em>
              ) : (
                <>
                  <select aria-label={`Role for ${m.member}`} value={m.role} onChange={(e) => void set(m.member, e.target.value)}>
                    {roles.map(([id, r]) => (
                      <option key={id} value={id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="hl-secondary hl-small" onClick={() => void set(m.member, null)}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="as-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (member.trim()) void set(member.trim(), role);
          }}
        >
          <input aria-label="Person (name or email)" placeholder="Name or email" value={member} maxLength={120} onChange={(e) => setMember(e.target.value)} />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map(([id, r]) => (
              <option key={id} value={id}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="hl-secondary hl-small" disabled={!member.trim()}>
            Add
          </button>
        </form>
        {error && <p className="as-error">{error}</p>}
        <p className="hl-fine">{ws.enforcement}</p>
      </div>
      <div className="as-matrix-roles">
        <table>
          <thead>
            <tr>
              <th scope="col">Can…</th>
              {roles.map(([id, r]) => (
                <th key={id} scope="col" title={r.summary}>
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(cat.actions).map(([a, info]) => (
              <tr key={a}>
                <th scope="row">
                  {info.label}
                  <small>{info.phase ? `phase ${info.phase}` : "now"}</small>
                </th>
                {roles.map(([id, r]) => (
                  <td key={id} className={r.can.includes(a) ? "is-yes" : ""}>
                    {r.can.includes(a) ? "✓" : "·"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AiSecView({ hidden }: { hidden: boolean }) {
  const [route, setRoute] = useState(parseHash),
    [cat, setCat] = useState<Catalog | null>(null),
    [ws, setWs] = useState<Workspaces | null>(null),
    [wsId, setWsIdState] = useState(readWs),
    [tracked, setTracked] = useState<Tracked | null>(null),
    [lens, setLens] = useState<Lens>("atlas"),
    [query, setQuery] = useState(""),
    [platforms, setPlatforms] = useState<string[]>([]),
    [trackedOnly, setTrackedOnly] = useState(false),
    [highlight, setHighlight] = useState(""),
    [panel, setPanel] = useState<"" | "new" | "roles">(""),
    [viewAs, setViewAs] = useState(""),
    [inModels, setInModels] = useState<Record<string, string[]>>({}),
    [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", kind: "company", sector: "" });

  useEffect(() => {
    if (!hidden) setRoute(parseHash());
  }, [hidden]);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    if (hidden || cat) return;
    Promise.all([api<Catalog>("/api/aisec"), api<Workspaces>("/api/aisec/workspaces")])
      .then(([c, w]) => {
        setCat(c);
        setWs(w);
        if (!w.workspaces.some((x) => x.id === wsId)) setWsId(w.workspaces[0]?.id || "socharness");
      })
      .catch((e) => setError(errorText(e)));
  }, [hidden]);
  useEffect(() => {
    if (!ws || !ws.workspaces.some((x) => x.id === wsId)) return;
    api<Tracked>("/api/aisec/tracked?workspace=" + encodeURIComponent(wsId))
      .then(setTracked)
      .catch((e) => setError(errorText(e)));
  }, [wsId, ws]);
  useEffect(() => {
    if (!ws || !ws.workspaces.some((x) => x.id === wsId)) return;
    api<Inventory>("/api/aisec/inventory?workspace=" + encodeURIComponent(wsId))
      .then((i) => setInModels(i.in_models || {}))
      .catch(() => setInModels({}));
  }, [wsId, ws]);
  useEffect(() => {
    if (route.id && route.sub === "threats") setLens(lensOf(route.id) === "atlas" ? lens : lensOf(route.id));
  }, [route.id]);

  const setWsId = (id: string) => {
    setWsIdState(id);
    saveWs(id);
  };
  const trackedSet = useMemo(() => new Set((tracked?.tracked || []).map((t) => t.id)), [tracked]);
  const w = ws?.workspaces.find((x) => x.id === wsId);
  const role = viewAs || w?.you || "lead_researcher";
  const can = (action: string) => !!cat?.roles[role]?.can.includes(action);
  const sub = SUBVIEWS.find((v) => v.id === route.sub) || SUBVIEWS[0];
  const open = (id: string) => go("threats", id);

  const track = async (on: boolean, note?: string) => {
    if (!route.id) return;
    try {
      setTracked(await api<Tracked>("/api/aisec/track", { workspace: wsId, technique: route.id, tracked: on, note: note || "" }));
      setWs(await api<Workspaces>("/api/aisec/workspaces"));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const create = async () => {
    setError("");
    try {
      const made = await api<{ id: string }>("/api/aisec/workspaces", { name: form.name, kind: form.kind, sector: form.sector || null });
      setWs(await api<Workspaces>("/api/aisec/workspaces"));
      setWsId(made.id);
      setForm({ name: "", kind: "company", sector: "" });
      setPanel("roles");
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="as" hidden={hidden}>
      <header className="cmp-head">
        <p className="dd-eyebrow">AI Security Lab · {BUILT + 1} of 8 phases live</p>
        <h2>Know the attack surface of AI</h2>
        <p className="hl-fine">
          The threat research workbench for AI and agent systems. Inventory records what each workspace defends (an AI bill of materials, the
          company profile, and every application's attack surface and threat model). Threats is the shared vocabulary: MITRE ATLAS and the two
          OWASP Top 10 lists, crosswalked. The attack range, defences, assessments, vendors and reports follow in later phases.
        </p>
      </header>

      {error && (
        <p className="as-error" role="alert">
          {error}
        </p>
      )}

      {ws && cat && (
        <div className="as-ws">
          <label className="pg-select">
            <span>Workspace</span>
            <select value={wsId} onChange={(e) => setWsId(e.target.value)}>
              {ws.workspaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {w && (
            <p className="as-ws-meta">
              {cat.kinds[w.kind] || w.kind}
              {w.sector && ` · ${cat.sectors[w.sector] || w.sector}`} · {trackedSet.size} tracked · {w.members.length}{" "}
              {w.members.length === 1 ? "person" : "people"}
            </p>
          )}
          <label className="pg-select as-viewas">
            <span>View as</span>
            <select value={viewAs} onChange={(e) => setViewAs(e.target.value)}>
              <option value="">You ({cat.roles[w?.you || "lead_researcher"]?.label})</option>
              {Object.entries(cat.roles)
                .filter(([id]) => id !== (w?.you || "lead_researcher"))
                .map(([id, r]) => (
                  <option key={id} value={id}>
                    {r.label} (preview)
                  </option>
                ))}
            </select>
          </label>
          <span className="as-ws-actions">
            <button type="button" className="hl-secondary hl-small" aria-expanded={panel === "new"} onClick={() => setPanel(panel === "new" ? "" : "new")} disabled={!can("manage_workspace")}>
              New workspace
            </button>
            <button type="button" className="hl-secondary hl-small" aria-expanded={panel === "roles"} onClick={() => setPanel(panel === "roles" ? "" : "roles")}>
              Roles
            </button>
          </span>
        </div>
      )}
      {viewAs && cat && (
        <p className="as-preview" role="status">
          Previewing as <b>{cat.roles[viewAs]?.label}</b>: {cat.roles[viewAs]?.summary} Nothing changes for anyone else.
        </p>
      )}
      {panel === "new" && cat && (
        <form
          className="as-new"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label>
            <span>Name</span>
            <input value={form.name} maxLength={80} required placeholder="e.g. Acme Bank" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            <span>Kind</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(cat.kinds)
                .filter(([k]) => k !== "lab")
                .map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Sector</span>
            <select value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>
              <option value="">Not set</option>
              {Object.entries(cat.sectors).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="hl-primary hl-small" disabled={!form.name.trim()}>
            Create
          </button>
          <p className="hl-fine">Each workspace keeps its own tracked techniques now, and its own inventory, findings and reports in later phases.</p>
        </form>
      )}
      {panel === "roles" && cat && ws && <RolesPanel cat={cat} ws={ws} wsId={wsId} onChanged={setWs} />}

      <nav className="as-subnav" aria-label="Lab workbenches">
        {SUBVIEWS.map((v, i) => (
          <button
            key={v.id}
            type="button"
            className={(v.id === sub.id ? "is-on " : "") + (v.phase > BUILT ? "is-later" : "")}
            aria-current={v.id === sub.id ? "page" : undefined}
            onClick={() => go(v.id)}
            style={{ ["--i" as string]: i }}
          >
            <span>{v.label}</span>
            <small>{v.phase > BUILT ? `Phase ${v.phase}` : "Live"}</small>
            {cat && !v.needs.some(can) && <em>hidden for this role</em>}
          </button>
        ))}
      </nav>

      {!cat && !error && <p className="pg-empty">Loading the threat taxonomies…</p>}
      {cat && sub.phase > BUILT && <PhaseCard v={sub} onHash={(h) => (window.location.hash = "#" + h)} />}
      {cat && sub.id === "intel" && w && can("view_threats") && (
        <IntelView
          key={wsId}
          wsId={wsId}
          path={route.id}
          go={(p) => go("intel", p)}
          openTechnique={open}
          canEdit={can("manage_workspace")}
          onProfileChanged={() => go("inventory")}
        />
      )}
      {cat && sub.id === "inventory" && w && can("view_threats") && (
        <InventoryView
          cat={cat}
          wsId={wsId}
          wsName={w.name}
          appId={route.id}
          canEdit={can("manage_workspace")}
          go={(a) => go("inventory", a)}
          openTechnique={open}
          onInventory={(i) => setInModels(i.in_models || {})}
          onWorkspaceCreated={(id) => {
            void api<Workspaces>("/api/aisec/workspaces").then((x) => {
              setWs(x);
              setWsId(id);
              go("inventory");
            });
          }}
        />
      )}
      {cat && (sub.id === "threats" || sub.id === "inventory" || sub.id === "intel") && !can("view_threats") && (
        <section className="as-phase">
          <p className="dd-eyebrow">Not visible to this role</p>
          <h3>{cat.roles[role]?.label}s don't see this workbench</h3>
          <p>{cat.roles[role]?.summary}</p>
        </section>
      )}
      {cat && sub.id === "threats" && can("view_threats") && (
        <>
          <section className="as-versions" aria-label="Pinned taxonomy versions">
            {cat.versions.map((v, i) => (
              <a key={v.id} className="as-ver" href={safeLink(v.url)} target="_blank" rel="noreferrer" style={{ ["--i" as string]: i }}>
                <small>{v.id === "atlas" ? "pinned release" : "edition"}</small>
                <strong>
                  {v.name} <span>{v.version}</span>
                </strong>
                <em>
                  {v.license}
                  {v.released ? ` · released ${v.released}` : ""}
                  {v.checked ? ` · checked ${v.checked}` : ""}
                </em>
              </a>
            ))}
            <dl className="as-stats">
              <div>
                <dt>{cat.counts.tactics}</dt>
                <dd>tactics</dd>
              </div>
              <div>
                <dt>{cat.counts.techniques}</dt>
                <dd>techniques</dd>
              </div>
              <div>
                <dt>{cat.counts.subtechniques}</dt>
                <dd>sub-techniques</dd>
              </div>
              <div>
                <dt>{cat.counts.mitigations}</dt>
                <dd>mitigations</dd>
              </div>
              <div>
                <dt>{cat.counts.case_studies}</dt>
                <dd>case studies</dd>
              </div>
              <div>
                <dt>{cat.counts.owasp_items}</dt>
                <dd>OWASP risks</dd>
              </div>
            </dl>
          </section>

          {!!tracked?.tracked.length && (
            <section className="as-tracked" aria-label={`Tracked in ${w?.name}`}>
              <h4>
                <Star size={13} /> Tracked in {w?.name}
              </h4>
              <ul className="as-chips">
                {tracked.tracked.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => open(t.id)} title={t.note}>
                      <code>{t.id}</code> {cat.techniques.find((x) => x.id === t.id)?.name || cat.owasp.flatMap((l) => l.items).find((x) => x.id === t.id)?.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {route.id ? (
            <DetailView
              key={route.id + wsId}
              id={route.id}
              cat={cat}
              open={open}
              back={() => go("threats")}
              tracked={trackedSet.has(route.id)}
              note={tracked?.tracked.find((t) => t.id === route.id)?.note || ""}
              canTrack={can("track_techniques")}
              onTrack={track}
              inModels={inModels[route.id]}
              wsName={w?.name}
            />
          ) : (
            <section className="as-map" aria-label="Threat map">
              <div className="as-lens" role="tablist" aria-label="Taxonomy">
                {(["atlas", "owasp-llm", "owasp-agentic"] as Lens[]).map((l) => (
                  <button key={l} type="button" role="tab" aria-selected={lens === l} onClick={() => setLens(l)}>
                    {FRAMEWORK_LABEL[l]}
                  </button>
                ))}
              </div>
              {lens === "atlas" ? (
                <>
                  <div className="as-tools">
                    <label className="as-search">
                      <Search size={14} />
                      <input type="search" aria-label="Search techniques" placeholder="Search name, id or sub-technique" value={query} onChange={(e) => setQuery(e.target.value)} />
                    </label>
                    <div className="as-filters" role="group" aria-label="Platforms">
                      {PLATFORMS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={platforms.includes(p)}
                          onClick={() => setPlatforms(platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p])}
                        >
                          {p}
                        </button>
                      ))}
                      <button type="button" aria-pressed={trackedOnly} onClick={() => setTrackedOnly(!trackedOnly)}>
                        <Star size={12} /> Tracked
                      </button>
                    </div>
                    <label className="pg-select">
                      <span>Highlight an OWASP risk</span>
                      <select value={highlight} onChange={(e) => setHighlight(e.target.value)}>
                        <option value="">None</option>
                        {cat.owasp.map((l) => (
                          <optgroup key={l.id} label={`${l.name} ${l.edition}`}>
                            {l.items.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.id} · {i.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                  </div>
                  <ThreatMap
                    key={"atlas-" + wsId}
                    cat={cat}
                    open={open}
                    tracked={trackedSet}
                    query={query}
                    platforms={platforms}
                    trackedOnly={trackedOnly}
                    highlight={highlight}
                  />
                </>
              ) : (
                <OwaspBoard key={lens} cat={cat} lens={lens} open={open} tracked={trackedSet} />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
