"""Deterministic mock reasoning only. No provider, tool execution or model calls."""
import hmac
import re
import time
from datetime import datetime, timezone
import grpc
from aisoc.worker.v1 import investigation_pb2 as pb, investigation_pb2_grpc as rpc

IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\Z')
PHISHING = ('email.delivered','email.authentication_failed','email.link_clicked','email.credential_submitted')
HASH = re.compile(r'[0-9a-f]{64}\Z')


def known(message):
    copy = type(message)()
    copy.CopyFrom(message)
    copy.DiscardUnknownFields()
    return copy.SerializeToString() == message.SerializeToString()


def valid(task):
    now = time.time()
    if (task.ByteSize() > 16384 or not known(task) or task.schema_version != '1'
        or task.mode not in ('mock-v1', 'model-v1') or not 512 <= task.max_output_bytes <= 16384
        or not 1 <= len(task.evidence) <= 16
        or not now * 1000 < task.deadline_unix_ms <= (now + 30) * 1000):
        return False
    if not all(IDENTIFIER.fullmatch(v) for v in
               (task.tenant_id, task.incident_id, task.task_id, task.attempt_id)):
        return False
    phishing=any(e.event_type in PHISHING for e in task.evidence)
    if phishing and (task.mode != 'mock-v1' or len(task.evidence)!=4 or {e.event_type for e in task.evidence}!=set(PHISHING) or any(e.HasField('context') for e in task.evidence)):
        return False
    refs = set()
    for item in task.evidence:
        if (not IDENTIFIER.fullmatch(item.reference) or item.reference in refs
            or not HASH.fullmatch(item.content_hash)
            or (item.HasField('context') and (task.mode != 'mock-v1' or not valid_context(item)))
            or (not item.HasField('context') and item.event_type not in ('authentication.failed', 'authentication.succeeded') + PHISHING)):
            return False
        try:
            when = datetime.fromisoformat(item.event_time.replace('Z', '+00:00'))
            if when.tzinfo is None or when.year < 1970 or when > datetime.now(timezone.utc):
                return False
        except ValueError:
            return False
        refs.add(item.reference)
    return True


def valid_context(item):
    c = item.context
    if not known(c) or c.ByteSize() > 4096 or c.state not in ('available', 'stale'):
        return False
    if not all(IDENTIFIER.fullmatch(v) for v in (c.connector_id,c.principal_ref,c.asset_ref)):
        return False
    try:
        observed=datetime.fromisoformat(item.event_time.replace('Z','+00:00'))
        retrieved=datetime.fromisoformat(c.retrieved_at.replace('Z','+00:00'))
        if retrieved.tzinfo is None or observed.tzinfo is None or retrieved<observed or retrieved>datetime.now(timezone.utc):
            return False
    except ValueError:
        return False
    if item.event_type=='iam.mfa':
        if c.source!='mock-iam' or c.outcome not in ('passed','denied','unknown') or c.processes:
            return False
    elif item.event_type=='edr.endpoint':
        if c.source!='mock-edr' or c.outcome not in ('clean','suspicious','unknown') or len(c.processes)>4:
            return False
    else:
        return False
    pids=set()
    for p in c.processes:
        if not known(p) or not p.pid or p.pid==p.parent_pid or p.pid in pids or not IDENTIFIER.fullmatch(p.image) or not HASH.fullmatch(p.sha256):
            return False
        pids.add(p.pid)
    return True


def context_gaps(evidence):
    if any(e.event_type in PHISHING for e in evidence):
        return ['email_headers','url_reputation','authorized_simulation_check','iam_session_context','independent_verification']
    outcomes={'iam.mfa':set(),'edr.endpoint':set()}
    context=[e for e in evidence if e.HasField('context')]
    for e in context:
        c=e.context
        if c.state=='available' and c.outcome!='unknown' and (e.event_type!='edr.endpoint' or c.processes):
            outcomes[e.event_type].add(c.outcome)
    missing=[]
    if not outcomes['iam.mfa']: missing.append('iam_mfa_context')
    if not outcomes['edr.endpoint']: missing.append('endpoint_process_tree')
    if any(len(v)>1 for v in outcomes.values()): missing.append('conflicting_context')
    if context: missing.append('independent_verification')
    return missing


def mock_hypotheses(evidence):
    if any(e.event_type in PHISHING for e in evidence):
        return [pb.Hypothesis(kind='credential_phishing',supporting_refs=[e.reference for e in evidence]),
                pb.Hypothesis(kind='authorized_simulation',supporting_refs=[e.reference for e in evidence if e.event_type=='email.delivered'],neutral_refs=[e.reference for e in evidence if e.event_type!='email.delivered'])]
    result=[]
    for kind in ('credential_compromise','legitimate_user_or_automation'):
        supporting=[]; counter=[]; neutral=[]
        for e in evidence:
            c=e.context if e.HasField('context') else None
            if c and (c.state!='available' or c.outcome=='unknown' or (e.event_type=='edr.endpoint' and not c.processes)):
                neutral.append(e.reference)
                continue
            # Only available, interpretable observations influence either hypothesis.
            positive=c and c.state=='available' and c.outcome in ('passed','clean')
            negative=c and c.state=='available' and c.outcome in ('denied','suspicious')
            against=(kind=='credential_compromise' and positive) or (kind!='credential_compromise' and negative)
            (counter if against else supporting).append(e.reference)
        result.append(pb.Hypothesis(kind=kind,supporting_refs=supporting,counterevidence_refs=counter,neutral_refs=neutral))
    return result


class Investigator(rpc.InvestigatorServicer):
    def __init__(self, token, model=None):
        self.credential = ('Bearer ' + token).encode()
        self.model = model

    def Investigate(self, task, context):
        credentials = [v for k, v in context.invocation_metadata() if k == 'authorization']
        if len(credentials) != 1 or not hmac.compare_digest(credentials[0].encode(), self.credential):
            context.abort(grpc.StatusCode.UNAUTHENTICATED, 'invalid worker credential')
        if not valid(task):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'invalid investigation contract')
        if not context.is_active():
            context.abort(grpc.StatusCode.CANCELLED, 'request cancelled')
        if task.mode == 'model-v1':
            if self.model is None:
                context.abort(grpc.StatusCode.FAILED_PRECONDITION, 'inference adapter is not configured')
            try:
                value = self.model.investigate(task)
                result = pb.InvestigationResult(tenant_id=task.tenant_id, incident_id=task.incident_id,
                    task_id=task.task_id, attempt_id=task.attempt_id, schema_version='1',
                    verdict=value['verdict'], requires_human_review=True,
                    model_version='json-model:' + self.model.model,
                    missing_evidence=value['missing_evidence'],
                    hypotheses=[pb.Hypothesis(**item) for item in value['hypotheses']])
            except (ValueError, TypeError, KeyError):
                context.abort(grpc.StatusCode.FAILED_PRECONDITION, 'inference failed contract checks')
            if result.ByteSize() > task.max_output_bytes:
                context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, 'result exceeds budget')
            if not context.is_active():
                context.abort(grpc.StatusCode.CANCELLED, 'request cancelled')
            return result
        # Observations can be consistent with either explanation; neither is a verdict.
        result = pb.InvestigationResult(
            tenant_id=task.tenant_id, incident_id=task.incident_id,
            task_id=task.task_id, attempt_id=task.attempt_id, schema_version='1',
            verdict='INCONCLUSIVE', requires_human_review=True,
            model_version='deterministic-mock-v1',
            missing_evidence=context_gaps(task.evidence),
            hypotheses=mock_hypotheses(task.evidence))
        if result.ByteSize() > task.max_output_bytes:
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, 'result exceeds budget')
        return result
