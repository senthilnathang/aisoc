"""Bounded operational alert transport; caller supplies no case/evidence payloads."""
import hashlib
import json
from pathlib import Path
import ssl
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('Alert redirects forbidden')


def send(config_path, component, reason):
    if component not in ('go-api','stream-worker','backup') or reason not in ('unavailable','threshold_exceeded','verification_failed'):
        raise ValueError('Unknown operational alert')
    config=json.loads(Path(config_path).read_text())
    if set(config)-{'endpoint','credential_file','ca_file'}:
        raise ValueError('Unknown alert configuration')
    url=urllib.parse.urlsplit(config['endpoint'])
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Alerts require an HTTPS endpoint without embedded credentials')
    context=ssl.create_default_context(cafile=config.get('ca_file'))
    payload=json.dumps({'schema_version':'1','component':component,'reason':reason},sort_keys=True).encode()
    headers={'Content-Type':'application/json','Idempotency-Key':hashlib.sha256(payload).hexdigest()}
    if config.get('credential_file'):
        path=Path(config['credential_file'])
        if path.stat().st_mode&0o077:raise ValueError('Private alert credential required')
        token=path.read_text().strip()
        if not 8<=len(token)<=4096 or '\r' in token or '\n' in token:raise ValueError('Invalid credential')
        headers['Authorization']='Bearer '+token
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=context),NoRedirect())
    request=urllib.request.Request(config['endpoint'],data=payload,headers=headers)
    with opener.open(request,timeout=3) as response:
        if response.status not in (200,201,202,204):raise ValueError('Alert delivery not acknowledged')
        response.read(1024)
