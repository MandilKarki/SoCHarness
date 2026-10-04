/*
 * Cross-framework comparison: one harness mechanism, every framework side by side.
 * Text fields accept `backticks` for inline code.
 */

/** One way of solving the mechanism; frameworks are grouped by pattern. */
export interface Pattern {
  id: string;
  name: string;
  /** one sentence: how this pattern works */
  say: string;
  /** trade-off in one sentence */
  tradeoff: string;
}

export interface Entry {
  /** Pattern id this framework uses (its primary approach). */
  pattern: string;
  /** The framework's primary API for this mechanism, e.g. "needs_approval + RunState". */
  api: string;
  /** one or two sentences: how this framework does it */
  how: string;
  /** values aligned with Mechanism.dimensions, each ≤ 60 chars */
  cells: string[];
  /** 2–8 lines of real code showing the API */
  code?: string;
  /** "python" | "ts" | "bash" | "yaml" | "json" */
  lang?: "python" | "ts" | "bash" | "yaml" | "json";
  /** id of the matching chapter in lib/deep/<fw>.ts, if one exists */
  chapter?: string;
}

export interface Mechanism {
  id: string;
  title: string;
  /** the design question this mechanism answers */
  question: string;
  /** one paragraph: why this matters when building a harness */
  why: string;
  patterns: Pattern[];
  /** column headings for the comparison table (3–4) */
  dimensions: string[];
  /** keyed by framework id: claude, pydantic, deepagents, pi, vercel, opencode, openai, google_adk, microsoft, openhands, hermes */
  entries: Record<string, Entry>;
  /** 3–5 bullets: what to choose for your own SOC agent platform, and why */
  choose: string[];
}
