import test from 'node:test';
import assert from 'node:assert/strict';
import {selectArticles,excerpt} from '../../src/components/studio/draft-list.mjs';
test('草稿搜索覆盖正文和元数据，排序不改变源列表',()=>{
 const items=[{id:'a',title:'旧文',body:'独特正文',tags:'CUDA',status:'draft',updatedAt:'2026-01-01'},{id:'b',title:'新文',body:'',status:'draft',updatedAt:'2026-02-01'}];
 assert.equal(selectArticles(items,'draft','独特')[0].id,'a');
 assert.equal(selectArticles(items,'draft','cuda')[0].id,'a');
 assert.deepEqual(selectArticles(items,'draft','').map(d=>d.id),['b','a']);
 assert.equal(items[0].id,'a');assert.deepEqual(selectArticles(items,'published',''),[]);
 assert.equal(excerpt({body:'## 标题\n\n**正文**'}),'标题 正文');
});
