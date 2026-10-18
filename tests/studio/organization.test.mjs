import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../../scripts/studio/store.mjs';
import {seedOrganization,moveOrganization,articleFolder,folderPath} from '../../src/lib/studio-organization.mjs';
import {buildArticleTree,flattenArticleTree} from '../../src/components/studio/article-workbench.mjs';
const articles=[{id:'a',root:'blog',path:'学习/CUDA/a.md',title:'A',body:'![image](./图.webp)'},{id:'b',root:'blog',path:'服务器/Linux/b.md',title:'B'},{id:'c',root:'blog',path:'日常/c.md',title:'C'}];
test('目录移动持久保存、撤销与重启，不改正文、路径、图片或草稿版本',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-org-'));let store=openStore({dataDir:dir});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const draft=store.create({id:randomUUID(),title:'草稿',body:'正文',category:'独立分类',tags:''});const items=[...articles,draft];
 const initial=store.organization(items),before=store.get(draft.id);
 const moved=store.moveOrganization({revision:initial.revision,kind:'article',id:'draft:'+draft.id,target:'folder:学习/CUDA'},items);
 assert.equal(articleFolder(draft,moved),'folder:学习/CUDA');assert.deepEqual(store.get(draft.id),before);
 assert.throws(()=>store.moveOrganization({revision:0,kind:'article',id:'draft:'+draft.id,target:null},items),e=>e.status===409);
 const nested=store.moveOrganization({revision:moved.revision,kind:'folder',id:'folder:学习',target:'folder:服务器/Linux'},items);
 assert.equal(folderPath(nested.folders,articleFolder(articles[0],nested)),'服务器 / Linux / 学习 / CUDA');
 assert.equal(articleFolder(draft,nested),'folder:学习/CUDA');assert.equal(articles[0].path,'学习/CUDA/a.md');
 store.close();store=openStore({dataDir:dir});assert.equal(store.organization(items).revision,nested.revision);
 assert.throws(()=>store.undoOrganization({revision:nested.revision,token:moved.undoToken},items),e=>e.status===409);
 const undone=store.undoOrganization({revision:nested.revision,token:nested.undoToken},items);
 assert.equal(folderPath(undone.folders,'folder:学习/CUDA'),'学习 / CUDA');assert.equal(articleFolder(draft,undone),'folder:学习/CUDA');
 assert.throws(()=>store.undoOrganization({revision:undone.revision,token:nested.undoToken},items),e=>e.status===409);
 const snapshot=store.backup(),db=new DatabaseSync(snapshot);assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);assert.equal(JSON.parse(db.prepare('SELECT state_json FROM organization').get().state_json).revision,undone.revision);db.close();
});
test('移动禁止循环、相同父级、同名目录合并、失效目标及不存在文章',()=>{
 const initial=seedOrganization(null,articles);
 const move=input=>moveOrganization(initial,{revision:0,...input},articles);
 for(const target of ['folder:学习','folder:学习/CUDA'])assert.throws(()=>move({kind:'folder',id:'folder:学习',target}),/自身/);
 assert.throws(()=>move({kind:'folder',id:'folder:学习',target:null}),/已经/);
 assert.throws(()=>move({kind:'article',id:'blog:学习/CUDA/a.md',target:'../../oops'}),/不存在/);
 assert.throws(()=>move({kind:'article',id:'draft:missing',target:null}),/文章不存在/);
 const same=seedOrganization(null,[...articles,{root:'blog',path:'日常/学习/z.md'}]);
 assert.throws(()=>moveOrganization(same,{revision:0,kind:'folder',id:'folder:学习',target:'folder:日常'},articles),/同名/);
});
test('已移动目录不会在刷新时重生；根目录、未归档、公开副本身份正确',()=>{
 const initial=seedOrganization(null,articles);
 const moved=moveOrganization(initial,{revision:0,kind:'folder',id:'folder:学习',target:'folder:日常'},articles);
 const refreshed=seedOrganization(moved,[...articles,{root:'blog',path:'学习/CUDA/new.md'}]);
 assert.equal(refreshed.folders.filter(f=>f.id==='folder:学习').length,1);
 assert.equal(folderPath(refreshed.folders,'folder:学习/CUDA'),'日常 / 学习 / CUDA');
 const draft={id:'draft',persisted:true,title:'草稿'};
 const placed=moveOrganization(seedOrganization(null,[draft,...articles]),{revision:0,kind:'article',id:'draft:draft',target:'folder:学习'},[draft,...articles]);
 const published={...draft,publication:{path:'writing/new.md'}};
 const seeded=seedOrganization(placed,[{root:'blog',path:'writing/new.md'},published,...articles]);
 assert.equal(articleFolder(published,seeded),'folder:学习');assert.equal(articleFolder({root:'blog',path:'writing/new.md'},seeded),'folder:学习');
 const root=moveOrganization(seeded,{revision:1,kind:'article',id:'draft:draft',target:null},[published,...articles]);
 assert.equal(articleFolder(published,root),null);
 const tree=buildArticleTree([published,...articles],root);assert.ok(tree.children.some(n=>n.type==='article'&&n.id==='draft:draft'));
 assert.equal(flattenArticleTree(tree).filter(n=>n.type==='article').length,4);
});

test('v2 升级目录表前备份；重复打开不改变原草稿',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-org-v2-'));let store=openStore({dataDir:dir});
 const draft=store.create({id:randomUUID(),title:'已有草稿',body:'原文',category:'分类',tags:'标签'});store.close();
 const filename=path.join(dir,'studio.sqlite'),old=new DatabaseSync(filename);old.exec('DROP TABLE organization; PRAGMA user_version=2');old.close();
 store=openStore({dataDir:dir});assert.deepEqual(store.get(draft.id),draft);store.close();
 const files=fs.readdirSync(path.join(dir,'backups'));assert.equal(files.length,1);
 const backup=new DatabaseSync(path.join(dir,'backups',files[0]));assert.equal(backup.prepare('PRAGMA user_version').get().user_version,2);assert.equal(backup.prepare('SELECT body FROM drafts').get().body,'原文');backup.close();
 store=openStore({dataDir:dir});assert.deepEqual(store.get(draft.id),draft);store.close();assert.equal(fs.readdirSync(path.join(dir,'backups')).length,1);
 fs.rmSync(dir,{recursive:true,force:true});
});

test('新建层级目录、重命名、删除空目录可撤销并持久化，冲突不能覆盖',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-folders-'));let store=openStore({dataDir:dir});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const original=JSON.stringify(articles);let state=store.organization(articles);
 const edit=input=>state=store.editFolderOrganization({revision:state.revision,...input},articles);
 edit({action:'create',name:'新目录',parent:null});const parent=state.folders.find(f=>f.name==='新目录').id;
 assert.throws(()=>edit({action:'create',name:'新目录',parent:null}),/同名/);
 assert.throws(()=>edit({action:'create',id:parent,name:'新目录',parent:null}),/同名/);
 for(const name of ['', '..', 'a/b', 'a\\b','a\nname','x'.repeat(81)])assert.throws(()=>edit({action:'create',name,parent:null}),/目录名/);
 assert.throws(()=>edit({action:'create',name:'子目录',parent:'missing'}),/不存在/);
 edit({action:'create',name:'子目录',parent});const child=state.folders.find(f=>f.name==='子目录').id;
 assert.throws(()=>edit({action:'delete',id:parent}),/空目录/);
 edit({action:'rename',id:parent,name:'重命名后的目录'});assert.equal(folderPath(state.folders,child),'重命名后的目录 / 子目录');
 const stale=state.revision;edit({action:'delete',id:child});assert.ok(!state.folders.some(f=>f.id===child));
 assert.throws(()=>store.editFolderOrganization({revision:stale,action:'rename',id:parent,name:'并发'},articles),e=>e.status===409);
 state=store.undoOrganization({revision:state.revision,token:state.undoToken},articles);assert.ok(state.folders.some(f=>f.id===child));
 assert.throws(()=>edit({action:'delete',id:'folder:学习/CUDA'}),/空目录/);
 store.close();store=openStore({dataDir:dir});assert.deepEqual(store.organization(articles),state);assert.equal(JSON.stringify(articles),original);
});

test('在目录中新建草稿原子保存位置，失效目录或版本不产生草稿；重试不移动既有文章',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-folder-draft-'));const store=openStore({dataDir:dir});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let state=store.editFolderOrganization({revision:0,action:'create',name:'目标',parent:null},articles);
 const target=state.folders.find(f=>f.name==='目标').id,id=randomUUID();
 const input={id,title:'新草稿',body:'原正文',category:'',tags:'',organization:{target,revision:state.revision}};
 assert.throws(()=>store.create({...input,organization:{target:'missing',revision:state.revision}},articles),/不存在/);assert.equal(store.list().length,0);
 assert.throws(()=>store.create({...input,organization:{target,revision:0}},articles),e=>e.status===409);assert.equal(store.list().length,0);
 const draft=store.create(input,articles);state=store.organization([...articles,draft]);assert.equal(articleFolder(draft,state),target);assert.equal(state.undoToken,null);
 assert.deepEqual(store.create(input,articles),draft);assert.equal(store.list().length,1);assert.equal(store.organization([...articles,draft]).revision,state.revision);
 assert.throws(()=>store.editFolderOrganization({revision:state.revision,action:'delete',id:target},[...articles,draft]),/空目录/);
 const trashed=store.lifecycle(id,'trash',{revision:draft.revision});assert.throws(()=>store.editFolderOrganization({revision:state.revision,action:'delete',id:target},[...articles,trashed]),/回收站/);
});
