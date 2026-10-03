import type { DeepDive } from "./types";
import { claude } from "./claude";
import { pydantic } from "./pydantic";
import { deepagents } from "./deepagents";
import { pi } from "./pi";
import { vercel } from "./vercel";
import { opencode } from "./opencode";
import { openai } from "./openai";
import { google_adk } from "./google_adk";
import { microsoft } from "./microsoft";
import { openhands } from "./openhands";
import { hermes } from "./hermes";

export type { Chapter, DeepDive, Diagram, DNode, Msg, Tag } from "./types";

export const deepDives: Record<string, DeepDive> = {
  claude,
  pydantic,
  deepagents,
  pi,
  vercel,
  opencode,
  openai,
  google_adk,
  microsoft,
  openhands,
  hermes,
};
