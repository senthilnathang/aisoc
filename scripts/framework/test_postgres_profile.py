import json
from pathlib import Path
import tempfile
import unittest
from postgres_profile import options


class PostgresProfileTests(unittest.TestCase):
    def test_profile_preserves_durability_and_rejects_injection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'profile.json'
            mandatory = options(path)
            self.assertIn('synchronous_commit=on', mandatory)
            path.write_text(json.dumps(dict(shared_buffers_mb=512, work_mem_mb=32,
                wal_sync_method='fsync', wal_init_zero='off')))
            self.assertIn(mandatory, options(path))
            self.assertIn('shared_buffers=512MB', options(path))
            for value in ({'fsync': 'off'}, {'shared_buffers_mb': 8192},
                          {'wal_sync_method': 'fsync -c fsync=off'}, [], {'work_mem_mb': True}):
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError): options(path)
            path.write_text('{"work_mem_mb":4,"work_mem_mb":32}')
            with self.assertRaises(ValueError): options(path)
            link = Path(directory)/'link'
            link.symlink_to(path)
            with self.assertRaises(OSError): options(link)


if __name__ == '__main__':
    unittest.main()
