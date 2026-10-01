import { useState } from "react";
import type { Workspace } from "../useWorkspace";
import { download, safeLink } from "../lib/api";
import type { View } from "../lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";
import { Empty, JsonView, Modal, Section, Status } from "./shared";
import { ArrowUpRight, Download, Layers3 } from "lucide-react";
const labels: Record<string, string> = {
  native: "Native",
  shared: "Relay",
  partial: "Partial",
  gap: "Not integrated",
};
export function Catalog({
  w,
  configure,
  draft,
}: {
  w: Workspace;
  configure: (id: string) => void;
  draft: (text: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [filter, setFilter] = useState("all"),
    [integrated, setIntegrated] = useState(false),
    [detail, setDetail] = useState<{
      title: string;
      value: unknown;
      url?: string;
    } | null>(null);
  const inventory = w.inventory;
  if (!inventory)
    return (
      <Empty title="Loading inventory">
        The capability registry is being checked.
      </Empty>
    );
  const matches = (value: string) =>
    value.toLowerCase().includes(query.toLowerCase());
  if (w.view === "frameworks")
    return (
      <Section
        title="Choose your agent engine"
        description="Installed, enabled, and live-verified are different states. Credentials stay on the server."
        action={
          <Button variant="outline" onClick={() => void w.safe(w.refresh)}>
            Refresh checks
          </Button>
        }
      >
        <div className="toolbar">
          <Input
            aria-label="Search agent frameworks"
            placeholder="Find a runtime or capability…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Framework setup filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All runtimes</option>
            <option value="ready">Ready to configure</option>
            <option value="setup">Setup needed</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <div className="card-grid">
          {w.adapters
            .filter(
              (a) =>
                matches(a.name + " " + a.features.join(" ")) &&
                (filter === "all" ||
                  (filter === "ready" && a.available) ||
                  (filter === "setup" && a.enabled && !a.available) ||
                  (filter === "disabled" && !a.enabled)),
            )
            .map((a) => (
              <Card key={a.id} className="runtime-card">
                <CardContent>
                  <div className="card-top">
                    <span className="engine-icon">
                      <Layers3 size={18} />
                    </span>
                    <Status tone={a.available ? "good" : "neutral"}>
                      {a.available
                        ? "Ready"
                        : a.enabled
                          ? "Setup needed"
                          : "Disabled"}
                    </Status>
                  </div>
                  <h3>{a.name}</h3>
                  <p>{a.detail}</p>
                  <small>
                    {a.version || "Not installed"} · {a.verification}
                  </small>
                  <div className="chips">
                    {a.features.map((f) => (
                      <Status key={f}>{f.replaceAll("_", " ")}</Status>
                    ))}
                  </div>
                  <details>
                    <summary>Coverage & setup</summary>
                    <p>{a.budget}</p>
                    {a.key && (
                      <p>
                        Server environment: <code>{a.key}</code>. Never paste
                        credentials into chat.
                      </p>
                    )}
                    <p>
                      Not integrated:{" "}
                      {a.deferred.join(" · ") ||
                        "See capability matrix for boundaries."}
                    </p>
                    <a href={safeLink(a.docs)} target="_blank" rel="noreferrer">
                      Official documentation ↗
                    </a>
                  </details>
                  <div className="card-actions">
                    <Button
                      disabled={w.busy || !a.available}
                      onClick={() => configure(a.id)}
                    >
                      Configure
                    </Button>
                    {a.id !== "simulator" && (
                      <Button
                        variant="ghost"
                        disabled={w.busy}
                        onClick={() =>
                          void w.safe(async () => {
                            const { api } = await import("../lib/api");
                            await api("/api/adapters", {
                              id: a.id,
                              enabled: !a.enabled,
                            });
                            await w.refreshRegistry();
                          })
                        }
                      >
                        {a.enabled ? "Disable" : "Enable"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      </Section>
    );
  if (w.view === "deployment")
    return (
      <Section
        title="Pilot, with explicit boundaries"
        description="Current infrastructure checks. A deployed pilot is not a production certification."
        action={
          <Button
            variant="outline"
            onClick={() => download("relay-readiness.json", w.deployment)}
          >
            <Download />
            Export
          </Button>
        }
      >
        <div className="callout">
          <Status tone="warning">{w.deployment?.mode} mode</Status>
          <h3>
            {w.deployment?.production_ready
              ? "Production gates passed"
              : "Production gates still open"}
          </h3>
          <p>{w.deployment?.target}</p>
        </div>
        <div className="card-grid">
          {w.deployment?.gates.map((g) => (
            <Card key={g.name}>
              <CardContent>
                <Status tone={g.status === "ready" ? "good" : "neutral"}>
                  {g.status}
                </Status>
                <h3>{g.name}</h3>
                <p>{g.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    );
  const frameworks = inventory.frameworks.filter(
    (f) => !integrated || f.integrated,
  );
  const rows = inventory.rows.filter(
    (r) =>
      matches(r.label) &&
      (category === "all" || r.category === category) &&
      (filter === "all" ||
        frameworks.some((f) =>
          filter === "missing"
            ? r.cells[f.id]?.status === "gap"
            : r.cells[f.id]?.status !== "gap",
        )),
  );
  return (
    <>
      <Section
        title={
          w.view === "matrix"
            ? "Capability coverage"
            : "Your controlled tool library"
        }
        description={
          w.view === "matrix"
            ? "What Relay implements, what the SDK documents, and where the gaps remain."
            : "Scoped actions, with policy enforced on the server."
        }
        action={
          <Button
            variant="outline"
            onClick={() => download("relay-inventory.json", inventory)}
          >
            <Download />
            Export
          </Button>
        }
      >
        <div className="toolbar">
          <Input
            aria-label={
              w.view === "matrix" ? "Find a capability" : "Find a tool"
            }
            placeholder={
              w.view === "matrix" ? "Find a capability…" : "Find a tool…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {w.view === "matrix" ? (
            <>
              <select
                aria-label="Capability category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All categories</option>
                {[...new Set(inventory.rows.map((r) => r.category))].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
              <select
                aria-label="Coverage filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All coverage</option>
                <option value="covered">Has implementation</option>
                <option value="missing">Has gaps</option>
              </select>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={integrated}
                  onChange={(e) => setIntegrated(e.target.checked)}
                />
                Integrated only
              </label>
            </>
          ) : (
            <select
              aria-label="Tool effect"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All effects</option>
              <option value="read">Read</option>
              <option value="write">Write</option>
              <option value="simulation">Simulation</option>
            </select>
          )}
        </div>
        {w.view === "matrix" ? (
          <>
            <div className="chips">
              {Object.entries(labels).map(([k, v]) => (
                <Status key={k} tone={k}>
                  {v}
                </Status>
              ))}
              <small>Click any cell for its implementation boundary.</small>
            </div>
            <div
              className="matrix-scroll"
              tabIndex={0}
              aria-label="Scrollable SDK coverage matrix"
            >
              <table className="matrix">
                <thead>
                  <tr>
                    <th scope="col">Capability / family</th>
                    {frameworks.map((f) => (
                      <th key={f.id} scope="col">
                        {f.name}
                        <small>
                          {f.integrated
                            ? f.version || "Not installed"
                            : "Not integrated"}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">
                        {r.label}
                        <small>{r.category}</small>
                      </th>
                      {frameworks.map((f) => {
                        const cell = r.cells[f.id];
                        return (
                          <td key={f.id}>
                            <button
                              className={"coverage-cell " + cell.status}
                              aria-label={`${f.name}, ${r.label}: ${labels[cell.status]}`}
                              onClick={() =>
                                setDetail({
                                  title: f.name + " · " + r.label,
                                  value: {
                                    coverage: labels[cell.status],
                                    boundary: cell.note,
                                    upstream: cell.upstream,
                                    verification: f.verification,
                                  },
                                  url: cell.source,
                                })
                              }
                            >
                              {labels[cell.status]}
                              <small>{cell.upstream}</small>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="footnote">
              {rows.length} capability families · {frameworks.length}{" "}
              frameworks. {inventory.scope} Reviewed {inventory.reviewed}.
              Coverage is not proof of a live provider run.
            </p>
          </>
        ) : (
          <>
            <div className="card-grid">
              {inventory.tools
                .filter(
                  (t) =>
                    matches(t.name + " " + t.description) &&
                    (filter === "all" || filter === t.effect),
                )
                .map((t) => (
                  <Card key={t.name}>
                    <CardContent>
                      <Status tone={t.effect === "read" ? "good" : "warning"}>
                        {t.effect}
                      </Status>
                      <h3 className="tool-name">{t.name}</h3>
                      <p>{t.description}</p>
                      <small>{t.boundary}</small>
                      <div className="card-actions">
                        <Button
                          variant="outline"
                          onClick={() => setDetail({ title: t.name, value: t })}
                        >
                          Inspect tool
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            t.name === "rewind_workspace"
                              ? w.setView("lab")
                              : draft(
                                  `Help me use ${t.name} in this case. Explain the inputs and request approval before any changes.`,
                                )
                          }
                        >
                          Draft request <ArrowUpRight />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
            <h3 className="subheading">Workspace capabilities</h3>
            <div className="card-grid">
              {inventory.features.map((f) => (
                <Card key={f.name}>
                  <CardContent>
                    <h3>{f.name}</h3>
                    <p>{f.description}</p>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        w.setView(
                          ([
                            "evidence",
                            "trace",
                            "approvals",
                            "sessions",
                            "lab",
                            "frameworks",
                            "matrix",
                            "tools",
                            "deployment",
                          ].includes(f.view)
                            ? f.view
                            : "lab") as View,
                        )
                      }
                    >
                      Explore <ArrowUpRight />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </Section>
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title || "Details"}
        description="Documented capabilities and actual integration are intentionally distinguished."
      >
        <JsonView value={detail?.value} />
        {detail?.url && (
          <a href={safeLink(detail.url)} target="_blank" rel="noreferrer">
            Official documentation ↗
          </a>
        )}
      </Modal>
    </>
  );
}
