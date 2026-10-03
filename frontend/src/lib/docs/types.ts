/*
 * Official-documentation reference per framework. Compiled from each framework's
 * public docs on the date in `checked`; docs track the latest release, which can
 * differ from the version pinned in Relay. `r` marks what Relay actually wires
 * ("wired") or uses in a restricted way ("partial"); unmarked = documented
 * upstream but not used here.
 */
export type DocKind =
  | "class"
  | "function"
  | "method"
  | "param"
  | "property"
  | "event"
  | "exception"
  | "type"
  | "decorator"
  | "hook"
  | "tool"
  | "config"
  | "module"
  | "concept"
  | "technique"
  | "cli";
export interface DocItem {
  n: string;
  k: DocKind;
  d: string;
  r?: "wired" | "partial";
}
export interface DocSection {
  t: string;
  url: string;
  items: DocItem[];
}
export interface FrameworkDocs {
  source: string;
  checked: string;
  sections: DocSection[];
}
/** Compact helper: "name|kind|meaning|r?" lines → items. */
export function parse(lines: string): DocItem[] {
  return lines
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [n, k, d, r] = l.split("|").map((x) => x.trim());
      return { n, k: k as DocKind, d, ...(r === "w" ? { r: "wired" as const } : r === "p" ? { r: "partial" as const } : {}) };
    });
}
