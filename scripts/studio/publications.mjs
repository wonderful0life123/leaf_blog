import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import matter from 'gray-matter';
import {parse} from 'node-html-parser';
import {StoreError} from './store.mjs';
import {publicationContent,articlePath} from './publication-content.mjs';
import {gitPublisher} from './publication-git.mjs';
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
export function publicationConfig(env=process.env){
  if(!env.WONDER_PUBLISH_REPO_DIR)return null;
  const enabled=env.WONDER_PUBLISH_ENABLED==='1',branch=env.WONDER_PUBLISH_BRANCH||'';
  if(enabled&&(!/^feat\/[a-z0-9-]+$/.test(branch)||!env.WONDER_PUBLISH_RELEASE_DIR||!env.WONDER_PUBLISH_LIVE_LINK||! /^[a-f0-9]{40}$/.test(env.WONDER_PUBLISH_CODE_REVISION||'')))throw Error('发布需要明确的 feat/ 分支、版本目录和博客软链接；当前不允许写 master/main。');
  return {repoDir:path.resolve(env.WONDER_PUBLISH_REPO_DIR),enabled,branch,enforceRemote:true,codeRevision:env.WONDER_PUBLISH_CODE_REVISION,releaseDir:env.WONDER_PUBLISH_RELEASE_DIR,liveLink:env.WONDER_PUBLISH_LIVE_LINK};
}
function writeJson(file,value){const temp=file+'.tmp',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
function writeContent(root,relative,bytes){
  const parts=relative.split('/');let dir=root;
  for(const part of parts.slice(0,-1)){dir=path.join(dir,part);if(fs.existsSync(dir)&&fs.lstatSync(dir).isSymbolicLink())throw new StoreError(422,'文章路径包含符号链接。');fs.mkdirSync(dir,{recursive:true});}
  const file=path.join(root,relative);if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new StoreError(422,'文章路径包含符号链接。');fs.writeFileSync(file,bytes);
}
export function openPublications({dataDir,store,config,adapter,sourceRoots}){
  const root=path.join(dataDir,'publications');fs.mkdirSync(root,{recursive:true,mode:0o700});
  const driver=adapter||(config?gitPublisher(config):null);
  let active=null;
  function read(id){if(!uuid.test(id))throw new StoreError(400,'无效的发布编号');try{return JSON.parse(fs.readFileSync(path.join(root,id,'job.json'),'utf8'));}catch{throw new StoreError(404,'发布记录不存在');}}
  function save(job){job.updatedAt=new Date().toISOString();writeJson(path.join(root,job.id,'job.json'),job);return job;}
  function list(){return fs.readdirSync(root).filter(id=>uuid.test(id)).map(read).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  // A restart never replays a push automatically. The saved commit allows explicit reconciliation.
  for(const job of list())if(['building','publishing'].includes(job.state)){job.state=job.commit?'retry':'failed';job.error='服务曾中断。草稿已保留；请重新检查或重试已确认的发布。';save(job);}
  function usePublishedSource(job){if(sourceRoots&&job?.state==='published'&&job.codeRevision===config?.codeRevision)sourceRoots.blog=path.join(root,job.id,'work/src/content/posts');}
  usePublishedSource(list().find(job=>job.state==='published'));
  const view=job=>({id:job.id,draftId:job.draftId,revision:job.revision,state:job.state,title:job.title,path:job.path,url:job.url,description:job.description,published:job.published,imageCount:job.imageCount,warnings:job.warnings||[],error:job.error||'',commit:job.commit||'',createdAt:job.createdAt,previewUrl:job.built?`/studio-api/publications/${job.id}/preview${job.url}`:null,enabled:!!config?.enabled});
  function unchanged(job){const draft=store.get(job.draftId);if(draft.deletedAt||draft.revision!==job.revision)throw new StoreError(409,'草稿已发生变化，请重新检查并预览后再发布。');}
  function launch(job,task){active=job.id;Promise.resolve().then(task).catch(error=>{job.state=job.commit?'retry':'failed';job.error=error instanceof StoreError?error.message:'发布未完成，草稿与原网站均保留。请联系部署方检查。';save(job);}).finally(()=>active=null);}
  return {
    decorate(drafts){const jobs=list();return drafts.map(draft=>{const published=jobs.find(j=>j.draftId===draft.id&&j.state==='published');return published?{...draft,status:published.revision===draft.revision?'published':'draft',publication:{revision:published.revision,path:published.path,url:published.url,commit:published.commit}}:draft;});},
    info(draftId){
      const draft=store.get(draftId),jobs=list().filter(j=>j.draftId===draftId),last=jobs.find(j=>j.state==='published');
      let original={};if(draft.source?.root==='blog'&&config){try{original=matter(fs.readFileSync(path.join(config.repoDir,'src/content/posts',articlePath(draft.source.path)),'utf8')).data;}catch{}}
      return {available:!!driver,enabled:!!config?.enabled,branch:config?.branch||'',path:jobs[0]?.path||last?.path||draft.source?.root==='blog'&&draft.source.path||`writing/${draft.id.slice(0,8)}.md`,description:jobs[0]?.description??last?.description??String(original.description||''),published:jobs[0]?.published||last?.published||(original.published?new Date(original.published).toISOString().slice(0,10):new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})),latest:jobs[0]?view(jobs[0]):null};
    },
    get(id){return view(read(id));},
    prepare(draftId,input){
      if(!driver)throw new StoreError(503,'发布服务尚未配置，请联系部署方接入。');
      if(active)throw new StoreError(409,'已有文章正在构建或发布，请稍后重试。');
      const draft=store.get(draftId);if(draft.deletedAt||draft.revision!==input.revision)throw new StoreError(409,'草稿已有变化，请重新保存后再检查。');
      const history=list().filter(j=>j.draftId===draftId);
      if(list().some(j=>j.state==='retry'))throw new StoreError(409,'上一次发布需要先核对完成，请使用“重试上线”，避免重复提交。');
      const last=history.find(j=>j.state==='published');
      const target=articlePath(input.path);
      if(last&&target!==last.path)throw new StoreError(409,'已发布文章沿用原路径，不能在这里修改网址。');
      const job={id:randomUUID(),draftId,revision:draft.revision,state:'building',codeRevision:config?.codeRevision,title:draft.title,path:target,description:input.description,published:input.published,createdAt:new Date().toISOString()};
      fs.mkdirSync(path.join(root,job.id),{mode:0o700});save(job);
      launch(job,async()=>{
        job.base=await driver.head();save(job);
        const workspace=await driver.prepare(path.join(root,job.id),job.base);
        const posts=path.join(workspace,'src/content/posts'),file=path.join(posts,target);
        if(!fs.realpathSync(posts).startsWith(fs.realpathSync(workspace)+path.sep))throw new StoreError(422,'文章目录不能指向构建目录外。');
        if(fs.existsSync(file)&&!fs.realpathSync(file).startsWith(fs.realpathSync(posts)+path.sep))throw new StoreError(422,'文章来源路径越界。');
        const previous=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
        const content=publicationContent(draft,input,{previous,expectedHash:last?.articleHash||(draft.source?.root==='blog'?draft.source.baseHash:null),media:id=>store.media(id)});
        writeContent(posts,target,content.text);for(const image of content.images)writeContent(posts,image.path,image.bytes);
        job.files=[target,...content.images.map(i=>i.path)].map(p=>'src/content/posts/'+p);job.articleHash=content.hash;job.url=content.url;job.imageCount=content.images.length;job.warnings=content.warnings;save(job);
        await driver.build(workspace,job.url);unchanged(job);job.built=true;job.state='ready';save(job);
      });
      return view(job);
    },
    confirm(id,input){
      const job=read(id);
      if(job.state==='published')return view(job);
      if(!config?.enabled)throw new StoreError(503,'当前仅启用了私密预览，尚未开启 GitHub 提交和博客上线。');
      if(active)throw new StoreError(409,'已有文章正在构建或发布，请稍后重试。');
      if(!['ready','retry'].includes(job.state)||input.revision!==job.revision||input.confirm!==true)throw new StoreError(409,'请先完成检查与预览，再明确确认发布。');
      if(list().some(j=>j.state==='retry'&&j.id!==id))throw new StoreError(409,'请先处理上一次未完成的发布。');
      if(job.state==='ready')unchanged(job);
      job.state='publishing';job.error='';save(job);
      launch(job,async()=>{
        const workspace=path.join(root,id,'work');
        if(!job.commit){
          if(await driver.head()!==job.base)throw new StoreError(409,'远端分支已更新，请重新生成预览。');
          unchanged(job);job.commit=await driver.commit(workspace,job.base,job.files,id);save(job);
        }
        if(!await driver.contains(job.commit)){
          if(await driver.head()!==job.base){
            if(driver.hasCommit&&!await driver.hasCommit(job.commit)){job.commit=null;save(job);throw new StoreError(409,'远端已有新提交，当前版本尚未进入分支，请重新检查并预览。');}
            throw new StoreError(409,'远端在提交后再次变化，请联系部署方核对，避免用旧版本覆盖网站。');
          }
          await driver.push(job.commit,job.base);
        }
        job.pushed=true;save(job);
        if(!await driver.contains(job.commit))throw new StoreError(409,'发布分支已有新提交，已停止旧版本上线，请联系部署方核对。');
        job.deployment=await driver.deploy(path.join(workspace,'dist'),id);
        job.state='published';job.error='';save(job);usePublishedSource(job);
      });
      return view(job);
    },
    preview(id,relative){
      const job=read(id);if(!job.built)throw new StoreError(409,'预览尚未构建完成。');
      const dist=fs.realpathSync(path.join(root,id,'work/dist'));
      let file;try{file=fs.realpathSync(path.join(dist,relative)+(relative.endsWith('/')?'index.html':''));}catch{throw new StoreError(404,'预览资源不存在');}
      if(!file.startsWith(dist+path.sep)||!fs.statSync(file).isFile()||!mime[path.extname(file)])throw new StoreError(404,'预览资源不存在');
      let bytes=fs.readFileSync(file);
      const prefix=`/studio-api/publications/${id}/preview`;
      const css=text=>text.replace(/url\((['"]?)(\/(?!\/))/g,`url($1${prefix}$2`);
      if(path.extname(file)==='.css')bytes=Buffer.from(css(bytes.toString()));
      if(path.extname(file)==='.html'){
        // Display the actual build output without executing article/site scripts or navigating away.
        const doc=parse(bytes.toString());for(const element of doc.querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv]'))element.remove();
        for(const element of doc.querySelectorAll('*')){
          if(element.tagName==='STYLE')element.set_content(css(element.textContent));
          if(element.getAttribute('style'))element.setAttribute('style',css(element.getAttribute('style')));
          for(const name of Object.keys(element.attributes))if(/^on/i.test(name)||['srcdoc','action','formaction'].includes(name))element.removeAttribute(name);
          if(element.tagName==='A'){element.removeAttribute('href');element.removeAttribute('target');}
          for(const name of ['src','href','poster']){const value=element.getAttribute(name);if(value?.startsWith('/')&&!value.startsWith('//'))element.setAttribute(name,prefix+value);}
          const srcset=element.getAttribute('srcset');if(srcset)element.setAttribute('srcset',srcset.replace(/(^|,\s*)(\/[^/])/g,`$1${prefix}$2`));
        }
        bytes=Buffer.from(doc.toString());
      }
      return {bytes,mime:mime[path.extname(file)]};
    }
  };
}
