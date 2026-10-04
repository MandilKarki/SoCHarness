"""Private stdin/stdout bridge, never an unauthenticated HTTP tool endpoint."""
import asyncio
import json
import os
from store import ROOT, DATA, Problem
from adapters.registry import node_binary
from adapters.common import SYSTEM,FINDINGS,definitions,dispatch,context,finish,cancellable
from adapters.state import load,save,turn_prompt,directory

async def run_node(engine,prompt):
    import anthropic_budget
    runtime=engine.store.session(engine.sid)['config']['runtime']
    if runtime=='pi' and anthropic_budget.guarded('pi'):
        # Pi gets a per-run token and a loopback URL; the meter holds the real key.
        async with anthropic_budget.MeterProxy(engine) as meter:
            return await _run_node(engine,prompt,{'ANTHROPIC_API_KEY':meter.token,'RELAY_ANTHROPIC_BASE_URL':meter.base_url})
    return await _run_node(engine,prompt)

async def _run_node(engine,prompt,meter_env=None):
    config=engine.store.session(engine.sid)['config'];runtime=config['runtime']
    cwd=directory(engine)
    # Child gets only its provider key, never all server environment secrets.
    names=['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','HOME','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS']
    names+= {'pi':['ANTHROPIC_API_KEY'],'vercel':['AI_GATEWAY_API_KEY'],'opencode':['RELAY_OPENCODE_URL','RELAY_OPENCODE_PASSWORD']}[runtime]
    env={name:os.environ[name] for name in names if name in os.environ}
    env.update({'NO_COLOR':'1','PI_CODING_AGENT_DIR':str(cwd),'DO_NOT_TRACK':'1'})
    env.update(meter_env or {})
    async def send(value):
        proc.stdin.write((json.dumps(value,ensure_ascii=False)+'\n').encode());await proc.stdin.drain()
    prior=load(engine)
    request={'runtime':runtime,'config':config,'sid':engine.sid,'cwd':str(cwd),'system':SYSTEM,
             'prompt':turn_prompt(engine,prompt,prior),'native_state':prior,'tools':definitions(config),'output_schema':FINDINGS}
    if runtime=='opencode':
        # Snapshot-only: records fetched through the same permissions gateway before model dispatch.
        request['evidence']=await dispatch(engine,'query_case_evidence',{'limit':5,'search':''})
    proc=await asyncio.create_subprocess_exec(node_binary(),str(ROOT/'workers/agent-bridge/runner.mjs'),
        cwd=str(ROOT/'workers/agent-bridge'),env=env,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,limit=1024*1024)
    final=None
    async def receive():
        nonlocal final
        await send({'type':'run',**request})
        while True:
            line=await proc.stdout.readline()
            if not line:break
            engine.check()
            try:event=json.loads(line)
            except ValueError:raise Problem('Invalid SDK bridge protocol',502)
            kind=event.get('type')
            if kind=='tool':
                try:
                    result=await dispatch(engine,event.get('name'),event.get('arguments'))
                    await send({'type':'tool_result','id':event['id'],'result':result})
                except Problem as exc:await send({'type':'tool_result','id':event['id'],'error':str(exc)})
            elif kind=='delta':engine.record('message.delta',{'text':str(event.get('text',''))[:64000]})
            elif kind=='lifecycle':engine.record('adapter.lifecycle',{'runtime':runtime,'event':str(event.get('event',''))[:150]})
            elif kind=='final':
                if final is not None:raise Problem('Duplicate SDK result',502)
                final=event
            elif kind=='error':raise Problem(str(event.get('message','Adapter failed'))[:1000],502)
            else:raise Problem('Unknown SDK bridge message',502)
        code=await proc.wait()
        if code or final is None:raise Problem('SDK worker stopped without a successful result',502)
    try:
        await cancellable(engine,receive())
        finish(engine,final.get('text',''),runtime,final.get('usage'),final.get('structured'),final.get('native_state'))
    finally:
        if proc.returncode is None:
            try:
                await send({'type':'cancel'});await asyncio.wait_for(proc.wait(),5)
            except (OSError,asyncio.TimeoutError,ConnectionError):
                proc.kill();await proc.wait()
