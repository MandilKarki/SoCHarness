"""Create a non-overwriting, transactionally consistent SQLite backup. No upload."""
import argparse
import sqlite3
from contextlib import closing
from pathlib import Path
from store import DB


def backup(source, destination):
    source, destination = Path(source), Path(destination)
    if not source.is_file():raise ValueError('Source database missing')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create prevents silently replacing a prior backup.
    with destination.open('xb'):pass
    with closing(sqlite3.connect(source.resolve().as_uri()+'?mode=ro', uri=True)) as src, closing(sqlite3.connect(destination)) as dst:
        src.backup(dst)
        if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':raise ValueError('Backup integrity check failed')
    return destination.stat().st_size


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination',type=Path);parser.add_argument('--source',type=Path,default=DB)
    args=parser.parse_args();print('Verified backup bytes:',backup(args.source,args.destination))
