<script>
import { categoryLevels } from "./category-options.mjs";
import StudioMenu from "./StudioMenu.svelte";
export let folders = [];
export let value = "";
export let disabled = false;
export let onSelect = () => {};
$: model = categoryLevels(folders, value);
</script>

<div class="category-picker" role="group" aria-label="所在目录">
  <div class="heading">目录</div>
  {#each model.levels as level (level.index)}
    <div class="level">
      <span class="level-label">第 {level.index + 1} 级</span>
      <StudioMenu label={'第 '+(level.index+1)+' 级目录'} options={level.options} value={level.value} {disabled} contained onSelect={next=>{if(next!==value)onSelect(next);}}/>
    </div>
  {/each}
  <div class="summary">当前目录：<span>{value || '根目录'}</span></div>
  {#if model.legacy}<p>请从工作台目录中选择位置。</p>{/if}
  <p>与工作台文件树一致。选择后保存为待调整位置，确认发布后同步。</p>
</div>

<style>
.category-picker{min-width:0;margin:1rem 0;color:var(--content-meta);font-size:.8rem}
.heading{color:var(--content-primary);margin-bottom:.65rem}
.level{margin-bottom:.65rem}.level-label{display:block;font-size:.72rem;margin-bottom:.35rem}
.summary{line-height:1.6;overflow-wrap:anywhere;margin-top:.7rem}.summary span{color:var(--primary)}
p{font-size:.72rem;line-height:1.7;margin:.4rem 0 0}
</style>
