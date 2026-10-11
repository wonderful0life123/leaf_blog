import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../../scripts/studio/store.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64');
const fields={title:'测试草稿',body:'正文',category:'AI/cuda',tags:'CUDA, 笔记'};
test('回收站持久化、恢复保留图片、旧页面不能复活草稿',t=>{
 const f=fixture(t),image=f.store.upload(png);
 const d=f.store.create({...fields,body:`![图](${image.url})`});
 assert.throws(()=>f.store.lifecycle(d.id,'purge',d),{status:409});
 const deleted=f.store.lifecycle(d.id,'trash',d);
 assert.equal(f.store.list().length,0);assert.equal(f.store.list({trash:true}).length,1);
 assert.throws(()=>f.store.update(d.id,d),{status:409});
 assert.throws(()=>f.store.lifecycle(d.id,'restore',d),{status:409});
 f.restart();assert.equal(f.store.get(d.id).deletedAt,deleted.deletedAt);
 const restored=f.store.lifecycle(d.id,'restore',deleted);
 assert.equal(restored.body,d.body);assert.equal(restored.deletedAt,null);assert.equal(f.store.list().length,1);
 assert.deepEqual(Buffer.from(f.store.media(image.id).bytes),png);
});
test('复制草稿保留附件快照且独立编辑，彻底删除不损坏其他草稿图片',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.notes,'a.md'),'note');fs.writeFileSync(path.join(f.notes,'a.png'),png);
 const d=f.store.create({...fields,body:'![图](a.png)',source:{root:'notes',path:'a.md'}}),id=randomUUID();
 const copy=f.store.duplicate(d.id,{revision:d.revision,id});
 assert.equal(f.store.duplicate(d.id,{revision:d.revision,id}).id,copy.id);
 assert.deepEqual(copy.assets,d.assets);assert.equal(copy.source,null);
 f.store.update(copy.id,{...copy,title:'独立副本'});assert.equal(f.store.get(d.id).title,d.title);
 const deleted=f.store.lifecycle(d.id,'trash',d);
 assert.throws(()=>f.store.create({...fields,source:d.source}),{status:409});
 f.store.lifecycle(d.id,'purge',deleted);assert.throws(()=>f.store.get(d.id),{status:404});
 f.restart();assert.equal(f.store.get(copy.id).title,'独立副本');
 assert.deepEqual(Buffer.from(f.store.media(Object.values(copy.assets)[0].split('/').filter(Boolean).pop()).bytes),png);
});
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-studio-test-'));
  const notes=path.join(root,'notes');fs.mkdirSync(notes);
  const options={dataDir:path.join(root,'data'),sourceRoots:{notes}};
  let store=openStore(options);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,notes,options,get store(){return store;},restart(){store.close();store=openStore(options);return store;}};
}
test('正文、元数据、上传图片在关闭数据库并重新打开后完整保留',t=>{
  const f=fixture(t),image=f.store.upload(png);
  const d=f.store.create({...fields,body:`正文\n![图](${image.url})`});
  const saved=f.store.update(d.id,{...d,title:'更新标题',revision:1});
  assert.equal(saved.revision,2);
  f.restart();assert.deepEqual(f.store.get(d.id),saved);
  assert.deepEqual(Buffer.from(f.store.media(image.id).bytes),png);
});
test('笔记导入保存图片快照，原文件删除后仍可编辑和读取图片',t=>{
  const f=fixture(t);fs.mkdirSync(path.join(f.notes,'assets'));
  fs.writeFileSync(path.join(f.notes,'a.md'),'original');fs.writeFileSync(path.join(f.notes,'assets','图.png'),png);
  const body='![图片](assets/图.png)\n\n```md\n![示例](not-real.png)\n```';
  const d=f.store.create({...fields,body,source:{root:'notes',path:'a.md'}});
  assert.equal(fs.readFileSync(path.join(f.notes,'a.md'),'utf8'),'original');
  fs.rmSync(f.notes,{recursive:true});f.restart();
  const saved=f.store.update(d.id,{...d,title:'已独立保存'});
  assert.equal(saved.body,body);
  assert.equal(Object.keys(saved.assets).length,1);
  assert.deepEqual(Buffer.from(f.store.media(saved.assets['assets/图.png'].split('/').filter(Boolean).pop()).bytes),png);
});
test('过时版本无法覆盖新版，另存副本保留正文和图片映射',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.notes,'a.md'),'original');fs.writeFileSync(path.join(f.notes,'a.png'),png);
  const d=f.store.create({...fields,body:'![图](a.png)\n`a.png`',source:{root:'notes',path:'a.md'}});
  const newer=f.store.update(d.id,{...d,body:d.body+'\n另一个窗口'});
  assert.throws(()=>f.store.update(d.id,{...d,body:'过时修改'}),{status:409});
  assert.deepEqual(f.store.get(d.id),newer);
  const copy=f.store.create({...fields,body:d.body+'\n本窗口',copyFrom:d.id});
  assert.equal(copy.body,d.body+'\n本窗口');assert.deepEqual(copy.assets,d.assets);assert.equal(copy.source,null);
});
test('缺失附件导入回滚，不留下半篇草稿',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.notes,'a.md'),'original');
  assert.throws(()=>f.store.create({...fields,body:'![图](missing.png)',source:{root:'notes',path:'a.md'}}),{status:422});
  assert.equal(f.store.list().length,0);
});
test('拒绝越界来源、越界附件及不受支持的图片',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'outside.md'),'outside');fs.writeFileSync(path.join(f.root,'outside.png'),png);fs.writeFileSync(path.join(f.notes,'a.md'),'original');
  assert.throws(()=>f.store.create({...fields,source:{root:'notes',path:'../outside.md'}}),{status:400});
  assert.throws(()=>f.store.create({...fields,body:'![图](../outside.png)',source:{root:'notes',path:'a.md'}}),{status:422});
  assert.throws(()=>f.store.upload(Buffer.from('<svg><script>alert(1)</script></svg>')),{status:415});
  assert.throws(()=>f.store.create(null),{status:400});
});
test('重复提交同一创建请求或同一来源不会重复导入',t=>{
  const f=fixture(t),id=randomUUID();
  assert.equal(f.store.create({...fields,id}).id,f.store.create({...fields,id}).id);
  fs.writeFileSync(path.join(f.notes,'a.md'),'original');
  const source={root:'notes',path:'a.md'};
  assert.equal(f.store.create({...fields,source}).id,f.store.create({...fields,source}).id);
  assert.equal(f.store.list().length,2);
});
test('备份可独立恢复正文和图片，且备份后修改不会改变备份',t=>{
  const f=fixture(t),image=f.store.upload(png),d=f.store.create({...fields,body:`![图](${image.url})`});
  const backup=f.store.backup();f.store.update(d.id,{...d,title:'后续修改'});
  const restoreDir=path.join(f.root,'restore');fs.mkdirSync(restoreDir);fs.copyFileSync(backup,path.join(restoreDir,'studio.sqlite'));
  const restored=openStore({dataDir:restoreDir});
  try{assert.deepEqual(restored.get(d.id),d);assert.deepEqual(Buffer.from(restored.media(image.id).bytes),png);}finally{restored.close();}
});
