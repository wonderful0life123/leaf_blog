import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import matter from 'gray-matter';
import {openStore} from '../../scripts/studio/store.mjs';
import {publicationContent,digest} from '../../scripts/studio/publication-content.mjs';
import {contentComparison} from '../../scripts/studio/article-status.mjs';
import {articleIdentity} from '../../src/lib/article-paths.mjs';
import {planArticleChanges} from '../../scripts/studio/article-changes.mjs';
import {createCatalog} from '../../scripts/studio/catalog.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64');
const fields={title:'封面测试',body:'正文',category:'',tags:''};
const input={path:'中文/文章.md',published:'2026-10-19',description:''};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-cover-')),posts=path.join(root,'posts');fs.mkdirSync(posts);const options={dataDir:path.join(root,'data'),sourceRoots:{blog:posts}};let store=openStore(options);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return {posts,get store(){return store;},restart(){store.close();store=openStore(options);}};}
test('已有封面导入、独立副本、重启保存、更换和移除',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.posts,'a.png'),png);fs.writeFileSync(path.join(f.posts,'a.md'),'---\ntitle: 原文章\nimage: ./a.png\n---\n正文');
 assert.equal(createCatalog({blog:f.posts}).scan().articles[0].cover,'./a.png');
 const draft=f.store.create({...fields,source:{root:'blog',path:'a.md'}});
 assert.equal(draft.cover,'./a.png');assert.ok(draft.assets[draft.cover]);
 const copy=f.store.duplicate(draft.id,{revision:draft.revision,id:randomUUID()});assert.equal(copy.cover,draft.cover);assert.deepEqual(copy.assets,draft.assets);
 f.restart();assert.equal(f.store.get(draft.id).cover,'./a.png');
 const image=f.store.upload(png),changed=f.store.update(draft.id,{...draft,cover:image.url});assert.equal(changed.cover,image.url);
 const removed=f.store.update(draft.id,{...changed,cover:''});f.restart();assert.equal(f.store.get(draft.id).cover,'');
 assert.throws(()=>f.store.update(draft.id,{...removed,cover:'/studio-api/media/'+'f'.repeat(64)+'/'}),/图片不存在/);
});
test('封面单独发布生成图片，移除不改正文，旧客户端保持已有封面',t=>{
 const f=fixture(t),image=f.store.upload(png),draft=f.store.create({...fields,cover:image.url});
 const result=publicationContent(draft,input,{media:id=>f.store.media(id)}),parsed=matter(result.text);
 assert.match(parsed.data.image,/assets\/文章\/[a-f\d]{64}\.png/);assert.equal(result.images.length,1);assert.equal(parsed.content.trim(),'正文');
 for(const img of result.images){const dest=path.join(f.posts,img.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,img.bytes);}
 const published={...fields,path:input.path,cover:parsed.data.image};
 assert.equal(contentComparison(f.posts,[])(draft,published),false);
 assert.equal(contentComparison(f.posts,[])({...draft,cover:''},published),true);
 const options={previous:result.text,expectedHash:digest(result.text),media:id=>f.store.media(id)};
 assert.equal(matter(publicationContent({...draft,cover:''},input,options).text).data.image,'');
 assert.equal(matter(publicationContent({...draft,cover:null},input,options).text).data.image,parsed.data.image);
 assert.throws(()=>f.store.create({...fields,cover:'javascript:alert(1)'}),/封面|图片/);
});

test('随机封面在文章移动后保持相同状态',()=>{
 const draft={...fields,cover:'api',source:{path:'旧目录/a.md'}};
 assert.equal(contentComparison('/unused',[])(draft,{...fields,cover:'api',path:'新目录/a.md'}),false);
});

test('移动并更换封面只改写一次路径，旧草稿仍迁移原封面引用',t=>{
 const f=fixture(t),work=path.join(f.posts,'work'),posts=path.join(work,'src/content/posts');
 fs.mkdirSync(path.join(posts,'旧目录'),{recursive:true});
 const previous='---\ntitle: 原文章\nimage: ./a.png\n---\n正文';
 fs.writeFileSync(path.join(posts,'旧目录/a.md'),previous);
 const image=f.store.upload(png),draft=f.store.create({...fields,cover:image.url});
 const target='新目录/a.md',options={previous,expectedHash:digest(previous),media:id=>f.store.media(id)};
 for(const cover of [draft.cover,null]){
  const content=publicationContent({...draft,cover},{...input,path:target},options);
  const plan=planArticleChanges(work,[{articleId:articleIdentity('旧目录/a.md',matter(previous).data),oldPath:'旧目录/a.md',path:target,text:content.text,coverResolved:cover!=null}]);
  const result=matter(plan.writes.find(w=>w.path==='src/content/posts/'+target).text);
  if(cover)assert.equal(path.posix.join('新目录',result.data.image),content.images[0].path);
  else assert.equal(decodeURIComponent(result.data.image),'../旧目录/a.png');
 }
});

test('已有 HTTP 外链封面导入后仍可发布，正文图片校验保持原规则',t=>{
 const f=fixture(t),previous='---\ntitle: 原文章\nimage: http://example.invalid/cover.png\n---\n正文';
 fs.writeFileSync(path.join(f.posts,'external.md'),previous);
 const draft=f.store.create({...fields,source:{root:'blog',path:'external.md'}});
 const options={previous,expectedHash:digest(previous),media:id=>f.store.media(id)};
 const result=publicationContent(draft,{...input,path:'external.md'},options);
 assert.equal(matter(result.text).data.image,'http://example.invalid/cover.png');
 assert.equal(result.images.length,0);
 assert.ok(result.warnings.some(w=>w.includes('外部图片')));
 assert.throws(()=>publicationContent({...draft,body:'![图](http://example.invalid/body.png)'},{...input,path:'external.md'},options),/图片尚未保存/);
});

test('旧草稿来源文件已移走时，仍能用已保存正文和附件另存副本',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.posts,'a.png'),png);fs.writeFileSync(path.join(f.posts,'a.md'),'---\ntitle: 原文章\nimage: ./a.png\n---\n![正文图](./a.png)');
 const original=f.store.create({...fields,body:'![正文图](./a.png)',source:{root:'blog',path:'a.md'}});
 const legacy=f.store.update(original.id,{...original,cover:null});
 fs.unlinkSync(path.join(f.posts,'a.md'));
 const copy=f.store.duplicate(legacy.id,{revision:legacy.revision,id:randomUUID()});
 assert.equal(copy.body,legacy.body);assert.deepEqual(copy.assets,legacy.assets);assert.equal(copy.source,null);
 assert.equal(f.store.get(legacy.id).cover,null);
});
