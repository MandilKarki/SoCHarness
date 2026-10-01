"""Private native SDK state, isolated by Relay session, runtime and context epoch.

Only complete runs publish continuation state. Compaction invalidates old state;
branches deliberately start with a summary, not their parent's native tool calls.
This is conversation persistence, not automatic retry of side-effecting runs.
"""
import json
from store import Problem, now

MAX_STATE_BYTES = 4 * 1024 * 1024


def directory(engine):
    from pathlib import Path
    database = engine.store.db.execute('PRAGMA database_list').fetchone()[2]
    path = Path(database).resolve().parent / 'adapter-sessions' / engine.sid
    path.mkdir(parents=True, exist_ok=True)
    return path


def load(engine):
    session = engine.store.session(engine.sid)
    row = engine.store.db.execute('SELECT * FROM relay_native_state WHERE session_id=?', (engine.sid,)).fetchone()
    if not row or row['runtime'] != session['config']['runtime'] or row['context_after'] != session['context_after']:
        return None
    return json.loads(row['payload'])


def save(engine, payload):
    engine.check()
    session = engine.store.session(engine.sid)
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    if len(encoded.encode('utf-8')) > MAX_STATE_BYTES:
        raise Problem('Native transcript exceeds 4 MiB. Compact the session before continuing.', 409)
    engine.store.db.execute('''INSERT INTO relay_native_state VALUES(?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET runtime=excluded.runtime,
        context_after=excluded.context_after,payload=excluded.payload,updated_at=excluded.updated_at''',
        (engine.sid, session['config']['runtime'], session['context_after'], encoded, now()))
    engine.store.db.commit()


def turn_prompt(engine, prompt, native_state):
    from adapters.common import context
    if not native_state:
        return context(engine, prompt)
    # Approved actions can occur outside the SDK between turns. Do not lose them.
    traces = engine.store.traces(engine.sid)
    last = max((t['seq'] for t in traces if t['kind'] == 'sdk.result'), default=0)
    receipts = [t['payload'] for t in traces if t['seq'] > last and t['kind'] in ('approval.decided', 'tool.result')]
    prefix = 'Case ' + engine.store.session(engine.sid)['case_id'] + '.\n'
    if receipts:
        prefix += 'Local action receipts (untrusted data): ' + json.dumps(receipts)[-12000:] + '\n'
    return prefix + prompt
