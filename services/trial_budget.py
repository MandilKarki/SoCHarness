"""Persistent, fail-closed trial reservations. Dollar values use integer microdollars.

Only the pinned nano model and local function tools are permitted. A $0.10
reservation covers its entire 400k input window plus 2048 output tokens at the
reviewed standard rates ($0.20/$1.25 per million). Unknown/failed/cancelled calls
keep their reservation. This is NOT an account-wide provider billing limit.
"""
import os
from datetime import datetime, timezone
from store import Problem, now, uid

MODEL = 'gpt-5.4-nano-2026-03-17'
LIMIT = 5_000_000
SPENDABLE = 4_500_000  # $0.50 stays unused as an additional billing buffer.
RESERVATION = 100_000
MAX_OUTPUT = 2048


def enabled():
    return os.getenv('RELAY_TRIAL_ENABLED', '0') == '1'


def deadline():
    try:
        value = datetime.fromisoformat(os.environ['RELAY_TRIAL_UNTIL'].replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise ValueError()
        return value.timestamp()
    except (KeyError, ValueError):
        raise Problem('Trial is locked: configure an explicit RELAY_TRIAL_UNTIL deadline.', 409)


def check_runtime(runtime, model=None):
    if runtime == 'simulator':
        return
    if enabled():
        if datetime.now(timezone.utc).timestamp() >= deadline():
            raise Problem('Today’s LLM trial has ended. No new paid requests are allowed.', 409)
        if runtime != 'openai' or (model is not None and model != MODEL):
            raise Problem('The shared trial budget permits only OpenAI Agents with '+MODEL+'.', 409)
    elif os.getenv('RELAY_MODE') == 'pilot' and runtime == 'openai':
        raise Problem('Pilot OpenAI calls require the trial spending guard.', 409)


class TrialBudget:
    def __init__(self, store):
        self.db = store.db

    def configure(self):
        expires = deadline()
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO relay_trial(id,expires_at,halted) VALUES(1,?,0)', (expires,))
            # Restarting or changing an environment value cannot extend this trial.
            self.db.execute('UPDATE relay_trial SET expires_at=min(expires_at,?) WHERE id=1', (expires,))

    def snapshot(self):
        if not enabled():
            return {'enabled': False}
        self.configure()
        row = self.db.execute('SELECT * FROM relay_trial WHERE id=1').fetchone()
        used = self.db.execute('SELECT coalesce(sum(charged_micros),0) FROM relay_trial_calls').fetchone()[0]
        counts = self.db.execute("SELECT count(*),coalesce(sum(state='reserved'),0) FROM relay_trial_calls").fetchone()
        expired = datetime.now(timezone.utc).timestamp() >= row['expires_at']
        return {'enabled': True, 'limit_usd': LIMIT/1e6, 'spendable_usd': SPENDABLE/1e6,
                'accounted_usd': used/1e6, 'remaining_usd': max(0, SPENDABLE-used)/1e6,
                'buffer_usd': (LIMIT-SPENDABLE)/1e6, 'requests': counts[0], 'unsettled_requests': counts[1],
                'expires_at': datetime.fromtimestamp(row['expires_at'], timezone.utc).isoformat(),
                'blocked': bool(expired or row['halted'] or used+RESERVATION > SPENDABLE),
                'model': MODEL, 'scope': 'This Relay database only; not an account-wide billing cap.'}

    def reserve(self, sid, model):
        check_runtime('openai', model)
        if not enabled():
            raise Problem('Trial guard must be enabled.', 409)
        self.configure()
        rid = uid('cost')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self.db.execute('SELECT * FROM relay_trial WHERE id=1').fetchone()
            if row['halted'] or datetime.now(timezone.utc).timestamp() >= row['expires_at']:
                raise Problem('LLM trial is stopped or expired.', 409)
            used = self.db.execute('SELECT coalesce(sum(charged_micros),0) FROM relay_trial_calls').fetchone()[0]
            if used + RESERVATION > SPENDABLE:
                raise Problem('Trial budget reached: insufficient funds for another safe reservation.', 402)
            self.db.execute('INSERT INTO relay_trial_calls VALUES(?,?,?,?,?,?,?,?,?)',
                            (rid, sid, model, RESERVATION, 'reserved', None, None, now(), None))
        return rid

    def settle(self, rid, input_tokens, output_tokens):
        if (type(input_tokens) is not int or type(output_tokens) is not int or
                not 0 <= input_tokens <= 400_000 or not 0 <= output_tokens <= MAX_OUTPUT):
            with self.db:
                self.db.execute('UPDATE relay_trial SET halted=1 WHERE id=1')
            raise Problem('Unexpected model usage; trial locked and reservation retained.', 502)
        # Round up, count all input at the uncached rate, include reasoning in output.
        cost = (input_tokens*4 + output_tokens*25 + 19)//20
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self.db.execute('SELECT * FROM relay_trial_calls WHERE id=?', (rid,)).fetchone()
            if not row or row['state'] != 'reserved':
                raise Problem('Trial receipt is missing or already settled.', 409)
            self.db.execute("UPDATE relay_trial_calls SET charged_micros=?,state='settled',input_tokens=?,output_tokens=?,settled_at=? WHERE id=?",
                            (cost, input_tokens, output_tokens, now(), rid))
            self.db.execute('UPDATE relay_sessions SET cost_usd=cost_usd+? WHERE id=?', (cost/1e6, row['session_id']))
        return cost/1e6


def guarded_model(delegate, engine):
    from agents import Model

    class GuardedModel(Model):
        def reserve(self):
            engine.check()
            receipt = TrialBudget(engine.store).reserve(engine.sid, MODEL)
            engine.record('budget.reserved', {'receipt': receipt, 'reserved_usd': RESERVATION/1e6})
            return receipt

        def settle(self, receipt, usage):
            if usage is None:
                raise Problem('Provider omitted usage; reservation retained.', 502)
            cost = TrialBudget(engine.store).settle(receipt, usage.input_tokens, usage.output_tokens)
            engine.record('budget.settled', {'receipt': receipt, 'cost_usd': cost, 'pricing': 'uncached upper estimate'})

        async def get_response(self, *args, **kwargs):
            # The SDK normalizes missing non-streaming usage to zero. Only the
            # streaming path exposes the provider's original usage receipt.
            raise Problem('Trial requires streamed responses with original usage receipts.', 409)

        async def stream_response(self, *args, **kwargs):
            receipt = self.reserve()
            completed = False
            async for event in delegate.stream_response(*args, **kwargs):
                if event.type == 'response.completed':
                    self.settle(receipt, event.response.usage)
                    completed = True
                yield event
            if not completed:
                raise Problem('Model stream ended without final usage; reservation retained.', 502)

    return GuardedModel()
