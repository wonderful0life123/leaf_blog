<script>
import { onMount, tick } from "svelte";
import { fly } from "svelte/transition";
import { folderPath, withinFolder } from "../../lib/studio-organization.mjs";
export let subject;
export let organization;
export let busy = false;
export let onConfirm = async () => {};
export let onClose = () => {};
export let initialTarget = null;
let reducedMotion = false;
let target = initialTarget;
let searching = false;
let query = "";
let error = "";
let panel;
let previousFocus;
let openLevel = null;
const path = (id) =>
	folderPath(organization.folders, id) || "全部文章（根目录）";
$: allowed = organization.folders.filter(
	(f) =>
		subject.kind !== "folder" ||
		!withinFolder(organization.folders, f.id, subject.id),
);
$: levels = makeLevels(allowed, target);
$: results = allowed.filter((f) =>
	path(f.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
);
$: changed = target !== subject.parent;
$: opened = levels.find((level) => level.index === openLevel);
$: options = opened
	? [
			{
				id: "",
				name: opened.index === 0 ? "全部文章（根目录）" : "留在当前目录",
			},
			...opened.children,
		]
	: [];
function makeLevels(folders, selectedId) {
	let id = selectedId;
	const chain = [];
	while (id) {
		const f = folders.find((f) => f.id === id);
		if (!f) break;
		chain.unshift(f);
		id = f.parent;
	}
	const output = [];
	let parent = null;
	for (let i = 0; i <= chain.length; i++) {
		const children = folders
			.filter((f) => f.parent === parent)
			.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
		if (!children.length && i > 0) break;
		output.push({ index: i, parent, chosen: chain[i]?.id || "", children });
		parent = chain[i]?.id;
	}
	return output;
}
onMount(() => {
	reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	previousFocus = document.activeElement;
	panel?.focus();
	return () => {
		tick().then(() => {
			if (previousFocus?.isConnected) previousFocus.focus();
		});
	};
});
function mobilePortal(node) {
	const anchor = document.createComment("move-drawer");
	node.before(anchor);
	const media = window.matchMedia("(max-width: 700px)");
	const position = () => {
		if (media.matches) document.body.appendChild(node);
		else anchor.parentNode?.insertBefore(node, anchor.nextSibling);
	};
	position();
	media.addEventListener("change", position);
	return {
		destroy() {
			media.removeEventListener("change", position);
			node.remove();
			anchor.remove();
		},
	};
}
function close() {
	if (!busy) onClose();
}
function keydown(e) {
	if (e.key === "Escape" && !e.defaultPrevented) {
		e.preventDefault();
		e.stopPropagation();
		if (openLevel !== null) {
			openLevel = null;
			panel?.querySelector(".level button")?.focus();
		} else close();
	}
	if (e.key === "Tab") {
		const controls = [
			...panel.querySelectorAll("button:not(:disabled),input:not(:disabled)"),
		].filter((el) => el.getClientRects().length);
		const first = controls[0];
		const last = controls.at(-1);
		if (
			e.shiftKey &&
			(document.activeElement === first || document.activeElement === panel)
		) {
			e.preventDefault();
			last?.focus();
		} else if (
			!e.shiftKey &&
			(document.activeElement === last || document.activeElement === panel)
		) {
			e.preventDefault();
			first?.focus();
		}
	}
}
async function confirm() {
	error = "";
	try {
		await onConfirm({ kind: subject.kind, id: subject.id, target });
	} catch (e) {
		error = e.message;
	}
}
async function toggleSearch() {
	openLevel = null;
	searching = !searching;
	await tick();
	panel?.querySelector("input")?.focus();
}
</script>
<svelte:window on:keydown={keydown}/>
<div class="shade" use:mobilePortal aria-hidden="true"></div>
<div class="move-drawer" use:mobilePortal role="dialog" aria-modal="true" aria-label={'移动'+subject.label} tabindex="-1" bind:this={panel} transition:fly={{y:35,duration:reducedMotion?0:180}}>
  <div class="drawer-head"><div><h3>移动到</h3><p>{subject.label}{subject.kind==='folder'?' · 包含全部子目录和文章':''}</p></div><button aria-label="关闭移动面板" disabled={busy} on:click={close}>×</button></div>
  <div class="mode"><span>当前位置：{subject.parent===undefined?'未归档草稿':path(subject.parent)}</span><button disabled={busy} on:click={toggleSearch}>{searching?'逐级选择':'搜索目录'}</button></div>
  <div class="destinations">
    {#if searching}
      <input aria-label="搜索目标目录" placeholder="输入目录名称或完整路径…" bind:value={query} disabled={busy}/>
      <div class="results"><button class:chosen={target===null} disabled={busy} on:click={()=>target=null}>全部文章（根目录）</button>{#each results as folder}<button class:chosen={target===folder.id} disabled={busy} on:click={()=>target=folder.id}>{path(folder.id)}{target===folder.id?' ✓':''}</button>{/each}{#if !results.length}<p>没有匹配的目录</p>{/if}</div>
    {:else}
      <div class="levels">{#each levels as level}<div class="level"><span>{level.index+1} 级目录</span><button class="picker" aria-label={(level.index+1)+' 级目录'} aria-expanded={openLevel===level.index} disabled={busy} on:click={()=>openLevel=openLevel===level.index?null:level.index}><span>{level.children.find(f=>f.id===level.chosen)?.name||(level.index===0?'全部文章（根目录）':'留在当前目录')}</span><span aria-hidden="true">⌄</span></button></div>{/each}</div>
      {#if opened}<div class="choices" role="group" aria-label={(opened.index+1)+' 级目录选项'}>{#each options as option}<button disabled={busy} class:chosen={opened.chosen===option.id} aria-pressed={opened.chosen===option.id} on:click={()=>{target=option.id||opened.parent;openLevel=null;}}><span>{option.name}</span><span aria-hidden="true">{opened.chosen===option.id?'✓':''}</span></button>{/each}</div>{/if}
    {/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="drawer-bottom"><div><p>移至 <strong>{path(target)}</strong></p><small>先保存到工作台 · 应用调整后文件和网址同步移动</small></div><div class="buttons"><button disabled={busy} on:click={close}>取消</button><button class="primary" disabled={busy||!changed} on:click={confirm}>{busy?'正在保存…':'确认移动'}</button></div></div>
</div>
<style>
:global(body:has(.move-drawer) .floating-controls-container){display:none!important}
.shade{position:absolute;inset:0;background:#0000000a;z-index:65;border-radius:0 14px 14px 0}.move-drawer{--studio-text:rgba(0,0,0,.9);position:absolute;bottom:0;left:0;right:0;z-index:70;background:var(--card-bg);border:1px solid var(--line-divider);border-radius:16px 16px 13px 0;padding:22px 26px;box-shadow:0 -12px 35px #0002;color:var(--studio-text);max-height:90%;display:flex;flex-direction:column;font-size:.85rem;outline:none}h3,p{margin:0}h3{font-size:1.05rem;font-weight:650}.drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.drawer-head p{margin-top:5px;color:var(--content-meta);overflow-wrap:anywhere}.drawer-head>button{font-size:1.6rem;padding:0 6px}.mode{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 12px;color:var(--content-meta);font-size:.75rem}.mode span{overflow-wrap:anywhere}.mode button{white-space:nowrap;color:var(--btn-content)}button,input{font:inherit}button{border:0;background:transparent;color:inherit;cursor:pointer;padding:8px 12px;border-radius:7px}button:hover{background:var(--btn-regular-bg)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.primary{background:var(--primary);color:var(--card-bg);font-weight:600}.primary:hover{background:var(--primary)}.destinations{min-height:60px;overflow:auto;max-height:40dvh;padding:3px}.levels{display:flex;flex-wrap:wrap;gap:12px}.picker{display:flex;gap:12px;justify-content:space-between;width:100%;min-height:38px;border:1px solid var(--line-divider);background:var(--card-bg);text-align:left}.picker span:first-child{overflow-wrap:anywhere}.picker[aria-expanded=true]{border-color:var(--primary);color:var(--btn-content)}.choices{border:1px solid var(--line-divider);border-radius:9px;max-height:180px;overflow:auto;padding:5px;margin-top:12px;background:var(--card-bg)}.choices button{display:flex;justify-content:space-between;width:100%;text-align:left}.choices button.chosen{background:var(--btn-regular-bg);color:var(--btn-content)}.level{min-width:150px}.level>span{display:block;color:var(--content-meta);font-size:.7rem;margin-bottom:6px}.drawer-bottom{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-top:24px;padding-top:16px;border-top:1px solid var(--line-divider)}.drawer-bottom strong{color:var(--btn-content)}.drawer-bottom small{display:block;font-size:.7rem;color:var(--content-meta);margin-top:5px}.buttons{display:flex;gap:8px;flex-shrink:0}.results{max-height:180px;overflow:auto;margin-top:8px}.results button{display:block;width:100%;text-align:left;overflow-wrap:anywhere}.results .chosen{background:var(--btn-regular-bg);color:var(--btn-content)}input{width:100%;border:1px solid var(--line-divider);background:var(--card-bg);color:inherit;border-radius:8px;padding:10px}.error{color:var(--admonitions-color-caution,#b83d45);margin-top:14px}
:global(.dark) .move-drawer{--studio-text:rgba(255,255,255,.9)}
@media(max-width:700px){.shade{position:fixed;z-index:9990}.move-drawer{position:fixed;z-index:9991;padding:18px 16px max(20px,env(safe-area-inset-bottom));border-radius:18px 18px 0 0;max-height:85dvh}.drawer-bottom{align-items:flex-start;flex-wrap:wrap}.buttons{margin-left:auto}.level{min-width:135px}.drawer-head p{max-width:280px}}
@media(prefers-reduced-motion:reduce){.move-drawer{transition:none!important;animation:none!important}}
</style>
