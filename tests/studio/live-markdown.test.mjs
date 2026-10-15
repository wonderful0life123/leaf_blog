import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,Compartment} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history,undo,redo} from '@codemirror/commands';
import {livePlan,liveMarkdown,safeLiveImage} from '../../src/components/studio/live-markdown.mjs';
const stateFor=(doc,selection={anchor:0},extensions=[])=>EditorState.create({doc,selection,extensions:[liveMarkdown(),...extensions]});
function rendered(state){const all=[];for(const set of state.facet(EditorView.decorations)){if(typeof set==='function')continue;set.between(0,state.doc.length,(from,to,value)=>{if(value.spec.widget)all.push({from,to,item:value.spec.widget.item});});}return all;}
test('即时渲染只隐藏非活动行语法，选区覆盖的公式和表格恢复源码',()=>{
 const text='起点\n\n**粗体**\n\n$E=mc^2$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
 let state=stateFor(text);assert.deepEqual(rendered(state).map(x=>x.item.kind),['math','table']);
 state=state.update({selection:{anchor:text.indexOf('$')+1,head:text.length}}).state;
 assert.equal(rendered(state).length,0);assert.equal(state.doc.toString(),text);
});
test('代码示例、行内代码、链接及 HTML 不被误当作公式或图片',()=>{
 const text='```md\n![图](https://example.com/a.png)\n$x$\n```\n\n`$y$`\n\n[链接](https://example.com/$z$)\n\n<div>\n$a$\n</div>\n\n正常 $b$';
 const plan=livePlan(text);assert.deepEqual(plan.filter(i=>i.kind==='math').map(i=>i.formula),['b']);assert.equal(plan.filter(i=>i.kind==='image').length,0);
});
test('图片使用允许的协议和草稿地址，不执行任意 HTML 或脚本 URL',()=>{
 const hash='a'.repeat(64);
 for(const url of ['javascript:alert(1)','data:image/svg+xml,<svg/>','//evil.example/x','file:///etc/passwd','/studio-api/drafts'])assert.equal(safeLiveImage(url),null);
 for(const url of ['https://example.com/p.png','/studio-api/media/'+hash,'/studio/assets/abc/'])assert.equal(safeLiveImage(url),url);
 assert.equal(rendered(stateFor('开头\n\n![图](javascript:alert)')).length,0);
 assert.equal(rendered(stateFor('开头\n\n![图](/studio-api/media/'+hash+')'))[0].item.kind,'image');
});
test('转义美元、货币、未完成的公式保留源码，完整多行公式可渲染',()=>{
 const plan=livePlan('开头\n\n\\$x$\n\n价格 $5 和 $10\n\n$未完成\n\n$$\nx^2\n$$');
 assert.deepEqual(plan.filter(i=>i.kind==='math').map(i=>i.formula),['\nx^2\n']);
});
test('切换源码模式、跨段删除、撤销与重做保留原始 Markdown',()=>{
 const compartment=new Compartment(),doc='开始\n\n## 标题\n\n**中文内容** 和 $x$\n\n结束';
 let state=EditorState.create({doc,extensions:[history(),compartment.of(liveMarkdown())]});
 state=state.update({effects:compartment.reconfigure([])}).state;assert.equal(state.doc.toString(),doc);
 state=state.update({effects:compartment.reconfigure(liveMarkdown())}).state;
 state=state.update({changes:{from:doc.indexOf('##'),to:doc.indexOf('结束'),insert:'新的中文段落\n\n'},userEvent:'input'}).state;
 const command={get state(){return state;},dispatch:tr=>state=tr.state};assert(undo(command));assert.equal(state.doc.toString(),doc);assert(redo(command));assert.ok(state.doc.toString().includes('新的中文段落'));
});
test('标题、嵌套列表、待办与嵌套文字格式有独立的位置，不改 Markdown 内容',()=>{
 const text='开始\n\n## 标题\n\n- [x] 完成\n  - **粗体 *斜体***\n\n> 引用';
 const plan=livePlan(text);assert.equal(plan.find(i=>i.kind==='heading').level,2);assert.equal(plan.find(i=>i.kind==='task').checked,true);
 for(const kind of ['strong','em','bullet','quote'])assert.ok(plan.some(i=>i.kind===kind));
 assert.equal(stateFor(text).doc.toString(),text);
});

test('即时渲染中非活动代码块隐藏围栏；进入代码块恢复源码且不改正文',()=>{
 const doc='开头\n\n```python\nprint("wonder")\n```\n\n结尾';
 let state=stateFor(doc);
 const code=rendered(state).find(x=>x.item.kind==='codeblock');
 assert.ok(code,'非活动代码块应该显示代码卡片，而不是原始围栏');
 assert.equal(code.item.code,'print("wonder")');assert.equal(code.item.language,'python');
 state=state.update({selection:{anchor:doc.indexOf('print')+2}}).state;
 assert.ok(!rendered(state).some(x=>x.item.kind==='codeblock'));
 assert.equal(state.doc.toString(),doc);
 state=state.update({selection:{anchor:doc.length}}).state;
 assert.ok(rendered(state).some(x=>x.item.kind==='codeblock'));
});

test('未闭合围栏保持可编辑，四反引号内的三反引号与公式按代码原样显示',()=>{
 const open='开头\n\n```python\nprint(1)';assert.ok(!rendered(stateFor(open)).some(x=>x.item.kind==='codeblock'));
 const doc='开头\n\n````md\n```python\n$x$\n```\n````\n\n尾部';
 const blocks=rendered(stateFor(doc));assert.equal(blocks.length,1);assert.equal(blocks[0].item.code,'```python\n$x$\n```');
 const selected=stateFor(doc,{anchor:0,head:doc.length});assert.equal(rendered(selected).length,0);
});
test('代码高亮不改变缩进、换行或 HTML 字面量，未知语言保留纯文本',async()=>{
 const {codeSegments}=await import('../../src/components/studio/code-preview.mjs');
 for(const [language,code] of [['python','def example():\n    return "<script>not executed</script>"\n'],['cuda','__global__ void add(float *x) { x[0] += 1.0f; }'],['unknown-language','  <img src=x onerror=alert(1)>\n\ttext']]){
  const segments=await codeSegments(code,language);assert.equal(segments.map(x=>x.text).join(''),code);if(language==='python')assert.ok(segments.some(x=>x.classes.includes('tok-keyword')));
 }
});

test('引用和列表中的表格继续使用源码编辑，不因解析差异阻断整篇文章',()=>{
 for(const source of ['> | A | B |\n> | --- | --- |\n> | x | y |','- item\n\n  | A | B |\n  | --- | --- |\n  | x | y |']){
  const table=livePlan(source).find(i=>i.kind==='table');assert.ok(table);assert.equal(table.editable,false);assert.deepEqual(table.rows,[['A','B'],['x','y']]);
 }
 const table=livePlan('| A | B |\n| :--- | ---: |\n| x | y |').find(i=>i.kind==='table');assert.equal(table.editable,true);assert.deepEqual(table.align,['left','right']);
});

test('编号列表内独占行的代码围栏渲染为卡片，保留代码缩进与空行',()=>{
 for(const [prefix,indent] of [['9. 检查','   '],['- 外层\n  - 检查','    ']]){
  const doc=prefix+'\n\n'+indent+'```bash\n'+indent+'ss -lntup\n'+indent+'  docker ps\n\n'+indent+'docker inspect <container>\n'+indent+'```\n\n结尾';
  let state=stateFor(doc,{anchor:doc.length},[history()]);
  const card=rendered(state).find(x=>x.item.kind==='codeblock');
  assert.ok(card,'光标离开列表内代码后应隐藏围栏并显示卡片');
  assert.equal(card.item.code,'ss -lntup\n  docker ps\n\ndocker inspect <container>');
  assert.equal(card.item.language,'bash');
  assert.equal(card.from,doc.indexOf(indent+'```'));
  state=state.update({selection:{anchor:card.item.codeFrom}}).state;
  assert.ok(!rendered(state).some(x=>x.item.kind==='codeblock'));
  assert.equal(state.doc.toString(),doc);
  state=state.update({changes:{from:card.item.codeFrom,insert:'# edited\n'+indent},userEvent:'input'}).state;
  const command={get state(){return state;},dispatch:tr=>state=tr.state};
  assert(undo(command));assert.equal(state.doc.toString(),doc);
  state=state.update({selection:{anchor:doc.length}}).state;
  assert.ok(rendered(state).some(x=>x.item.kind==='codeblock'));
 }
});

test('列表内未闭合围栏仍显示源码，代码标记不被渲染为正文',()=>{
 const doc='1. 检查\n\n   ```md\n   **code**\n   $x$\n\n结尾';
 assert.ok(!rendered(stateFor(doc,{anchor:doc.length})).some(x=>['codeblock','math'].includes(x.item.kind)));
});
