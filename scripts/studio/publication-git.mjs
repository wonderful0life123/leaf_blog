import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {articlePreview} from './publication-preview.mjs';
import {StoreError} from './store.mjs';
const execute=promisify(execFile);
const fail=message=>{throw new StoreError(503,message);};
export function gitPublisher(config) {
  const repo=fs.realpathSync(config.repoDir);
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',GIT_TERMINAL_PROMPT:'0',ASTRO_TELEMETRY_DISABLED:'1'};
  // Commands and destinations come only from the server config, never HTTP input.
  async function run(command,args,cwd=repo,extra={}) {
    try{
      const result=await execute(command,args,{cwd,env,timeout:600_000,maxBuffer:8*1024*1024,...extra});
      // Retain successful build output as well: slow builds need route/image timings,
      // not just a log after a failure. These logs stay outside the preview dist.
      if(command===process.execPath)fs.appendFileSync(path.join(path.dirname(cwd),'build.log'),result.stdout+result.stderr,{mode:0o600});
      return result.stdout.trim();
    }
    catch(error){if(command!=='git')fs.appendFileSync(path.join(path.dirname(cwd),'build.log'),String(error.stdout||'')+String(error.stderr||''),{mode:0o600});fail(command==='git'?'仓库操作未完成，请检查网络或发布权限后重试。':'构建未通过，网站保持原状。请检查文章格式及构建环境。');}
  }
  async function head(){
    if(config.enabled){
      if(config.enforceRemote){const remote=await run('git',['remote','get-url','origin']);if(! /^(?:https:\/\/github\.com\/|git@github\.com:)wonderful0life123\/leaf_blog(?:\.git)?$/.test(remote))fail('发布仓库 origin 必须指向 wonderful0life123/leaf_blog，且不能包含令牌。');}
      await run('git',['fetch','--no-tags','origin',config.branch]);const latest=await run('git',['rev-parse','FETCH_HEAD']);
      if(config.codeRevision){
        await run('git',['merge-base','--is-ancestor',config.codeRevision,latest]);
        const changes=await run('git',['diff','--name-only',config.codeRevision,latest]);
        if(changes.split('\n').some(file=>file&&!file.startsWith('src/content/posts/')))fail('发布分支包含尚未部署的代码改动，请先同步两套前端与发布基准版本。');
      }
      return latest;
    }
    return run('git',['rev-parse','HEAD']);
  }
  return {
    head,
    preview:articlePreview(repo),
    async prepare(dir,base){
      const workspace=path.join(dir,'work');fs.mkdirSync(workspace,{recursive:true,mode:0o700});
      await run('git',['archive','--format=tar','-o',path.join(dir,'source.tar'),base]);
      await run('tar',['-xf',path.join(dir,'source.tar'),'-C',workspace]);fs.unlinkSync(path.join(dir,'source.tar'));
      // A reviewed checkout with the exact lockfile supplies installed dependencies.
      if(!fs.readFileSync(path.join(workspace,'pnpm-lock.yaml')).equals(fs.readFileSync(path.join(repo,'pnpm-lock.yaml'))))fail('发布仓库依赖版本已变化，请先由部署方安装并验证新版本。');
      fs.symlinkSync(fs.realpathSync(path.join(repo,'node_modules')),path.join(workspace,'node_modules'),'dir');
      return workspace;
    },
    async build(workspace,url,step=(_name,task)=>task()){
      await step('icons',()=>run(process.execPath,['scripts/generate-icons.js'],workspace));
      await step('site',()=>run(process.execPath,['node_modules/astro/bin/astro.mjs','build'],workspace));
      await step('search',()=>run(process.execPath,['node_modules/pagefind/lib/runner/bin.cjs','--site','dist'],workspace));
      const dist=path.join(workspace,'dist'),article=path.join(dist,url,'index.html');
      if(!fs.existsSync(article)||fs.existsSync(path.join(dist,'studio-static')))fail('构建产物不完整或包含私有前端，已停止发布。');
      return dist;
    },
    async commit(workspace,base,files,id){
      // The temporary index includes only the checked article and referenced images.
      const gitDir=await run('git',['rev-parse','--absolute-git-dir']);
      const index=path.join(path.dirname(workspace),'git-index');
      const isolated={...env,GIT_DIR:gitDir,GIT_WORK_TREE:workspace,GIT_INDEX_FILE:index,GIT_AUTHOR_NAME:'Wonder Studio',GIT_AUTHOR_EMAIL:'studio@wonder-ai.info',GIT_COMMITTER_NAME:'Wonder Studio',GIT_COMMITTER_EMAIL:'studio@wonder-ai.info'};
      await run('git',['read-tree',base],workspace,{env:isolated});
      await run('git',['add','--',...files],workspace,{env:isolated});
      const tree=await run('git',['write-tree'],workspace,{env:isolated});
      return run('git',['commit-tree',tree,'-p',base,'-m',`Publish article via Wonder Studio (${id})`],workspace,{env:isolated});
    },
    async push(commit,base){
      // Normal fast-forward push: concurrent branch changes must be handled by a new preview.
      if(await head()!==base)throw new StoreError(409,'发布分支已有新提交，请重新生成预览。');
      await run('git',['push','origin',`${commit}:refs/heads/${config.branch}`]);
    },
    async hasCommit(commit){const latest=await head();try{await execute('git',['merge-base','--is-ancestor',commit,latest],{cwd:repo,env,timeout:30000});return true;}catch(error){if(error.code===1)return false;throw new StoreError(503,'无法核实远端提交，请联系部署方。');}},
    async contains(commit){return (await run('git',['ls-remote','--heads','origin',`refs/heads/${config.branch}`])).split(/\s/)[0]===commit;},
    async deploy(dist,id){
      if(!config.liveLink||!config.releaseDir)fail('尚未配置博客上线目录。');
      const live=path.resolve(config.liveLink),releases=fs.realpathSync(config.releaseDir);
      // Initial conversion of the live directory is a deployment step, not done by the app.
      if(!fs.lstatSync(live).isSymbolicLink())fail('博客公开目录尚未配置原子切换，请联系部署方。');
      const previous=fs.realpathSync(live);
      if(!previous.startsWith(releases+path.sep))fail('当前博客目录不在批准的版本目录内。');
      const target=path.join(releases,id);
      if(!fs.existsSync(target)){
        const stage=path.join(releases,'.'+id+'.staging');
        fs.rmSync(stage,{recursive:true,force:true});fs.cpSync(dist,stage,{recursive:true,dereference:false});
        // Keep prior hashed assets available to visitors with cached HTML.
        if(fs.existsSync(path.join(previous,'_astro')))fs.cpSync(path.join(previous,'_astro'),path.join(stage,'_astro'),{recursive:true,force:false,errorOnExist:false});
        function permissions(dir){fs.chmodSync(dir,0o755);for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())fail('产物不能包含符号链接。');if(entry.isDirectory())permissions(file);else fs.chmodSync(file,0o644);}}
        permissions(stage);fs.renameSync(stage,target);
      }
      const next=live+'.next-'+id;
      if(fs.existsSync(next))fs.unlinkSync(next);
      fs.symlinkSync(target,next);fs.renameSync(next,live);
      return {previous,target};
    }
  };
}
