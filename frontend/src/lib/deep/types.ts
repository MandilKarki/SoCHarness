/*
 * "Under the hood" deep dives: one chapter per mechanism, each with an animated
 * diagram spec, an explanation, real code from the official API and what it
 * means for a SOC. Text fields accept `backticks` for inline code.
 */

/** Colour role of a diagram node. */
export type Tag = "you" | "core" | "model" | "tool" | "guard" | "state" | "event" | "stop";

/** One node / step. `s` is the narration shown while the step is active. */
export interface DNode {
  t: string;
  s: string;
  tag?: Tag;
  /** stack only: narration on the way back up through this layer */
  u?: string;
}

export interface Msg {
  from: number;
  to: number;
  t: string;
  s: string;
  tag?: Tag;
}

export type Diagram =
  /** Left-to-right pipeline. `back` draws a return arrow (a loop) from one step to an earlier one. */
  | { kind: "flow"; steps: DNode[]; back?: { from: number; to: number; label: string } }
  /** A cycle around a centre label; `exit` names how the cycle ends. */
  | { kind: "loop"; center: string; steps: DNode[]; exit?: string }
  /** Nested layers (outermost first) around a core; the packet goes down then back up. */
  | { kind: "stack"; layers: DNode[]; core: DNode }
  /** Sequence diagram: actors are columns, messages go between them in order. */
  | { kind: "lanes"; actors: string[]; msgs: Msg[] }
  /** A root with children (and optional grandchildren), walked depth-first. */
  | { kind: "tree"; root: DNode; children: (DNode & { children?: DNode[] })[] }
  /** Events along time; `legend` names what each tag means in this chapter. */
  | { kind: "timeline"; events: DNode[]; legend?: Partial<Record<Tag, string>> };

export interface Chapter {
  id: string;
  title: string;
  /** one-line question or claim the chapter answers */
  hook: string;
  diagram: Diagram;
  /** 2–3 short paragraphs */
  explain: string[];
  code: { lang: "python" | "ts" | "bash" | "json" | "yaml"; src: string; caption?: string };
  /** what this mechanism means for a security-operations platform */
  soc: string;
  /** official docs page for this mechanism */
  url: string;
}

export interface DeepDive {
  /** one paragraph framing the framework's internals */
  intro: string;
  chapters: Chapter[];
}
