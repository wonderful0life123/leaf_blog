import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import matter from 'gray-matter';
import {articleIdentity,legacyArticleRoute,routeFromPath,ROUTES_FILE,validateRoutes} from '../../src/lib/article-paths.mjs';
import {ARCHIVE_FILE,validateArchive} from '../../src/lib/public-archive.mjs';
import {StoreError} from './store.mjs';
const mime={'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.avif':'image/avif'};
export function createCatalog(roots) {
  let imageFiles=new Map();
  function scan() {
    const articles=[],notes=[],assetMap={};imageFiles=new Map();
    for(const [kind,base] of Object.entries(roots)) {
      if(!fs.existsSync(base))continue;
      const root=fs.realpathSync(base);
      const routeFile=path.resolve(root,'../../../',ROUTES_FILE);
      const routes=kind==='blog'&&fs.existsSync(routeFile)?validateRoutes(JSON.parse(fs.readFileSync(routeFile,'utf8'))):{articles:[]};
      const archiveFile=path.resolve(root,'../../../',ARCHIVE_FILE);
      const archive=kind==='blog'&&fs.existsSync(archiveFile)?validateArchive(JSON.parse(fs.readFileSync(archiveFile,'utf8'))):{paths:{}};
      function walk(dir) {
        for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
          if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
          const file=path.join(dir,entry.name),relative=path.relative(root,file);
          if(entry.isDirectory()){walk(file);continue;}
          if(!entry.isFile())continue;
          if(mime[path.extname(file).toLowerCase()]) {
            const key=kind+'/'+relative,id=createHash('sha256').update(key).digest('hex').slice(0,24);
            assetMap[key]=id;imageFiles.set(id,{root,file});
          } else if(/\.mdx?$/.test(file)) {
            const body=fs.readFileSync(file,'utf8');
            if(kind==='notes')notes.push({id:relative,path:relative,title:path.basename(file,'.md'),body,folder:path.dirname(relative),root:kind});
            else {const {data,content}=matter(body),binding=routes.articles.find(a=>a.path===relative);articles.push({id:relative,articleId:binding?.id||articleIdentity(relative,data),route:binding?.route||legacyArticleRoute(relative,data),sourceHash:createHash('sha256').update(body).digest('hex'),path:relative,root:kind,title:String(data.title||path.basename(file)),body:content.trim(),category:String(data.category||''),tags:Array.isArray(data.tags)?data.tags.join(', '):String(data.tags||''),cover:String(data.image||''),description:String(data.description||''),status:data.draft?'draft':'published',directoryNeedsAlignment:!data.draft&&(String(data.category||'')!==(path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative))||Object.hasOwn(archive.paths,binding?.route||legacyArticleRoute(relative,data)))});}
          }
        }
      }
      walk(root);
    }
    return {articles,notes,assetMap};
  }
  function image(id) {
    if(!imageFiles.has(id))scan();
    const image=imageFiles.get(id);if(!image)throw new StoreError(404,'图片不存在');
    let real;try{real=fs.realpathSync(image.file);}catch{throw new StoreError(404,'图片不存在');}
    if(!real.startsWith(image.root+path.sep))throw new StoreError(403,'图片路径不受支持');
    const stat=fs.statSync(real);if(!stat.isFile()||stat.size>10*1024*1024)throw new StoreError(413,'图片过大');
    return {bytes:fs.readFileSync(real),mime:mime[path.extname(real).toLowerCase()]};
  }
  return {scan,image};
}
