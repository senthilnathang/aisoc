"""OIDC browser/API proof against disposable loopback services and test mappings."""
import json
import subprocess


def check_identity(run_id,api,env,temp,log,port,wait_port,root,out):
    ports=set()
    while len(ports)<3:ports.add(port())
    api_port,web_port,idp_port=sorted(ports)
    origin=f'http://127.0.0.1:{web_port}';issuer=f'http://127.0.0.1:{idp_port}'
    mappings=[dict(subject=subject,operator_id='fixture-'+actor,tenant_id=tenant,roles=roles,generation=1,disabled=False)
        for subject,actor,tenant,roles in [('alice','a','auth-a',['proposer']),('reviewer','c','auth-a',['approver']),('executor','d','auth-a',['executor']),('foreign','b','auth-b',['approver'])]]
    mapping_file=temp/'oidc-mappings.json';mapping_file.write_text(json.dumps(mappings));mapping_file.chmod(0o600)
    config=dict(issuer=issuer,client_id='aisoc-local',redirect_url=origin+'/api/v1/auth/oidc/callback',mappings_file=str(mapping_file),local_mock=True)
    config_file=temp/'oidc.json';config_file.write_text(json.dumps(config));config_file.chmod(0o600)
    skills=[api('/skills',dict(name='SSO release '+run_id+' '+str(i),content_markdown='Synthetic instructions for independent SSO approval.'),expected=201) for i in range(2)]
    manifest=dict(run_id=run_id,mode='local/mock',origin=origin,issuer=issuer,skills=skills)
    path=out/'fixtures/identity.json';path.write_text(json.dumps(manifest,indent=2)+'\n')
    child_env={**env,'AISOC_GO_ADDR':f'127.0.0.1:{api_port}','AISOC_GO_AUTH_MODE':'oidc','AISOC_GO_OIDC_FILE':str(config_file),
        'AISOC_GO_APP_ORIGINS':origin,'AISOC_API_PROXY_TARGET':f'http://127.0.0.1:{api_port}',
        'AISOC_MOCK_OIDC_ADDR':f'127.0.0.1:{idp_port}','AISOC_MOCK_OIDC_REDIRECT':config['redirect_url'],'AISOC_MOCK_OIDC_ENABLE':'true'}
    children=[]
    try:
        subprocess.run(['go','build','-o',str(temp/'oidc-mock'),'./cmd/oidc-mock'],cwd=root/'backend-go',env=env,stdout=log,stderr=log,check=True,timeout=120)
        for args,cwd,listen in [([temp/'oidc-mock'],root,idp_port),([root/'backend-go/bin/api'],root,api_port),
                (['node',root/'frontend/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',str(web_port),'--strictPort'],root/'frontend',web_port)]:
            children.append(subprocess.Popen(list(map(str,args)),cwd=cwd,env=child_env,stdout=log,stderr=log));wait_port(listen)
        browser_env={k:v for k,v in env.items() if k in ('PATH','HOME','TMPDIR','LANG','AISOC_RELEASE_CHROMIUM')}
        browser_env['AISOC_TEST_IDENTITY_MAPPINGS']=str(mapping_file)
        subprocess.run(['node',str(root/'scripts/release/identity.mjs'),str(path)],cwd=root,env=browser_env,stdout=log,stderr=log,check=True,timeout=180)
    finally:
        for child in reversed(children):
            child.terminate()
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
