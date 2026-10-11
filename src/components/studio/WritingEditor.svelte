<script>
  import {onMount, tick} from 'svelte';
  import {EditorState, Compartment} from '@codemirror/state';
  import {EditorView, keymap, placeholder, drawSelection, highlightActiveLine} from '@codemirror/view';
  import {history, historyKeymap, defaultKeymap, indentWithTab, undo, redo, undoDepth, redoDepth, isolateHistory} from '@codemirror/commands';
  import {markdown, markdownLanguage, markdownKeymap} from '@codemirror/lang-markdown';
  import {languages} from '@codemirror/language-data';
  import {syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, indentUnit} from '@codemirror/language';
  import {closeBrackets, closeBracketsKeymap} from '@codemirror/autocomplete';
  import {search, searchKeymap, openSearchPanel} from '@codemirror/search';
  import {tags} from '@lezer/highlight';
  import {outlineFor, formatEdit, imageEdit, writingPreferences} from './editor-tools.mjs';
  export let value='';
  export let preview='';
  export let disabled=false;
  export let uploading=false;
  export let onChange=()=>{};
  export let onImages=()=>{};
  let host,view,previewPane;
  let mode='write',preferencesOpen=false,prefs=writingPreferences(),language='python';
  let headings=[],active=0,line=1,column=1,canUndo=false,canRedo=false;
  const editable=new Compartment(),appearance=new Compartment();
  const storageKey='wonder-writing-preferences-v1';
  $: headings=outlineFor(value);
  $: if(view&&view.state.doc.toString()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});
  $: if(view)view.dispatch({effects:editable.reconfigure([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)])});
  function theme(){return EditorView.theme({
    '&':{height:'100%',color:'var(--studio-text)',backgroundColor:'var(--card-bg)',fontSize:prefs.fontSize+'px'},
    '&.cm-focused':{outline:'none'},
    '.cm-scroller':{overflow:'auto',fontFamily:'"JetBrains Mono Variable", ui-monospace, monospace',lineHeight:String(prefs.lineHeight)},
    '.cm-content':{maxWidth:prefs.wide?'none':'1040px',width:'100%',margin:'0 auto',padding:'28px clamp(18px, 4vw, 56px) 160px',minHeight:'100%'},
    '.cm-line':{padding:'0'},
    '.cm-cursor':{borderLeftColor:'var(--primary)'},
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'var(--btn-regular-bg-hover)'},
    '.cm-activeLine':{backgroundColor:'color-mix(in srgb, var(--primary) 5%, transparent)'},
    '.cm-placeholder':{color:'var(--content-meta)',whiteSpace:'pre-wrap'},
    '.cm-panels':{backgroundColor:'var(--card-bg)',color:'var(--studio-text)',borderColor:'var(--line-divider)'},
    '.cm-search':{padding:'12px',fontSize:'14px'},
    '.cm-textfield':{background:'var(--card-bg)',color:'var(--studio-text)',border:'1px solid var(--line-divider)',borderRadius:'5px',padding:'5px'},
    '.cm-button':{background:'var(--btn-regular-bg)',color:'var(--btn-content)',border:'none',borderRadius:'5px',padding:'5px 10px'},
    '.cm-searchMatch':{background:'var(--btn-regular-bg-hover)'},
    '.cm-searchMatch-selected':{outline:'1px solid var(--primary)'}
  });}
  function storePreferences(){
    prefs=writingPreferences(prefs);
    try{localStorage.setItem(storageKey,JSON.stringify(prefs));}catch{}
    view?.dispatch({effects:appearance.reconfigure(theme())});
  }
  async function setMode(next){mode=next;await tick();view?.requestMeasure();}
  function position(){
    const pos=view.state.selection.main.head,l=view.state.doc.lineAt(pos);
    line=l.number;column=pos-l.from+1;
    active=headings.reduce((last,h,i)=>h.from<=pos?i:last,-1);
    canUndo=undoDepth(view.state)>0;canRedo=redoDepth(view.state)>0;
  }
  async function format(kind){
    if(!view||disabled)return;
    if(mode==='preview')await setMode('write');
    view.dispatch({...formatEdit(view.state,kind,language),annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'input'});
    view.focus();
  }
  export async function insertText(text){
    if(!view||disabled)return;
    if(mode==='preview')await setMode('write');
    view.dispatch({...imageEdit(view.state,text),annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'input'});view.focus();
  }
  async function historyAction(command){
    if(mode==='preview')await setMode('write');
    command(view);view.focus();
  }
  function jump(h,i){
    active=i;
    if(mode==='preview'){previewPane?.querySelectorAll('h1,h2,h3,h4,h5,h6')[i]?.scrollIntoView({block:'start',behavior:'smooth'});return;}
    view.dispatch({selection:{anchor:h.from},effects:EditorView.scrollIntoView(h.from,{y:'start',yMargin:24})});view.focus();
  }
  async function find(){if(mode==='preview')await setMode('write');openSearchPanel(view);}
  function imageEvent(event){
    const files=[...(event.clipboardData?.files||event.dataTransfer?.files||[])].filter(f=>f.type.startsWith('image/'));
    if(!files.length)return false;
    event.preventDefault();if(!disabled&&!uploading)onImages(files);return true;
  }
  function fileInput(event){const files=[...event.target.files];event.target.value='';onImages(files);}
  const zh={'Find':'查找','Replace':'替换','next':'下一处','previous':'上一处','all':'全选','match case':'区分大小写','regexp':'正则表达式','by word':'整词','replace':'替换','replace all':'全部替换','close':'关闭','Go to line':'跳转到行','go':'跳转'};
  onMount(()=>{
    try{prefs=writingPreferences(JSON.parse(localStorage.getItem(storageKey)||'{}'));}catch{}
    view=new EditorView({parent:host,state:EditorState.create({doc:value,extensions:[
      history(),drawSelection(),highlightActiveLine(),EditorView.lineWrapping,
      markdown({base:markdownLanguage,codeLanguages:languages}),bracketMatching(),closeBrackets(),indentUnit.of('  '),
      syntaxHighlighting(defaultHighlightStyle),syntaxHighlighting(HighlightStyle.define([
        {tag:tags.heading,color:'var(--btn-content)',fontWeight:'700'},
        {tag:tags.strong,fontWeight:'700'},{tag:tags.emphasis,fontStyle:'italic'},
        {tag:tags.link,color:'var(--btn-content)',textDecoration:'underline'},
        {tag:tags.monospace,color:'var(--inline-code-color)'},
        {tag:tags.processingInstruction,color:'var(--content-meta)'}
      ])),
      search({top:true}),EditorState.phrases.of(zh),
      keymap.of([{key:'Mod-b',run:()=>{format('bold');return true;}},{key:'Mod-i',run:()=>{format('italic');return true;}},{key:'Mod-k',run:()=>{format('link');return true;}},...markdownKeymap,...closeBracketsKeymap,...defaultKeymap,...historyKeymap,...searchKeymap,indentWithTab]),
      placeholder('不必想好开头，先写下一句话。\n\n支持 Markdown、代码块和数学公式。'),
      EditorView.contentAttributes.of({'aria-label':'Markdown 正文',spellcheck:'false'}),
      editable.of([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)]),appearance.of(theme()),
      EditorView.domEventHandlers({paste:imageEvent,drop:imageEvent}),
      EditorView.updateListener.of(update=>{
        if(update.docChanged){const text=update.state.doc.toString();if(text!==value){value=text;onChange(text);}}
        if(update.docChanged||update.selectionSet)position();
      })
    ]})});
    position();return()=>{view.destroy();view=null;};
  });
</script>

<div class="writing-workbench" style={`--writing-font:${prefs.fontSize}px;--writing-leading:${prefs.lineHeight}`}>
  <div class="writing-controls">
    <div class="view-modes" aria-label="编辑视图">
      <button class:chosen={mode==='write'} aria-pressed={mode==='write'} on:click={()=>setMode('write')}>编辑</button>
      <button class:chosen={mode==='split'} aria-pressed={mode==='split'} on:click={()=>setMode('split')}>分屏</button>
      <button class:chosen={mode==='preview'} aria-pressed={mode==='preview'} on:click={()=>setMode('preview')}>预览</button>
    </div>
    <div class="reading-controls">
      <button aria-pressed={prefs.outline} on:click={()=>{prefs.outline=!prefs.outline;storePreferences();}}>☷ 大纲</button>
      <button aria-expanded={preferencesOpen} on:click={()=>preferencesOpen=!preferencesOpen}>Aa 排版</button>
      <button title="查找与替换（⌘ / Ctrl + F）" on:click={find}>⌕ 查找</button>
    </div>
  </div>
  {#if preferencesOpen}
    <div class="preferences">
      <label>字号<select bind:value={prefs.fontSize} on:change={storePreferences}>{#each [16,18,20,22] as n}<option value={n}>{n} px</option>{/each}</select></label>
      <label>行距<select bind:value={prefs.lineHeight} on:change={storePreferences}><option value={1.6}>紧凑</option><option value={1.9}>舒适</option><option value={2.2}>宽松</option></select></label>
      <label>正文宽度<select bind:value={prefs.wide} on:change={storePreferences}><option value={false}>标准</option><option value={true}>宽屏</option></select></label>
      <span>自动记住这台设备的偏好</span>
    </div>
  {/if}
  <div class="format-bar" aria-label="Markdown 工具栏">
    <fieldset disabled={disabled}>
      <button title="撤销（⌘ / Ctrl + Z）" aria-label="撤销" disabled={!canUndo} on:click={()=>historyAction(undo)}>↶</button>
      <button title="重做（⌘ / Ctrl + Shift + Z）" aria-label="重做" disabled={!canRedo} on:click={()=>historyAction(redo)}>↷</button>
      <span class="divider"></span>
      <select aria-label="插入标题" on:change={e=>{if(e.target.value)format(e.target.value);e.target.value='';}}><option value="">标题 ▾</option>{#each [1,2,3,4] as n}<option value={'heading'+n}>H{n} · {n} 级标题</option>{/each}</select>
      <button title="加粗（⌘ / Ctrl + B）" on:click={()=>format('bold')}><b>B</b><span>加粗</span></button>
      <button title="斜体（⌘ / Ctrl + I）" on:click={()=>format('italic')}><i>I</i><span>斜体</span></button>
      <button title="引用" on:click={()=>format('quote')}>❝<span>引用</span></button>
      <button title="无序列表" on:click={()=>format('bullet')}>≡<span>列表</span></button>
      <button title="有序列表" on:click={()=>format('ordered')}>1.<span>编号</span></button>
      <button title="任务列表" on:click={()=>format('task')}>☑<span>待办</span></button>
      <button title="链接（⌘ / Ctrl + K）" on:click={()=>format('link')}>↗<span>链接</span></button>
      <span class="divider"></span>
      <button title="插入代码块" on:click={()=>format('code')}>〈/〉<span>代码</span></button>
      <select aria-label="代码语言" bind:value={language}>{#each ['python','javascript','typescript','cpp','cuda','bash','sql','json','yaml','text'] as lang}<option value={lang}>{lang}</option>{/each}</select>
      <button title="数学公式" on:click={()=>format('formula')}>ƒx<span>公式</span></button>
      <button title="插入表格" on:click={()=>format('table')}>▦<span>表格</span></button>
      <label class="image-upload">▧ 图片<input type="file" aria-label="上传图片" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple disabled={uploading||disabled} on:change={fileInput}/></label>
    </fieldset>
  </div>
  <div class="writing-body" class:with-outline={prefs.outline}>
    {#if prefs.outline}
      <aside class="outline" aria-label="文章大纲">
        <div class="outline-title">文章大纲 <small>{headings.length}</small></div>
        {#if headings.length}<nav>{#each headings as h,i}<button class:current={active===i} title={h.label} style={`padding-left:${12+(h.level-1)*12}px`} on:click={()=>jump(h,i)}>{h.label}</button>{/each}</nav>
        {:else}<p>用标题整理思路。<br/>输入 <code>## 空格</code><br/>或使用工具栏添加。</p>{/if}
        <div class="outline-tip">先记录，再打磨。<br/>每一个小节都算进展。</div>
      </aside>
    {/if}
    <div class="document-panes" class:split={mode==='split'} class:preview-only={mode==='preview'}>
      <div class="source-pane" class:hidden={mode==='preview'} bind:this={host}></div>
      {#if mode!=='write'}<article class="writing-preview" class:wide={prefs.wide} bind:this={previewPane} aria-label="文章预览">{#if value}<div>{@html preview}</div>{:else}<p class="preview-hint">你的文字，会在这里慢慢成形。</p>{/if}</article>{/if}
    </div>
  </div>
  <div class="writing-status"><span>{value.length.toLocaleString()} 字符 · 第 {line} 行，第 {column} 列</span><span class="keyboard-hint">Markdown · Tab 缩进 · Esc 后 Tab 离开编辑器</span><span>{uploading?'图片上传中…':'图片可粘贴或拖入'}</span></div>
</div>

<style>
.writing-workbench{display:flex;flex-direction:column;min-height:440px;height:100%;min-width:0;color:var(--studio-text);background:var(--card-bg);border:1px solid var(--line-divider);border-radius:12px;overflow:hidden}
button,select,.image-upload{font:inherit;font-size:13px;color:var(--content-meta);background:transparent;border:0;border-radius:6px;padding:7px 10px;cursor:pointer}
button:hover,.image-upload:hover{color:var(--btn-content);background:var(--btn-regular-bg)}
button:focus-visible,select:focus-visible,.image-upload:focus-within{outline:2px solid var(--primary);outline-offset:-2px}
button:disabled{opacity:.35;cursor:not-allowed}button[aria-pressed=true]{color:var(--btn-content)}
.writing-controls{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line-divider);flex-wrap:wrap}
.view-modes{display:flex;background:var(--page-bg);padding:3px;border-radius:8px}.view-modes button{min-width:62px}.view-modes .chosen{background:var(--card-bg);color:var(--btn-content);box-shadow:0 1px 4px #0001;font-weight:600}
.reading-controls{display:flex;gap:4px}.preferences{display:flex;gap:20px;align-items:center;flex-wrap:wrap;padding:10px 20px;background:var(--page-bg);font-size:13px}.preferences label{display:flex;align-items:center;gap:8px}.preferences select{background:var(--card-bg);border:1px solid var(--line-divider)}.preferences span{font-size:12px;color:var(--content-meta)}
.format-bar{border-bottom:1px solid var(--line-divider);padding:7px 12px;overflow-x:auto;flex-shrink:0}.format-bar fieldset{border:0;padding:0;margin:0;display:flex;align-items:center;gap:2px;min-width:max-content}.format-bar button{display:flex;align-items:center;gap:5px}.format-bar select{max-width:100px}.divider{height:18px;border-left:1px solid var(--line-divider);margin:0 5px}.image-upload{white-space:nowrap;display:flex;align-items:center;gap:5px}.image-upload input{width:1px;height:1px;opacity:0;position:absolute}
.writing-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr)}.writing-body.with-outline{grid-template-columns:190px minmax(0,1fr)}
.outline{padding:24px 12px;background:color-mix(in srgb,var(--page-bg) 45%,var(--card-bg));border-right:1px solid var(--line-divider);overflow:auto;min-height:0}.outline-title{font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--content-meta);padding:0 12px 16px;display:flex;justify-content:space-between}.outline-title small{font-weight:400}.outline nav{display:flex;flex-direction:column;gap:4px}.outline button{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;line-height:1.6;padding:8px 12px}.outline button.current{color:var(--btn-content);background:var(--btn-regular-bg);font-weight:600}.outline p,.outline-tip{font-size:12px;color:var(--content-meta);line-height:2;padding:12px;opacity:.75}.outline-tip{margin-top:32px;border-top:1px solid var(--line-divider)}
.document-panes{display:grid;grid-template-columns:minmax(0,1fr);min-height:0;min-width:0;overflow:hidden}.document-panes.split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.source-pane{min-height:0;min-width:0;height:100%;overflow:hidden}.source-pane.hidden{display:none}.split .source-pane{border-right:1px solid var(--line-divider)}
.writing-preview{overflow:auto;min-width:0;padding:28px clamp(18px,4vw,56px) 120px;font-size:var(--writing-font);line-height:var(--writing-leading);overflow-wrap:anywhere}.writing-preview>div{max-width:930px;margin:auto}.writing-preview.wide>div{max-width:none}.preview-hint{color:var(--content-meta)}
.writing-preview :global(h1),.writing-preview :global(h2),.writing-preview :global(h3){font-weight:700;line-height:1.5;scroll-margin-top:24px}.writing-preview :global(h1){font-size:1.8em;margin:0 0 1em}.writing-preview :global(h2){font-size:1.4em;margin:1.5em 0 .8em;border-bottom:1px solid var(--line-divider);padding-bottom:.4em}.writing-preview :global(h3){font-size:1.15em;margin:1.2em 0 .7em}.writing-preview :global(p){margin:.8em 0}.writing-preview :global(ul){list-style:disc;padding-left:1.6em}.writing-preview :global(ol){list-style:decimal;padding-left:1.6em}.writing-preview :global(blockquote){border-left:3px solid var(--primary);padding:.3em 1em;background:var(--btn-regular-bg);margin:1em 0}.writing-preview :global(pre){background:var(--codeblock-bg);color:#e1e8e5;padding:18px;overflow:auto;border-radius:8px;margin:1em 0}.writing-preview :global(code){font-family:'JetBrains Mono Variable',monospace;font-size:.88em;background:var(--inline-code-bg);color:var(--inline-code-color);padding:.1em .3em;border-radius:4px}.writing-preview :global(pre code){color:inherit;background:none;padding:0}.writing-preview :global(img){max-width:100%;height:auto;border-radius:8px}.writing-preview :global(table){display:block;overflow:auto;border-collapse:collapse;margin:1em 0}.writing-preview :global(th),.writing-preview :global(td){border:1px solid var(--line-divider);padding:.4em .8em}.writing-preview :global(a){color:var(--btn-content);text-decoration:underline}.writing-preview :global(.katex-display){overflow:auto}
.writing-status{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line-divider);padding:10px 18px;font-size:11px;color:var(--content-meta)}
@media(max-width:1100px){.format-bar button span{display:none}.keyboard-hint{display:none}.writing-body.with-outline{grid-template-columns:160px minmax(0,1fr)}}
@media(max-width:700px){.writing-workbench{min-height:320px}.writing-controls{padding:8px;gap:5px}.view-modes button{min-width:46px;padding:6px}.reading-controls{gap:0}.reading-controls button{font-size:12px;padding:6px}.format-bar{padding:5px}.writing-body.with-outline{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.outline{padding:8px;max-height:140px;border-right:0;border-bottom:1px solid var(--line-divider)}.outline-title{padding:4px 8px}.outline p{padding:4px 8px;margin:0}.outline p br,.outline-tip{display:none}.outline nav{display:flex;flex-direction:row;overflow-x:auto}.outline button{width:auto;max-width:220px;flex-shrink:0;padding-left:10px!important}.document-panes.split{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}.split .source-pane{border-right:0;border-bottom:1px solid var(--line-divider)}.writing-preview{padding:18px}.preferences{gap:8px;padding:8px}.preferences span{display:none}.writing-status{font-size:10px;padding:8px;gap:5px}.writing-status>span:last-child{display:none}}
</style>
