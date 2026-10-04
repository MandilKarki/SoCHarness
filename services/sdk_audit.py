"""Versioned, one-cell-per-runtime/capability evidence; never executes an SDK."""
import json
from pathlib import Path

MANIFEST = json.loads(Path(__file__).with_name('sdk_manifest.json').read_text(encoding='utf-8'))
SHARED = {
    'approvals': ('services/engine.py', 'Engine.tool / exact-argument approvals'),
    'trace': ('services/engine.py', 'Engine.record / Store.trace'),
    'sessions': ('services/store.py', 'Store: relay_sessions / relay_messages'),
    'branch': ('services/store.py', 'Relay summary-based checkpoint branch'),
    'compaction': ('services/adapters/state.py', 'compaction epoch invalidates native state'),
    'memory': ('services/advanced.py', 'cited SQLite memory records'),
    'artifacts': ('services/advanced.py', 'versioned report records'),
    'skills': ('services/advanced.py', 'curated Relay playbooks'),
    'human_input': ('services/engine.py', 'ask_human / bounded analyst wait'),
    'cancellation': ('services/adapters/python_runtime.py', 'worker process termination'),
    'usd_budget': ('services/trial_budget.py', 'TrialBudget.reserve / settle'),
}

def framework_metadata(runtime, installed=None):
    spec = MANIFEST['sdks'][runtime]
    pin = spec['pinned_version']
    match = installed == pin or (runtime == 'hermes' and installed == 'source:'+pin[:12])
    return {
        'pinned_version': pin, 'package': spec['package'],
        'version_state': 'not installed' if not installed else 'matches pin' if match else 'version drift',
        'credential': spec['credential'], 'dependencies': spec.get('dependencies', {}),
        'release_source': spec['release_source'], 'docs_version_basis': spec['docs_version_basis'],
        'live_evidence': spec['live_evidence'],
    }

def cell_metadata(runtime, capability, status):
    spec = MANIFEST['sdks'][runtime]
    implemented = status != 'gap'
    mechanism = spec['apis'].get(capability)
    file = spec['implementation'] if implemented else None
    if status == 'shared' and capability in SHARED:
        file, mechanism = SHARED[capability]
    if status == 'shared' and capability == 'usd_budget' and runtime in ('pydantic', 'deepagents', 'pi'):
        file, mechanism = 'services/anthropic_budget.py', 'MeterProxy + AnthropicBudget.reserve / settle'
    if implemented and not mechanism:
        mechanism = 'Restricted integration in the referenced adapter; API-level mapping still requires review.'
    live = spec['live_evidence']
    return {
        'mapping_id': runtime+'@'+spec['pinned_version']+':'+capability,
        'pinned_version': spec['pinned_version'],
        'upstream_api': mechanism if implemented else 'Not exposed by Relay; upstream API not mapped yet',
        'implementation': file,
        'contract_suite': spec['contract_suite'] if implemented else None,
        'test_scope': 'Suite reference, not proof that this individual cell passed; inspect test cases/results.',
        'live_status': 'connectivity smoke only' if live and capability in live['scope'] else 'not live-tested',
        'live_evidence': live if live and capability in live['scope'] else None,
        'required_credential': spec['credential'],
        'paid_test_policy': 'Only guarded runtimes may make paid calls: OpenAI nano, and Claude Haiku 4.5 for Claude, PydanticAI, Deep Agents and Pi through the Anthropic meter. Other runtimes require a cost guard and explicit provider setup.',
    }

def validate_manifest(root):
    """Structural and source-pin checks, not a model/SDK behavior test."""
    from adapters.registry import ADAPTERS
    errors = []
    if set(MANIFEST['sdks']) != set(ADAPTERS)-{'simulator'}:
        errors.append('Registry and audit manifest differ')
    main = (root/'requirements-agents.txt').read_text()
    extended = (root/'workers/python-bridge/requirements.txt').read_text()
    node = json.loads((root/'workers/agent-bridge/package.json').read_text())['dependencies']
    for runtime,spec in MANIFEST['sdks'].items():
        for field in ('implementation','contract_suite'):
            if not (root/spec[field]).is_file(): errors.append(runtime+': missing '+field)
        if spec['registry']=='pypi':
            lines = (main+'\n'+extended).splitlines()
            if not any(line.split('==')[0].split('[')[0]==spec['package'] and line.endswith('=='+spec['pinned_version']) for line in lines):
                errors.append(runtime+': manifest/source pin mismatch')
        elif spec['registry']=='npm' and node.get(spec['package']) != spec['pinned_version']:
            errors.append(runtime+': manifest/source pin mismatch')
    return errors
