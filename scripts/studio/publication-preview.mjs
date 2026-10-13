import fs from 'node:fs';
import path from 'node:path';
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
    // Only images validated by publicationContent are copied; never expose the repository.
    for(const image of files.slice(1)){
      const filename=path.basename(image),relative=path.posix.relative(path.posix.dirname(article),image);
      const target=path.join(previewDir,'preview-images',filename);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(workspace,image),target);assets[relative]='/preview-images/'+filename;
    }
    const html=await render(text,assets);
    const output=path.join(previewDir,url,'index.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
    fs.cpSync(path.join(compiled,'assets'),path.join(previewDir,'preview-assets'),{recursive:true});
    return previewDir;
  };
}
