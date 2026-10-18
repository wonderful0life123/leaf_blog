// Isolated, full-repository preview benchmark. Never contacts GitHub or writes user data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {openStore} from '../../../scripts/studio/store.mjs';
import {openPublications} from '../../../scripts/studio/publications.mjs';
import {gitPublisher} from '../../../scripts/studio/publication-git.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-preview-bench-'));
const fixture=path.join(root,'repo'),dataDir=path.join(root,'data');
const git=(args,cwd=repo)=>execFileSync('git',args,{cwd,stdio:'pipe'});
let store,driver;
try {
 git(['clone','--quiet','--shared',repo,fixture]);
 for(const name of ['node_modules','.studio-preview'])fs.symlinkSync(path.join(repo,name),path.join(fixture,name),'dir');
 store=openStore({dataDir});
 const image=store.upload(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64'));
 let draft=store.create({title:'预览性能验证',body:'## 标题\n\n```python\nprint("hello")\n```\n\n$E=mc^2$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![pixel]('+image.url+')\n',category:'技术',tags:'测试'});
 driver=gitPublisher({repoDir:fixture,enabled:false,mode:process.argv.includes('--runtime')?'runtime':'static'});
 const start=performance.now();
 if(process.argv.includes('--warm'))await driver.warmup?.();
 const warmupMs=Math.round(performance.now()-start);
 const manager=openPublications({dataDir,store,config:{repoDir:fixture,enabled:false,mode:process.argv.includes('--runtime')?'runtime':'static'},adapter:driver});
 const cases=[];
 for(const name of ['first','body','reuse','summary']) {
  if(name==='body')draft=store.update(draft.id,{...draft,body:draft.body+'\n修改后的正文。\n'});
  const started=performance.now();
  const pending=manager.prepare(draft.id,{revision:draft.revision,filename:'preview-bench.md',description:name==='summary'?'修改摘要':'摘要',published:'2026-10-18'});
  let job;
  do {await new Promise(r=>setTimeout(r,10));job=manager.get(pending.id);}while(job.state==='building'&&performance.now()-started<40000);
  assert.equal(job.state,'ready',job.error);
  assert.equal(job.reused===true,name==='reuse');
  const html=manager.preview(job.id,job.url.replace(/^\//,'')).bytes.toString();
  assert.ok(html.includes('expressive-code')&&html.includes('katex')&&html.includes('<table'));
  assert.ok(html.includes('noindex,nofollow')&&!html.includes('/studio-api/media/'));
  assert.ok(!fs.existsSync(path.join(dataDir,'publications',job.id,'work/dist')));
  cases.push({name,ms:Math.round(performance.now()-started),timings:job.timings});
 }
 const output={warm:process.argv.includes('--warm'),warmupMs,cases,firstMs:cases[0].ms,changedMs:Math.max(cases[1].ms,cases[3].ms),reuseMs:cases[2].ms,correct:true};
 console.log(JSON.stringify(output));
} finally {await driver?.close?.();store?.close();fs.rmSync(root,{recursive:true,force:true});}
