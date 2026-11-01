import hashlib
import json
import unittest
from archive_backup import verify_snapshots

class RetentionBackupTests(unittest.TestCase):
    def test_absent_schema(self):
        self.assertEqual(verify_snapshots(lambda sql: 'f'), 0)

    def test_bounded_pages(self):
        document = '{"id": "fixture"}'
        row = {'document': document, 'digest': hashlib.sha256(document.encode()).hexdigest()}
        def query(sql):
            if 'to_regclass' in sql:
                return 't'
            return json.dumps([row] * (25 if 'OFFSET 0)' in sql else 1))
        self.assertEqual(verify_snapshots(query), 26)

    def test_valid_and_corrupt_snapshot(self):
        document = '{"id": "fixture", "tenant_id": "tenant-a"}'
        row = {'document': document, 'digest': hashlib.sha256(document.encode()).hexdigest()}
        def query(sql):
            return 't' if 'to_regclass' in sql else json.dumps([row])
        self.assertEqual(verify_snapshots(query), 1)
        row['document'] = '{"changed": true}'
        with self.assertRaises(RuntimeError):
            verify_snapshots(query)

if __name__ == '__main__':
    unittest.main()
