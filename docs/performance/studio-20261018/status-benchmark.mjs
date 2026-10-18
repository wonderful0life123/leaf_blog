import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
const repo=process.argv[2];
const load=p=>import(pathToFileURL(path.join(repo,p)));
const {openStore}=await load('scripts/studio/store.mjs');
const {createCatalog}=await load('scripts/studio/catalog.mjs');
const {openPublications}=await load('scripts/studio/publications.mjs');
const {contentComparison}=await load('scripts/studio/article-status.mjs');
const {createHandler}=await load('scripts/studio/http.mjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-status-measure-'));
const results=[];
const originalRead=fs.readFileSync;
let reads=null;
fs.readFileSync=function(file,...args){if(reads&&typeof file==='string'){const k=file.endsWith('job.json')?'jobs':file.endsWith('.md')?'markdown':file.endsWith('.png')?'images':'other';reads[k]=(reads[k]||0)+1;}return originalRead.call(this,file,...args);};
try{
 for(const [articles,drafts,jobs] of [[8,6,9],[24,18,40],[100,80,200]]){
  const dir=path.join(root,String(articles)),posts=path.join(dir,'repo/src/content/posts'),dataDir=path.join(dir,'data');fs.mkdirSync(posts,{recursive:true});
  const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(256*1024,1)]);
  fs.writeFileSync(path.join(posts,'图.png'),png);
  const paragraph='性能测量正文：保留目录移动、图片引用、发布状态、正文还原和并发冲突保护。';
  for(let i=0;i<articles;i++)fs.writeFileSync(path.join(posts,`文章${i}.md`),`---\ntitle: 文章${i}\ncategory: ''\ntags: [测试]\n---\n\n# 文章 ${i}\n\n${Array.from({length:40},(_,n)=>`## 小节 ${n}\n\n${paragraph.repeat(5)}\n\n\`\`\`js\nconst value = ${n};\n\`\`\`\n`).join('\n')}\n![图](图.png)`);
  const sourceRoots={blog:posts},store=openStore({dataDir,sourceRoots}),catalog=createCatalog(sourceRoots);
  const items=catalog.scan().articles;store.bindArticles(items);
  for(const a of items.slice(0,drafts))store.create({title:a.title,body:a.body,category:a.category,tags:a.tags,source:{root:'blog',path:a.path}});
  fs.mkdirSync(path.join(dataDir,'publications'),{recursive:true});
  for(let i=0;i<jobs;i++){const id=randomUUID();fs.mkdirSync(path.join(dataDir,'publications',id));fs.writeFileSync(path.join(dataDir,'publications',id,'job.json'),JSON.stringify({id,state:'ready',createdAt:new Date(1700000000000+i).toISOString(),draftId:'unrelated',title:'isolated preview',timings:[]}));}
  const manager=openPublications({dataDir,store,sourceRoots,config:{repoDir:path.join(dir,'repo'),enabled:false}});
  const handler=createHandler(store,{catalog,publications:manager});
  let draft=store.list()[0];
  async function request(method,url,value){let status,body;const req=Readable.from(value?[Buffer.from(JSON.stringify(value))]:[]);Object.assign(req,{method,url,headers:{host:'127.0.0.1:4342',origin:'http://127.0.0.1:4342','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});await handler(req,{writeHead:s=>status=s,end:b=>body=b});assert.equal(status,200,body);return JSON.parse(body);}
  const operations={catalog:()=>catalog.scan(),comparisonOnly:()=>{const compare=contentComparison(posts,store.bindings());return store.list().map(d=>compare(d,items.find(a=>a.articleId===d.articleId)));},list:()=>request('GET','/drafts'),open:()=>request('GET','/drafts/'+draft.id),save:async()=>{draft=(await request('PUT','/drafts/'+draft.id,{...draft,body:draft.body.endsWith('\n修改')?draft.body.slice(0,-3):draft.body+'\n修改'})).draft;},organization:()=>request('GET','/organization')};
  const row={articles,drafts,jobs,bodyChars:draft.body.length,operations:{}};
  for(const [name,fn] of Object.entries(operations)){const samples=[];let first;for(let i=0;i<14;i++){reads={};const t=performance.now();await fn();const ms=performance.now()-t;if(i===0)first={ms,reads};if(i>=2)samples.push({ms,reads});reads=null;}const sorted=samples.map(s=>s.ms).sort((a,b)=>a-b);row.operations[name]={first,medianMs:(sorted[5]+sorted[6])/2,minMs:sorted[0],maxMs:sorted.at(-1),reads:samples[0].reads,samples:samples.map(s=>s.ms)};}
  results.push(row);store.close();
 }
 console.log(JSON.stringify(results,null,2));
}finally{fs.readFileSync=originalRead;fs.rmSync(root,{recursive:true,force:true});}
