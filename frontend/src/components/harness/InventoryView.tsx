import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Lock, RefreshCw } from "lucide-react";
import { api, download, errorText } from "../../lib/api";
import type {
  AppAction,
  AppInput,
  Application,
  Asset,
  AssetType,
  Catalog,
  EnterpriseProfile,
  ImportResult,
  Inventory,
  ModelSummary,
  Proposal,
  ThreatModel,
} from "../../lib/aisec";

const STATUS_LABEL: Record<ModelSummary["status"], string> = {
  none: "No threat model",
  draft: "Draft",
  accepted: "Accepted",
  stale: "Stale: app changed",
};
const TYPE_ORDER: AssetType[] = ["agent", "model", "framework", "tool", "mcp_server", "vector_store", "data_source", "prompt", "vendor"];
const RISKY = new Set(["write", "external", "money", "identity", "code_exec"]);

function StatusPill({ s }: { s?: ModelSummary }) {
  const st = s?.status || "none";
  return <span className={"iv-status iv-st-" + st}>{STATUS_LABEL[st]}</span>;
}

function Progress({ s }: { s: ModelSummary }) {
  if (!s.proposed) return null;
  const pct = (n: number) => `${(100 * n) / s.proposed}%`;
  return (
    <span className="iv-progress" role="img" aria-label={`${s.accepted} accepted, ${s.rejected} rejected, ${s.undecided} undecided of ${s.proposed}`}>
      <i className="iv-p-acc" style={{ width: pct(s.accepted) }} />
      <i className="iv-p-rej" style={{ width: pct(s.rejected) }} />
    </span>
  );
}

/* ---------------------------------------------------------------- profile */

function ProfileCard({ inv, cat, wsId, onSaved }: { inv: Inventory; cat: Catalog; wsId: string; onSaved: (i: Inventory) => void }) {
  const [edit, setEdit] = useState(false),
    [p, setP] = useState<EnterpriseProfile>(inv.profile),
    [regs, setRegs] = useState(inv.profile.regulators.join(", ")),
    [error, setError] = useState("");
  useEffect(() => {
    setP(inv.profile);
    setRegs(inv.profile.regulators.join(", "));
  }, [inv.profile]);
  const save = async () => {
    setError("");
    try {
      await api("/api/aisec/profile", {
        workspace: wsId,
        profile: { ...p, regulators: regs.split(",").map((r) => r.trim()).filter(Boolean) },
      });
      onSaved(await api<Inventory>("/api/aisec/inventory?workspace=" + encodeURIComponent(wsId)));
      setEdit(false);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const pr = inv.profile;
  return (
    <section className="iv-profile" aria-label="Company profile">
      <header>
        <h4>Company profile</h4>
        <button type="button" className="hl-secondary hl-small" aria-expanded={edit} onClick={() => setEdit(!edit)}>
          {edit ? "Close" : "Edit"}
        </button>
      </header>
      {!edit ? (
        <dl className="iv-facts">
          <div>
            <dt>Sector</dt>
            <dd>{pr.sector ? cat.sectors[pr.sector] : "Not set"}</dd>
          </div>
          <div>
            <dt>Regulators</dt>
            <dd>{pr.regulators.join(", ") || "None recorded"}</dd>
          </div>
          <div>
            <dt>Risk appetite</dt>
            <dd className={"iv-app-" + pr.risk_appetite}>
              {pr.risk_appetite}
              {pr.appetite_note && <small>{pr.appetite_note}</small>}
            </dd>
          </div>
          <div>
            <dt>Retest within</dt>
            <dd>
              {(["critical", "high", "medium", "low"] as const).map((k) => (
                <span key={k} className="iv-days">
                  {k} {pr.retest_days[k]}d
                </span>
              ))}
            </dd>
          </div>
        </dl>
      ) : (
        <form
          className="iv-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            <span>Sector</span>
            <select value={p.sector || ""} onChange={(e) => setP({ ...p, sector: e.target.value || null })}>
              <option value="">Not set</option>
              {Object.entries(cat.sectors).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="iv-wide">
            <span>Regulators and frameworks (comma separated)</span>
            <input value={regs} maxLength={1200} onChange={(e) => setRegs(e.target.value)} placeholder="e.g. NYDFS Part 500, EU AI Act, ISO/IEC 42001" />
          </label>
          <fieldset className="iv-seg">
            <legend>Risk appetite</legend>
            {(["low", "moderate", "high"] as const).map((k) => (
              <label key={k}>
                <input type="radio" name="appetite" checked={p.risk_appetite === k} onChange={() => setP({ ...p, risk_appetite: k })} />
                {k}
              </label>
            ))}
          </fieldset>
          <label className="iv-wide">
            <span>Appetite note</span>
            <input value={p.appetite_note} maxLength={1000} onChange={(e) => setP({ ...p, appetite_note: e.target.value })} />
          </label>
          {(["1", "2", "3"] as const).map((k) => (
            <label key={k} className="iv-wide">
              <span>Tier {k} means</span>
              <input value={p.tiers[k]} maxLength={200} required onChange={(e) => setP({ ...p, tiers: { ...p.tiers, [k]: e.target.value } })} />
            </label>
          ))}
          <fieldset className="iv-days-edit">
            <legend>Retest deadline by severity (days)</legend>
            {(["critical", "high", "medium", "low"] as const).map((k) => (
              <label key={k}>
                <span>{k}</span>
                <input
                  type="number"
                  min={1}
                  max={730}
                  value={p.retest_days[k]}
                  onChange={(e) => setP({ ...p, retest_days: { ...p.retest_days, [k]: Number(e.target.value) } })}
                />
              </label>
            ))}
          </fieldset>
          <button className="hl-primary hl-small">Save profile</button>
          {error && <p className="as-error">{error}</p>}
        </form>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- forms */

function AssetForm({
  inv,
  wsId,
  initial,
  onDone,
}: {
  inv: Inventory;
  wsId: string;
  initial?: Asset;
  onDone: (i?: Inventory) => void;
}) {
  const [a, setA] = useState<Partial<Asset>>(initial || { type: "model", name: "" }),
    [error, setError] = useState("");
  const isData = a.type === "vector_store" || a.type === "data_source" || a.type === "prompt";
  const save = async () => {
    setError("");
    try {
      onDone(await api<Inventory>("/api/aisec/assets", { workspace: wsId, asset: { ...a, classification: a.classification || null, hosting: a.hosting || null } }));
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <form
      className="iv-form iv-asset-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        <span>Type</span>
        <select value={a.type} disabled={!!initial} onChange={(e) => setA({ ...a, type: e.target.value as AssetType })}>
          {Object.entries(inv.enums.asset_types).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Name</span>
        <input value={a.name || ""} required maxLength={160} onChange={(e) => setA({ ...a, name: e.target.value })} />
      </label>
      <label>
        <span>Version</span>
        <input value={a.version || ""} maxLength={80} onChange={(e) => setA({ ...a, version: e.target.value })} />
      </label>
      <label>
        <span>Vendor</span>
        <input value={a.vendor || ""} maxLength={120} onChange={(e) => setA({ ...a, vendor: e.target.value })} />
      </label>
      {a.type === "model" && (
        <label>
          <span>Where it comes from</span>
          <select value={a.hosting || ""} onChange={(e) => setA({ ...a, hosting: e.target.value || null })}>
            <option value="">Not set</option>
            {Object.entries(inv.enums.hosting).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      {isData && (
        <label>
          <span>Classification</span>
          <select value={a.classification || ""} onChange={(e) => setA({ ...a, classification: e.target.value || null })}>
            <option value="">Not set</option>
            {Object.entries(inv.enums.classifications).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="iv-wide">
        <span>Description</span>
        <input value={a.description || ""} maxLength={1000} onChange={(e) => setA({ ...a, description: e.target.value })} />
      </label>
      <span className="iv-form-actions">
        <button className="hl-primary hl-small">{initial ? "Save asset" : "Add asset"}</button>
        <button type="button" className="hl-secondary hl-small" onClick={() => onDone()}>
          Cancel
        </button>
      </span>
      {error && <p className="as-error">{error}</p>}
    </form>
  );
}

function blankApp(): Application {
  return {
    id: "",
    name: "",
    owner: "",
    description: "",
    archetype: "chat_assistant",
    classification: "internal",
    users: "internal_staff",
    channel: "internal_ui",
    autonomy: 1,
    tier: 3,
    assets: [],
    inputs: [{ id: "", kind: "user", label: "People typing to it", trusted: true }],
    actions: [],
  };
}

/** The intake questionnaire: everything the threat model needs to know about one application. */
function AppForm({
  inv,
  wsId,
  initial,
  onDone,
}: {
  inv: Inventory;
  wsId: string;
  initial?: Application;
  onDone: (saved?: { inv: Inventory; id: string }) => void;
}) {
  const [a, setA] = useState<Application>(() => {
    const base = initial ? { ...initial } : blankApp();
    delete base.threat_model;
    return base;
  });
  const [error, setError] = useState("");
  const e = inv.enums;
  const tools = inv.assets.filter((x) => x.type === "tool" || x.type === "mcp_server");
  const setInput = (i: number, patch: Partial<AppInput>) => setA({ ...a, inputs: a.inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setAction = (i: number, patch: Partial<AppAction>) => setA({ ...a, actions: a.actions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const save = async () => {
    setError("");
    try {
      const out = await api<Inventory>("/api/aisec/applications", { workspace: wsId, application: a });
      const id = a.id || out.applications.find((x) => x.name === a.name.trim())?.id || "";
      onDone({ inv: out, id });
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <form
      className="iv-form iv-app-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <h4 className="iv-wide">{initial ? "Edit application" : "New application"}</h4>
      <label>
        <span>Name</span>
        <input value={a.name} required maxLength={160} onChange={(ev) => setA({ ...a, name: ev.target.value })} />
      </label>
      <label>
        <span>Business owner</span>
        <input value={a.owner} maxLength={160} onChange={(ev) => setA({ ...a, owner: ev.target.value })} />
      </label>
      <label className="iv-wide">
        <span>What it does</span>
        <input value={a.description} maxLength={2000} onChange={(ev) => setA({ ...a, description: ev.target.value })} />
      </label>
      {(
        [
          ["archetype", "Kind of application", e.archetypes],
          ["users", "Who uses it", e.users],
          ["channel", "Where its output appears", e.channels],
          ["classification", "Most sensitive data it handles", e.classifications],
        ] as const
      ).map(([k, label, opts]) => (
        <label key={k}>
          <span>{label}</span>
          <select value={a[k]} onChange={(ev) => setA({ ...a, [k]: ev.target.value })}>
            {Object.entries(opts).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ))}
      <fieldset className="iv-wide iv-choice">
        <legend>Autonomy</legend>
        {Object.entries(e.autonomy).map(([v, t]) => (
          <label key={v}>
            <input type="radio" name="autonomy" checked={a.autonomy === Number(v)} onChange={() => setA({ ...a, autonomy: Number(v) })} />
            <b>{v}</b> {t}
          </label>
        ))}
      </fieldset>
      <fieldset className="iv-wide iv-choice">
        <legend>Criticality</legend>
        {(["1", "2", "3"] as const).map((v) => (
          <label key={v}>
            <input type="radio" name="tier" checked={a.tier === Number(v)} onChange={() => setA({ ...a, tier: Number(v) })} />
            <b>Tier {v}</b> {inv.profile.tiers[v]}
          </label>
        ))}
      </fieldset>
      <fieldset className="iv-wide iv-pick">
        <legend>Assets it uses</legend>
        {inv.assets.filter((x) => x.type !== "vendor").length === 0 && <p className="as-dim">Add or import assets first.</p>}
        {inv.assets
          .filter((x) => x.type !== "vendor")
          .map((x) => (
            <label key={x.id}>
              <input
                type="checkbox"
                checked={a.assets.includes(x.id)}
                onChange={(ev) => setA({ ...a, assets: ev.target.checked ? [...a.assets, x.id] : a.assets.filter((y) => y !== x.id) })}
              />
              {x.name} <small>{e.asset_types[x.type]}</small>
            </label>
          ))}
      </fieldset>
      <fieldset className="iv-wide iv-rows">
        <legend>Inputs: what reaches the model</legend>
        {a.inputs.map((inp, i) => (
          <div key={i} className="iv-row">
            <select aria-label="Input kind" value={inp.kind} onChange={(ev) => setInput(i, { kind: ev.target.value })}>
              {Object.entries(e.input_kinds).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
            <input aria-label="Input label" value={inp.label} maxLength={160} onChange={(ev) => setInput(i, { label: ev.target.value })} />
            <label className="iv-check">
              <input type="checkbox" checked={inp.trusted} onChange={(ev) => setInput(i, { trusted: ev.target.checked })} /> trusted source
            </label>
            <button type="button" className="hl-secondary hl-small" onClick={() => setA({ ...a, inputs: a.inputs.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="hl-secondary hl-small"
          onClick={() => setA({ ...a, inputs: [...a.inputs, { id: "", kind: "document", label: "", trusted: false }] })}
        >
          Add input
        </button>
      </fieldset>
      <fieldset className="iv-wide iv-rows">
        <legend>Actions: what it can do</legend>
        {a.actions.map((act, i) => (
          <div key={i} className="iv-row">
            <input aria-label="Action" value={act.label} required maxLength={160} placeholder="e.g. Create refund request" onChange={(ev) => setAction(i, { label: ev.target.value })} />
            <select aria-label="Effect" value={act.effect} onChange={(ev) => setAction(i, { effect: ev.target.value })}>
              {Object.entries(e.effects).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
            <select aria-label="Tool" value={act.tool || ""} onChange={(ev) => setAction(i, { tool: ev.target.value || null })}>
              <option value="">No tool asset</option>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <label className="iv-check">
              <input type="checkbox" checked={act.approval} onChange={(ev) => setAction(i, { approval: ev.target.checked })} /> needs approval
            </label>
            <button type="button" className="hl-secondary hl-small" onClick={() => setA({ ...a, actions: a.actions.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="hl-secondary hl-small"
          onClick={() => setA({ ...a, actions: [...a.actions, { id: "", label: "", effect: "read", tool: null, approval: false }] })}
        >
          Add action
        </button>
      </fieldset>
      <span className="iv-form-actions iv-wide">
        <button className="hl-primary hl-small">{initial ? "Save application" : "Create application"}</button>
        <button type="button" className="hl-secondary hl-small" onClick={() => onDone()}>
          Cancel
        </button>
      </span>
      {error && <p className="as-error iv-wide">{error}</p>}
    </form>
  );
}

/* ---------------------------------------------------------------- attack surface */

function counts(proposals: Proposal[], kind: string, id: string) {
  const mine = proposals.filter((p) => p.surface.kind === kind && p.surface.id === id);
  return { total: mine.length, accepted: mine.filter((p) => p.decision === "accepted").length };
}

/** Untrusted and trusted inputs flowing into the trust boundary, and the actions leaving it. */
function AttackSurface({
  m,
  inv,
  selected,
  onSelect,
}: {
  m: ThreatModel;
  inv: Inventory;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const app = m.application;
  const e = inv.enums;
  const Node = ({ kind, id, label, sub, cls, i, lock }: { kind: string; id: string; label: string; sub: string; cls: string; i: number; lock?: boolean }) => {
    const c = counts(m.proposals, kind, id);
    const key = kind + ":" + id;
    return (
      <button
        type="button"
        className={"iv-node " + cls + (selected === key ? " is-on" : "")}
        style={{ ["--i" as string]: i }}
        aria-pressed={selected === key}
        onClick={() => onSelect(selected === key ? "" : key)}
      >
        <strong>
          {lock && <Lock size={11} />} {label}
        </strong>
        <small>{sub}</small>
        {c.total > 0 && (
          <em title={`${c.total} proposed threats, ${c.accepted} accepted`}>
            {c.accepted}/{c.total}
          </em>
        )}
      </button>
    );
  };
  return (
    <figure className="iv-surface" aria-label={`Attack surface of ${app.name}`}>
      <div className="iv-col iv-in">
        <h5>Inputs</h5>
        {app.inputs.map((x, i) => (
          <Node key={x.id} kind="input" id={x.id} label={x.label} sub={(x.trusted ? "trusted · " : "untrusted · ") + e.input_kinds[x.kind]} cls={x.trusted ? "is-trusted" : "is-untrusted"} i={i} />
        ))}
        {!app.inputs.length && <p className="as-dim">No inputs recorded</p>}
      </div>
      <div className="iv-boundary">
        <h5>Trust boundary</h5>
        <Node kind="app" id={app.id} label={app.name} sub={`${e.archetypes[app.archetype]} · autonomy ${app.autonomy} · tier ${app.tier}`} cls="is-app" i={0} />
        <ul className="iv-inside">
          {m.assets.map((x, i) => {
            const c = counts(m.proposals, "asset", x.id);
            return (
              <li key={x.id} style={{ ["--i" as string]: i }}>
                <button type="button" className={selected === "asset:" + x.id ? "is-on" : ""} onClick={() => onSelect(selected === "asset:" + x.id ? "" : "asset:" + x.id)}>
                  <span>{x.name}</span>
                  <small>{e.asset_types[x.type]}</small>
                  {c.total > 0 && <em>{c.total}</em>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="iv-col iv-out">
        <h5>Actions</h5>
        {app.actions.map((x, i) => (
          <Node
            key={x.id}
            kind="action"
            id={x.id}
            label={x.label}
            sub={e.effects[x.effect] + (x.approval ? " · needs approval" : " · no approval")}
            cls={RISKY.has(x.effect) ? (x.approval ? "is-gated" : "is-risky") : "is-safe"}
            i={i}
            lock={x.approval}
          />
        ))}
        {!app.actions.length && <p className="as-dim">Answers only: no actions</p>}
      </div>
      <figcaption>
        <span className="iv-k is-untrusted">untrusted input</span>
        <span className="iv-k is-trusted">trusted input</span>
        <span className="iv-k is-risky">risky action, no approval</span>
        <span className="iv-k is-gated">risky action, approval</span>
        <span>Numbers: accepted / proposed threats on that surface. Select a part to filter the threat model.</span>
      </figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------------- threat model */

function ProposalRow({
  p,
  i,
  onDecide,
  openTechnique,
  busy,
}: {
  p: Proposal;
  i: number;
  onDecide: (p: Proposal, d: Proposal["decision"], note?: string) => void;
  openTechnique: (id: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState(p.note || ""),
    [writing, setWriting] = useState(false);
  useEffect(() => setNote(p.note || ""), [p.note]);
  return (
    <li className={"iv-prop" + (p.decision ? " is-" + p.decision : "")} style={{ ["--i" as string]: Math.min(i, 20) }}>
      <div className="iv-prop-main">
        <button type="button" className="iv-tech" onClick={() => openTechnique(p.technique)}>
          <code>{p.technique}</code> {p.name}
        </button>
        {p.refs
          .filter((r) => !r.startsWith("AML"))
          .map((r) => (
            <i key={r} className={"as-b as-b-" + (r.startsWith("LLM") ? "llm" : "asi")}>
              {r}
            </i>
          ))}
        <p>{p.rationale}</p>
      </div>
      <div className="iv-decide" role="group" aria-label={`Decision for ${p.technique} on ${p.surface.label}`}>
        <button type="button" className="iv-acc" aria-pressed={p.decision === "accepted"} disabled={busy} onClick={() => onDecide(p, p.decision === "accepted" ? null : "accepted", note)}>
          Accept
        </button>
        <button type="button" className="iv-rej" aria-pressed={p.decision === "rejected"} disabled={busy} onClick={() => onDecide(p, p.decision === "rejected" ? null : "rejected", note)}>
          Reject
        </button>
      </div>
      {p.decision && !writing && p.note && (
        <p className="iv-notetext">
          <b>Note</b>
          {p.note}{" "}
          <button type="button" className="as-inlink" onClick={() => setWriting(true)}>
            edit
          </button>
        </p>
      )}
      {p.decision && !writing && !p.note && !busy && (
        <button type="button" className="as-inlink iv-addnote" onClick={() => setWriting(true)}>
          {p.decision === "rejected" ? "Say why it doesn't apply" : "Add a note"}
        </button>
      )}
      {p.decision && writing && (
        <form
          className="iv-note"
          onSubmit={(e) => {
            e.preventDefault();
            onDecide(p, p.decision, note);
            setWriting(false);
          }}
        >
          <input
            aria-label="Why"
            autoFocus
            value={note}
            maxLength={1000}
            placeholder={p.decision === "rejected" ? "Why it doesn't apply" : "Why it matters, or what already covers it"}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="hl-secondary hl-small">Save</button>
          <button type="button" className="hl-secondary hl-small" onClick={() => { setNote(p.note || ""); setWriting(false); }}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

function ApplicationPage({
  appId,
  inv,
  wsId,
  back,
  openTechnique,
  onInventory,
  canEdit,
}: {
  appId: string;
  inv: Inventory;
  wsId: string;
  back: () => void;
  openTechnique: (id: string) => void;
  onInventory: (i: Inventory) => void;
  canEdit: boolean;
}) {
  const [m, setM] = useState<ThreatModel | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sel, setSel] = useState(""),
    [filter, setFilter] = useState<"all" | "undecided" | "accepted" | "rejected">("all"),
    [editing, setEditing] = useState(false);
  const top = useRef<HTMLElement>(null);
  const load = () =>
    api<ThreatModel>(`/api/aisec/threat-model?workspace=${encodeURIComponent(wsId)}&app=${encodeURIComponent(appId)}`)
      .then(setM)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    setM(null);
    setError("");
    void load();
    top.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [appId, wsId]);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      setM(await api<ThreatModel>("/api/aisec/threat-model", { workspace: wsId, app: appId, ...body }));
      onInventory(await api<Inventory>("/api/aisec/inventory?workspace=" + encodeURIComponent(wsId)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const shown = useMemo(() => {
    if (!m) return [];
    return m.proposals.filter(
      (p) => (!sel || p.surface.kind + ":" + p.surface.id === sel) && (filter === "all" || (filter === "undecided" ? !p.decision : p.decision === filter)),
    );
  }, [m, sel, filter]);
  const groups = useMemo(() => {
    const g = new Map<string, Proposal[]>();
    shown.forEach((p) => {
      const k = p.surface.kind + ":" + p.surface.id;
      g.set(k, [...(g.get(k) || []), p]);
    });
    return [...g.entries()];
  }, [shown]);
  if (editing && m)
    return (
      <AppForm
        inv={inv}
        wsId={wsId}
        initial={m.application}
        onDone={(saved) => {
          setEditing(false);
          if (saved) {
            onInventory(saved.inv);
            void load();
          }
        }}
      />
    );
  const s = m?.summary;
  const kindLabel = { input: "Input", action: "Action", asset: "Asset", app: "Whole application" } as const;
  return (
    <article className="iv-page" ref={top}>
      <nav className="as-crumbs">
        <button type="button" className="hl-secondary hl-small" onClick={back}>
          <ArrowLeft size={14} /> Inventory
        </button>
      </nav>
      {error && <p className="as-error">{error}</p>}
      {!m && !error && <p className="pg-empty">Loading…</p>}
      {m && s && (
        <>
          <header className="as-detail-head">
            <div>
              <small className="pg-kind">Application · {inv.enums.archetypes[m.application.archetype]}</small>
              <h3>{m.application.name}</h3>
              <p className="as-tags">
                <span className="as-plat">Tier {m.application.tier}</span>
                <span className="as-plat">{inv.enums.users[m.application.users]}</span>
                <span className="as-plat">{inv.enums.classifications[m.application.classification]} data</span>
                <span className="as-plat">Autonomy {m.application.autonomy}: {inv.enums.autonomy[String(m.application.autonomy)]}</span>
                {m.application.owner && <span className="as-dim">Owner: {m.application.owner}</span>}
              </p>
            </div>
            {canEdit && (
              <button type="button" className="hl-secondary hl-small" onClick={() => setEditing(true)}>
                Edit profile
              </button>
            )}
          </header>
          {m.application.description && <p className="as-lead">{m.application.description}</p>}
          <AttackSurface m={m} inv={inv} selected={sel} onSelect={setSel} />
          <section className="iv-model" aria-label="Threat model">
            <header>
              <div>
                <h4>Threat model</h4>
                <p>
                  <StatusPill s={s} /> {s.proposed ? `${s.accepted} accepted · ${s.rejected} rejected · ${s.undecided} to decide` : "Not generated yet"}
                </p>
                <Progress s={s} />
              </div>
              <span className="iv-model-actions">
                <button type="button" className="hl-secondary hl-small" disabled={busy || !canEdit} onClick={() => void act({ action: "generate" })}>
                  <RefreshCw size={13} /> {s.status === "none" ? "Generate proposals" : "Regenerate"}
                </button>
                <button
                  type="button"
                  className="hl-primary hl-small"
                  disabled={busy || !canEdit || !s.proposed || s.undecided > 0 || s.status === "accepted"}
                  onClick={() => void act({ action: "accept" })}
                  title={s.undecided ? "Decide every proposal first" : ""}
                >
                  {s.status === "accepted" ? "Threat model accepted" : "Accept threat model"}
                </button>
              </span>
            </header>
            {s.status === "stale" && <p className="as-preview">The application or its assets changed after this model was accepted. Regenerate to see what changed; earlier decisions are kept.</p>}
            {!!s.proposed && (
              <div className="as-filters" role="group" aria-label="Show">
                {(["all", "undecided", "accepted", "rejected"] as const).map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {f === "all" ? `All ${s.proposed}` : f === "undecided" ? `To decide ${s.undecided}` : f === "accepted" ? `Accepted ${s.accepted}` : `Rejected ${s.rejected}`}
                  </button>
                ))}
                {sel && (
                  <button type="button" aria-pressed onClick={() => setSel("")}>
                    Surface filter on · clear
                  </button>
                )}
              </div>
            )}
            {groups.map(([k, ps]) => (
              <section key={k} className="iv-group">
                <h5>
                  <small>{kindLabel[ps[0].surface.kind]}</small> {ps[0].surface.label}
                </h5>
                <ol>
                  {ps.map((p, i) => (
                    <ProposalRow
                      key={p.key}
                      p={p}
                      i={i}
                      busy={busy || !canEdit}
                      openTechnique={openTechnique}
                      onDecide={(pp, d, note) => void act({ action: "decide", key: pp.key, decision: d, note: note || "" })}
                    />
                  ))}
                </ol>
              </section>
            ))}
            {!!s.proposed && !groups.length && <p className="as-dim">Nothing matches this filter.</p>}
            <p className="hl-fine">
              Proposals come from explicit rules over the profile above (inputs, actions, assets, users, data and autonomy). They are a starting point
              for an analyst, not a verdict; reject what does not apply and say why.
            </p>
          </section>
        </>
      )}
    </article>
  );
}

/* ---------------------------------------------------------------- inventory page */

export function InventoryView({
  cat,
  wsId,
  wsName,
  appId,
  canEdit,
  go,
  openTechnique,
  onWorkspaceCreated,
  onInventory,
}: {
  cat: Catalog;
  wsId: string;
  wsName: string;
  appId: string | null;
  canEdit: boolean;
  go: (appId: string | null) => void;
  openTechnique: (id: string) => void;
  onWorkspaceCreated: (id: string) => void;
  onInventory?: (i: Inventory) => void;
}) {
  const [inv, setInvState] = useState<Inventory | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [form, setForm] = useState<"" | "asset" | "app">(""),
    [editAsset, setEditAsset] = useState<Asset | null>(null),
    [typeFilter, setTypeFilter] = useState<AssetType | "">("");
  const file = useRef<HTMLInputElement>(null);
  const setInv = (i: Inventory) => {
    setInvState(i);
    onInventory?.(i);
  };
  const load = () =>
    api<Inventory>("/api/aisec/inventory?workspace=" + encodeURIComponent(wsId))
      .then(setInv)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    setInvState(null);
    setError("");
    setNotice("");
    void load();
  }, [wsId]);
  const report = (r: ImportResult) =>
    setNotice(
      `Imported from ${r.source === "socharness" ? "SoCHarness" : r.source === "cyclonedx" ? "CycloneDX" : "SPDX"}: ${r.assets_added} new assets, ${r.assets_updated} updated, ${r.applications} application${r.applications === 1 ? "" : "s"}.`,
    );
  const run = async (body: Record<string, unknown>) => {
    setError("");
    setNotice("");
    try {
      const r = await api<ImportResult>("/api/aisec/import", body);
      if (r.workspace && r.workspace !== wsId) {
        onWorkspaceCreated(r.workspace);
        return;
      }
      report(r);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const onFile = async (ev: { target: HTMLInputElement }) => {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    if (f.size > 1_000_000) return setError("Files up to 1 MB can be imported.");
    await run({ workspace: wsId, text: await f.text(), filename: f.name });
  };
  const exportBom = async () => {
    try {
      download(`${wsId}-ml-bom.cdx.json`, await api("/api/aisec/export?workspace=" + encodeURIComponent(wsId)));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const remove = async (a: Asset) => {
    try {
      setInv(await api<Inventory>("/api/aisec/assets/delete", { workspace: wsId, id: a.id }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!inv) return error ? <p className="as-error">{error}</p> : <p className="pg-empty">Loading inventory…</p>;
  if (appId)
    return (
      <ApplicationPage
        key={appId}
        appId={appId}
        inv={inv}
        wsId={wsId}
        back={() => go(null)}
        openTechnique={openTechnique}
        onInventory={setInv}
        canEdit={canEdit}
      />
    );
  const visible = TYPE_ORDER.filter((t) => (typeFilter ? t === typeFilter : inv.counts[t] > 0));
  const empty = !inv.assets.length && !inv.applications.length;
  return (
    <div className="iv">
      <section className="iv-bar" aria-label="Import and export">
        <div>
          <h4>What {wsName} defends</h4>
          <p className="as-dim">An AI bill of materials and the applications built from it. Exports as a CycloneDX 1.6 ML-BOM.</p>
        </div>
        <span className="iv-bar-actions">
          {canEdit && (
            <>
              <button type="button" className="hl-secondary hl-small" onClick={() => void run({ workspace: wsId, source: "socharness" })}>
                Import SoCHarness
              </button>
              <button type="button" className="hl-secondary hl-small" onClick={() => file.current?.click()}>
                Import CycloneDX or SPDX file
              </button>
              <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e)} />
              <button type="button" className="hl-secondary hl-small" onClick={() => void run({ sample: true })}>
                Load fictional sample company
              </button>
            </>
          )}
          <button type="button" className="hl-primary hl-small" disabled={!inv.assets.length} onClick={() => void exportBom()}>
            Export ML-BOM
          </button>
        </span>
      </section>
      {notice && (
        <p className="iv-notice" role="status">
          {notice}
        </p>
      )}
      {error && <p className="as-error">{error}</p>}
      {empty && (
        <section className="as-phase">
          <p className="dd-eyebrow">Empty workspace</p>
          <h3>Start with an inventory</h3>
          <p>
            Import SoCHarness to model this lab itself, import a CycloneDX or SPDX file from your own tooling, or load the fictional Ridgeway Savings
            Bank (a made-up bank with a support assistant, a fraud model and a coding assistant) into a new workspace.
          </p>
        </section>
      )}
      <ProfileCard inv={inv} cat={cat} wsId={wsId} onSaved={setInv} />

      <section className="iv-apps" aria-label="Applications">
        <header>
          <h4>Applications · {inv.applications.length}</h4>
          {canEdit && (
            <button type="button" className="hl-secondary hl-small" aria-expanded={form === "app"} onClick={() => setForm(form === "app" ? "" : "app")}>
              New application
            </button>
          )}
        </header>
        {form === "app" && (
          <AppForm
            inv={inv}
            wsId={wsId}
            onDone={(saved) => {
              setForm("");
              if (saved) {
                setInv(saved.inv);
                if (saved.id) go(saved.id);
              }
            }}
          />
        )}
        <div className="iv-app-grid">
          {inv.applications.map((a, i) => (
            <button key={a.id} type="button" className="iv-app" style={{ ["--i" as string]: i }} onClick={() => go(a.id)}>
              <span className="iv-app-top">
                <small>{inv.enums.archetypes[a.archetype]}</small>
                <span className={"iv-tier iv-tier-" + a.tier}>Tier {a.tier}</span>
              </span>
              <strong>{a.name}</strong>
              <span className="iv-app-meta">
                {inv.enums.users[a.users]} · {inv.enums.classifications[a.classification]} data · autonomy {a.autonomy}
              </span>
              <span className="iv-app-meta">
                {a.inputs.filter((x) => !x.trusted).length} untrusted input{a.inputs.filter((x) => !x.trusted).length === 1 ? "" : "s"} ·{" "}
                {a.actions.filter((x) => RISKY.has(x.effect)).length} risky action{a.actions.filter((x) => RISKY.has(x.effect)).length === 1 ? "" : "s"}
              </span>
              <span className="iv-app-model">
                <StatusPill s={a.threat_model} />
                {a.threat_model && a.threat_model.proposed > 0 && (
                  <>
                    <Progress s={a.threat_model} />
                    <small>
                      {a.threat_model.accepted + a.threat_model.rejected}/{a.threat_model.proposed} decided
                    </small>
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="iv-bom" aria-label="AI bill of materials">
        <header>
          <h4>AI bill of materials · {inv.assets.length}</h4>
          {canEdit && (
            <button
              type="button"
              className="hl-secondary hl-small"
              aria-expanded={form === "asset"}
              onClick={() => {
                setEditAsset(null);
                setForm(form === "asset" ? "" : "asset");
              }}
            >
              Add asset
            </button>
          )}
        </header>
        {(form === "asset" || editAsset) && (
          <AssetForm
            key={editAsset?.id || "new"}
            inv={inv}
            wsId={wsId}
            initial={editAsset || undefined}
            onDone={(i) => {
              setForm("");
              setEditAsset(null);
              if (i) setInv(i);
            }}
          />
        )}
        <div className="iv-types" role="group" aria-label="Asset types">
          {TYPE_ORDER.map((t, i) => (
            <button
              key={t}
              type="button"
              aria-pressed={typeFilter === t}
              disabled={!inv.counts[t]}
              style={{ ["--i" as string]: i }}
              onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
            >
              <b>{inv.counts[t]}</b>
              <span>{inv.enums.asset_types[t]}</span>
            </button>
          ))}
        </div>
        <div className="iv-groups">
          {visible.map((t) => (
            <section key={t} className="iv-type">
              <h5>{inv.enums.asset_types[t]}</h5>
              <ul>
                {inv.assets
                  .filter((a) => a.type === t)
                  .map((a) => (
                    <li key={a.id}>
                      <div>
                        <strong>{a.name}</strong>
                        {a.version && <code>{a.version}</code>}
                        <span className="iv-asset-meta">
                          {[a.vendor, a.hosting && inv.enums.hosting[a.hosting], a.classification && inv.enums.classifications[a.classification]]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {a.description && <small>{a.description}</small>}
                      </div>
                      <span className={"iv-src iv-src-" + a.source}>{a.source}</span>
                      {canEdit && (
                        <span className="iv-asset-actions">
                          <button type="button" className="as-inlink" onClick={() => setEditAsset(a)}>
                            Edit
                          </button>
                          <button type="button" className="as-inlink" onClick={() => void remove(a)}>
                            Remove
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
