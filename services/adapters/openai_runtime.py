"""OpenAI Agents SDK runner, streamed events, typed findings and native input history.

Only Relay function tools are exposed. No hosted shell/browser, external MCP or
remote trace export. Credentials remain on the server, never in transcripts.
"""
import json
import os
from adapters.common import SYSTEM, definitions, dispatch, finish, cancellable
from adapters.state import load, turn_prompt


async def run_openai(engine, prompt, model_override=None):
    from agents import Agent, Runner, FunctionTool, ModelSettings, ModelRetrySettings, RunConfig, OpenAIResponsesModel
    from openai import AsyncOpenAI, APIStatusError, APIConnectionError
    from store import Problem
    from pydantic import BaseModel
    config = engine.store.session(engine.sid)['config']
    from trial_budget import enabled, check_runtime, guarded_model, MAX_OUTPUT
    check_runtime('openai', config['model'])
    trial = enabled()
    tools = []
    for spec in definitions(config):
        if spec['name'] == 'query_case_evidence':
            # Mirror the executable contract; an unconstrained integer invited
            # invalid requests (for example limit=100) in the live pilot.
            spec['schema']['properties']['limit'].update(minimum=1, maximum=25,
                description='Maximum evidence records to return, from 1 to 25. Start with 3.')
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
    model = model_override or OpenAIResponsesModel(model=config['model'], openai_client=client)
    if trial:
        model = guarded_model(model, engine)
    agent = Agent(name='Relay SOC analyst', instructions=SYSTEM, model=model, tools=tools,
                  model_settings=ModelSettings(max_tokens=min(config['max_output_tokens'], MAX_OUTPUT) if trial else config['max_output_tokens'],
                                               parallel_tool_calls=False, store=False,
                                               retry=ModelRetrySettings(max_retries=0),
                                               extra_args={'service_tier':'default'} if trial else None),
                  output_type=Findings if config['structured_output'] else None)
    prior = load(engine)
    items = list(prior['messages']) if prior else []
    items.append({'role':'user', 'content':turn_prompt(engine, prompt, prior)})
    engine.record('adapter.lifecycle', {'runtime':'openai', 'event':'session.resumed' if prior else 'session.created'})
    result = Runner.run_streamed(agent, input=items, max_turns=min(config['max_turns'], 6) if trial else config['max_turns'],
                                run_config=RunConfig(tracing_disabled=True))

    async def consume():
        async for event in result.stream_events():
            engine.check()
            if event.type == 'raw_response_event' and event.data.type == 'response.output_text.delta':
                engine.record('message.delta', {'text':event.data.delta})
            elif event.type == 'run_item_stream_event':
                engine.record('adapter.lifecycle', {'runtime':'openai', 'event':event.name})
        structured = result.final_output.model_dump() if config['structured_output'] else None
        usage = result.context_wrapper.usage
        finish(engine, str(result.final_output or ''), 'openai',
               {'input_tokens':usage.input_tokens, 'output_tokens':usage.output_tokens}, structured,
               native_state={'messages':result.to_input_list()})
    try:
        await cancellable(engine, consume())
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
        if client is not None: await client.close()
