import type { GroundDocs } from "./types";
import { parse } from "../docs/types";

const REV = "e8b86d01ccefe338d455e61505ca285943635b27";
const G = `https://github.com/simbianai/cyber_defense_benchmark/blob/${REV}/`;

export const cdbDocs: GroundDocs = {
  sources: [
    { label: "README (pinned revision)", url: G + "README.md" },
    { label: "datasets/README.md", url: G + "datasets/README.md" },
    { label: "Environment (benchmark/gym.py)", url: G + "benchmark/gym.py" },
    { label: "Agent harness (benchmark/harness.py)", url: G + "benchmark/harness.py" },
    { label: "Scorer (benchmark/scorer.py)", url: G + "benchmark/scorer.py" },
    { label: "Paper, arXiv 2604.19533", url: "https://arxiv.org/abs/2604.19533" },
  ],
  checked: "2026-10-04",
  overview: [
    "The Cyber Defense Benchmark measures LLM agents at open-ended threat hunting: given a generic briefing and a database of Windows and Sysmon event logs, find the exact timestamps of malicious events. There are no guided questions. It was built by Simbian AI and described in the paper by Chona, Kozlov and Kumar (arXiv 2604.19533, 2026).",
    "Per the paper, the benchmark wraps 106 real attack procedures from the OTRF Security-Datasets corpus, covering 86 MITRE ATT&CK sub-techniques across 12 tactics, into a Gymnasium environment over SQLite databases of 75,000 to 135,000 records. The public repository ships one sample campaign: seed 176, 155,350 log records, 3,912 flags across 3 attack chains and 9 tactics. The full multi-seed dataset is distributed separately on request.",
    "Each episode loads `sample.json` into an in-memory SQLite table called `logs` (487 text columns plus `id` and `raw_json`). The agent acts once per turn: run a SQL query, submit timestamps, or give up. Query results come back as JSON text capped at 10 rows. Ground truth lives in `sample_flags.json`, which the environment never reads.",
    "Scoring happens after the hunt. Submitted timestamps are canonicalized to UTC microseconds and matched exactly against flag values. Matches are rolled up per attack step, then per ATT&CK tactic, then averaged into `coverage_score_per_run`. The plotting step adds per-turn coverage curves, a cost-versus-coverage Pareto view and a per-tactic radar.",
    "It is a good test of query planning, evidence narrowing and timestamp precision on realistic host telemetry, and the harness is replaceable with your own agent. Coverage rewards finding evidence and has no false-positive penalty, so it says nothing about precision. The paper reports that the best of five frontier models found correct flags for only 3.8% of malicious events on average.",
  ],
  specialties: [
    { t: "Unguided hunting, not Q&A", d: "The agent gets a generic briefing and must decide what to look for. There are no questions pointing at the attack." },
    { t: "Real attack telemetry", d: "Campaigns are built from OTRF Security-Datasets procedures mapped to ATT&CK, inside large volumes of ordinary Windows and Sysmon events." },
    { t: "SQL as the action space", d: "Every observation is the result of the agent's own query against one `logs` table, so query design is the core skill measured." },
    { t: "Ground truth outside the env", d: "The environment carries no flags and returns zero reward. Scoring matches submitted timestamps post hoc against a separate flags file." },
    { t: "Tactic-weighted coverage", d: "Flags are grouped by attack step and tactic, so finding many events in one step cannot hide missing whole tactics." },
    { t: "Swappable harness contract", d: "Any agent that implements `run(env, model) -> dict` and returns submitted timestamps can be scored by the same pipeline." },
    { t: "Cost and turns recorded", d: "Each hunt stores tokens, USD cost and a per-turn trace, feeding cost-versus-coverage and coverage-over-turns plots." },
  ],
  reference: [
    {
      t: "CLI entry points",
      url: G + "README.md",
      items: parse(`
cdb-run|cli|Single (data, model) smoke run via \`benchmark.run\`; prints the hunt result JSON
--data|param|Path to the data file (default datasets/sample.json); sample.zip is unpacked on first run
--model|param|LiteLLM model string, e.g. \`openai/gpt-5\` or \`anthropic/claude-sonnet-4-7\`
--max-queries|param|Query count told to the agent (default 50); also sets the 1.5x turn safety cap
--max-iterations / --temperature|param|Accepted for symmetry; not forwarded by \`harness.run\` at this revision
cdb-runner|cli|Run every model in models.txt for N rollouts and write one hunt JSON each
--models-file / --config / --cost-file|param|Paths to models.txt, runner_config.json and reference/cost.json
--rollouts|param|Override rollouts from runner_config.json
--yes|param|Skip the cost-estimate confirmation prompt
--yes-unknown-cost|param|Allow models missing from cost.json
--resume|param|Skip runs whose hunt JSON already exists
--max-workers|param|Upper bound on the thread pool (default 4); per-provider concurrency takes precedence
--hunts-dir|param|Output directory for hunt JSONs (default benchmark/hunts/)
cdb-plots|cli|Score all hunts and render diff, pareto and radar plots under outputs/
--flags / --tactics / --outputs-dir|param|Ground-truth file, tactic name map and output directory for cdb-plots
make hunts / make plots / make all|cli|Makefile wrappers for the runner and plot steps
`),
    },
    {
      t: "Configuration and environment",
      url: G + "benchmark/runner_config.json",
      items: parse(`
rollouts|config|Hunts per model (default 5)
max_queries|config|Query budget passed to the harness (default 50)
max_iterations|config|Recorded in hunt config (80); not used by the harness loop
max_cost_usd_per_run|config|Loaded (default null) but not passed to the harness at this revision
temperature|config|Recorded (0.0); the harness uses each model's default sampling
timeout_s|config|Per-call LiteLLM request timeout (default 120)
provider_concurrency|config|Parallel hunts per provider: openai, anthropic, gemini, fireworks_ai 1; vertex_ai 10
models.txt|config|LiteLLM model strings to run, one per line; lines starting with # are ignored
reference/cost.json|config|Expected per-run cost per model for the pre-launch estimate; not a billing source
OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY|config|Provider keys; also GOOGLE_API_KEY, FIREWORKS_API_KEY, VERTEXAI_PROJECT, VERTEXAI_LOCATION
LITELLM_MAX_BUDGET|config|Sets \`litellm.max_budget\` in USD for the session
LITELLM_MAX_TOKENS|config|Max tokens per request (code default 4096; .env.example sets 16384)
LITELLM_DEBUG|config|1 for one INFO line per call, 2 for full request and response debug logs
`),
    },
    {
      t: "ThreatHuntEnv",
      url: G + "benchmark/gym.py",
      items: parse(`
ThreatHuntEnv|class|Gymnasium env over an in-memory SQLite log database; args data_path, max_queries (50), schema_path
reset()|method|Opens a fresh database, inserts all logs, returns (briefing, info)
step(action)|method|Executes one SQL string; returns (observation, 0.0, terminated, truncated, info)
action_space|property|Text of up to 4000 characters: a single SQL statement
observation_space|property|Text of up to 50,000 characters: briefing on reset, query result on step
truncated|property|True once query_count exceeds max_queries; the last allowed query carries a warning
terminated|property|Always False in the public env, which has no ground truth
info|property|seed, n_logs, row_limit, schema_help, query_count, max_queries, query, query_result, query_error
get_schema_help()|method|Schema and example queries to paste into the system prompt
query_row_limit|property|Rows shown per query (10, from log_schema.json)
query(sql)|method|One-off helper for tests; does not advance the query counter
set_get_flags_in_submitted()|method|No-op stub returning []; flag matching happens only in the scorer
logs table|concept|id, 487 TEXT columns named after Windows and Sysmon fields, and raw_json; indexes on EventID, Computer, Hostname, User
Observation text|concept|\`Query:\`, optional warning, then \`Results (shown of total rows):\` and JSON rows, or \`Error: <type>: <message>\`
`),
    },
    {
      t: "Agent actions and outcomes",
      url: G + "benchmark/harness.py",
      items: parse(`
HunterAction|class|Structured output the model must return each turn (Pydantic, no LiteLLM tool calling)
reasoning|param|Required free-text reasoning for the turn
tool|param|One of \`run_sql\`, \`submit_flags\`, \`give_up\`
sql_query|param|Required for run_sql and must be empty otherwise
submitted_timestamps|param|ISO timestamps; required for submit_flags; 6-digit microseconds with Z suffix requested
run_sql|tool|Executes the query through env.step and uses one query
submit_flags|tool|Buffers new timestamps for scoring; does not use a query but does use a turn
give_up|tool|Ends the hunt early
MAX_AGENT_ERRORS_PER_TURN|config|5 agent errors (bad SQL, invalid output) in one turn end the episode
MAX_CONNECTIVITY_ERRORS_PER_TURN|config|5 connectivity errors per turn before the turn fails
Turn safety cap|concept|The loop stops once turns reach 1.5 times max_queries
RunOutcome|type|terminated, truncated, turn_limit, gave_up, error, in_progress
run(env, model)|function|Harness contract; returns model, outcome, turns, submitted_timestamps, cost_usd, tokens, elapsed_s, per_turn, queries_used, seed
`),
    },
    {
      t: "Dataset and flags",
      url: G + "datasets/README.md",
      items: parse(`
sample.zip|module|Tracked 12 MB archive, unpacked into sample.json and sample_flags.json on first run
sample.json|module|\`{briefing, seed, logs}\`; the only file the harness sees at run time
briefing|property|Generic threat briefing text; a default briefing is used if missing
sample_flags.json|module|Opaque ground truth used only by the scorer and plotting
tactic_ids|property|ATT&CK tactic ids present in the campaign
chains[].steps[]|property|Attack tree: chain_idx, step_idx and the tactics covered at that step
flags[].value|property|Malicious-event timestamp in canonical UTC ISO-8601
flags[].narrative_steps|property|Narrative step ids this flag evidences; the unit of coverage
flags[].relevance|property|Diagnostic relevance (1 or 2 in the sample)
reference/tactics.json|config|TA#### to tactic name map used by the radar plot
`),
    },
    {
      t: "Scoring outputs",
      url: G + "benchmark/scorer.py",
      items: parse(`
score_hunt(hunt, sample_flags)|function|Scores one hunt dict using only submitted_timestamps and per_turn
score_hunt_file(path, flags)|function|Reads a runner hunt JSON, scores its result, adds model, provider, rollout, cost and outcome
per_step_ratio|property|Per (chain, step): detected narrative steps over coverable narrative steps
coverage_score_per_tactic|property|Mean step ratio over steps tagged with the tactic; NaN if no step covers it
coverage_score_per_run|property|Mean over tactics with a defined score; the headline number
n_flags_total / n_flags_detected|property|Flag count and flags whose value was submitted
flags_pct_detected|property|n_flags_detected over n_flags_total
submitted_count|property|Distinct canonical timestamps submitted
per_turn trace|property|Scorer reads \`n_new_submitted\`, but the harness writes \`new_timestamps\`, which make_plots uses for its per-turn curve
diff / pareto / radar|module|Coverage over turns, mean cost against mean coverage with frontier, per-tactic coverage per model
`),
    },
  ],
  dive: {
    intro:
      "The benchmark is three separable pieces: a Gymnasium environment that only runs SQL, a LiteLLM harness that turns model output into actions, and a scorer that alone knows where the attack is. Knowing where each limit and each piece of ground truth lives explains both what the score means and how to plug in your own agent.",
    chapters: [
      {
        id: "env",
        title: "The environment: SQL in, text out",
        hook: "What does the agent actually touch?",
        diagram: {
          kind: "lanes",
          actors: ["Harness", "ThreatHuntEnv", "LogDatabase", "SQLite"],
          msgs: [
            { from: 0, to: 1, t: "reset()", s: "Starts an episode. The env opens a fresh in-memory database and resets the query counter.", tag: "you" },
            { from: 1, to: 2, t: "open() + insert(logs)", s: "Creates the `logs` table from log_schema.json and inserts every record, mapping field aliases.", tag: "core" },
            { from: 1, to: 0, t: "briefing, info", s: "The observation is the briefing; info carries schema_help, row_limit, n_logs and max_queries.", tag: "state" },
            { from: 0, to: 1, t: "step(sql)", s: "One SQL string is one query. The counter increments before execution.", tag: "tool" },
            { from: 2, to: 3, t: "execute + fetchall", s: "The statement runs as given. All rows are fetched, then only the first 10 are kept.", tag: "tool" },
            { from: 1, to: 0, t: "obs, 0.0, False, truncated", s: "Text observation with shown and total row counts, or the SQLite error. Reward is always zero.", tag: "event" },
          ],
        },
        explain: [
          "The action space is a single SQL statement of up to 4000 characters and the observation is text. Errors such as syntax mistakes come back in the observation and in `info['query_error']`, so the agent can correct itself. Truncation fires when the query count exceeds `max_queries`, and the final allowed query carries a warning.",
          "The env does not filter statement types: a DELETE or UPDATE runs against the episode's in-memory copy. It also never sees the flags file, so `terminated` stays False and reward stays 0.0. Any wrapper that needs read-only access or output caps must add them itself.",
        ],
        code: {
          lang: "python",
          caption: "Driving the env directly, as a custom harness would.",
          src: `from benchmark.gym import ThreatHuntEnv

env = ThreatHuntEnv("datasets/sample.json", max_queries=50)
obs, info = env.reset()
print(info["n_logs"], info["row_limit"], info["max_queries"])

obs, reward, terminated, truncated, info = env.step(
    'SELECT "TimeCreated", "Computer", "CommandLine" FROM logs '
    "WHERE \\"CommandLine\\" LIKE '%powershell%' LIMIT 10"
)
print(obs)          # Query: ... / Results (N rows): [...]
print(info["query_error"], info["query_count"])
env.close()`,
        },
        soc: "A hunting agent's tool should return counts and small samples, not raw dumps, and should be read-only by construction. This env shows the first property and leaves the second to you.",
        url: G + "benchmark/gym.py",
      },
      {
        id: "turn",
        title: "One turn: the HunterAction contract",
        hook: "How does model output become an action?",
        diagram: {
          kind: "tree",
          root: { t: "HunterAction", s: "Each turn the model must return one JSON object with `reasoning` and `tool`, validated by Pydantic.", tag: "model" },
          children: [
            { t: "run_sql", s: "`sql_query` required. Runs through env.step, uses one query and one turn.", tag: "tool" },
            { t: "submit_flags", s: "`submitted_timestamps` required. New strings are buffered for the scorer; no query is used.", tag: "state" },
            { t: "give_up", s: "Both other fields must be empty. The episode ends with outcome gave_up.", tag: "stop" },
            {
              t: "Invalid or empty output",
              s: "The harness nudges the model and retries within the turn's error budget.",
              tag: "guard",
              children: [
                { t: "5 errors in a turn", s: "Five agent errors in one turn end the episode with outcome error.", tag: "stop" },
              ],
            },
          ],
        },
        explain: [
          "The harness uses structured output through LiteLLM rather than tool calling. Field rules are enforced by a validator: `sql_query` only with run_sql, `submitted_timestamps` only with submit_flags. For qwen models an extra system-prompt block pins the exact key names, because the authors found those models ignored the response format.",
          "The system prompt includes the schema help, the 10-row cap, the query budget and the timestamp format: six-digit microseconds with a Z suffix, copied raw from results. Submissions are deduplicated as exact strings; the scorer later canonicalizes them.",
        ],
        code: {
          lang: "json",
          caption: "Two valid HunterAction outputs (fields from benchmark/harness.py).",
          src: `{
  "reasoning": "Look for encoded PowerShell launched by Office processes.",
  "tool": "run_sql",
  "sql_query": "SELECT \\"TimeCreated\\", \\"CommandLine\\" FROM logs LIMIT 10"
}
{
  "reasoning": "These two process creations match the pattern.",
  "tool": "submit_flags",
  "submitted_timestamps": ["2026-01-14T00:06:46.532856Z"]
}`,
        },
        soc: "Give the hunting agent an explicit commit action separate from querying. It forces the agent to state evidence as concrete event references, which is what an analyst needs to review.",
        url: G + "benchmark/harness.py",
      },
      {
        id: "episode",
        title: "How an episode ends",
        hook: "Which limit actually stops a hunt?",
        diagram: {
          kind: "loop",
          center: "Hunt loop",
          exit: "truncated, turn_limit, gave_up or error",
          steps: [
            { t: "think(obs)", s: "The model sees the latest observation and returns a HunterAction, with retries for empty or invalid output.", tag: "model" },
            { t: "Act", s: "run_sql steps the env; submit_flags buffers timestamps; give_up ends the hunt.", tag: "tool" },
            { t: "Record turn", s: "per_turn gets tool, duration, outcome, new timestamps, cumulative tokens and cost.", tag: "state" },
            { t: "Check limits", s: "Stop if the env truncated, turns reached 1.5 times max_queries, the agent gave up, or a turn overflowed its error budget.", tag: "guard" },
          ],
        },
        explain: [
          "Two budgets interact. The env truncates after `max_queries` SQL steps; the harness separately stops at 1.5 times the configured query count in turns, because submit_flags consumes turns but not queries. The harness sleeps one second between turns to ease rate limits.",
          "Some knobs do less than their names suggest at this revision. The runner builds the env with its default of 50 queries, so `--max-queries` changes the prompt and the turn cap but not env truncation. `max_iterations`, `temperature` and `max_cost_usd_per_run` are recorded but not applied; spend limits come from `LITELLM_MAX_BUDGET`.",
        ],
        code: {
          lang: "json",
          caption: "benchmark/runner_config.json at the pinned revision.",
          src: `{
  "schema_version": 1,
  "rollouts": 5,
  "max_queries": 50,
  "max_iterations": 80,
  "max_cost_usd_per_run": null,
  "temperature": 0.0,
  "timeout_s": 120,
  "provider_concurrency": {
    "openai": 1,
    "anthropic": 1,
    "vertex_ai": 10,
    "gemini": 1,
    "fireworks_ai": 1
  }
}`,
        },
        soc: "When you compare agents, record the limits that were really enforced, not the ones in the config file. Here the effective query cap and the effective spend cap live in different places.",
        url: G + "benchmark/runner.py",
      },
      {
        id: "scoring",
        title: "Coverage scoring",
        hook: "How do submitted timestamps become one number?",
        diagram: {
          kind: "flow",
          steps: [
            { t: "Canonicalize", s: "Each submitted string is parsed as ISO-8601, converted to UTC and padded to microseconds. Unparseable strings are dropped; naive times are treated as UTC.", tag: "core" },
            { t: "Exact match", s: "A flag is detected only if its value equals a canonical submitted timestamp. There is no time tolerance.", tag: "guard" },
            { t: "Per attack step", s: "For each (chain, step): detected narrative steps divided by coverable narrative steps.", tag: "state" },
            { t: "Per tactic", s: "Mean of the step ratios for steps tagged with that ATT&CK tactic; NaN if no step covers it.", tag: "state" },
            { t: "Per run", s: "Mean over tactics with a defined score: coverage_score_per_run.", tag: "stop" },
          ],
        },
        explain: [
          "Coverage is measured in narrative steps, not raw flags, so submitting many timestamps from one step adds nothing once that step's narrative steps are covered. Averaging per tactic then gives each tactic equal weight, regardless of how many events it produced.",
          "There is no penalty for wrong submissions. `submitted_count` is reported, but a model that submits every timestamp it sees is not marked down by the coverage score. Read coverage together with submitted count and cost, and do not treat it as precision.",
        ],
        code: {
          lang: "python",
          caption: "Scoring one submission against the sample flags (pure Python, no model needed).",
          src: `from benchmark.scorer import score_hunt

hunt = {
    "submitted_timestamps": ["2026-01-14T00:06:46.532856Z"],
    "per_turn": [],
}
s = score_hunt(hunt, "datasets/sample_flags.json")
print(s["n_flags_total"], s["n_flags_detected"])   # 3912 1 on the sample
print(s["coverage_score_per_run"])
for tactic, score in s["coverage_score_per_tactic"].items():
    print(tactic, round(score, 3))`,
        },
        soc: "For a hunting agent, pair a coverage metric like this with a false-positive measure. Coverage tells you what it found; only precision tells you what the analyst will have to clear.",
        url: G + "benchmark/scorer.py",
      },
      {
        id: "runner",
        title: "Runner, rollouts and plots",
        hook: "How is a model comparison produced?",
        diagram: {
          kind: "timeline",
          legend: { you: "operator", guard: "pre-flight", tool: "hunts", state: "artifacts", stop: "report" },
          events: [
            { t: "Unpack sample.zip", s: "On first run the archive becomes sample.json and sample_flags.json under datasets/.", tag: "you" },
            { t: "Cost check", s: "Models come from models.txt; expected cost comes from cost.json. Unknown models need --yes-unknown-cost.", tag: "guard" },
            { t: "Rollouts in parallel", s: "Each model runs its rollouts with per-provider concurrency limits on a thread pool.", tag: "tool" },
            { t: "Atomic hunt JSON", s: "Each run writes seed_<seed>_model_<slug>_rollout_<r>.json with config and result, via temp file and rename.", tag: "state" },
            { t: "--resume", s: "A rerun skips hunts whose output already exists, so a crashed sweep can continue.", tag: "state" },
            { t: "cdb-plots", s: "Every hunt is scored and summarized as diff, pareto and radar outputs in JSON and PNG.", tag: "stop" },
          ],
        },
        explain: [
          "Rollouts exist because hunts are not deterministic: the harness uses each model's default sampling, so the same model on the same campaign can produce different queries. The Pareto plot uses per-model means with standard deviations across rollouts.",
          "Cost per hunt comes from LiteLLM pricing, with a local fallback table for providers LiteLLM does not price. `cost.json` only feeds the pre-launch estimate and is described in the repo as an order-of-magnitude guide.",
        ],
        code: {
          lang: "bash",
          caption: "The validation pipeline from the README, in Docker and in local Python.",
          src: `cp .env.example .env   # fill in at least one API key
docker compose build
docker compose run --rm benchmark             # hunts -> benchmark/hunts/*.json
docker compose run --rm benchmark cdb-plots   # outputs/{diff,pareto,radar}.{json,png}

pip install -e .
cdb-run --data datasets/sample.json --model openai/gpt-5
python -m benchmark.runner --rollouts 5 --yes
python -m benchmark.make_plots`,
        },
        soc: "Run several rollouts per agent configuration before drawing conclusions, and plot cost against coverage. A small coverage gain at several times the cost is rarely the right trade for a hunting workload.",
        url: G + "README.md",
      },
      {
        id: "harness",
        title: "Plugging in your own agent",
        hook: "What must a replacement harness provide?",
        diagram: {
          kind: "stack",
          layers: [
            { t: "Your harness", s: "Replaces benchmark/harness.py. Signature `run(env, model) -> dict`.", u: "Returns submitted_timestamps and per_turn for the scorer.", tag: "you" },
            { t: "System prompt", s: "Built from `info['schema_help']`, the row limit and your own instructions.", u: "Timestamps must be copied exactly to match flags.", tag: "model" },
            { t: "ThreatHuntEnv", s: "reset() once, then step(sql) per query. Counts queries and truncates.", u: "Observations come back as text with row counts.", tag: "core" },
            { t: "LogDatabase", s: "Fetches all rows, keeps the first 10, JSON-encodes them.", u: "Errors return as type and message.", tag: "guard" },
          ],
          core: { t: "In-memory SQLite", s: "One `logs` table per episode, rebuilt from sample.json on every reset.", tag: "state" },
        },
        explain: [
          "The README states the only contract: implement `run(env, model)` and drive the env with `reset()` and `step(action)`. The scorer reads `submitted_timestamps`; the plotting step also reads `new_timestamps` from each `per_turn` entry, the shape the upstream harness writes.",
          "Because the env holds no ground truth, nothing in the loop can leak flags to the agent. Two things are worth adding in your own harness: a read-only guard on SQL, and a size cap on observations, since a 10-row result of wide Sysmon records can still be long.",
        ],
        code: {
          lang: "python",
          caption: "Minimal shape of a replacement harness; my_agent is your own code.",
          src: `from benchmark.gym import ThreatHuntEnv

def run(env: ThreatHuntEnv, model: str) -> dict:
    obs, info = env.reset()
    agent = my_agent(model, schema=info["schema_help"], rows=env.query_row_limit)
    submitted, per_turn, done = [], [], False
    while not done:
        sql, stamps = agent.next(obs)
        new = [t for t in (stamps or []) if t not in submitted]
        submitted += new
        per_turn.append({"turn": len(per_turn) + 1, "new_timestamps": new})
        if sql is None:
            break
        obs, _, _, done, info = env.step(sql)
    return {"model": model, "submitted_timestamps": submitted, "per_turn": per_turn}`,
        },
        soc: "This is the integration point for evaluating your own SOC hunting agent on realistic Windows telemetry. Keep your production tool wrappers in the loop so the benchmark measures the agent you will deploy.",
        url: G + "README.md",
      },
    ],
  },
};
