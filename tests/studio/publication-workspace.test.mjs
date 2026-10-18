import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {gitPublisher} from '../../scripts/studio/publication-git.mjs';

test('runtime workspace preserves Chinese articles, media, metadata and full commit tree without copying application assets',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-content-workspace-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);
 const write=(file,text)=>{const target=path.join(repo,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
 write('src/content/posts/中文目录/文章.md','original');write('src/content/posts/中文目录/图片.webp','image');
 write('src/data/article-routes.json','{}');write('src/data/public-archive.json','{}');
 write('public/assets/untouched.png','KEEP public');write('scripts/app.mjs','KEEP code');write('pnpm-lock.yaml','lock');
 fs.mkdirSync(path.join(repo,'node_modules'));
 const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git(['init']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture']);
 const base=git(['rev-parse','HEAD']);
 const runtime=gitPublisher({repoDir:repo,mode:'runtime',enabled:false});t.after(()=>runtime.close());
 const work=await runtime.prepare(path.join(root,'task'),base);
 for(const file of ['src/content/posts/中文目录/文章.md','src/content/posts/中文目录/图片.webp','src/data/article-routes.json','src/data/public-archive.json','pnpm-lock.yaml'])assert.equal(fs.readFileSync(path.join(work,file),'utf8'),fs.readFileSync(path.join(repo,file),'utf8'));
 assert.ok(!fs.existsSync(path.join(work,'public'))&&!fs.existsSync(path.join(work,'scripts')));
 fs.writeFileSync(path.join(work,'src/content/posts/中文目录/文章.md'),'updated');
 const commit=await runtime.commit(work,base,['src/content/posts/中文目录/文章.md'],'isolated');
 assert.equal(git(['diff','--name-only','-z',base,commit]),'src/content/posts/中文目录/文章.md\0');
 assert.equal(git(['show',commit+':public/assets/untouched.png']),'KEEP public');
 assert.equal(git(['show',commit+':scripts/app.mjs']),'KEEP code');assert.equal(git(['status','--porcelain']),'');
 const full=gitPublisher({repoDir:repo,enabled:false});t.after(()=>full.close());
 const staticWork=await full.prepare(path.join(root,'static'),base);
 assert.equal(fs.readFileSync(path.join(staticWork,'scripts/app.mjs'),'utf8'),'KEEP code');
 // Lock changes remain a hard deployment boundary even in runtime mode.
 write('pnpm-lock.yaml','changed');
 await assert.rejects(runtime.prepare(path.join(root,'mismatch'),base),/依赖版本已变化/);
});
