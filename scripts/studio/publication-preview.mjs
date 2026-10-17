import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {marked} from 'marked';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {StoreError} from './store.mjs';

export function articlePreview(repo){
  const compiled=path.join(repo,'.studio-preview');
  let worker;
  async function render(text,assets){
    if(!fs.existsSync(path.join(compiled,'renderer.mjs'))||!fs.existsSync(path.join(compiled,'assets/preview.css')))throw new StoreError(503,'单篇预览组件尚未部署，请先运行 pnpm run studio:preview:build。');
    if(!worker)worker=new Worker(new URL('./preview-worker.mjs',import.meta.url),{workerData:{renderer:path.join(compiled,'renderer.mjs')}});
    const current=worker;current.ref();
    return new Promise((resolve,reject)=>{
      const finish=(error,html)=>{clearTimeout(timer);current.removeListener('message',message);current.removeListener('error',failed);current.removeListener('exit',exited);current.unref();if(error){worker=null;void current.terminate();reject(new StoreError(503,'单篇预览未完成，请检查文章格式后重试。'));}else resolve(html);};
      const message=result=>finish(result.error,result.html),failed=()=>finish(true),exited=()=>finish(true);
      const timer=setTimeout(()=>finish(true),30_000);
      current.once('message',message);current.once('error',failed);current.once('exit',exited);current.postMessage({text,assets});
    });
  }
  return async function preview(workspace,url,_step,files){
    const previewDir=path.join(workspace,'preview');fs.mkdirSync(previewDir,{recursive:true,mode:0o700});
    const article=files[0],text=fs.readFileSync(path.join(workspace,article),'utf8'),assets={};
    const posts=fs.realpathSync(path.join(workspace,'src/content/posts'));
    const {data,content}=matter(text),refs=[];
    marked.walkTokens(marked.lexer(content),token=>{if(token.type==='image')refs.push(token.href);});
    if(data.image&&data.image!=='api')refs.push(data.image);
    for(const href of new Set(refs)){
      if(/^(?:https?:|\/)/i.test(href))continue;
      const file=fs.realpathSync(path.resolve(path.dirname(path.join(workspace,article)),decodeURIComponent(href.split(/[?#]/)[0])));
      if(!file.startsWith(posts+path.sep)||!/^\.(png|jpg|jpeg|gif|webp|avif)$/i.test(path.extname(file)))throw new StoreError(422,'预览图片路径无效');
      const filename=createHash('sha256').update(fs.readFileSync(file)).digest('hex')+path.extname(file);
      const target=path.join(previewDir,'preview-images',filename);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(file,target);assets[href]='/preview-images/'+filename;
    }
    const html=await render(text,assets);
    const output=path.join(previewDir,decodeURI(url),'index.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
    fs.cpSync(path.join(compiled,'assets'),path.join(previewDir,'preview-assets'),{recursive:true});
    return previewDir;
  };
}
