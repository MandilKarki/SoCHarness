import { useState, type ReactNode } from "react";
import type { Inventory } from "../../lib/types";
import { shortName, statusLabel } from "../../lib/anatomy";
import { isRealApi } from "../../lib/frameworks";

export function JsonView({ value }: { value: unknown }) {
  return <pre className="hl-json">{JSON.stringify(value, null, 2)}</pre>;
}

/** Inventory cell glyph. Upstream-documented gaps render as a hollow "available upstream" mark. */
export function Glyph({ status, upstream }: { status: string; upstream?: string }) {
  const tone =
    status === "gap" ? (upstream === "documented" ? "upstream" : "none") : status;
  return <i className={"hl-glyph hl-g-" + tone} aria-hidden="true" />;
}
export function cellText(status: string, upstream?: string) {
  if (status !== "gap") return statusLabel[status] || status;
  return upstream === "documented" ? "Upstream feature, not wired into Relay" : "Not integrated";
}

/** Capability rows × every framework, plus the API names one framework uses for them. */
export function CapabilityGrid({
  inventory,
  rowIds,
  onOpen,
}: {
  inventory: Inventory | null;
  rowIds: string[];
  onOpen: (row: string, framework: string) => void;
}) {
  const [fw, setFw] = useState("openai");
  if (!inventory) return <p>Loading the capability inventory…</p>;
  const rows = rowIds
    .map((id) => inventory.rows.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const fws = inventory.frameworks;
  const chosen = fws.find((f) => f.id === fw) || fws[0];
  return (
    <div className="hl-cg">
      <table className="hl-cg-table">
        <thead>
          <tr>
            <th scope="col"><span className="hl-sr">Capability</span></th>
            {fws.map((f) => (
              <th key={f.id} scope="col" className={f.id === chosen?.id ? "is-on" : ""}>
                <button onClick={() => setFw(f.id)} title={f.name} aria-pressed={f.id === chosen?.id}>
                  <span>{shortName[f.id] || f.name}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">{r.label}</th>
              {fws.map((f) => {
                const c = r.cells[f.id];
                return (
                  <td key={f.id} className={f.id === chosen?.id ? "is-on" : ""}>
                    {c && (
                      <button
                        onClick={() => onOpen(r.id, f.id)}
                        title={`${f.name}: ${cellText(c.status, c.upstream)}${isRealApi(c.upstream_api) ? " · " + c.upstream_api : ""}`}
                        aria-label={`${r.label}, ${f.name}: ${cellText(c.status, c.upstream)}`}
                      >
                        <Glyph status={c.status} upstream={c.upstream} />
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Legend />
      {chosen && (
        <div className="hl-cg-api">
          <label>
            How
            <select value={chosen.id} onChange={(e) => setFw(e.target.value)}>
              {fws.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            does it
          </label>
          <dl>
            {rows.map((r) => {
              const c = r.cells[chosen.id];
              return (
                <div key={r.id}>
                  <dt>
                    <Glyph status={c?.status || "gap"} upstream={c?.upstream} /> {r.label}
                  </dt>
                  <dd>
                    {isRealApi(c?.upstream_api) ? (
                      <code>{c.upstream_api}</code>
                    ) : (
                      <span>{cellText(c?.status || "gap", c?.upstream)}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <div className="hl-legend" aria-label="Legend">
      {(
        [
          ["native", "SDK-native"],
          ["shared", "Built by Relay"],
          ["partial", "Restricted"],
          ["upstream", "Upstream only"],
          ["none", "Not integrated"],
        ] as const
      ).map(([k, label]) => (
        <span key={k}>
          <i className={"hl-glyph hl-g-" + k} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

export function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="hl-detail">
      <h4>
        {title}
        {aside}
      </h4>
      {children}
    </section>
  );
}
