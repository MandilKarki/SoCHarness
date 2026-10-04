import { Fragment, useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import type { Inventory, Trace } from "../../lib/types";
import { parts, shortName, type PartId } from "../../lib/anatomy";
import { safeLink } from "../../lib/api";
import { Glyph, Legend, Section, cellText } from "./shared";
import type { Adapter } from "../../lib/types";
import { isRealApi } from "../../lib/frameworks";
import { FrameworkGallery, FrameworkPage } from "./FrameworkPages";

export type Focus = { kind: "cell"; row: string; fw: string } | { kind: "fw"; fw: string } | null;

const rank = (c: string) => (order.indexOf(c) < 0 ? 99 : order.indexOf(c));
const order = ["Execution", "Governance", "Tools", "State", "Collaboration", "Operations", "Modalities"];

export function FrameworksView({
  hidden,
  inventory,
  focus,
  setFocus,
  onPart,
  page,
  onPage,
  adapters,
  onRun,
  running,
  lastRun,
}: {
  hidden: boolean;
  inventory: Inventory | null;
  focus: Focus;
  setFocus: (f: Focus) => void;
  onPart: (id: PartId) => void;
  page: string | null;
  onPage: (id: string | null) => void;
  adapters: Adapter[];
  onRun: (id: string) => void;
  running: boolean;
  lastRun?: { runtime: string; trace: Trace[] };
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [a, setA] = useState("openai"),
    [b, setB] = useState(""),
    [diffOnly, setDiffOnly] = useState(false);
  const fws = inventory?.frameworks || [];
  const categories = useMemo(
    () =>
      [...new Set((inventory?.rows || []).map((r) => r.category))].sort((x, y) => rank(x) - rank(y)),
    [inventory],
  );
  const q = query.trim().toLowerCase();
  const rows = (inventory?.rows || []).filter(
    (r) =>
      (category === "All" || r.category === category) &&
      (!q ||
        r.label.toLowerCase().includes(q) ||
        Object.values(r.cells).some(
          (c) => (c.upstream_api || "").toLowerCase().includes(q) || c.note.toLowerCase().includes(q),
        )) &&
      (!diffOnly || !b || r.cells[a]?.status !== r.cells[b]?.status),
  );
  const grouped = categories
    .map((c) => [c, rows.filter((r) => r.category === c)] as const)
    .filter(([, rs]) => rs.length);
  const counts = (fw: string) => {
    const out = { native: 0, shared: 0, partial: 0, gap: 0 } as Record<string, number>;
    inventory?.rows.forEach((r) => {
      const s = r.cells[fw]?.status;
      if (s) out[s] = (out[s] || 0) + 1;
    });
    return out;
  };
  const partFor = (row: string) => parts.find((p) => p.rows.includes(row));

  let inspector: React.ReactNode;
  if (focus?.kind === "cell" && inventory) {
    const row = inventory.rows.find((r) => r.id === focus.row);
    const fw = fws.find((f) => f.id === focus.fw);
    const c = row?.cells[focus.fw];
    const part = row && partFor(row.id);
    inspector =
      row && fw && c ? (
        <>
          <div className="hl-insp-nav">
            <span className="hl-status"><Glyph status={c.status} upstream={c.upstream} /> {cellText(c.status, c.upstream)}</span>
          </div>
          <h3>{row.label}</h3>
          <p className="hl-desc">
            <button className="hl-link" onClick={() => onPage(fw.id)}>{fw.name}</button>
            , {row.category.toLowerCase()} capability
          </p>
          {isRealApi(c.upstream_api) && (
            <Section title="Upstream API">
              <code className="hl-code">{c.upstream_api}</code>
            </Section>
          )}
          <Section title="Upstream support">
            <p>{c.upstream === "documented" ? "Documented by the framework." : c.upstream === "not assessed" ? "Not assessed. Unknown is not the same as absent." : c.upstream}</p>
          </Section>
          <Section title="In Relay">
            <p>{c.note}</p>
            {c.implementation && <p><code>{c.implementation}</code></p>}
            {c.contract_suite && <p className="hl-fine">Tests: <code>{c.contract_suite}</code></p>}
            {c.live_status && <p className="hl-fine">Live verification: {c.live_status}</p>}
          </Section>
          {part && (
            <Section title="Harness part">
              <button className="hl-link" onClick={() => onPart(part.id)}>{part.name}: what it is and how to build it</button>
            </Section>
          )}
          {safeLink(c.source) && (
            <a className="hl-ext" href={safeLink(c.source)} target="_blank" rel="noreferrer">
              {fw.name} documentation <ArrowUpRight size={13} />
            </a>
          )}
        </>
      ) : null;
  } else if (focus?.kind === "fw" && inventory) {
    const fw = fws.find((f) => f.id === focus.fw);
    const n = counts(focus.fw);
    const total = inventory.rows.length;
    inspector = fw ? (
      <>
        <div className="hl-insp-nav">
          <span className={"hl-status hl-status-" + (fw.integrated ? "current" : "target")}>
            {fw.integrated ? "Adapter integrated" : "Not integrated"}
          </span>
        </div>
        <h3>{fw.name}</h3>
        <dl className="hl-kv">
          {fw.package && (<><dt>Package</dt><dd><code>{String(fw.package)}</code></dd></>)}
          {(fw.pinned_version || fw.version) && (<><dt>Version</dt><dd>{String(fw.pinned_version || fw.version)}</dd></>)}
          {fw.credential && (<><dt>Credential</dt><dd>{String(fw.credential)}</dd></>)}
          <dt>Verification</dt>
          <dd>{fw.verification}</dd>
        </dl>
        <Section title={`Coverage of ${total} capability families`}>
          <div className="hl-bar" role="img" aria-label={`${n.native} SDK-native, ${n.shared} built by Relay, ${n.partial} restricted, ${n.gap} not integrated`}>
            {(["native", "shared", "partial", "gap"] as const).map((k) =>
              n[k] ? <i key={k} className={"hl-bar-" + k} style={{ flexGrow: n[k] }} /> : null,
            )}
          </div>
          <ul className="hl-bar-key">
            <li><Glyph status="native" />{n.native} SDK-native</li>
            <li><Glyph status="shared" />{n.shared} built by Relay</li>
            <li><Glyph status="partial" />{n.partial} restricted</li>
            <li><Glyph status="gap" />{n.gap} not integrated</li>
          </ul>
        </Section>
        <Section title="Framework page">
          <button className="hl-secondary hl-small" onClick={() => onPage(fw.id)}>
            Open the {fw.name} page
          </button>
        </Section>
        <Section title="Compare">
          <div className="hl-row">
            <button className="hl-secondary hl-small" onClick={() => setA(fw.id)}>Set as A</button>
            <button className="hl-secondary hl-small" onClick={() => setB(fw.id)}>Set as B</button>
          </div>
        </Section>
        {safeLink(fw.docs) && (
          <a className="hl-ext" href={safeLink(fw.docs)} target="_blank" rel="noreferrer">
            Documentation <ArrowUpRight size={13} />
          </a>
        )}
      </>
    ) : null;
  }

  if (page)
    return (
      <div className="hl-frameworks" hidden={hidden}>
        <FrameworkPage
          id={page}
          inventory={inventory}
          adapters={adapters}
          onBack={() => onPage(null)}
          onOpen={onPage}
          onCell={(row, fw) => {
            setFocus({ kind: "cell", row, fw });
            onPage(null);
          }}
          onRun={onRun}
          running={running}
          lastRun={lastRun}
        />
      </div>
    );
  return (
    <div className="hl-frameworks" hidden={hidden}>
      <div className="hl-view-head">
        <div>
          <h2>Eleven frameworks, one harness</h2>
          <p>
            Each page shows the framework's design, an animated walkthrough of how it runs inside Relay with its real
            API names, its capability profile and what it needs to run live.
          </p>
        </div>
      </div>
      <FrameworkGallery inventory={inventory} adapters={adapters} onOpen={onPage} />
      <div className="hl-view-head fw-matrix-head">
        <div>
          <h2>Every capability, side by side</h2>
          <p>
            {inventory
              ? `${inventory.rows.length} capability families across ${fws.length} frameworks. `
              : ""}
            Each cell says whether the SDK does it natively, Relay built it around the SDK, or it isn't wired in. Select a cell to see the actual API.
          </p>
        </div>
        <Legend />
      </div>

      <div className="hl-matrix-layout">
        <div className="hl-matrix-col">
      <div className="hl-toolbar">
          <label className="hl-search">
            <Search size={14} aria-hidden="true" />
            <span className="hl-sr">Search capabilities</span>
            <input
              type="search"
              placeholder="Capability, API or note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="hl-chips" role="radiogroup" aria-label="Category">
            {["All", ...categories].map((c) => (
              <button key={c} role="radio" aria-checked={category === c} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="hl-compare">
            <label>
              A
              <select value={a} onChange={(e) => setA(e.target.value)}>
                {fws.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label>
              B
              <select value={b} onChange={(e) => setB(e.target.value)}>
                <option value="">None</option>
                {fws.filter((f) => f.id !== a).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="hl-check hl-check-inline">
              <input type="checkbox" checked={diffOnly} disabled={!b} onChange={(e) => setDiffOnly(e.target.checked)} />
              <span>Only differences</span>
            </label>
          </div>
        </div>

        <div className="hl-matrix-scroll">
          {!inventory ? (
            <p className="hl-pad">Loading the capability inventory…</p>
          ) : (
            <table className="hl-matrix">
              <thead>
                <tr>
                  <th scope="col" className="hl-mx-label">Capability</th>
                  {fws.map((f) => (
                    <th
                      key={f.id}
                      scope="col"
                      className={(f.id === a ? "is-a" : "") + (f.id === b ? " is-b" : "")}
                    >
                      <button
                        aria-pressed={focus?.kind === "fw" && focus.fw === f.id}
                        onClick={() => setFocus({ kind: "fw", fw: f.id })}
                        title={f.name}
                      >
                        {f.id === a && <em>A</em>}
                        {f.id === b && <em>B</em>}
                        {shortName[f.id] || f.name}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map(([cat, rs]) => (
                  <Fragment key={cat}>
                    <tr className="hl-mx-cat">
                      <th colSpan={fws.length + 1} scope="colgroup">{cat}<small>{rs.length}</small></th>
                    </tr>
                    {rs.map((r) => {
                      const differs = b && r.cells[a]?.status !== r.cells[b]?.status;
                      return (
                        <tr key={r.id} className={differs ? "is-diff" : ""}>
                          <th scope="row" className="hl-mx-label">{r.label}</th>
                          {fws.map((f) => {
                            const c = r.cells[f.id];
                            const on = focus?.kind === "cell" && focus.row === r.id && focus.fw === f.id;
                            return (
                              <td key={f.id} className={(f.id === a ? "is-a" : "") + (f.id === b ? " is-b" : "")}>
                                {c && (
                                  <button
                                    aria-pressed={on}
                                    aria-label={`${r.label}, ${f.name}: ${cellText(c.status, c.upstream)}`}
                                    title={isRealApi(c.upstream_api) ? String(c.upstream_api) : cellText(c.status, c.upstream)}
                                    onClick={() => setFocus({ kind: "cell", row: r.id, fw: f.id })}
                                  >
                                    <Glyph status={c.status} upstream={c.upstream} />
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {!grouped.length && (
                  <tr>
                    <td colSpan={fws.length + 1} className="hl-pad">
                      No capability matches. Clear the search or choose another category.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        </div>
        <aside className="hl-inspector" aria-live="polite" aria-label="Capability details">
          {inspector || (
            <div className="hl-inspector-empty">
              <h3>Reading the map</h3>
              <p>
                A green mark means the framework itself does this and Relay uses it. Cyan means
                Relay built it around the SDK, which is how you would add it to your own platform.
                A hollow mark means the framework documents it, but it isn't wired in here.
              </p>
              <p>Select any cell for the API name, or a framework name for its profile.</p>
              {!!inventory?.candidates?.length && (
                <Section title="Candidates not yet integrated">
                  <ul className="hl-files">
                    {inventory.candidates.map((c) => (
                      <li key={c.id}>
                        <code>{c.id}</code>
                        {safeLink(c.docs) ? (
                          <a className="hl-ext" href={safeLink(c.docs)} target="_blank" rel="noreferrer">
                            documentation <ArrowUpRight size={12} />
                          </a>
                        ) : (
                          <span>{c.status}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
