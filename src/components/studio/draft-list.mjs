export function selectArticles(items,filter,query,sort='updated'){
  const q=query.trim().toLocaleLowerCase();
  return items.filter(a=>(filter==='all'||filter==='trash'||a.status===(filter==='draft'?'draft':'published'))&&[a.title,a.body,a.category,a.tags].join(' ').toLocaleLowerCase().includes(q)).sort((a,b)=>{
    if(sort==='title')return (a.title||'未命名文章').localeCompare(b.title||'未命名文章','zh-CN')||a.id.localeCompare(b.id);
    const time=d=>Date.parse((sort==='created'?d.createdAt:filter==='trash'?d.deletedAt:d.updatedAt)||d.published||'')||0;
    return time(b)-time(a)||a.id.localeCompare(b.id);
  });
}
export function excerpt(article){
  return (article.body||article.description||'').replace(/!\[[^\]]*\]\([^)]*\)/g,'[图片]').replace(/[#*`>\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,120)||'还没有正文，打开继续写作。';
}
export function displayDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
