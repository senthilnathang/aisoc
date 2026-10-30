#!/usr/bin/env python3
"""Encrypt an existing verified backup for a configured trusted GPG recipient."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--recipient', required=True, help='Trusted full fingerprint, already imported')
    parser.add_argument('--keyring', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if not re.fullmatch(r'[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64}', args.recipient):
        raise RuntimeError('Use a full trusted recipient fingerprint')
    manifest = json.loads((args.backup/'manifest.json').read_text())
    if manifest.get('passed') is not True:
        raise RuntimeError('Backup restore verification is required before export')
    dump = args.backup/'postgres.dump'
    with dump.open('rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != manifest['dump_sha256']:
            raise RuntimeError('Backup no longer matches its verified manifest')
    for archive in manifest.get('archives', []):
        name = archive['file']
        if Path(name).name != name or not name.startswith('archive-'):
            raise RuntimeError('Invalid archive receipt')
        with (args.backup/name).open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != archive['file_sha256']:
                raise RuntimeError('Archive no longer matches verified backup')
    args.destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Plaintext staging stays on the local temporary filesystem, never on the
    # potentially off-host destination mount. TemporaryDirectory is mode 0700.
    with tempfile.TemporaryDirectory(prefix='aisoc-encrypt-') as temporary:
        directory = Path(temporary)
        archive = directory/'backup.tar'
        with tarfile.open(archive, 'w') as tar:
            for item in sorted(args.backup.iterdir()):
                if item.is_symlink() or not item.is_file():
                    raise RuntimeError('Only regular backup files are accepted')
                tar.add(item, arcname=item.name, recursive=False)
        encrypted = directory/'backup.tar.gpg'
        subprocess.run(['gpg', '--homedir', str(args.keyring), '--batch', '--trust-model', 'always',
            '--recipient', args.recipient, '--output', str(encrypted), '--encrypt', str(archive)],
            check=True, timeout=300, stdout=subprocess.DEVNULL)
        with encrypted.open('rb') as saved:
            digest = hashlib.file_digest(saved, 'sha256').hexdigest(); os.fsync(saved.fileno())
        target = args.destination/(args.backup.name+'-'+digest[:16]+'.tar.gpg')
        with target.open('xb') as output, encrypted.open('rb') as source:
            shutil.copyfileobj(source, output); output.flush(); os.fsync(output.fileno())
        receipt = target.with_suffix(target.suffix+'.json')
        with receipt.open('x') as saved:
            json.dump({'sha256': digest, 'recipient': args.recipient, 'source_restore_verified': True,
                'encrypted_restore_verified': False, 'off_host_transfer_verified': False}, saved, indent=2)
            saved.write('\n'); saved.flush(); os.fsync(saved.fileno())
        print(target)


if __name__ == '__main__': main()
