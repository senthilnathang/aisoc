"""The aggregate must fail closed when a subprocess/report is incomplete."""
import unittest
from acceptance import validate_report, REQUIRED, PHISHING_EVIDENCE, HUNT_EVIDENCE


class ReportTests(unittest.TestCase):
    def test_complete(self):
        validate_report(dict(passed=True, mode='local/mock', active_backend_modified=False, stages={k:({field:True for field in PHISHING_EVIDENCE} if k=='phishing' else {field:True for field in HUNT_EVIDENCE} if k=='durable_hunt' else {}) for k in REQUIRED}))

    def test_missing_phishing_evidence(self):
        for field in PHISHING_EVIDENCE:
            stages={k:({key:True for key in PHISHING_EVIDENCE} if k=='phishing' else {field:True for field in HUNT_EVIDENCE} if k=='durable_hunt' else {}) for k in REQUIRED}
            stages['phishing'][field]=False
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_report(dict(passed=True,mode='local/mock',active_backend_modified=False,stages=stages))

    def test_missing_hunt_evidence(self):
        for field in HUNT_EVIDENCE:
            stages={k:({key:True for key in PHISHING_EVIDENCE} if k=='phishing' else {key:True for key in HUNT_EVIDENCE} if k=='durable_hunt' else {}) for k in REQUIRED}
            stages['durable_hunt'][field]=False
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_report(dict(passed=True,mode='local/mock',active_backend_modified=False,stages=stages))

    def test_incomplete_or_wrong_mode(self):
        valid=dict(passed=True, mode='local/mock', active_backend_modified=False, stages={k:({field:True for field in PHISHING_EVIDENCE} if k=='phishing' else {field:True for field in HUNT_EVIDENCE} if k=='durable_hunt' else {}) for k in REQUIRED})
        for patch in ({'passed':False},{'passed':1},{'mode':'live'},{'active_backend_modified':True},{'stages':{}}, {'stages':{k:{} for k in REQUIRED-{'detect_feedback'}}}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_report({**valid, **patch})


if __name__ == '__main__':
    unittest.main()
