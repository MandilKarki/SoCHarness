/*
 * Detailed, docs-based reference for each proving ground (benchmark, gym, range
 * content). Text fields accept `backticks` for inline code.
 */
import type { DeepDive } from "../deep/types";
import type { DocSection } from "../docs/types";

export interface Specialty {
  /** short name of the distinctive feature */
  t: string;
  /** one or two sentences */
  d: string;
}

export interface GroundDocs {
  /** official docs / paper / repo URLs this was compiled from */
  sources: { label: string; url: string }[];
  /** date checked, ISO */
  checked: string;
  /** 3–5 paragraphs describing the project from its original docs */
  overview: string[];
  /** 5–8 things that make it distinctive */
  specialties: Specialty[];
  /** reference of parameters, CLI flags, config keys, classes, metrics, tasks, attacks… grouped in sections */
  reference: DocSection[];
  /** 5–6 chapter deep dive into how it works internally (same schema as framework deep dives) */
  dive: DeepDive;
}
