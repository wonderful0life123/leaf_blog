import {StateField, StateEffect} from '@codemirror/state';
import {Decoration, EditorView, WidgetType} from '@codemirror/view';
import {markdownLanguage} from '@codemirror/lang-markdown';
import {marked} from 'marked';
import katex from 'katex';
import {readTable} from './table-edit.mjs';
import {codeSegments} from './code-preview.mjs';

const composing = StateEffect.define();
// Plans contain source positions only. Rendering never changes the Markdown document.
export function livePlan(text) {
  const tree=markdownLanguage.parser.parse(text),items=[],excluded=[];
  const add=(kind,from,to,extra={})=>items.push({kind,from,to,...extra});
  tree.iterate({enter(ref){
    const n=ref.node,raw=text.slice(n.from,n.to),name=n.name;
    if(['FencedCode','CodeBlock','HTMLBlock'].includes(name)){
      excluded.push([n.from,n.to]);
      if(name!=='HTMLBlock'){
        const token=marked.lexer(raw).find(t=>t.type==='code');
        const opening=n.firstChild,closing=n.lastChild;
        // Nested container prefixes remain in the editable source; only standalone fenced blocks become cards.
        const complete=name==='FencedCode'&&n.parent.name==='Document'&&closing?.name==='CodeMark'&&closing.from>opening.from;
        const lineStart=text.lastIndexOf('\n',n.from-1)+1;
        add('codeblock',complete?lineStart:n.from,n.to,{complete,code:token?.text||'',language:token?.lang?.split(/\s/)[0]||'text',codeFrom:text.indexOf('\n',n.from)+1});
      }
      return false;
    }
    if(name==='InlineCode'){
      excluded.push([n.from,n.to]);add('inline-code',n.from,n.to);
      for(let c=n.firstChild;c;c=c.nextSibling)if(c.name==='CodeMark')add('hide',c.from,c.to,{owner:[n.from,n.to]});
      return false;
    }
    if(name==='Table'){
      let table,editable=n.parent.name==='Document';
      try{table=readTable(raw);}catch{
        editable=false;
        const rows=[];
        for(let row=n.firstChild;row;row=row.nextSibling){
          if(!['TableHeader','TableRow'].includes(row.name))continue;
          const cells=[];for(let c=row.firstChild;c;c=c.nextSibling)if(c.name==='TableCell')cells.push(text.slice(c.from,c.to));
          rows.push(cells);
        }
        table={rows,align:Array(rows[0]?.length||0).fill(null)};
      }
      add('table',n.from,n.to,{...table,editable});excluded.push([n.from,n.to]);return false;
    }
    if(/^ATXHeading|^SetextHeading/.test(name))add('heading',n.from,n.to,{level:Number(name.slice(-1))});
    if(name==='HeaderMark'){
      let to=n.to;if(text[to]===' ')to++;
      // A Setext underline occupies its own line and stays visible while editing that heading.
      add('hide',n.from,to,{owner:[n.parent.from,n.parent.to]});
    }
    if(['StrongEmphasis','Emphasis','Strikethrough'].includes(name))add({StrongEmphasis:'strong',Emphasis:'em',Strikethrough:'strike'}[name],n.from,n.to);
    if(['EmphasisMark','StrikethroughMark'].includes(name))add('hide',n.from,n.to,{owner:[n.parent.from,n.parent.to]});
    if(name==='Blockquote')add('quote',n.from,n.to);
    if(name==='QuoteMark')add('hide',n.from,n.to,{owner:[n.from,n.to]});
    if(name==='ListMark'&&/^[-+*]$/.test(raw))add(n.nextSibling?.name==='Task'?'hide':'bullet',n.from,n.to);
    if(name==='TaskMarker')add('task',n.from,n.to,{checked:/x/i.test(raw)});
    if(name==='Link'){
      excluded.push([n.from,n.to]);add('link',n.from,n.to);
      const children=[];for(let c=n.firstChild;c;c=c.nextSibling)children.push(c);
      const close=children.find(c=>c.name==='LinkMark'&&text.slice(c.from,c.to)===']');
      if(close){add('hide',n.from,n.from+1,{owner:[n.from,n.to]});add('hide',close.from,n.to,{owner:[n.from,n.to]});}
    }
    if(name==='Image'){
      excluded.push([n.from,n.to]);
      const token=marked.lexer(raw)[0]?.tokens?.find(t=>t.type==='image');
      if(token)add('image',n.from,n.to,{src:token.href,alt:token.text,title:token.title||''});
      return false;
    }
  }});
  // Math is outside code, links, image syntax, HTML and tables. Incomplete expressions stay editable.
  const math=/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;let m;
  while((m=math.exec(text))){
    const from=m.index,to=from+m[0].length;
    let slashes=0;for(let i=from-1;i>=0&&text[i]==='\\';i--)slashes++;
    if(slashes%2||excluded.some(([a,b])=>from<b&&to>a)||(!m[1]&&(/^\s|\s$/.test(m[2])||/\d/.test(text[to]||''))))continue;
    add('math',from,to,{formula:m[1]||m[2],display:!!m[1]});
  }
  return items;
}
export function safeLiveImage(src){return typeof src==='string'&&/^(https?:\/\/|\/studio-api\/media\/[a-f\d]{64}\/?$|\/studio\/assets\/[^/]+\/?$)/i.test(src)?src:null;}
function active(state,from,to){
  const first=state.doc.lineAt(from).from,last=state.doc.lineAt(to).to;
  return state.selection.ranges.some(r=>r.from<=last&&r.to>=first);
}
class Rendered extends WidgetType {
  constructor(item,source,onImage,onTable){super();this.item=item;this.source=source;this.onImage=onImage;this.onTable=onTable;}
  eq(other){return JSON.stringify(this.item)===JSON.stringify(other.item)&&this.source===other.source;}
  toDOM(view){
    const i=this.item,dom=document.createElement('span');dom.className='cm-live-widget cm-live-'+(i.kind==='codeblock'?'code-preview':i.kind);dom.contentEditable='false';
    const edit=()=>{view.dispatch({selection:{anchor:Math.min(i.kind==='codeblock'?i.codeFrom:i.from+1,view.state.doc.length)}});view.focus();};
    dom.setAttribute('role','button');dom.tabIndex=0;dom.setAttribute('aria-label',({codeblock:'编辑代码块（'+i.language+'）',image:'编辑图片：'+(i.alt||'图片'),math:'编辑公式',table:i.editable&&this.onTable?'编辑表格':'编辑表格源码',task:'切换待办状态',bullet:'编辑列表'})[i.kind]);
    dom.addEventListener('mousedown',e=>e.preventDefault());
    const activate=()=>{if(i.kind==='table'&&i.editable&&this.onTable){this.onTable(i);return;}if(i.kind==='image'&&this.onImage){this.onImage(i);return;}if(i.kind==='task'&&!view.state.readOnly){view.dispatch({changes:{from:i.from,to:i.to,insert:i.checked?'[ ]':'[x]'},userEvent:'input'});view.focus();}else edit();};
    dom.addEventListener('click',activate);dom.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();activate();}});
    if(i.kind==='codeblock'){
      const header=document.createElement('span');header.className='cm-live-code-header';
      const label=document.createElement('span');label.textContent=i.language;
      const hint=document.createElement('span');hint.textContent='点击编辑';header.append(label,hint);
      const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=i.code||' ';pre.append(code);dom.append(header,pre);
      codeSegments(i.code,i.language).then(segments=>{if(!dom.isConnected)return;const fragment=document.createDocumentFragment();for(const segment of segments){const span=document.createElement('span');span.className=segment.classes;span.textContent=segment.text;fragment.append(span);}code.replaceChildren(fragment);view.requestMeasure();});
    }else if(i.kind==='image'){
      const img=document.createElement('img');img.src=this.source;img.alt=i.alt;img.referrerPolicy='no-referrer';img.addEventListener('load',()=>view.requestMeasure());
      img.addEventListener('error',()=>{img.hidden=true;const label=document.createElement('span');label.textContent='图片无法显示 · 点击编辑';dom.append(label);view.requestMeasure();},{once:true});dom.append(img);
    }else if(i.kind==='math'){
      dom.innerHTML=katex.renderToString(i.formula,{displayMode:i.display,throwOnError:false,trust:false,strict:'ignore',maxExpand:1000});
    }else if(i.kind==='table'){
      const table=document.createElement('table');i.rows.forEach((row,index)=>{const tr=document.createElement('tr');row.forEach((cell,column)=>{const td=document.createElement(index?'td':'th');td.textContent=cell;td.style.textAlign=i.align?.[column]||'left';tr.append(td);});table.append(tr);});dom.append(table);
    }else dom.textContent=i.kind==='task'?(i.checked?'☑':'☐'):'•';
    return dom;
  }
  ignoreEvent(){return true;}
}
function decorations(state,items,resolveImage,onImage,onTable){
  const ranges=[];
  const replacements=items.filter(i=>(['image','math','table'].includes(i.kind)||(i.kind==='codeblock'&&i.complete))&&!active(state,i.from,i.to));
  for(const i of items){
    if(replacements.some(r=>r!==i&&i.from>=r.from&&i.to<=r.to))continue;
    const owner=i.owner||[i.from,i.to],editing=active(state,...owner);
    if(['heading','quote'].includes(i.kind)||(i.kind==='codeblock'&&(editing||!i.complete))){
      for(let line=state.doc.lineAt(i.from);line.from<=i.to;){ranges.push(Decoration.line({class:'cm-live-'+i.kind+(i.level?' cm-live-h'+i.level:'')}).range(line.from));if(line.number===state.doc.lines)break;line=state.doc.line(line.number+1);}
    }else if(['strong','em','strike','link','inline-code'].includes(i.kind))ranges.push(Decoration.mark({class:'cm-live-'+i.kind}).range(i.from,i.to));
    else if(!editing){
      if(i.kind==='hide')ranges.push(Decoration.replace({}).range(i.from,i.to));
      else {
        const src=i.kind==='image'?safeLiveImage(resolveImage(i.src)):'';
        if(i.kind==='image'&&!src)continue;
        const block=['table','codeblock'].includes(i.kind)||((i.kind==='image'||i.kind==='math')&&state.doc.lineAt(i.from).from===i.from&&state.doc.lineAt(i.to).to===i.to);
        ranges.push(Decoration.replace({widget:new Rendered(i,src,onImage,onTable),block}).range(i.from,i.to));
      }
    }
  }
  return Decoration.set(ranges,true);
}
export function liveMarkdown({resolveImage=href=>href,onImage,onTable}={}){
  const field=StateField.define({
    create(state){const items=livePlan(state.doc.toString());return {items,composing:false,decorations:decorations(state,items,resolveImage,onImage,onTable)};},
    update(value,tr){
      let inComposition=value.composing;for(const effect of tr.effects)if(effect.is(composing))inComposition=effect.value;
      if(inComposition)return {...value,composing:true,decorations:value.decorations.map(tr.changes)};
      const ended=value.composing&&!inComposition;
      if(!tr.docChanged&&!tr.selection&&!ended)return value;
      const items=tr.docChanged||ended?livePlan(tr.state.doc.toString()):value.items;
      return {items,composing:false,decorations:decorations(tr.state,items,resolveImage,onImage,onTable)};
    },
    provide:f=>EditorView.decorations.from(f,value=>value.decorations)
  });
  return [field,EditorView.domEventHandlers({
    compositionstart(_event,view){view.dispatch({effects:composing.of(true)});},
    compositionend(_event,view){queueMicrotask(()=>{if(view.dom.isConnected)view.dispatch({effects:composing.of(false)});});}
  }),EditorView.baseTheme({
    '.cm-live-heading':{fontWeight:'700',lineHeight:'1.6',paddingTop:'.45em',paddingBottom:'.25em',color:'var(--studio-text)'},
    '.cm-live-heading span':{textDecoration:'none'},
    '.cm-live-h1':{fontSize:'1.7em'},'.cm-live-h2':{fontSize:'1.4em'},'.cm-live-h3':{fontSize:'1.2em'},
    '.cm-live-strong':{fontWeight:'700'},'.cm-live-em':{fontStyle:'italic'},'.cm-live-strike':{textDecoration:'line-through'},
    '.cm-live-link':{color:'var(--btn-content)',textDecoration:'underline'},
    '.cm-live-inline-code':{fontFamily:'"JetBrains Mono Variable",monospace',background:'var(--inline-code-bg)',color:'var(--inline-code-color)',borderRadius:'3px'},
    '.cm-live-codeblock':{fontFamily:'"JetBrains Mono Variable",monospace',background:'var(--page-bg)',paddingLeft:'12px',paddingRight:'12px'},
    '.cm-live-code-preview':{display:'block',overflow:'hidden',border:'1px solid var(--line-divider)',borderRadius:'10px',background:'var(--codeblock-bg)',color:'#e1e8e5',fontFamily:'"JetBrains Mono Variable",monospace'},
    '.cm-live-code-header':{display:'flex',justifyContent:'space-between',gap:'1em',padding:'7px 16px',background:'var(--codeblock-topbar-bg)',color:'#dce5e3',fontSize:'12px'},
    '.cm-live-code-preview pre':{margin:'0',padding:'16px',overflowX:'auto',whiteSpace:'pre',lineHeight:'1.7',fontSize:'.9em'},
    '.cm-live-code-preview code':{font:'inherit',color:'inherit',background:'transparent'},
    '.cm-live-code-preview .tok-keyword, .cm-live-code-preview .tok-operator':{color:'#c4a7e7'},
    '.cm-live-code-preview .tok-string, .cm-live-code-preview .tok-string2':{color:'#a8d8a5'},
    '.cm-live-code-preview .tok-number, .cm-live-code-preview .tok-bool, .cm-live-code-preview .tok-atom':{color:'#f2c38b'},
    '.cm-live-code-preview .tok-typeName, .cm-live-code-preview .tok-className, .cm-live-code-preview .tok-propertyName':{color:'#8dd8e8'},
    '.cm-live-code-preview .tok-comment, .cm-live-code-preview .tok-meta':{color:'#a6afb8'},
    '.cm-live-quote':{borderLeft:'3px solid var(--primary)',paddingLeft:'14px',background:'var(--btn-regular-bg)'},
    '.cm-live-widget':{cursor:'text'},'.cm-live-widget:focus-visible':{outline:'2px solid var(--primary)',outlineOffset:'2px'},
    '.cm-live-image':{display:'inline-block',maxWidth:'100%',padding:'8px 0'},'.cm-live-image img':{display:'block',maxWidth:'100%',maxHeight:'480px',objectFit:'contain',borderRadius:'8px'},
    '.cm-live-math':{display:'inline-block',maxWidth:'100%',overflowX:'auto',verticalAlign:'middle'},'.cm-live-math .katex-display':{margin:'.6em 0'},
    '.cm-live-table':{display:'block',overflowX:'auto',padding:'8px 0'},'.cm-live-table table':{borderCollapse:'collapse',minWidth:'60%'},'.cm-live-table th, .cm-live-table td':{border:'1px solid var(--line-divider)',padding:'.4em .8em',textAlign:'left'},'.cm-live-table th':{background:'var(--page-bg)'},
    '.cm-live-task, .cm-live-bullet':{color:'var(--btn-content)',display:'inline-block',minWidth:'1em'},'.cm-live-task':{cursor:'pointer'}
  })];
}
