import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryLevels} from '../../src/components/studio/category-options.mjs';
const folders=[{id:'a',name:'技术',parent:null},{id:'b',name:'Linux',parent:'a'},{id:'c',name:'命令',parent:'b'},{id:'d',name:'生活',parent:null},{id:'e',name:'Linux',parent:'d'}];
test('分类按实际目录逐级展开，同名目录由完整路径区分',()=>{
 const {levels,legacy}=categoryLevels(folders,'技术/Linux/命令');
 assert.equal(legacy,false);assert.equal(levels.length,3);
 assert.deepEqual(levels.map(l=>l.value),['技术','技术/Linux','技术/Linux/命令']);
 assert.deepEqual(categoryLevels(folders,'生活/Linux').levels[1].options.map(o=>o.value),['生活','生活/Linux']);
 assert.equal(categoryLevels(folders,'技术').levels.length,2);
 assert.equal(categoryLevels(folders,'').levels.length,1);
});
test('目录新增、改名和移动即时改变选项，已有分类保留而非隐式重写',()=>{
 const added=[...folders,{id:'f',name:'网络',parent:'c'}];
 assert.equal(categoryLevels(added,'技术/Linux/命令').levels.length,4);
 const moved=folders.map(f=>f.id==='b'?{...f,name:'系统',parent:'d'}:f);
 const old=categoryLevels(moved,'技术/Linux');
 assert.equal(old.legacy,true);assert.equal(old.levels[0].value,'技术/Linux');
 assert.ok(old.levels[0].options.some(o=>o.value==='技术/Linux'));
 assert.equal(categoryLevels(moved,'生活/系统/命令').legacy,false);
 assert.equal(folders[1].name,'Linux');
});
test('未知分类和空目录可保留、改选或清空；无效循环目录不会造成死循环',()=>{
 assert.equal(categoryLevels([],'AI infra/cuda').levels[0].value,'AI infra/cuda');
 assert.deepEqual(categoryLevels([],'').levels[0].options,[{value:'',label:'根目录'}]);
 const invalid=[{id:'x',name:'循环',parent:'y'},{id:'y',name:'循环',parent:'x'},{id:'z',name:'孤立',parent:'missing'}];
 assert.equal(categoryLevels(invalid,'').levels[0].options.length,1);
});
