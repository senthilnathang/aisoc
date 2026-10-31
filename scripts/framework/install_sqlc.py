#!/usr/bin/env python3
"""Install the checksum-pinned Linux amd64 sqlc generator, never a runtime service."""
import hashlib
import io
from pathlib import Path
import platform
import tarfile
import urllib.request

VERSION = '1.31.1'
SHA256 = '497ae4fcdfa64c5b0c311ffe4c2bd991e43991e82e5367792ed78bc2dca27354'
URL = f'https://github.com/sqlc-dev/sqlc/releases/download/v{VERSION}/sqlc_{VERSION}_linux_amd64.tar.gz'


def main():
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'amd64'):
        raise SystemExit('Install sqlc v1.31.1 for your platform and set make SQLC=/absolute/path')
    with urllib.request.urlopen(URL, timeout=60) as response:
        content = response.read(32 * 1024 * 1024)
    if hashlib.sha256(content).hexdigest() != SHA256:
        raise SystemExit('sqlc archive checksum mismatch')
    target = Path(__file__).resolve().parents[2] / 'backend-go/.tools/sqlc'
    target.parent.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
        member = archive.getmember('sqlc')
        if not member.isfile():
            raise SystemExit('Invalid sqlc archive member')
        target.write_bytes(archive.extractfile(member).read())
    target.chmod(0o755)
    print(f'Installed sqlc v{VERSION}')


if __name__ == '__main__':
    main()
