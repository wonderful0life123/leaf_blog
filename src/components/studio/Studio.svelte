<script>
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import katex from 'katex';
  import 'katex/dist/katex.min.css';
  export let articles = [];
  export let notes = [];
  export let assetMap = {};
  export let serverMode = false;
  let account = null, authNeeded = false, loginError = "";
  $: storageLabel = serverMode ? "服务器" : "本机";
  let drafts = [], items = [], loading = true, busy = false, uploading = false;
  let screen = 'home', filter = 'all', search = '', current = null;
  let dialog = '', noteQuery = '', folder = 'all', selected = null, notice = '', saved = '';
  let focused = true, settingsOpen = false;
  let mode = 'write', publishing = false, timer, toastTimer;
  let dirty = false, saving = false, saveError = '', conflict = false, editVersion = 0, saveTask = null;
  let recoveryWarning = '', loadError = '';
  $: folders = [...new Set(notes.map(n=>n.folder))].sort();
  const sourcePairs = {'AI Infra/cuda/全局位置计算.md':'ai-infra/cuda/global-indexing.md','AI Infra/cuda/element wise算子.md':'ai-infra/cuda/element-wise.md','AI Infra/cuda/参考资料.md':'ai-infra/cuda/references.md','AI Infra/telilang/TileLang-ascend.md':'ai-infra/telilang/tilelang-ascend.md'};
  const normalize = d => ({...d, root:d.source?.root||'blog',path:d.source?.path||'',noteId:d.source?.root==='notes'?d.source.path:undefined});
  $: items = [...drafts, ...articles.filter(a=>!drafts.some(d=>d.source?.root==='blog'&&d.source.path===a.path))];
  $: filtered = items.filter(a=>(filter==='all'||(filter==='draft'?a.status==='draft':a.status==='published')) && (a.title+' '+a.category).toLowerCase().includes(search.toLowerCase()));
  $: found = notes.filter(n=>(folder==='all'||n.folder===folder) && (n.title+' '+n.folder).toLowerCase().includes(noteQuery.toLowerCase()));
  $: draftCount = items.filter(a=>a.status==='draft').length;
  $: preview = current ? markdown(current.body,current) : '';
  $: notePreview = selected ? markdown(selected.body,selected) : '';
  function portal(node) { document.body.appendChild(node);return {destroy(){node.remove();}}; }
  function editorPortal(node, enabled) {
    const marker=document.createComment('writing-editor');
    node.before(marker);
    let previousOverflow;
    function update(active) {
      if(active && node.parentNode!==document.body) {
        previousOverflow=document.body.style.overflow;
        document.body.style.overflow='hidden';
        document.body.appendChild(node);
      } else if(!active && node.parentNode===document.body) {
        marker.after(node);
        document.body.style.overflow=previousOverflow??'';
      }
    }
    update(enabled);
    return {update,destroy(){if(node.parentNode===document.body){document.body.style.overflow=previousOverflow??'';node.remove();}marker.remove();}};
  }
  function toast(text) { notice=text; clearTimeout(toastTimer); toastTimer=setTimeout(()=>notice='',4500); }
  function keydown(e) { if(e.key==='Escape')dialog='';if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();persist();} }
  async function request(url,options={}) {
    const response=await fetch('/studio-api'+url+'/',{...options,signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok){if(serverMode&&response.status===401)authNeeded=true;const e=new Error(result.error||'请求失败');e.status=response.status;throw e;}
    return result;
  }
  const payload = d => ({title:d.title,body:d.body,category:d.category,tags:d.tags,revision:d.revision});
  const recoveryKey = id => 'wonder-draft-recovery:'+id;
  function backupLocal() {
    if(!current)return;
    try{sessionStorage.setItem(recoveryKey(current.id),JSON.stringify({...payload(current),id:current.id}));recoveryWarning='';}
    catch{recoveryWarning='浏览器临时恢复空间不足，请等待'+storageLabel+'保存完成后再离开。';}
  }
  function clearRecovery(id){try{sessionStorage.removeItem(recoveryKey(id));}catch{}}
  function remember(d){drafts=[normalize(d),...drafts.filter(a=>a.id!==d.id)];}
  function address(id){const url=new URL(location.href);if(id)url.searchParams.set('draft',id);else url.searchParams.delete('draft');history.replaceState({},'',url);}
  async function initialize() {
    loading=true;loadError='';
    if(serverMode){const code=new URL(location.href).searchParams.get('loginError');loginError={denied:'这个 GitHub 账号没有写作权限，请切换到博客主人的账号。',unavailable:'GitHub 暂时无法连接，请稍后重新登录。',busy:'登录尝试较多，请稍后再试。',expired:'登录已取消或验证过期，请重新开始。'}[code]||'';}
    try {
      if(serverMode){account=(await request('/session')).user;authNeeded=false;const catalog=await request('/catalog');articles=catalog.articles;notes=catalog.notes;assetMap=catalog.assetMap;}
      drafts=(await request('/drafts')).drafts.map(normalize);
      const id=new URL(location.href).searchParams.get('draft');
      if(id){const draft=drafts.find(d=>d.id===id);if(draft)open(draft);else{address(null);loadError='找不到之前打开的草稿，请从列表选择。';}}
    }catch(e){if(serverMode&&e.status===401){account=null;}else loadError='无法读取草稿，请确认保存服务已启动后重试。';}
    finally{loading=false;}
  }
  onMount(()=>{
    initialize();
    const beforeUnload=e=>{if(dirty||saving||uploading){e.preventDefault();e.returnValue='';}};
    const visibility=()=>{if(document.visibilityState==='hidden'&&dirty&&!conflict)persist();};
    const leave=async e=>{
      const a=e.target.closest?.('a[href]');if(!a||a.hasAttribute('download')||a.hasAttribute('data-auth-link')||(!dirty&&!saving&&!uploading))return;
      e.preventDefault();e.stopImmediatePropagation();
      if(uploading){toast('图片正在保存，请稍候。');return;}
      if(await persist())location.assign(a.href);
    };
    window.addEventListener('beforeunload',beforeUnload);
    document.addEventListener('visibilitychange',visibility);
    document.addEventListener('click',leave,true);
    return ()=>{clearTimeout(timer);clearTimeout(toastTimer);window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('click',leave,true);};
  });
  function open(draft) {
    current={...normalize(draft)};screen='editor';dirty=false;conflict=false;saveError='';editVersion=0;
    saved='已保存到'+storageLabel+' · '+new Date(current.updatedAt).toLocaleTimeString('zh-CN');address(current.id);
    try {
      const recovery=JSON.parse(sessionStorage.getItem(recoveryKey(current.id))||'null');
      if(recovery&&['title','body','category','tags'].every(k=>typeof recovery[k]==='string')) {
        if(JSON.stringify(payload(current))===JSON.stringify({title:recovery.title,body:recovery.body,category:recovery.category,tags:recovery.tags,revision:recovery.revision})){clearRecovery(current.id);return;}
        const versionMatches=recovery.revision===current.revision;
        current={...current,title:recovery.title,body:recovery.body,category:recovery.category,tags:recovery.tags};dirty=true;editVersion++;
        if(versionMatches){saved='恢复了未保存的编辑，正在保存…';timer=setTimeout(persist,100);}
        else {conflict=true;saveError='已恢复上次未保存的文字，但'+storageLabel+'已有新版。请先另存副本，避免覆盖。';saved='有待处理的版本冲突';}
      }
    }catch{recoveryWarning='无法读取浏览器恢复副本，当前显示'+storageLabel+'已保存版本。';}
  }
  async function edit(a) {
    if(loading||busy||uploading)return;
    if(!(await persist()))return;
    if(a.persisted){busy=true;try{open((await request('/drafts/'+a.id)).draft);}catch(e){toast(e.message);}finally{busy=false;}return;}
    busy=true;
    try {
      const draft=(await request('/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload(a),id:crypto.randomUUID(),source:{root:a.root,path:a.path}})})).draft;
      remember(draft);open(draft);toast('已保存为'+storageLabel+'编辑副本，博客原文保持不变。');
    }catch(e){toast(e.message);}finally{busy=false;}
  }
  async function create() {
    if(loading||busy||uploading||!(await persist()))return;
    busy=true;
    try {const draft=(await request('/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),title:'',body:'',category:'',tags:''})})).draft;remember(draft);open(draft);}
    catch(e){toast(e.message);}finally{busy=false;}
  }
  async function persist() {
    clearTimeout(timer);
    if(saveTask)return saveTask;
    if(!current||!dirty)return true;
    if(conflict)return false;
    saveTask=(async()=>{
      saving=true;saveError='';
      try {
        while(dirty) {
          const snapshot={...current},version=editVersion;saved='正在保存到'+storageLabel+'…';
          const {draft}=await request('/drafts/'+snapshot.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(snapshot))});
          current={...current,revision:draft.revision,assets:draft.assets,updatedAt:draft.updatedAt};remember(draft);
          if(editVersion===version){dirty=false;clearRecovery(current.id);saved='已保存到'+storageLabel+' · '+new Date(draft.updatedAt).toLocaleTimeString('zh-CN');}
          else backupLocal();
        }
        return true;
      }catch(e){conflict=e.status===409;saveError=e.message||'保存失败，请检查服务后重试';saved=conflict?'版本冲突 · 尚未保存':'保存失败 · 修改仍在当前页面';backupLocal();return false;}
      finally{saving=false;}
    })();
    const result=await saveTask;saveTask=null;return result;
  }
  function changed() {dirty=true;editVersion++;saved='有修改，等待保存…';queueMicrotask(backupLocal);clearTimeout(timer);if(!conflict)timer=setTimeout(persist,600);}
  async function home() {if(busy)return;if(uploading){toast('图片正在保存，请稍候。');return;}if(await persist()){screen='home';current=null;address(null);}}
  function insert(text) {if(!current||busy)return;current.body+=(current.body?'\n\n':'')+text;changed();}
  function category(p) {return p==='.'?'':p.replace(/^AI Infra/,'AI infra').replace(/\/tilelang-puzzles$/,'/TileLang Puzzles');}
  async function importNote() {
    if(!selected||busy||uploading)return;
    if(!(await persist())){dialog='';return;}
    const match=items.find(a=>a.noteId===selected.id||a.id===sourcePairs[selected.id]||(a.source?.root==='blog'&&a.source.path===sourcePairs[selected.id]));
    if(match){dialog='';await edit(match);return;}
    busy=true;
    try {
      const draft=(await request('/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),title:selected.title,body:selected.body,category:category(selected.folder),tags:'',source:{root:'notes',path:selected.path}})})).draft;
      remember(draft);open(draft);dialog='';toast('笔记和引用图片已保存到'+storageLabel+'草稿。');
    }catch(e){toast(e.message);}finally{busy=false;}
  }
  async function saveCopy() {
    if(busy)return;busy=true;
    try {
      const {draft}=await request('/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload(current),id:crypto.randomUUID(),title:(current.title||'未命名文章')+'（冲突副本）',copyFrom:current.id})});
      clearRecovery(current.id);remember(draft);open(draft);toast('你的修改已另存为新草稿，原草稿未被覆盖。');
    }catch(e){toast(e.message);}finally{busy=false;}
  }
  function showImport(){if(busy||uploading)return;noteQuery='';folder='all';selected=notes.find(n=>n.id.includes('Puzzle 01'))||notes[0];dialog='import';}
  function exportFile(){const text='---\ntitle: '+JSON.stringify(current.title||'未命名文章')+'\ncategory: '+JSON.stringify(current.category)+'\ntags: '+JSON.stringify(current.tags.split(/[,，]/).map(x=>x.trim()).filter(Boolean))+'\npublished: '+new Date().toISOString().slice(0,10)+'\ndraft: true\n---\n\n'+current.body;const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=(current.title||'未命名文章').replace(/[\\/:*?"<>|]/g,'-')+'.md';a.click();URL.revokeObjectURL(url);toast('正文已导出，图片保存在'+storageLabel+'草稿库中。');}
  async function publish(){if(busy||uploading)return;if(await persist()){dialog='publish';}}
  async function uploadFiles(files) {
    if(!current||uploading||busy)return;uploading=true;
    try {
      for(const file of files){
        if(file.size>10*1024*1024)throw new Error('每张图片最多 10 MB');
        const result=await request('/media',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
        insert(`![${file.name.replace(/[\[\]]/g,'')}](${result.url})`);
      }
      if(await persist())toast('图片与正文已保存到'+storageLabel+'。');
    }catch(e){toast(e.message);}finally{uploading=false;}
  }
  async function upload(e){const files=[...e.target.files||[]];e.target.value='';await uploadFiles(files);}
  function paste(e){const files=[...e.clipboardData?.files||[]].filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();uploadFiles(files);}}
  async function reauthenticate(){try{account=(await request('/session')).user;authNeeded=false;await persist();}catch(e){toast('请先在新窗口完成 GitHub 登录，再重试。');}}
  async function logout(){if(uploading||busy||!(await persist()))return;try{await request('/logout',{method:'POST'});for(const key of Object.keys(sessionStorage))if(key.startsWith('wonder-draft-recovery:'))sessionStorage.removeItem(key);current=null;drafts=[];notes=[];articles=[];account=null;dialog='';location.assign('/studio/');}catch(e){toast(e.message);}}
  function status(a){return a.persisted?storageLabel+'草稿':a.status==='published'?'已发布':'仓库草稿';}
  function markdown(raw,a){
    if(typeof document==='undefined')return '';
    const renderer=new marked.Renderer();
    renderer.image=({href,text})=>{
      let src=a.assets?.[href]||href;
      if(!/^(https?:|\/studio-api\/media\/)/i.test(src)){
        try { const base=new URL('https://local/'+a.path);const u=new URL(src,base);src='/studio/assets/'+(assetMap[a.root+'/'+decodeURIComponent(u.pathname.slice(1))]||'missing')+'/'; }catch{src='';}
      }
      if(/^\/studio-api\/media\/[a-f\d]{64}$/.test(src))src+='/';
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text||'')}" loading="eager">`;
    };
    const html=marked.parse(raw,{renderer,breaks:false});
    const doc=new DOMParser().parseFromString(html,'text/html');
    for(const el of doc.body.querySelectorAll('*')){
      if(!['P','BR','HR','H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE','PRE','CODE','STRONG','EM','DEL','A','IMG','TABLE','THEAD','TBODY','TR','TD','TH','INPUT'].includes(el.tagName)){el.replaceWith(document.createTextNode(el.textContent||''));continue;}
      for(const attr of [...el.attributes])if(!['href','src','alt','title','class','type','checked','disabled','start'].includes(attr.name))el.removeAttribute(attr.name);
      if(el.tagName==='A'){if(!/^(https?:|mailto:|#|\/)/i.test(el.getAttribute('href')||''))el.removeAttribute('href');el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');}
      if(el.tagName==='IMG'&&!/^(https?:|blob:|\/studio\/assets\/|\/studio-api\/media\/)/i.test(el.getAttribute('src')||''))el.removeAttribute('src');
      if(el.tagName==='INPUT'){el.setAttribute('disabled','');el.setAttribute('type','checkbox');}
    }
    const walker=document.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let nodes=[],n;
    while(n=walker.nextNode())if(!n.parentElement.closest('code,pre'))nodes.push(n);
    for(const node of nodes){const text=node.textContent;const regex=/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;let m,last=0,frag=document.createDocumentFragment();while(m=regex.exec(text)){frag.append(text.slice(last,m.index));let span=document.createElement('span');span.innerHTML=katex.renderToString(m[1]||m[2],{displayMode:!!m[1],throwOnError:false,trust:false});frag.append(span);last=regex.lastIndex;}if(last){frag.append(text.slice(last));node.replaceWith(frag);}}
    return doc.body.innerHTML;
  }
  function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
</script>

<svelte:window on:keydown={keydown}/>
{#if serverMode&&!account}
<section class="login-panel card-base">
  <div class="eyebrow">wonder · 写作空间</div>
  <h1>随时回来，接着写。</h1>
  <p>使用你的 GitHub 账号登录，继续编辑保存在服务器上的草稿。</p>
  {#if loading}<p role="status">正在检查登录状态…</p>{:else}<a class="login-button" data-auth-link data-no-swup href="/studio-auth/login/">使用 GitHub 登录 →</a>{/if}
  {#if loginError}<p role="alert">{loginError}</p>{/if}
  {#if loadError}<p role="alert">{loadError}</p><button on:click={initialize}>重新检查</button>{/if}
  <small>仅博客主人可进入。未发布的正文和图片不会进入公开网站。</small>
</section>
{:else}
<div class="app">
  <nav class="studio-nav card-base" aria-label="写作导航">
    <button class:active={screen==='home'&&filter==='all'} on:click={async()=>{await home();filter='all';}}>▤ 全部文章 <em>{items.length}</em></button>
    <button class:active={screen==='home'&&filter==='draft'} on:click={async()=>{await home();filter='draft';}}>◷ 草稿 <em>{draftCount}</em></button>
    <button class:active={screen==='home'&&filter==='published'} on:click={async()=>{await home();filter='published';}}>◎ 已发布</button>
    <button on:click={showImport}>⌘ 笔记库 <em>{notes.length}</em></button>
    <button class="account" on:click={()=>dialog='account'}>{serverMode?account?.login:'本机写作'}</button>
  </nav>
  <div class="studio-content">
    <div class="demo-strip card-base"><span>◉</span> {serverMode?'草稿和图片自动保存到服务器，登录后可跨设备继续写作。发布功能尚未接通。':'草稿和图片保存在这台电脑，刷新后可继续写作。尚未接通 GitHub 登录与发布。'}<button on:click={()=>dialog='about'}>保存说明</button></div>
    {#if loadError}<div class="save-error" role="alert">{loadError}<button on:click={initialize}>重新读取</button></div>{/if}
    {#if loading}<p class="empty">正在读取草稿…</p>{/if}
    {#if authNeeded&&!current}<div class="save-error" role="alert">登录已失效。<a data-auth-link data-no-swup href="/studio-auth/login/">重新使用 GitHub 登录</a></div>{/if}
    {#if busy}<p class="empty" role="status">正在准备草稿并保存图片…</p>{/if}
    {#if screen==='home'}
      <section class="home">
        <div class="welcome card-base"><div><div class="eyebrow">记录技术、生活与灵感</div><h1>把想法写成文字</h1><p>记录一个想法，或者接着上次的探索。</p></div><div class="welcome-actions"><button on:click={showImport}>⌘ 从笔记导入</button><button class="primary" disabled={loading||busy} on:click={create}>＋ 写文章</button></div></div>
        <div class="list-heading"><h2>你的文章 <span>{items.length}</span></h2><label class="search">⌕ <input aria-label="搜索文章" placeholder="搜索标题、分类…" bind:value={search}/></label></div>
        <div class="tabs"><button class:selected={filter==='all'} on:click={()=>filter='all'}>全部文章</button><button class:selected={filter==='draft'} on:click={()=>filter='draft'}>草稿 <span>{draftCount}</span></button><button class:selected={filter==='published'} on:click={()=>filter='published'}>已发布</button><span class="sort-label">{storageLabel}草稿优先</span></div>
        <div class="article-table"><div class="table-head"><span>文章</span><span>分类</span><span>状态</span><span></span></div>{#each filtered as article}<button class="article-row card-base" disabled={loading||busy} on:click={()=>edit(article)}><div class="article-name"><span class="file-icon">≡</span><div><strong>{article.title||'未命名文章'}</strong><small>{article.persisted?'已保存在'+storageLabel+' · ':''}{article.noteId?'来自笔记 · ':''}{article.description || (article.path?'Markdown · '+article.path:'等待你的第一个想法')}</small></div></div><span class="category">{article.category||'待分类'}</span><span class:published={article.status==='published'} class="status"><i></i>{status(article)}</span><span class="row-arrow">↗</span></button>{/each}{#if !filtered.length}<div class="empty">没有找到文章。换个关键词，或开始写一篇新的。</div>{/if}</div>
        <footer>每一篇文章，都从一个小小的想法开始。<span>wonder · 写作空间</span></footer>
      </section>
    {:else if current}
      <section class="editor card-base" class:focused use:editorPortal={focused}>
        <div class="editor-top"><button class="quiet" on:click={home}>← 文章列表</button><span class="save-status" role="status"><i></i>{uploading?'正在保存图片…':saved}</span><div class="editor-actions"><button aria-pressed={settingsOpen} on:click={()=>settingsOpen=!settingsOpen}>文章设置</button><button aria-pressed={focused} on:click={()=>focused=!focused}>{focused?'退出专注':'专注写作'}</button><button on:click={exportFile}>导出 Markdown</button><button disabled={busy||saving||uploading||!dirty||conflict} on:click={persist}>{saving?'保存中…':'立即保存'}</button><button on:click={publish}>发布说明 ↗</button></div></div>
        {#if saveError}<div class="save-error" role="alert"><span>{saveError}</span>{#if authNeeded}<a data-auth-link data-no-swup href="/studio-auth/login/" target="_blank" rel="noopener noreferrer">在新窗口重新登录</a><button on:click={reauthenticate}>登录后重试保存</button>{:else if conflict}<button disabled={busy} on:click={saveCopy}>将我的修改另存为草稿</button>{:else}<button on:click={persist}>重试保存</button>{/if}<button on:click={exportFile}>导出当前正文</button></div>{/if}
        {#if authNeeded&&!saveError}<div class="save-error" role="alert">登录已失效，当前文字仍保留。<a data-auth-link data-no-swup href="/studio-auth/login/" target="_blank" rel="noopener noreferrer">在新窗口重新登录</a><button on:click={reauthenticate}>登录后继续</button></div>{/if}
        {#if recoveryWarning}<p class="save-error">{recoveryWarning}</p>{/if}
        <div class="editor-heading"><div class="eyebrow">{current.noteId?'从笔记开始':'把想法写下来'} <span class="small-status">{status(current)}</span></div><input class="title-input" disabled={busy} aria-label="文章标题" placeholder="给这篇文章起个标题…" bind:value={current.title} on:input={changed}/>{#if current.noteId}<p class="source-line">⌘ {current.noteId} · {storageLabel}副本，不改动原笔记</p>{/if}</div>
        <div class="editor-layout" class:with-settings={settingsOpen}><div class="writing-area"><div class="toolbar"><div><button title="插入标题" on:click={()=>insert('## 小标题')}>H₂</button><button title="插入代码块" on:click={()=>insert('```python\n# 在这里写代码\n```')}>〈/〉</button><button title="插入公式" on:click={()=>insert('$$\ny = x^2\n$$')}>ƒx</button><label class="upload" title="上传图片，也可在正文中粘贴截图">▧ 图片<input type="file" aria-label="上传图片" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple disabled={uploading||busy} on:change={upload}/></label></div><div class="view-toggle"><button class:selected={mode==='write'} on:click={()=>mode='write'}>编辑</button><button class:selected={mode==='split'} on:click={()=>mode='split'}>分屏</button><button class:selected={mode==='preview'} on:click={()=>mode='preview'}>预览</button></div></div><div class="panes" class:split={mode==='split'}>{#if mode!=='preview'}<textarea disabled={busy} aria-label="Markdown 正文" placeholder="不必想好开头，先写下一句话。\n\n支持 Markdown、代码块和数学公式。" bind:value={current.body} on:input={changed} on:paste={paste} spellcheck="false"></textarea>{/if}{#if mode!=='write'}<article class="prose">{#if current.body}{@html preview}{:else}<div class="preview-empty">你的文字，会在这里慢慢成形。<small>输入正文即可查看预览</small></div>{/if}</article>{/if}</div><div class="editor-foot"><span>{current.body.length.toLocaleString()} 字符 · Markdown</span><span>辅助预览 · 正式效果以博客构建为准</span></div></div>{#if settingsOpen}<aside class="properties"><h3>文章设置</h3><label>分类<input disabled={busy} placeholder="例如 AI infra/cuda" bind:value={current.category} on:input={changed}/></label><p>用 / 分隔层级，分类不会改变文章网址。</p><label>标签<input disabled={busy} placeholder="CUDA, GPU, 学习笔记" bind:value={current.tags} on:input={changed}/></label><div class="property-divider"></div><h4>保存与发布</h4><p>修改会自动保存到{storageLabel}，等待显示“已保存到{storageLabel}”后再离开。</p><div class="private-note">◈ 草稿与博客仓库分开保存<br/><span>当前不会提交或发布到网站。</span></div><button class="wide" on:click={showImport}>⌘ 浏览我的笔记</button></aside>{/if}</div>
      </section>
    {/if}
  </div>
</div>
{/if}
{#if notice}<div class="toast" role="status" use:portal>✓ {notice}</div>{/if}
{#if dialog}
  <div class="overlay" use:portal role="presentation" on:click={e=>{if(e.target===e.currentTarget&&!publishing)dialog='';}}>
    <div class="modal card-base" class:import-modal={dialog==='import'} role="dialog" aria-modal="true" aria-label={dialog==='import'?'从笔记导入':'预览说明'} tabindex="-1"><div class="modal-heading"><div><span class="eyebrow">wonder · 写作空间</span><h2>{dialog==='import'?'从笔记里，挑一个想法。':dialog==='publish'?'草稿已保存，发布尚未接通':dialog==='account'?(serverMode?'GitHub 账号':'当前使用本机写作'):'草稿保存说明'}</h2></div><button aria-label="关闭弹窗" disabled={publishing} on:click={()=>dialog=''}>✕</button></div>
    {#if dialog==='import'}<div class="import-tools"><label class="search">⌕ <input aria-label="搜索笔记" placeholder="搜索笔记名称或目录…" bind:value={noteQuery}/></label><select aria-label="笔记目录" bind:value={folder}><option value="all">全部目录 · {notes.length} 篇</option>{#each folders as f}<option value={f}>{f}</option>{/each}</select></div><div class="import-body"><div class="note-list">{#each found as n}<button class:chosen={selected?.id===n.id} on:click={()=>selected=n}><span>{n.title}</span><small>{n.folder}</small>{#if sourcePairs[n.id]}<em>已关联博客</em>{/if}</button>{/each}{#if !found.length}<p class="empty">没有匹配的笔记</p>{/if}</div><div class="note-detail">{#if selected}<span class="category">{selected.folder}</span><h2>{selected.title}</h2><article class="prose">{@html notePreview}</article>{/if}</div></div><div class="modal-footer"><span>正文与图片一起预览，原笔记保持不变。</span><button class="primary" disabled={!selected||busy||loading} on:click={importNote}>{selected&&(sourcePairs[selected.id]||items.some(a=>a.noteId===selected.id))?'打开已有文章':'导入并保存草稿'} →</button></div>
    {:else if dialog==='publish'}<p class="modal-copy">正文、分类、标签和图片已保存到{storageLabel}。这一步不会提交到 GitHub，也不会更新线上博客。</p><div class="publish-summary"><h3>{current.title||'未命名文章'}</h3><p>{current.category||'待分类'} · {current.body.length} 字符 · 第 {current.revision} 版</p></div><div class="modal-footer"><button on:click={()=>dialog=''}>继续编辑</button><button class="primary" on:click={exportFile}>导出正文</button></div>
    {:else if dialog==='account'}{#if serverMode}<p class="modal-copy">已登录为 {account?.login}。草稿和图片保存在服务器，其他设备登录同一账号即可继续编辑。</p><button class="wide" on:click={logout}>保存并退出登录</button>{:else}<p class="modal-copy">现在仅允许在这台电脑访问，不需要登录。下一阶段将接入 GitHub 登录，再部署到服务器供你跨设备使用。</p><button class="primary wide" on:click={()=>dialog=''}>继续写作</button>{/if}
    {:else}<p class="modal-copy">新建、编辑或导入的内容保存到独立的{storageLabel}草稿库，正文和上传图片在刷新页面、重启服务后仍会保留。博客与笔记仓库原文件不会被改动。</p><p class="modal-copy">编辑停止约半秒后自动保存。保存失败或其他页面更新了同一草稿时，会明确提示，保留当前修改。请等待“已保存到{storageLabel}”再关闭页面。</p><p class="modal-copy">{serverMode?'登录后可以跨设备读取服务器草稿，真实构建预览和发布将在后续接入。':'本机保存暂不支持跨设备。GitHub 登录、真实构建预览和发布将在后续接入。'}</p><button class="primary wide" on:click={()=>dialog=''}>知道了</button>{/if}
    </div>
  </div>
{/if}

<style>
.login-panel { padding:3rem; color:var(--text-90); }
.login-panel h1 { font-size:2rem; font-weight:700; margin:1rem 0; }
.login-panel p { line-height:1.8; margin:1rem 0; }
.login-panel small { display:block; color:var(--content-meta); margin-top:1.5rem; line-height:1.8; }
.login-button { display:inline-block; border-radius:.7rem; padding:.8rem 1.4rem; color:var(--btn-content); background:var(--btn-regular-bg); }

.save-error {display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;padding:1rem;margin:1rem 0;background:var(--btn-regular-bg);border:1px solid var(--admonitions-color-warning);border-radius:.6rem;color:var(--studio-text);font-size:.85rem;}
.save-error button{font-size:.8rem;}
.app,.overlay,.editor { --studio-text: rgba(0,0,0,.9); }
:global(.dark) .app,:global(.dark) .overlay,:global(.dark) .editor { --studio-text: rgba(255,255,255,.9); }
.app { color:var(--studio-text); font:inherit; min-width:0; }
button,input,textarea,select { font:inherit; }
button { cursor:pointer; border:1px solid var(--line-divider); border-radius:.6rem; padding:.6rem 1rem; color:var(--btn-content); background:var(--btn-regular-bg); transition:background .15s; }
button:hover { background:var(--btn-regular-bg-hover); }
button:disabled { opacity:.5; cursor:default; }
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible { outline:2px solid var(--primary); outline-offset:3px; }
button.primary { background:var(--primary); color:var(--card-bg); border-color:transparent; font-weight:600; }
button.primary:hover { filter:brightness(1.06); }
input,select { background:var(--card-bg); border:1px solid var(--line-divider); border-radius:.5rem; padding:.6rem .8rem; color:var(--studio-text); min-width:0; }
input::placeholder,textarea::placeholder { color:var(--content-meta); opacity:.6; }
.studio-nav { display:flex; align-items:center; gap:.5rem; padding:.75rem; margin-bottom:1rem; flex-wrap:wrap; }
.studio-nav button { background:transparent; font-size:.9rem; padding:.45rem .7rem; }
.studio-nav button.active { background:var(--primary); color:var(--card-bg); border-color:transparent; }
.studio-nav em { font-style:normal; font-size:.75rem; opacity:.6; margin-left:.3rem; }
.studio-nav .account { margin-left:auto; font-size:.75rem; color:var(--content-meta); }
.demo-strip { display:flex; align-items:center; gap:.5rem; padding:.8rem 1.1rem; margin-bottom:1rem; font-size:.75rem; color:var(--content-meta); line-height:1.7; }
.demo-strip>span { color:var(--primary); }
.demo-strip button { margin-left:auto; background:none; border:0; padding:0; white-space:nowrap; font-size:.75rem; }
.welcome { padding:1.8rem 2rem; display:flex; align-items:center; justify-content:space-between; gap:1.2rem; margin-bottom:1.5rem; }
.eyebrow { color:var(--btn-content); font-size:.8rem; letter-spacing:.08em; }
h1,h2,h3,h4,p { margin:0; }
.welcome h1 { font-size:1.8rem; font-weight:700; line-height:1.4; margin:.5rem 0; position:relative; }
.welcome h1::before,.list-heading h2::before { content:''; width:4px; height:1rem; background:var(--primary); border-radius:4px; display:inline-block; margin-right:.7rem; }
.welcome p { color:var(--content-meta); font-size:.9rem; }
.welcome-actions { display:flex; gap:.7rem; flex-shrink:0; }
.welcome-actions button { font-size:.9rem; }
.list-heading { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:0 .8rem; }
.list-heading h2 { font-size:1.2rem; font-weight:700; }
.list-heading h2 span { font-size:.8rem; font-weight:400; color:var(--content-meta); margin-left:.4rem; }
.search { display:flex; align-items:center; gap:.4rem; background:var(--card-bg); border:1px solid var(--line-divider); border-radius:.6rem; padding:0 .7rem; color:var(--btn-content); }
.search input { width:190px; padding:.6rem .3rem; border:0; background:transparent; font-size:.8rem; outline:none; }
.tabs { display:flex; gap:1.3rem; align-items:center; margin:.5rem .9rem 1rem; }
.tabs button { background:transparent; border:0; border-bottom:2px solid transparent; border-radius:0; padding:.65rem 0; font-size:.85rem; color:var(--content-meta); }
.tabs button.selected { color:var(--btn-content); border-color:var(--primary); }
.tabs button span { font-size:.7rem; margin-left:.3rem; }
.sort-label { margin-left:auto; color:var(--content-meta); font-size:.75rem; opacity:.7; }
.article-table { display:flex; flex-direction:column; gap:1rem; }
.table-head,.file-icon { display:none; }
.article-row { width:100%; display:grid; grid-template-columns:minmax(0,1fr) auto 3rem; gap:.6rem 1.1rem; text-align:left; padding:1.6rem 1.7rem; background:var(--card-bg); position:relative; color:var(--studio-text); }
.article-row:hover { background:var(--card-bg); }
.article-row::before { content:''; position:absolute; top:2rem; left:1.1rem; height:1rem; width:4px; border-radius:4px; background:var(--primary); }
.article-name { grid-column:1/3; min-width:0; padding-left:.5rem; }
.article-name strong { font-size:1.3rem; font-weight:700; line-height:1.5; }
.article-name small { display:block; color:var(--content-meta); font-size:.88rem; line-height:1.8; margin:.6rem 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.category { color:var(--btn-content); background:var(--btn-regular-bg); font-size:.8rem; border-radius:.3rem; padding:.15rem .5rem; width:fit-content; max-width:100%; overflow-wrap:anywhere; }
.article-row>.category { margin-left:.5rem; }
.status { font-size:.8rem; color:var(--content-meta); display:flex; align-items:center; gap:.4rem; justify-self:end; }
.status i,.save-status i { display:inline-block; width:5px; height:5px; background:currentColor; border-radius:50%; }
.status.published { color:var(--btn-content); }
.row-arrow { grid-column:3; grid-row:1/3; display:grid; place-items:center; align-self:stretch; background:var(--btn-regular-bg); color:var(--btn-content); border-radius:.7rem; font-size:1.4rem; }
.article-row:hover .row-arrow { background:var(--btn-regular-bg-hover); }
footer { display:flex; justify-content:space-between; font-size:.75rem; color:var(--content-meta); padding:1.5rem .7rem; opacity:.6; }
.editor { padding:1.5rem; overflow:visible; color:var(--studio-text); }
.editor-top { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; }
.quiet { background:transparent; border:0; padding-left:0; font-size:.85rem; }
.save-status { font-size:.7rem; color:var(--content-meta); display:flex; align-items:center; gap:.4rem; }
.editor-actions { display:flex; gap:.5rem; margin-left:auto; }
.editor-actions button { font-size:.8rem; }
.editor-heading { padding:1.9rem 0 1.5rem; }
.small-status { font-size:.75rem; padding:.2rem .5rem; margin-left:.6rem; background:var(--btn-regular-bg); border-radius:.3rem; }
.title-input { border:0; width:100%; border-radius:0; padding:.8rem 0 .3rem; background:transparent; font-size:1.8rem; font-weight:700; }
.source-line { font-size:.75rem; color:var(--content-meta); margin-top:.5rem; }
.editor-layout { display:grid; grid-template-columns:minmax(0,1fr); gap:1.4rem; }
.editor-layout.with-settings { grid-template-columns:minmax(0,1fr) 220px; }
.writing-area { border:1px solid var(--line-divider); border-radius:var(--radius-large); overflow:hidden; min-width:0; }
.toolbar { display:flex; justify-content:space-between; align-items:center; padding:.5rem .7rem; border-bottom:1px solid var(--line-divider); background:var(--btn-regular-bg); }
.toolbar>div { display:flex; align-items:center; gap:.2rem; }
.toolbar button,.upload { background:transparent; border:0; border-radius:.4rem; font-size:.85rem; padding:.3rem .6rem; color:var(--btn-content); }
.upload { cursor:pointer; }
.upload input { display:none; }
.view-toggle button { font-size:.75rem; }
.view-toggle button.selected { background:var(--card-bg); }
.panes { display:grid; grid-template-columns:minmax(0,1fr); min-height:65vh; }
.panes.split { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
.panes textarea { min-height:65vh; width:100%; padding:1.5rem; border:0; outline:none; color:var(--studio-text); background:var(--card-bg); resize:vertical; font-family:'JetBrains Mono Variable',monospace; font-size:1rem; line-height:1.9; }
.panes.split textarea { border-right:1px solid var(--line-divider); }
.panes .prose { padding:1.5rem; min-width:0; max-width:none; max-height:75vh; overflow:auto; overflow-wrap:anywhere; }
.prose { --tw-prose-body:var(--studio-text); --tw-prose-headings:var(--studio-text); --tw-prose-bold:var(--studio-text); --tw-prose-quotes:var(--studio-text); --tw-prose-links:var(--btn-content); --tw-prose-counters:var(--content-meta); --tw-prose-bullets:var(--content-meta); color:var(--studio-text); font-size:.95rem; line-height:1.85; }
.prose :global(h1) { font-size:1.7rem; font-weight:700; margin:.6rem 0 1.2rem; }
.prose :global(h2) { font-size:1.4rem; font-weight:700; margin:1.5rem 0 .8rem; border-bottom:1px solid var(--line-divider); padding-bottom:.5rem; }
.prose :global(h3) { font-size:1.15rem; font-weight:650; margin:1.2rem 0 .7rem; }
.prose :global(p) { margin:.7rem 0; }
.prose :global(ul) { list-style:disc; padding-left:1.5rem; }
.prose :global(ol) { list-style:decimal; padding-left:1.5rem; }
.prose :global(pre) { background:var(--codeblock-bg); color:#e1e8e5; padding:1rem; overflow:auto; border-radius:.6rem; line-height:1.8; margin:1rem 0; }
.prose :global(code) { background:var(--inline-code-bg); color:var(--inline-code-color); border-radius:.25rem; padding:.1rem .25rem; font-size:.85em; }
.prose :global(pre code) { background:none; color:inherit; }
.prose :global(img) { max-width:100%; height:auto; border-radius:.7rem; }
.prose :global(table) { display:block; max-width:100%; overflow:auto; border-collapse:collapse; font-size:.8rem; }
.prose :global(td),.prose :global(th) { padding:.5rem; border:1px solid var(--line-color); }
.prose :global(blockquote) { border-left:3px solid var(--primary); padding:.2rem 1rem; margin:1rem 0; background:var(--btn-regular-bg); }
.prose :global(a) { color:var(--btn-content); text-decoration:underline; }
.prose :global(.katex-display) { overflow:auto; }
.editor-foot { display:flex; justify-content:space-between; gap:1rem; padding:.75rem; border-top:1px solid var(--line-divider); font-size:.65rem; color:var(--content-meta); }
.properties h3 { font-size:1rem; font-weight:700; margin:.5rem 0 1.2rem; }
.properties label { display:block; font-size:.8rem; margin:1rem 0 .5rem; }
.properties input { width:100%; font-size:.8rem; margin-top:.5rem; }
.properties p { font-size:.75rem; color:var(--content-meta); line-height:1.8; }
.property-divider { height:1px; background:var(--line-divider); margin:1.5rem 0; }
.properties h4 { font-size:.85rem; font-weight:600; margin-bottom:.7rem; }
.private-note { padding:.8rem; background:var(--btn-regular-bg); color:var(--btn-content); font-size:.7rem; line-height:2; border-radius:.6rem; margin:1rem 0; }
.wide { width:100%; font-size:.8rem; }
.preview-empty { padding:3rem 0; text-align:center; font-size:.85rem; color:var(--content-meta); }
.preview-empty small { display:block; font-size:.75rem; margin-top:.6rem; }
.toast { position:fixed; z-index:1110; left:50%; top:5.5rem; transform:translateX(-50%); padding:1rem 1.5rem; background:var(--float-panel-bg); color:var(--btn-content); border:1px solid var(--line-divider); border-radius:var(--radius-large); box-shadow:0 8px 32px #0002; max-width:90vw; font-size:.85rem; }
.overlay { position:fixed; inset:0; z-index:1100; display:flex; align-items:center; justify-content:center; background:#0006; backdrop-filter:blur(5px); padding:1.5rem; color:var(--studio-text); }
.modal { width:540px; max-width:100%; max-height:90vh; overflow:auto; padding:1.8rem; box-shadow:0 20px 80px #0003; }
.modal-heading { display:flex; justify-content:space-between; gap:1rem; align-items:center; }
.modal-heading h2 { font-size:1.4rem; font-weight:700; margin:.6rem 0; }
.modal-heading button { background:transparent; border:0; }
.import-modal { width:1100px; }
.import-tools { display:flex; gap:1rem; margin:1rem 0; }
.import-tools .search { flex:1; }
.import-tools input { width:100%; }
.import-tools select { max-width:45%; font-size:.8rem; }
.import-body { display:grid; grid-template-columns:290px minmax(0,1fr); height:440px; border:1px solid var(--line-divider); border-radius:.7rem; overflow:hidden; }
.note-list { overflow:auto; padding:.5rem; background:var(--page-bg); border-right:1px solid var(--line-divider); }
.note-list button { width:100%; display:block; text-align:left; border:0; background:transparent; padding:.8rem; color:var(--studio-text); }
.note-list button.chosen { background:var(--btn-regular-bg); color:var(--btn-content); }
.note-list span { display:block; font-size:.85rem; line-height:1.6; }
.note-list small { display:block; font-size:.65rem; color:var(--content-meta); margin-top:.3rem; }
.note-list em { display:inline-block; font-style:normal; font-size:.65rem; margin-top:.4rem; color:var(--btn-content); }
.note-detail { overflow:auto; padding:1.5rem; }
.note-detail>h2 { font-size:1.5rem; font-weight:700; margin:.8rem 0; }
.modal-footer { display:flex; justify-content:space-between; align-items:center; gap:1rem; margin-top:1.4rem; }
.modal-footer>span { font-size:.8rem; color:var(--content-meta); }
.modal-copy { font-size:.9rem; color:var(--content-meta); line-height:1.9; margin:1.5rem 0; }
.publish-summary { padding:1.2rem; border-radius:.7rem; background:var(--btn-regular-bg); }
.publish-summary h3 { font-size:1.2rem; font-weight:600; }
.publish-summary p { font-size:.8rem; color:var(--content-meta); margin:.6rem 0; }
.empty { padding:2rem; font-size:.9rem; color:var(--content-meta); text-align:center; }
@media(max-width:1300px) {
 .welcome { align-items:flex-start; }.welcome-actions { flex-direction:column; }
 .editor-layout.with-settings { grid-template-columns:minmax(0,1fr); }
 .properties { display:grid; grid-template-columns:1fr 1fr; gap:0 1rem; }
 .properties h3 { grid-column:1/-1; }.properties .property-divider,.properties h4,.properties>p,.properties .private-note,.properties>button { display:none; }
 .article-name strong { font-size:1.2rem; }
}
@media(max-width:700px) {
 .studio-nav { gap:.35rem; padding:.6rem; }.studio-nav button { font-size:.75rem; padding:.4rem .5rem; }.studio-nav .account { display:block; }
 .demo-strip { font-size:.7rem; padding:.7rem 1rem; align-items:flex-start; }.demo-strip button { display:none; }
 .welcome { flex-direction:column; padding:1.5rem; gap:1rem; }.welcome h1 { font-size:1.6rem; }.welcome-actions { flex-direction:row; width:100%; }.welcome-actions button { flex:1; font-size:.85rem; }
 .list-heading { padding:0 .3rem; }.list-heading h2 { font-size:1.1rem; white-space:nowrap; }.search { min-width:0; }.search input { width:100%; max-width:135px; }
 .tabs { margin-left:.4rem; gap:1rem; }.sort-label { display:none; }
 .article-row { padding:1.3rem 1.2rem; grid-template-columns:minmax(0,1fr) auto 2.2rem; gap:.4rem; }.article-row::before { left:.7rem; top:1.7rem; }.article-name strong { font-size:1.1rem; }.article-name small { font-size:.8rem; }.category,.status { font-size:.7rem; }
 footer { font-size:.7rem; }footer span { display:none; }
 .editor { padding:1rem; }.editor-top { gap:.5rem; }.save-status { font-size:.65rem; }.editor-actions { width:100%; justify-content:flex-end; }.editor-heading { padding:1.2rem 0; }.title-input { font-size:1.5rem; }
 .panes.split { grid-template-columns:1fr; }.panes.split textarea { border-right:0; border-bottom:1px solid var(--line-divider); min-height:260px; }.panes textarea { min-height:340px; padding:1.1rem; font-size:.8rem; }.panes .prose { padding:1.1rem; max-height:400px; }
 .toolbar { padding:.4rem; }.toolbar button { padding:.3rem .4rem; }.editor-foot { font-size:.6rem; }.properties { gap:.6rem; }.properties input { font-size:.75rem; }
 .overlay { padding:.7rem; }.modal { padding:1.1rem; max-height:94vh; }.modal-heading h2 { font-size:1.15rem; }.import-tools { flex-direction:column; gap:.5rem; }.import-tools select { max-width:100%; }.import-tools input { max-width:none; }
 .import-body { height:50vh; grid-template-columns:120px minmax(0,1fr); }.note-list { padding:.2rem; }.note-list button { padding:.6rem .4rem; }.note-list span { font-size:.7rem; }.note-list small { font-size:.6rem; overflow-wrap:anywhere; }.note-detail { padding:.8rem; }.note-detail>h2 { font-size:1.1rem; }.note-detail .prose { font-size:.75rem; }
 .modal-footer { flex-direction:column; align-items:stretch; gap:.6rem; }.modal-footer>span { font-size:.7rem; }
}

.editor.focused { position:fixed; inset:.75rem; z-index:1000; display:flex; flex-direction:column; gap:0; padding:1rem 1.4rem; box-shadow:0 12px 64px #0003; overflow:auto; }
.focused .editor-heading { padding:.7rem 0 1rem; }
.focused .editor-heading .eyebrow { display:none; }
.focused .title-input { padding:.2rem 0; font-size:1.6rem; }
.focused .editor-top { flex-shrink:0; }
.focused .editor-layout { flex:1; min-height:0; }
.focused .writing-area { display:flex; flex-direction:column; min-height:0; }
.focused .panes { flex:1; min-height:0; overflow:hidden; }
.focused .panes textarea { min-height:0; height:100%; resize:none; padding:1.5rem 2rem; }
.focused .panes .prose { min-height:0; max-height:none; height:100%; padding:1.5rem 2rem; }
.focused .toolbar,.focused .editor-foot { flex-shrink:0; }
.focused .properties { overflow:auto; min-height:0; }
.focused .editor-layout.with-settings { grid-template-columns:minmax(0,1fr) 220px; }
.focused .properties { display:block; }
.focused .properties>p,.focused .properties h4,.focused .properties .property-divider,.focused .properties .private-note,.focused .properties>button { display:block; }
@media(max-width:700px) {
 .editor.focused { inset:0; border-radius:0; padding:.7rem; }
 .focused .editor-top { gap:.3rem; }
 .focused .editor-actions { justify-content:flex-start; flex-wrap:wrap; gap:.3rem; }
 .focused .editor-actions button { font-size:.7rem; padding:.35rem .5rem; }
 .focused .editor-heading { padding:.4rem 0 .6rem; }
 .focused .title-input { font-size:1.3rem; }
 .focused .editor-layout.with-settings { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr) auto; }
 .focused .properties { max-height:25vh; }
 .focused .panes.split { grid-template-rows:minmax(0,1fr) minmax(0,1fr); }
 .focused .panes textarea,.focused .panes .prose { padding:1rem; font-size:.95rem; }
 .focused .editor-foot { flex-wrap:wrap; gap:.2rem; }
}
</style>
