import unittest
from resource_probe import process_stat, disk_counters


class ProcessStatTest(unittest.TestCase):
    def test_process_name_does_not_shift_counters(self):
        fields = ['S'] + ['0'] * 23
        fields[11], fields[12], fields[19], fields[21] = '17', '23', '987', '123'
        self.assertEqual(process_stat('42 (worker (with) spaces) ' + ' '.join(fields)), (987, 40, 123))

    def test_disk_fields_and_device_filter(self):
        raw = '259 0 nvme0n1 ' + ' '.join(str(n) for n in range(1, 18))
        counters = disk_counters(raw, {'259:0'})['nvme0n1']
        self.assertEqual((5, 7, 8, 16, 17), tuple(counters[k] for k in ('writes', 'write_sectors', 'write_ms', 'flushes', 'flush_ms')))
        self.assertEqual({}, disk_counters(raw, {'259:2'}))
        old = '259 2 nvme0n1p2 ' + ' '.join(str(n) for n in range(1, 12))
        self.assertNotIn('flushes', disk_counters(old, {'259:2'})['nvme0n1p2'])
        with self.assertRaises(ValueError): disk_counters('259 0 nvme0n1 1', {'259:0'})


if __name__ == '__main__':
    unittest.main()
