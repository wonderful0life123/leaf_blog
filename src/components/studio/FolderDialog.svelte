<script>
import { onMount } from "svelte";
export let action;
export let name = "";
export let location = "全部文章";
export let busy = false;
export let onConfirm = async () => {};
export let onClose = () => {};
let dialog;
let input;
let error = "";
$: title =
	action === "create"
		? "新建目录"
		: action === "rename"
			? "重命名目录"
			: "删除空目录";
onMount(() => {
	const previous = document.activeElement;
	dialog.showModal();
	input?.focus();
	input?.select();
	return () => {
		dialog.close();
		if (previous?.isConnected) previous.focus();
	};
});
async function submit() {
	if (busy) return;
	error = "";
	try {
		await onConfirm(name);
	} catch (e) {
		error = e.message;
	}
}
</script>
<dialog bind:this={dialog} aria-label={title} on:cancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <form on:submit|preventDefault={submit}>
    <header><h2>{title}</h2><button type="button" aria-label="关闭目录窗口" disabled={busy} on:click={onClose}>×</button></header>
    <p class="location">{action==='create'?'创建位置':'所在位置'}：{location}</p>
    {#if action==='delete'}<p>删除目录「{name}」？只会删除这个空目录，完成后可撤销。</p>{:else}<label>目录名称<input bind:this={input} bind:value={name} maxlength="80" required disabled={busy} placeholder="例如：学习笔记"/></label>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer><button type="button" disabled={busy} on:click={onClose}>取消</button><button class="primary" class:danger={action==='delete'} disabled={busy||(action!=='delete'&&!name.trim())}>{busy?'正在保存…':action==='delete'?'删除空目录':'保存'}</button></footer>
  </form>
</dialog>
<style>
 dialog{width:min(440px,calc(100vw - 32px));max-height:85dvh;overflow:auto;margin:auto;padding:24px;border:1px solid var(--line-divider);border-radius:16px;background:var(--card-bg);color:var(--deep-text);box-shadow:0 20px 70px #0003}dialog::backdrop{background:#0005;backdrop-filter:blur(3px)}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h2{margin:0;font-size:1.2rem;font-weight:700}p{font-size:.85rem;line-height:1.7}.location{color:var(--content-meta);overflow-wrap:anywhere;margin:12px 0 20px}label{display:block;font-size:.85rem;font-weight:600}input{display:block;box-sizing:border-box;width:100%;padding:11px 12px;margin-top:8px;border:1px solid var(--line-divider);border-radius:8px;background:var(--page-bg);color:inherit;font:inherit}input:focus-visible,button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}button{font:inherit;border:0;border-radius:8px;padding:9px 14px;cursor:pointer;background:var(--btn-regular-bg);color:var(--btn-content)}button:disabled{opacity:.5;cursor:default}header button{font-size:22px;padding:0 8px;background:transparent}.primary{background:var(--primary);color:var(--card-bg);font-weight:600}.danger{background:#b94343;color:white}footer{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}.error{color:#c34848}
</style>
