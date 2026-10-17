import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {digest} from './publication-content.mjs';
import {StoreError} from './store.mjs';
import {ROUTES_FILE,articleIdentity,legacyArticleRoute,routeFromPath,normalizeArticlePath,pathKey,postUrl,validateRoutes} from '../../src/lib/article-paths.mjs';
import {ARCHIVE_FILE,validateArchive} from '../../src/lib/public-archive.mjs';

export function readPublicInventory(work,includeDrafts=new Set()){
  const root=path.join(work,'src/content/posts');
  const routeFile=path.join(work,ROUTES_FILE);
  const routes=fs.existsSync(routeFile)?validateRoutes(JSON.parse(fs.readFileSync(routeFile,'utf8'))):{format:1,articles:[]};
  const posts=[],realRoot=fs.realpathSync(root),routesByPath=new Map(routes.articles.map(a=>[a.path,a])),identities=new Set();
  for(const file of fs.readdirSync(root,{recursive:true}).filter(f=>/\.md$/.test(f))){
    const full=fs.realpathSync(path.join(root,file));
    if(!full.startsWith(realRoot+path.sep))throw new StoreError(422,'文章路径越界');
    const text=fs.readFileSync(full,'utf8'),{data}=matter(text);
    if(data.draft&&!includeDrafts.has(file))continue;
    const known=routesByPath.get(file),articleId=known?.id||articleIdentity(file,data);
    if(identities.has(articleId))throw new StoreError(409,'文章身份重复：'+file);
    identities.add(articleId);
    posts.push({path:file,text,articleId,route:known?.route||legacyArticleRoute(file,data)});
  }
  return {posts,routes};
}

export function rewriteReferences(body,resolve){
  const tree=fromMarkdown(body),patches=[];
  function visit(node){
    if(['link','image','definition'].includes(node.type)){
      const next=resolve(node.url,node.type);
      if(next!==node.url){
        const start=node.position.start.offset,raw=body.slice(start,node.position.end.offset);
        let destination;
        if(node.type==='definition')destination=raw.match(/^ {0,3}\[[^\]\n]+\]:[ \t]*/)?.[0].length;
        else{
          let depth=0;
          for(let i=node.type==='image'?1:0;i<raw.length;i++){
            if(raw[i]==='\\'){i++;continue;}
            if(raw[i]==='[')depth++;
            if(raw[i]===']'&&--depth===0){if(raw[i+1]==='(')destination=i+2;break;}
          }
        }
        const offset=destination===undefined?-1:raw.indexOf(node.url,destination);
        if(offset<0)throw new StoreError(422,'无法安全改写链接，请改用普通 Markdown 链接');
        patches.push({start:start+offset,end:start+offset+node.url.length,text:next});
      }
    }
    for(const child of node.children||[])visit(child);
  }
  visit(tree);
  let text=body;
  for(const p of patches.sort((a,b)=>b.start-a.start))text=text.slice(0,p.start)+p.text+text.slice(p.end);
  return text;
}

export function referenceResolver(from,to,moves,routeMoves,{skipImages=false}={}){
  return (href,kind)=>{
    if(!href||href.startsWith('#')||/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href))return href;
    if(skipImages&&kind==='image')return href;
    const cut=href.search(/[?#]/),raw=cut<0?href:href.slice(0,cut),suffix=cut<0?'':href.slice(cut);
    if(raw.startsWith('/posts/')){
      let route;try{route=decodeURIComponent(raw.slice(7).replace(/\/$/,''));}catch{throw new StoreError(422,'文章链接编码无效');}
      return routeMoves.has(route)?postUrl(routeMoves.get(route))+suffix:href;
    }
    if(raw.startsWith('/'))return href;
    let decoded;try{decoded=decodeURIComponent(raw);}catch{throw new StoreError(422,'相对引用编码无效');}
    const source=path.posix.normalize(path.posix.join(path.posix.dirname(from),decoded));
    if(source.startsWith('../'))throw new StoreError(422,'引用超出文章目录，请先修正：'+href);
    const target=moves.get(source)||source;
    if(from===to&&!moves.has(source))return href;
    const relative=path.posix.relative(path.posix.dirname(to),target);
    return relative.split('/').map(segment=>segment==='..'?'..':encodeURIComponent(segment)).join('/')+suffix;
  };
}

export function planArticleChanges(work,selections){
  const {posts,routes}=readPublicInventory(work,new Set(selections.filter(s=>s.oldPath&&s.text!==undefined).map(s=>s.oldPath))),byPath=new Map(posts.map(p=>[p.path,p]));
  const selected=new Map(selections.map(s=>[s.articleId,s]));
  if(selected.size!==selections.length)throw new StoreError(409,'文章身份重复');
  const moves=new Map(),routeMoves=new Map();
  for(const s of selections){
    s.path=normalizeArticlePath(s.path);
    if(s.oldPath&&!byPath.has(s.oldPath))throw new StoreError(409,'原文章已改变，请重新检查');
    if(s.oldPath){moves.set(s.oldPath,s.path);routeMoves.set(byPath.get(s.oldPath).route,routeFromPath(s.path));}
  }
  for(const a of routes.articles){const destination=selected.get(a.id)?.path||a.path;for(const alias of a.aliases)moves.set(alias+'.md',destination);}
  const finalPaths=new Set();
  for(const p of [...posts,...selections.filter(s=>!s.oldPath)]){
    const final=selected.get(p.articleId)?.path||p.path,key=pathKey(final);
    if(finalPaths.has(key))throw new StoreError(409,'目标已有同名文章（包括大小写或 Unicode 等价名称）：'+final);
    finalPaths.add(key);
  }
  const allFiles=fs.readdirSync(path.join(work,'src/content/posts'),{recursive:true});
  for(const s of selections)if(allFiles.some(f=>pathKey(f)===pathKey(s.path)&&f!==s.oldPath&&!moves.has(f)))throw new StoreError(409,'目标文件已被占用：'+s.path);
  const manifest={format:1,articles:posts.map(p=>routes.articles.find(a=>a.id===p.articleId)||{id:p.articleId,path:p.path,route:p.route,aliases:[],guidRoute:p.route})};
  for(const s of selections){
    let entry=manifest.articles.find(a=>a.id===s.articleId);
    if(!entry){entry={id:s.articleId,path:s.path,route:routeFromPath(s.path),aliases:[],guid:'urn:wonder:article:'+s.articleId};manifest.articles.push(entry);}
    const next=routeFromPath(s.path);
    entry.aliases=[...new Set([...entry.aliases,entry.route])].filter(r=>r!==next);entry.path=s.path;entry.route=next;
  }
  try{validateRoutes(manifest);}catch(e){throw new StoreError(409,e.message);}
  const archiveFile=path.join(work,ARCHIVE_FILE),archive=validateArchive(fs.existsSync(archiveFile)?JSON.parse(fs.readFileSync(archiveFile,'utf8')):{format:1,paths:{}});
  const writes=[],deletes=[],bindings=[],rows=[];
  for(const p of [...posts,...selections.filter(s=>!s.oldPath).map(s=>({articleId:s.articleId,path:s.path,text:s.text,data:{},route:routeFromPath(s.path)}))]){
    const s=selected.get(p.articleId),target=s?.path||p.path,original=s?.text??p.text;
    const parsed=matter(original),data={...parsed.data};
    const from=s?.referencePath||p.path;
    const resolve=referenceResolver(from,target,moves,routeMoves,{skipImages:!!s?.text});
    const content=rewriteReferences(parsed.content,resolve);
    if(data.image&&data.image!=='api')data.image=referenceResolver(p.path,target,moves,routeMoves)(data.image,'image');
    if(s){
      data.articleId=s.articleId;data.slug=routeFromPath(target);data.category=path.posix.dirname(target)==='.'?'':path.posix.dirname(target);
      delete archive.paths[p.route];delete archive.paths[routeFromPath(target)];
    }
    const changed=s||content!==parsed.content||data.image!==parsed.data.image;
    const text=changed?matter.stringify(content,data):original;
    if(changed){writes.push({path:'src/content/posts/'+target,text});bindings.push({articleId:p.articleId,oldPath:s?.oldPath||p.path,path:target,route:s?routeFromPath(target):p.route,hash:digest(text),draftId:s?.draftId});}
    if(s&&s.oldPath&&s.oldPath!==target)deletes.push('src/content/posts/'+s.oldPath);
    if(s)rows.push({title:data.title,oldPath:s.oldPath||'',newPath:target,path:target.split('/').slice(0,-1),previous:(s.oldPath||'').split('/').slice(0,-1),url:postUrl(routeFromPath(target)),oldUrl:s.oldPath?postUrl(p.route):null});
  }
  writes.push({path:ROUTES_FILE,text:JSON.stringify(manifest,null,2)+'\n'},{path:ARCHIVE_FILE,text:JSON.stringify(archive,null,2)+'\n'});
  return {writes,deletes,bindings,rows,routes:manifest};
}
