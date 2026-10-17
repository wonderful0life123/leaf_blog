import fs from 'node:fs';
import {archiveManifest,ARCHIVE_FILE,validateArchive} from '../../src/lib/public-archive.mjs';
import {seedOrganization,targetArticlePath} from '../../src/lib/studio-organization.mjs';
import {createCatalog} from './catalog.mjs';
import {contentComparison} from './article-status.mjs';
import {planArticleChanges,readPublicInventory} from './article-changes.mjs';
import {postUrl,routeFromPath,suggestedFilename} from '../../src/lib/article-paths.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import matter from 'gray-matter';
import {parse} from 'node-html-parser';
import {StoreError} from './store.mjs';
import {publicationContent,articlePath,digest} from './publication-content.mjs';
import {gitPublisher} from './publication-git.mjs';
import {runtimePublisher,validateRuntimePaths} from '../runtime/release.mjs';
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
export function publicationConfig(env=process.env){
  if(!env.WONDER_PUBLISH_REPO_DIR)return null;
  const enabled=env.WONDER_PUBLISH_ENABLED==='1',branch=env.WONDER_PUBLISH_BRANCH||'';
  if(enabled&&(!/^feat\/[a-z0-9-]+$/.test(branch)||!env.WONDER_PUBLISH_RELEASE_DIR||!env.WONDER_PUBLISH_LIVE_LINK||! /^[a-f0-9]{40}$/.test(env.WONDER_PUBLISH_CODE_REVISION||'')))throw Error('发布需要明确的 feat/ 分支、版本目录和博客软链接；当前不允许写 master/main。');
  const mode=env.WONDER_PUBLISH_MODE||'static';
  if(!['static','runtime'].includes(mode))throw Error('Unknown publication mode');
  const config={mode,repoDir:path.resolve(env.WONDER_PUBLISH_REPO_DIR),enabled,branch,enforceRemote:true,codeRevision:env.WONDER_PUBLISH_CODE_REVISION,releaseDir:env.WONDER_PUBLISH_RELEASE_DIR,liveLink:env.WONDER_PUBLISH_LIVE_LINK};
  if(mode==='runtime')validateRuntimePaths(config);
  return config;
}
function writeJson(file,value){const temp=file+'.tmp',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
function writeContent(root,relative,bytes){
  const parts=relative.split('/');let dir=root;
  for(const part of parts.slice(0,-1)){dir=path.join(dir,part);if(fs.existsSync(dir)&&fs.lstatSync(dir).isSymbolicLink())throw new StoreError(422,'文章路径包含符号链接。');fs.mkdirSync(dir,{recursive:true});}
  const file=path.join(root,relative);if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new StoreError(422,'文章路径包含符号链接。');fs.writeFileSync(file,bytes);
}
export function openPublications({dataDir,store,config,adapter,sourceRoots}){
  const root=path.join(dataDir,'publications');fs.mkdirSync(root,{recursive:true,mode:0o700});
  const driver=adapter||(config?(config.mode==='runtime'?runtimePublisher(config):gitPublisher(config)):null);
  let active=null;
  function read(id){if(!uuid.test(id))throw new StoreError(400,'无效的发布编号');try{return JSON.parse(fs.readFileSync(path.join(root,id,'job.json'),'utf8'));}catch{throw new StoreError(404,'发布记录不存在');}}
  function save(job){job.updatedAt=new Date().toISOString();writeJson(path.join(root,job.id,'job.json'),job);return job;}
  function list(){return fs.readdirSync(root).filter(id=>uuid.test(id)).map(read).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  // A restart never replays a push automatically. The saved commit allows explicit reconciliation.
  for(const job of list())if(['building','publishing'].includes(job.state)){job.finishedAt=new Date().toISOString();job.state=job.commit?'retry':'failed';job.error='服务曾中断。草稿已保留；请重新检查或重试已确认的发布。';save(job);}
  function usePublishedSource(job){if(sourceRoots&&job?.state==='published'&&job.codeRevision===config?.codeRevision)sourceRoots.blog=path.join(root,job.id,'work/src/content/posts');}
  usePublishedSource(list().find(job=>job.state==='published'));
  function currentPosts(){const published=list().find(j=>j.state==='published'&&j.codeRevision===config?.codeRevision);return sourceRoots?.blog||(published?path.join(root,published.id,'work/src/content/posts'):config?.repoDir?path.join(config.repoDir,'src/content/posts'):null);}
  function catalogItems(){const blog=currentPosts();return blog?createCatalog({blog}).scan().articles:[];}
  function draftContext(draft){
    const items=catalogItems();store.bindArticles(items);const binding=store.binding(draft);
    const article=binding?{...draft,articleId:binding.articleId,publication:{path:binding.path}}:draft;
    const organization=store.organization([...items,article]);
    return {binding,article,organization};
  }
  store.bindArticles(catalogItems());
  attachDraftsToPublishedArticleBindings();
  function attachDraftsToPublishedArticleBindings(){
  const associated=new Set();
  for(const job of list().filter(j=>j.state==='published'&&j.draftId)){
    if(associated.has(job.draftId))continue;associated.add(job.draftId);
    let draft;try{draft=store.get(job.draftId);}catch{continue;}
    if(store.binding(draft))continue;
    const binding=store.bindings().find(b=>b.path===job.path||b.aliases.includes(job.path));
    if(binding&&binding.hash===job.articleHash)store.reconcilePublication({id:'attach-'+job.id,bindings:[{...binding,oldPath:job.path,draftId:job.draftId}]});
  }
  }
  function applyPlan(workspace,job,plan){
    for(const file of plan.deletes){const full=path.join(workspace,file);if(fs.existsSync(full))fs.unlinkSync(full);}
    for(const write of plan.writes)writeContent(workspace,write.path,write.text);
    job.files=[...new Set([...plan.writes.map(w=>w.path),...plan.deletes])];job.bindings=plan.bindings;job.archiveRows=plan.rows;job.archiveChanges=plan.rows.length;
  }
  const outputDir=job=>job.previewOnly?'preview':'dist';
  async function step(job,stage,task){
    const started=Date.now();job.phase={stage,startedAt:new Date(started).toISOString()};save(job);
    let status='failed';try{const result=await task();status='complete';return result;}
    finally{job.timings.push({stage,durationMs:Date.now()-started,status});save(job);}
  }
  const view=job=>({kind:job.kind||'article',archiveRows:job.archiveRows,archiveChanges:job.archiveChanges,previewOnly:!!job.previewOnly,id:job.id,draftId:job.draftId,revision:job.revision,state:job.state,title:job.title,path:job.path,url:job.url,description:job.description,published:job.published,imageCount:job.imageCount,warnings:job.warnings||[],error:job.error||'',commit:job.commit||'',createdAt:job.createdAt,phase:job.phase||null,timings:job.timings||[],elapsedMs:job.timings?Math.max(0,(Date.parse(job.finishedAt)||Date.now())-Date.parse(job.createdAt)):null,reused:!!job.reused,previewUrl:job.built?`/studio-api/publications/${job.id}/preview${job.url}`:null,enabled:!!config?.enabled});
  function unchanged(job){if(job.kind==='organization'){if(store.organization([]).revision!==job.revision)throw new StoreError(409,'目录已发生变化，请重新检查公开目录后再发布。');return;}const draft=store.get(job.draftId);if(job.organizationRevision!==undefined&&store.organization([]).revision!==job.organizationRevision)throw new StoreError(409,'目录已发生变化，请重新检查并预览。');if(draft.deletedAt||draft.revision!==job.revision)throw new StoreError(409,'草稿已发生变化，请重新检查并预览后再发布。');}
  function launch(job,task){active=job.id;Promise.resolve().then(task).catch(error=>{job.finishedAt=new Date().toISOString();job.state=job.commit?'retry':'failed';job.error=error instanceof StoreError?error.message:job.pushed?'文章已提交 GitHub，网站或本地确认尚未完成，请重试上线。':'发布未完成，草稿已保留，请重试或检查发布日志。';save(job);}).finally(()=>active=null);}
  return {
    organizationInfo(){const job=list().find(j=>j.kind==='organization');return {available:!!driver,enabled:!!config?.enabled,latest:job?view(job):null};},
    prepareOrganization(input,items=[]){
      if(!driver)throw new StoreError(503,'发布服务尚未配置。');
      if(active)throw new StoreError(409,'已有任务正在准备或发布，请稍后重试。');
      if(list().some(j=>j.state==='retry'))throw new StoreError(409,'请先完成上一次待重试的发布。');
      const organization=store.organization(items);
      if(input.revision!==organization.revision)throw new StoreError(409,'目录已变化，请刷新后重试。');
      const job={id:randomUUID(),kind:'organization',revision:organization.revision,state:'building',mode:config?.mode||'static',previewOnly:true,timings:[],codeRevision:config?.codeRevision,title:'公开目录',url:'/archive/',createdAt:new Date().toISOString()};
      fs.mkdirSync(path.join(root,job.id),{mode:0o700});save(job);
      launch(job,async()=>{
        job.base=await step(job,'source',()=>driver.head());save(job);
        const workspace=await step(job,'workspace',()=>driver.prepare(path.join(root,job.id),job.base));
        await step(job,'content',async()=>{
          const posts=createCatalog({blog:path.join(workspace,'src/content/posts')}).scan().articles.filter(a=>a.status==='published');
          const desired=seedOrganization(organization,posts);
          const beforeFile=path.join(workspace,ARCHIVE_FILE);
          const before=validateArchive(fs.existsSync(beforeFile)?JSON.parse(fs.readFileSync(beforeFile,'utf8')):{format:1,paths:{}});
          const selections=posts.map(post=>({articleId:post.articleId,oldPath:post.path,path:targetArticlePath(post,desired)})).filter(s=>{
            const post=posts.find(p=>p.articleId===s.articleId),category=path.posix.dirname(s.path)==='.'?'':path.posix.dirname(s.path);
            return s.oldPath!==s.path||post.category!==category||Object.hasOwn(before.paths,post.route);
          });
          if(!selections.length)throw new StoreError(422,'当前没有待应用的目录调整。');
          applyPlan(workspace,job,planArticleChanges(workspace,selections));
        });
        unchanged(job);job.state='ready';job.phase=null;job.finishedAt=new Date().toISOString();save(job);
      });
      return view(job);
    },
    decorate(drafts){
      const jobs=list(),items=catalogItems();store.bindArticles(items);
      const bindings=store.bindings(),byId=new Map(bindings.map(b=>[b.articleId,b])),byPath=new Map(),latestPublished=new Map();
      const originals=new Map(items.filter(a=>a.status==='published').map(a=>[a.articleId,a]));
      const hasChanges=contentComparison(currentPosts(),bindings);
      for(const b of bindings)for(const p of [b.path,...b.aliases])if(!byPath.has(p))byPath.set(p,b);
      for(const j of jobs)if(j.state==='published'&&!latestPublished.has(j.draftId))latestPublished.set(j.draftId,j);
      return drafts.map(draft=>{const binding=byId.get(draft.articleId)||byPath.get(draft.source?.path),published=latestPublished.get(draft.id);
        if(!binding&&!published)return draft;
        const original=originals.get(binding?.articleId||draft.articleId);
        const changed=original?hasChanges(draft,original):published?.revision!==draft.revision;
        return {...draft,articleId:binding?.articleId||draft.source?.articleId,status:changed?'draft':'published',hasUnpublishedChanges:changed,publication:{revision:published?.revision,path:binding?.path||published.path,url:binding?postUrl(binding.route):published.url,commit:published?.commit}};
      });
    },
    info(draftId){
      const draft=store.get(draftId),jobs=list().filter(j=>j.draftId===draftId),last=jobs.find(j=>j.state==='published');
      const {binding,article,organization}=draftContext(draft);
      let original={};if(binding&&config){try{original=matter(fs.readFileSync(path.join(currentPosts(),binding.path),'utf8')).data;}catch{}}
      const filename=path.posix.basename(binding?.path||last?.path||jobs[0]?.path||suggestedFilename(draft.title));
      const target=targetArticlePath(article,organization,filename);
      let latest=jobs[0];
      if(latest?.state==='ready'&&(latest.revision!==draft.revision||latest.path!==target||latest.organizationRevision!==organization.revision))latest=null;
      return {available:!!driver,enabled:!!config?.enabled,branch:config?.branch||'',path:target,filename,existing:!!binding||!!last,organizationRevision:organization.revision,currentPath:binding?.path||last?.path||'',description:jobs[0]?.description??last?.description??String(original.description||''),published:jobs[0]?.published||last?.published||(original.published?new Date(original.published).toISOString().slice(0,10):new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})),latest:latest?view(latest):null};
    },
    get(id){return view(read(id));},
    prepare(draftId,input){
      if(!driver)throw new StoreError(503,'发布服务尚未配置，请联系部署方接入。');
      if(active)throw new StoreError(409,'已有文章正在构建或发布，请稍后重试。');
      const draft=store.get(draftId);if(draft.deletedAt||draft.revision!==input.revision)throw new StoreError(409,'草稿已有变化，请重新保存后再检查。');
      const history=list().filter(j=>j.draftId===draftId);
      if(list().some(j=>j.state==='retry'))throw new StoreError(409,'上一次发布需要先核对完成，请使用“重试上线”，避免重复提交。');
      const last=history.find(j=>j.state==='published');
      const {binding,article,organization}=draftContext(draft);
      if(input.organizationRevision!==undefined&&input.organizationRevision!==organization.revision)throw new StoreError(409,'目录已变化，请重新打开预览。');
      if(input.path!==undefined)articlePath(input.path);
      if(input.filename!==undefined&&typeof input.filename!=='string')throw new StoreError(422,'文件名无效');
      const filename=binding?.path?.split('/').at(-1)||last?.path?.split('/').at(-1)||input.filename||input.path?.split('/').at(-1)||suggestedFilename(draft.title);
      if(filename.includes('/'))throw new StoreError(422,'请只填写文件名，所在目录由工作台确定。');
      const target=articlePath(targetArticlePath(article,organization,filename));
      const oldPath=binding?.path||last?.path||(draft.source?.root==='blog'?draft.source.path:null);
      const articleId=binding?.articleId||draft.source?.articleId||draft.articleId;
      const job={id:randomUUID(),draftId,revision:draft.revision,state:'building',buildVersion:4,organizationRevision:organization.revision,mode:config?.mode||'static',previewOnly:true,timings:[],codeRevision:config?.codeRevision,title:draft.title,path:target,description:input.description,published:input.published,createdAt:new Date().toISOString()};
      fs.mkdirSync(path.join(root,job.id),{mode:0o700});save(job);
      launch(job,async()=>{
        const measure=(stage,task)=>step(job,stage,task);
        job.base=await measure('source',()=>driver.head());save(job);
        const workspace=await measure('workspace',()=>driver.prepare(path.join(root,job.id),job.base));
        await measure('content',async()=>{
          const posts=path.join(workspace,'src/content/posts');
          if(!fs.realpathSync(posts).startsWith(fs.realpathSync(workspace)+path.sep))throw new StoreError(422,'文章目录不能指向构建目录外。');
          const file=oldPath?path.join(posts,oldPath):null;
          if(file&&fs.existsSync(file)&&!fs.realpathSync(file).startsWith(fs.realpathSync(posts)+path.sep))throw new StoreError(422,'文章来源路径越界。');
          const previous=file&&fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
          const content=publicationContent(draft,{...input,path:target},{previous,expectedHash:(draft.source?.root==='blog'?draft.source.baseHash:null)||last?.articleHash||binding?.hash,media:id=>store.media(id),existingImage:(href,image)=>{
            if(!oldPath||href.startsWith('/')||/^[a-z]+:/i.test(href))return null;
            try{const source=fs.realpathSync(path.resolve(posts,path.posix.dirname(draft.source?.referencePath||oldPath),decodeURIComponent(href.split(/[?#]/)[0])));if(!source.startsWith(fs.realpathSync(posts)+path.sep)||digest(fs.readFileSync(source))!==digest(image.bytes))return null;return path.posix.relative(path.posix.dirname(path.join(posts,target)),source).split('/').map(p=>p==='..'?'..':encodeURIComponent(p)).join('/');}catch{return null;}
          }});
          const plan=planArticleChanges(workspace,[{articleId,oldPath,path:target,text:content.text,draftId,referencePath:draft.source?.referencePath||oldPath||target}]);
          applyPlan(workspace,job,plan);
          for(const image of content.images)writeContent(posts,image.path,image.bytes);
          job.files=[...new Set([...job.files,...content.images.map(i=>'src/content/posts/'+i.path)])];
          job.previewFiles=['src/content/posts/'+target,...content.images.map(i=>'src/content/posts/'+i.path)];
          job.articleHash=plan.bindings.find(b=>b.articleId===articleId).hash;job.url=content.url;job.imageCount=content.images.length;job.warnings=content.warnings;save(job);
        });
        // Only an identical article, assets, code and source commit may reuse a
        // complete output. Check HEAD above even for a cache hit; confirm checks
        // it again before any commit. Each job owns its own immutable copy.
        const cached=history.find(j=>j.built&&j.buildVersion===job.buildVersion&&j.state==='ready'&&j.base===job.base&&j.codeRevision===job.codeRevision&&j.revision===job.revision&&j.path===job.path&&j.articleHash===job.articleHash&&fs.existsSync(path.join(root,j.id,'work',outputDir(j),decodeURI(job.url),'index.html')));
        if(cached){
          await measure('reuse',async()=>fs.cpSync(path.join(root,cached.id,'work',outputDir(cached)),path.join(workspace,outputDir(job)),{recursive:true}));job.reused=true;
        }else await measure('render',()=>driver.preview(workspace,job.url,measure,job.previewFiles));
        unchanged(job);job.built=true;job.state='ready';job.phase=null;job.finishedAt=new Date().toISOString();save(job);
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
      if((job.mode||'static')!==(config.mode||'static'))throw new StoreError(409,'发布模式已切换，请重新生成预览；未完成提交请先由部署方核对。');
      if(job.state==='ready')unchanged(job);
      job.state='publishing';job.error='';job.finishedAt=null;save(job);
      launch(job,async()=>{
        const workspace=path.join(root,id,'work');
        if(!job.commit){
          if(await driver.head()!==job.base)throw new StoreError(409,'远端分支已更新，请重新生成预览。');
          unchanged(job);
          // Preview output is never deployable. Build the full site only after consent.
          if(job.previewOnly&&!job.publishBuilt){
            await step(job,'build',()=>driver.build(workspace,job.url,(stage,task)=>step(job,stage,task)));
            job.publishBuilt=true;save(job);
            unchanged(job);
            if(await driver.head()!==job.base)throw new StoreError(409,'构建期间远端分支已更新，请重新生成预览。');
          }
          job.commit=await driver.commit(workspace,job.base,job.files,id);save(job);
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
        if(!job.deployment){job.deployment=await driver.deploy(path.join(workspace,'dist'),id);save(job);}
        store.reconcilePublication(job);job.reconciled=true;save(job);
        job.state='published';job.error='';job.phase=null;job.finishedAt=new Date().toISOString();save(job);usePublishedSource(job);
      });
      return view(job);
    },
    preview(id,relative){
      const job=read(id);if(!job.built)throw new StoreError(409,'预览尚未构建完成。');
      const dist=fs.realpathSync(path.join(root,id,'work',outputDir(job)));
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
