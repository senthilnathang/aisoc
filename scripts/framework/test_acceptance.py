"""The aggregate must fail closed when a subprocess/report is incomplete."""
import unittest
from acceptance import validate_report, REQUIRED


class ReportTests(unittest.TestCase):
    def test_complete(self):
        validate_report(dict(passed=True, mode='local/mock', active_backend_modified=False, stages={k:{} for k in REQUIRED}))

    def test_incomplete_or_wrong_mode(self):
        valid=dict(passed=True, mode='local/mock', active_backend_modified=False, stages={k:{} for k in REQUIRED})
        for patch in ({'passed':False},{'passed':1},{'mode':'live'},{'active_backend_modified':True},{'stages':{}}, {'stages':{k:{} for k in REQUIRED-{'detect_feedback'}}}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_report({**valid, **patch})


if __name__ == '__main__':
    unittest.main()
