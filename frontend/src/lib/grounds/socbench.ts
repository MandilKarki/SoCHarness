import type { GroundDocs } from "./types";
import { parse } from "../docs/types";

const REV = "f27c91793b7e7f957cb63dadb3cf3ba78292fa3e";
const G = `https://github.com/DeepTempo/socbench/blob/${REV}/`;

export const socbenchDocs: GroundDocs = {
  sources: [
    { label: "README (pinned revision)", url: G + "README.md" },
    { label: "REPRODUCE.md", url: G + "REPRODUCE.md" },
    { label: "config/benchmark_config.yaml", url: G + "config/benchmark_config.yaml" },
    { label: "Agent loop and summary (agent.py)", url: G + "src/socbench/agent.py" },
    { label: "Scoring lenses (scoring.py)", url: G + "src/socbench/scoring.py" },
    { label: "Published results, socbench.org", url: "https://socbench.org/detection/" },
  ],
  checked: "2026-10-04",
  overview: [
    "SOCBench is an open benchmark for AI in security operations, built by DeepTempo out of work validating its LogLM model and the open-source Vigil AI-SOC. It scores systems on four dimensions: efficacy, cost, latency and reliability. The repository holds two live capability harnesses: Detection (the `socbench` Python package, covered here) and PatchLoop, a separate TypeScript vulnerability-patching harness.",
    "The Detection harness runs a model as a SOC agent over a deterministic, pre-indexed NetFlow corpus. `socbench build-index` normalizes parquet flows, assigns stable `flow_id`s and cuts the corpus into eval units: `pair_timeline` (one source to one destination over time) or `host_egress` (one host fanning out to many destinations). The repo ships a small CIC-2018 sample and a `benchmark-v0` parquet built from benign and Stratosphere malware captures.",
    "Each (unit, persona, provider) triple is a rendering: a bounded multi-turn loop where the model calls read-only, persona-scoped tools and must finish with a strict `submit_assessment` JSON answer. Four personas share the same units: `soc_analyst`, `threat_analyst`, `adversary_hunter` and `detection_engineer`, each with its own turn, tool-call, wall-clock and tool allowlist budget. A fixed $0.50 cost cap applies per rendering.",
    "Scoring is computed per unit against gold flow labels the tools never expose: per-flow, per-pair and per-host precision, recall and F1, plus a unit-level verdict confusion matrix. Efficacy is averaged over first-pass-valid renderings only, and reliability (`first_pass_valid_rate`) is reported beside it, with blended `effective_*` scores. Ablations (`tools_off`, `playbooks_off`) are scored on the same units and aggregated as deltas against `main`.",
    "It is good for comparing models as triage agents on network telemetry under fixed budgets, and for seeing how output validity, cost and latency trade against accuracy. It covers only NetFlow-style records and a binary benign/malicious call; triage, DFIR, hunting and other SOC capabilities are listed as roadmap in the README. The project describes itself as alpha.",
  ],
  specialties: [
    { t: "Content-addressed corpus index", d: "`dataset_hash` is derived from data, schema and build arguments. Re-running `build-index` on the same input is a no-op, so every run names exactly what it scored." },
    { t: "Four personas, one unit set", d: "The personas share eval units, scoring lenses and ablations, but differ in budgets and tool allowlists, so persona differences are directly comparable." },
    { t: "Strict final-answer contract", d: "`submit_assessment` is validated with no repair. A forced or malformed answer makes the rendering invalid instead of being coerced into a score." },
    { t: "Reliability next to efficacy", d: "Macro F1 is computed over valid renderings only, and `first_pass_valid_rate` is reported separately and multiplied in for `effective_*` scores." },
    { t: "Cite only what you saw", d: "Predicted flows and destinations are clamped to ids that appeared in this rendering's tool responses, so guessing in-scope ids earns nothing." },
    { t: "Dollar caps at three levels", d: "A per-rendering cost cap, a per-run budget that soft-aborts, and per-provider circuit breakers keep runs bounded; pricing is a dated snapshot." },
    { t: "Ablations as first-class runs", d: "`tools_off` and `playbooks_off` reuse the deterministic sample, and `socbench aggregate` writes per-lens deltas against `main`." },
    { t: "Leak checks on prompts", d: "Composed prompts are scanned for ground-truth column names, attack-family strings, IP literals and hashes before any model call." },
  ],
  reference: [
    {
      t: "CLI",
      url: G + "src/socbench/cli.py",
      items: parse(`
socbench build-index|cli|Normalize parquet, assign flow_ids and eval units, write \`indexes/<dataset_hash>/\`; prints dataset_hash and counts
--dataset|param|Logical dataset name from the config \`datasets:\` block, e.g. \`sample\` or \`benchmark-v0\`
--rebuild|param|Force a rebuild even if an index for this dataset_hash exists
socbench tools-smoke|cli|Invoke every tool in one persona's allowlist against a built index with no model calls
--persona|param|Persona whose allowlist tools-smoke exercises (default soc_analyst)
socbench run|cli|Run the multi-turn agent benchmark over a built index and write \`runs/<run_id>/\`
--dataset-hash|param|Index to query; also the reproducibility key shared by runs and ablations
--mode|param|\`smoke\` (default) or \`full\`; selects the sampling block and default cost budget
--ablation|param|\`main\` (default), \`tools_off\` or \`playbooks_off\`; single_shot_baseline is external and not runnable here
--providers|param|\`mock\` (default), \`all\` (enabled in config) or a CSV such as \`openai,anthropic\`
--personas|param|\`all\` (default) or a CSV of persona names
--unit-id / --limit|param|Bypass stratified sampling for debugging; published rows always use the sampler
--cost-budget-usd|param|Override the mode's cost_budget_usd; the run aborts cleanly when reached
--prompts-dir|param|Directory holding playbook_common.md, personas/ and playbooks/ (default config/prompts)
--config|param|Path to benchmark_config.yaml, accepted by every subcommand
socbench aggregate|cli|Join runs sharing (dataset_hash, seed) into \`ablations/<hash>/<seed>/ablation_summary.json\`
--seed|param|sample_seed to aggregate; defaults to sampling.sample_seed
--log-level / --log-format|param|Root log level and json or human logs; also read from SOCBENCH_LOG_LEVEL and SOCBENCH_LOG_FORMAT
`),
    },
    {
      t: "benchmark_config.yaml",
      url: G + "config/benchmark_config.yaml",
      items: parse(`
index.host_egress_fanout_K|config|A src_ip reaching at least K distinct dst_ips in the window becomes host_egress (default 10)
index.host_egress_window_minutes|config|Time window for the fan-out test (default 5)
index.max_flows_per_unit|config|Larger units split into contiguous time sub-windows (default 1000)
agent.cost_usd_cap_per_rendering|config|Dollar cap on one rendering before a forced final answer (0.50)
agent.personas.<name>|config|Per-persona max_turns, max_tool_calls, wall_clock_seconds and tools allowlist
sampling.sample_seed|config|Seed in the (dataset_hash, sample_seed, mode) triple that fixes unit selection (7)
sampling.smoke|config|units_per_stratum 1, min_total_units 8, cost_budget_usd 10
sampling.full|config|units_per_stratum 500, full_unit_cap 1500, cost_budget_usd 900 fallback
providers.<name>|config|enabled, model, max_output_tokens, timeout_seconds, max_retries, max_concurrency
budget_multiplier|config|Scales turns, tool calls, wall clock and cost cap; 1.5 for openai and open_source
circuit_breaker_threshold|config|Consecutive fatal renderings before a provider's pending work is cancelled (default 12)
temperature|config|Optional sampling temperature; omitted from provider calls when unset
datasets.<name>.paths|config|Source parquet files; \`sample\` ships at data/sample/cic2018-mini.parquet
schema_path / pricing_path|config|Sibling files resolved relative to the YAML's own directory
`),
    },
    {
      t: "Personas and tools",
      url: G + "config/benchmark_config.yaml",
      items: parse(`
soc_analyst|concept|4 turns, 6 tool calls, 60 s; list_pairs, get_pair_timeline, get_flows, host_rollup
threat_analyst|concept|8 turns, 12 tool calls, 120 s; adds top_destinations and pair_stats
adversary_hunter|concept|10 turns, 16 tool calls, 150 s; adds port_proto_matrix and rarity_stats
detection_engineer|concept|12 turns, 20 tool calls, 180 s; same nine tools as adversary_hunter
list_pairs|tool|(src_ip, dst_ip) pairs with summary stats; optional filters, sort key and limit
get_pair_timeline|tool|Time-ordered flow records for one pair with offset and limit (default 50, max 500)
get_flows|tool|Flow records by explicit flow_id list (1 to 500 ids)
host_rollup|tool|Precomputed stats for one src_ip: flow and destination counts, bytes, packets, ports, time window
top_destinations|tool|A host's top destinations by flow count with byte totals and time window
pair_stats|tool|Precomputed rollup stats for one (src_ip, dst_ip) pair
port_proto_matrix|tool|Flow count and bytes by (dst_port, protocol) for an optional host or pair scope
rarity_stats|tool|Rarest dst_ports and dst_ips in a scope, for beacons and uncommon egress
submit_assessment|tool|Final structured answer; always available and the only tool under tools_off
`),
    },
    {
      t: "Eval units and answer contract",
      url: G + "src/socbench/models.py",
      items: parse(`
pair_timeline|concept|Eval unit for one src_ip to one dst_ip over time
host_egress|concept|Eval unit for one src_ip fanning out to many destinations within the window
gold_label|property|benign if no malicious flows, malicious if at least 80 percent malicious, otherwise mixed
Strata|concept|(unit_type, gold_label): six buckets, sampled deterministically and interleaved so any prefix stays balanced
verdict|param|\`benign\` or \`malicious\`
confidence|param|Float from 0.0 to 1.0
malicious_flow_indices|param|Global flow_id values judged malicious, no duplicates; clamped to the unit's scope
malicious_destinations|param|Destination IPs judged malicious; expanded to their in-scope flows, meant for host_egress units
rationale|param|Free-text reasoning, 1 to 8000 characters
`),
    },
    {
      t: "Scoring and summary.json",
      url: G + "src/socbench/agent.py",
      items: parse(`
per_flow_precision / recall / f1|property|Predicted malicious flow set against gold, flow by flow
per_pair_*|property|Same metrics over distinct (src_ip, dst_ip) pairs; a pair is positive if any flow is
per_host_*|property|Same metrics keyed by src_ip; the meaningful lens for host_egress units
native_lens_f1|property|per_host_f1 for host_egress units, per_flow_f1 for pair_timeline, macro-averaged
first_pass_valid_rate|property|Share of renderings with a valid, unforced submit_assessment
effective_per_flow_f1 / effective_native_lens_f1|property|Macro F1 multiplied by first_pass_valid_rate
units / units_scored|property|Renderings in the group and those valid enough to score
verdict block|property|Unit-level tp, fp, tn, fn, accuracy, precision, recall, f1 over valid renderings
coverage_adjusted_recall|property|True positives over all malicious-bearing units, so invalid renderings count as misses
*_malicious|property|Lens macros repeated over malicious and mixed units only
confidence block|property|Mean stated confidence overall, when correct and when wrong; a tuning aid, not a headline
defect_count|property|Units tagged \`verdict_indices_mismatch\`, e.g. malicious verdict with no flows cited
latency_per_unit_ms / latency_per_call_ms|property|count, mean, p50, p95 and max per provider and persona
cache|property|Per-provider cached-token share and savings from the pricing snapshot
`),
    },
    {
      t: "Run artifacts and run_metadata",
      url: G + "src/socbench/models.py",
      items: parse(`
runs/<run_id>/|module|One directory per run; run_id encodes timestamp, mode, ablation, providers and dataset hash prefix
renderings.jsonl|property|turns_used, tool_calls_used, wall_time_ms, cost_usd, cap_hit, cap_hit_reason, final_valid, forced_final_answer
predictions_raw.jsonl|property|One row per provider call with tool name, token counts, latency and cost; parquet mirror alongside
eval_units_summary.jsonl|property|Per-unit verdict, defect, confidence, rationale, submitted and effective predictions, lens metrics
tool_calls.jsonl / prompts_used/|property|Every tool call with args hash, and the composed system prompt per persona and provider
cap_hit_reason|property|\`turns\`, \`tool_calls\`, \`wall_clock\` or \`cost\`
spec_id / mode / ablation|property|run_metadata identity fields; spec_id is socbench-agent for this loop
dataset_hash / sample_seed|property|Reproducibility pair used to find comparable runs
prompts / playbooks / tools_manifest_sha|property|Content hashes; editing a prompt, playbook or allowlist produces a new result
provider_models|property|Exact model id each provider resolved to at run time
pricing_snapshot_date|property|Date of the rate card used for every cost figure
cost_usd_cap_per_rendering / cost_budget_usd|property|Caps in force for this run
image_tag / git_sha / host / started_at_utc / finished_at_utc|property|Provenance fields
`),
    },
    {
      t: "Pricing and environment",
      url: G + "config/pricing.yaml",
      items: parse(`
pricing.yaml|config|USD per 1M tokens per provider and model: input, cached_input, output, reasoning; snapshot_date 2026-06-03
reasoning|config|Billed at the output rate for OpenAI, Anthropic and Gemini entries
Unknown model|concept|A model missing from pricing.yaml costs 0.0 rather than failing the run
OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY|config|Provider keys read from the shell environment
OPEN_SOURCE_BASE_URL / API_KEY / TIMEOUT_SECONDS|config|Endpoint settings for OpenAI-compatible self-hosted models (vLLM, TGI, Ollama, llama.cpp)
OPEN_SOURCE_REASONING_BUDGET_TOKENS|config|Optional reasoning budget sent to open-source endpoints
mock provider|concept|Offline scripted adapter: list_pairs then submit benign; needs no keys and measures nothing
scripts/run_full_benchmark.sh|cli|One full run per provider in parallel with per-provider cost budgets
`),
    },
  ],
  dive: {
    intro:
      "Under the hood, SOCBench Detection is a pipeline of fixed artifacts: a content-addressed index, a seeded unit sample, one bounded loop per rendering, and a scorer that alone reads gold labels. Each chapter follows one of those mechanisms and the guard it adds against an agent scoring well for the wrong reason.",
    chapters: [
      {
        id: "index",
        title: "From parquet to eval units",
        hook: "What exactly is the unit an agent is asked to judge?",
        diagram: {
          kind: "flow",
          steps: [
            { t: "Source parquet", s: "Raw NetFlow parquet, such as the bundled CIC-2018 sample or benchmark-v0, listed under `datasets:` in the config.", tag: "state" },
            { t: "Normalize to schema", s: "Columns are mapped onto `config/schema.json`, sorted by `ts_start` with deterministic tie-breaks, and given stable `flow_id`s.", tag: "core" },
            { t: "Fan-out test", s: "A src_ip reaching 10 or more distinct destinations within 5 minutes becomes `host_egress`; otherwise each pair is a `pair_timeline` unit.", tag: "core" },
            { t: "Split and label", s: "Units over 1000 flows split into contiguous time windows. gold_label comes from the malicious fraction, after boundaries are fixed.", tag: "guard" },
            { t: "indexes/<hash>/", s: "Flows, pairs, hosts, rollups and eval_units.jsonl are written under the content-addressed dataset_hash.", tag: "stop" },
          ],
        },
        explain: [
          "Unit boundaries are drawn from traffic shape only, never from labels. The fan-out rule is label-agnostic, which is why benign wide-fan-out hosts appear as `host_egress` units and act as false-positive traps. Labels are computed afterwards: no malicious flows is benign, at least 80 percent is malicious, anything else is mixed.",
          "The `dataset_hash` covers data, schema and build arguments, so the same input always lands in the same directory and rebuilding is a no-op unless `--rebuild` is passed. Gold columns stay in `flows.parquet` for the scorer, but the tool layer strips them and raises if a ground-truth field ever reaches a response.",
        ],
        code: {
          lang: "bash",
          caption: "Build the bundled sample, then check a persona's tools without any model calls.",
          src: `socbench build-index \\
  --config config/benchmark_config.yaml \\
  --dataset sample
# dataset_hash=<HASH> flows=... pairs=... hosts=... eval_units=... path=...

socbench tools-smoke \\
  --dataset-hash <HASH> \\
  --persona soc_analyst`,
        },
        soc: "Choosing the unit is choosing the question. A SOC platform evaluating triage agents should cut cases from telemetry shape, not from known outcomes, or the case boundary leaks the answer.",
        url: G + "src/socbench/index.py",
      },
      {
        id: "loop",
        title: "One rendering: the bounded agent loop",
        hook: "How does a rendering end, and when does it count?",
        diagram: {
          kind: "loop",
          center: "Rendering",
          exit: "submit_assessment arrives, or a capped turn ends without one",
          steps: [
            { t: "Check caps", s: "Before each call: turns, tool calls, wall clock and accumulated cost against the persona policy and the per-rendering cost cap.", tag: "guard" },
            { t: "Model call", s: "System prompt, kickoff message and history go to the provider adapter, with retries and backoff on retryable errors.", tag: "model" },
            { t: "Classify response", s: "A `submit_assessment` ends the loop. A tool call is dispatched. Plain text is appended and the loop continues.", tag: "core" },
            { t: "Dispatch tool", s: "Allowlist check, schema validation, then a read-only DuckDB query. Errors return to the model as recoverable tool results.", tag: "tool" },
            { t: "Append result", s: "The JSON payload is added to the history; its flow_ids and destinations become the set the model may cite.", tag: "state" },
          ],
        },
        explain: [
          "The kickoff message carries only non-label unit metadata: id, type, source IP, destination or destination count, flow count and time window. When any cap fires, the loop appends a one-time message telling the model to submit now. If it calls another tool instead, the rendering stops.",
          "Validity is strict. `final_valid` is true only when `submit_assessment` validates against the Pydantic contract and the answer was not forced by a cap. `unit_first_pass_valid` mirrors that, and only those renderings feed the efficacy macros. Tool-call schema errors are recoverable; final-answer errors are not repaired.",
          "Provider budget multipliers scale every limit for chattier models: openai and open_source use 1.5 in the shipped config, raising turns, tool calls, wall clock and the cost cap together.",
        ],
        code: {
          lang: "yaml",
          caption: "Persona budget and allowlist from benchmark_config.yaml; editing tools moves tools_manifest_sha.",
          src: `agent:
  cost_usd_cap_per_rendering: 0.50
  personas:
    soc_analyst:
      max_turns: 4
      max_tool_calls: 6
      wall_clock_seconds: 60
      tools:
        - list_pairs
        - get_pair_timeline
        - get_flows
        - host_rollup
        - submit_assessment`,
        },
        soc: "Separate a forced answer from a chosen one. An agent that only produces a verdict when the budget runs out is not ready to close alerts, whatever its accuracy.",
        url: G + "src/socbench/agent.py",
      },
      {
        id: "prompt",
        title: "Prompt composition and ablations",
        hook: "What does each ablation actually remove?",
        diagram: {
          kind: "stack",
          layers: [
            { t: "System scaffold", s: "Fixed text: a read-only investigator that must end by calling `submit_assessment`.", u: "Hashed into prompts_manifest_sha with the other invariant parts.", tag: "core" },
            { t: "Output contract", s: "The `submit_assessment` JSON schema, embedded verbatim so every persona sees the same answer format.", u: "The same schema validates the final answer with no repair.", tag: "guard" },
            { t: "Persona + common playbook", s: "Who the agent is and the shared investigation process. Present in every ablation.", u: "Playbooks hold process and generic patterns only.", tag: "you" },
            { t: "Persona playbook", s: "Persona-specific method. Dropped under `playbooks_off`, which isolates what the playbook adds.", u: "playbooks_manifest_sha tracks this layer.", tag: "state" },
          ],
          core: { t: "Tools + leak check", s: "Tool schemas for the persona, or only `submit_assessment` under `tools_off`. The whole string is scanned for forbidden tokens before use.", tag: "tool" },
        },
        explain: [
          "`compose()` concatenates scaffold, output contract, persona, common playbook, persona playbook and tool schemas in that order, then runs the forbidden-token check: ground-truth column names, attack-family strings from the schema config, IPv4 or IPv6 literals and MD5, SHA1 or SHA256 hashes. A match raises at compose time.",
          "`tools_off` collapses the allowlist to `submit_assessment`. Because cited flows must appear in a tool response, flow-level lenses are structurally near zero there, which is why the aggregator also reports verdict-level deltas. All ablations reuse the same seeded units, so deltas compare like with like.",
        ],
        code: {
          lang: "bash",
          caption: "Main run plus both mandatory ablations on the same sample, then the delta summary.",
          src: `H=<HASH>
socbench run --dataset-hash $H --mode smoke --ablation main \\
  --providers mock --personas all
socbench run --dataset-hash $H --mode smoke --ablation tools_off \\
  --providers mock --personas all
socbench run --dataset-hash $H --mode smoke --ablation playbooks_off \\
  --providers mock --personas all
socbench aggregate --dataset-hash $H
# -> ablations/<HASH>/7/ablation_summary.json`,
        },
        soc: "Ablations tell you what your scaffolding is worth. Before investing in playbooks or new enrichment tools, measure the delta they produce on fixed cases.",
        url: G + "src/socbench/prompts.py",
      },
      {
        id: "scoring",
        title: "Scoring: lenses, verdicts and validity",
        hook: "Which number should you read first?",
        diagram: {
          kind: "tree",
          root: { t: "Unit score", s: "One valid submission against the unit's gold flow set, after clamping to scope and to ids the model actually observed.", tag: "core" },
          children: [
            { t: "Per-flow lens", s: "Precision, recall and F1 of the predicted malicious flow set. The native lens for pair_timeline units.", tag: "state" },
            { t: "Per-pair and per-host", s: "Same metrics over distinct pairs and source hosts. Per-host is the native lens for host_egress fan-out units.", tag: "state" },
            { t: "Verdict block", s: "Binary call against gold_label: tp, fp, tn, fn, accuracy, F1 and coverage-adjusted recall over all malicious-bearing units.", tag: "event" },
            {
              t: "Reliability",
              s: "first_pass_valid_rate and defect_count are computed over every rendering, valid or not.",
              tag: "guard",
              children: [
                { t: "effective_* scores", s: "Macro F1 multiplied by first_pass_valid_rate, so efficacy cannot be read without reliability.", tag: "stop" },
              ],
            },
          ],
        },
        explain: [
          "Degenerate cases are defined: nothing predicted and nothing in gold scores 1.0, so a clean benign unit is a perfect score. That is why invalid renderings are excluded from the macros instead of scored as empty predictions, which would turn a reliability failure into a free win on benign units.",
          "Two guards keep the lenses honest. Predictions are clamped to flow ids and destinations that appeared in this rendering's tool responses, and `coverage_adjusted_recall` divides by all malicious-bearing units, so failing on hard units cannot raise recall. `verdict_indices_mismatch` flags a verdict that contradicts the cited flows.",
        ],
        code: {
          lang: "python",
          caption: "The degenerate-case conventions, then the per-persona headline fields from a run.",
          src: `import json
from pathlib import Path
from socbench.scoring import prf

print(prf(0, 0, 0))  # clean benign unit, nothing flagged: 1.0 / 1.0 / 1.0
print(prf(0, 0, 4))  # 4 malicious flows missed: precision 1.0, recall 0.0

summary = json.loads(Path("runs/<run_id>/summary.json").read_text())
for key, e in summary["scoring"].items():  # key is "provider/persona"
    print(key, e["units_scored"], e["first_pass_valid_rate"],
          e["effective_native_lens_f1"], e["verdict"]["coverage_adjusted_recall"])`,
        },
        soc: "Report validity rate beside accuracy for any triage agent. A model that is right when it answers but often fails to answer leaves alerts unhandled, and only the blended number shows that.",
        url: G + "src/socbench/scoring.py",
      },
      {
        id: "cost",
        title: "Cost accounting and budget stops",
        hook: "How does a run stay inside a dollar budget?",
        diagram: {
          kind: "timeline",
          legend: { model: "per call", guard: "per rendering", stop: "per provider or run", state: "recorded" },
          events: [
            { t: "Call priced", s: "Each response's prompt, cached, output and reasoning tokens are priced from pricing.yaml; an unknown model is priced at zero.", tag: "model" },
            { t: "Rendering cap reached", s: "Accumulated cost at or above $0.50 (times any budget multiplier) forces a final answer, recorded with cap_hit_reason `cost`.", tag: "guard" },
            { t: "Fatal renderings in a row", s: "After 12 consecutive fatal renderings for one provider, its circuit opens and its pending renderings are cancelled.", tag: "stop" },
            { t: "Run budget reached", s: "Total cost at or above cost_budget_usd triggers a soft abort: unstarted renderings are cancelled, in-flight ones finish.", tag: "stop" },
            { t: "Partial summary", s: "summary.json still gets written, with aborted_for_budget, total_cost_usd, the cache block and pricing_snapshot_date in metadata.", tag: "state" },
          ],
        },
        explain: [
          "Cost is computed locally from token usage and a dated rate card, not read from a provider invoice. Every published figure carries `pricing_snapshot_date`, so a later price change produces a different, separately labelled number. Reasoning tokens are billed at the output rate for the hosted providers in the shipped file.",
          "Because the sampler interleaves strata, any prefix of the unit list stays balanced. A run cut short by its budget therefore still covers every stratum in proportion, rather than finishing one stratum and never touching the next.",
        ],
        code: {
          lang: "yaml",
          caption: "Rate card entries (USD per 1M tokens) from config/pricing.yaml.",
          src: `snapshot_date: 2026-06-03
currency: USD
providers:
  anthropic:
    claude-opus-4-7:
      input:         5.00
      cached_input:  0.50
      output:        25.00
      reasoning:     25.00
  open_source:
    fdtn-ai/Foundation-Sec-8B-Reasoning:
      input:         0.02
      cached_input:  0.0
      output:        0.05
      reasoning:     0.0`,
        },
        soc: "Per-case cost caps are the control that makes autonomous triage affordable to run on every alert. Record the rate card with each result, and treat zero cost for a self-hosted model as unpriced.",
        url: G + "config/pricing.yaml",
      },
      {
        id: "repro",
        title: "Reproducibility keys and comparability",
        hook: "When are two SOCBench numbers comparable?",
        diagram: {
          kind: "lanes",
          actors: ["You", "Index", "Sampler", "Runner", "Aggregator"],
          msgs: [
            { from: 0, to: 1, t: "build-index", s: "Prints dataset_hash, the key shared by every run and ablation on this data.", tag: "you" },
            { from: 0, to: 3, t: "run --mode --ablation", s: "Starts a run with the chosen providers, personas and budget.", tag: "you" },
            { from: 3, to: 2, t: "(hash, seed, mode)", s: "Stratified selection is deterministic in this triple, so main and every ablation score the same units.", tag: "core" },
            { from: 2, to: 3, t: "interleaved units", s: "Units come back rotated across strata, keeping any prefix balanced.", tag: "state" },
            { from: 3, to: 4, t: "run_metadata + summary", s: "Manifest hashes, provider_models and pricing date are stored with the scores.", tag: "state" },
            { from: 0, to: 4, t: "aggregate", s: "The latest run per ablation tag for (dataset_hash, seed) is joined; deltas are main minus ablation.", tag: "event" },
          ],
        },
        explain: [
          "REPRODUCE.md states that a published result is valid only for the manifest hashes and pricing date recorded in its metadata. Change a prompt, playbook, tool allowlist or rate and you have a new result, not an update to the old one.",
          "`--unit-id` and `--limit` bypass the sampler and are for debugging only. They take units in sorted id order, so a limited run is neither balanced nor comparable to a sampled one. The mock provider exercises the pipeline but always answers benign after one `list_pairs` call.",
        ],
        code: {
          lang: "bash",
          caption: "Headline run as documented in REPRODUCE.md (requires provider keys).",
          src: `export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GOOGLE_API_KEY=...

socbench run \\
  --config config/benchmark_config.yaml \\
  --dataset-hash <HASH> \\
  --mode smoke \\
  --ablation main \\
  --providers all \\
  --personas all`,
        },
        soc: "Pin data hash, sample seed, prompt hashes and rate card for every agent evaluation you run internally. Without them a regression and a config change look identical.",
        url: G + "REPRODUCE.md",
      },
    ],
  },
};
