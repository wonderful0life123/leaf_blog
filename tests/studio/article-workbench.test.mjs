import test from 'node:test';
import assert from 'node:assert/strict';
import {blogPath,articleKey,mergeArticles,isPublished,buildArticleTree,flattenArticleTree} from '../../src/components/studio/article-workbench.mjs';

test('编辑副本覆盖对应仓库文章，已发布筛选仍可找到修改中的副本',()=>{
 const original={id:'服务器/环境.md',path:'服务器/环境.md',root:'blog',status:'published',body:'原文'};
 const draft={id:'uuid',persisted:true,source:{root:'blog',path:original.path},status:'draft',body:'修改后'};
 const [entry]=mergeArticles([draft],[original]);
 assert.equal(mergeArticles([draft],[original]).length,1);
 assert.equal(articleKey(entry),articleKey(draft));assert.equal(entry.body,'修改后');assert.ok(isPublished(entry));
 assert.equal(original.body,'原文');assert.equal(draft.repositoryStatus,undefined);
});
test('发布路径优先于笔记来源；未归档草稿不把分类伪装为文件夹',()=>{
 const unfiled={id:'note',persisted:true,source:{root:'notes',path:'笔记/内核.md'},category:'AI/cuda'};
 assert.equal(blogPath(unfiled),'');
 const published={...unfiled,publication:{path:'writing/kernel.md'}};
 assert.equal(blogPath(published),'writing/kernel.md');
 const tree=buildArticleTree([unfiled,published]);
 assert.deepEqual(tree.children.map(n=>n.label).sort(),['writing','未归档草稿'].sort());
 assert.equal(tree.count,2);
});
test('任意深度中文路径和根目录文章不会丢失，折叠不改变源数据',()=>{
 const items=[{id:'a',root:'blog',path:'__proto__/中文/Linux/系统/a.md',title:'A'},{id:'b',root:'blog',path:'b.md',title:'B'}];
 const tree=buildArticleTree(items);const all=flattenArticleTree(tree);
 assert.equal(all.find(n=>n.label==='A').depth,4);
 const collapsed=flattenArticleTree(tree,new Set(['path:/__proto__']));
 assert.deepEqual(collapsed.map(n=>n.label),['__proto__','B']);assert.equal(tree.count,2);
 assert.equal(items[0].path,'__proto__/中文/Linux/系统/a.md');
});
test('真实同名未归档文件夹和草稿分组具有不同标识；发布副本只覆盖对应路径',()=>{
 const post={id:'p',root:'blog',path:'未归档草稿/a.md',title:'A'};
 const draft={id:'uuid',persisted:true,title:'B'};
 const tree=buildArticleTree([post,draft]);
 assert.equal(new Set(tree.children.map(n=>n.id)).size,2);
 const publication={...draft,publication:{path:post.path},status:'published'};
 assert.equal(mergeArticles([publication],[post]).length,1);
});

test('同一路径的并行草稿分别可选择，不产生重复节点或丢失正文',()=>{
 const source={root:'blog',path:'writing/a.md'};
 const first={id:'first',persisted:true,source,body:'第一份'};
 const second={id:'second',persisted:true,source,body:'第二份'};
 const entries=mergeArticles([first,second],[{id:'a',root:'blog',path:source.path}]);
 const leaves=flattenArticleTree(buildArticleTree(entries)).filter(n=>n.type==='article');
 assert.equal(leaves.length,2);assert.equal(new Set(leaves.map(n=>n.id)).size,2);
 assert.deepEqual(leaves.map(n=>n.article.body),['第一份','第二份']);
});
