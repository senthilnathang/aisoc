#!/usr/bin/env python3
"""Consistent SQLite snapshots and new-file restores; outputs contain credentials."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

def write_private(path, value):
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(value, f, ensure_ascii=False, separators=(',', ':'))

def export(source, destination):
    with tempfile.TemporaryDirectory(prefix='aisoc-snapshot-') as temp:
        src=sqlite3.connect('file:'+str(Path(source).resolve())+'?mode=ro',uri=True)
        db=sqlite3.connect(str(Path(temp)/'snapshot.db'))
        src.backup(db);src.close()
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('SQLite integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchall(): raise RuntimeError('SQLite foreign key check failed')
        schema=[dict(zip(('type','name','sql'),r)) for r in db.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC,name")]
        tables={}
        for item in schema:
            if item['type']!='table': continue
            name=item['name'];quoted='"'+name.replace('"','""')+'"'
            cur=db.execute('SELECT * FROM '+quoted+' ORDER BY rowid');columns=[c[0] for c in cur.description]
            tables[name]=[dict(zip(columns,row)) for row in cur]
        result={'format_version':1,'schema':schema,'tables':tables}
        write_private(destination,result)
        print(json.dumps({'exported':True,'counts':{k:len(v) for k,v in tables.items()}}))

def restore(source,destination):
    data=json.loads(Path(source).read_text())
    if data['format_version']!=1: raise RuntimeError('Unsupported snapshot')
    fd=os.open(destination,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    db=sqlite3.connect(destination)
    try:
        db.execute('BEGIN')
        for item in data['schema']:
            if item['type']=='table': db.execute(item['sql'])
        for name,rows in data['tables'].items():
            quoted='"'+name.replace('"','""')+'"'
            for row in rows:
                columns=','.join('"'+k.replace('"','""')+'"' for k in row)
                db.execute('INSERT INTO '+quoted+'('+columns+') VALUES('+','.join('?' for _ in row)+')',list(row.values()))
        for item in data['schema']:
            if item['type']!='table': db.execute(item['sql'])
        if db.execute('PRAGMA foreign_key_check').fetchall(): raise RuntimeError('Restore foreign key check failed')
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('Restore integrity check failed')
    except BaseException:
        db.rollback();raise
    finally: db.close()
    print(json.dumps({'restored':True,'tables':len(data['tables'])}))

def canonical(value,key=''):
    if isinstance(value,float) and value.is_integer():return int(value)
    if isinstance(value,dict):return {k:canonical(v,k) for k,v in value.items()}
    if isinstance(value,list):return [canonical(v) for v in value]
    if isinstance(value,str) and key.endswith('_json'):
        return canonical(json.loads(value))
    if isinstance(value,str) and key.endswith('_at'):
        try:
            d=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
            if d.tzinfo:return d.astimezone(datetime.timezone.utc).isoformat(timespec='milliseconds')
        except ValueError:pass
    return value

def compare(left,right):
    a=json.loads(Path(left).read_text())['tables'];b=json.loads(Path(right).read_text())['tables'];report={};passed=set(a)==set(b)
    for name in sorted(set(a)|set(b)):
        rows=lambda data: sorted(json.dumps(canonical(r),sort_keys=True,ensure_ascii=False,separators=(',',':')) for r in data.get(name,[]))
        x,y=rows(a),rows(b);equal=x==y;passed=passed and equal
        report[name]={'left':len(x),'right':len(y),'equal':equal,'left_sha256':hashlib.sha256('\n'.join(x).encode()).hexdigest(),'right_sha256':hashlib.sha256('\n'.join(y).encode()).hexdigest()}
    print(json.dumps({'passed':passed,'tables':report},indent=2))
    if not passed:raise SystemExit(1)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('operation',choices=['export','restore','compare']);p.add_argument('source');p.add_argument('destination');a=p.parse_args()
    {'export':export,'restore':restore,'compare':compare}[a.operation](a.source,a.destination)
