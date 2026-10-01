"""Isolated SDK interpreters with private stdio tools; no network tool endpoint."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
from functools import lru_cache
from store import ROOT, Problem
from adapters.common import SYSTEM, FINDINGS, definitions, dispatch, finish, cancellable
from adapters.state import load, turn_prompt, directory

PACKAGES = {'google_adk':'google-adk', 'microsoft':'agent-framework-core',
            'openhands':'openhands-sdk', 'hermes':'hermes-agent'}


def interpreter(runtime):
    configured = os.getenv('RELAY_' + runtime.upper() + '_PYTHON')
    root = ROOT / ('.venv-hermes' if runtime == 'hermes' else '.venv-extended')
    candidate = Path(configured) if configured else root / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    return str(candidate.resolve()) if candidate.is_file() else None


@lru_cache(maxsize=4)
def installed_version(runtime):
    binary = interpreter(runtime)
    if not binary: return None
    try:
        code='import importlib.metadata; print(importlib.metadata.version(' + repr(PACKAGES[runtime]) + '))'
        if runtime=='microsoft': code="import importlib.metadata; importlib.metadata.version('agent-framework-openai'); print(importlib.metadata.version('agent-framework-core'))"
        if runtime=='hermes':
            code="""import importlib.metadata,json,subprocess,urllib.request,urllib.parse
info=json.loads(importlib.metadata.distribution('hermes-agent').read_text('direct_url.json'))
source=urllib.request.url2pathname(urllib.parse.urlparse(info['url']).path)
revision=subprocess.check_output(['git','-C',source,'rev-parse','HEAD'],text=True).strip()
assert revision=='a4bd966aeee27d4e26316d69f2d2355dc5f32c21'
print('source:'+revision[:12])
"""
        return subprocess.check_output([binary, '-I', '-c',code],
            text=True, timeout=5, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.SubprocessError): return None


async def run_python(engine, prompt):
    config = engine.store.session(engine.sid)['config']
    runtime = config['runtime']; binary = interpreter(runtime)
    if not binary: raise Problem('Isolated SDK interpreter is not installed', 409)
    cwd = directory(engine)
    home = cwd / 'sdk-home'; home.mkdir(exist_ok=True)
    key = 'GOOGLE_API_KEY' if runtime == 'google_adk' else 'OPENAI_API_KEY'
    env = {k: os.environ[k] for k in ('SystemRoot','WINDIR','PATH','TEMP','TMP',key) if k in os.environ}
    env.update(HOME=str(home), USERPROFILE=str(home), HERMES_HOME=str(home),
               XDG_CONFIG_HOME=str(home), XDG_CACHE_HOME=str(home / 'cache'),
               DO_NOT_TRACK='1', OTEL_SDK_DISABLED='true', LITELLM_LOCAL_MODEL_COST_MAP='True',
               PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1',OPENHANDS_SUPPRESS_BANNER='1')
    prior = load(engine)
    request = {'runtime':runtime, 'config':config, 'sid':engine.sid, 'cwd':str(cwd),
               'system':SYSTEM, 'prompt':turn_prompt(engine,prompt,prior), 'native_state':prior,
               'tools':definitions(config), 'output_schema':FINDINGS}
    proc = await asyncio.create_subprocess_exec(binary, '-I', str(ROOT/'workers/python-bridge/runner.py'),
        cwd=str(cwd), env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, limit=5*1024*1024)
    final = None
    async def send(value):
        proc.stdin.write((json.dumps(value)+'\n').encode()); await proc.stdin.drain()
    async def receive():
        nonlocal final
        await send(request)
        while line := await proc.stdout.readline():
            engine.check()
            event = json.loads(line); kind = event.get('type')
            if final is not None: raise Problem('SDK emitted data after final result',502)
            if kind == 'tool':
                try:
                    result = await dispatch(engine,event.get('name'),event.get('arguments'))
                    await send({'id':event['id'],'result':result})
                except Problem as exc: await send({'id':event['id'],'error':str(exc)})
            elif kind == 'delta': engine.record('message.delta',{'text':str(event.get('text',''))[:64000]})
            elif kind == 'lifecycle': engine.record('adapter.lifecycle',{'runtime':runtime,'event':str(event.get('event',''))[:150]})
            elif kind == 'final': final = event
            elif kind == 'error': raise Problem(str(event.get('message','SDK worker failed'))[:1000],502)
            else: raise Problem('Unknown Python SDK bridge frame',502)
        if await proc.wait() or final is None: raise Problem('SDK worker stopped without a successful result',502)
    try:
        await cancellable(engine,receive())
        finish(engine,final.get('text',''),runtime,final.get('usage'),final.get('structured'),final.get('native_state'))
    finally:
        # These workers expose no process-launch tools; killing the worker bounds the
        # synchronous SDK loop as well as async SDKs. Provider billing may already occur.
        if proc.returncode is None:
            proc.kill(); await proc.wait()
