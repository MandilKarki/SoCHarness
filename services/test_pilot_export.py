import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from export_pilot import export

class PilotExportTest(unittest.TestCase):
    def test_exports_only_evidence_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'source.db'; dest=Path(tmp)/'pilot.db'
            with closing(sqlite3.connect(source)) as db:
                db.execute('CREATE TABLE events(id INTEGER PRIMARY KEY,occurred_at TEXT,event_id TEXT,host TEXT,user_name TEXT,source TEXT,raw_json TEXT NOT NULL)')
                db.execute('INSERT INTO events VALUES(1,?,?,?,?,?,?)',('now','4624','lab','analyst','benchmark','{}'))
                db.execute('CREATE TABLE private_sessions(secret TEXT)')
                db.execute("INSERT INTO private_sessions VALUES('must not export')")
                db.commit()
            result=export(source,dest)
            self.assertEqual(result['events'],1)
            with closing(sqlite3.connect(dest)) as db:
                self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(),[('events',)])
            with self.assertRaises(ValueError):export(source,dest)
            with self.assertRaises(ValueError):export(source,source)

if __name__=='__main__':unittest.main()
