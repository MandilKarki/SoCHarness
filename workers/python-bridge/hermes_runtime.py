"""Pinned Hermes AIAgent, only a private Relay toolset; no personal profile."""
import json
import os
from pathlib import Path
from shared import lifecycle

HERMES_REVISION = 'a4bd966aeee27d4e26316d69f2d2355dc5f32c21'


async def run(request, bridge, client_override=None):
    home = Path(os.environ['HERMES_HOME'])
    home.mkdir(parents=True,exist_ok=True)
    # This directory is Relay-owned, not ~/.hermes. Disable native tool-search
    # indirection and compression so the advertised surface and call budget stay exact.
    (home/'config.yaml').write_text(json.dumps({'tools':{'tool_search':{'enabled':'off'}},
        'compression':{'enabled':False}}),encoding='utf-8')
    from run_agent import AIAgent
    from tools.registry import registry
    config = request['config']
    allowed = set()
    for spec in request['tools']:
        name = 'relay_'+spec['name']; allowed.add(name)
        def handler(original):
            def call(args, **_kwargs): return json.dumps(bridge.call_sync(original,args))
            return call
        registry.register(name=name,toolset='relay_soc',
            schema={'name':name,'description':spec['description'],'parameters':spec['schema']},
            handler=handler(spec['name']))
    agent = AIAgent(model=config['model'],provider='openai',api_mode='chat_completions',
        base_url='https://api.openai.com/v1',api_key=os.environ.get('OPENAI_API_KEY','contract-test') if client_override else os.environ['OPENAI_API_KEY'],
        enabled_toolsets=['relay_soc'],max_iterations=config['max_turns'],max_tokens=config['max_output_tokens'],
        quiet_mode=True,skip_context_files=True,skip_memory=True,skip_background_review=True,
        load_soul_identity=False,save_trajectories=False,checkpoints_enabled=False,
        cwd=request['cwd'],stream_delta_callback=lambda text:bridge.emit({'type':'delta','text':text}) if text else None,
        run_budget_seconds=180)
    try:
        if agent.valid_tool_names != allowed: raise RuntimeError('Unexpected Hermes tool surface: '+repr(sorted(agent.valid_tool_names)))
        # Relay owns bounded between-turn compaction. No auxiliary summary-model calls.
        agent.compression_enabled = False
        if client_override is not None: agent.client = client_override
        elif hasattr(agent.client,'with_options'): agent.client = agent.client.with_options(max_retries=0,timeout=120)
        prior = request.get('native_state')
        lifecycle(request,bridge)
        result = agent.run_conversation(request['prompt'],system_message=request['system'],
                                        conversation_history=prior['messages'] if prior else None)
        if not result.get('completed') or result.get('failed') or not result.get('final_response'):
            raise RuntimeError('Hermes did not complete the turn')
        return {'text':result['final_response'],
                'usage':{'input_tokens':agent.session_input_tokens,'output_tokens':agent.session_output_tokens},
                'native_state':{'messages':result['messages'],'revision':HERMES_REVISION}}
    finally: agent.close()
