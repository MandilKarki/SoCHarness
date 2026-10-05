/** AI Security Lab (Phase 0): pinned threat taxonomies, workspaces and roles. Shapes mirror services/aisec. */

export type Framework = "atlas" | "owasp-llm" | "owasp-agentic";

export interface TechniqueRecord {
  id: string;
  framework: Framework;
  kind: "technique" | "subtechnique" | "risk";
  name: string;
  summary: string;
  parent: string | null;
  tactics: string[];
  platforms: string[];
  maturity: "Realized" | "Demonstrated" | "Feasible" | null;
  /** OWASP item ids for an ATLAS technique; ATLAS ids for an OWASP item */
  refs: string[];
  subtechniques: string[];
  counts: Record<string, number>;
  url: string;
}

export interface Source {
  label: string;
  url: string;
}

export interface TechniqueDetail extends Omit<TechniqueRecord, "subtechniques"> {
  subtechniques: { id: string; name: string }[] | string[];
  sources: Source[];
  description?: string;
  created?: string;
  modified?: string;
  parent_name?: string | null;
  tactic_names?: Record<string, string>;
  mitigations?: { id: string; name: string; how: string; url: string }[];
  case_studies?: { id: string; name: string; summary: string; type: string; date: string; url: string }[];
  references?: { title: string; url: string }[];
  owasp?: { id: string; name: string; list: Framework; url: string }[];
  list_name?: string;
  license?: string;
  atlas?: TechniqueRecord[];
  crosswalk_note?: string;
}

export interface TaxonomyVersion {
  id: Framework;
  name: string;
  version: string;
  released?: string | null;
  license: string;
  url: string;
  checked?: string;
  commit?: string | null;
}

export interface Role {
  label: string;
  summary: string;
  can: string[];
}

export interface Catalog {
  versions: TaxonomyVersion[];
  tactics: { id: string; name: string; summary: string; url: string }[];
  techniques: TechniqueRecord[];
  owasp: { id: Framework; name: string; edition: string; url: string; license: string; items: TechniqueRecord[] }[];
  crosswalk_note: string;
  counts: Record<string, number>;
  roles: Record<string, Role>;
  actions: Record<string, { label: string; phase: number }>;
  kinds: Record<string, string>;
  sectors: Record<string, string>;
}

export interface Workspace {
  id: string;
  name: string;
  kind: string;
  sector: string | null;
  created_at: string;
  members: { member: string; role: string; added_at: string }[];
  records: Record<string, number>;
  you: string;
}

export interface Workspaces {
  workspaces: Workspace[];
  operator: string;
  enforcement: string;
}

export interface Tracked {
  workspace: string;
  tracked: { id: string; note: string; updated_at: string }[];
}

export type SubView = "inventory" | "threats" | "intel" | "range" | "defences" | "assessments" | "vendors" | "reports";

/** The workbenches. Phases up to BUILT are live; the rest say what is coming and when. */
export const BUILT = 2;
export const SUBVIEWS: {
  id: SubView;
  label: string;
  phase: number;
  /** visible to a role that can do any of these */
  needs: string[];
  what: string;
  gate: string;
  today?: { label: string; hash: string };
}[] = [
  {
    id: "inventory",
    label: "Inventory",
    phase: 1,
    needs: ["view_threats"],
    what: "The AI bill of materials, the company profile, and each application's attack surface and threat model.",
    gate: "SoCHarness and a second, fictional enterprise both modelled, each with an accepted threat model.",
  },
  {
    id: "threats",
    label: "Threats",
    phase: 0,
    needs: ["view_threats"],
    what: "The pinned threat taxonomies, tracked per workspace.",
    gate: "Every technique tile opens a sourced detail page; the drift checker reports taxonomy versions.",
  },
  {
    id: "intel",
    label: "Intelligence",
    phase: 2,
    needs: ["view_threats"],
    what: "A feed of new AI threats, threat cards scored against this workspace, AI-enabled threats against the company, sector guidance and monthly snapshots.",
    gate: "A monthly landscape snapshot can be generated, and every high-relevance threat card links to a test or an open gap.",
  },
  {
    id: "range",
    label: "Attack range",
    phase: 3,
    needs: ["run_tests"],
    what:
      "Scenario packs for each technique family (prompt injection, tool misuse, leakage, poisoning and more), run against any connected target under the budget guards, graded automatically, with attack success rates per framework and model.",
    gate: "Every pack runs on four or more frameworks and one external endpoint, with reproducible results.",
    today: { label: "TG-10 in the test ground is the first injection scenario", hash: "grounds" },
  },
  {
    id: "defences",
    label: "Defences",
    phase: 4,
    needs: ["run_tests"],
    what:
      "A controls library you can switch on and off per run, so each control gets a measured effect (lower attack success) and a measured cost (lost task success, latency, spend).",
    gate: "Each control has a measured effect and cost on at least three technique families.",
    today: { label: "The grounding guard already runs after every Live run answer", hash: "run" },
  },
  {
    id: "assessments",
    label: "Assessments",
    phase: 5,
    needs: ["manage_findings", "view_own_findings"],
    what: "Intake, test plans per application type, the severity rubric, findings with owners and retest dates, and an evidence pack per assessment.",
    gate: "One full assessment of SoCHarness, from intake to retest.",
  },
  {
    id: "vendors",
    label: "Vendors",
    phase: 6,
    needs: ["run_tests", "view_own_scorecard"],
    what: "Vendor questionnaires built from the same taxonomy, attack-range runs against vendor test tenancies (with permission), scorecards and a log of roadmap requests.",
    gate: "One vendor or stand-in endpoint assessed, with a scorecard and tracked requests.",
  },
  {
    id: "reports",
    label: "Reports",
    phase: 7,
    needs: ["publish_reports", "view_published_reports", "view_dashboards"],
    what: "Threat deep dives, assessment reports and whitepapers built from live results, a redaction step before anything leaves the lab, and an executive dashboard.",
    gate: "A quarterly report generated from live data; a model upgrade triggers a re-run automatically.",
  },
];

export const PLATFORMS = ["Agentic AI", "Generative AI", "Predictive AI", "Enterprise"] as const;

export const FRAMEWORK_LABEL: Record<Framework, string> = {
  atlas: "MITRE ATLAS",
  "owasp-llm": "OWASP LLM Top 10",
  "owasp-agentic": "OWASP Agentic Top 10",
};

/* ---------- Phase 1: inventory and threat models ---------- */

export type AssetType = "model" | "agent" | "framework" | "tool" | "mcp_server" | "vector_store" | "prompt" | "data_source" | "vendor";

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  version: string;
  vendor: string;
  description: string;
  purl: string;
  source: string;
  classification: string | null;
  hosting: string | null;
  uses: string[];
}

export interface AppInput {
  id: string;
  kind: string;
  label: string;
  trusted: boolean;
}
export interface AppAction {
  id: string;
  label: string;
  effect: string;
  tool: string | null;
  approval: boolean;
}

export interface ModelSummary {
  status: "none" | "draft" | "accepted" | "stale";
  proposed: number;
  accepted: number;
  rejected: number;
  undecided: number;
  accepted_at?: string;
  generated_at?: string;
}

export interface Application {
  id: string;
  name: string;
  owner: string;
  description: string;
  archetype: string;
  classification: string;
  users: string;
  channel: string;
  autonomy: number;
  tier: number;
  assets: string[];
  inputs: AppInput[];
  actions: AppAction[];
  threat_model?: ModelSummary;
}

export interface EnterpriseProfile {
  sector: string | null;
  regulators: string[];
  risk_appetite: "low" | "moderate" | "high";
  appetite_note: string;
  tiers: Record<"1" | "2" | "3", string>;
  retest_days: Record<"critical" | "high" | "medium" | "low", number>;
}

export interface InventoryEnums {
  asset_types: Record<AssetType, string>;
  classifications: Record<string, string>;
  users: Record<string, string>;
  autonomy: Record<string, string>;
  tiers: Record<string, string>;
  archetypes: Record<string, string>;
  channels: Record<string, string>;
  input_kinds: Record<string, string>;
  effects: Record<string, string>;
  hosting: Record<string, string>;
}

export interface Inventory {
  workspace: string;
  profile: EnterpriseProfile;
  assets: Asset[];
  applications: Application[];
  counts: Record<AssetType, number>;
  enums: InventoryEnums;
  in_models: Record<string, string[]>;
}

export interface Proposal {
  key: string;
  technique: string;
  surface: { kind: "input" | "action" | "asset" | "app"; id: string; label: string };
  rationale: string;
  decision: "accepted" | "rejected" | null;
  note: string;
  name: string;
  framework: Framework;
  refs: string[];
  tactics: string[];
}

export interface ThreatModel {
  workspace: string;
  application: Application;
  assets: Asset[];
  summary: ModelSummary;
  proposals: Proposal[];
}

export interface ImportResult {
  source: string;
  assets_added: number;
  assets_updated: number;
  applications: number;
  workspace?: string;
}

/* ---------- Phase 2: intelligence and landscape ---------- */

export type Band = "high" | "medium" | "low" | "none";

export interface TestRef {
  kind: string;
  id: string;
  label: string;
  hash: string;
}

export interface Gap {
  card: string;
  status: "open" | "closed";
  note: string;
  owner: string;
  planned: string;
  opened_at: string;
  closed_at?: string;
  resolution?: string;
}

export interface ThreatCard {
  id: string;
  title: string;
  what: string;
  techniques: string[];
  preconditions: string[];
  components: string[];
  maturity: number;
  maturity_label: string;
  likelihood: number;
  exposure: number;
  score: number;
  band: Band;
  reasons: string[];
  apps: { id: string; name: string; tier: number; proposals: number; accepted: number; rejected: number; excluded: boolean; direct: boolean; surfaces: string[] }[];
  tests: TestRef[];
  gap: Gap | null;
  coverage: "tested" | "gap" | "none";
  case_studies: { id: string; name: string; type: string; date: string }[];
  case_study_count: number;
  recent_case_studies: number;
}

export interface FeedItem {
  id: string;
  kind: string;
  published: string | null;
  title: string;
  url: string;
  summary: string;
  techniques: string[];
  cards: string[];
  relevant: boolean;
  detail?: string;
  assets?: string[];
}

export interface RegisterEntry {
  id: string;
  title: string;
  what: string;
  techniques: string[];
  controls: { id: string; label: string; reduces: "likelihood" | "impact"; status: "in_place" | "planned" | "none" }[];
  likelihood: number;
  impact: number;
  inherent: number;
  inherent_band: string;
  residual_likelihood: number;
  residual_impact: number;
  residual: number;
  residual_band: string;
  assessed: boolean;
  owner: string;
  note: string;
  priority: boolean;
}

export interface SectorPack {
  label: string;
  guidance: { name: string; date: string; url: string; why: string }[];
  priority_cards: string[];
  priority_register: string[];
  uses: string[];
}

export interface Coverage {
  high: number;
  tested: number;
  gaps: number;
  uncovered: string[];
  ok: boolean;
}

export interface HeatMap {
  rows: { id: string; title: string; band: Band; coverage: string }[];
  cols: { id: string; name: string; tier: number }[];
  cells: Record<string, Record<string, { weight: number; state: "accepted" | "open" | "rejected"; proposals: number }>>;
}

export interface SnapshotSummary {
  month: string;
  generated_at: string;
  counts: Record<string, number>;
  coverage: Coverage;
}

export interface Snapshot extends SnapshotSummary {
  workspace: string;
  workspace_name: string;
  cards: ThreatCard[];
  heatmap: HeatMap;
  new_items: FeedItem[];
  register: RegisterEntry[];
  sector: SectorPack | null;
  markdown: string;
}

export interface IntelOverview {
  workspace: string;
  cards: ThreatCard[];
  heatmap: HeatMap;
  feed: FeedItem[];
  feed_kinds: Record<string, string>;
  register: RegisterEntry[];
  sector: SectorPack | null;
  sector_id: string | null;
  gaps: Gap[];
  coverage: Coverage;
  snapshots: SnapshotSummary[];
  advisory_check: { checked_at: string; packages: number; found: number } | null;
  risk_appetite: string;
  notes: Record<string, string>;
}
