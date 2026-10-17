<script>
import { onMount } from "svelte";
export let request;
export let getOrganization;
export let onClose = () => {};
export let onJob = () => {};
function close() {
	if (!pending) onClose();
}
let dialog;
let info = null;
let job = null;
let error = "";
let pending = false;
let consent = false;
let pollTimer;
let alive = true;
$: running = job && ["building", "publishing"].includes(job.state);
$: groups = (job?.archiveRows || []).reduce((groups, row) => {
	const name = row.path.join(" / ") || "全部文章（根目录）";
	let group = groups.find((g) => g.name === name);
	if (!group) {
		group = { name, rows: [] };
		groups.push(group);
	}
	group.rows.push(row);
	return groups;
}, []);
function schedule() {
	if (job) onJob(job);
	clearTimeout(pollTimer);
	if (alive && job && ["building", "publishing"].includes(job.state))
		pollTimer = setTimeout(poll, 1000);
}
async function poll() {
	try {
		const result = await request("/publications/" + job.id);
		if (alive) {
			job = result.publication;
			error = "";
			schedule();
		}
	} catch (e) {
		if (alive) {
			error = "暂时无法更新进度。任务会继续，可重新连接查看。";
		}
	}
}
onMount(() => {
	const previous = document.activeElement;
	dialog.showModal();
	(async () => {
		try {
			info = await request("/organization/publication");
			if (alive) {
				job = info.latest;
				schedule();
			}
		} catch (e) {
			if (alive) error = e.message;
		}
	})();
	return () => {
		alive = false;
		clearTimeout(pollTimer);
		dialog.close();
		if (previous?.isConnected) previous.focus();
	};
});
async function prepare() {
	pending = true;
	error = "";
	consent = false;
	try {
		const org = await getOrganization();
		const result = await request("/organization/publication", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ revision: org.revision }),
		});
		job = result.publication;
		schedule();
	} catch (e) {
		error = e.message;
	} finally {
		pending = false;
	}
}
async function confirm() {
	if (!consent || !info?.enabled) return;
	pending = true;
	error = "";
	try {
		const result = await request("/publications/" + job.id, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ revision: job.revision, confirm: true }),
		});
		job = result.publication;
		schedule();
	} catch (e) {
		error = e.message;
	} finally {
		pending = false;
	}
}
</script>
<dialog bind:this={dialog} aria-label="应用目录调整" on:cancel={event=>{event.preventDefault();close();}}>
  <header><div><span class="eyebrow">wonder · 文章工作台</span><h2>应用目录调整</h2></div><button aria-label="关闭应用目录调整" disabled={pending} on:click={close}>×</button></header>
  <p>把工作台中的文章位置同步到 GitHub 文件夹和博客目录。仅整理已发布文章，草稿、空目录和未发布的正文修改不会公开。</p>
  <div class="note">文章网址随新目录改变，旧网址自动跳转；图片保持可用。确认前，公开网站保持原位置。</div>
  {#if job}
    <div class="status" role="status">{job.state==='building'?'正在核对公开文章和目录…':job.state==='publishing'?'正在发布目录，可以关闭此窗口，稍后回来查看。':job.state==='published'?'文件与博客目录已同步。':job.state==='ready'?`目录已准备好 · ${job.archiveRows?.length||0} 篇公开文章 · ${job.archiveChanges||0} 篇待同步`:job.state==='retry'?'提交已准备，等待重试上线。':'准备或发布未完成。'}</div>
    {#if job.error}<p class="error" role="alert">{job.error}</p>{/if}
    {#if groups.length}
      <section class="tree" aria-label="读者将看到的目录">
        {#each groups as group}<div class="folder"><h3>▱ {group.name}<small>{group.rows.length}</small></h3><ul>{#each group.rows as row}<li><strong>{row.title}</strong><small>{#if row.oldPath===row.newPath}{row.newPath} · 分类与目录对齐{:else}{row.oldPath} → {row.newPath}{/if}</small><small class="route">新网址：{decodeURI(row.url)}</small>{#if JSON.stringify(row.path)!==JSON.stringify(row.previous)}<small>从 {row.previous.join(' / ')||'根目录'} 移入</small>{/if}</li>{/each}</ul></div>{/each}
      </section>
    {/if}
  {:else if !info&&!error}<p role="status">正在读取发布状态…</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{#if running}<button on:click={poll}>重新连接</button>{/if}{/if}
  {#if info&&!info.enabled}<p class="hint">当前环境仅可检查目录，正式发布未开启。</p>{/if}
  {#if info?.enabled&&job&&['ready','retry'].includes(job.state)}<label class="consent"><input type="checkbox" bind:checked={consent}/>我已核对上述目录，确认更新公开博客。</label>{/if}
  <footer><button disabled={pending} on:click={close}>返回工作台</button><div><button disabled={pending||running||!info?.available||job?.state==='retry'} on:click={prepare}>{job?'重新检查目录':'检查应用目录调整'}</button>{#if job&&['ready','retry'].includes(job.state)}<button class="primary" disabled={pending||!info?.enabled||!consent} on:click={confirm}>{job.state==='retry'?'重试上线':'确认应用调整'}</button>{/if}</div></footer>
</dialog>
<style>
dialog{width:min(760px,calc(100vw - 24px));max-height:90dvh;overflow:auto;margin:auto;padding:28px;border:1px solid var(--line-divider);border-radius:18px;background:var(--card-bg);color:var(--deep-text);box-shadow:0 20px 70px #0003}dialog::backdrop{background:#0005;backdrop-filter:blur(3px)}header,footer,footer>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.eyebrow{font-size:.75rem;letter-spacing:.08em;color:var(--primary)}h2{font-size:1.5rem;font-weight:700;margin:8px 0 16px}p,.note,.status{font-size:.85rem;line-height:1.8}.note,.hint{color:var(--content-meta)}.status{margin:18px 0;padding:12px 16px;background:var(--btn-regular-bg);border-radius:10px}.tree{border:1px solid var(--line-divider);border-radius:12px;padding:12px 18px;max-height:42dvh;overflow:auto}.folder h3{font-size:.9rem;color:var(--primary);font-weight:600;display:flex;justify-content:space-between;overflow-wrap:anywhere}.folder ul{border-left:1px dashed var(--line-divider);margin:8px 0 18px 8px;padding-left:16px;list-style:none}li{padding:7px 0;font-size:.85rem}li small{display:block;overflow-wrap:anywhere}li strong{font-weight:500;display:block}small{font-size:.72rem;color:var(--content-meta);font-weight:400}.consent{display:flex;gap:8px;align-items:center;font-size:.85rem;margin:18px 0}footer{margin-top:20px}button{font:inherit;font-size:.82rem;border:0;border-radius:8px;padding:10px 14px;cursor:pointer;background:var(--btn-regular-bg);color:var(--btn-content)}button:disabled{opacity:.5;cursor:default}header button{font-size:24px;background:transparent}.primary{background:var(--primary);color:var(--card-bg);font-weight:600}.error{color:#c34848}button:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}@media(max-width:600px){dialog{padding:20px}footer{align-items:stretch;flex-direction:column}footer>div{flex-wrap:wrap}footer button{flex:1}.tree{padding:10px}.consent{align-items:flex-start}}
</style>
