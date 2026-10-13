import {syntaxTree} from '@codemirror/language';
import {markdownLanguage, insertNewlineContinueMarkupCommand} from '@codemirror/lang-markdown';

// Empty list items exit immediately instead of making a two-item list loose.
export const continueWriting = insertNewlineContinueMarkupCommand({nonTightLists:false});

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

// Use the editor's incremental tree when available; standalone callers can
// still inspect a plain EditorState without installing a language extension.
export function formatState(state) {
  const {from,to}=state.selection.main,result={};
  const cached=syntaxTree(state),tree=cached.length===state.doc.length?cached:markdownLanguage.parser.parse(state.doc.toString());
  tree.iterate({from,to,enter(ref){
    const node=ref.node,opening=node.firstChild,closing=node.lastChild;
    const key={StrongEmphasis:'bold',Emphasis:'italic',Strikethrough:'strike',InlineCode:'inline'}[node.name];
    if(key&&opening&&closing&&opening!==closing&&((from>=opening.to&&to<=closing.from)||(from===node.from&&to===node.to)))result[key]=true;
    if(from>=node.from&&to<=node.to){
      const heading=/^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if(heading)result.heading='heading'+heading[1];
      if(node.name==='Blockquote')result.quote=true;
    }
  }});
  return result;
}

export function formatEdit(state,kind,language='python') {
  const {from,to}=state.selection.main, selected=state.sliceDoc(from,to);
  const inline={bold:['**','**','加粗文字'],italic:['*','*','强调文字'],strike:['~~','~~','删除文字'],inline:['`','`','代码'],link:['[','](https://)','链接文字']};
  if(inline[kind]){
    // Match parsed delimiters rather than stripping adjacent stars: italic
    // inside bold must not consume the bold marker (or a literal in code).
    const nodeName={bold:'StrongEmphasis',italic:'Emphasis',strike:'Strikethrough',inline:'InlineCode'}[kind];
    let match;
    if(nodeName)markdownLanguage.parser.parse(state.doc.toString()).iterate({enter(ref){
      const node=ref.node,opening=node.firstChild,closing=node.lastChild;
      if(node.name!==nodeName||!opening||!closing||opening===closing)return;
      const inside=from>=opening.to&&to<=closing.from;
      const whole=from===node.from&&to===node.to;
      if((inside||whole)&&(!match||node.to-node.from<match.to-match.from))match=node;
    }});
    if(match){
      const opening=match.firstChild,closing=match.lastChild;
      const map=pos=>Math.max(opening.from,Math.min(pos,closing.from)-(opening.to-opening.from));
      return {changes:[{from:opening.from,to:opening.to},{from:closing.from,to:closing.to}],selection:{anchor:map(state.selection.main.anchor),head:map(state.selection.main.head)}};
    }
    const [before,after,hint]=inline[kind],text=selected||hint;
    return {changes:{from,to,insert:before+text+after},selection:{anchor:from+before.length,head:from+before.length+text.length}};
  }
  if(kind==='paragraph'||kind.startsWith('heading')||['quote','bullet','ordered','task'].includes(kind)){
    let start=state.doc.lineAt(from).from,end=state.doc.lineAt(to>from&&state.doc.lineAt(to).from===to?to-1:to).to;
    let raw=state.sliceDoc(start,end);
    if(kind==='paragraph'||kind.startsWith('heading'))markdownLanguage.parser.parse(state.doc.toString()).iterate({from,to,enter(ref){
      if(/^SetextHeading/.test(ref.name)&&from>=ref.from&&to<=ref.to){start=ref.from;end=ref.to;raw=state.sliceDoc(start,end).replace(/\n[ \t]*[=-]+[ \t]*$/, '');}
    }});
    const lines=raw.split('\n');
    const listPattern=/^( *)(?:([-+*])\s+(?:\[([ xX])\]\s+)?|(\d+[.)])\s+)(.*)$/;
    const matches=lines.map(line=>line.match(listPattern));
    const same=kind==='quote'?lines.every(line=>/^ *> ?/.test(line)):lines.every((line,i)=>{
      const match=matches[i];return match&&(kind==='task'?match[3]!==undefined:kind==='ordered'?!!match[4]:kind==='bullet'?!!match[2]&&match[3]===undefined:false);
    });
    const insert=lines.map((line,i)=>{
      if(kind==='paragraph')return line.replace(/^ {0,3}#{1,6}\s+/, '');
      if(kind.startsWith('heading'))return '#'.repeat(Number(kind.slice(-1)))+' '+line.replace(/^ {0,3}#{1,6}\s+/, '');
      if(kind==='quote')return same?line.replace(/^( *)> ?/,'$1'):line.replace(/^( *)/,'$1> ');
      const match=matches[i],indent=match?.[1]??line.match(/^ */)[0],content=match?match[5]:line.slice(indent.length);
      if(same)return indent+content;
      return indent+{bullet:'- ',ordered:`${i+1}. `,task:'- [ ] '}[kind]+content;
    }).join('\n');
    return {changes:{from:start,to:end,insert},selection:{anchor:start,head:start+insert.length}};
  }
  const templates={code:'```'+language+'\n'+(selected||'# 在这里写代码')+'\n```',formula:'$$\n'+(selected||'y = x^2')+'\n$$',table:'| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |',rule:'---'};
  const prefix=from&&state.sliceDoc(from-1,from)!=='\n'?'\n\n':'';
  const suffix=to<state.doc.length&&state.sliceDoc(to,to+1)!=='\n'?'\n\n':'\n';
  const insert=prefix+templates[kind]+suffix;
  if(kind==='code'||kind==='formula'){
    const start=from+prefix.length+templates[kind].indexOf('\n')+1;
    const content=selected||(kind==='code'?'# 在这里写代码':'y = x^2');
    return {changes:{from,to,insert},selection:{anchor:start,head:start+content.length}};
  }
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
