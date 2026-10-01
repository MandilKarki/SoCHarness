"""One invocation per process. SDK stdout is never mixed with protocol frames."""
import asyncio
import importlib
import json
from pathlib import Path
import sys
import threading

# -I excludes both cwd and user site packages. Only this shipped worker directory
# is added, never the writable session workspace or a user-supplied module path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
WIRE = sys.stdout
sys.stdout = sys.stderr


class Bridge:
    def __init__(self):
        self.lock = threading.Lock()
        self.output_lock = threading.Lock()
        self.counter = 0

    def emit(self, event):
        line = json.dumps(event, ensure_ascii=True, allow_nan=False)
        if len(line.encode()) > 5*1024*1024: raise ValueError('SDK bridge frame too large')
        with self.output_lock:
            WIRE.write(line+'\n'); WIRE.flush()

    def call_sync(self, name, arguments):
        with self.lock:
            self.counter += 1; ident = str(self.counter)
            self.emit({'type':'tool','id':ident,'name':name,'arguments':arguments})
            line = sys.stdin.readline(5*1024*1024)
            if not line or not line.endswith('\n'): raise RuntimeError('Tool channel closed or oversized')
            reply = json.loads(line)
            if reply.get('id') != ident: raise RuntimeError('Mismatched tool receipt')
            if 'error' in reply: raise RuntimeError(reply['error'])
            return reply['result']

    async def call(self, name, arguments):
        return await asyncio.to_thread(self.call_sync, name, arguments)


def main():
    bridge = Bridge()
    try:
        line = sys.stdin.readline(5*1024*1024)
        if not line.endswith('\n'): raise ValueError('Invalid initial frame')
        request = json.loads(line)
        module = {'google_adk':'google_runtime','microsoft':'microsoft_runtime',
                  'openhands':'openhands_runtime','hermes':'hermes_runtime'}[request['runtime']]
        result = asyncio.run(importlib.import_module(module).run(request,bridge))
        bridge.emit({'type':'final',**result})
    except Exception as exc:
        # Do not forward SDK exception bodies: they can contain provider headers or prompts.
        bridge.emit({'type':'error','message':'SDK worker failed ('+type(exc).__name__+'); inspect local contract tests and provider configuration.'})
        return 1
    return 0


if __name__ == '__main__': sys.exit(main())
