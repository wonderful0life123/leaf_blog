import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import matter from 'gray-matter';
import {openStore} from '../../scripts/studio/store.mjs';
import {publicationContent,digest} from '../../scripts/studio/publication-content.mjs';
import {openPublications,publicationConfig} from '../../scripts/studio/publications.mjs';
import {gitPublisher} from '../../scripts/studio/publication-git.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64');
const input={path:'writing/test.md',description:'摘要',published:'2026-10-11'};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-publish-'));const store=openStore({dataDir:path.join(root,'data')});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});const draft=store.create({title:'测试',body:'正文',category:'技术/CUDA',tags:'GPU, CUDA'});return {root,store,draft};}
async function settled(manager,id){for(let i=0;i<500;i++){const job=manager.get(id);if(!['building','publishing'].includes(job.state))return job;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('job timeout');}
function mockDriver(root){let head='base',pushes=0,deploys=0,failDeploy=false;return {
 async head(){return head;},async prepare(dir){const work=path.join(dir,'work');fs.mkdirSync(path.join(work,'src/content/posts'),{recursive:true});return work;},
 async build(work,url){const dir=path.join(work,'dist',url);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'<html><script>SECRET_SCRIPT</script><a href="/studio/">link</a><img src="/_astro/image.png" onerror="alert(1)"><p>article</p></html>');fs.mkdirSync(path.join(work,'dist/_astro'));fs.writeFileSync(path.join(work,'dist/_astro/image.png'),png);},
 async preview(work,url,step){await this.build(work,url,step);fs.renameSync(path.join(work,'dist'),path.join(work,'preview'));},
 async commit(){return 'new-commit';},async push(){head='new-commit';pushes++;},async contains(commit){return head===commit;},async deploy(){if(failDeploy)throw Error('simulated deploy failure');deploys++;return {target:'test'};},
 counts(){return {pushes,deploys};},changeHead(){head='other';},failDeploy(value){failDeploy=value;}
};}
test('发布内容保留元信息与普通引用链接，只转换真实图片，不改代码示例',t=>{
 const {store,draft}=fixture(t),image=store.upload(png);
 draft.body='`![图]('+image.url+')`\n\n![图]('+image.url+')\n\n![引用][pic]\n\n[普通链接][ref]\n\n[pic]: '+image.url+'\n[ref]: https://example.com\n\n```md\n![图]('+image.url+')\n```\n';
 const previous='---\ntitle: 旧标题\npublished: 2020-01-01\npinned: true\ncomment: false\ncustom: keep\n---\n旧正文';
 const result=publicationContent(draft,input,{previous,expectedHash:digest(previous),media:id=>store.media(id)}),parsed=matter(result.text);
 assert.equal(parsed.data.pinned,true);assert.equal(parsed.data.comment,false);assert.equal(parsed.data.custom,'keep');assert.equal(parsed.data.draft,false);assert.deepEqual(parsed.data.tags,['GPU','CUDA']);
 assert.ok(publicationContent({...draft,body:'```js\nimport React from \"react\";\nexport default React;\n```'},input,{media:id=>store.media(id)}).text.includes('import React'));
 assert.equal(result.images.length,1);assert.match(parsed.content,/assets\/test\/[a-f\d]{64}\.png/);assert.ok(parsed.content.includes('`![图]('+image.url+')`'));assert.ok(parsed.content.includes('[ref]: https://example.com'));assert.ok(parsed.content.includes('```md\n![图]('+image.url+')'));
});
test('发布拒绝路径穿越、覆盖冲突、空文章、原始 HTML、无效日期与丢失图片',t=>{
 const {draft,store}=fixture(t);const convert=(d=draft,i=input,opts={})=>publicationContent(d,i,{media:id=>store.media(id),...opts});
 for(const target of ['../bad.md','a/../../bad.md','/tmp/x.md','a?.md','a.mdx'])assert.throws(()=>convert(draft,{...input,path:target}),/路径/);
 assert.throws(()=>convert(draft,input,{previous:'existing'}),/占用/);assert.throws(()=>convert({...draft,title:' '}),/标题/);
 assert.throws(()=>convert({...draft,body:'<img src="file:///etc/passwd">'}),/HTML/);assert.throws(()=>convert(draft,{...input,published:'2026-02-31'}),/日期/);assert.throws(()=>convert({...draft,body:'![](missing.png)'}),/图片/);
});
test('构建预览保持私密，确认才推送；重复确认不重复发布，预览去脚本并隔离资源',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root),manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:true},adapter:driver});
 const started=manager.prepare(draft.id,{...input,revision:1});assert.equal(started.state,'building');assert.deepEqual(driver.counts(),{pushes:0,deploys:0});
 const ready=await settled(manager,started.id);assert.equal(ready.state,'ready');assert.throws(()=>manager.preview(ready.id,'../../job.json'),/不存在/);
 const html=manager.preview(ready.id,'posts/test/').bytes.toString();assert.ok(!html.includes('SECRET_SCRIPT'));assert.ok(!html.includes('onerror'));assert.ok(html.includes(`/publications/${ready.id}/preview/_astro/image.png`));
 assert.throws(()=>manager.confirm(ready.id,{revision:1}),/确认/);
 manager.confirm(ready.id,{revision:1,confirm:true});assert.equal((await settled(manager,ready.id)).state,'published');manager.confirm(ready.id,{revision:1,confirm:true});assert.deepEqual(driver.counts(),{pushes:1,deploys:1});
});
test('预览后编辑或删除草稿必须重新检查，远端更新不会推送',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root),manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:true},adapter:driver});
 let job=manager.prepare(draft.id,{...input,revision:1});await settled(manager,job.id);
 store.update(draft.id,{...draft,body:'新版',revision:1});assert.throws(()=>manager.confirm(job.id,{revision:1,confirm:true}),/发生变化/);
 job=manager.prepare(draft.id,{...input,revision:2});await settled(manager,job.id);driver.changeHead();manager.confirm(job.id,{revision:2,confirm:true});assert.equal((await settled(manager,job.id)).state,'failed');assert.deepEqual(driver.counts(),{pushes:0,deploys:0});
});
test('提交成功但上线失败可以重试，服务重启后不重复提交',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root),args={dataDir:path.join(root,'data'),store,config:{enabled:true},adapter:driver};let manager=openPublications(args);
 const job=manager.prepare(draft.id,{...input,revision:1});await settled(manager,job.id);driver.failDeploy(true);manager.confirm(job.id,{revision:1,confirm:true});assert.equal((await settled(manager,job.id)).state,'retry');assert.deepEqual(driver.counts(),{pushes:1,deploys:0});
 manager=openPublications(args);driver.failDeploy(false);manager.confirm(job.id,{revision:1,confirm:true});assert.equal((await settled(manager,job.id)).state,'published');assert.deepEqual(driver.counts(),{pushes:1,deploys:1});
});
test('本机预览模式拒绝发布，开启发布必须指定独立分支和切换路径',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root),manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:false},adapter:driver});
 const job=manager.prepare(draft.id,{...input,revision:1});await settled(manager,job.id);assert.throws(()=>manager.confirm(job.id,{revision:1,confirm:true}),/私密预览/);
 assert.throws(()=>publicationConfig({WONDER_PUBLISH_REPO_DIR:root,WONDER_PUBLISH_ENABLED:'1',WONDER_PUBLISH_BRANCH:'master'}),/不允许/);
});
test('相同文章复用完整构建，但仍核对源版本；草稿或远端变化必须重建',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root);let builds=0;
 const build=driver.build;driver.build=async(...args)=>{builds++;return build(...args);};
 const manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:true},adapter:driver});
 const request={...input,revision:1};
 const first=manager.prepare(draft.id,request);await settled(manager,first.id);
 const second=manager.prepare(draft.id,request),reused=await settled(manager,second.id);
 assert.equal(reused.state,'ready');assert.equal(builds,1);assert.equal(reused.reused,true);
 assert.ok(manager.preview(second.id,'posts/test/').bytes.toString().includes('article'));
 assert.ok(reused.timings.some(t=>t.stage==='reuse'&&t.durationMs>=0));
 driver.changeHead();await settled(manager,manager.prepare(draft.id,request).id);assert.equal(builds,2);
 store.update(draft.id,{...draft,body:'changed',revision:1});
 await settled(manager,manager.prepare(draft.id,{...input,revision:2}).id);assert.equal(builds,3);
 const changed=manager.prepare(draft.id,{...input,description:'new summary',revision:2});await settled(manager,changed.id);assert.equal(builds,4);
 assert.deepEqual(driver.counts(),{pushes:0,deploys:0});
});
test('构建任务返回当前阶段、成功和失败的耗时，不暴露命令日志',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root);let release;
 driver.build=async(work,url,step)=>step('site',()=>new Promise((resolve,reject)=>{release=()=>reject(Error('private command output'));}));
 const manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:false},adapter:driver});
 const job=manager.prepare(draft.id,{...input,revision:1});
 for(let i=0;!release&&i<50;i++)await new Promise(r=>setTimeout(r,2));
 assert.equal(manager.get(job.id).phase.stage,'site');assert.ok(manager.get(job.id).elapsedMs>=0);
 release();const failed=await settled(manager,job.id);
 assert.equal(failed.state,'failed');assert.ok(failed.timings.some(t=>t.stage==='site'&&t.status==='failed'));
 assert.ok(!JSON.stringify(failed).includes('private command output'));const elapsed=failed.elapsedMs;
 await new Promise(r=>setTimeout(r,10));assert.equal(manager.get(job.id).elapsedMs,elapsed);
});
test('真实隔离 Git 提交仅包含选中文章，正常推送与原子上线保留旧资源和原工作区',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-publish-git-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const repo=path.join(root,'repo'),remote=path.join(root,'remote.git');fs.mkdirSync(repo);
 const git=(args,cwd=repo)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','--bare',remote],root);git(['init','-b','feat/test']);git(['config','user.name','Test']);git(['config','user.email','test@example.test']);fs.writeFileSync(path.join(repo,'pnpm-lock.yaml'),'lock');fs.mkdirSync(path.join(repo,'node_modules'));fs.writeFileSync(path.join(repo,'README.md'),'trusted');git(['add','.']);git(['commit','-m','base']);git(['remote','add','origin',remote]);git(['push','origin','feat/test']);
 const releases=path.join(root,'releases');fs.mkdirSync(path.join(releases,'old/_astro'),{recursive:true});fs.writeFileSync(path.join(releases,'old/_astro/old.css'),'old');const live=path.join(root,'current');fs.symlinkSync(path.join(releases,'old'),live);
 const driver=gitPublisher({repoDir:repo,enabled:true,branch:'feat/test',releaseDir:releases,liveLink:live});const base=await driver.head(),jobDir=path.join(root,'job');fs.mkdirSync(jobDir);const work=await driver.prepare(jobDir,base);fs.mkdirSync(path.join(work,'src/content/posts'),{recursive:true});fs.writeFileSync(path.join(work,'src/content/posts/test.md'),'article');fs.writeFileSync(path.join(work,'unselected.txt'),'PRIVATE');
 const commit=await driver.commit(work,base,['src/content/posts/test.md'],'test');await driver.push(commit,base);assert.equal(await driver.contains(commit),true);assert.equal(git(['status','--porcelain']),'');assert.equal(git(['diff','--name-only',base,commit]),'src/content/posts/test.md');
 const dist=path.join(work,'dist');fs.mkdirSync(path.join(dist,'_astro'),{recursive:true});fs.writeFileSync(path.join(dist,'index.html'),'new');await driver.deploy(dist,'release-test');assert.equal(fs.readFileSync(path.join(live,'index.html'),'utf8'),'new');assert.equal(fs.readFileSync(path.join(live,'_astro/old.css'),'utf8'),'old');assert.equal(fs.existsSync(path.join(live,'unselected.txt')),false);
});

test('单篇预览及修改后预览不运行全站编译，确认发布才编译',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root);
 let fullBuilds=0,previews=0;const render=driver.build;
 driver.preview=async(...args)=>{previews++;await render(...args);fs.renameSync(path.join(args[0],'dist'),path.join(args[0],'preview'));};
 driver.build=async(...args)=>{fullBuilds++;await render(...args);};
 const manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:true},adapter:driver});
 let job=await settled(manager,manager.prepare(draft.id,{...input,revision:1}).id);
 assert.equal(job.state,'ready');assert.equal(fullBuilds,0,'预览不能启动 Astro/Vite 全站编译');assert.equal(previews,1);
 store.update(draft.id,{...draft,body:'修改后仍应快速预览',revision:1});
 job=await settled(manager,manager.prepare(draft.id,{...input,revision:2}).id);
 assert.equal(job.state,'ready');assert.equal(fullBuilds,0);assert.equal(previews,2);
 manager.confirm(job.id,{revision:2,confirm:true});
 assert.equal((await settled(manager,job.id)).state,'published');assert.equal(fullBuilds,1);
 assert.deepEqual(driver.counts(),{pushes:1,deploys:1});
});

test('确认后的完整构建失败、草稿变化或远端变化均不得提交或上线',async t=>{
 for(const scenario of ['failure','draft','remote'])await t.test(scenario,async t=>{
  const {root,store,draft}=fixture(t),driver=mockDriver(root);
  const manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:true},adapter:driver});
  const job=await settled(manager,manager.prepare(draft.id,{...input,revision:1}).id);
  const build=driver.build;
  driver.build=async(...args)=>{
   if(scenario==='failure')throw Error('build failed');
   await build(...args);
   if(scenario==='draft')store.update(draft.id,{...draft,body:'构建期间的修改',revision:1});
   if(scenario==='remote')driver.changeHead();
  };
  manager.confirm(job.id,{revision:1,confirm:true});const failed=await settled(manager,job.id);
  assert.equal(failed.state,'failed');assert.deepEqual(driver.counts(),{pushes:0,deploys:0});
  assert.ok(manager.preview(job.id,'posts/test/').bytes.toString().includes('article'));
 });
});

test('切换发布模式后旧预览必须重新生成，不能提交到另一种上线目录',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root),config={enabled:true,mode:'static'};
 const manager=openPublications({dataDir:path.join(root,'data'),store,config,adapter:driver});
 const job=await settled(manager,manager.prepare(draft.id,{...input,revision:1}).id);
 assert.equal(job.state,'ready');config.mode='runtime';
 assert.throws(()=>manager.confirm(job.id,{revision:1,confirm:true}),/发布模式已切换/);
 assert.deepEqual(driver.counts(),{pushes:0,deploys:0});
});


test('重新打开预览保留确认的中文文件名，移动目录后不展示旧任务为可发布',async t=>{
 const {root,store,draft}=fixture(t),manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:false},adapter:mockDriver(root)});
 const job=manager.prepare(draft.id,{...input,filename:'自选文件名.md',revision:draft.revision});
 assert.equal((await settled(manager,job.id)).state,'ready');
 const info=manager.info(draft.id);assert.equal(info.filename,'自选文件名.md');assert.equal(info.path,'自选文件名.md');assert.equal(info.latest.id,job.id);
 let org=store.organization([draft]);org=store.editFolderOrganization({revision:org.revision,action:'create',parent:null,name:'新目录'},[draft]);
 store.moveOrganization({revision:org.revision,kind:'article',id:'draft:'+draft.id,target:org.folders[0].id},[draft]);
 const moved=manager.info(draft.id);assert.equal(moved.filename,'自选文件名.md');assert.equal(moved.path,'新目录/自选文件名.md');assert.equal(moved.latest,null);
});


test('公开版本已切换而绑定确认失败，重启重试只补确认且保留新私人编辑',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root),args={dataDir:path.join(root,'data'),store,config:{enabled:true},adapter:driver};
 let manager=openPublications(args);const job=manager.prepare(draft.id,{...input,revision:1});await settled(manager,job.id);
 const reconcile=store.reconcilePublication.bind(store);store.reconcilePublication=()=>{throw Error('binding write unavailable');};
 manager.confirm(job.id,{revision:1,confirm:true});assert.equal((await settled(manager,job.id)).state,'retry');assert.deepEqual(driver.counts(),{pushes:1,deploys:1});
 const updated=store.update(draft.id,{...draft,body:'切换后继续编辑的私人正文',revision:1});store.reconcilePublication=reconcile;
 manager=openPublications(args);manager.confirm(job.id,{revision:1,confirm:true});assert.equal((await settled(manager,job.id)).state,'published');assert.deepEqual(driver.counts(),{pushes:1,deploys:1});assert.equal(store.get(draft.id).body,updated.body);assert.equal(store.get(draft.id).revision,updated.revision);assert.equal(store.binding(store.get(draft.id)).path,'test.md');
});

test('导入后的仓库正文变化会冲突，不能被启动时的新绑定掩盖',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-source-conflict-')),posts=path.join(root,'repo/src/content/posts');fs.mkdirSync(posts,{recursive:true});
 const original='---\ntitle: 文章\npublished: 2020-01-01\n---\n原文';fs.writeFileSync(path.join(posts,'文章.md'),original);
 const store=openStore({dataDir:path.join(root,'data'),sourceRoots:{blog:posts}});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const draft=store.create({title:'文章',body:'私人修改',category:'',tags:'',source:{root:'blog',path:'文章.md'}});
 fs.writeFileSync(path.join(posts,'文章.md'),original+'\n外部新正文');
 const driver=mockDriver(root);driver.prepare=async dir=>{const work=path.join(dir,'work');fs.cpSync(path.join(root,'repo'),work,{recursive:true});return work;};
 const manager=openPublications({dataDir:path.join(root,'data'),store,config:{repoDir:path.join(root,'repo'),enabled:false},adapter:driver});
 const task=manager.prepare(draft.id,{...input,revision:1});const result=await settled(manager,task.id);
 assert.equal(result.state,'failed');assert.match(result.error,/变化|冲突|改变/);assert.equal(store.get(draft.id).body,'私人修改');assert.equal(driver.counts().pushes,0);
});

test('仓库未发布 Markdown 导入仍为草稿，明确预览才准备首次发布',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-repo-draft-')),posts=path.join(root,'repo/src/content/posts');fs.mkdirSync(posts,{recursive:true});
 fs.writeFileSync(path.join(posts,'草稿.md'),'---\ntitle: 草稿\ndraft: true\npublished: 2020-01-01\n---\n原文');
 const store=openStore({dataDir:path.join(root,'data'),sourceRoots:{blog:posts}});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const driver=mockDriver(root);driver.prepare=async dir=>{const work=path.join(dir,'work');fs.cpSync(path.join(root,'repo'),work,{recursive:true});return work;};
 const manager=openPublications({dataDir:path.join(root,'data'),store,config:{repoDir:path.join(root,'repo'),enabled:false},adapter:driver});
 const draft=store.create({title:'草稿',body:'准备发布正文',category:'',tags:'',source:{root:'blog',path:'草稿.md'}});
 assert.equal(store.binding(draft),undefined);assert.equal(manager.decorate([draft])[0].publication,undefined);
 const task=manager.prepare(draft.id,{...input,filename:'草稿.md',revision:1});const result=await settled(manager,task.id);assert.equal(result.state,'ready',result.error);
 const text=fs.readFileSync(path.join(root,'data/publications',task.id,'work/src/content/posts/草稿.md'),'utf8');assert.equal(matter(text).data.draft,false);assert.equal(matter(text).data.articleId,'legacy:草稿.md');assert.equal(driver.counts().pushes,0);
});
