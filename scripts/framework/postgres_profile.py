"""Allowlisted local PostgreSQL tuning; durability cannot be disabled here."""
import json
import os
import stat


def options(path):
    mandatory = '-c fsync=on -c synchronous_commit=on -c full_page_writes=on'
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return mandatory
    with os.fdopen(descriptor, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError('PostgreSQL profile must be a regular file')
        raw = source.read(1025)
    if len(raw) > 1024:
        raise ValueError('PostgreSQL profile exceeds size limit')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate PostgreSQL profile key')
            result[key] = value
        return result
    values = json.loads(raw, object_pairs_hook=unique)
    rules = {
        'shared_buffers_mb': ('shared_buffers', (128, 256, 512), 'MB'),
        'work_mem_mb': ('work_mem', (4, 16, 32), 'MB'),
        'wal_sync_method': ('wal_sync_method', ('fdatasync', 'open_datasync', 'fsync'), ''),
        'wal_init_zero': ('wal_init_zero', ('on', 'off'), ''),
    }
    if not isinstance(values, dict) or set(values) - rules.keys():
        raise ValueError('Unknown PostgreSQL profile setting')
    result = [mandatory]
    for key, value in sorted(values.items()):
        setting, allowed, unit = rules[key]
        if type(value) is not type(allowed[0]) or value not in allowed:
            raise ValueError('Invalid PostgreSQL profile value')
        result.append(f'-c {setting}={value}{unit}')
    return ' '.join(result)
