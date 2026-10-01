# Local service

Run `python services/app.py` from the project root for dependency-free replay, or `.\.venv\Scripts\python.exe services/app.py` for the optional Claude environment.

The compatibility entry point telemetry_api.py launches the same maintained server. Both bind to 127.0.0.1:8787. The database remains in work/telemetry-lab.sqlite3. New harness state is isolated in relay_* tables. No real containment connector exists.

See the project-root README for setup, API behavior, verification, source provenance, and limitations. Run `python -m unittest discover -s services -p test_*.py -v` for regression coverage.
