#!/usr/bin/env python3
"""Extract minimal coverage reference from a downloaded official ATT&CK v17.1 STIX file.
Usage: python3 scripts/framework/extract_attack_reference.py INPUT OUTPUT
No network access; preserves input SHA-256 for reproducibility.
"""
import hashlib
import json
import sys
from pathlib import Path

def extract(raw):
    objects=json.loads(raw)['objects']
    assert any(o.get('type')=='x-mitre-collection' and o.get('name')=='Enterprise ATT&CK' and o.get('x_mitre_version')=='17.1' for o in objects), 'Expected Enterprise ATT&CK v17.1 collection'
    assert hashlib.sha256(raw).hexdigest()=='0d1c347a4d584cf7e11ef46556c33b7689341443bf86299188d46c307274323b', 'Pinned input changed; review reference update explicitly'
    active=[o for o in objects if not o.get('revoked') and not o.get('x_mitre_deprecated')]
    def identity(o):
        return next((r for r in o.get('external_references',[]) if r.get('source_name')=='mitre-attack' and r.get('external_id')),None)
    tactics={o['id']:o for o in active if o['type']=='x-mitre-tactic'}
    matrix=next(o for o in active if o['type']=='x-mitre-matrix')
    ordered=[tactics[id] for id in matrix['tactic_refs']]
    tactic_ids={o['x_mitre_shortname']:identity(o)['external_id'] for o in ordered}
    techniques=[]
    for o in active:
        ref=identity(o)
        if o['type']!='attack-pattern' or not ref:continue
        memberships=[tactic_ids[p['phase_name']] for p in o.get('kill_chain_phases',[]) if p.get('kill_chain_name')=='mitre-attack' and p['phase_name'] in tactic_ids]
        if not memberships:continue
        techniques.append({'id':ref['external_id'],'name':o['name'],'tactics':memberships,'url':ref['url'],'subtechnique':o.get('x_mitre_is_subtechnique',False)})
    assert len(ordered)==14 and len(techniques)>500
    return {'version':'17.1','source':'https://github.com/mitre-attack/attack-stix-data/blob/master/enterprise-attack/enterprise-attack-17.1.json','sha256':hashlib.sha256(raw).hexdigest(),'tactics':[{'id':identity(o)['external_id'],'name':o['name']} for o in ordered],'techniques':sorted(techniques,key=lambda o:o['id'])}

if __name__=='__main__':
    result=extract(Path(sys.argv[1]).read_bytes())
    Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
    print(f"{len(result['tactics'])} tactics, {len(result['techniques'])} active technique/sub-technique entries")
