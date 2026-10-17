<script>
  import TableEditor from './TableEditor.svelte';
  import StudioMenu from './StudioMenu.svelte';
  import Icon from '../common/Icon.svelte';
  import {tableTarget,beginTable,endTable,readTable,emptyTable,applyTable} from './table-edit.mjs';
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
  import {outlineFor, formatEdit, imageEdit, writingPreferences, splitRatio, continueWriting, formatState} from './editor-tools.mjs';
  import {liveMarkdown,livePlan,safeLiveImage} from './live-markdown.mjs';
  import {imageAnchors,trackImage,forgetImage,imageTarget,replaceImage,imageMarkdown,imageUploads} from './image-workflow.mjs';
  export let resolveImage=href=>href;
  export let value='';
  export let preview='';
  export let disabled=false;
  export let uploading=false;
  export let onChange=()=>{};
  export let onUpload=async()=>{throw new Error('图片上传未配置');};
  export let onUploadState=()=>{};
  let uploadQueue,uploadJobs=[],imageListOpen=false,imageSettings=null,imageAlt='',imageError='';
  let images=[],tables=[],pickerTarget=null,tableSettings=null,tableError='',tableListOpen=false;
  $: plans=livePlan(value);
  $: images=plans.filter(item=>item.kind==='image');
  $: tables=plans.filter(item=>item.kind==='table'&&item.editable);
  let host,view,previewPane,panes;
  let verticalSplit=false,mobileOutline=false,dragPointer=null,dragStartRatio=50;
  let mode='live',preferencesOpen=false,prefs=writingPreferences(),language='python';
  let activeFormats={},headings=[],active=0,line=1,column=1,canUndo=false,canRedo=false;
  const editable=new Compartment(),appearance=new Compartment(),rendering=new Compartment();
  const storageKey='wonder-writing-preferences-v1';
  $: headings=outlineFor(value);
  $: if(view&&view.state.doc.toString()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});
  $: if(view)view.dispatch({effects:editable.reconfigure([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)])});
  function theme(){return EditorView.theme({
    '&':{height:'100%',color:'var(--studio-text)',backgroundColor:'var(--card-bg)',fontSize:'var(--writing-font)'},
    '&.cm-focused':{outline:'none'},
    '.cm-scroller':{overflow:'auto',fontFamily:mode==='live'?'inherit':'"JetBrains Mono Variable", ui-monospace, monospace',lineHeight:String(prefs.lineHeight)},
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
  async function setMode(next){mode=next;view?.dispatch({effects:[rendering.reconfigure(mode==='live'?liveMarkdown({resolveImage,onImage:openImage,onTable:openTable}):[]),appearance.reconfigure(theme())]});try{localStorage.setItem('wonder-writing-mode',mode);}catch{}await tick();view?.requestMeasure();}
  function resizeSplit(value){prefs={...prefs,splitRatio:splitRatio(value)};view?.requestMeasure();}
  function startResize(event){
    if(event.button!==0)return;
    event.preventDefault();event.currentTarget.focus();
    dragPointer=event.pointerId;dragStartRatio=prefs.splitRatio;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveResize(event){
    if(dragPointer!==event.pointerId)return;
    const rect=panes.getBoundingClientRect(),grip=event.currentTarget.getBoundingClientRect();
    const size=verticalSplit?rect.height-grip.height:rect.width-grip.width;
    if(size<=0)return;
    const offset=verticalSplit?event.clientY-rect.top-grip.height/2:event.clientX-rect.left-grip.width/2;
    resizeSplit(offset/size*100);
  }
  function endResize(event){
    if(dragPointer!==event.pointerId)return;
    dragPointer=null;
    if(event.type==='pointercancel')resizeSplit(dragStartRatio);
    storePreferences();
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function resetSplit(){resizeSplit(50);storePreferences();}
  function splitKey(event){
    const decrease=verticalSplit?'ArrowUp':'ArrowLeft',increase=verticalSplit?'ArrowDown':'ArrowRight';
    if(![decrease,increase,'Home','End','Enter'].includes(event.key))return;
    event.preventDefault();
    resizeSplit(event.key==='Home'?25:event.key==='End'?75:event.key==='Enter'?50:prefs.splitRatio+(event.key===decrease?-5:5));
    storePreferences();
  }
  function position(){
    const pos=view.state.selection.main.head,l=view.state.doc.lineAt(pos);
    line=l.number;column=pos-l.from+1;
    active=headings.reduce((last,h,i)=>h.from<=pos?i:last,-1);
    activeFormats=formatState(view.state);
    canUndo=undoDepth(view.state)>0;canRedo=redoDepth(view.state)>0;
  }
  async function format(kind){
    if(!view||disabled)return;
    if(mode==='preview')await setMode('live');
    view.dispatch({...formatEdit(view.state,kind,language),annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'input'});
    view.focus();
  }
  export async function insertText(text){
    if(!view||disabled)return;
    if(mode==='preview')await setMode('live');
    view.dispatch({...imageEdit(view.state,text),annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'input'});view.focus();
  }
  async function historyAction(command){
    if(mode==='preview')await setMode('live');
    command(view);view.focus();
  }
  $: outlineVisible=verticalSplit?mobileOutline:prefs.outline;
  function toggleOutline(){if(verticalSplit)mobileOutline=!mobileOutline;else{prefs.outline=!prefs.outline;storePreferences();}}
  function jump(h,i){
    if(verticalSplit)mobileOutline=false;
    active=i;
    if(mode==='preview'){previewPane?.querySelectorAll('h1,h2,h3,h4,h5,h6')[i]?.scrollIntoView({block:'start',behavior:'smooth'});return;}
    view.dispatch({selection:{anchor:h.from},effects:EditorView.scrollIntoView(h.from,{y:'start',yMargin:24})});view.focus();
  }
  async function find(){if(mode==='preview')await setMode('live');openSearchPanel(view);}
  function insertionTarget(position=view.state.selection.main.head){return {from:position,to:position};}
  function capturePicker(){
    if(!view||disabled)return;
    pickerTarget='image-picker';
    view.dispatch({effects:trackImage.of({id:pickerTarget,...insertionTarget()})});
  }
  function imageEvent(event){
    const files=[...(event.clipboardData?.files||event.dataTransfer?.files||[])].filter(f=>f.type.startsWith('image/'));
    if(!files.length)return false;
    event.preventDefault();
    if(disabled)return true;
    const point=event.type==='drop'?view.posAtCoords({x:event.clientX,y:event.clientY}):view.state.selection.main.head;
    if(point===null){imageError='请把图片拖到正文中的插入位置。';return true;}
    uploadQueue.enqueue(files,insertionTarget(point));return true;
  }
  function fileInput(event){
    const files=[...event.target.files];event.target.value='';if(!files.length||disabled)return;
    try{uploadQueue.enqueue(files,pickerTarget?imageTarget(view.state,pickerTarget):insertionTarget());}
    catch(error){imageError=error.message;}
    finally{if(pickerTarget)view.dispatch({effects:forgetImage.of(pickerTarget)});pickerTarget=null;}
  }
  function openImage(item){
    if(disabled)return;
    imageSettings={...item};imageAlt=item.alt;imageError='';imageListOpen=false;
    view.dispatch({effects:trackImage.of({id:'image-settings',from:item.from,to:item.to,source:view.state.sliceDoc(item.from,item.to)})});
  }
  function closeImage(){imageSettings=null;imageError='';view?.dispatch({effects:forgetImage.of('image-settings')});}
  function saveImage(remove=false){
    if(disabled||!imageSettings)return;
    try{view.dispatch(replaceImage(view.state,'image-settings',remove?'':imageMarkdown(imageAlt,imageSettings.src,imageSettings.title)));closeImage();}
    catch(error){imageError=error.message;}
  }
  function replaceFile(event){
    const file=event.target.files[0];event.target.value='';if(!file||disabled)return;
    try{uploadQueue.enqueue([file],{...imageTarget(view.state,'image-settings'),alt:imageAlt});closeImage();}
    catch(error){imageError=error.message;}
  }
  function editImageSource(){
    try{const target=imageTarget(view.state,'image-settings');view.dispatch({selection:{anchor:target.from+2},scrollIntoView:true});closeImage();view.focus();}
    catch(error){imageError=error.message;}
  }
  function openTable(item){
    if(disabled)return;
    tableError='';tableListOpen=false;
    const source=item?view.state.sliceDoc(item.from,item.to):'';
    const from=item?.from??view.state.selection.main.head,to=item?.to??from;
    tableSettings=item?readTable(source):emptyTable();
    view.dispatch({effects:beginTable.of({from,to,source,insert:!item})});
  }
  function closeTable(){tableSettings=null;tableError='';view?.dispatch({effects:endTable.of(true)});}
  function saveTable(table){
    if(disabled)return;
    try{view.dispatch(applyTable(view.state,table));closeTable();}
    catch(error){tableError=error.message;}
  }
  function insertAction(kind){if(kind==='table')openTable(null);else format(kind);}
  function materialAction(kind){if(imageSettings)closeImage();imageListOpen=kind==='images';tableListOpen=kind==='tables';}
  const headingOptions=[{value:'paragraph',label:'正文'},...[1,2,3,4,5,6].map(n=>({value:'heading'+n,label:'H'+n+' · '+n+' 级标题'}))];
  const listOptions=[{value:'bullet',label:'无序列表'},{value:'ordered',label:'有序列表'},{value:'task',label:'任务列表'}];
  const insertOptions=[{value:'code',label:'代码块'},{value:'inline',label:'行内代码'},{value:'formula',label:'数学公式'},{value:'table',label:'表格'},{value:'rule',label:'分隔线'},{value:'strike',label:'删除线'}];
  const zh={'Find':'查找','Replace':'替换','next':'下一处','previous':'上一处','all':'全选','match case':'区分大小写','regexp':'正则表达式','by word':'整词','replace':'替换','replace all':'全部替换','close':'关闭','Go to line':'跳转到行','go':'跳转'};
  onMount(()=>{
    try{prefs=writingPreferences(JSON.parse(localStorage.getItem(storageKey)||'{}'));}catch{}
    try{const savedMode=localStorage.getItem('wonder-writing-mode');if(['live','write','split','preview'].includes(savedMode))mode=savedMode;}catch{}
    const splitMedia=window.matchMedia('(max-width:700px)');
    const updateOrientation=()=>{verticalSplit=splitMedia.matches;};
    updateOrientation();splitMedia.addEventListener('change',updateOrientation);
    view=new EditorView({parent:host,state:EditorState.create({doc:value,extensions:[
      tableTarget,imageAnchors,history(),drawSelection(),highlightActiveLine(),EditorView.lineWrapping,rendering.of(mode==='live'?liveMarkdown({resolveImage,onImage:openImage,onTable:openTable}):[]),
      markdown({base:markdownLanguage,codeLanguages:languages,addKeymap:false}),bracketMatching(),closeBrackets(),indentUnit.of('  '),
      syntaxHighlighting(defaultHighlightStyle),syntaxHighlighting(HighlightStyle.define([
        {tag:tags.heading,color:'var(--btn-content)',fontWeight:'700',textDecoration:'none'},
        {tag:tags.strong,fontWeight:'700'},{tag:tags.emphasis,fontStyle:'italic'},
        {tag:tags.link,color:'var(--btn-content)',textDecoration:'underline'},
        {tag:tags.monospace,color:'var(--inline-code-color)'},
        {tag:tags.processingInstruction,color:'var(--content-meta)'}
      ])),
      search({top:true}),EditorState.phrases.of(zh),
      keymap.of([{key:'Enter',run:continueWriting},{key:'Mod-b',run:()=>{format('bold');return true;}},{key:'Mod-i',run:()=>{format('italic');return true;}},{key:'Mod-k',run:()=>{format('link');return true;}},...markdownKeymap,...closeBracketsKeymap,...defaultKeymap,...historyKeymap,...searchKeymap,indentWithTab]),
      placeholder('不必想好开头，先写下一句话。\n\n支持 Markdown、代码块和数学公式。'),
      EditorView.contentAttributes.of({'aria-label':'Markdown 正文',spellcheck:'false'}),
      editable.of([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)]),appearance.of(theme()),
      EditorView.domEventHandlers({paste:imageEvent,drop:imageEvent}),
      EditorView.updateListener.of(update=>{
        if(update.docChanged){const text=update.state.doc.toString();if(text!==value){value=text;onChange(text);}}
        if(update.docChanged||update.selectionSet)position();
      })
    ]})});
    uploadQueue=imageUploads({getState:()=>view.state,dispatch:tr=>view.dispatch(tr),upload:file=>onUpload(file),onUpdate:jobs=>{uploadJobs=jobs;onUploadState(jobs.some(j=>['queued','uploading'].includes(j.state)));}});
    position();return()=>{uploadQueue.close();onUploadState(false);splitMedia.removeEventListener('change',updateOrientation);view.destroy();view=null;};
  });
</script>

<div class="writing-workbench" style={`--writing-font:calc(${prefs.fontSize}px * var(--site-text-scale, 1));--writing-leading:${prefs.lineHeight}`}>
  <div class="writing-controls">
    <div class="view-modes" aria-label="编辑视图">
      <button class:chosen={mode==='live'} aria-pressed={mode==='live'} on:click={()=>setMode('live')}>即时渲染</button>
      <button class:chosen={mode==='write'} aria-pressed={mode==='write'} on:click={()=>setMode('write')}>源码</button>
      <button class:chosen={mode==='split'} aria-pressed={mode==='split'} on:click={()=>setMode('split')}>分屏</button>
      <button class:chosen={mode==='preview'} aria-pressed={mode==='preview'} on:click={()=>setMode('preview')}>预览</button>
    </div>
    <div class="reading-controls">
      <button aria-label="文章大纲" aria-pressed={outlineVisible} title="展开或收起文章大纲" on:click={toggleOutline}><Icon icon="material-symbols:format-list-bulleted-rounded"/><span>大纲</span></button>
      <button aria-label="排版设置" aria-expanded={preferencesOpen} on:click={()=>preferencesOpen=!preferencesOpen}><Icon icon="material-symbols:tune-rounded"/><span>排版</span></button>
      <button aria-label="查找与替换" title="查找与替换（⌘ / Ctrl + F）" on:click={find}><Icon icon="material-symbols:search"/><span>查找</span></button>
      <StudioMenu label="素材管理" toolbar icon="material-symbols:perm-media-outline-rounded" options={[{value:'images',label:'图片 · '+images.length},{value:'tables',label:'表格 · '+tables.length}]} onSelect={materialAction}/>
    </div>
  </div>
  {#if preferencesOpen}
    <section class="preferences" aria-label="排版设置">
      <div><span>字号</span><StudioMenu label="字号" toolbar align="left" value={prefs.fontSize} options={[16,18,20,22].map(n=>({value:n,label:n+' px'}))} onSelect={n=>{prefs.fontSize=n;storePreferences();}}/></div>
      <div><span>行距</span><StudioMenu label="行距" toolbar align="left" value={prefs.lineHeight} options={[{value:1.6,label:'紧凑'},{value:1.9,label:'舒适'},{value:2.2,label:'宽松'}]} onSelect={n=>{prefs.lineHeight=n;storePreferences();}}/></div>
      <div><span>宽度</span><StudioMenu label="正文宽度" toolbar align="left" value={prefs.wide} options={[{value:false,label:'标准'},{value:true,label:'宽屏'}]} onSelect={n=>{prefs.wide=n;storePreferences();}}/></div>
      <div><span>代码语言</span><StudioMenu label="默认代码语言" toolbar value={language} options={['python','javascript','typescript','cpp','cuda','bash','sql','json','yaml','text'].map(n=>({value:n,label:n}))} onSelect={n=>language=n}/></div>
      <button class="panel-close" aria-label="关闭排版设置" on:click={()=>preferencesOpen=false}><Icon icon="material-symbols:close-rounded"/></button>
    </section>
  {/if}
  <div class="format-bar" aria-label="Markdown 工具栏">
    <fieldset disabled={disabled}>
      <div class="tool-group" aria-label="编辑历史">
        <button title="撤销（⌘ / Ctrl + Z）" aria-label="撤销" disabled={!canUndo} on:click={()=>historyAction(undo)}><Icon icon="material-symbols:undo-rounded"/></button>
        <button title="重做（⌘ / Ctrl + Shift + Z）" aria-label="重做" disabled={!canRedo} on:click={()=>historyAction(redo)}><Icon icon="material-symbols:redo-rounded"/></button>
      </div>
      <div class="tool-group" aria-label="文字格式">
        <StudioMenu label="段落格式" toolbar align="left" value={activeFormats.heading||'paragraph'} options={headingOptions} {disabled} onSelect={format}/>
        <button aria-label="加粗" aria-pressed={!!activeFormats.bold} title="加粗（⌘ / Ctrl + B）" on:click={()=>format('bold')}><Icon icon="material-symbols:format-bold-rounded"/></button>
        <button aria-label="斜体" aria-pressed={!!activeFormats.italic} title="斜体（⌘ / Ctrl + I）" on:click={()=>format('italic')}><Icon icon="material-symbols:format-italic-rounded"/></button>
        <button aria-label="链接" title="链接（⌘ / Ctrl + K）" on:click={()=>format('link')}><Icon icon="material-symbols:link"/></button>
        <button aria-label="引用" aria-pressed={!!activeFormats.quote} title="切换引用" on:click={()=>format('quote')}><Icon icon="material-symbols:format-quote-rounded"/></button>
      </div>
      <div class="tool-group insert-tools" aria-label="插入内容">
        <StudioMenu label="列表格式" toolbar align="left" icon="material-symbols:format-list-bulleted-rounded" options={listOptions} {disabled} onSelect={format}/>
        <StudioMenu label="插入" toolbar align="left" icon="material-symbols:add-rounded" options={insertOptions} {disabled} onSelect={insertAction}/>
        <label class="image-upload" title="上传图片，也可以粘贴或拖入"><Icon icon="material-symbols:image-outline"/><span>图片</span><input type="file" aria-label="上传图片" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple disabled={disabled} on:click={capturePicker} on:change={fileInput}/></label>
      </div>
    </fieldset>
  </div>
  {#if tableSettings}<TableEditor initial={tableSettings} {disabled} error={tableError} onSave={saveTable} onCancel={closeTable}/>{/if}
  {#if tableListOpen}
    <section class="image-list" aria-label="正文表格"><strong>正文表格</strong><button on:click={()=>tableListOpen=false}>收起</button>
      {#each tables as item,i}<button on:click={()=>openTable(item)}>{i+1}. {item.rows[0].join(' / ')||'未命名表格'}</button>{:else}<span>还没有表格，可以点击工具栏插入。</span>{/each}
    </section>
  {/if}
  {#if uploadJobs.length}
    <section class="image-tasks" aria-label="图片上传任务">
      {#each uploadJobs as job (job.id)}
        <div class="image-task"><span class="image-name" title={job.name}>{job.name}</span><span aria-live="polite">{({queued:'等待上传',uploading:'上传中…',done:'已插入正文',failed:'上传未完成'})[job.state]}</span>
          {#if job.error}<span class="image-error">{job.error}</span>{/if}
          {#if job.state==='failed'}<button disabled={disabled} on:click={()=>uploadQueue.retry(job.id)}>重试</button>{/if}
          {#if ['done','failed'].includes(job.state)}<button aria-label={'关闭上传记录：'+job.name} on:click={()=>uploadQueue.dismiss(job.id)}>×</button>{/if}
        </div>
      {/each}
      {#if uploadJobs.some(job=>job.state==='failed')}<p>失败的图片可在本页重试；离开或刷新后需要重新选择文件。</p>{/if}
    </section>
  {/if}
  {#if imageError}<p class="image-error" role="alert">{imageError}</p>{/if}
  {#if imageListOpen}
    <section class="image-list" aria-label="正文图片">
      <strong>正文图片</strong><button on:click={()=>imageListOpen=false}>收起</button>
      {#each images as item,i}<button on:click={()=>openImage(item)}>{i+1}. {item.alt||'未填写说明的图片'}</button>{:else}<span>还没有图片，可以粘贴、拖入或点击“图片”上传。</span>{/each}
    </section>
  {/if}
  {#if imageSettings}
    <section class="image-settings" aria-label="图片设置">
      <div class="image-settings-heading"><strong>图片设置</strong><button aria-label="关闭图片设置" on:click={closeImage}>×</button></div>
      {#if safeLiveImage(resolveImage(imageSettings.src))}<img src={resolveImage(imageSettings.src)} alt={imageSettings.alt} referrerpolicy="no-referrer"/>{/if}
      <label>图片说明<input aria-label="图片说明" bind:value={imageAlt} disabled={disabled}/></label>
      <p>说明保存为 Markdown 的替代文本。从正文移除不会删除图片文件。</p>
      <div class="image-actions"><button disabled={disabled} on:click={()=>saveImage()}>保存说明</button><label class="image-upload">替换图片<input type="file" aria-label="替换图片" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" disabled={disabled} on:change={replaceFile}/></label><button disabled={disabled} on:click={()=>saveImage(true)}>从正文移除</button><button on:click={editImageSource}>编辑图片源码</button></div>
    </section>
  {/if}
  <div class="writing-body" class:with-outline={outlineVisible}>
    {#if outlineVisible}
      <aside class="outline" aria-label="文章大纲">
        <div class="outline-title">文章大纲 <small>{headings.length}</small><button aria-label="收起文章大纲" on:click={toggleOutline}><Icon icon="material-symbols:close-rounded"/></button></div>
        {#if headings.length}<nav>{#each headings as h,i}<button class:current={active===i} title={h.label} style={`padding-left:${12+(h.level-1)*12}px`} on:click={()=>jump(h,i)}>{h.label}</button>{/each}</nav>
        {:else}<p>用标题整理思路。<br/>输入 <code>## 空格</code><br/>或使用工具栏添加。</p>{/if}
        <div class="outline-tip">先记录，再打磨。<br/>每一个小节都算进展。</div>
      </aside>
    {/if}
    <div class="document-panes" class:split={mode==='split'} class:resizing={dragPointer!==null} class:preview-only={mode==='preview'} bind:this={panes} style={`--source-share:${prefs.splitRatio}fr;--preview-share:${100-prefs.splitRatio}fr`}>
      <div class="source-pane" class:hidden={mode==='preview'} bind:this={host}></div>
      {#if mode==='split'}
        <div class="split-handle" role="separator" tabindex="0" aria-label="调整编辑与预览比例" aria-orientation={verticalSplit?'horizontal':'vertical'} aria-valuemin="25" aria-valuemax="75" aria-valuenow={Math.round(prefs.splitRatio)} aria-valuetext={`编辑区 ${Math.round(prefs.splitRatio)}%，预览区 ${100-Math.round(prefs.splitRatio)}%`} title="拖动调整比例；双击或按 Enter 恢复均分" on:pointerdown={startResize} on:pointermove={moveResize} on:pointerup={endResize} on:pointercancel={endResize} on:lostpointercapture={endResize} on:keydown={splitKey} on:dblclick={resetSplit}></div>
      {/if}
      {#if mode==='split'||mode==='preview'}<article class="writing-preview" class:wide={prefs.wide} bind:this={previewPane} aria-label="文章预览">{#if value}<div>{@html preview}</div>{:else}<p class="preview-hint">你的文字，会在这里慢慢成形。</p>{/if}</article>{/if}
    </div>
  </div>
  <div class="writing-status"><span>{value.length.toLocaleString()} 字符 · 第 {line} 行，第 {column} 列</span><span class="keyboard-hint">{mode==='live'?'点击文字编辑语法':'Markdown'} · Tab 缩进 · Esc 后 Tab 离开编辑器</span><span>{uploading?'图片上传中…':'图片可粘贴或拖入'}</span></div>
</div>

<style>
.writing-workbench{color-scheme:light;display:flex;flex-direction:column;min-height:440px;height:100%;min-width:0;color:var(--studio-text);background:var(--card-bg);border:1px solid var(--line-divider);border-radius:12px;overflow:hidden}
button,select,.image-upload{font:inherit;font-size:13px;color:var(--content-meta);background:transparent;border:0;border-radius:6px;padding:7px 10px;cursor:pointer}
button:hover,.image-upload:hover{color:var(--btn-content);background:var(--btn-regular-bg)}
button:focus-visible,select:focus-visible,.image-upload:focus-within{outline:2px solid var(--primary);outline-offset:-2px}
button:disabled{opacity:.35;cursor:not-allowed}button[aria-pressed=true]{color:var(--btn-content)}
.writing-controls{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line-divider);flex-wrap:wrap}
.view-modes{display:flex;background:var(--page-bg);padding:3px;border-radius:8px}.view-modes button{min-width:62px}.view-modes .chosen{background:var(--card-bg);color:var(--btn-content);box-shadow:0 1px 4px #0001;font-weight:600}
.reading-controls{display:flex;gap:4px}.preferences{display:flex;gap:20px;align-items:center;flex-wrap:wrap;padding:10px 20px;background:var(--page-bg);font-size:13px}.preferences label{display:flex;align-items:center;gap:8px}.preferences select{background:var(--card-bg);border:1px solid var(--line-divider)}.preferences span{font-size:12px;color:var(--content-meta)}
.format-bar{border-bottom:1px solid var(--line-divider);padding:7px 12px;overflow:visible;flex-shrink:0}.format-bar fieldset{border:0;padding:0;margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}.format-bar button{display:flex;align-items:center;gap:5px}.format-bar select{max-width:100px}.divider{height:18px;border-left:1px solid var(--line-divider);margin:0 5px}.image-upload{white-space:nowrap;display:flex;align-items:center;gap:5px}.image-upload input{width:1px;height:1px;opacity:0;position:absolute}
.image-tasks,.image-list,.image-settings{flex-shrink:0;padding:10px 16px;border-bottom:1px solid var(--line-divider);background:var(--page-bg);font-size:13px;max-height:220px;overflow:auto}
.image-task,.image-settings-heading,.image-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.image-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.image-task>span:nth-child(2){color:var(--btn-content)}.image-task button{background:var(--card-bg)}.image-tasks p,.image-settings p{font-size:12px;color:var(--content-meta);margin:6px 0}.image-error{color:var(--studio-text);padding:4px 12px;border-left:3px solid var(--primary)}.image-list{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.image-list>button{background:var(--card-bg)}.image-settings-heading{justify-content:space-between;margin-bottom:8px}.image-settings>img{max-width:80px;max-height:70px;float:left;margin-right:12px;border-radius:6px}.image-settings label:not(.image-upload){display:flex;align-items:center;gap:10px}.image-settings input:not([type=file]){min-width:0;flex:1;background:var(--card-bg);color:var(--studio-text);border:1px solid var(--line-divider);border-radius:6px;padding:8px}.image-actions{clear:both;margin-top:8px}.image-actions button,.image-actions .image-upload{background:var(--btn-regular-bg);color:var(--btn-content)}
.writing-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr)}.writing-body.with-outline{grid-template-columns:190px minmax(0,1fr)}
.outline{outline:none;padding:24px 12px;background:color-mix(in srgb,var(--page-bg) 45%,var(--card-bg));border-right:1px solid var(--line-divider);overflow:auto;min-height:0}.outline-title{font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--content-meta);padding:0 12px 16px;display:flex;justify-content:space-between}.outline-title small{font-weight:400}.outline nav{display:flex;flex-direction:column;gap:4px}.outline button{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;line-height:1.6;padding:8px 12px}.outline button.current{color:var(--btn-content);background:var(--btn-regular-bg);font-weight:600}.outline p,.outline-tip{font-size:12px;color:var(--content-meta);line-height:2;padding:12px;opacity:.75}.outline-tip{margin-top:32px;border-top:1px solid var(--line-divider)}
.document-panes{display:grid;grid-template-columns:minmax(0,1fr);min-height:0;min-width:0;overflow:hidden}.document-panes.split{grid-template-columns:minmax(0,var(--source-share)) 12px minmax(0,var(--preview-share))}.source-pane{min-height:0;min-width:0;height:100%;overflow:hidden}.source-pane.hidden{display:none}.split-handle{background:var(--page-bg);border-inline:1px solid var(--line-divider);cursor:col-resize;touch-action:none;display:flex;align-items:center;justify-content:center;outline:none}.split-handle::after{content:"";width:3px;height:36px;border-radius:3px;background:var(--content-meta);opacity:.4}.split-handle:hover,.split-handle:focus-visible,.resizing .split-handle{background:var(--btn-regular-bg-hover)}.split-handle:focus-visible{box-shadow:inset 0 0 0 2px var(--primary)}.resizing{user-select:none}.resizing .source-pane,.resizing .writing-preview{pointer-events:none}
.writing-preview{overflow:auto;min-width:0;padding:28px clamp(18px,4vw,56px) 120px;font-size:var(--writing-font);line-height:var(--writing-leading);overflow-wrap:anywhere}.writing-preview>div{max-width:930px;margin:auto}.writing-preview.wide>div{max-width:none}.preview-hint{color:var(--content-meta)}
.writing-preview :global(h1),.writing-preview :global(h2),.writing-preview :global(h3){font-weight:700;line-height:1.5;scroll-margin-top:24px}.writing-preview :global(h1){font-size:1.8em;margin:0 0 1em}.writing-preview :global(h2){font-size:1.4em;margin:1.5em 0 .8em;border-bottom:1px solid var(--line-divider);padding-bottom:.4em}.writing-preview :global(h3){font-size:1.15em;margin:1.2em 0 .7em}.writing-preview :global(p){margin:.8em 0}.writing-preview :global(ul){list-style:disc;padding-left:1.6em}.writing-preview :global(ol){list-style:decimal;padding-left:1.6em}.writing-preview :global(blockquote){border-left:3px solid var(--primary);padding:.3em 1em;background:var(--btn-regular-bg);margin:1em 0}.writing-preview :global(pre){background:var(--codeblock-bg);color:#e1e8e5;padding:18px;overflow:auto;border-radius:8px;margin:1em 0}.writing-preview :global(code){font-family:'JetBrains Mono Variable',monospace;font-size:.88em;background:var(--inline-code-bg);color:var(--inline-code-color);padding:.1em .3em;border-radius:4px}.writing-preview :global(pre code){color:inherit;background:none;padding:0}.writing-preview :global(img){max-width:100%;height:auto;border-radius:8px}.writing-preview :global(table){display:block;overflow:auto;border-collapse:collapse;margin:1em 0}.writing-preview :global(th),.writing-preview :global(td){border:1px solid var(--line-divider);padding:.4em .8em}.writing-preview :global(a){color:var(--btn-content);text-decoration:underline}.writing-preview :global(.katex-display){overflow:auto}
.writing-status{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line-divider);padding:10px 18px;font-size:11px;color:var(--content-meta)}
@media(max-width:1100px){.keyboard-hint{display:none}.writing-body.with-outline{grid-template-columns:160px minmax(0,1fr)}}
@media(max-width:700px){.writing-workbench{min-height:320px}.writing-controls{padding:8px;gap:5px}.view-modes button{min-width:46px;padding:6px}.reading-controls{gap:0}.reading-controls button{font-size:12px;padding:6px}.format-bar{padding:5px}.writing-body.with-outline{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.outline{padding:8px;max-height:140px;border-right:0;border-bottom:1px solid var(--line-divider)}.outline-title{padding:4px 8px}.outline p{padding:4px 8px;margin:0}.outline p br,.outline-tip{display:none}.outline nav{display:flex;flex-direction:row;overflow-x:auto}.outline button{width:auto;max-width:220px;flex-shrink:0;padding-left:10px!important}.document-panes.split{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,var(--source-share)) 16px minmax(0,var(--preview-share))}.split-handle{cursor:row-resize;border-inline:0;border-block:1px solid var(--line-divider)}.split-handle::after{width:36px;height:3px}.writing-preview{padding:18px}.preferences{gap:8px;padding:8px}.preferences span{display:none}.writing-status{font-size:10px;padding:8px;gap:5px}.writing-status>span:last-child{display:none}}

.tool-group{display:flex;align-items:center;gap:2px}.tool-group+.tool-group{border-left:1px solid var(--line-divider);padding-left:8px}.format-bar button{width:34px;height:34px;justify-content:center;padding:6px}.format-bar button[aria-pressed=true]{background:var(--btn-regular-bg);box-shadow:inset 0 -2px var(--primary)}
.reading-controls{align-items:center}.reading-controls>button{display:flex;align-items:center;gap:5px;min-height:34px}.preferences{position:relative;overflow:visible;gap:12px;padding-right:42px}.preferences>div{display:flex;align-items:center;gap:4px}.preferences>div>span{font-size:12px;color:var(--content-meta)}.panel-close{position:absolute;right:8px;top:10px}
.writing-body{position:relative}.outline-title{align-items:center;gap:8px}.outline-title small{margin-left:auto}.outline-title>button{width:26px;height:26px;padding:4px;display:flex;justify-content:center}.outline-tip{display:none}
@media(max-width:700px){.writing-controls{gap:6px;align-items:center}.view-modes{flex:1;justify-content:space-between}.reading-controls{width:100%;justify-content:space-between}.reading-controls>button{min-height:36px;padding:7px 10px}.format-bar fieldset{gap:4px 0}.tool-group{gap:0}.tool-group+.tool-group{padding-left:4px;margin-left:4px}.tool-group.insert-tools{width:100%;border:0;margin:0;padding:0;justify-content:flex-start}.format-bar button{width:34px;min-height:36px}.image-upload{min-height:36px}.writing-body.with-outline{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr)}.outline{position:absolute;z-index:25;inset:0 auto 0 0;width:min(260px,85%);max-height:none;background:var(--card-bg);border-right:1px solid var(--line-divider);box-shadow:8px 0 24px #0002}.outline nav{flex-direction:column;overflow:visible}.outline nav button{width:100%;max-width:none;white-space:normal}.outline-title{padding:4px 8px}.preferences{gap:4px 12px}.preferences>div>span{display:inline}}
:global(.dark) .writing-workbench{color-scheme:dark}
</style>
