"""OpenAI Agents SDK runner, streamed events, typed findings and native input history.

Only Relay function tools are exposed. No hosted shell/browser, external MCP or
remote trace export. Credentials remain on the server, never in transcripts.
"""
import json
import os
from adapters.common import dispatch, finish, cancellable
from adapters.state import load, turn_prompt
from adapters.openai_observation import tool_specs, observe_model, contract


async def run_openai(engine, prompt, model_override=None):
    from agents import Runner, FunctionTool, ModelSettings, ModelRetrySettings, OpenAIResponsesModel, InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered
    from openai import AsyncOpenAI, APIStatusError, APIConnectionError
    from store import Problem
    from pydantic import BaseModel
    config = engine.store.session(engine.sid)['config']
    from trial_budget import enabled, check_runtime, guarded_model, MAX_OUTPUT
    check_runtime('openai', config['model'])
    trial = enabled()
    from adapters.openai_patterns import LIMITS, capped_model, build_agents, StagedSession, resolve_interruptions
    experiment=config.get('openai_experiment','core')
    counter={'calls':0,'limit':min(config['max_turns'],LIMITS[experiment])}
    tools = []
    for spec in tool_specs(config):
        if experiment!='core' and spec['name'] not in (('query_case_evidence','get_event') if experiment=='multi_tool' else ('query_case_evidence',)):
            continue
        def handler(name):
            async def call(_ctx, arguments):
                try:
                    return json.dumps(await dispatch(engine, name, json.loads(arguments)))
                except Problem as exc:
                    # Only recover from these read-tool input mistakes. Never
                    # turn permission, scope, cancellation or internal failures
                    # into a model retry. The Runner's turn/usage limits still apply.
                    if name != 'query_case_evidence' or exc.status != 400 or str(exc) not in ('limit must be 1–25', 'search must be text'):
                        raise
                    engine.record('tool.validation_error', {'tool':name, 'message':str(exc),
                        'executed':False, 'recovery':'Model may correct arguments within remaining turn and spending limits.'})
                    return json.dumps({'error':'invalid_tool_arguments', 'message':str(exc),
                        'executed':False, 'allowed_limit':{'minimum':1,'maximum':25},
                        'search_type':'string', 'instruction':'Correct the arguments or explain the limitation. Do not repeat the invalid request.'})
            return call
        tools.append(FunctionTool(name=spec['name'], description=spec['description'],
                                  params_json_schema=spec['schema'], on_invoke_tool=handler(spec['name'])))

    class Findings(BaseModel):
        observations: list[str]
        evidence_ids: list[int]
        hypotheses: list[str]
        next_steps: list[str]
        limitations: str

    client = None
    if model_override is None:
        # Explicit base URL: do not silently forward telemetry to an inherited proxy endpoint.
        client = AsyncOpenAI(api_key=os.environ['OPENAI_API_KEY'], base_url='https://api.openai.com/v1', max_retries=0, timeout=120)
    def model_factory(name):
        model=(model_override[name] if isinstance(model_override,dict) else model_override) if model_override is not None else OpenAIResponsesModel(model=config['model'],openai_client=client)
        model=observe_model(model,engine,config['model'],name,counter)
        if trial:model=guarded_model(model,engine)
        return capped_model(model,engine,counter)
    settings=ModelSettings(max_tokens=min(config['max_output_tokens'], MAX_OUTPUT) if trial else config['max_output_tokens'],
                                               parallel_tool_calls=False, store=False,
                                               retry=ModelRetrySettings(max_retries=0),
                                               extra_args={'service_tier':'default'} if trial else None)
    typed=config['structured_output'] or experiment=='guardrails'
    agent,agents,hooks,run_config=build_agents(engine,prompt,tools,model_factory,settings,Findings if typed else None,experiment)
    prior = load(engine)
    if experiment=='handoff' and prior and prior.get('last_agent') in agents:
        agent=agents[prior['last_agent']]
    items = list(prior['messages']) if prior else []
    items.append({'role':'user', 'content':turn_prompt(engine, prompt, prior)})
    engine.record('harness.configured', {**contract(config), 'model':config['model'],'experiment':experiment,
        'agents':list(agents),'starting_agent':agent.name,'shared_call_limit':counter['limit'],
        'agent_contracts':[{'name':a.name,'instructions':a.instructions,'tools':[t.name for t in a.tools],
            'handoffs':[h.tool_name for h in a.handoffs],
            'input_guardrails':[g.name for g in a.input_guardrails],'output_guardrails':[g.name for g in a.output_guardrails]} for a in agents.values()],
        'permission':config['permission'], 'max_turns':config['max_turns'],
        'structured_output':typed, 'continued':bool(prior)})
    engine.record('adapter.lifecycle', {'runtime':'openai', 'event':'session.resumed' if prior else 'session.created'})
    session=StagedSession(engine,prior['messages'] if prior else []) if experiment=='sessions' else None
    engine.record('session.context',{'session_id':engine.sid,'retained_items':len(prior['messages']) if prior else 0,
        'new_items':1,'active_agent':agent.name,'method':'SDK Session protocol' if session else 'Explicit SDK input history',
        'local_context':'Python run context is not automatically model-visible. Only serialized input and tool results enter model context.',
        'commit':'Only successful final results replace persisted continuation. No automatic provider compaction.'})
    result = Runner.run_streamed(agent, input=turn_prompt(engine,prompt,prior) if session else items,
        max_turns=counter['limit'],run_config=run_config,hooks=hooks,session=session)

    async def consume():
        nonlocal result
        while True:
            async for event in result.stream_events():
                engine.check()
                if event.type == 'raw_response_event' and event.data.type == 'response.output_text.delta':
                    engine.record('message.delta', {'text':event.data.delta})
                elif event.type == 'run_item_stream_event':
                    engine.record('adapter.lifecycle', {'runtime':'openai', 'event':event.name})
            if not result.interruptions:break
            state,approved=await resolve_interruptions(engine,result)
            hooks.approved.extend(approved)
            result=Runner.run_streamed(agent,input=state,max_turns=counter['limit'],run_config=run_config,hooks=hooks)
        structured = result.final_output.model_dump() if typed and hasattr(result.final_output,'model_dump') else None
        usage = result.context_wrapper.usage
        finish(engine, str(result.final_output or ''), 'openai',
               {'input_tokens':usage.input_tokens, 'output_tokens':usage.output_tokens}, structured,
               native_state={'messages':deepcopy(session.items) if session else result.to_input_list(),'last_agent':result.last_agent.name,'experiment':experiment})
        engine.record('session.committed',{'session_id':engine.sid,'items':len(session.items if session else result.to_input_list()),'last_agent':result.last_agent.name,'method':'SDK Session protocol' if session else 'Explicit SDK input history'})
    try:
        from copy import deepcopy
        await cancellable(engine, consume())
    except (InputGuardrailTripwireTriggered,OutputGuardrailTripwireTriggered) as exc:
        phase='input' if isinstance(exc,InputGuardrailTripwireTriggered) else 'output'
        engine.record('guardrail.blocked',{'phase':phase,'calls':counter['calls'],'output_released':False})
        raise Problem('SDK '+phase+' guardrail blocked this run. Inspect the rule and receipt; no final findings were released.',403) from None
    except APIStatusError as exc:
        # Never persist raw provider messages, which can contain credential
        # fragments or request content. Reservations remain for failed calls.
        if exc.code == 'insufficient_quota':
            message = 'OpenAI API credits are exhausted or its spending limit was reached. Check API billing; ChatGPT subscriptions do not include API credit.'
        elif exc.status_code == 401:
            message = 'OpenAI rejected the server API credential. Ask the operator to check the configured key.'
        elif exc.status_code == 429:
            message = 'OpenAI rate limit reached. Wait before trying again.'
        elif exc.status_code in (403,404):
            message = 'The configured OpenAI project or model is not accessible to this key.'
        else:
            message = 'OpenAI returned an API error. No automatic retry was made by the API client.'
        raise Problem(message,502) from None
    except APIConnectionError:
        raise Problem('The OpenAI connection failed. Its budget reservation is retained; check connectivity before retrying.',502) from None
    finally:
        if not result.is_complete: result.cancel()
        for aid in hooks.approved:
            engine.store.db.execute("UPDATE relay_approvals SET status='failed' WHERE id=? AND status='executing'",(aid,))
        engine.store.db.commit()
        if client is not None: await client.close()
