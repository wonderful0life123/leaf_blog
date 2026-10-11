<script>
  import {tick} from 'svelte';
  export let label;
  export let options = [];
  export let value = undefined;
  export let disabled = false;
  export let compact = false;
  export let onSelect = () => {};
  let open = false, root, trigger, panel;
  async function show(last=false) {
    open=true; await tick();
    const buttons=panel?.querySelectorAll('button');
    const index=last ? buttons.length-1 : Math.max(0,options.findIndex(option=>option.value===value));
    buttons?.[index]?.focus();
  }
  function close(restore=false){open=false;if(restore)trigger?.focus();}
  function outside(event){if(open&&!root?.contains(event.target))close();}
  function navigate(event){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    const buttons=[...panel.querySelectorAll('button')];
    const index=buttons.indexOf(document.activeElement);
    const next={ArrowDown:(index+1)%buttons.length,ArrowUp:(index-1+buttons.length)%buttons.length,Home:0,End:buttons.length-1}[event.key];
    if(next!==undefined){event.preventDefault();buttons[next]?.focus();}
  }
</script>

<svelte:window on:pointerdown={outside} on:focusin={outside}/>
<div class="menu" bind:this={root}>
  <button class="trigger" class:compact bind:this={trigger} {disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} on:click={()=>open?close():show()} on:keydown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show(event.key==='ArrowUp');}}}>
    {#if compact}<span aria-hidden="true">···</span>{:else}<span>{options.find(option=>option.value===value)?.label||label}</span><span class="chevron" aria-hidden="true">⌄</span>{/if}
  </button>
  {#if open}
    <div class="panel" role="menu" aria-label={label} bind:this={panel} on:keydown={navigate}>
      {#each options as option}
        <button role={value===undefined?'menuitem':'menuitemradio'} aria-checked={value===undefined?undefined:value===option.value} class:selected={value!==undefined&&value===option.value} class:danger={option.danger} on:click={()=>{close(true);onSelect(option.value);}}><span>{option.label}</span>{#if value!==undefined}<span class="check" aria-hidden="true">{value===option.value?'✓':''}</span>{/if}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
.menu{position:relative;flex-shrink:0;font:inherit}
button{font:inherit;cursor:pointer;border:0;transition:background .15s;color:var(--content-meta)}
button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.trigger{display:flex;align-items:center;gap:.8rem;min-height:36px;padding:.4rem .75rem;background:var(--card-bg);border:1px solid var(--line-divider);border-radius:.6rem;font-size:.8rem}
.trigger:hover,.trigger[aria-expanded=true]{background:var(--btn-regular-bg);color:var(--btn-content)}
.chevron{font-size:1rem;line-height:1}.trigger.compact{font-size:1.25rem;letter-spacing:2px;padding:0 .55rem;min-width:36px;justify-content:center;border-color:transparent;background:transparent}
.panel{position:absolute;right:0;top:calc(100% + .4rem);z-index:60;min-width:10rem;padding:.35rem;border:1px solid var(--line-divider);border-radius:.8rem;background:var(--card-bg);box-shadow:0 8px 28px #0002}
.panel button{display:flex;align-items:center;justify-content:space-between;gap:1rem;width:100%;text-align:left;padding:.6rem .7rem;min-height:40px;border-radius:.5rem;background:transparent;font-size:.85rem;white-space:nowrap}
.panel button:hover,.panel button:focus-visible,.panel button.selected{background:var(--btn-regular-bg);color:var(--btn-content)}.check{width:1rem;color:var(--primary)}.panel button.danger{color:var(--admonitions-color-caution,#b83d45)}
@media(max-width:700px){.trigger{min-height:42px}.panel button{min-height:44px}}
</style>
