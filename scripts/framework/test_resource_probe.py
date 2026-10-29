import unittest
from resource_probe import process_stat


class ProcessStatTest(unittest.TestCase):
    def test_process_name_does_not_shift_counters(self):
        fields = ['S'] + ['0'] * 23
        fields[11], fields[12], fields[19], fields[21] = '17', '23', '987', '123'
        self.assertEqual(process_stat('42 (worker (with) spaces) ' + ' '.join(fields)), (987, 40, 123))


if __name__ == '__main__':
    unittest.main()
