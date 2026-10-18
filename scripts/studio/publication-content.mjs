import path from 'node:path';
import {createHash} from 'node:crypto';
import matter from 'gray-matter';
import {marked} from 'marked';
import {StoreError} from './store.mjs';
import {normalizeArticlePath,postUrl,routeFromPath} from '../../src/lib/article-paths.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new StoreError(422,message); };
export function articlePath(value) {
  try{return normalizeArticlePath(value);}catch(e){fail('文章路径无效：'+e.message);}
}
export function publicationContent(draft,input,{previous='',media,expectedHash,existingImage}={}) {
  if(draft.deletedAt)fail('请先恢复回收站中的草稿。');
  if(!draft.title.trim()||!draft.body.trim())fail('请先填写文章标题和正文。');
  const target=articlePath(input.path);
  if(expectedHash ? digest(previous)!==expectedHash : !!previous)throw new StoreError(409,'博客文章已有变化或路径已被占用，请先核对仓库内容，不能覆盖。');
  const data={...matter(previous).data};
  if(data.password)fail('加密文章暂不支持网页发布，请沿用本地编辑流程。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.published||'')||!Number.isFinite(Date.parse(input.published))||new Date(input.published).toISOString().slice(0,10)!==input.published)fail('请选择有效的发布日期。');
  if(typeof input.description!=='string'||input.description.length>1000)fail('摘要最多 1000 个字符。');
  const images=new Map(), warnings=[];
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif'};
  function publishImage(href,allowHttp=false) {
      if(/^https:\/\//i.test(href)||(allowHttp&&/^http:\/\//i.test(href))){warnings.push('含外部图片，发布后仍依赖原图片网站。');return href;}
      const ref=draft.assets?.[href]||href;
      const id=ref.match(/^\/studio-api\/media\/([a-f\d]{64})\/?$/)?.[1];
      if(!id)fail('有图片尚未保存到草稿库，请重新上传后再检查。');
      const image=media(id),ext=extension[image.mime];
      if(!ext||digest(image.bytes)!==id)fail('图片校验失败，请重新上传。');
      const retained=existingImage?.(href,image);
      const relative=retained||`assets/${path.posix.basename(target,'.md')}/${id}.${ext}`;
      if(!retained)images.set(path.posix.join(path.posix.dirname(target),relative),Buffer.from(image.bytes));
      return relative;
  }
  if(draft.cover!=null) {
    const cover=draft.cover;
    data.image=(!cover||cover==='api'||(/^\/(?!\/)/.test(cover)&&!cover.startsWith('/studio-api/')))?cover:publishImage(cover,true);
  }
  const tokens=marked.lexer(draft.body);
  // Rewrite only parsed image syntax, never code examples or unrelated prose.
  let cursor=0;
  const chunks=tokens.map(block=>{
    const start=draft.body.indexOf(block.raw,cursor);
    const gap=draft.body.slice(cursor,start);cursor=start+block.raw.length;
    if(['code','html'].includes(block.type)){if(block.type==='html')fail('发布检查暂不支持原始 HTML，请改用 Markdown 图片、链接或代码块。');return gap+block.raw;}
    const replacements=[];
    marked.walkTokens([block],token=>{
      if(token.type==='html')fail('发布检查暂不支持原始 HTML，请改用 Markdown 语法。');
      if(token.type==='codespan'){replacements.push([token.raw,token.raw]);return;}
      if(token.type!=='image')return;
      const relative=publishImage(token.href);
      if(relative===token.href)return;
      const alt=String(token.text).replace(/[\[\]\\\r\n]/g,' '),title=token.title?' '+JSON.stringify(token.title):'';
      replacements.push([token.raw,`![${alt}](${relative}${title})`]);
    });
    let raw='',offset=0;
    for(const [before,after] of replacements){const at=block.raw.indexOf(before,offset);if(at<0)fail('无法转换图片引用，请改用直接插入图片的 Markdown 语法。');raw+=block.raw.slice(offset,at)+after;offset=at+before.length;}
    return gap+raw+block.raw.slice(offset);
  });
  // Definitions have no display tokens and must remain for ordinary reference links.
  const body=chunks.join('')+draft.body.slice(cursor);
  const now=new Date().toISOString().slice(0,10);
  Object.assign(data,{title:draft.title.trim(),category:draft.category,tags:draft.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean),description:input.description.trim(),published:new Date(input.published),draft:false});
  if(previous)data.updated=new Date(now);
  const text=matter.stringify(body,data);
  return {path:target,text,images:[...images].map(([file,bytes])=>({path:file,bytes})),warnings:[...new Set(warnings)],url:postUrl(routeFromPath(target)),hash:digest(text)};
}
