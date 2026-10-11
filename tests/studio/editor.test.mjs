import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history, undo, redo, isolateHistory} from '@codemirror/commands';
import {markdown, insertNewlineContinueMarkup} from '@codemirror/lang-markdown';
import {outlineFor,formatEdit,imageEdit,writingPreferences} from '../../src/components/studio/editor-tools.mjs';

test('大纲保留重复标题位置，忽略代码块里的假标题并识别 Setext 标题',()=>{
 const text='# 开始\n\n```md\n## 这不是小节\n```\n\n## 重复标题\n正文\n\n## 重复标题\n\n结尾\n----\n';
 const outline=outlineFor(text);
 assert.deepEqual(outline.map(h=>[h.label,h.level]),[['开始',1],['重复标题',2],['重复标题',2],['结尾',2]]);
 assert(outline[1].from<outline[2].from);
 assert.equal(text.slice(outline[2].from,outline[2].to),'## 重复标题');
});
test('工具栏格式作用于选区，撤销和重做完整保留正文',()=>{
 let state=EditorState.create({doc:'前文 技术笔记 后文',selection:{anchor:3,head:7},extensions:[history(),markdown()]});
 state=state.update({...formatEdit(state,'bold'),annotations:isolateHistory.of('full'),userEvent:'input'}).state;
 assert.equal(state.doc.toString(),'前文 **技术笔记** 后文');
 assert.equal(state.sliceDoc(state.selection.main.from,state.selection.main.to),'技术笔记');
 const command={get state(){return state;},dispatch:tr=>{state=tr.state;}};
 assert(undo(command));assert.equal(state.doc.toString(),'前文 技术笔记 后文');
 assert(redo(command));assert.equal(state.doc.toString(),'前文 **技术笔记** 后文');
});
test('标题转换替换原级别，多行列表不误改选区外段落',()=>{
 let state=EditorState.create({doc:'## 原标题\n段落',selection:{anchor:4}});
 state=state.update(formatEdit(state,'heading3')).state;
 assert.equal(state.doc.toString(),'### 原标题\n段落');
 state=EditorState.create({doc:'第一行\n第二行\n保留段落',selection:{anchor:0,head:8}});
 state=state.update(formatEdit(state,'ordered')).state;
 assert.equal(state.doc.toString(),'1. 第一行\n2. 第二行\n保留段落');
});
test('代码和公式插入光标处而非文末，选中正文进入代码块',()=>{
 const state=EditorState.create({doc:'开头正文结尾',selection:{anchor:2,head:4}});
 assert.equal(state.update(formatEdit(state,'code','cpp')).state.doc.toString(),'开头\n\n```cpp\n正文\n```\n\n结尾');
});
test('Markdown 回车延续编号和任务列表，空列表项可退出',()=>{
 for(const [before,after] of [['1. 第一项','1. 第一项\n2. '],['- [x] 完成','- [x] 完成\n- [ ] '],['- ','']]){
  let state=EditorState.create({doc:before,selection:{anchor:before.length},extensions:[markdown()]});
  assert(insertNewlineContinueMarkup({state,dispatch:tr=>{state=tr.state;}}));
  assert.equal(state.doc.toString(),after);
 }
});
test('无效排版偏好回退到可读默认值',()=>{
 assert.deepEqual(writingPreferences(null),{fontSize:18,lineHeight:1.9,wide:false,outline:true,splitRatio:50});
 assert.deepEqual(writingPreferences({fontSize:200,lineHeight:0,wide:true,outline:false,splitRatio:50}),{fontSize:18,lineHeight:1.9,wide:true,outline:false,splitRatio:50});
});

test('图片插入保留相邻标题和段落，不重复增加空行',()=>{
 const image='![图片](/studio-api/media/example/)';
 for(const [doc,cursor,expected] of [['## 标题',0,image+'\n\n## 标题'],['前文后文',2,'前文\n\n'+image+'\n\n后文'],['前文\n\n后文',4,'前文\n\n'+image+'\n\n后文']]){
  const state=EditorState.create({doc,selection:{anchor:cursor}});
  assert.equal(state.update(imageEdit(state,image)).state.doc.toString(),expected);
 }
});

test('分屏偏好兼容旧设置并限制两侧最小空间',()=>{
 assert.equal(writingPreferences({}).splitRatio,50);
 assert.equal(writingPreferences({splitRatio:63}).splitRatio,63);
 assert.equal(writingPreferences({splitRatio:0}).splitRatio,25);
 assert.equal(writingPreferences({splitRatio:100}).splitRatio,75);
 assert.equal(writingPreferences({splitRatio:'bad'}).splitRatio,50);
});
