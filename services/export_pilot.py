"""Export only immutable benchmark events to a NEW pilot database, never local sessions."""
import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

def export(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or destination.exists():
        raise ValueError('Use a new destination; refusing to overwrite any database.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(); count = 0
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro', uri=True)) as src, closing(sqlite3.connect(destination)) as dst:
        dst.execute('CREATE TABLE events(id INTEGER PRIMARY KEY,occurred_at TEXT,event_id TEXT,host TEXT,user_name TEXT,source TEXT,raw_json TEXT NOT NULL)')
        rows = src.execute('SELECT id,occurred_at,event_id,host,user_name,source,raw_json FROM events ORDER BY id')
        while batch := rows.fetchmany(500):
            dst.executemany('INSERT INTO events VALUES(?,?,?,?,?,?,?)', batch)
            for row in batch: digest.update(json.dumps(row,ensure_ascii=False,separators=(',',':')).encode()+b'\n')
            count += len(batch)
        dst.commit()
        assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert dst.execute('SELECT count(*) FROM events').fetchone()[0] == count
    return {'events':count, 'ordered_rows_sha256':digest.hexdigest(), 'tables':['events']}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source'); parser.add_argument('destination')
    args=parser.parse_args(); print(json.dumps(export(args.source,args.destination)))
