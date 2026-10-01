import { useState } from "react";
import type { Workspace } from "../useWorkspace";
import { defaultConfig, type Config } from "../lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, Modal, Status } from "./shared";
import { errorText } from "../lib/api";
const flags = [
  "specialists",
  "skills",
  "memory",
  "artifacts",
  "file_workspace",
  "structured_output",
  "await_approvals",
] as const;
export function Settings({
  w,
  onClose,
  initialRuntime = "simulator",
  onCreated,
}: {
  w: Workspace;
  onClose: () => void;
  initialRuntime?: string;
  onCreated?: () => void;
}) {
  const [error, setError] = useState("");
  const adapter = w.adapters.find((a) => a.id === initialRuntime);
  const [config, setConfig] = useState<Config>({
    ...defaultConfig,
    runtime: initialRuntime,
    model: adapter?.default_model || defaultConfig.model,
  });
  const selected = w.adapters.find((a) => a.id === config.runtime);
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((old) => ({ ...old, [key]: value }));
  function runtime(id: string) {
    const a = w.adapters.find((x) => x.id === id);
    setConfig({
      ...defaultConfig,
      runtime: id,
      model: a?.default_model || "",
      permission: "read_only",
    });
  }
  const uncapped =
    !["claude", "simulator"].includes(config.runtime) && !selected?.trial_guard;
  return (
    <Modal
      open
      onClose={onClose}
      title="Configure an investigation"
      description="Each session preserves its own runtime and policy. Creating one does not call a model."
      wide
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void w.safe(async () => {
            setError("");
            try {
              await w.newSession({
                ...config,
                model: selected?.trial_guard
                  ? selected.default_model
                  : config.model,
              });
              onClose();
              onCreated?.();
              w.setNotice(
                "Session created. Review your prompt, then choose Send to start the run.",
              );
            } catch (e) {
              setError(errorText(e));
            }
          });
        }}
      >
        {error && (
          <div className="callout" role="alert">
            <strong>Session could not be created</strong>
            <p>{error}</p>
          </div>
        )}
        <div className="form-grid">
          <Field label="Agent runtime">
            <select
              value={config.runtime}
              onChange={(e) => runtime(e.target.value)}
            >
              {w.adapters.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.available}>
                  {a.name}
                  {!a.available ? " · setup needed" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model">
            <Input
              value={
                selected?.trial_guard ? selected.default_model : config.model
              }
              readOnly={selected?.trial_guard}
              onChange={(e) => set("model", e.target.value)}
              maxLength={120}
            />
          </Field>
        </div>
        <div className="callout">
          <Status tone={selected?.available ? "good" : "warning"}>
            {selected?.available ? "Ready to configure" : "Setup required"}
          </Status>
          <p>{selected?.detail}</p>
          <small>{selected?.budget}</small>
        </div>
        <div className="form-grid">
          <Field label="Permission policy">
            <select
              value={config.permission}
              disabled={config.runtime === "opencode"}
              onChange={(e) => set("permission", e.target.value)}
            >
              <option value="read_only">Read only · no writes</option>
              <option value="supervised">Supervised · approve writes</option>
              <option value="ask_all">Ask for every tool</option>
            </select>
          </Field>
          <Field label="Reasoning effort">
            <select
              value={config.thinking}
              disabled={!selected?.features.includes("thinking")}
              onChange={(e) => set("thinking", e.target.value)}
            >
              {["off", "minimal", "low", "medium", "high"].map((v) => (
                <option
                  key={v}
                  disabled={config.runtime === "claude" && v === "minimal"}
                >
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Maximum turns">
            <Input
              type="number"
              min={1}
              max={30}
              required
              value={config.max_turns}
              disabled={config.runtime === "opencode"}
              onChange={(e) => set("max_turns", Number(e.target.value))}
            />
          </Field>
          <Field label="Output token limit">
            <Input
              type="number"
              min={128}
              max={8192}
              required
              value={config.max_output_tokens}
              disabled={config.runtime === "opencode"}
              onChange={(e) => set("max_output_tokens", Number(e.target.value))}
            />
          </Field>
          <Field
            label="SDK budget (USD)"
            hint="Only enforced by the Claude adapter."
          >
            <Input
              type="number"
              min={0.01}
              max={25}
              step={0.01}
              required
              value={config.budget_usd}
              disabled={config.runtime !== "claude"}
              onChange={(e) => set("budget_usd", Number(e.target.value))}
            />
          </Field>
        </div>
        {uncapped && (
          <label className="check-row warning">
            <input
              type="checkbox"
              required
              checked={config.accept_no_usd_cap}
              onChange={(e) => set("accept_no_usd_cap", e.target.checked)}
            />
            <span>
              I understand this runtime does not enforce a USD spend cap.
            </span>
          </label>
        )}
        <fieldset>
          <legend>Session capabilities</legend>
          <div className="form-grid">
            {flags.map((flag) => (
              <label className="check-row" key={flag}>
                <input
                  type="checkbox"
                  checked={config[flag]}
                  disabled={
                    flag !== "await_approvals" &&
                    !selected?.features.includes(flag)
                  }
                  onChange={(e) => set(flag, e.target.checked)}
                />
                <span>{flag.replaceAll("_", " ")}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <details>
          <summary>
            Tool access · {w.tools.length - config.disabled_tools.length}{" "}
            enabled
          </summary>
          <div className="stack">
            {w.tools.map((t) => (
              <label className="check-row" key={t.name}>
                <input
                  type="checkbox"
                  checked={!config.disabled_tools.includes(t.name)}
                  onChange={(e) =>
                    set(
                      "disabled_tools",
                      e.target.checked
                        ? config.disabled_tools.filter((n) => n !== t.name)
                        : [...config.disabled_tools, t.name],
                    )
                  }
                />
                <span>
                  {t.name}
                  <small>{t.description}</small>
                </span>
              </label>
            ))}
          </div>
        </details>
        <div className="dialog-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={w.busy || !selected?.available}>
            Create session
          </Button>
        </div>
      </form>
    </Modal>
  );
}
