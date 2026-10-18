<script>
import { onMount, tick } from "svelte";
import { readingCode } from "./reading-code.mjs";
import StudioMenu from "./StudioMenu.svelte";
import "./reading-code.css";
import {
	articleFolder,
	folderPath,
	seedOrganization,
	targetArticlePath,
	withinFolder,
} from "../../lib/studio-organization.mjs";
import {
	articleKey,
	blogPath,
	buildArticleTree,
	flattenArticleTree,
	isPublished,
} from "./article-workbench.mjs";
import { displayDate, selectArticles } from "./draft-list.mjs";
import FolderDialog from "./FolderDialog.svelte";
import MoveDrawer from "./MoveDrawer.svelte";
export let items = [];
export let organization = null;
export let moveOpen = false;
export let organizationBusy = false;
export let onMove = async () => {};
export let onUndo = async () => {};
export let onFolder = async () => {};
export let onPublishDirectory = () => {};
export let selection = "";
export let filter = "all";
export let search = "";
export let sort = "updated";
export let loading = false;
export let busy = false;
export let active = true;
export let renderMarkdown = () => "";
export let articleStatus = () => "";
export let onEdit = () => {};
export let onCreate = () => {};
export let onImport = () => {};
export let onRefresh = () => {};
export let onDuplicate = () => {};
export let onTrash = () => {};
let mounted = false;
let collapsed = new Set();
let mobileReader = false;
let treeElement;
let readerElement;
let infoOpen = false;
$: ordered = selectArticles(items, "all", search, sort);
$: visible = ordered.filter((a) =>
	filter === "draft"
		? a.status === "draft"
		: filter === "published"
			? isPublished(a)
			: true,
);
let moveSubject = null;
let initialTarget = null;
let lastUndo = null;
let moveNotice = "";
let dragged = null;
let dropTarget;
let gesture = null;
let suppressClick = false;
let folderDialog = null;
$: moveOpen = !!moveSubject || !!folderDialog;
$: recoverUndo(organization);
function recoverUndo(state) {
	if (state?.undoToken) {
		lastUndo = state.undoToken;
		moveNotice = "目录操作已保存。";
	} else {
		lastUndo = null;
		moveNotice = "";
	}
}
$: workspace = seedOrganization(organization, items);
function pendingLocation(a) {
	const source = blogPath(a);
	return (
		isPublished(a) &&
		!!source &&
		(targetArticlePath(a, workspace) !== source || a.directoryNeedsAlignment)
	);
}
$: pendingCount = items.filter(pendingLocation).length;
$: tree = buildArticleTree(visible, workspace);
$: fullRows = flattenArticleTree(
	buildArticleTree(items, workspace),
	new Set(),
	true,
);
$: allRows = flattenArticleTree(tree, new Set(), true);
$: rows = flattenArticleTree(tree, collapsed, !!search.trim());
$: article = items.find((a) => articleKey(a) === selection);
$: folder =
	selection === "root"
		? tree
		: allRows.find((row) => row.type === "folder" && row.id === selection);
$: createTarget = folder
	? folder.unfiled
		? undefined
		: folder.id === "root"
			? null
			: folder.id
	: article
		? articleFolder(article, workspace)
		: null;
$: html = mounted && article ? renderMarkdown(article.body || "", article) : "";
$: reconcileSelection(mounted, loading, active, visible, allRows, selection);
function reconcileSelection(ready, isLoading, isActive, shown, treeRows, key) {
	if (
		!ready ||
		isLoading ||
		!isActive ||
		moveSubject ||
		folderDialog ||
		key === "root"
	)
		return;
	if (
		shown.some((a) => articleKey(a) === key) ||
		treeRows.some((row) => row.id === key)
	)
		return;
	const next = shown.length ? articleKey(shown[0]) : "";
	if (next !== key) selection = next;
}
onMount(() => {
	mounted = true;
});
function choose(row) {
	if (suppressClick) return;
	selection = row.id;
	mobileReader = true;
	infoOpen = false;
	if (readerElement) readerElement.scrollTop = 0;
}
function toggle(row) {
	const next = new Set(collapsed);
	next.has(row.id) ? next.delete(row.id) : next.add(row.id);
	collapsed = next;
}
async function keyboard(event, row) {
	const index = rows.findIndex((item) => item.id === row.id);
	let target;
	if (event.key === "ArrowDown")
		target = rows[Math.min(rows.length - 1, index + 1)];
	else if (event.key === "ArrowUp") target = rows[Math.max(0, index - 1)];
	else if (event.key === "Home") target = rows[0];
	else if (event.key === "End") target = rows[rows.length - 1];
	else if (event.key === "ArrowRight" && row.type === "folder") {
		if (collapsed.has(row.id)) toggle(row);
		else target = rows[index + 1];
	} else if (event.key === "ArrowLeft") {
		if (row.type === "folder" && !collapsed.has(row.id)) toggle(row);
		else target = rows.find((item) => item.id === row.parent);
	} else return;
	event.preventDefault();
	await tick();
	if (target)
		treeElement
			?.querySelectorAll("[data-tree-row]")
			[rows.findIndex((item) => item.id === target.id)]?.focus();
}
function changeFilter(value) {
	filter = value;
	mobileReader = false;
}
function menuAction(action) {
	if (["create", "rename", "delete"].includes(action)) {
		startFolder(action);
		return;
	}
	if (action === "new-article") {
		onCreate(createTarget);
		return;
	}
	if (action === "move")
		startMove(
			article
				? {
						id: articleKey(article),
						type: "article",
						article,
						label: article.title || "未命名文章",
					}
				: folder,
		);
	else if (action === "edit") onEdit(article);
	else if (action === "duplicate") onDuplicate(article);
	else if (action === "trash") onTrash(article);
	else infoOpen = !infoOpen;
}
function subjectFor(row) {
	return row.type === "folder"
		? {
				id: row.id,
				kind: "folder",
				label: row.label,
				parent: workspace.folders.find((f) => f.id === row.id)?.parent,
			}
		: {
				id: row.id,
				kind: "article",
				label: row.label,
				parent: articleFolder(row.article, workspace),
			};
}
function startMove(row, destination) {
	if (!organization || organizationBusy || row?.unfiled || !row) return;
	moveSubject = subjectFor(row);
	initialTarget =
		destination === undefined ? (moveSubject.parent ?? null) : destination;
	mobileReader = true;
}
async function confirmMove(input) {
	const movedId = moveSubject.id;
	const result = await onMove(input);
	lastUndo = result.undoToken;
	selection = movedId;
	moveNotice =
		"已移动到 " + (folderPath(result.folders, input.target) || "全部文章");
	const next = new Set(collapsed);
	let id = input.target;
	while (id) {
		next.delete(id);
		id = result.folders.find((f) => f.id === id)?.parent;
	}
	collapsed = next;
	moveSubject = null;
}
async function undoMove() {
	try {
		await onUndo(lastUndo);
		lastUndo = null;
		moveNotice = "已撤销目录操作。";
	} catch (e) {
		lastUndo = null;
		moveNotice = e.message;
	}
}
function startFolder(action, root = false) {
	if (!organization || organizationBusy || busy) return;
	const parent = root
		? null
		: action === "create"
			? createTarget
			: workspace.folders.find((f) => f.id === folder?.id)?.parent;
	folderDialog = {
		action,
		id: folder?.id,
		parent: parent ?? null,
		name: action === "create" ? "" : folder?.label || "",
	};
}
async function confirmFolder(name) {
	const operation = folderDialog;
	const previousIds = new Set(workspace.folders.map((f) => f.id));
	const result = await onFolder({ ...operation, name });
	const created =
		operation.action === "create"
			? result.folders.find((f) => !previousIds.has(f.id))
			: null;
	selection =
		created?.id ||
		(operation.action === "delete" ? operation.parent || "root" : operation.id);
	search = "";
	filter = "all";
	mobileReader = true;
	const expanded = new Set(collapsed);
	for (const f of result.folders)
		if (withinFolder(result.folders, selection, f.id)) expanded.delete(f.id);
	collapsed = expanded;
	lastUndo = result.undoToken;
	moveNotice =
		operation.action === "create"
			? "目录已创建。"
			: operation.action === "rename"
				? "目录已重命名。"
				: "空目录已删除。";
	folderDialog = null;
}
function canDrop(target) {
	return (
		dragged &&
		target !== dragged.parent &&
		(dragged.kind !== "folder" ||
			!withinFolder(workspace.folders, target, dragged.id))
	);
}
function pointerStart(event, row) {
	if (
		event.button !== 0 ||
		event.pointerType === "touch" ||
		moveSubject ||
		!organization ||
		organizationBusy ||
		row.unfiled ||
		event.target.closest(".toggle")
	)
		return;
	gesture = { row, x: event.clientX, y: event.clientY };
}
function pointerMove(event) {
	if (!gesture) return;
	if (
		!dragged &&
		Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 7
	)
		return;
	dragged = subjectFor(gesture.row);
	event.preventDefault();
	const target = document
		.elementFromPoint(event.clientX, event.clientY)
		?.closest("[data-drop-folder]");
	const id = target?.getAttribute("data-drop-folder") || null;
	dropTarget = target && canDrop(id) ? id : undefined;
}
function pointerEnd() {
	if (gesture && dragged) {
		suppressClick = true;
		setTimeout(() => (suppressClick = false), 0);
		if (dropTarget !== undefined) {
			selection = gesture.row.id;
			startMove(gesture.row, dropTarget);
		}
	}
	gesture = null;
	dragged = null;
	dropTarget = undefined;
}
function cancelDrag() {
	gesture = null;
	dragged = null;
	dropTarget = undefined;
}
</script>

<svelte:window on:pointermove|nonpassive={pointerMove} on:pointerup={pointerEnd} on:pointercancel={cancelDrag} on:blur={cancelDrag} on:keydown={event=>{if(event.key==='Escape')cancelDrag();}}/>
<section class="workbench" class:mobile-reader={mobileReader} hidden={!active} aria-label="文章工作台">
  <header class="heading" inert={!!moveSubject}><div><h1>文章工作台</h1><p>在目录中切换文章，阅读与写作留在同一处。</p></div><div class="heading-actions"><button disabled={busy||loading||organizationBusy} on:click={onPublishDirectory}>应用目录调整{#if pendingCount} · {pendingCount}{/if}</button><button class="import-button" on:click={onImport} disabled={busy||loading}>从笔记导入</button><button disabled={busy||loading||organizationBusy||!organization} on:click={()=>startFolder('create',true)}>＋ 新建目录</button><button class="primary" on:click={()=>onCreate(createTarget)} disabled={busy||loading||organizationBusy||!organization}>＋ 新建文章</button></div></header>
  <div class="panes">
    <aside class="directory" aria-label="文章目录">
      <div class="directory-tools" inert={!!moveSubject}><label class="search"><span aria-hidden="true">⌕</span><input aria-label="搜索文章" placeholder="搜索标题、正文、分类…" bind:value={search}/></label>
        <div class="filters" aria-label="文章筛选">{#each [['all','全部'],['draft','草稿'],['published','已发布']] as [value,label]}<button class:chosen={filter===value} aria-pressed={filter===value} on:click={()=>changeFilter(value)}>{label}<small>{value==='all'?items.length:value==='draft'?items.filter(a=>a.status==='draft').length:items.filter(isPublished).length}</small></button>{/each}</div>
      </div>
      <div class="tree-tools" inert={!!moveSubject}><button class:drop-target={dragged&&dropTarget===null&&canDrop(null)} data-drop-folder="" on:click={()=>{search='';filter='all';selection='root';mobileReader=true;}}>全部文章</button><button aria-label={collapsed.size?'展开全部目录':'收起全部目录'} on:click={()=>collapsed=collapsed.size?new Set():new Set(allRows.filter(n=>n.type==='folder').map(n=>n.id))}>{collapsed.size?'展开':'收起'}</button><StudioMenu label="文章排序" compact options={[{value:'updated',label:'最近修改'},{value:'created',label:'最近创建'},{value:'title',label:'标题排序'}]} value={sort} onSelect={value=>sort=value}/></div>
      <div class="tree" bind:this={treeElement}>
        {#if loading}<p class="empty" role="status">正在读取文章…</p>{:else if !rows.length}<p class="empty">没有匹配的文章，试试其他关键词。</p>{/if}
        <ul aria-label="文件和文章" inert={!!moveSubject}>
          {#each rows as row (row.id)}
            <li class:chosen={selection===row.id} class:folder-row={row.type==='folder'} style:--depth={row.depth} data-drop-folder={row.type==='folder'&&!row.unfiled?row.id:undefined} on:pointerdown={event=>pointerStart(event,row)} class:drop-target={dragged&&dropTarget===row.id}>
              {#if row.type==='folder'}<button class="toggle" aria-label={(collapsed.has(row.id)?'展开 ':'收起 ')+row.label} aria-expanded={!collapsed.has(row.id)||!!search} on:click={()=>toggle(row)}>{collapsed.has(row.id)&&!search?'›':'⌄'}</button>{:else}<span class="file-icon" aria-hidden="true">▤</span>{/if}
              <button class="entry" data-tree-row aria-current={selection===row.id?'true':undefined} title={row.type==='article'?row.label+' · '+(blogPath(row.article)||'未归档草稿'):row.path||row.label} on:click={()=>choose(row)} on:keydown={event=>keyboard(event,row)}><span>{row.label}</span></button>
              {#if row.type==='folder'}<small>{row.count}</small>{:else}
                {#if pendingLocation(row.article)}<small class="article-state" title="目录调整尚未同步到博客">{targetArticlePath(row.article,workspace)!==blogPath(row.article)?'待移动':'待同步'}</small>{/if}
                {#if row.article.status==='draft'}<small class="article-state" title={isPublished(row.article)?'存在尚未发布的内容修改':'尚未发布的文章'}>{isPublished(row.article)?'有修改':'草稿'}</small>{/if}
              {/if}
            </li>
          {/each}
        </ul>
      </div>
      <footer inert={!!moveSubject}><span>{visible.length} 篇文章</span><button disabled={busy||loading} on:click={onRefresh}>刷新</button></footer>
    </aside>
    <section class="reader" aria-label="文章阅读区">
      <div class="reader-bar" inert={!!moveSubject}><button class="back" on:click={()=>mobileReader=false}>‹ 文章目录</button><span class="breadcrumb">{article?(articleFolder(article,workspace)===undefined?'未归档草稿':folderPath(workspace.folders,articleFolder(article,workspace))||'全部文章'):folder?.path||'全部文章'}</span>
        {#if article}<div class="reader-actions"><StudioMenu label="当前文章更多操作" compact disabled={busy||loading} options={[{value:'edit',label:'编辑文章'},{value:'move',label:'移动到…',disabled:!organization||organizationBusy},{value:'info',label:'文件信息'},...(article.persisted?[{value:'duplicate',label:'复制草稿'},{value:'trash',label:'移入回收站',danger:true}]:[])]} onSelect={menuAction}/><button class="primary" disabled={busy||loading} on:click={()=>onEdit(article)}>编辑文章 ↗</button></div>{:else if folder&&!folder.unfiled}<StudioMenu label="当前目录更多操作" compact disabled={organizationBusy||!organization} options={[{value:'new-article',label:'在此新建文章'},{value:'create',label:'新建子目录'},...(folder.id==='root'?[]:[{value:'rename',label:'重命名'},{value:'move',label:'移动到…'},{value:'delete',label:'删除空目录',danger:true,disabled:workspace.folders.some(f=>f.parent===folder.id)||items.some(a=>articleFolder(a,workspace)===folder.id)}])]} onSelect={menuAction}/>{/if}
      </div>
      <div class="reading-scroll" bind:this={readerElement} inert={!!moveSubject}>
        {#if article}
          <article class="document"><div class="kicker">{articleStatus(article)}{#if pendingLocation(article)} · 目录待应用{/if}</div><h2>{article.title||'未命名文章'}</h2><div class="metadata"><span>所在目录 · {folderPath(workspace.folders,articleFolder(article,workspace))||'根目录'}</span>{#if article.updatedAt||article.date}<span>{displayDate(article.updatedAt||article.date)}</span>{/if}</div>
            {#if infoOpen}<dl class="file-info"><dt>文件位置</dt><dd>{blogPath(article)||'尚未指定博客路径，草稿独立保存'}</dd><dt>目标位置</dt><dd>{targetArticlePath(article,workspace)||'首次发布时确定文件名'}</dd>{#if article.publication?.url}<dt>已发布网址</dt><dd>{article.publication.url}</dd>{/if}<dt>编辑方式</dt><dd>{article.persisted?'打开已保存草稿':'编辑时创建草稿副本，发布前不修改博客原文'}</dd></dl>{/if}
            {#if article.body}<div class="prose markdown-content" use:readingCode={html}>{@html html}</div>{:else}<p class="empty">还没有正文，点击“编辑文章”开始写作。</p>{/if}
          </article>
        {:else if folder}
          <div class="document"><div class="kicker">{folder.unfiled?'草稿分组':'文件夹'}</div><h2>{folder.label}</h2><p class="folder-description">{folder.count} 篇文章{folder.unfiled?' · 尚未指定博客文件路径':''}</p><div class="folder-items">{#each folder.children as child (child.id)}<button on:click={()=>choose(child)}><span aria-hidden="true">{child.type==='folder'?'▱':'▤'}</span><span>{child.label}</span><small>{child.type==='folder'?child.count+' 篇':articleStatus(child.article)}</small><span aria-hidden="true">›</span></button>{/each}</div></div>
        {:else}<div class="empty reader-empty"><h2>选一篇文章，接着读。</h2><p>在左侧选择文章或文件夹。</p></div>{/if}
      </div>
      {#if moveSubject}<MoveDrawer subject={moveSubject} organization={workspace} busy={organizationBusy} {initialTarget} onConfirm={confirmMove} onClose={()=>moveSubject=null}/>{/if}
    </section>
  </div>
  {#if moveNotice}<div class="move-notice" role="status">{moveNotice}{#if lastUndo}<button disabled={organizationBusy} on:click={undoMove}>撤销目录操作</button>{/if}<button aria-label="关闭移动提示" disabled={organizationBusy} on:click={()=>{moveNotice='';lastUndo=null;}}>×</button></div>{/if}
  <p class="workspace-note">目录调整先保存在工作台；确认“应用目录调整”后同步 GitHub 文件和博客目录，旧网址跳转到新位置。</p>
</section>
{#if folderDialog}<FolderDialog {...folderDialog} location={folderPath(workspace.folders,folderDialog.parent)||'全部文章'} busy={organizationBusy} onConfirm={confirmFolder} onClose={()=>folderDialog=null}/>{/if}

<style>
.workbench{color:var(--studio-text);min-width:0}.workbench[hidden]{display:none}button,input{font:inherit}button{cursor:pointer;border:0;background:transparent;color:inherit;border-radius:7px;padding:8px 11px;display:inline-flex;align-items:center;justify-content:center;gap:7px}button:hover{background:var(--btn-regular-bg)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.primary{background:var(--primary);color:var(--card-bg);font-weight:600}.primary:hover{background:var(--primary);filter:brightness(1.05)}h1,h2,p{margin:0}.heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:22px 2px}.heading h1{font-size:1.6rem;font-weight:700}.heading p{font-size:.8rem;color:var(--content-meta);margin-top:5px}.heading-actions{display:flex;gap:8px;font-size:.8rem}.panes{display:grid;grid-template-columns:290px minmax(0,1fr);height:clamp(540px,72dvh,900px);border:1px solid var(--line-divider);border-radius:14px;background:var(--card-bg);min-width:0}.directory{display:flex;flex-direction:column;min-height:0;min-width:0;border-right:1px solid var(--line-divider);background:color-mix(in srgb,var(--primary) 5%,var(--card-bg));border-radius:14px 0 0 14px}.directory-tools{padding:14px 13px 0}.search{display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--line-divider);border-radius:8px;background:var(--card-bg);color:var(--content-meta)}input{min-width:0;width:100%;padding:9px 0;background:none;border:0;color:var(--studio-text);font-size:.8rem}.filters{display:flex;gap:16px}.filters button{border-radius:0;padding:12px 0 10px;font-size:.78rem;border-bottom:2px solid transparent;color:var(--content-meta)}.filters button.chosen{border-color:var(--primary);color:var(--btn-content);font-weight:600}.filters small{font-size:.65rem}.tree-tools{display:flex;align-items:center;gap:4px;padding:9px 12px 3px;font-size:.72rem;color:var(--content-meta)}.tree-tools>button:first-child{margin-right:auto}.tree-tools>button{padding:5px 8px}.tree{overflow:auto;min-height:0;flex:1;padding:8px;scrollbar-width:thin}ul{list-style:none;padding:0;margin:0}li{display:flex;align-items:center;gap:4px;padding:1px 7px 1px calc(4px + var(--depth)*16px);border-radius:7px;min-height:36px}li:hover{background:var(--card-bg)}li.chosen{background:var(--card-bg);box-shadow:inset 3px 0 var(--primary)}.toggle,.file-icon{width:22px;flex-shrink:0;text-align:center;color:var(--content-meta);padding:0}.toggle{height:30px;font-size:20px}.entry{min-width:0;flex:1;padding:6px 0;text-align:left;justify-content:flex-start;font-size:.8rem}.entry span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.entry:hover{background:none}.folder-row{color:var(--btn-content);font-weight:600}li small{font-size:.65rem;flex-shrink:0;color:var(--content-meta)}.article-state{color:var(--btn-content);white-space:nowrap}footer{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;border-top:1px solid var(--line-divider);font-size:.7rem;color:var(--content-meta)}.reader{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0}.reader-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line-divider);min-height:60px}.breadcrumb{font-size:.75rem;color:var(--content-meta);overflow-wrap:anywhere}.reader-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;font-size:.8rem}.reading-scroll{flex:1;overflow:auto;min-height:0;scrollbar-width:thin;overscroll-behavior:auto}.document{padding:30px 34px 60px;max-width:900px;margin:auto;overflow-wrap:anywhere}.kicker{font-size:.7rem;color:var(--btn-content);margin-bottom:12px}.document>h2{font-size:1.8rem;font-weight:700;line-height:1.45;margin:0 0 14px}.metadata{display:flex;gap:12px;flex-wrap:wrap;font-size:.72rem;color:var(--content-meta);margin-bottom:28px}.empty{font-size:.85rem;color:var(--content-meta);padding:22px;line-height:1.8}.reader-empty{padding:70px 32px}.reader-empty h2{font-weight:600;font-size:1.3rem;margin-bottom:10px}.file-info{padding:16px;background:var(--btn-regular-bg);border-radius:8px;font-size:.8rem;margin-bottom:25px}.file-info dt{color:var(--content-meta);margin-top:8px}.file-info dd{margin:4px 0;overflow-wrap:anywhere}.folder-description{font-size:.8rem;color:var(--content-meta);margin-bottom:25px}.folder-items button{width:100%;border-radius:0;border-bottom:1px solid var(--line-divider);justify-content:flex-start;padding:15px 0;text-align:left;font-size:.85rem}.folder-items button>span:nth-child(2){flex:1}.folder-items small{color:var(--content-meta);font-size:.7rem}.workspace-note{font-size:.7rem;color:var(--content-meta);margin:12px 4px}.back{display:none}/* Keep typography foregrounds paired with the workbench theme in both modes. */
.prose{--tw-prose-headings:var(--studio-text);--tw-prose-bold:var(--studio-text);--tw-prose-code:var(--studio-text);max-width:none;font-size:.95rem;line-height:1.9;color:var(--studio-text)}.prose :global(img){max-width:100%;height:auto;border-radius:8px}.prose :global(table){display:block;overflow:auto;max-width:100%}.prose :global(td),.prose :global(th){border:1px solid var(--line-divider);padding:8px 12px}.prose :global(p){margin:1em 0}.prose :global(ul){list-style:disc;padding-left:1.5em}.prose :global(ol){list-style:decimal;padding-left:1.5em}.prose :global(h1),.prose :global(h2),.prose :global(h3){font-weight:700;margin:1.5em 0 .7em;line-height:1.5}.prose :global(h1){font-size:1.6em}.prose :global(h2){font-size:1.35em}.prose :global(h3){font-size:1.15em}.prose :global(blockquote){border-left:3px solid var(--primary);padding-left:16px;margin:1em 0;color:var(--content-meta)}.prose :global(a){color:var(--primary);text-decoration:underline}.prose :global(.katex-display){overflow-x:auto;overflow-y:hidden}
.drop-target{outline:2px dashed var(--primary);background:var(--btn-regular-bg)}.move-notice{display:flex;gap:12px;align-items:center;padding:10px 16px;font-size:.8rem;background:var(--card-bg);border:1px solid var(--line-divider);border-radius:8px;margin-top:10px}.move-notice button{color:var(--btn-content)}.move-notice button:last-child{margin-left:auto}.tree li{user-select:none}.tree li:not(.unfiled){cursor:grab}
@media(max-width:1100px){.panes{grid-template-columns:250px minmax(0,1fr)}.document{padding:26px 24px 50px}}
@media(max-width:700px){.heading{gap:8px;align-items:flex-start}.heading h1{font-size:1.3rem}.heading p{display:none}.heading-actions{font-size:.75rem}.heading-actions>.import-button{display:none}.heading{flex-direction:column}.heading-actions{flex-wrap:wrap;width:100%;gap:4px}.heading-actions>button{flex:1;white-space:nowrap}.panes{grid-template-columns:1fr;height:70dvh;min-height:500px}.directory{border-right:0;border-radius:14px}.reader{display:none}.mobile-reader .reader{display:flex}.mobile-reader .directory{display:none}.back{display:inline-flex;font-size:.75rem;white-space:nowrap}.breadcrumb{display:none}.reader-bar{padding:10px 12px;gap:4px}.reader-actions{gap:0;font-size:.75rem}.document{padding:24px 20px 50px}.document>h2{font-size:1.5rem}.folder-items small{max-width:80px}.workspace-note{font-size:.65rem}}
</style>
