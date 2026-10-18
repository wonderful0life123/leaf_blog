import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {marked} from 'marked';
import {createHash} from 'node:crypto';
import {previewClient} from './preview-client.mjs';
import {StoreError} from './store.mjs';

export function articlePreview(repo){
  const compiled=path.join(repo,'.studio-preview');
  const client=previewClient(path.join(compiled,'renderer.mjs'));
  function check(){
    if(!fs.existsSync(path.join(compiled,'renderer.mjs'))||!fs.existsSync(path.join(compiled,'assets/preview.css')))throw new StoreError(503,'单篇预览组件尚未部署，请先运行 pnpm run studio:preview:build。');
  }
  async function preview(workspace,url,_step,files){
    check();
    const previewDir=path.join(workspace,'preview');fs.mkdirSync(previewDir,{recursive:true,mode:0o700});
    const article=files[0],text=fs.readFileSync(path.join(workspace,article),'utf8'),assets={};
    const posts=fs.realpathSync(path.join(workspace,'src/content/posts'));
    const {data,content}=matter(text),refs=[];
    marked.walkTokens(marked.lexer(content),token=>{if(token.type==='image')refs.push(token.href);});
    if(data.image&&data.image!=='api')refs.push(data.image);
    for(const href of new Set(refs)){
      if(/^https?:|^\/\//i.test(href))continue;
      const publicCover=href===data.image&&href.startsWith('/');
      if(href.startsWith('/')&&!publicCover)continue;
      const imageRoot=publicCover?fs.realpathSync(path.join(workspace,'public')):posts;
      const decoded=decodeURIComponent(href.split(/[?#]/)[0]);
      const file=fs.realpathSync(publicCover?path.resolve(imageRoot,'.'+decoded):path.resolve(path.dirname(path.join(workspace,article)),decoded));
      if(!file.startsWith(imageRoot+path.sep)||!/^\.(png|jpg|jpeg|gif|webp|avif)$/i.test(path.extname(file)))throw new StoreError(422,'预览图片路径无效');
      const filename=createHash('sha256').update(fs.readFileSync(file)).digest('hex')+path.extname(file);
      const target=path.join(previewDir,'preview-images',filename);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(file,target);assets[href]='/preview-images/'+filename;
    }
    const html=await client.render(text,assets);
    const output=path.join(previewDir,decodeURI(url),'index.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
    fs.cpSync(path.join(compiled,'assets'),path.join(previewDir,'preview-assets'),{recursive:true});
    return previewDir;
  }
  preview.warmup=async()=>{check();return client.warmup();};
  preview.close=()=>client.close();
  return preview;
}
