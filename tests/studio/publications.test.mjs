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
 for(const target of ['../bad.md','a/../../bad.md','/tmp/x.md','A.md','a.mdx'])assert.throws(()=>convert(draft,{...input,path:target}),/路径/);
 assert.throws(()=>convert(draft,input,{previous:'existing'}),/占用/);assert.throws(()=>convert({...draft,title:' '}),/标题/);
 assert.throws(()=>convert({...draft,body:'<img src="file:///etc/passwd">'}),/HTML/);assert.throws(()=>convert(draft,{...input,published:'2026-02-31'}),/日期/);assert.throws(()=>convert({...draft,body:'![](missing.png)'}),/图片/);
});
test('构建预览保持私密，确认才推送；重复确认不重复发布，预览去脚本并隔离资源',async t=>{
 const {root,store,draft}=fixture(t),driver=mockDriver(root),manager=openPublications({dataDir:path.join(root,'data'),store,config:{enabled:true},adapter:driver});
 const started=manager.prepare(draft.id,{...input,revision:1});assert.equal(started.state,'building');assert.deepEqual(driver.counts(),{pushes:0,deploys:0});
 const ready=await settled(manager,started.id);assert.equal(ready.state,'ready');assert.throws(()=>manager.preview(ready.id,'../../job.json'),/不存在/);
 const html=manager.preview(ready.id,'posts/writing/test/').bytes.toString();assert.ok(!html.includes('SECRET_SCRIPT'));assert.ok(!html.includes('onerror'));assert.ok(html.includes(`/publications/${ready.id}/preview/_astro/image.png`));
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
test('真实隔离 Git 提交仅包含选中文章，正常推送与原子上线保留旧资源和原工作区',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-publish-git-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const repo=path.join(root,'repo'),remote=path.join(root,'remote.git');fs.mkdirSync(repo);
 const git=(args,cwd=repo)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','--bare',remote],root);git(['init','-b','feat/test']);git(['config','user.name','Test']);git(['config','user.email','test@example.test']);fs.writeFileSync(path.join(repo,'pnpm-lock.yaml'),'lock');fs.mkdirSync(path.join(repo,'node_modules'));fs.writeFileSync(path.join(repo,'README.md'),'trusted');git(['add','.']);git(['commit','-m','base']);git(['remote','add','origin',remote]);git(['push','origin','feat/test']);
 const releases=path.join(root,'releases');fs.mkdirSync(path.join(releases,'old/_astro'),{recursive:true});fs.writeFileSync(path.join(releases,'old/_astro/old.css'),'old');const live=path.join(root,'current');fs.symlinkSync(path.join(releases,'old'),live);
 const driver=gitPublisher({repoDir:repo,enabled:true,branch:'feat/test',releaseDir:releases,liveLink:live});const base=await driver.head(),jobDir=path.join(root,'job');fs.mkdirSync(jobDir);const work=await driver.prepare(jobDir,base);fs.mkdirSync(path.join(work,'src/content/posts'),{recursive:true});fs.writeFileSync(path.join(work,'src/content/posts/test.md'),'article');fs.writeFileSync(path.join(work,'unselected.txt'),'PRIVATE');
 const commit=await driver.commit(work,base,['src/content/posts/test.md'],'test');await driver.push(commit,base);assert.equal(await driver.contains(commit),true);assert.equal(git(['status','--porcelain']),'');assert.equal(git(['diff','--name-only',base,commit]),'src/content/posts/test.md');
 const dist=path.join(work,'dist');fs.mkdirSync(path.join(dist,'_astro'),{recursive:true});fs.writeFileSync(path.join(dist,'index.html'),'new');await driver.deploy(dist,'release-test');assert.equal(fs.readFileSync(path.join(live,'index.html'),'utf8'),'new');assert.equal(fs.readFileSync(path.join(live,'_astro/old.css'),'utf8'),'old');assert.equal(fs.existsSync(path.join(live,'unselected.txt')),false);
});
