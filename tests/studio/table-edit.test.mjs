import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history,undo,redo} from '@codemirror/commands';
import {readTable,writeTable,resizeTable,tableTarget,beginTable,applyTable,emptyTable} from '../../src/components/studio/table-edit.mjs';
const sample='| 参数 | 数值 |\n| :--- | ---: |\n| **维度** | `128` |';
function harness(doc,from=0,to=doc.length,insert=false){
 let state=EditorState.create({doc,extensions:[history(),tableTarget]});
 state=state.update({effects:beginTable.of({from,to,source:doc.slice(from,to),insert})}).state;
 return {get state(){return state;},dispatch:tr=>{state=tr.state||state.update(tr).state;}};
}
test('单元格、链接、代码、转义竖线与对齐方式保存往返不丢失',()=>{
 for(const source of [sample,'| A | B |\n| --- | :---: |\n| x\\|y | `a\\|b` |\n| [链接](https://example.com) | 中文 & <tag> |','| A | B |\n| --- | --- |\n| a\\\\\\|b | \\*literal\\* |']){
  const parsed=readTable(source);assert.deepEqual(readTable(writeTable(parsed)),parsed);
 }
 const table=emptyTable();table.rows[1]=['a|b','第一行\n第二行'];const parsed=readTable(writeTable(table));assert.deepEqual(parsed.rows[1],['a|b','第一行 第二行']);
});
test('增删行列保持二维结构和对齐，表头与最后一列不能删除',()=>{
 const original=readTable(sample);let table=resizeTable(original,'add-column',1,0);
 assert.deepEqual(table.align,['left',null,'right']);assert.deepEqual(table.rows[1],['**维度**','','`128`']);
 table=resizeTable(table,'add-row',0,0);assert.equal(table.rows.length,3);
 table=resizeTable(table,'delete-row',1,0);table=resizeTable(table,'delete-column',0,1);assert.deepEqual(table,original);
 assert.deepEqual(resizeTable(original,'delete-row',0,0),original);
 const one={rows:[['A']],align:[null]};assert.deepEqual(resizeTable(one,'delete-column',0,0),one);
});
test('只更新选中的表格，一次撤销和重做恢复整次修改',()=>{
 const h=harness('前文\n\n'+sample+'\n\n'+sample,4,4+sample.length);
 const next=readTable(sample);next.rows[1][1]='256';next.align[1]='center';h.dispatch(applyTable(h.state,next));
 assert.equal(h.state.doc.toString(),'前文\n\n'+writeTable(next)+'\n\n'+sample);
 assert(undo(h));assert.equal(h.state.doc.toString(),'前文\n\n'+sample+'\n\n'+sample);
 assert(redo(h));assert.ok(h.state.doc.toString().includes('256'));
});
test('异步图片插入导致表格位置变化后仍更新正确位置，原表格被修改则拒绝覆盖',()=>{
 const h=harness('前\n'+sample,2,2+sample.length);h.dispatch({changes:{from:0,insert:'新增\n'}});h.dispatch(applyTable(h.state,readTable(sample)));assert.ok(h.state.doc.toString().startsWith('新增\n前\n'));
 const conflict=harness(sample);conflict.dispatch({changes:{from:2,to:4,insert:'修改'}});assert.throws(()=>applyTable(conflict.state,readTable(sample)),/已变化/);
});
test('插入新表格自动分段，取消编辑不改变原文',()=>{
 const h=harness('前文后文',2,2,true);assert.equal(h.state.doc.toString(),'前文后文');h.dispatch(applyTable(h.state,emptyTable()));assert.equal(h.state.doc.toString(),'前文\n\n'+writeTable(emptyTable())+'\n\n后文');assert(undo(h));assert.equal(h.state.doc.toString(),'前文后文');
});
