<script>
  import Icon from '../common/Icon.svelte';
  import StudioMenu from './StudioMenu.svelte';
  import {onMount,tick} from 'svelte';
  import {createTableHistory} from './table-history.mjs';
  export let initial;
  export let disabled=false;
  export let error='';
  export let onSave=()=>{};
  export let onCancel=()=>{};
  const history=createTableHistory(initial);
  let table=history.value.table,row=0,column=0,dialog,grid,composing=false,canUndo=false,canRedo=false;
  function sync(){const value=history.value;table=value.table;row=value.row;column=value.column;canUndo=history.canUndo;canRedo=history.canRedo;}
  function focus(r,c){history.focus(r,c);row=r;column=c;}
  function input(event,r,c){if(disabled)return;history.focus(r,c);history.editCell(event.currentTarget.value,{inputType:event.inputType||'insertText',composing:composing||event.isComposing});sync();}
  function compositionStart(){composing=true;history.breakGroup();}
  function compositionEnd(event,r,c){input(event,r,c);composing=false;history.breakGroup();}
  function restore(redo=false){if(disabled||composing)return;if(redo?history.redo():history.undo()){sync();focusCell(row,column);}}
  function historyKey(event){
    if(event.isComposing||composing||event.altKey||!(event.metaKey||event.ctrlKey))return;
    const key=event.key.toLowerCase();
    if(key==='z'||(key==='y'&&event.ctrlKey&&!event.metaKey)){
      event.preventDefault();event.stopPropagation();restore(key==='y'||event.shiftKey);
    }
  }
  function beforeInput(event){
    if(!composing&&!event.isComposing&&['historyUndo','historyRedo'].includes(event.inputType)){
      event.preventDefault();event.stopPropagation();restore(event.inputType==='historyRedo');
    }
  }
  onMount(()=>{dialog.showModal();focusCell(0,0);return()=>dialog.close();});
  async function focusCell(r,c){await tick();grid?.querySelector(`[data-cell="${r}-${c}"]`)?.focus();}
  function cellKey(event,r,c){
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))history.breakGroup();
    if(event.key!=='Tab'||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
    const index=r*table.align.length+c+(event.shiftKey?-1:1);
    if(index<0||index>=table.rows.length*table.align.length)return;
    event.preventDefault();focusCell(Math.floor(index/table.align.length),index%table.align.length);
  }
  function resize(action){if(disabled)return;history.resize(action);sync();focusCell(row,column);}
  function align(value){if(disabled)return;history.align(value);sync();}

</script>

<dialog bind:this={dialog} aria-labelledby="table-editor-title" on:cancel|preventDefault on:keydown={historyKey} on:beforeinput={beforeInput}>
  <div class="table-heading"><div><span>wonder · 写作空间</span><h2 id="table-editor-title">编辑表格</h2></div><span>{table.rows.length-1} 行内容 · {table.align.length} 列</span></div>
  <p class="hint">第一行为表头。Tab 切换单元格，⌘ / Ctrl + Z 逐步撤销；完成后保存到正文。</p>
  <fieldset disabled={disabled}>
    <div class="tools">
      <button aria-label="撤销表格修改" title="撤销（⌘ / Ctrl + Z）" disabled={!canUndo||disabled||composing} on:click={()=>restore()}><Icon icon="material-symbols:undo-rounded"/>撤销</button>
      <button aria-label="重做表格修改" title="重做（⌘ / Ctrl + Shift + Z）" disabled={!canRedo||disabled||composing} on:click={()=>restore(true)}><Icon icon="material-symbols:redo-rounded"/>重做</button>
      <span>{row===0?'表头':'第 '+row+' 行'} · 第 {column+1} 列</span>
      <button on:click={()=>resize('add-row')}>下方插入行</button>
      <button disabled={row===0||disabled} on:click={()=>resize('delete-row')}>删除当前行</button>
      <button on:click={()=>resize('add-column')}>右侧插入列</button>
      <button disabled={table.align.length===1||disabled} on:click={()=>resize('delete-column')}>删除当前列</button>
      <StudioMenu label="当前列对齐" value={table.align[column]||'default'} options={[{value:'default',label:'默认对齐'},{value:'left',label:'左对齐'},{value:'center',label:'居中'},{value:'right',label:'右对齐'}]} {disabled} onSelect={value=>align(value==='default'?null:value)}/>
    </div>
    <div class="grid" bind:this={grid}>
      <table aria-label="表格单元格"><tbody>
        {#each table.rows as cells,r}<tr class:header={r===0}>
          {#each cells as cell,c}<td class:selected={r===row&&c===column}>
            <input data-cell={`${r}-${c}`} aria-label={`${r===0?'表头':'第 '+r+' 行'}，第 ${c+1} 列`} value={table.rows[r][c]} on:input={event=>input(event,r,c)} on:compositionstart={compositionStart} on:compositionend={event=>compositionEnd(event,r,c)} on:blur={()=>history.breakGroup()} on:click={()=>history.breakGroup()} style:text-align={table.align[c]||'left'} on:focus={()=>focus(r,c)} on:keydown={event=>cellKey(event,r,c)}/>
          </td>{/each}
        </tr>{/each}
      </tbody></table>
    </div>
  </fieldset>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <div class="footer"><span>保存为标准 Markdown · 保存后可撤销</span><div><button on:click={onCancel}>取消修改</button><button class="primary" disabled={disabled} on:click={()=>onSave(table)}>保存表格</button></div></div>
</dialog>

<style>
dialog{color-scheme:light;color:var(--studio-text);background:var(--card-bg);border:1px solid var(--line-divider);border-radius:16px;padding:24px;width:min(960px,calc(100vw - 32px));max-height:calc(100dvh - 40px);overflow:auto;margin:auto;box-shadow:0 20px 80px #0003}dialog::backdrop{background:#0006;backdrop-filter:blur(4px)}.table-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.table-heading span,.hint,.footer>span{font-size:12px;color:var(--content-meta)}.table-heading>div>span{color:var(--btn-content)}h2{font-size:23px;font-weight:700;margin:4px 0 12px}.hint{line-height:1.7;margin-bottom:16px}fieldset{padding:0;border:0;min-width:0}.tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px;background:var(--page-bg);border-radius:8px 8px 0 0}.tools>span{font-size:12px;color:var(--content-meta);margin-right:6px}.tools label{display:flex;align-items:center;font-size:12px;gap:6px}button,select{font:inherit;font-size:13px;border:1px solid var(--line-divider);border-radius:6px;padding:7px 10px;color:var(--btn-content);background:var(--btn-regular-bg);cursor:pointer}button:disabled{opacity:.4;cursor:not-allowed}button:hover:not(:disabled){background:var(--btn-regular-bg-hover)}button:focus-visible,select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.grid{overflow:auto;max-height:50dvh;border:1px solid var(--line-divider)}table{border-collapse:collapse;width:100%}td{border:1px solid var(--line-divider);min-width:160px;padding:0;background:var(--card-bg)}td.selected{box-shadow:inset 0 0 0 2px var(--primary)}input{width:100%;min-width:150px;padding:12px;background:transparent;font:inherit;font-size:14px;color:var(--studio-text);border:none;outline:none}.header{background:var(--page-bg)}.header input{font-weight:700}.footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:20px}.footer>div{display:flex;gap:8px}.primary{background:var(--primary);color:white}.error{margin-top:12px;color:var(--studio-text);border-left:3px solid var(--primary);padding-left:10px}@media(max-width:700px){dialog{padding:16px}.table-heading{align-items:start}.footer{align-items:stretch;flex-direction:column}.footer>div{justify-content:flex-end}.tools{gap:6px}.tools>span{width:100%}}
button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:34px}.tools{align-items:center}.footer .primary{background:var(--primary);color:white}
:global(.dark) dialog{color-scheme:dark}
</style>
