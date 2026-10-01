"""Explicit, non-overwriting import of Defense Collective sample.zip logs."""
import argparse
import json
import sqlite3
import zipfile
from pathlib import Path
from store import DB

def import_corpus(source,destination):
    destination=Path(destination)
    if destination.exists():raise ValueError('Destination already exists; refusing to overwrite evidence.')
    with zipfile.ZipFile(source) as archive:
        names=[n for n in archive.namelist() if n.endswith('sample.json')]
        if len(names)!=1:raise ValueError('Expected exactly one sample.json in the archive')
        rows=json.loads(archive.read(names[0])).get('logs')
    if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows):raise ValueError('Expected a logs array of objects')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(destination) as db:
        db.execute('CREATE TABLE events(id INTEGER PRIMARY KEY,occurred_at TEXT,event_id TEXT,host TEXT,user_name TEXT,source TEXT,raw_json TEXT NOT NULL)')
        db.executemany('INSERT INTO events(occurred_at,event_id,host,user_name,source,raw_json) VALUES(?,?,?,?,?,?)',
            [(str(r.get('TimeCreated','')),str(r.get('EventID','')),str(r.get('Computer') or r.get('Hostname') or ''),
              r.get('User'),r.get('Channel') or r.get('SourceName'),json.dumps(r)) for r in rows])
    return len(rows)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('--database',type=Path,default=DB)
    args=parser.parse_args()
    print('Imported',import_corpus(args.source,args.database),'records into',args.database)
