"""Encryption transport round-trip; not an off-host PostgreSQL restore claim."""
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


@unittest.skipUnless(shutil.which('gpg'), 'GPG is required for encryption validation')
class EncryptBackupTests(unittest.TestCase):
    def test_private_roundtrip_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory(prefix='aisoc-encryption-test-') as temp:
            root = Path(temp); keyring = root/'keys'; keyring.mkdir(mode=0o700)
            backup = root/'verified'; backup.mkdir(); destination = root/'destination'
            payload = b'Synthetic backup fixture, not a production database'
            (backup/'postgres.dump').write_bytes(payload)
            (backup/'manifest.json').write_text(json.dumps({'passed': True, 'dump_sha256': hashlib.sha256(payload).hexdigest()}))
            gpg = ['gpg', '--homedir', str(keyring), '--batch', '--pinentry-mode', 'loopback', '--passphrase', '']
            try:
                subprocess.run(gpg+['--quick-generate-key', 'AISOC fixture <fixture@example.invalid>', 'rsa2048', 'encr', '1d'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                listing = subprocess.check_output(gpg+['--with-colons', '--list-keys'], text=True, stderr=subprocess.DEVNULL)
                fingerprint = next(line.split(':')[9] for line in listing.splitlines() if line.startswith('fpr:'))
                command = [sys.executable, str(Path(__file__).with_name('encrypt_backup.py')), '--backup', str(backup), '--destination', str(destination), '--keyring', str(keyring), '--recipient', fingerprint]
                subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                encrypted = next(destination.glob('*.gpg'))
                self.assertEqual(encrypted.stat().st_mode & 0o077, 0)
                decrypted = subprocess.check_output(gpg+['--decrypt', str(encrypted)], stderr=subprocess.DEVNULL, timeout=30)
                with tarfile.open(fileobj=io.BytesIO(decrypted)) as archive:
                    self.assertEqual(archive.extractfile('postgres.dump').read(), payload)
                self.assertTrue(all(p.suffix in ('.gpg', '.json') for p in destination.iterdir()))
                (backup/'postgres.dump').write_bytes(b'changed after verification')
                failed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                self.assertNotEqual(failed.returncode, 0)
            finally:
                subprocess.run(['gpgconf', '--homedir', str(keyring), '--kill', 'gpg-agent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__': unittest.main()
