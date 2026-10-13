// Explicit end-to-end check: real Astro builds + a local bare remote, never GitHub.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openStore} from '../../scripts/studio/store.mjs';
import {openPublications} from '../../scripts/studio/publications.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-publication-build-'));
const repo=path.join(root,'repo'),remote=path.join(root,'remote.git');
const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let store,passed=false;
try {
  git(['clone','--shared','--no-hardlinks',source,repo]);git(['init','--bare',remote]);git(['config','receive.shallowUpdate','true'],remote);git(['remote','set-url','origin',remote],repo);git(['checkout','-b','feat/publish-test'],repo);git(['push','origin','feat/publish-test'],repo);
  fs.symlinkSync(path.join(source,'node_modules'),path.join(repo,'node_modules'),'dir');fs.symlinkSync(path.join(source,'.studio-preview'),path.join(repo,'.studio-preview'),'dir');fs.appendFileSync(path.join(repo,'.git/info/exclude'),'\nnode_modules\n.studio-preview\n');
  const releases=path.join(root,'releases'),live=path.join(root,'current');fs.mkdirSync(path.join(releases,'before'),{recursive:true});fs.writeFileSync(path.join(releases,'before/index.html'),'old');fs.symlinkSync(path.join(releases,'before'),live);
  const sourceRoots={blog:path.join(repo,'src/content/posts')};
  store=openStore({dataDir:path.join(root,'data'),sourceRoots});
  const image=store.upload(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64'));
  let draft=store.create({title:'Publish smoke',body:'## Build verification\n\n```python\nprint("wonder")\n```\n\n$E=mc^2$\n\n![pixel]('+image.url+')\n',category:'Tests',tags:'test'});
  const manager=openPublications({dataDir:path.join(root,'data'),store,sourceRoots,config:{repoDir:repo,enabled:true,branch:'feat/publish-test',codeRevision:git(['rev-parse','HEAD'],repo),releaseDir:releases,liveLink:live}});
  async function wait(id){
    let phase='';
    for(let i=0;i<1200;i++){
      const job=manager.get(id),next=job.phase?.stage||job.state;
      if(next!==phase){console.log(JSON.stringify({task:id,phase:next,elapsedMs:job.elapsedMs}));phase=next;}
      if(!['building','publishing'].includes(job.state)){console.log(JSON.stringify({task:id,timings:job.timings,reused:job.reused}));return job;}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error(`Build timed out during ${phase}; inspect this task's private job.json and build.log.`);
  }
  const commits=[];
  for(let round=0;round<2;round++){
    const input={revision:draft.revision,path:'writing/publish-smoke.md',description:'isolated',published:'2026-10-12'};
    let job=manager.prepare(draft.id,input);
    let ready=await wait(job.id);assert.equal(ready.state,'ready',JSON.stringify(ready));assert.equal(ready.imageCount,1);assert.equal(ready.previewOnly,true);assert.ok(!fs.existsSync(path.join(root,'data/publications',job.id,'work/dist')),'preview must not build deployable output');
    if(round===0){job=manager.prepare(draft.id,input);ready=await wait(job.id);assert.equal(ready.state,'ready',JSON.stringify(ready));assert.equal(ready.reused,true);}
    const preview=manager.preview(job.id,'posts/writing/publish-smoke/').bytes.toString();assert.ok(preview.includes('Build verification'));assert.ok(preview.includes('katex'));assert.ok(!preview.includes('<script'));
    manager.confirm(job.id,{revision:draft.revision,confirm:true});const done=await wait(job.id);assert.equal(done.state,'published',JSON.stringify(done));commits.push(done.commit);
    const page=fs.readFileSync(path.join(live,'posts/writing/publish-smoke/index.html'),'utf8');assert.ok(page.includes('Publish smoke'));assert.ok(!page.includes('/studio-api/media/'));
    const changed=git(['diff-tree','--no-commit-id','--name-only','-r',done.commit],repo).split('\n');assert.ok(changed.every(name=>name.startsWith('src/content/posts/writing/')));assert.equal(manager.decorate([draft])[0].status,'published');assert.ok(fs.readFileSync(path.join(sourceRoots.blog,'writing/publish-smoke.md'),'utf8').includes('Publish smoke'));
    if(round===0)draft=store.update(draft.id,{...draft,body:draft.body+'\nSecond revision.\n'});
  }
  assert.notEqual(...commits);assert.equal(git(['status','--porcelain'],repo),'');passed=true;console.log('PASS: real Markdown/code/math/image preview, two Git commits to local bare remote, atomic deployment, draft status, unchanged source checkout.');
} finally {store?.close();if(passed)fs.rmSync(root,{recursive:true,force:true});else console.error('Isolated diagnostic files retained at: '+root);}
