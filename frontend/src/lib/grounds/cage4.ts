import type { GroundDocs } from "./types";
import { parse } from "../docs/types";

const D = "https://cage-challenge.github.io/cage-challenge-4/pages/";
const G = "https://github.com/cage-challenge/cage-challenge-4/blob/8c3c50ca54b176c2de199847944e8dcc035497e3/";

export const cage4Docs: GroundDocs = {
  sources: [
    { label: "Repository README (challenge details, pinned)", url: G + "README.md" },
    { label: "CAGE Challenge 4 documentation site", url: "https://cage-challenge.github.io/cage-challenge-4/" },
    { label: "Evaluation and submission guide (pinned)", url: G + "CybORG/Evaluation/README.md" },
    { label: "evaluation.py (pinned)", url: G + "CybORG/Evaluation/evaluation.py" },
    { label: "AAAI 2025 paper: MARL for autonomous cyber defence, a CC4 perspective", url: "https://ojs.aaai.org/index.php/AAAI/article/view/35158" },
    { label: "AI Magazine 2025: CAGE Challenge 4, a scalable MARL gym", url: "https://onlinelibrary.wiley.com/doi/full/10.1002/aaai.70021" },
  ],
  checked: "2026-10-04",
  overview: [
    "CAGE Challenge 4 (CC4) is the fourth of the TTCP CAGE Challenges, public competitions meant to foster autonomous cyber defence agents. It runs on CybORG, the Cyber Operations Research Gym, and introduces a multi-agent reinforcement learning (MARL) scenario: five blue agents each defend their own security zone of a segmented enterprise, while scripted red and green agents act in the background.",
    "The narrative is a defence base station whose drones are controlled from a contractor network. The network has four parts: two deployed networks (a restricted and an operational zone each), a headquarters network (public access, admin and office zones) and an undefended contractor network, joined over the internet. Each zone gets 1 to 6 servers and 3 to 10 user hosts, re-randomised by `EnterpriseScenarioGenerator`, so agents cannot memorise one layout.",
    "An episode moves through three mission phases (1, 2A, 2B). Each phase changes the intended firewall policy between zones and the penalty table. Blue starts at 0 and only loses points: when green users cannot do local work or reach a service, and when red succeeds with `Impact`. Actions take several ticks, red can spawn through phishing, and blue agents may exchange 8-bit messages.",
    "Official evaluation is `CybORG/Evaluation/evaluation.py`: a submission's five agents play 100 randomised episodes of 500 steps against `FiniteStateRedAgent`, and the mean and standard deviation of total episode reward are reported. The competition ran from February to May 2024 on CodaLab; results were published at AAAI 2025.",
    "CC4 is good for studying coordination under partial observability, cost of availability versus containment, and decoy-based detection in a fast simulation. It is not an emulation: hosts, services and exploits are abstract, red and green are rule-based, and the reward measures service disruption rather than detection quality or analyst-facing output.",
  ],
  specialties: [
    { t: "Five cooperating blue agents", d: "Agents 0 to 3 each defend one deployed zone; agent 4 defends the three headquarters zones. Each sees only its own zones, so coordination has to be learned." },
    { t: "Randomised topology every episode", d: "Host and service counts per zone are drawn on each reset. Wrappers keep a fixed action and observation layout by padding absent hosts with masked no-ops." },
    { t: "Mission phases change priorities", d: "Phases 1, 2A and 2B split the episode in thirds. The active mission raises penalties in its zones to -10 and isolates its operational zone." },
    { t: "Durative actions", d: "Every action has a duration in ticks (Restore 5, Exploit 4, Remove 3). An agent is busy until it completes; new choices are ignored meanwhile." },
    { t: "Green users drive the reward", d: "Penalties come from failed green work and red impact, so blocking or restoring too aggressively costs points just like letting red win." },
    { t: "Deception on both sides", d: "Blue can deploy decoy services that alert on contact; red can probe for decoys with `DiscoverDeception` and withdraw from hosts." },
    { t: "8-bit inter-agent messages", d: "Each blue agent may send an 8-bit vector each step; the flattened observation carries four received messages, one slot per other blue agent." },
  ],
  reference: [
    {
      t: "Environment and scenario",
      url: D + "tutorials/01_Getting_Started/2_Getting_Started/",
      items: parse(`
CybORG(scenario_generator, agents=None, seed=None)|class|The gym. Takes a ScenarioGenerator, optional default-agent overrides and an int seed for its numpy generator.
EnterpriseScenarioGenerator|class|Builds the CC4 scenario: subnets, hosts, red/green/blue agents, mission phases and the reward machine.
blue_agent_class / green_agent_class / red_agent_class|param|Agent classes used for each team when no external action is given; evaluation uses SleepAgent, EnterpriseGreenAgent, FiniteStateRedAgent.
steps|param|Episode length for EnterpriseScenarioGenerator (default 100). Phases are thirds of it; done when step_count >= steps - 1.
MIN/MAX_USER_HOSTS|config|3 and 10 user hosts per zone.
MIN/MAX_SERVER_HOSTS|config|1 and 6 servers per zone.
MESSAGE_LENGTH|config|8 bits per blue message.
cyborg.reset(agent=None, seed=None)|method|Regenerates the scenario; a seed re-creates the numpy generator.
cyborg.step(agent, action, messages)|method|Steps the environment with one agent's action; others use their default agent.
cyborg.parallel_step(actions, messages)|method|Steps with a dict of actions for several agents in the same tick.
get_last_action(agent)|method|The action an agent actually executed last; evaluation logs it per step.
get_reward_breakdown(agent)|method|Rewards for the last step indexed by hostname.
SUBNET|type|Enum of the nine subnet names, e.g. restricted_zone_a_subnet, office_network_subnet, internet_subnet.
`),
    },
    {
      t: "Blue actions",
      url: G + "README.md#appendix-a--action-sets",
      items: parse(`
Monitor|tool|Collects flagged malicious processes and connections. Runs automatically every turn as the blue default action. 1 tick.
Analyse|tool|Investigates one host for malware files linked to recent alerts. 2 ticks.
DeployDecoy|tool|Starts a decoy service on a host if no legitimate service holds that port. Red contact raises an alert and fails. 2 ticks.
Remove|tool|Kills processes identified as malicious on a host; evicts user-level red. 3 ticks.
Restore|tool|Returns a host to a known good state; the host is unavailable meanwhile. 5 ticks.
BlockTrafficZone|tool|Blocks traffic between the agent's zone and another subnet. Penalised if green needs that path. 1 tick.
AllowTrafficZone|tool|Re-opens traffic between the agent's zone and another subnet. 1 tick.
Sleep|tool|Takes no action for one tick.
`),
    },
    {
      t: "Red and green agents",
      url: D + "reference/agents/red_overview/",
      items: parse(`
FiniteStateRedAgent|class|Default red: tracks per-host knowledge states and picks actions from success, failure and probability matrices.
DiscoveryFSRed|class|FiniteStateRedAgent variant that prioritises servers and discovery.
RandomSelectRedAgent|class|Red agent that picks host and action at random.
VerboseFSRed|class|FSM red that prints its internal knowledge each turn; for debugging.
Host states K, S, U, R|concept|Known, Services known, User shell, Root shell. A D suffix means the host's subnet was discovered; F is final.
DiscoverRemoteSystems|technique|T1018 ping sweep of a subnet. 1 tick.
AggressiveServiceDiscovery|technique|T1046 port scan, 1 tick, 75% chance to raise an alert.
StealthServiceDiscovery|technique|Same scan, 3 ticks, 25% alert chance.
ExploitRemoteService|technique|T1210; gains a user shell. 4 ticks; failure depends on the weighted exploit choice.
PrivilegeEscalate|technique|Gains root on a host with a user shell. 2 ticks.
Impact|technique|T1489 service stop; the main source of RIA penalties. 2 ticks.
DegradeServices|technique|With root, makes green local work fail more often. 2 ticks.
DiscoverDeception|technique|Probes for decoys: 50% false negative, 10% false positive. 2 ticks.
Withdraw|technique|Removes red's own presence from a host. 1 tick.
EnterpriseGreenAgent(fp_detection_rate=0.01, phishing_error_rate=0.01)|class|Green user choosing GreenLocalWork, GreenAccessService or Sleep at random.
GreenLocalWork|tool|Local work; may create a false alert or a phishing foothold for red.
GreenAccessService|tool|Connects to a server allowed by the current phase; failure costs blue the ASF penalty.
`),
    },
    {
      t: "Wrappers",
      url: D + "tutorials/02_Looking_Around/3_Wrappers/",
      items: parse(`
BlueFixedActionWrapper(env, pad_spaces=False)|class|Fixed, sorted action list per blue agent across episodes; missing hosts become masked Sleep actions.
pad_spaces|param|Pads every agent's action (and flat observation) space to the largest size; some RL libraries need it.
action_labels(agent) / action_mask(agent)|method|Human-readable label and validity flag for each action index.
BlueFlatWrapper|class|Adds fixed-length numpy observation vectors on top of the fixed action space.
BlueEnterpriseWrapper|class|CC4 wrapper over BlueFlatWrapper; accepts step(actions, messages) or the EnterpriseMAE dict form.
EnterpriseMAE|class|RLlib MultiAgentEnv version; adds __all__ to terminated and truncated.
TrueStateTableWrapper|class|Prints ground-truth tables (hosts, processes, agents) for debugging; not for agent input.
VisualiseRedExpansion|class|Visual aid showing red's spread through the network.
`),
    },
    {
      t: "Observation vector (BlueEnterpriseWrapper)",
      url: G + "README.md#appendix-b--agent-observation",
      items: parse(`
Mission phase|property|Index 0: 0 for phase 1, 1 for 2A, 2 for 2B.
Subnet info block|concept|Per defended subnet, length 3S+2H with S=9 subnets and H=16 hosts (6 servers, 10 users).
One-hot subnet|property|S bits marking which subnet this block describes.
Blocked subnets|property|S bits: traffic from that subnet is currently blocked.
Communication policy|property|S bits: traffic from that subnet should be blocked in the current phase.
Malicious process event|property|H bits: a malicious process was flagged on that host.
Malicious network event|property|H bits: a malicious connection was flagged on that host.
Message block|property|4 x 8 bits from the other blue agents, zero when nothing was sent.
Long vs short observation|concept|Agent 4 has three subnet blocks, others one; pad_spaces zero-fills the shorter vectors.
`),
    },
    {
      t: "Reward (BlueRewardMachine)",
      url: G + "README.md#rewards",
      items: parse(`
LWF|concept|Local Work Fails: green local work failed. -1 in most zones; -10 in the active mission's operational zone.
ASF|concept|Access Service Fails: a green connection failed. Up to -5 (contractor, phase 1).
RIA|concept|Red Impact/Access: a successful red Impact. -3 in HQ; -10 in the active operational zone.
Phase tables|config|Three per-subnet tables in BlueRewardMachine.get_phase_rewards, keyed by mission phase 0, 1, 2.
Team reward|concept|One Blue team reward; each blue agent receives the same sum.
`),
    },
    {
      t: "Evaluation script and submission",
      url: G + "CybORG/Evaluation/README.md",
      items: parse(`
python -m CybORG.Evaluation.evaluation SUBMISSION OUTPUT|cli|Runs the standard evaluation on a submission directory or zip.
--max-eps|cli|Episodes to run (default 100).
--seed|cli|Seed passed to CybORG (default None).
--append-timestamp|cli|Appends a timestamp folder to the output path.
EPISODE_LENGTH|config|Fixed at 500 steps in run_evaluation.
Submission|class|submission.py class with NAME, TEAM, TECHNIQUE, AGENTS dict and a wrap(env) function.
AGENTS|property|Dict of blue_agent_0..4 to BaseAgent instances whose get_action(obs, action_space) is called each step.
wrap(env)|method|Returns the MultiAgentEnv the agents see; the template uses EnterpriseMAE.
Output files|concept|summary.txt, full.txt, actions.txt, summary.json and scores.txt with reward_mean and reward_stdev.
Time limit|config|100 episodes of 500 steps within 3 hours on an EC2 C4.large, per the README.
`),
    },
  ],
  dive: {
    intro:
      "CybORG is a discrete-time simulator. Each step gathers one action per agent, counts down action durations, executes what is ready in a fixed order, appends automatic Monitor results, then scores green failures and red impacts. The wrappers turn that dictionary world into fixed vectors for five blue learners. Knowing this loop explains most surprising scores.",
    chapters: [
      {
        id: "step",
        title: "One tick of the simulation controller",
        hook: "What actually happens between env.step() and the reward?",
        diagram: {
          kind: "flow",
          steps: [
            { t: "Collect actions", s: "External actions come from your dict; any agent left out gets its scenario agent's choice (red FSM, green user).", tag: "you" },
            { t: "Validate", s: "Each action is checked against the agent's action space and replaced with an InvalidAction if it is outside its action space or uses undiscovered parameters.", tag: "guard" },
            { t: "Count down ticks", s: "New actions start with their duration; anything not yet at zero becomes a Sleep and returns IN_PROGRESS.", tag: "state" },
            { t: "Execute in order", s: "Ready actions run in priority order and observations are filtered per agent.", tag: "tool" },
            { t: "End-turn Monitor", s: "Blue's default Monitor runs automatically and appends flagged processes and connections.", tag: "event" },
            { t: "Reward and done", s: "BlueRewardMachine scores green failures and red Impact; done when step_count reaches steps - 1.", tag: "stop" },
          ],
          back: { from: 5, to: 0, label: "next tick" },
        },
        explain: [
          "`SimulationController.step` advances the mission phase if needed, fills in missing actions from each agent's default policy, validates them, and puts them into `actions_in_progress` with `remaining_ticks` set to the action's duration. Only actions whose counter reaches zero execute; the rest act as Sleep for this tick.",
          "After execution the controller reassigns red sessions that crossed into another subnet to that subnet's red agent, runs end-turn actions (Monitor for blue), updates action spaces and increments the step counter. The episode ends at `steps - 1`, so a 500-step scenario returns done on its 500th call.",
          "The wrappers sit on `parallel_step`: they translate integer indices to CybORG actions, pass messages, and return per-agent observations, rewards and done flags.",
        ],
        code: {
          lang: "python",
          caption: "A full CC4 episode with random blue actions through the flat wrapper.",
          src: `from CybORG import CybORG
from CybORG.Simulator.Scenarios import EnterpriseScenarioGenerator
from CybORG.Agents import SleepAgent, EnterpriseGreenAgent, FiniteStateRedAgent
from CybORG.Agents.Wrappers import BlueFlatWrapper

sg = EnterpriseScenarioGenerator(blue_agent_class=SleepAgent,
                                 green_agent_class=EnterpriseGreenAgent,
                                 red_agent_class=FiniteStateRedAgent,
                                 steps=500)
env = BlueFlatWrapper(env=CybORG(scenario_generator=sg, seed=1234))
obs, info = env.reset()
total = 0.0
for t in range(500):
    actions = {a: env.action_space(a).sample() for a in env.agents}
    obs, rew, term, trunc, info = env.step(actions)
    if all(term.values()):
        break
    total += sum(rew.values()) / len(rew)
print(total)`,
        },
        soc: "A SOC simulator needs the same discipline: one clock, explicit action durations and a fixed execution order, or two runs of the same policy will not be comparable.",
        url: D + "tutorials/03_Actions/A_Understanding_Actions/2_Taking_an_Action/",
      },
      {
        id: "durations",
        title: "Durative actions and the busy agent",
        hook: "Why does a Restore cost more than its own penalty?",
        diagram: {
          kind: "timeline",
          events: [
            { t: "t: choose Restore", s: "Blue agent 0 selects Restore on a server. Duration is 5 ticks.", tag: "you" },
            { t: "t: IN_PROGRESS", s: "The action is queued; the observation's success field reads IN_PROGRESS.", tag: "state" },
            { t: "t+1..t+3: choices ignored", s: "New indices sent while busy are not queued; the slot is occupied.", tag: "guard" },
            { t: "Green fails meanwhile", s: "Green on the host cannot work while it is being restored, so LWF or ASF penalties accrue.", tag: "event" },
            { t: "t+4: Restore executes", s: "The counter reaches zero and the host returns to a known good state.", tag: "tool" },
            { t: "t+5: free again", s: "The agent's next choice is accepted and starts its own countdown.", tag: "stop" },
          ],
          legend: { you: "agent decision", state: "controller state", guard: "ignored input", event: "side effect", tool: "execution", stop: "agent free" },
        },
        explain: [
          "Durations come from each action class: Monitor, Sleep, Block and Allow 1 tick; Analyse, DeployDecoy, PrivilegeEscalate, Impact, DegradeServices and DiscoverDeception 2; Remove and StealthServiceDiscovery 3; ExploitRemoteService 4; Restore 5. Once chosen, an action cannot be cancelled.",
          "The controller only stores a new action when the agent has nothing in progress. A learner that keeps emitting indices during that window receives no feedback for them, which can confuse credit assignment. Agents should read the IN_PROGRESS status and treat those steps as waiting.",
        ],
        code: {
          lang: "python",
          caption: "Inspect an agent's fixed action list and mask before choosing.",
          src: `from CybORG.Agents.Wrappers import BlueFixedActionWrapper

env = BlueFixedActionWrapper(env=cyborg)
obs, info = env.reset()
agent = "blue_agent_0"
labels = env.action_labels(agent)
mask = env.action_mask(agent)
valid = [i for i, ok in enumerate(mask) if ok]
restore = next(i for i in valid if labels[i].startswith("Restore"))
print(len(labels), labels[restore])
obs, rew, term, trunc, info = env.step({agent: restore})
print(obs[agent]["success"])  # IN_PROGRESS while the 5 ticks run`,
        },
        soc: "Containment actions in a SOC also take time and remove availability while they run. Modelling duration and busy state is what makes 'restore everything' a measurable mistake rather than a free win.",
        url: G + "README.md#appendix-a--action-sets",
      },
      {
        id: "reward",
        title: "How the blue reward is computed",
        hook: "Which events cost points, and how much?",
        diagram: {
          kind: "tree",
          root: { t: "BlueRewardMachine", s: "One reward calculator for the Blue team; red and green use an empty calculator.", tag: "core" },
          children: [
            {
              t: "Look up phase table",
              s: "state.mission_phase picks one of three per-subnet tables.",
              tag: "state",
              children: [
                { t: "Phase 1: low everywhere", s: "Mostly -1; contractor ASF and RIA are -5, HQ RIA is -3.", tag: "state" },
                { t: "2A or 2B: mission active", s: "The active operational zone has LWF and RIA of -10.", tag: "state" },
              ],
            },
            { t: "Green LocalWork failed", s: "Adds the zone's LWF value when GreenLocalWork returns success False.", tag: "event" },
            { t: "Green AccessService failed", s: "Adds the zone's ASF value when a green connection fails.", tag: "event" },
            { t: "Red Impact succeeded", s: "Adds the zone's RIA value for the host red impacted.", tag: "guard" },
            { t: "Sum for the step", s: "The sum is the team reward; each blue agent gets the same number.", tag: "stop" },
          ],
        },
        explain: [
          "`calculate_reward` iterates over the step's actions. Only three things count: a failed `GreenLocalWork`, a failed `GreenAccessService`, and a successful red `Impact`, each looked up by the target host's subnet and the current phase. Blue's own actions never score directly; they matter only through their effect on green and red.",
          "The score is therefore never positive. The best possible episode is 0. `evaluation.py` sums, per step, the mean of the blue agents' rewards; since they share one team reward, that equals the team reward. Note that the README's phase 1 table lists internet RIA as 0 while the code uses -1; internet hosts are not targeted by Impact in practice.",
        ],
        code: {
          lang: "python",
          caption: "See where the last step's penalty came from.",
          src: `obs, rew, term, trunc, info = env.step(actions)
print(rew)  # same value for every blue agent
print(cyborg.get_rewards())  # team-indexed rewards for the last step
breakdown = cyborg.get_reward_breakdown("blue_agent_0")
for host, r in breakdown.items():
    if r:
        print(host, r)
phase = cyborg.environment_controller.state.mission_phase
print("phase", phase)`,
        },
        soc: "Scoring defence by user impact, not by alerts closed, is the right shape for a SOC benchmark. It punishes both missed intrusions and heavy-handed containment with the same currency.",
        url: G + "README.md#rewards",
      },
      {
        id: "red",
        title: "The FSM red agent and how it spreads",
        hook: "How does the scripted attacker decide what to do next?",
        diagram: {
          kind: "loop",
          center: "host_states",
          exit: "the episode reaches its step limit",
          steps: [
            { t: "Process observation", s: "Last action's success moves that host to a new state; new IPs become K; lost sessions demote hosts.", tag: "state" },
            { t: "Pick a host", s: "Random, or weighted by host_state_priority_list (DiscoveryFSRed prefers K and S hosts).", tag: "core" },
            { t: "Pick an action", s: "Sampled from the state's row of state_transitions_probability.", tag: "model" },
            { t: "Act and wait", s: "The action runs for its duration; the agent sleeps while it is IN_PROGRESS.", tag: "tool" },
            { t: "Spread", s: "Root on server_host_0 reveals other zones' server_0 hosts; phishing creates footholds.", tag: "guard" },
          ],
        },
        explain: [
          "Six red agents exist, one per zone group, but only `red_agent_0` in the contractor network starts active. Red reaches other zones either by rooting a `server_host_0`, which reveals the server_0 hosts of connected zones, or through green phishing during local work. Sessions that land in another zone are handed to that zone's red agent.",
          "Each host the agent knows has a state (K, S, U, R, with a D suffix once its subnet was scanned). Three matrices drive behaviour: next state on success, next state on failure, and action probabilities per state. Variants change only the priority list and probabilities, which makes it easy to build a family of attackers for robustness testing.",
        ],
        code: {
          lang: "python",
          caption: "Swap in a discovery-focused attacker and watch ground truth.",
          src: `from CybORG import CybORG
from CybORG.Simulator.Scenarios import EnterpriseScenarioGenerator
from CybORG.Agents import SleepAgent, EnterpriseGreenAgent, DiscoveryFSRed
from CybORG.Agents.Wrappers import TrueStateTableWrapper

sg = EnterpriseScenarioGenerator(blue_agent_class=SleepAgent,
                                 green_agent_class=EnterpriseGreenAgent,
                                 red_agent_class=DiscoveryFSRed,
                                 steps=100)
cyborg = CybORG(scenario_generator=sg, seed=1234)
env = TrueStateTableWrapper(cyborg)
cyborg.reset()
for _ in range(50):
    cyborg.step()
env.print_host_overview_table()`,
        },
        soc: "Testing defenders against one fixed attacker overfits. Parameterised attacker families, like the FSM variants, are a cheap way to probe whether a SOC agent's playbook generalises.",
        url: D + "reference/agents/red_overview/",
      },
      {
        id: "obs",
        title: "From state dictionaries to vectors and messages",
        hook: "What does a blue agent actually see?",
        diagram: {
          kind: "stack",
          layers: [
            { t: "EnterpriseMAE", s: "RLlib-facing wrapper; adds __all__ flags.", u: "Returns per-agent vectors, shared reward and flags.", tag: "you" },
            { t: "BlueEnterpriseWrapper", s: "Accepts actions plus optional 8-bit messages per agent.", u: "Long vector for agent 4, short for the others.", tag: "core" },
            { t: "BlueFlatWrapper", s: "Holds comms policy per phase and sorted host slots.", u: "Encodes phase, blocks, policy, alerts and messages.", tag: "state" },
            { t: "BlueFixedActionWrapper", s: "Index to CybORG action via a sorted list; absent hosts are masked Sleep.", u: "Adds action_mask to info.", tag: "guard" },
          ],
          core: { t: "CybORG parallel_step", s: "Executes the tick and returns raw observation dicts with Monitor alerts and received messages.", tag: "tool" },
        },
        explain: [
          "The raw CybORG observation is a nested dict per host. `BlueFlatWrapper` turns it into a fixed vector: mission phase, then for each defended subnet a one-hot subnet id, blocked subnets, the phase's intended policy, and per-host bits for malicious process and network events, followed by four 8-bit messages.",
          "Hosts are slotted by sorted name (servers 0-5, users 0-9), so a slot keeps its meaning across episodes even though host counts change. Alerts include green false positives at 1% and miss red actions that did not raise an alert, so the vector is noisy by design. Messages are delivered by the controller to agents whose host is routable from the sender's.",
        ],
        code: {
          lang: "python",
          caption: "Send an 8-bit message alongside actions.",
          src: `import numpy as np
from CybORG.Agents.Wrappers import BlueEnterpriseWrapper

env = BlueEnterpriseWrapper(env=cyborg, pad_spaces=True)
obs, info = env.reset()
print(env.observation_space("blue_agent_4").shape)
actions = {a: 0 for a in env.agents}
messages = {a: np.zeros(8, dtype=bool) for a in env.agents}
messages["blue_agent_0"][0] = True  # e.g. "red seen in my zone"
obs, rew, term, trunc, info = env.step(actions, messages=messages)
print(obs["blue_agent_4"][-32:])  # agent 4 has no padding after its messages`,
        },
        soc: "This is the bandwidth-limited version of agents sharing a case board. It forces you to decide what one zone's agent must tell another, which is the core design question for a multi-agent SOC.",
        url: G + "README.md#appendix-b--agent-observation",
      },
      {
        id: "eval",
        title: "The evaluation script and reproducibility",
        hook: "How is a leaderboard number produced, and how do you reproduce it?",
        diagram: {
          kind: "lanes",
          actors: ["evaluation.py", "Submission", "Wrapped env", "CybORG"],
          msgs: [
            { from: 0, to: 1, t: "load submission.py", s: "Imports the Submission class from a directory or zip.", tag: "you" },
            { from: 0, to: 3, t: "Scenario4, 500 steps, seed", s: "Builds EnterpriseScenarioGenerator with FiniteStateRedAgent and the --seed value.", tag: "core" },
            { from: 1, to: 2, t: "wrap(env)", s: "The submission chooses the wrapper, usually EnterpriseMAE.", tag: "tool" },
            { from: 0, to: 1, t: "get_action(obs, space)", s: "Called for each blue agent every step.", tag: "model" },
            { from: 2, to: 3, t: "step(actions)", s: "One tick; red and green act from their own agents.", tag: "tool" },
            { from: 0, to: 2, t: "reset() x 100", s: "Each episode resets the scenario with a new random layout.", tag: "state" },
            { from: 3, to: 0, t: "mean(rew) per step", s: "Summed per episode; mean and stdev over episodes are written to scores.txt.", tag: "stop" },
          ],
        },
        explain: [
          "`run_evaluation` fixes `EPISODE_LENGTH = 500` and builds the scenario with `SleepAgent` blue, `EnterpriseGreenAgent` and `FiniteStateRedAgent`. For each episode it resets the wrapped env, asks every submitted agent for an action, steps, and sums the per-step mean of blue rewards. The README's sample output for a dummy agent is an average of -18386 over 2 episodes.",
          "Without `--seed`, CybORG draws a fresh seed, so two runs differ. Even with a seed, the score has high variance across episodes because topology, red strategy and phishing are random; compare policies on the same seed and the same number of episodes, and report the standard deviation.",
        ],
        code: {
          lang: "bash",
          caption: "Smoke-test a submission locally, then run the full protocol with a fixed seed.",
          src: `mkdir staging && cd staging
# submission.py defines Submission with NAME, TEAM, TECHNIQUE, AGENTS, wrap()
python3 -m CybORG.Evaluation.evaluation --max-eps 2 . /tmp/output
cat /tmp/output/scores.txt

# full protocol: 100 episodes x 500 steps
python3 -m CybORG.Evaluation.evaluation --seed 7 --append-timestamp \\
    . ./evaluation_output
touch metadata && zip ../my_submission.zip *`,
        },
        soc: "Report SOC-agent scores the same way: fixed scenario generator, fixed seed, many episodes, mean and spread. A single 10-step run, like a quick bridge test, is a smoke test, not a result.",
        url: G + "CybORG/Evaluation/README.md",
      },
    ],
  },
};
