"""Capture immutable archives referenced by a restored database snapshot."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def capture(query, destination, archive_root, verifier, environment, log):
    """query operates only on the disposable restored database, never source."""
    if query("SELECT to_regclass('public.stream_event_archives') IS NOT NULL") != 't':
        return []
    records = json.loads(query("SELECT COALESCE(json_agg(r),'[]'::json) FROM (SELECT DISTINCT file_path,sha256 FROM stream_event_archives ORDER BY file_path,sha256) r"))
    root = Path(archive_root).resolve()
    receipts = []
    for record in records:
        original = Path(record['file_path'])
        resolved = original.resolve(strict=True)
        if original.is_symlink() or not resolved.is_relative_to(root) or not resolved.is_file():
            raise RuntimeError('Archive reference escapes configured private root')
        expected = record['sha256']
        if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected):
            raise RuntimeError('Invalid archive digest')
        copied = destination / ('archive-' + expected + '.json.gz')
        if not copied.exists():
            with resolved.open('rb') as source, copied.open('xb') as target:
                shutil.copyfileobj(source, target)
        subprocess.run([str(verifier), '--verify', str(copied), '--sha256', expected],
                       env=environment, stdout=log, stderr=log, check=True, timeout=30)
        with copied.open('rb') as source:
            compressed_hash = hashlib.file_digest(source, 'sha256').hexdigest()
        # Only restore references change. Immutable source files can remain in use.
        quote = lambda value: "'" + str(value).replace("'", "''") + "'"
        query('UPDATE stream_event_archives SET file_path=' + quote(copied.resolve()) +
              ' WHERE file_path=' + quote(record['file_path']) + ' AND sha256=' + quote(expected))
        receipts.append({'original_path': record['file_path'], 'file': copied.name,
                         'bundle_sha256': expected, 'file_sha256': compressed_hash})
    return receipts
