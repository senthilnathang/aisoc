import test from 'node:test';
import assert from 'node:assert/strict';
import {isSPADocument} from '../../frontend/preview-routing.mjs';

test('OIDC document navigations reach the API proxy instead of the SPA fallback',()=>{
 for(const path of ['/api','/api/v1/auth/oidc/start','/api/v1/auth/oidc/callback','/api/v1/auth/session','/health']) {
  assert.equal(isSPADocument('GET','text/html,application/xhtml+xml',path),false,path);
 }
 for(const path of ['/','/skills/example','/investigations/example'])assert.equal(isSPADocument('GET','text/html',path),true,path);
 assert.equal(isSPADocument('POST','text/html','/'),false);
 assert.equal(isSPADocument('GET','application/json','/'),false);
 assert.equal(isSPADocument('GET','text/html','/assets/main.js'),false);
});
