"""One-time Fly volume initialization, run as root after private SFTP upload."""
import hashlib
import json
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

def provision(expected_digest):
    data=Path('/data').resolve()
    source=data/'evidence.pending.sqlite3'; target=data/'telemetry-lab.sqlite3'
    if data!=Path('/data') or source.is_symlink() or target.exists():
        raise ValueError('Only a fresh /data volume may be initialized; refusing replacement.')
    digest=hashlib.sha256(); count=0
    with closing(sqlite3.connect(source.as_uri()+'?mode=rw',uri=True)) as db:
        tables=db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        if tables!=[('events',)]: raise ValueError('Upload must contain only benchmark events')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Database integrity failure')
        for row in db.execute('SELECT id,occurred_at,event_id,host,user_name,source,raw_json FROM events ORDER BY id'):
            digest.update(json.dumps(row,ensure_ascii=False,separators=(',',':')).encode()+b'\n');count+=1
        if count!=155350 or digest.hexdigest()!=expected_digest:raise ValueError('Evidence checksum/count mismatch')
        db.execute('CREATE TABLE relay_adapters(id TEXT PRIMARY KEY, enabled INTEGER NOT NULL)')
        db.execute("INSERT INTO relay_adapters VALUES('opencode',0)")
        db.commit()
    # Exact paths only: never recursive ownership changes or replacement of an existing DB.
    os.chown(data,10001,10001);os.chmod(data,0o700)
    os.chown(source,10001,10001);os.chmod(source,0o600)
    # link fails if the destination appeared concurrently; source remains recoverable.
    os.link(source,target)
    source.unlink()
    print(json.dumps({'records':count,'verified_sha256':digest.hexdigest(),'owner':10001,'opencode':'disabled'}))

if __name__=='__main__':provision(sys.argv[1])
