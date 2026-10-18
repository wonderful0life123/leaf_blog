<script>
  export let value = '';
  export let src = '';
  export let disabled = false;
  export let onUpload;
  export let onChange;
  export let onUploadState;
  let input;
  let uploading = false;
  let error = '';
  let failed = false;
  $: if (src) failed = false;
  async function select(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || disabled || uploading) return;
    error = '';
    if (file.size > 10 * 1024 * 1024) { error = '每张图片最多 10 MB'; return; }
    uploading = true;
    onUploadState(true);
    try { onChange(await onUpload(file)); }
    catch (e) { error = e.message || '封面上传失败，请重试'; }
    finally { uploading = false; onUploadState(false); }
  }
</script>

<section class="cover-picker" aria-labelledby="cover-heading">
  <h4 id="cover-heading">文章封面 <span>可选</span></h4>
  {#if value && src && !failed}
    <div class="cover-image"><img {src} alt="当前文章封面" on:error={()=>failed=true}/></div>
  {:else}
    <div class="cover-empty">
      <span aria-hidden="true">▧</span>
      <p>{value==='api'?'当前使用主题随机封面':value?'已有封面暂时无法显示':'还没有封面'}</p>
    </div>
  {/if}
  <input bind:this={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" aria-label="选择文章封面" on:change={select} hidden />
  <div class="cover-actions">
    <button type="button" disabled={disabled||uploading} on:click={()=>input.click()}>{uploading?'正在上传…':value?'更换封面':'上传封面'}</button>
    {#if value}<button type="button" class="remove" disabled={disabled||uploading} on:click={()=>{error='';onChange('');}}>移除</button>{/if}
  </div>
  <p class="hint">用于首页文章卡片和文章顶部。确认发布后生效。</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .cover-picker{min-width:0;grid-column:1/-1;border-top:1px solid var(--line-divider);padding-top:1rem;margin-top:1rem;}
  h4{display:flex;align-items:center;gap:.5rem;font-size:.85rem;font-weight:600;margin:0 0 .7rem;}
  h4 span{color:var(--content-meta);font-size:.72rem;font-weight:400;}
  .cover-image,.cover-empty{aspect-ratio:16/9;border-radius:.7rem;overflow:hidden;background:var(--btn-regular-bg);border:1px solid var(--line-divider);}
  .cover-image img{display:block;width:100%;height:100%;object-fit:cover;}
  .cover-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--content-meta);}
  .cover-empty span{font-size:1.7rem;}.cover-empty p{font-size:.78rem;margin:.25rem .5rem;text-align:center;}
  .cover-actions{display:flex;gap:.5rem;margin-top:.65rem;}
  button{border-radius:.5rem;padding:.5rem .75rem;background:var(--btn-regular-bg);color:var(--btn-content);font-size:.78rem;}
  button:hover:not(:disabled){background:var(--btn-regular-bg-hover);}button:disabled{opacity:.55;cursor:wait;}
  button:focus-visible{outline:2px solid var(--primary);outline-offset:2px;}.remove{background:transparent;color:var(--content-meta);}
  .hint,.error{font-size:.72rem;line-height:1.7;margin:.6rem 0 0;color:var(--content-meta);}.error{color:#b42318;}
  @media(max-width:640px){.cover-image,.cover-empty{max-height:180px;aspect-ratio:auto;min-height:110px;}.cover-image img{max-height:180px;}}
</style>
