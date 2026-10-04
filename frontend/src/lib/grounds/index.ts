import type { GroundDocs } from "./types";
import { socbenchDocs } from "./socbench";
import { cdbDocs } from "./cdb";
import { cage4Docs } from "./cage4";
import { agentdojoDocs } from "./agentdojo";

export type { GroundDocs, Specialty } from "./types";

/** Detailed, docs-based pages. Grounds without an entry keep their short summary only. */
export const groundDocs: Record<string, GroundDocs> = {
  socbench: socbenchDocs,
  cdb: cdbDocs,
  cage4: cage4Docs,
  agentdojo: agentdojoDocs,
};
