export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Incident {
  id: string;
  title: string;
  severity: string;
  event_count: number;
  asset_count: number;
  /** review_cohort (imported corpus) or test_ground (labelled scenario) */
  kind?: string;
}
export interface Truth {
  verdict: "malicious" | "benign" | "unknown";
  response_required: boolean;
  final_state: string;
}
export interface Scenario {
  id: string;
  name: string;
  title: string;
  playbook: string;
  lesson: string;
  truth: Truth;
  injection: boolean;
  changes?: string | null;
  evidence_ids: number[];
  observations: { source: string; domain: string; signal: string; healthy: boolean; detail: string }[];
  /** what the Defense Collective playbook logic concludes from these observations */
  decision?: { outcome: "act" | "allow" | "insufficient"; reason: string };
}
export interface Playbook {
  title: string;
  required_domains: string[];
  response_signals: string[];
  benign_signals: string[];
  operation: string;
  model_call_budget: number;
}
export interface ClaimReview {
  claims: { text: string; status: "flagged" | "unseen" | "cited" | "unchecked"; codes: string[]; cites: number[]; unseen: number[] }[];
  issues: { code: string; message: string; claim: number }[];
  counts: Record<"flagged" | "unseen" | "cited" | "unchecked", number>;
  scope: string;
}
export interface DfiqApproach {
  name: string;
  description?: string;
  tags?: string[];
  references?: string[];
  covered?: string[];
  not_covered?: string[];
  steps?: { name: string; description?: string | null; stage: string; type: string; value: string }[];
}
export interface DfiqTree {
  case_id: string;
  group: string;
  why: string;
  scenario: { id: string; name: string; description: string };
  facets: { id: string; name: string; questions: { id: string; name: string; description: string; tags: string[]; approaches: DfiqApproach[] }[] }[];
  source: { url: string; revision: string; license: string };
}
export interface Grade {
  case_id: string;
  session_id?: string;
  runtime?: string;
  model?: string;
  created_at?: string;
  verdict: Truth["verdict"] | null;
  verdict_raw: string | null;
  response_required: boolean | null;
  containment_attempted: boolean;
  verdict_ok: boolean;
  response_ok: boolean;
  score: number;
  max_score: number;
  evidence_read: number;
  evidence_total: number;
  injection: "obeyed" | "resisted" | "unclear" | null;
  flags: string[];
  read_ids?: number[];
  grounding?: Record<string, number> | null;
  completed: boolean;
  truth: Truth;
}
export interface TestGround {
  source: string;
  revision: string;
  note: string;
  prompt: string;
  playbooks?: Record<string, Playbook>;
  scenarios: Scenario[];
  results: Grade[];
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
  installed?: boolean;
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
    live_evidence?: unknown;
    release_source?: string;
  }[];
  rows: {
    id: string;
    label: string;
    category: string;
    cells: Record<string, Cell>;
  }[];
  candidates?: { id: string; status: string; docs: string }[];
  tools: Tool[];
  features: { name: string; description: string; view: string }[];
  metrics: Record<string, number | string>;
}
export interface Allowance {
  enabled: boolean;
  provider?: string;
  limit_usd?: number;
  spendable_usd?: number;
  accounted_usd?: number;
  remaining_usd?: number;
  buffer_usd?: number;
  requests?: number;
  unsettled_requests?: number;
  expires_at?: string;
  blocked?: boolean;
  halted?: boolean;
  model?: string;
  runtimes?: string[];
  scope?: string;
}
export interface Deployment {
  /** Anthropic-key frameworks (Claude, Pydantic AI, Deep Agents, Pi), metered per request. */
  anthropic_trial?: Allowance;
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
