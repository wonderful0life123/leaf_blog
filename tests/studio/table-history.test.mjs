import test from 'node:test';
import assert from 'node:assert/strict';
import {createTableHistory} from '../../src/components/studio/table-history.mjs';
const initial=()=>({rows:[['名称','数值'],['A','1']],align:[null,null]});
test('同单元格连续输入合并撤销，停顿后的输入成为下一步',()=>{
 let time=0;const h=createTableHistory(initial(),{now:()=>time});h.focus(1,0);
 h.editCell('AB');time=200;h.editCell('ABC');time=1500;h.editCell('ABCD');
 assert(h.undo());assert.equal(h.value.table.rows[1][0],'ABC');assert(h.undo());assert.equal(h.value.table.rows[1][0],'A');assert(!h.canUndo);
 assert(h.redo());assert.equal(h.value.table.rows[1][0],'ABC');assert(h.redo());assert.equal(h.value.table.rows[1][0],'ABCD');
});
test('切换单元格、粘贴与删除分别成步，撤销恢复对应单元格',()=>{
 const h=createTableHistory(initial());h.focus(1,0);h.editCell('AB');h.focus(1,1);h.editCell('12');h.editCell('粘贴内容',{inputType:'insertFromPaste'});h.editCell('粘贴内',{inputType:'deleteContentBackward'});
 h.undo();assert.equal(h.value.table.rows[1][1],'粘贴内容');h.undo();assert.equal(h.value.table.rows[1][1],'12');h.undo();assert.equal(h.value.table.rows[1][1],'1');h.undo();assert.equal(h.value.column,0);assert.deepEqual(h.value.table,initial());
});
test('增删行列与对齐按顺序撤销重做，保留删除前数据',()=>{
 const h=createTableHistory(initial());const states=[h.value.table];
 h.focus(1,1);
 for(const action of ['add-row','add-column','delete-row','delete-column']){h.resize(action);states.push(h.value.table);}
 h.align('right');states.push(h.value.table);
 for(let i=states.length-2;i>=0;i--){assert(h.undo());assert.deepEqual(h.value.table,states[i]);}
 for(let i=1;i<states.length;i++){assert(h.redo());assert.deepEqual(h.value.table,states[i]);}
});
test('撤销后新输入清空重做，禁止的删除和无变化不创建历史',()=>{
 const h=createTableHistory({rows:[['A']],align:[null]});h.resize('delete-row');h.resize('delete-column');h.align(null);assert(!h.canUndo);
 h.editCell('B');h.undo();h.editCell('C');assert(!h.canRedo);h.undo();assert.equal(h.value.table.rows[0][0],'A');
});
test('输入法合成跨越停顿仍合并，结束后下一次输入独立撤销',()=>{
 let time=0;const h=createTableHistory(initial(),{now:()=>time});h.focus(1,0);h.breakGroup();h.editCell('n',{composing:true});time=3000;h.editCell('你好',{composing:true});h.breakGroup();h.editCell('你好！');
 h.undo();assert.equal(h.value.table.rows[1][0],'你好');h.undo();assert.equal(h.value.table.rows[1][0],'A');
});
test('历史副本不会污染初始表格，最多保留指定步数',()=>{
 const original=initial(),h=createTableHistory(original,{limit:2});h.editCell('B');h.breakGroup();h.editCell('C');h.breakGroup();h.editCell('D');const value=h.value;value.table.rows[0][0]='污染';assert.equal(h.value.table.rows[0][0],'D');
 assert(h.undo());assert(h.undo());assert(!h.undo());assert.equal(h.value.table.rows[0][0],'B');assert.deepEqual(original,initial());
});
