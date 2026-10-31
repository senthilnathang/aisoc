import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import compiler from 'babel-plugin-react-compiler';
const counts = {}; const skipped = [];
for (const file of readdirSync(new URL('../src/',import.meta.url)).filter(f=>f.endsWith('.jsx'))) {
  transformSync(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'), {
    filename:fileURLToPath(new URL('../src/'+file,import.meta.url)),configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},
    plugins:[[compiler,{target:'19',logger:{logEvent(filename,event){
      counts[event.kind]=(counts[event.kind]||0)+1;
      if(event.kind==='CompileError') skipped.push({file:filename,reason:event.detail?.reason || String(event.detail)});
    }}}]],
  });
}
console.log(JSON.stringify({counts,skipped},null,2));
