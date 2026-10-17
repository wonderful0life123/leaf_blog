import test from 'node:test';
import assert from 'node:assert/strict';
import {articlePath} from '../../scripts/studio/publication-content.mjs';

test('文章路径保留中文与空格，拒绝不安全及跨平台冲突名称',()=>{
  assert.equal(articlePath('服务器/Linux/服务器加载 Codex.md'),'服务器/Linux/服务器加载 Codex.md');
  assert.equal(articlePath('笔记/cafe\u0301.md'),'笔记/café.md');
  for(const p of ['../a.md','/a.md','a/CON.md','a/文件 .md','a/%2f.md','a/../a.md','a\\b.md','a?.md'])assert.throws(()=>articlePath(p));
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {planArticleChanges,rewriteReferences,referenceResolver} from '../../scripts/studio/article-changes.mjs';
import {redirectTarget} from '../../src/lib/article-paths.mjs';
import {openStore} from '../../scripts/studio/store.mjs';
import {createCatalog} from '../../scripts/studio/catalog.mjs';

test('中文移动规划保留附件、改写入链、保护代码示例且旧路由直达新位置',t=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-alignment-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
 const posts=path.join(work,'src/content/posts');fs.mkdirSync(path.join(posts,'旧目录'),{recursive:true});
 fs.writeFileSync(path.join(posts,'旧目录/文章.md'),'---\ntitle: 文章\npublished: 2026-01-01\ncategory: 错误分类\n---\n![图](图.png)\n\n[友](../友.md)\n\n```md\n[友](../友.md)\n```\n');
 fs.writeFileSync(path.join(posts,'友.md'),'---\ntitle: 友\npublished: 2026-01-01\n---\n[文章](旧目录/文章.md#小节)\n\n`[文章](旧目录/文章.md#小节)`\n');fs.writeFileSync(path.join(posts,'旧目录/图.png'),'image');
 const plan=planArticleChanges(work,[{articleId:'legacy:旧目录/文章.md',oldPath:'旧目录/文章.md',path:'服务器/Linux/文章.md'}]);
 assert.deepEqual(plan.deletes,['src/content/posts/旧目录/文章.md']);
 const moved=plan.writes.find(w=>w.path.endsWith('/Linux/文章.md')).text;
 assert.match(moved,/\.\.\/\.\.\/%E6%97%A7%E7%9B%AE%E5%BD%95\/%E5%9B%BE.png/);
 assert.ok(moved.includes('```md\n[友](../友.md)\n```'));assert.equal(matter(moved).data.category,'服务器/Linux');
 const inbound=plan.writes.find(w=>w.path.endsWith('/友.md')).text;assert.ok(inbound.includes('`[文章](旧目录/文章.md#小节)`'));assert.ok(inbound.includes('%E6%9C%8D%E5%8A%A1%E5%99%A8/Linux/'));
 assert.equal(redirectTarget(plan.routes,'旧目录/文章'),'/posts/%E6%9C%8D%E5%8A%A1%E5%99%A8/Linux/%E6%96%87%E7%AB%A0/');
 for(const w of plan.writes){fs.mkdirSync(path.dirname(path.join(work,w.path)),{recursive:true});fs.writeFileSync(path.join(work,w.path),w.text);}for(const f of plan.deletes)fs.unlinkSync(path.join(work,f));
 const back=planArticleChanges(work,[{articleId:'legacy:旧目录/文章.md',oldPath:'服务器/Linux/文章.md',path:'旧目录/文章.md'}]);
 assert.equal(redirectTarget(back.routes,'旧目录/文章'),null);assert.equal(redirectTarget(back.routes,'服务器/Linux/文章'),'/posts/%E6%97%A7%E7%9B%AE%E5%BD%95/%E6%96%87%E7%AB%A0/');
 assert.throws(()=>planArticleChanges(work,[{articleId:'legacy:旧目录/文章.md',oldPath:'服务器/Linux/文章.md',path:'友.md'}]),/同名|占用/);
});

test('当前绑定确认不修改草稿正文版本、已保存期望目录及回收站，重复确认幂等',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-binding-'));const posts=path.join(root,'src/content/posts');fs.mkdirSync(posts,{recursive:true});
 fs.writeFileSync(path.join(posts,'原文.md'),'---\ntitle: 原文\npublished: 2026-01-01\n---\n正文');
 const store=openStore({dataDir:path.join(root,'data'),sourceRoots:{blog:posts}});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const articles=createCatalog({blog:posts}).scan().articles;store.organization(articles);
 const draft=store.create({title:'修改中',body:'私有修改',category:'旧分类',tags:'标签',source:{root:'blog',path:'原文.md'}});
 const org=store.organization([...articles,draft]);const moved=store.editFolderOrganization({revision:org.revision,action:'create',name:'中文目录',parent:null},[...articles,draft]);
 const target=moved.folders[0].id;const desired=store.moveOrganization({revision:moved.revision,kind:'article',id:'draft:'+draft.id,target},[...articles,draft]);
 const job={id:'job',bindings:[{articleId:articles[0].articleId,oldPath:'原文.md',path:'中文目录/原文.md',route:'中文目录/原文',hash:'new-hash',draftId:draft.id}]};
 store.reconcilePublication(job);store.reconcilePublication(job);
 const after=store.get(draft.id);assert.equal(after.body,draft.body);assert.equal(after.revision,draft.revision);assert.equal(after.source.path,'中文目录/原文.md');assert.equal(after.source.referencePath,'原文.md');assert.equal(store.bindings().length,1);assert.equal(store.organization([]).revision,desired.revision);
});


test('重复公开文章身份在规划前被拒绝，不合并不同文章',t=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-duplicate-id-'));t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
 const posts=path.join(work,'src/content/posts');fs.mkdirSync(posts,{recursive:true});
 for(const name of ['一.md','二.md'])fs.writeFileSync(path.join(posts,name),'---\narticleId: same-public-id\ntitle: 标题\n---\n正文');
 assert.throws(()=>planArticleChanges(work,[]),/文章身份重复/);
});


test('链接内的图片分别改写目的地，不混淆同名链接和代码',()=>{
 const resolve=referenceResolver('旧/文章.md','新/子目录/文章.md',new Map([['旧/友.md','另处/友.md']]),new Map());
 const body='[![图](图.png)](友.md) [![图](图.png)](友.md)\n\n`[![图](图.png)](友.md)`';
 const result=rewriteReferences(body,resolve);
 const expected='[![图](../../%E6%97%A7/%E5%9B%BE.png)](../../%E5%8F%A6%E5%A4%84/%E5%8F%8B.md)';
 assert.equal(result,expected+' '+expected+'\n\n`[![图](图.png)](友.md)`');
 assert.equal(rewriteReferences('[![x](same.png)](same.png)',resolve),'[![x](../../%E6%97%A7/same.png)](../../%E6%97%A7/same.png)');
});

test('嵌套代码中的引用定义保持原样，真实引用定义仍随目录移动',()=>{
 const source='- Example:\n\n  ```md\n  [sample]: image.png\n  ```\n\n[sample]: image.png\n\n![图][sample]\n';
 const result=rewriteReferences(source,referenceResolver('old/a.md','new/deep/a.md',new Map(),new Map()));
 assert.ok(result.includes('  [sample]: image.png\n  ```'));
 assert.ok(result.includes('\n[sample]: ../../old/image.png'));
});

import {legacyArticleRoute,rssGuidXml} from '../../src/lib/article-paths.mjs';
import rss from '@astrojs/rss';
test('旧 Astro 路由及 RSS GUID 在真实目录移动后保持兼容',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-legacy-route-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const posts=path.join(root,'src/content/posts');fs.mkdirSync(path.join(posts,'Guide'),{recursive:true});
 fs.writeFileSync(path.join(posts,'Foo Bar.md'),'---\ntitle: old\n---\nbody');fs.writeFileSync(path.join(posts,'Guide/index.md'),'---\ntitle: guide\n---\nbody');
 assert.equal(legacyArticleRoute('Foo Bar.md'),'foo-bar');assert.equal(legacyArticleRoute('Guide/index.md'),'guide');
 const plan=planArticleChanges(root,[{articleId:'legacy:Foo Bar.md',oldPath:'Foo Bar.md',path:'中文/Foo Bar.md'}]);
 const entry=plan.routes.articles.find(a=>a.id==='legacy:Foo Bar.md');assert.deepEqual(entry.aliases,['foo-bar']);assert.equal(entry.guidRoute,'foo-bar');
 const response=await rss({title:'test',description:'test',site:'https://example.com',items:[{title:'old',link:'/posts/中文/Foo Bar/',customData:rssGuidXml(entry,'https://example.com','中文/Foo Bar')}]});
 const xml=await response.text();assert.equal((xml.match(/<guid /g)||[]).length,1);assert.ok(xml.includes('https://example.com/posts/foo-bar/'));
});
