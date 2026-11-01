"""Fresh local/mock inputs for browser-owned workflow mutations."""
from datetime import datetime, timedelta, timezone


def create(api, run_id, name):
    result = {}
    for kind in ('skill', 'memory'):
        entity = 'release-' + kind + '-' + run_id
        source = api('/investigations', dict(title=name+' '+kind+' source', source='local-json:release',
            severity='medium', status='resolved', determination='suspicious', primary_entity=entity), expected=201)
        artifact = api('/investigations/'+source['id']+'/artifacts',
            dict(type='entity', value=entity, label='Synthetic reviewed identity'), expected=201)
        # Fetch after artifact creation so the source revision is exact.
        source = api('/investigations/'+source['id'])
        body = dict(expected_updated_at=source['updated_at'], evidence_ids=[artifact['id']], confirm=True,
            rationale='Review synthetic source evidence for independent browser approval.',
            create_skill=kind=='skill', name=name+' lifecycle skill', guidance='Original reviewed release guidance.',
            create_memory=kind=='memory', memory_kind='user', context='Release context: verify current evidence independently.',
            valid_until=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat(timespec='seconds'))
        for field in (('memory_kind','context','valid_until') if kind=='skill' else ('name','guidance')):
            body.pop(field)
        receipt = api('/investigations/'+source['id']+'/learning', body)
        result[kind] = dict(source=source, receipt=receipt, entity=entity, input=body)
    result['hunt'] = api('/hunts', dict(name=name+' Memory hunt',query=result['memory']['entity']), expected=201)
    rule = api('/detection-rules', dict(name=name+' feedback rule',severity='high',enabled=True,routing='Escalate',query='local baseline'), expected=201)
    alerts=[]
    for suffix in ('scanner','host','unreviewed'):
        item=api('/alerts',dict(source='release-'+suffix,external_id=run_id+'-'+suffix,rule_id=rule['id'],title=name+' '+suffix,
            summary='Synthetic browser feedback evidence',severity='high',primary_entity=suffix),expected=201)
        alerts.append(item['alert'])
    # Disabled/unbound is the required starting state for local application.
    rule=api('/detection-rules/'+rule['id'])
    rule=api('/detection-rules/'+rule['id'],dict(enabled=False,expected_version=rule['version']),method='PATCH')
    result['feedback']=dict(rule=rule,alerts=alerts)
    return result
