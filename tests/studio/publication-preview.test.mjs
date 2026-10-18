import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'node-html-parser';
import {openStore} from '../../scripts/studio/store.mjs';
import {openPublications} from '../../scripts/studio/publications.mjs';
import {gitPublisher} from '../../scripts/studio/publication-git.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64');
async function ready(manager,id){for(let i=0;i<1000;i++){const job=manager.get(id);if(job.state!=='building')return job;await new Promise(r=>setTimeout(r,10));}throw Error('单篇预览超过 10 秒');}
for(const warmed of [false,true])test(warmed?'服务预热后单篇预览首次与正文修改都在 3 秒内完成':'冷启动单篇预览保留 10 秒上限、正确渲染且产物私密',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-fast-preview-')),dataDir=path.join(root,'data');
 const store=openStore({dataDir});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const image=store.upload(png);
 let draft=store.create({title:'<安全的标题>',body:'## 快速预览\n\n```python title="hello.py"\nprint("hello")\n```\n\n$E=mc^2$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![pixel]('+image.url+')\n\n> [!NOTE]\n> 提示内容\n',category:'技术',tags:'测试'});
 const fixtureRepo=path.join(root,'repo');fs.mkdirSync(path.join(fixtureRepo,'src/content'),{recursive:true});
 fs.cpSync(path.join(repo,'src/content/posts'),path.join(fixtureRepo,'src/content/posts'),{recursive:true});
 fs.copyFileSync(path.join(repo,'pnpm-lock.yaml'),path.join(fixtureRepo,'pnpm-lock.yaml'));
 const git=args=>execFileSync('git',args,{cwd:fixtureRepo,stdio:'pipe'});
 git(['init']);git(['add','.']);git(['-c','user.name=Preview test','-c','user.email=test@example.invalid','commit','-m','Isolated preview fixture']);
 fs.symlinkSync(path.join(repo,'node_modules'),path.join(fixtureRepo,'node_modules'),'dir');fs.symlinkSync(path.join(repo,'.studio-preview'),path.join(fixtureRepo,'.studio-preview'),'dir');
 const driver=gitPublisher({repoDir:fixtureRepo,enabled:false});driver.build=()=>{throw Error('单篇预览禁止调用全站构建');};
 t.after(()=>driver.close());
 if(warmed){const warmStarted=performance.now();await driver.warmup();t.diagnostic('启动预热毫秒：'+Math.round(performance.now()-warmStarted));}
 const manager=openPublications({dataDir,store,config:{repoDir:fixtureRepo,enabled:false},adapter:driver});
 const timings=[];
 for(let i=0;i<3;i++){
  if(i===1)draft=store.update(draft.id,{...draft,body:draft.body+'\n正文修改后的内容\n'});
  const started=performance.now(),job=await ready(manager,manager.prepare(draft.id,{revision:draft.revision,path:'writing/fast.md',description:'摘要',published:'2026-10-13'}).id);
  assert.equal(job.state,'ready',job.error);assert.equal(job.previewOnly,true);assert.equal(job.reused,i===2);
  timings.push(Math.round(performance.now()-started));
  assert.ok(timings.at(-1)<(warmed?3000:10000));assert.ok(!fs.existsSync(path.join(dataDir,'publications',job.id,'work/dist')));
  const html=manager.preview(job.id,'posts/fast/').bytes.toString(),doc=parse(html);
  assert.ok(html.includes('expressive-code'));assert.ok(html.includes('katex'));assert.ok(doc.querySelector('table'));assert.ok(html.includes('提示内容'));
  assert.equal(doc.querySelector('h1').textContent,'<安全的标题>');assert.ok(!doc.querySelector('script'));assert.ok(!html.includes('__ASTRO_IMAGE_'));assert.ok(!html.includes('/studio-api/media/'));
  if(i>0)assert.ok(html.includes('正文修改后的内容'));
  const prefix=`/studio-api/publications/${job.id}/preview/`;
  const img=doc.querySelector('img');assert.ok(img.getAttribute('src').startsWith(prefix));assert.deepEqual(manager.preview(job.id,img.getAttribute('src').slice(prefix.length)).bytes,png);
  const css=manager.preview(job.id,'preview-assets/preview.css').bytes.toString();assert.ok(css.includes('.custom-md'));assert.ok(css.includes('--page-bg'));
  // CSS font URLs stay in the authenticated preview directory.
  const font=css.match(/url\(\.\/([^)]*\.woff2)\)/);assert.ok(font);assert.ok(manager.preview(job.id,'preview-assets/'+font[1]).bytes.length>0);
  assert.throws(()=>manager.preview(job.id,'../job.json'));assert.throws(()=>manager.preview(job.id,'../../src/content/posts/welcome.md'));
 }
 t.diagnostic('毫秒：首次 / 修改正文 / 相同内容 '+timings.join(' / '));
});
