import unittest
from release_gate import validate_stage, WORKFLOW_EVIDENCE
from acceptance import REQUIRED

class ReleaseGateTests(unittest.TestCase):
    def test_malformed_and_missing_frontend(self):
        for report in ([],None,{},dict(passed=True,mode='local/mock',run_id='fresh')):
            with self.subTest(report=report),self.assertRaises(ValueError):validate_stage('frontend',report,'fresh')

    def test_api_run_identity_and_all_stages(self):
        good=dict(passed=True,run_id='fresh',mode='local/mock',active_backend_modified=False,stages={k:{} for k in REQUIRED})
        validate_stage('api',good,'fresh')
        for change in ({'run_id':'old'},{'passed':False},{'passed':1},{'mode':'live'},{'stages':{}},{'stages':None},{'active_backend_modified':True}):
            with self.subTest(change=change),self.assertRaises(ValueError):validate_stage('api',good|change,'fresh')

    def test_browser_requires_actual_complete_evidence(self):
        stages={k:dict(passed=True) for k in ('build_import','approval_handoff','notifications','retention_recovery','tenant_isolation','route_sweep')}
        paths=['/','/investigations','/respond','/hunt/threat-hunting','/threat-intel','/skills','/memory','/build','/respond/inbox','/build/retention']+[f'/fixture/{i}' for i in range(20)]
        stages['route_sweep']['checks']=[dict(path=p,width=w,passed=True) for p in paths for w in (1440,390)]
        stages.update({k:dict(passed=True,**{field:True for field in fields}) for k,fields in WORKFLOW_EVIDENCE.items()})
        good=dict(passed=True,mode='local/mock',run_id='fresh',stages=stages,route_checks=60,external_requests=[],page_errors=[],http_errors=[],durable_effect_deltas=dict(response_notes=1,response_audits=1,rule_applies=1))
        validate_stage('browser',good,'fresh')
        for change in ({'durable_effect_deltas':{}},{'durable_effect_deltas':dict(response_notes=2,response_audits=1,rule_applies=1)},{'stages':{}},{'stages':stages|{'notifications':None}},{'route_checks':2},{'external_requests':['https://external.invalid']},{'page_errors':['failure']},{'http_errors':[500]}):
            with self.subTest(change=change),self.assertRaises(ValueError):validate_stage('browser',good|change,'fresh')

        for stage,fields in WORKFLOW_EVIDENCE.items():
            for field in fields:
                with self.subTest(stage=stage,field=field),self.assertRaises(ValueError):
                    validate_stage('browser',good|{'stages':stages|{stage:stages[stage]|{field:False}}},'fresh')

    def test_browser_rejects_missing_critical_workflows(self):
        stages={k:dict(passed=True) for k in ('build_import','approval_handoff','notifications','retention_recovery','tenant_isolation','route_sweep')}
        paths=['/','/investigations','/respond','/hunt/threat-hunting','/threat-intel','/skills','/memory','/build','/respond/inbox','/build/retention']+[f'/fixture/{i}' for i in range(20)]
        stages['route_sweep']['checks']=[dict(path=p,width=w,passed=True) for p in paths for w in (1440,390)]
        with self.assertRaises(ValueError):
            validate_stage('browser',dict(passed=True,mode='local/mock',run_id='fresh',stages=stages,route_checks=60,external_requests=[],page_errors=[],http_errors=[]),'fresh')

    def test_identity_requires_all_boundaries(self):
        checks={k:True for k in ('trusted_mapping','tenant_isolation','independent_approval','logout_all','role_change_revokes','disabled_identity_denied','mapping_failure_closed','browser_redirect')}
        good=dict(passed=True,mode='local/mock',run_id='fresh',checks=checks,external_requests=[],page_errors=[])
        validate_stage('identity',good,'fresh')
        for key in checks:
            with self.subTest(key=key),self.assertRaises(ValueError):validate_stage('identity',good|{'checks':checks|{key:False}},'fresh')
        for change in ({'checks':{}},{'external_requests':['https://provider.invalid']},{'page_errors':['failure']}):
            with self.subTest(change=change),self.assertRaises(ValueError):validate_stage('identity',good|change,'fresh')

    def test_backup_requires_files_snapshots_and_corruption_detection(self):
        good=dict(passed=True,mode='local/mock',run_id='fresh',table_fingerprints_match=True,archive_resolution_verified=True,corruption_rejected=True,snapshot_corruption_rejected=True,source_database_modified=False,archived_events=1,snapshots_verified=1)
        validate_stage('backup',good,'fresh')
        for change in ({'archived_events':0},{'snapshots_verified':None},{'snapshots_verified':0},{'table_fingerprints_match':False},{'source_database_modified':True},{'corruption_rejected':False},{'snapshot_corruption_rejected':False}):
            with self.subTest(change=change),self.assertRaises(ValueError):validate_stage('backup',good|change,'fresh')

if __name__=='__main__':unittest.main()
