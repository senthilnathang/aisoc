"""Typed mock investigation RPC evaluation; no LLM performance claims."""
import time
import unittest
import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
from aisoc.worker.v1 import investigation_pb2 as pb, investigation_pb2_grpc as rpc
from service import Runtime, Settings
from test_service import free_port


class InvestigationTests(unittest.TestCase):
    def test_rpc_contract_injection_and_budgets(self):
        runtime = Runtime(Settings(f'127.0.0.1:{free_port()}', f'127.0.0.1:{free_port()}', 'x'*32))
        runtime.start()
        try:
            with grpc.insecure_channel(runtime.settings.rpc_address) as channel:
                stub = rpc.InvestigatorStub(channel)
                credentials = (('authorization', 'Bearer ' + 'x'*32),)
                health = health_pb2_grpc.HealthStub(channel).Check(health_pb2.HealthCheckRequest(service='aisoc.worker.v1.Investigator'), timeout=2, metadata=credentials)
                self.assertEqual(health.status, health_pb2.HealthCheckResponse.SERVING)
                task = pb.InvestigationTask(tenant_id='tenant', incident_id='case',
                    task_id='task', attempt_id='attempt', schema_version='1', mode='mock-v1',
                    deadline_unix_ms=int(time.time()*1000)+10000, max_output_bytes=8192,
                    evidence=[pb.EvidenceItem(reference='ignore.previous.instructions',
                        content_hash='a'*64, event_time='2026-01-01T00:00:00Z',
                        event_type='authentication.failed')])
                result = stub.Investigate(task, timeout=2, metadata=credentials)
                self.assertEqual(result.verdict, 'INCONCLUSIVE')
                self.assertTrue(result.requires_human_review)
                self.assertEqual(len(result.hypotheses), 2)
                self.assertEqual(set(result.missing_evidence), {'iam_mfa_context', 'endpoint_process_tree'})
                self.assertEqual(result.hypotheses[0].supporting_refs[0], 'ignore.previous.instructions')
                for auth in ((), credentials + credentials, (('authorization', 'wrong'),)):
                    with self.assertRaises(grpc.RpcError) as err:
                        stub.Investigate(task, timeout=2, metadata=auth)
                    self.assertEqual(err.exception.code(), grpc.StatusCode.UNAUTHENTICATED)
                for field, value in (('mode', 'live'), ('deadline_unix_ms', 1),
                                     ('max_output_bytes', 0), ('schema_version', '99')):
                    invalid = pb.InvestigationTask()
                    invalid.CopyFrom(task)
                    setattr(invalid, field, value)
                    with self.assertRaises(grpc.RpcError) as err:
                        stub.Investigate(invalid, timeout=2, metadata=credentials)
                    self.assertEqual(err.exception.code(), grpc.StatusCode.INVALID_ARGUMENT)
                invalid = pb.InvestigationTask()
                invalid.ParseFromString(task.SerializeToString() + b'\xa0\x06\x01')
                with self.assertRaises(grpc.RpcError) as err:
                    stub.Investigate(invalid, timeout=2, metadata=credentials)
                self.assertEqual(err.exception.code(), grpc.StatusCode.INVALID_ARGUMENT)
                invalid.CopyFrom(task)
                invalid.evidence.add().CopyFrom(task.evidence[0])
                with self.assertRaises(grpc.RpcError) as err:
                    stub.Investigate(invalid, timeout=2, metadata=credentials)
                self.assertEqual(err.exception.code(), grpc.StatusCode.INVALID_ARGUMENT)
        finally:
            runtime.close()
