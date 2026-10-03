import type { FrameworkDocs } from "./types";
import { claudeDocs } from "./claude";
import { pydanticDocs } from "./pydantic";
import { deepagentsDocs } from "./deepagents";
import { piDocs } from "./pi";
import { vercelDocs } from "./vercel";
import { opencodeDocs } from "./opencode";
import { openaiDocs } from "./openai";
import { googleAdkDocs } from "./google_adk";
import { microsoftDocs } from "./microsoft";
import { openhandsDocs } from "./openhands";
import { hermesDocs } from "./hermes";
export type { DocItem, DocKind, DocSection, FrameworkDocs } from "./types";
export const frameworkDocs: Record<string, FrameworkDocs> = {
  claude: claudeDocs,
  pydantic: pydanticDocs,
  deepagents: deepagentsDocs,
  pi: piDocs,
  vercel: vercelDocs,
  opencode: opencodeDocs,
  openai: openaiDocs,
  google_adk: googleAdkDocs,
  microsoft: microsoftDocs,
  openhands: openhandsDocs,
  hermes: hermesDocs,
};
