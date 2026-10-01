"""Wait for an explicitly provisioned evidence database; never generate or overwrite it."""
import os
import sys
import time
from store import DB
from access import Access

def main():
    Access()  # Fail before waiting if authentication configuration is invalid.
    wait = min(900, max(0, int(os.getenv('RELAY_BOOTSTRAP_WAIT', '0'))))
    deadline = time.monotonic() + wait
    if not DB.is_file():
        print('Waiting for operator-provisioned evidence. No HTTP listener is open.', flush=True)
    while not DB.is_file() and time.monotonic() < deadline:
        time.sleep(2)
    if not DB.is_file():
        raise SystemExit('Evidence missing; no database was created.')
    os.execv(sys.executable, [sys.executable, str(__import__('pathlib').Path(__file__).with_name('app.py'))])

if __name__ == '__main__':
    main()
