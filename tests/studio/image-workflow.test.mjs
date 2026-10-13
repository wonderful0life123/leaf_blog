import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history,undo,redo} from '@codemirror/commands';
import {imageUploads,imageAnchors,imageTarget,trackImage,replaceImage,imageMarkdown} from '../../src/components/studio/image-workflow.mjs';
const url='/studio-api/media/'+'a'.repeat(64)+'/';
const file=name=>({name,size:1});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(doc,upload){
 let state=EditorState.create({doc,extensions:[imageAnchors,history()]});let jobs=[];
 const dispatch=tr=>{state=tr.state||state.update(tr).state;};
 const queue=imageUploads({getState:()=>state,dispatch,upload,onUpdate:value=>jobs=value});
 return {get state(){return state;},get jobs(){return jobs;},dispatch,queue};
}
test('上传等待期间移动光标和继续输入，图片保留原位置且不抢光标',async()=>{
 let resolve;const h=harness('前段\n\n后段',()=>new Promise(r=>resolve=r));
 h.queue.enqueue([file('图.png')],{id:'picker',from:4,to:4});
 h.dispatch({changes:{from:0,insert:'新增'},selection:{anchor:8}});
 resolve(url);await flush();
 assert.equal(h.jobs[0].state,'done');
 assert.equal(h.state.doc.toString(),'新增前段\n\n![图.png]('+url+')\n\n后段');
 assert.equal(h.state.selection.main.head,h.state.doc.length);
 assert(undo(h));assert.equal(h.state.doc.toString(),'新增前段\n\n后段');assert(redo(h));assert.ok(h.state.doc.toString().includes('![图.png]'));
});
test('批量上传逐张继续，失败可重试且不会重复成功图片',async()=>{
 let fails=true;const h=harness('尾部',async f=>{if(f.name==='坏图'&&fails)throw Error('网络中断');return url;});
 h.queue.enqueue([file('第一张'),file('坏图'),file('第三张')],{from:0,to:0});await flush();
 assert.deepEqual(h.jobs.map(j=>j.state),['done','failed','done']);
 fails=false;h.queue.retry(h.jobs[1].id);await flush();
 assert.ok(h.jobs.every(j=>j.state==='done'));
 assert.equal((h.state.doc.toString().match(/第一张/g)||[]).length,1);
 assert.equal((h.state.doc.toString().match(/坏图/g)||[]).length,1);
 assert.ok(h.state.doc.toString().indexOf('坏图')<h.state.doc.toString().indexOf('第三张'));
});
test('原插入位置被删除后不向其他段落插图',async()=>{
 let resolve;const h=harness('前文目标后文',()=>new Promise(r=>resolve=r));
 h.queue.enqueue([file('图')],{from:3,to:3});h.dispatch({changes:{from:2,to:4,insert:''}});resolve(url);await flush();
 assert.equal(h.jobs[0].state,'failed');assert.equal(h.state.doc.toString(),'前文后文');
});
test('替换图片保持说明、位置和相邻正文；目标被修改时拒绝覆盖',async()=>{
 let resolve;const old='![说明](https://example.com/a.png)';const h=harness('前\n'+old+'\n后',()=>new Promise(r=>resolve=r));
 h.queue.enqueue([file('替换.png')],{from:2,to:2+old.length,source:old,alt:'说明'});
 h.dispatch({changes:{from:0,insert:'新增'}});resolve(url);await flush();
 assert.equal(h.state.doc.toString(),'新增前\n![说明]('+url+')\n后');
 const h2=harness(old,()=>new Promise(r=>resolve=r));h2.queue.enqueue([file('替换')],{from:0,to:old.length,source:old,alt:'说明'});
 h2.dispatch({changes:{from:2,to:4,insert:'新说明'}});resolve(url);await flush();assert.equal(h2.jobs[0].state,'failed');assert.ok(h2.state.doc.toString().includes('新说明'));
});
test('编辑图片说明和移除只修改当前引用，可撤销；说明不会注入新语法',()=>{
 const old='![说明]('+url+')';const h=harness(old+'\n'+old,async()=>url);
 h.dispatch({effects:trackImage.of({id:'edit',from:0,to:old.length,source:old})});
 h.dispatch(replaceImage(h.state,'edit',imageMarkdown('括号 [x]\n下一行',url)));
 assert.equal(h.state.doc.toString(),imageMarkdown('括号 [x]\n下一行',url)+'\n'+old);
 assert(undo(h));assert.equal(h.state.doc.toString(),old+'\n'+old);
 h.dispatch({effects:trackImage.of({id:'edit',from:0,to:old.length,source:old})});h.dispatch(replaceImage(h.state,'edit',''));assert.equal(h.state.doc.toString(),'\n'+old);
 assert(undo(h));assert.equal(h.state.doc.toString(),old+'\n'+old);
});
test('编辑器关闭后上传结果不写入新文章，过大图片不阻断后续任务',async()=>{
 let resolve;const h=harness('',()=>new Promise(r=>resolve=r));h.queue.enqueue([file('图')],{from:0,to:0});h.queue.close();resolve(url);await flush();assert.equal(h.state.doc.length,0);
 const h2=harness('',async()=>url);h2.queue.enqueue([{name:'过大',size:11*1024*1024},file('正常')],{from:0,to:0});await flush();assert.deepEqual(h2.jobs.map(j=>j.state),['failed','done']);
});
