"""Deterministic mock reasoning only. No provider, tool execution or model calls."""
import hmac
import re
import time
from datetime import datetime, timezone
import grpc
from aisoc.worker.v1 import investigation_pb2 as pb, investigation_pb2_grpc as rpc

IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\Z')
HASH = re.compile(r'[0-9a-f]{64}\Z')


def known(message):
    copy = type(message)()
    copy.CopyFrom(message)
    copy.DiscardUnknownFields()
    return copy.SerializeToString() == message.SerializeToString()


def valid(task):
    now = time.time()
    if (task.ByteSize() > 16384 or not known(task) or task.schema_version != '1'
        or task.mode != 'mock-v1' or not 512 <= task.max_output_bytes <= 16384
        or not 1 <= len(task.evidence) <= 16
        or not now * 1000 < task.deadline_unix_ms <= (now + 30) * 1000):
        return False
    if not all(IDENTIFIER.fullmatch(v) for v in
               (task.tenant_id, task.incident_id, task.task_id, task.attempt_id)):
        return False
    refs = set()
    for item in task.evidence:
        if (not IDENTIFIER.fullmatch(item.reference) or item.reference in refs
            or not HASH.fullmatch(item.content_hash)
            or item.event_type not in ('authentication.failed', 'authentication.succeeded')):
            return False
        try:
            when = datetime.fromisoformat(item.event_time.replace('Z', '+00:00'))
            if when.tzinfo is None or when.year < 1970 or when > datetime.now(timezone.utc):
                return False
        except ValueError:
            return False
        refs.add(item.reference)
    return True


class Investigator(rpc.InvestigatorServicer):
    def __init__(self, token):
        self.credential = ('Bearer ' + token).encode()

    def Investigate(self, task, context):
        credentials = [v for k, v in context.invocation_metadata() if k == 'authorization']
        if len(credentials) != 1 or not hmac.compare_digest(credentials[0].encode(), self.credential):
            context.abort(grpc.StatusCode.UNAUTHENTICATED, 'invalid worker credential')
        if not valid(task):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'invalid investigation contract')
        if not context.is_active():
            context.abort(grpc.StatusCode.CANCELLED, 'request cancelled')
        # Observations can be consistent with either explanation; neither is a verdict.
        refs = [item.reference for item in task.evidence]
        result = pb.InvestigationResult(
            tenant_id=task.tenant_id, incident_id=task.incident_id,
            task_id=task.task_id, attempt_id=task.attempt_id, schema_version='1',
            verdict='INCONCLUSIVE', requires_human_review=True,
            model_version='deterministic-mock-v1',
            missing_evidence=['iam_mfa_context', 'endpoint_process_tree'],
            hypotheses=[pb.Hypothesis(kind=kind, supporting_refs=refs) for kind in
                        ('credential_compromise', 'legitimate_user_or_automation')])
        if result.ByteSize() > task.max_output_bytes:
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, 'result exceeds budget')
        return result
