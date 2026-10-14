import {createRequire} from 'node:module';
import {markdownOptions, expressiveOptions} from '../../src/markdown.config';
import {siteConfig, expressiveCodeConfig} from '../../src/config';
import {visit} from 'unist-util-visit';
import matter from 'gray-matter';

// Use the exact engines installed for Astro, with the same shared plugin options.
const astroRequire=createRequire(import.meta.resolve('astro'));
const codeRequire=createRequire(import.meta.resolve('astro-expressive-code'));
const {createMarkdownProcessor}=await import(astroRequire.resolve('@astrojs/markdown-remark'));
const {default:expressiveCode}=await import(codeRequire.resolve('rehype-expressive-code'));
export const calloutTheme=siteConfig.rehypeCallouts.theme;
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// The validated image bytes are already in the private job; avoid Astro's full-site image pipeline.
function previewImages(){return (tree:any,file:any)=>{
  const assets=file.data.astro.frontmatter.previewAssets;
  // Markdown percent-encodes Unicode/spaces in img.src. Compare each URL in
  // one decoded form, without decoding twice or resolving new filesystem paths.
  // Targets still come exclusively from the caller's validated asset map.
  const key=(value:string)=>{try{return decodeURIComponent(value);}catch{return value;}};
  const normalized=new Map(Object.entries(assets).map(([source,target])=>[key(source),target]));
  visit(tree,'element',(node:any)=>{
    if(node.tagName!=='img'||typeof node.properties.src!=='string')return;
    const source=node.properties.src;
    const target=Object.hasOwn(assets,source)?assets[source]:normalized.get(key(source));
    if(typeof target==='string')node.properties.src=target;
  });
  file.data.astro.localImagePaths=[];file.data.astro.remoteImagePaths=[];
};}
const processor=await createMarkdownProcessor({...markdownOptions,syntaxHighlight:false,rehypePlugins:[
  [expressiveCode,{...expressiveOptions,defaultProps:{...expressiveOptions.defaultProps,collapse:false}}],
  ...markdownOptions.rehypePlugins,previewImages
]});
export async function renderArticle(text:string,assets:Record<string,string>){
  const {data,content}=matter(text);
  const rendered=await processor.render(content,{frontmatter:{...data,previewAssets:assets}});
  const meta=[new Date(data.published).toISOString().slice(0,10),data.category,...(data.tags||[]).map((s:string)=>'#'+s)].filter(Boolean).map(escape).join(' · ');
  return `<!doctype html><html data-light-theme="${escape(expressiveCodeConfig.lightTheme)}" data-dark-theme="${escape(expressiveCodeConfig.darkTheme)}" lang="${escape(siteConfig.lang)}" data-theme="${escape(expressiveCodeConfig.lightTheme)}" style="--hue:${Number(siteConfig.themeColor.hue)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(data.title)}</title><link rel="stylesheet" href="/preview-assets/preview.css"></head><body><main class="preview-page"><article class="preview-article"><h1 class="preview-title">${escape(data.title)}</h1><div class="preview-meta">${meta}</div>${data.description?`<p class="preview-description">${escape(data.description)}</p>`:''}<div class="prose dark:prose-invert prose-base max-w-none custom-md markdown-content">${rendered.code}</div></article></main></body></html>`;
}

// Shared production content renderer: compiled at code deployment, not per post.
export {postSchema} from '../../src/content-schema';
export const runtimeSettings={site:siteConfig.site_url,title:siteConfig.title,description:siteConfig.subtitle,lang:siteConfig.lang,postsPerPage:siteConfig.pagination.postsPerPage,pages:siteConfig.pages,generateOgImages:siteConfig.generateOgImages};
export async function renderPublishedBody(content:string,data:any,assets:Record<string,string>){
  const rendered=await processor.render(content,{frontmatter:{...data,previewAssets:assets}});
  return {html:rendered.code,headings:rendered.metadata.headings,remarkPluginFrontmatter:rendered.metadata.frontmatter};
}
