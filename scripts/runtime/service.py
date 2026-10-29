#!/usr/bin/env python3
"""Foreground entrypoint for an initialized release under an external supervisor."""
import json
import os
import sys
from manage import ROOT, PG, runtime_environment

os.umask(0o077)
if len(sys.argv)!=2 or sys.argv[1] not in ('api','investigation-worker','postgres'):
    raise SystemExit('Use service.py api|investigation-worker|postgres')
state=ROOT/'.run/go-runtime'
config=json.loads((state/'settings.json').read_text())
if not config['imported']:raise SystemExit('Release import is incomplete')
name=sys.argv[1]
if name=='postgres':
    binary=str(PG/'postgres');arguments=[binary,'-D',str(state/'pg'),'-h','127.0.0.1','-p',str(config['pg_port']),'-k',str(state)]
    os.execve(binary,arguments,os.environ)
else:
    binary=str(state/'bin'/name)
    (state/(name+'.pid')).write_text(str(os.getpid()))
    os.execve(binary,[binary],runtime_environment(config))
