export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Incident {
  id: string;
  title: string;
  severity: string;
  event_count: number;
  asset_count: number;
}
export interface Evidence {
  id: number;
  event_id: string;
  occurred_at: string;
  host: string;
  source: string;
  [key: string]: unknown;
}
export interface Config {
  openai_experiment?: string;
  runtime: string;
  model: string;
  permission: string;
  max_turns: number;
  budget_usd: number;
  max_output_tokens: number;
  thinking: string;
  accept_no_usd_cap: boolean;
  structured_output: boolean;
  specialists: boolean;
  skills: boolean;
  memory: boolean;
  artifacts: boolean;
  await_approvals: boolean;
  file_workspace: boolean;
  disabled_tools: string[];
}
export const defaultConfig: Config = {
  runtime: "simulator",
  model: "sonnet",
  permission: "read_only",
  max_turns: 8,
  budget_usd: 1,
  max_output_tokens: 2048,
  thinking: "off",
  accept_no_usd_cap: false,
  structured_output: false,
  specialists: false,
  skills: false,
  memory: false,
  artifacts: false,
  await_approvals: true,
  file_workspace: false,
  disabled_tools: [],
};
export interface Session {
  id: string;
  title: string;
  case_id: string;
  config: Config;
  status: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}
export interface Trace {
  seq: number;
  kind: string;
  payload: Record<string, Json>;
  created_at: string;
}
export interface Approval {
  id: string;
  tool: string;
  arguments: Record<string, Json>;
  status: string;
}
export interface SessionData {
  session: Session;
  trace: Trace[];
  approvals: Approval[];
}
export interface Adapter {
  id: string;
  name: string;
  available: boolean;
  enabled: boolean;
  version: string | null;
  verification: string;
  detail: string;
  default_model: string;
  features: string[];
  budget: string;
  trial_guard?: boolean;
  key?: string;
  docs: string;
  deferred: string[];
}
export interface Tool {
  name: string;
  description: string;
  effect: string;
  feature?: string;
  runtimes?: string[];
  boundary?: string;
}
export interface Cell {
  status: string;
  upstream: string;
  note: string;
  source: string;
  mapping_id?: string;
  pinned_version?: string;
  upstream_api?: string;
  implementation?: string | null;
  contract_suite?: string | null;
  live_status?: string;
  required_credential?: string;
}
export interface Inventory {
  reviewed: string;
  scope: string;
  frameworks: {
    id: string;
    name: string;
    docs: string;
    integrated: boolean;
    version: string;
    verification: string;
    pinned_version?: string;
    package?: string;
    version_state?: string;
    credential?: string;
    release_source?: string;
  }[];
  rows: {
    id: string;
    label: string;
    category: string;
    cells: Record<string, Cell>;
  }[];
  tools: Tool[];
  features: { name: string; description: string; view: string }[];
  metrics: Record<string, number | string>;
}
export interface Deployment {
  trial?: {
    enabled: boolean;
    limit_usd?: number;
    spendable_usd?: number;
    accounted_usd?: number;
    remaining_usd?: number;
    buffer_usd?: number;
    requests?: number;
    unsettled_requests?: number;
    expires_at?: string;
    blocked?: boolean;
    model?: string;
    scope?: string;
  };
  mode: string;
  target: string;
  production_ready: boolean;
  gates: { name: string; status: string; detail: string }[];
}
export interface Advanced {
  configuration: Config;
  questions: {
    id: string;
    question: string;
    status: string;
    answer?: string;
  }[];
  tasks: { id: string; title: string; status: string }[];
  memory: { id: string; content: string; evidence_ids: number[] }[];
  artifacts: {
    id: string;
    name: string;
    versions: { id: number; chars: number; restored_from?: number }[];
  }[];
  playbooks: Record<string, { title: string; steps: string[] }>;
  workspace: {
    enabled: boolean;
    files: { name: string; bytes: number }[];
    checkpoints: { uuid: string; seq: number }[];
  };
}
export type View =
  | "evidence"
  | "trace"
  | "approvals"
  | "sessions"
  | "lab"
  | "sdk-lab"
  | "frameworks"
  | "matrix"
  | "tools"
  | "deployment";
