import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {archiveManifest,validateArchive,withArchivePath,ARCHIVE_FILE} from '../../src/lib/public-archive.mjs';
import {openStore} from '../../scripts/studio/store.mjs';
import {openPublications} from '../../scripts/studio/publications.mjs';

test('公开目录仅输出公开文章需要的路径，不暴露空目录、草稿及内部标识',()=>{
 const org={folders:[{id:'a',name:'公开',parent:null},{id:'b',name:'子目录',parent:'a'},{id:'secret',name:'私人计划',parent:null}],placements:{'blog:old/a.md':'b','draft:private':'secret','blog:root.md':null}};
 const manifest=archiveManifest(org,[{path:'old/a.md'},{path:'root.md'}]);
 assert.deepEqual({...manifest.paths},{'old/a':['公开','子目录'],root:[]});
 assert.ok(!JSON.stringify(manifest).includes('私人'));assert.ok(!JSON.stringify(manifest).includes('draft:'));
 const entry={id:'old/a',data:{title:'标题',category:'原分类',runtimeBody:'代码'},rendered:{html:'html'}};
 assert.equal(withArchivePath(entry,manifest).data.archivePath,'公开/子目录');assert.equal(withArchivePath(entry,manifest).data.category,'原分类');assert.equal(entry.data.archivePath,undefined);
 assert.equal(withArchivePath({id:'root',data:{}},manifest).data.archivePath,'');
 assert.throws(()=>validateArchive({format:1,paths:{a:['../secret']}}));
});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-archive-')),store=openStore({dataDir:path.join(root,'data')});
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const items=[{path:'old/a.md',root:'blog',status:'published'}];
 let org=store.organization(items);org=store.editFolderOrganization({action:'create',parent:null,name:'公开新目录',revision:org.revision},items);
 const folder=org.folders.find(f=>f.name==='公开新目录');org=store.moveOrganization({kind:'article',id:'blog:old/a.md',target:folder.id,revision:org.revision},items);
 let pushes=0,commits=0,deploys=0,fail=false,head='base',files,work;
 const driver={async head(){return head;},async prepare(dir){work=path.join(dir,'work');fs.mkdirSync(path.join(work,'src/content/posts/old'),{recursive:true});fs.writeFileSync(path.join(work,'src/content/posts/old/a.md'),'---\ntitle: 已公开文章\npublished: 2026-10-01\ncategory: 原分类\n---\n旧正文');fs.writeFileSync(path.join(work,'src/content/posts/private.md'),'---\ntitle: 私密标题\ndraft: true\n---\n私密正文');return work;},async build(){},async commit(w,b,f){files=f;commits++;return 'commit';},async contains(c){return head===c;},async push(){pushes++;head='commit';},async deploy(){if(fail)throw Error('deploy failed');deploys++;return {};}};
 const args={dataDir:path.join(root,'data'),store,config:{enabled:true,mode:'runtime'},adapter:driver};
 return {store,items,org,args,driver,counts:()=>({pushes,commits,deploys}),files:()=>files,work:()=>work,fail:v=>fail=v};
}
async function settle(manager,id){for(let i=0;i<100;i++){const job=manager.get(id);if(!['building','publishing'].includes(job.state))return job;await new Promise(r=>setTimeout(r,5));}throw Error('timeout');}
test('检查目录不提交；确认提交真实文件移动，失败重试和重启不重复提交',async t=>{
 const f=fixture(t);let manager=openPublications(f.args);
 let job=manager.prepareOrganization({revision:f.org.revision},f.items);job=await settle(manager,job.id);
 assert.equal(job.state,'ready');assert.equal(job.archiveRows.length,1);assert.equal(job.archiveChanges,1);assert.equal(decodeURI(job.archiveRows[0].url),'/posts/公开新目录/a/');assert.deepEqual(job.archiveRows[0].path,['公开新目录']);
 assert.deepEqual(f.counts(),{pushes:0,commits:0,deploys:0});
 assert.ok(!fs.readFileSync(path.join(f.work(),ARCHIVE_FILE),'utf8').includes('private'));
 assert.throws(()=>manager.confirm(job.id,{revision:job.revision}),/确认/);
 f.fail(true);manager.confirm(job.id,{revision:job.revision,confirm:true});job=await settle(manager,job.id);assert.equal(job.state,'retry');
 f.fail(false);manager=openPublications(f.args);assert.equal(manager.organizationInfo().latest.id,job.id);
 manager.confirm(job.id,{revision:job.revision,confirm:true});job=await settle(manager,job.id);assert.equal(job.state,'published');
 manager.confirm(job.id,{revision:job.revision,confirm:true});assert.deepEqual(f.counts(),{pushes:1,commits:1,deploys:1});assert.ok(f.files().includes(ARCHIVE_FILE));assert.ok(f.files().includes('src/data/article-routes.json'));assert.ok(f.files().includes('src/content/posts/old/a.md'));assert.ok(f.files().includes('src/content/posts/公开新目录/a.md'));assert.equal(fs.existsSync(path.join(f.work(),'src/content/posts/old/a.md')),false);assert.ok(fs.readFileSync(path.join(f.work(),'src/content/posts/公开新目录/a.md'),'utf8').includes('旧正文'));
});
test('检查后目录变化拒绝确认；关闭发布时仍允许检查',async t=>{
 const f=fixture(t),manager=openPublications(f.args);
 const job=await settle(manager,manager.prepareOrganization({revision:f.org.revision},f.items).id);
 f.store.editFolderOrganization({action:'create',parent:null,name:'另一个',revision:f.org.revision},f.items);
 assert.throws(()=>manager.confirm(job.id,{revision:job.revision,confirm:true}),/目录已发生变化/);
 const disabled=openPublications({...f.args,config:{enabled:false}});
 assert.throws(()=>disabled.confirm(job.id,{revision:job.revision,confirm:true}),/尚未开启/);
 assert.deepEqual(f.counts(),{pushes:0,commits:0,deploys:0});
});
