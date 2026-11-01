"""Offline validation of the local-only scenario loader."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import suspicious_login as scenario


class ScenarioTests(unittest.TestCase):
    def test_bundled_scenario(self):
        config, events = scenario.load(scenario.DEFAULT)
        self.assertTrue(config['scope']['require_analyst_review'])
        self.assertEqual(len(events), 4)

    def test_reject_unsafe_configuration(self):
        config, events = scenario.load(scenario.DEFAULT)
        mutations = [
            lambda c: c.update(api_base='https://provider.example'),
            lambda c: c.update(api_base='http://127.0.0.1:3002'),
            lambda c: c.update(api_base='http://user:password@localhost:3003'),
            lambda c: c['scope'].update(require_analyst_review=False),
            lambda c: c['scope'].update(allow_sandbox_response=True),
            lambda c: c.update(events_file='../outside.json'),
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'scenario.json'
            (path.parent / 'events.json').write_text(json.dumps(events))
            for mutate in mutations:
                with self.subTest(mutate=mutate):
                    changed = copy.deepcopy(config)
                    mutate(changed)
                    path.write_text(json.dumps(changed))
                    with self.assertRaises(ValueError):
                        scenario.load(path)

    def test_reject_foreign_event_identity(self):
        config, events = scenario.load(scenario.DEFAULT)
        events[0]['tenant_id'] = 'another-tenant'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'scenario.json'
            path.write_text(json.dumps(config))
            (path.parent / 'events.json').write_text(json.dumps(events))
            with self.assertRaises(ValueError):
                scenario.load(path)


if __name__ == '__main__':
    unittest.main()
