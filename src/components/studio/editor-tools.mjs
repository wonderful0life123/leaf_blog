import {markdownLanguage} from '@codemirror/lang-markdown';

// Use the Markdown parser so fenced code, quoted examples and duplicate titles
// retain their real source positions instead of relying on text search.
export function outlineFor(text) {
  const headings=[];
  markdownLanguage.parser.parse(text).iterate({enter(node){
    const match=/^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
    if(!match)return;
    const raw=text.slice(node.from,node.to);
    const label=raw.replace(/\n[ \t]*[=-]+[ \t]*$/, '').replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim();
    headings.push({from:node.from,to:node.to,level:Number(match[1]),label:label||'未命名小节'});
  }});
  return headings;
}

export function formatEdit(state,kind,language='python') {
  const {from,to}=state.selection.main, selected=state.sliceDoc(from,to);
  const inline={bold:['**','**','加粗文字'],italic:['*','*','强调文字'],strike:['~~','~~','删除文字'],inline:['`','`','代码'],link:['[','](https://)','链接文字']};
  if(inline[kind]){
    const [before,after,hint]=inline[kind],text=selected||hint;
    return {changes:{from,to,insert:before+text+after},selection:{anchor:from+before.length,head:from+before.length+text.length}};
  }
  if(kind.startsWith('heading')||['quote','bullet','ordered','task'].includes(kind)){
    const start=state.doc.lineAt(from).from,end=state.doc.lineAt(to>from&&state.doc.lineAt(to).from===to?to-1:to).to;
    const lines=state.sliceDoc(start,end).split('\n');
    const insert=lines.map((line,i)=>{
      if(kind.startsWith('heading'))return '#'.repeat(Number(kind.slice(-1)))+' '+line.replace(/^ {0,3}#{1,6}\s+/, '');
      const prefix={quote:'> ',bullet:'- ',ordered:`${i+1}. `,task:'- [ ] '}[kind];
      return prefix+line;
    }).join('\n');
    return {changes:{from:start,to:end,insert},selection:{anchor:start,head:start+insert.length}};
  }
  const templates={code:'```'+language+'\n'+(selected||'# 在这里写代码')+'\n```',formula:'$$\n'+(selected||'y = x^2')+'\n$$',table:'| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |',rule:'---'};
  const prefix=from&&state.sliceDoc(from-1,from)!=='\n'?'\n\n':'';
  const suffix=to<state.doc.length&&state.sliceDoc(to,to+1)!=='\n'?'\n\n':'\n';
  const insert=prefix+templates[kind]+suffix;
  return {changes:{from,to,insert},selection:{anchor:from+insert.length}};
}

export function writingPreferences(raw={}) {
  return {fontSize:[16,18,20,22].includes(raw?.fontSize)?raw.fontSize:18,lineHeight:[1.6,1.9,2.2].includes(raw?.lineHeight)?raw.lineHeight:1.9,wide:raw?.wide===true,outline:raw?.outline!==false,splitRatio:splitRatio(raw?.splitRatio)};
}

export function splitRatio(value){return Number.isFinite(value)?Math.min(75,Math.max(25,value)):50;}

export function imageEdit(state,text) {
  const {from,to}=state.selection.main;
  const before=state.sliceDoc(Math.max(0,from-2),from),after=state.sliceDoc(to,Math.min(state.doc.length,to+2));
  const prefix=from?'\n'.repeat(2-(before.match(/\n*$/)?.[0].length||0)):'';
  const suffix=to<state.doc.length?'\n'.repeat(2-(after.match(/^\n*/)?.[0].length||0)):'\n\n';
  const insert=prefix+text+suffix;
  return {changes:{from,to,insert},selection:{anchor:from+insert.length}};
}
