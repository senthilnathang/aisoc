"""Synthetic phishing evidence cannot become an automatic verdict or action."""
import time
import unittest
import grpc
from aisoc.worker.v1 import investigation_pb2 as pb, investigation_pb2_grpc as rpc
from service import Runtime, Settings
from test_service import free_port
from investigation import PHISHING

class PhishingTests(unittest.TestCase):
    def test_rpc_phishing_and_contract_negatives(self):
        runtime=Runtime(Settings(f'127.0.0.1:{free_port()}',f'127.0.0.1:{free_port()}','p'*32))
        runtime.start()
        try:
            with grpc.insecure_channel(runtime.settings.rpc_address) as channel:
                stub=rpc.InvestigatorStub(channel)
                auth=(('authorization','Bearer '+'p'*32),)
                task=pb.InvestigationTask(tenant_id='tenant',incident_id='case',task_id='task',attempt_id='attempt',schema_version='1',mode='mock-v1',deadline_unix_ms=int(time.time()*1000)+10000,max_output_bytes=8192,evidence=[pb.EvidenceItem(reference=f'mail:{i}',content_hash='a'*64,event_time='2026-10-29T10:00:00Z',event_type=kind) for i,kind in enumerate(PHISHING)])
                result=stub.Investigate(task,timeout=2,metadata=auth)
                self.assertEqual(result.verdict,'INCONCLUSIVE');self.assertTrue(result.requires_human_review)
                self.assertEqual([h.kind for h in result.hypotheses],['credential_phishing','authorized_simulation'])
                self.assertEqual(list(result.hypotheses[1].supporting_refs),['mail:0'])
                self.assertEqual(list(result.hypotheses[1].neutral_refs),['mail:1','mail:2','mail:3'])
                self.assertEqual(set(result.missing_evidence),{'email_headers','url_reputation','authorized_simulation_check','iam_session_context','independent_verification'})
                for mutation in ('model','mixed','missing','duplicate'):
                    bad=pb.InvestigationTask();bad.CopyFrom(task)
                    if mutation=='model':bad.mode='model-v1'
                    elif mutation=='mixed':bad.evidence[0].event_type='authentication.failed'
                    elif mutation=='missing':del bad.evidence[-1]
                    else:bad.evidence[-1].event_type=bad.evidence[0].event_type
                    with self.assertRaises(grpc.RpcError) as err:stub.Investigate(bad,timeout=2,metadata=auth)
                    self.assertEqual(err.exception.code(),grpc.StatusCode.INVALID_ARGUMENT)
        finally:runtime.close()
