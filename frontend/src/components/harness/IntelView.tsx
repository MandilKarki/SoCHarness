import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { api, download, errorText, safeLink } from "../../lib/api";
import type { Band, FeedItem, IntelOverview, RegisterEntry, Snapshot, ThreatCard } from "../../lib/aisec";

type Tab = "landscape" | "cards" | "feed" | "register" | "sector" | "snapshots";
const TABS: { id: Tab; label: string }[] = [
  { id: "landscape", label: "Landscape" },
  { id: "cards", label: "Threat cards" },
  { id: "feed", label: "Feed" },
  { id: "register", label: "AI-enabled threats" },
  { id: "sector", label: "Sector pack" },
  { id: "snapshots", label: "Snapshots" },
];
const BAND_LABEL: Record<Band, string> = { high: "High", medium: "Medium", low: "Low", none: "Not applicable" };
const COVER_LABEL = { tested: "Has a test", gap: "Gap open", none: "No test or gap" } as const;
const thisMonth = () => new Date().toISOString().slice(0, 7);

function BandPill({ b, score }: { b: Band; score?: number }) {
  return (
    <span className={"in-band in-b-" + b}>
      {BAND_LABEL[b]}
      {score !== undefined && b !== "none" && <b>{score}</b>}
    </span>
  );
}
function CoverPill({ c }: { c: ThreatCard["coverage"] }) {
  return <span className={"in-cover in-c-" + c}>{COVER_LABEL[c]}</span>;
}

function CoverageBar({ o, onSnapshot, busy, canEdit }: { o: IntelOverview; onSnapshot: () => void; busy: boolean; canEdit: boolean }) {
  const c = o.coverage;
  return (
    <section className={"in-gate" + (c.ok ? " is-ok" : "")} aria-label="Coverage of high-relevance threats">
      <div>
        <strong>{c.high} high-relevance threats</strong>
        <span>
          {c.tested} with a test · {c.gaps} with an open gap · <b>{c.uncovered.length} with neither</b>
        </span>
        <small>
          {c.ok
            ? "Every high threat links to a test or an open gap."
            : "Open a gap (or add a test) for each uncovered high threat; the monthly snapshot reports this."}{" "}
          Risk appetite: {o.risk_appetite}.
        </small>
      </div>
      <button type="button" className="hl-primary hl-small" disabled={busy || !canEdit} onClick={onSnapshot}>
        Generate {thisMonth()} snapshot
      </button>
    </section>
  );
}

/* ---------------------------------------------------------------- landscape */

function HeatMapView({ o, openCard }: { o: IntelOverview; openCard: (id: string) => void }) {
  const rows = o.heatmap.rows.filter((r) => r.band !== "none");
  const cols = o.heatmap.cols;
  if (!cols.length)
    return (
      <section className="as-phase">
        <p className="dd-eyebrow">No applications yet</p>
        <h3>The landscape needs an inventory</h3>
        <p>Add or import applications in Inventory; relevance comes from each application's inputs, actions and assets.</p>
      </section>
    );
  return (
    <figure className="in-heat" aria-label="Threats by application">
      <div className="in-heat-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Threat</th>
              {cols.map((c) => (
                <th key={c.id} scope="col" title={c.name}>
                  <span>{c.name}</span>
                  <small>tier {c.tier}</small>
                </th>
              ))}
              <th scope="col">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <th scope="row">
                  <button type="button" onClick={() => openCard(r.id)}>
                    <BandPill b={r.band} /> {r.title}
                  </button>
                </th>
                {cols.map((c, j) => {
                  const cell = o.heatmap.cells[r.id]?.[c.id];
                  return (
                    <td key={c.id} style={{ ["--d" as string]: `${i * 45 + j * 70}ms` }}>
                      {cell ? (
                        <span
                          className={`in-cell in-w${cell.weight} in-s-${cell.state}`}
                          title={`${cell.proposals} proposal${cell.proposals > 1 ? "s" : ""} · ${cell.state === "accepted" ? "accepted in the threat model" : cell.state === "rejected" ? "rejected by an analyst" : "not yet decided"}`}
                        >
                          {cell.state === "accepted" ? "●" : cell.state === "rejected" ? "×" : "○"}
                        </span>
                      ) : (
                        <span className="in-cell in-empty" />
                      )}
                    </td>
                  );
                })}
                <td>
                  <CoverPill c={r.coverage as ThreatCard["coverage"]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption>
        Colour depth = the application's tier. ● accepted in its threat model · ○ proposed, not yet decided · × rejected by an analyst. Rows
        are threats relevant to this workspace, highest first.
      </figcaption>
    </figure>
  );
}

function CardTile({ c, i, onOpen }: { c: ThreatCard; i: number; onOpen: () => void }) {
  return (
    <button type="button" className={"in-card in-cb-" + c.band} style={{ ["--i" as string]: i }} onClick={onOpen}>
      <span className="in-card-top">
        <BandPill b={c.band} score={c.score} />
        <CoverPill c={c.coverage} />
      </span>
      <strong>{c.title}</strong>
      <span className="in-card-what">{c.what}</span>
      <span className="in-meter" aria-label={`Exposure ${c.exposure} of 6, likelihood ${c.likelihood} of 3`}>
        <i style={{ width: `${(c.exposure / 6) * 100}%` }} />
        <i style={{ width: `${(c.likelihood / 3) * 100}%` }} />
      </span>
      <small>
        {c.maturity_label} · {c.apps.filter((a) => !a.excluded).length} application{c.apps.filter((a) => !a.excluded).length === 1 ? "" : "s"} ·{" "}
        {c.case_study_count} ATLAS case studies
      </small>
    </button>
  );
}

/* ---------------------------------------------------------------- card page */

function CardPage({
  c,
  o,
  wsId,
  back,
  openTechnique,
  reload,
  canEdit,
}: {
  c: ThreatCard;
  o: IntelOverview;
  wsId: string;
  back: () => void;
  openTechnique: (id: string) => void;
  reload: () => Promise<void>;
  canEdit: boolean;
}) {
  const [note, setNote] = useState("No automated test yet; attack-range pack planned."),
    [owner, setOwner] = useState(""),
    [resolution, setResolution] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const items = o.feed.filter((f) => f.cards.includes(c.id)).slice(0, 8);
  const post = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await api(path, { workspace: wsId, card: c.id, ...body });
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="iv-page in-cardpage">
      <nav className="as-crumbs">
        <button type="button" className="hl-secondary hl-small" onClick={back}>
          <ArrowLeft size={14} /> Threat cards
        </button>
      </nav>
      <header className="as-detail-head">
        <div>
          <small className="pg-kind">Threat card</small>
          <h3>{c.title}</h3>
          <p className="as-tags">
            <BandPill b={c.band} score={c.score} />
            <CoverPill c={c.coverage} />
            <span className="as-plat">{c.maturity_label}</span>
          </p>
        </div>
      </header>
      <p className="as-lead">{c.what}</p>
      <section className="as-sec">
        <h4>Why this score</h4>
        <ol className="in-reasons">
          {c.reasons.map((r, i) => (
            <li key={i} style={{ ["--i" as string]: i }}>
              {r}
            </li>
          ))}
        </ol>
      </section>
      <div className="in-two">
        <section className="as-sec">
          <h4>It needs</h4>
          <ul className="in-list">
            {c.preconditions.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
        <section className="as-sec">
          <h4>Techniques</h4>
          <ul className="as-chips">
            {c.techniques.map((t) => (
              <li key={t}>
                <button type="button" onClick={() => openTechnique(t)}>
                  <code>{t}</code>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="as-sec">
        <h4>Where it applies here</h4>
        {c.apps.length ? (
          <ul className="in-apps">
            {c.apps.map((a) => (
              <li key={a.id} className={a.excluded ? "is-excluded" : ""}>
                <strong>{a.name}</strong>
                <span>
                  tier {a.tier} · {a.direct ? "directly reachable" : "indirect"} · {a.proposals} proposal{a.proposals > 1 ? "s" : ""}
                  {a.accepted ? ` · ${a.accepted} accepted` : ""}
                  {a.rejected ? ` · ${a.rejected} rejected` : ""}
                  {a.excluded ? " · not counted: all rejected" : ""}
                </span>
                <small>{a.surfaces.join(" · ")}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="as-dim">No application in this workspace has the surfaces this threat needs.</p>
        )}
      </section>
      <section className="as-sec in-coverage">
        <h4>Coverage</h4>
        {c.tests.map((t) => (
          <a key={t.id} className="in-test" href={"#" + t.hash}>
            <b>Test</b> {t.label} <ArrowUpRight size={11} />
          </a>
        ))}
        {c.gap && c.gap.status === "open" && (
          <div className="in-gapbox">
            <p>
              <b>Gap open</b> {c.gap.note}
              {c.gap.owner && ` · owner ${c.gap.owner}`} · {c.gap.planned}
            </p>
            {canEdit && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void post("/api/aisec/intel/gap/close", { resolution });
                }}
              >
                <input aria-label="Resolution" required maxLength={1000} placeholder="How it was closed" value={resolution} onChange={(e) => setResolution(e.target.value)} />
                <button className="hl-secondary hl-small" disabled={busy}>
                  Close gap
                </button>
              </form>
            )}
          </div>
        )}
        {!c.tests.length && (!c.gap || c.gap.status !== "open") && canEdit && (
          <form
            className="in-gapform"
            onSubmit={(e) => {
              e.preventDefault();
              void post("/api/aisec/intel/gap", { note, owner });
            }}
          >
            <p className="as-dim">No test covers this threat yet. Record the gap so it is tracked until the attack range covers it.</p>
            <input aria-label="Gap note" required maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            <input aria-label="Owner" maxLength={120} placeholder="Owner (optional)" value={owner} onChange={(e) => setOwner(e.target.value)} />
            <button className="hl-primary hl-small" disabled={busy}>
              Open gap
            </button>
          </form>
        )}
        {error && <p className="as-error">{error}</p>}
      </section>
      {!!c.case_studies.length && (
        <section className="as-sec">
          <h4>
            Latest ATLAS case studies · {c.recent_case_studies} of {c.case_study_count} in the last 24 months
          </h4>
          <ul className="as-refs">
            {c.case_studies.map((s) => (
              <li key={s.id}>
                <a href={safeLink(`https://atlas.mitre.org/studies/${s.id}`)} target="_blank" rel="noreferrer">
                  {s.name} <ArrowUpRight size={11} />
                </a>{" "}
                <small className="as-dim">
                  {s.type === "Incident" ? "incident" : "exercise"} · {s.date.slice(0, 7)}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!items.length && (
        <section className="as-sec">
          <h4>Related feed items</h4>
          <ul className="as-refs">
            {items.map((f) => (
              <li key={f.id}>
                <a href={safeLink(f.url)} target="_blank" rel="noreferrer">
                  {f.title} <ArrowUpRight size={11} />
                </a>{" "}
                <small className="as-dim">
                  {o.feed_kinds[f.kind] || f.kind} · {f.published || "undated"}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="hl-fine">{o.notes.cards}</p>
    </article>
  );
}

/* ---------------------------------------------------------------- feed */

function FeedView({ o, wsId, reload, canEdit, cardTitle }: { o: IntelOverview; wsId: string; reload: () => Promise<void>; canEdit: boolean; cardTitle: (id: string) => string }) {
  const [kind, setKind] = useState(""),
    [relevantOnly, setRelevantOnly] = useState(true),
    [q, setQ] = useState(""),
    [limit, setLimit] = useState(25),
    [adding, setAdding] = useState(false),
    [form, setForm] = useState({ title: "", url: "", published: new Date().toISOString().slice(0, 10), kind: "research", summary: "", techniques: "" }),
    [msg, setMsg] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const shown = o.feed.filter(
    (f) =>
      (!kind || f.kind === kind) &&
      (!relevantOnly || f.relevant) &&
      (!q || (f.title + " " + f.summary + " " + f.techniques.join(" ")).toLowerCase().includes(q.toLowerCase())),
  );
  const kinds = [...new Set(o.feed.map((f) => f.kind))];
  const advisories = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{ checked: number; found: number; note?: string }>("/api/aisec/intel/advisories", { workspace: wsId });
      setMsg(r.note || `Checked ${r.checked} package${r.checked === 1 ? "" : "s"} against OSV: ${r.found} advisor${r.found === 1 ? "y" : "ies"} found.`);
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    setError("");
    try {
      await api("/api/aisec/intel/feed", {
        workspace: wsId,
        item: { ...form, techniques: form.techniques.split(/[\s,]+/).filter(Boolean) },
      });
      setAdding(false);
      setForm({ ...form, title: "", url: "", summary: "", techniques: "" });
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="in-feed" aria-label="Threat feed">
      <div className="as-tools">
        <label className="as-search">
          <Search size={14} />
          <input type="search" aria-label="Search the feed" placeholder="Search titles, summaries, techniques" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="as-filters" role="group" aria-label="Source">
          <button type="button" aria-pressed={!kind} onClick={() => setKind("")}>
            All
          </button>
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? "" : k)}>
              {o.feed_kinds[k] || k}
            </button>
          ))}
          <button type="button" aria-pressed={relevantOnly} onClick={() => setRelevantOnly(!relevantOnly)}>
            Relevant to this workspace
          </button>
        </div>
      </div>
      <div className="in-feed-actions">
        {canEdit && (
          <>
            <button type="button" className="hl-secondary hl-small" disabled={busy} onClick={() => void advisories()}>
              <RefreshCw size={13} /> Check SDK advisories (OSV)
            </button>
            <button type="button" className="hl-secondary hl-small" aria-expanded={adding} onClick={() => setAdding(!adding)}>
              Add an item
            </button>
          </>
        )}
        <span className="as-dim">
          {o.advisory_check ? `Advisories last checked ${o.advisory_check.checked_at.slice(0, 16).replace("T", " ")} UTC: ${o.advisory_check.found} found in ${o.advisory_check.packages} packages.` : "Advisories not checked yet for this workspace."}
        </span>
      </div>
      {msg && <p className="iv-notice">{msg}</p>}
      {error && <p className="as-error">{error}</p>}
      {adding && (
        <form
          className="iv-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="iv-wide">
            <span>Title</span>
            <input required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="iv-wide">
            <span>Link (https)</span>
            <input required maxLength={500} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </label>
          <label>
            <span>Date (YYYY-MM or YYYY-MM-DD)</span>
            <input required maxLength={10} value={form.published} onChange={(e) => setForm({ ...form, published: e.target.value })} />
          </label>
          <label>
            <span>Kind</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {["research", "vendor", "regulator", "standard", "news"].map((k) => (
                <option key={k} value={k}>
                  {o.feed_kinds[k] || k}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Techniques (ids, comma separated)</span>
            <input value={form.techniques} placeholder="AML.T0051.001, ASI02" onChange={(e) => setForm({ ...form, techniques: e.target.value })} />
          </label>
          <label className="iv-wide">
            <span>Summary in your own words</span>
            <input maxLength={1500} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </label>
          <span className="iv-form-actions">
            <button className="hl-primary hl-small">Add to feed</button>
          </span>
        </form>
      )}
      <p className="as-count">
        {shown.length} of {o.feed.length} items
      </p>
      <ol className="in-items">
        {shown.slice(0, limit).map((f, i) => (
          <FeedRow key={f.id} f={f} i={i} kinds={o.feed_kinds} cardTitle={cardTitle} />
        ))}
      </ol>
      {shown.length > limit && (
        <button type="button" className="hl-secondary hl-small" onClick={() => setLimit(limit + 25)}>
          Show more
        </button>
      )}
      <p className="hl-fine">{o.notes.feed}</p>
    </section>
  );
}

function FeedRow({ f, i, kinds, cardTitle }: { f: FeedItem; i: number; kinds: Record<string, string>; cardTitle: (id: string) => string }) {
  return (
    <li className={"in-item in-k-" + f.kind} style={{ ["--i" as string]: Math.min(i, 15) }}>
      <span className="in-item-meta">
        <span className="in-kind">{kinds[f.kind] || f.kind}</span>
        <time>{f.published || "undated"}</time>
        {f.detail && <span className="as-dim">{f.detail}</span>}
      </span>
      <a href={safeLink(f.url)} target="_blank" rel="noreferrer">
        {f.title} <ArrowUpRight size={11} />
      </a>
      {f.summary && <p>{f.summary}</p>}
      {!!f.cards.length && (
        <span className="in-item-cards">
          Relevant: {f.cards.slice(0, 3).map(cardTitle).join(" · ")}
          {f.cards.length > 3 && ` · +${f.cards.length - 3}`}
        </span>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- register */

function RiskDot({ L, I, rl, ri }: { L: number; I: number; rl: number; ri: number }) {
  return (
    <span className="in-matrix" role="img" aria-label={`Inherent likelihood ${L}, impact ${I}; residual likelihood ${rl}, impact ${ri}`}>
      {[4, 3, 2, 1].map((imp) =>
        [1, 2, 3, 4].map((lik) => <i key={`${imp}-${lik}`} className={"in-m" + Math.min(4, Math.ceil((lik * imp) / 4))} />),
      )}
      <b className="in-dot in-dot-in" style={{ ["--x" as string]: L - 1, ["--y" as string]: 4 - I }} />
      <b className="in-dot in-dot-res" style={{ ["--x" as string]: rl - 1, ["--y" as string]: 4 - ri }} />
    </span>
  );
}

function RegisterCard({ r, wsId, onSaved, canEdit, i }: { r: RegisterEntry; wsId: string; onSaved: (r: RegisterEntry) => void; canEdit: boolean; i: number }) {
  const [L, setL] = useState(r.likelihood),
    [I, setI] = useState(r.impact),
    [ctrl, setCtrl] = useState<Record<string, string>>(Object.fromEntries(r.controls.map((c) => [c.id, c.status]))),
    [owner, setOwner] = useState(r.owner),
    [error, setError] = useState("");
  const dirty = L !== r.likelihood || I !== r.impact || owner !== r.owner || r.controls.some((c) => ctrl[c.id] !== c.status) || !r.assessed;
  const save = async () => {
    setError("");
    try {
      onSaved(await api<RegisterEntry>("/api/aisec/intel/register", { workspace: wsId, id: r.id, likelihood: L, impact: I, controls: ctrl, owner, note: r.note }));
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <li className={"in-reg" + (r.priority ? " is-priority" : "")} style={{ ["--i" as string]: i }}>
      <div className="in-reg-head">
        <div>
          <strong>{r.title}</strong>
          {r.priority && <span className="in-prio">Sector priority</span>}
          <p>{r.what}</p>
        </div>
        <RiskDot L={r.likelihood} I={r.impact} rl={r.residual_likelihood} ri={r.residual_impact} />
      </div>
      <p className="in-scores">
        <span className={"in-rb in-rb-" + r.inherent_band}>Inherent {r.inherent} · {r.inherent_band}</span>→
        <span className={"in-rb in-rb-" + r.residual_band}>Residual {r.residual} · {r.residual_band}</span>
        {!r.assessed && <em>default estimate, not assessed yet</em>}
      </p>
      <div className="in-reg-edit">
        {(
          [
            ["Likelihood", L, setL],
            ["Impact", I, setI],
          ] as const
        ).map(([label, v, set]) => (
          <fieldset key={label} className="in-seg" disabled={!canEdit}>
            <legend>{label}</legend>
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" aria-pressed={v === n} onClick={() => set(n)}>
                {n}
              </button>
            ))}
          </fieldset>
        ))}
        <label className="in-owner">
          <span>Owner</span>
          <input value={owner} maxLength={120} disabled={!canEdit} onChange={(e) => setOwner(e.target.value)} />
        </label>
      </div>
      <ul className="in-controls">
        {r.controls.map((c) => (
          <li key={c.id}>
            <span>
              {c.label} <small>lowers {c.reduces}</small>
            </span>
            <select aria-label={`Status of ${c.label}`} value={ctrl[c.id]} disabled={!canEdit} onChange={(e) => setCtrl({ ...ctrl, [c.id]: e.target.value })}>
              <option value="in_place">In place</option>
              <option value="planned">Planned</option>
              <option value="none">Not in place</option>
            </select>
          </li>
        ))}
      </ul>
      {canEdit && (
        <button type="button" className="hl-secondary hl-small" disabled={!dirty} onClick={() => void save()}>
          {r.assessed ? "Save assessment" : "Record assessment"}
        </button>
      )}
      {error && <p className="as-error">{error}</p>}
    </li>
  );
}

/* ---------------------------------------------------------------- snapshot page */

function SnapshotPage({ wsId, month, back }: { wsId: string; month: string; back: () => void }) {
  const [s, setS] = useState<Snapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Snapshot>(`/api/aisec/snapshot?workspace=${encodeURIComponent(wsId)}&month=${encodeURIComponent(month)}`)
      .then(setS)
      .catch((e) => setError(errorText(e)));
  }, [wsId, month]);
  const saveMd = () => {
    if (!s) return;
    const blob = new Blob([s.markdown], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ai-threat-landscape-${s.workspace}-${s.month}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <article className="iv-page">
      <nav className="as-crumbs">
        <button type="button" className="hl-secondary hl-small" onClick={back}>
          <ArrowLeft size={14} /> Snapshots
        </button>
      </nav>
      {error && <p className="as-error">{error}</p>}
      {!s && !error && <p className="pg-empty">Loading…</p>}
      {s && (
        <>
          <header className="as-detail-head">
            <div>
              <small className="pg-kind">Monthly landscape snapshot</small>
              <h3>
                {s.workspace_name} · {s.month}
              </h3>
              <p className="as-dim">Generated {s.generated_at.slice(0, 16).replace("T", " ")} UTC</p>
            </div>
            <span className="iv-bar-actions">
              <button type="button" className="hl-primary hl-small" onClick={saveMd}>
                Download Markdown
              </button>
              <button type="button" className="hl-secondary hl-small" onClick={() => download(`ai-threat-landscape-${s.workspace}-${s.month}.json`, s)}>
                Download JSON
              </button>
            </span>
          </header>
          <dl className="in-kpis">
            {(["high", "medium", "low"] as const).map((b, i) => (
              <div key={b} className={"in-kpi in-b-" + b} style={{ ["--i" as string]: i }}>
                <dt>{s.counts[b]}</dt>
                <dd>{BAND_LABEL[b].toLowerCase()} relevance</dd>
              </div>
            ))}
            <div className={"in-kpi " + (s.coverage.ok ? "is-ok" : "is-bad")} style={{ ["--i" as string]: 3 }}>
              <dt>{s.coverage.ok ? "✓" : s.coverage.uncovered.length}</dt>
              <dd>{s.coverage.ok ? "high threats all covered" : "high threats with no test or gap"}</dd>
            </div>
            <div className="in-kpi" style={{ ["--i" as string]: 4 }}>
              <dt>{s.new_items.length}</dt>
              <dd>feed items dated {s.month}</dd>
            </div>
          </dl>
          <pre className="in-md" aria-label="Snapshot as Markdown">
            {s.markdown}
          </pre>
        </>
      )}
    </article>
  );
}

/* ---------------------------------------------------------------- main */

export function IntelView({
  wsId,
  path,
  go,
  openTechnique,
  canEdit,
  onProfileChanged,
}: {
  wsId: string;
  path: string | null;
  go: (path: string | null) => void;
  openTechnique: (id: string) => void;
  canEdit: boolean;
  onProfileChanged?: () => void;
}) {
  const [o, setO] = useState<IntelOverview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [bandFilter, setBandFilter] = useState<Band | "">("");
  const load = async () => {
    try {
      setO(await api<IntelOverview>("/api/aisec/intel?workspace=" + encodeURIComponent(wsId)));
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    setO(null);
    void load();
  }, [wsId]);
  const [head, rest] = (path || "landscape").split(/\/(.*)/s);
  const tab = (TABS.some((t) => t.id === head) ? head : head === "card" ? "cards" : head === "snapshot" ? "snapshots" : "landscape") as Tab;
  const cardTitle = useMemo(() => {
    const m = new Map((o?.cards || []).map((c) => [c.id, c.title]));
    return (id: string) => m.get(id) || id;
  }, [o]);
  const snapshot = async () => {
    setBusy(true);
    try {
      await api("/api/aisec/intel/snapshot", { workspace: wsId, month: thisMonth() });
      await load();
      go("snapshot/" + thisMonth());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!o) return error ? <p className="as-error">{error}</p> : <p className="pg-empty">Loading intelligence…</p>;
  const card = head === "card" ? o.cards.find((c) => c.id === rest) : null;
  return (
    <div className="in">
      <CoverageBar o={o} onSnapshot={() => void snapshot()} busy={busy} canEdit={canEdit} />
      {error && <p className="as-error">{error}</p>}
      <nav className="as-lens in-tabs" role="tablist" aria-label="Intelligence views">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {card ? (
        <CardPage key={card.id} c={card} o={o} wsId={wsId} back={() => go("cards")} openTechnique={openTechnique} reload={load} canEdit={canEdit} />
      ) : head === "snapshot" && rest ? (
        <SnapshotPage wsId={wsId} month={rest} back={() => go("snapshots")} />
      ) : tab === "landscape" ? (
        <>
          <HeatMapView o={o} openCard={(id) => go("card/" + id)} />
          <section className="in-top" aria-label="Most relevant threats">
            <h4>Most relevant threats</h4>
            <div className="in-cards">
              {o.cards
                .filter((c) => c.band === "high")
                .slice(0, 6)
                .map((c, i) => (
                  <CardTile key={c.id} c={c} i={i} onOpen={() => go("card/" + c.id)} />
                ))}
            </div>
          </section>
        </>
      ) : tab === "cards" ? (
        <section aria-label="Threat cards">
          <div className="as-filters" role="group" aria-label="Relevance">
            {(["", "high", "medium", "low", "none"] as const).map((b) => (
              <button key={b || "all"} type="button" aria-pressed={bandFilter === b} onClick={() => setBandFilter(b)}>
                {b ? `${BAND_LABEL[b]} ${o.cards.filter((c) => c.band === b).length}` : `All ${o.cards.length}`}
              </button>
            ))}
          </div>
          <div className="in-cards">
            {o.cards
              .filter((c) => !bandFilter || c.band === bandFilter)
              .map((c, i) => (
                <CardTile key={c.id} c={c} i={i} onOpen={() => go("card/" + c.id)} />
              ))}
          </div>
        </section>
      ) : tab === "feed" ? (
        <FeedView o={o} wsId={wsId} reload={load} canEdit={canEdit} cardTitle={cardTitle} />
      ) : tab === "register" ? (
        <section aria-label="AI-enabled threats against the company">
          <p className="hl-fine">{o.notes.register} Residual drops by one step for each control in place that lowers likelihood or impact.</p>
          <ol className="in-regs">
            {o.register.map((r, i) => (
              <RegisterCard
                key={r.id + r.inherent + r.residual}
                r={r}
                i={i}
                wsId={wsId}
                canEdit={canEdit}
                onSaved={(n) => setO({ ...o, register: o.register.map((x) => (x.id === n.id ? n : x)) })}
              />
            ))}
          </ol>
        </section>
      ) : tab === "sector" ? (
        o.sector ? (
          <section className="in-sector" aria-label="Sector pack">
            <h4>{o.sector.label}</h4>
            <ol className="in-guidance">
              {o.sector.guidance.map((g, i) => (
                <li key={g.url} style={{ ["--i" as string]: i }}>
                  <a href={safeLink(g.url)} target="_blank" rel="noreferrer">
                    {g.name} <ArrowUpRight size={11} />
                  </a>
                  <time>{g.date}</time>
                  <p>{g.why}</p>
                </li>
              ))}
            </ol>
            <div className="in-two">
              <section className="as-sec">
                <h4>Priority threats for this sector</h4>
                <ul className="as-chips">
                  {o.sector.priority_cards.map((id) => (
                    <li key={id}>
                      <button type="button" onClick={() => go("card/" + id)}>
                        {cardTitle(id)}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="as-sec">
                <h4>Typical AI uses</h4>
                <ul className="in-list">
                  {o.sector.uses.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </section>
            </div>
            <p className="hl-fine">{o.notes.sectors} Priority threats get +2 relevance in this workspace.</p>
          </section>
        ) : (
          <section className="as-phase">
            <p className="dd-eyebrow">No sector set</p>
            <h3>Choose a sector in the company profile</h3>
            <p>Set the sector under Inventory → Company profile to load its regulators, guidance and priority threats.</p>
            <button type="button" className="hl-secondary hl-small" onClick={() => onProfileChanged?.()}>
              Open Inventory
            </button>
          </section>
        )
      ) : (
        <section aria-label="Snapshots">
          {o.snapshots.length ? (
            <ul className="in-snaps">
              {o.snapshots.map((s) => (
                <li key={s.month}>
                  <button type="button" onClick={() => go("snapshot/" + s.month)}>
                    <strong>{s.month}</strong>
                    <span>
                      {s.counts.high} high · {s.counts.medium} medium · {s.counts.low} low
                    </span>
                    <span className={s.coverage.ok ? "in-c-tested" : "in-c-none"}>{s.coverage.ok ? "all high threats covered" : `${s.coverage.uncovered.length} uncovered`}</span>
                    <small>generated {s.generated_at.slice(0, 10)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="as-dim">No snapshots yet. Generate this month's from the bar above.</p>
          )}
        </section>
      )}
    </div>
  );
}
