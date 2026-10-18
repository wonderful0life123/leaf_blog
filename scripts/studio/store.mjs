import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { marked } from 'marked';
import matter from 'gray-matter';
import {articleIdentity,postUrl} from '../../src/lib/article-paths.mjs';
import {seedOrganization,moveOrganization,editFolderOrganization,OrganizationError} from '../../src/lib/studio-organization.mjs';

export class StoreError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new StoreError(status, message); };
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const hash = /^[a-f\d]{64}$/;
const MAX_IMAGE = 10 * 1024 * 1024;
function fields(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "需要草稿对象");
  const result = {};
  for (const [key, max] of Object.entries({ title: 500, body: 2_000_000, category: 500, tags: 2000 })) {
    if (typeof input[key] !== 'string' || input[key].length > max) fail(400, `字段 ${key} 缺失或过长`);
    result[key] = input[key];
  }
  if (input.cover !== undefined) {
    if (input.cover !== null && (typeof input.cover !== 'string' || input.cover.length > 2000 || /[\r\n\x00]/.test(input.cover) || /^(?!https?:)[a-z][\w+.-]*:|^\/\//i.test(input.cover))) fail(400, '封面地址无效');
    result.cover = input.cover;
  }
  return result;
}
function imageType(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0,6).toString())) return 'image/gif';
  if (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') return 'image/webp';
  if (bytes.subarray(4,8).toString()==='ftyp' && /^(avif|avis)$/.test(bytes.subarray(8,12).toString())) return 'image/avif';
  fail(415, '仅支持 PNG、JPEG、GIF、WebP、AVIF 图片');
}
export function openStore({ dataDir, sourceRoots = {} }) {
  fs.mkdirSync(dataDir, { recursive:true, mode:0o700 });
  const filename=path.join(dataDir,'studio.sqlite');
  if (!fs.existsSync(filename)) fs.closeSync(fs.openSync(filename,'wx',0o600));
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, revision INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    category TEXT NOT NULL, tags TEXT NOT NULL, source_key TEXT UNIQUE, source_json TEXT,
    assets_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
  `);
  const needsTrash=!db.prepare('PRAGMA table_info(drafts)').all().some(c=>c.name==='deleted_at');
  const needsBindings=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='article_bindings'").get();
  const needsOrganization=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization'").get();
  const needsCover=!db.prepare('PRAGMA table_info(drafts)').all().some(c=>c.name==='cover');
  if(needsCover||needsTrash||needsOrganization||needsBindings||!db.prepare('PRAGMA table_info(drafts)').all().some(c=>c.name==='article_id')){
    if(db.prepare('SELECT COUNT(*) n FROM drafts').get().n)backup();
    transaction(()=>{
      if(needsTrash)db.exec('ALTER TABLE drafts ADD COLUMN deleted_at TEXT');
      if(needsOrganization)db.exec('CREATE TABLE organization (id INTEGER PRIMARY KEY CHECK(id=1), state_json TEXT NOT NULL, undo_json TEXT)');
      if(needsBindings)db.exec('CREATE TABLE article_bindings (article_id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, route TEXT NOT NULL, hash TEXT NOT NULL, task TEXT, aliases_json TEXT NOT NULL)');
      if(!db.prepare('PRAGMA table_info(drafts)').all().some(c=>c.name==='article_id')){db.exec('ALTER TABLE drafts ADD COLUMN article_id TEXT');for(const row of db.prepare('SELECT id FROM drafts').all())db.prepare('UPDATE drafts SET article_id=? WHERE id=?').run(randomUUID(),row.id);}
      if(needsCover)db.exec('ALTER TABLE drafts ADD COLUMN cover TEXT');
      db.exec('PRAGMA user_version=5');
    });
  }
  fs.chmodSync(filename,0o600);
  const decode = row => row ? ({id:row.id,revision:row.revision,title:row.title,body:row.body,category:row.category,tags:row.tags,cover:row.cover,
    articleId:(row.source_json?JSON.parse(row.source_json).articleId:null)||row.article_id,
    source:row.source_json?JSON.parse(row.source_json):null,assets:JSON.parse(row.assets_json),createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at||null,status:'draft',persisted:true}) : null;
  function get(id) { if(!uuid.test(id)) fail(400,'无效的草稿编号'); const d=decode(db.prepare('SELECT * FROM drafts WHERE id=?').get(id));if(!d)fail(404,'草稿不存在');return d; }
  function transaction(fn) { db.exec('BEGIN IMMEDIATE');try { const r=fn();db.exec('COMMIT');return r; }catch(e){db.exec('ROLLBACK');throw e;} }
  function putImage(bytes) {
    if(!bytes.length || bytes.length>MAX_IMAGE) fail(413,'每张图片最多 10 MB');
    const mime=imageType(bytes), id=createHash('sha256').update(bytes).digest('hex');
    db.prepare('INSERT OR IGNORE INTO media(id,mime,bytes) VALUES(?,?,?)').run(id,mime,bytes);
    return {id,mime,size:bytes.length,url:'/studio-api/media/'+id+'/'};
  }
  function resolveSource(source) {
    if(!source||!['blog','notes'].includes(source.root)||typeof source.path!=='string'||!sourceRoots[source.root]) fail(400,'无效的笔记来源');
    const root=fs.realpathSync(sourceRoots[source.root]);
    let file;try{file=fs.realpathSync(path.resolve(root,source.path));}catch{fail(422,'来源文件不存在，请刷新笔记列表');}
    if(!file.startsWith(root+path.sep)||!/\.mdx?$/.test(file))fail(400,'来源必须是文章目录内的 Markdown 文件');
    return {root,file};
  }
  function snapshotAssets(body, source, existing = {}, cover = null) {
    const assets={...existing};
    // Parse Markdown tokens so code examples are not treated as attachments.
    const tokens=marked.lexer(body);
    if(cover && cover!=='api' && (!cover.startsWith('/') || cover.startsWith('/studio-api/media/')))tokens.push({type:'image',href:cover});
    marked.walkTokens(tokens, token => {
      if(token.type!=='image')return;
      const href=token.href;
      if(/^https?:\/\//i.test(href))return;
      if(/^\/studio-api\/media\/[a-f\d]{64}\/?$/.test(href)) {
        if(!db.prepare('SELECT id FROM media WHERE id=?').get(href.split('/').filter(Boolean).pop()))fail(422,'图片不存在，请重新上传');
        return;
      }
      if(assets[href])return;
      if(!source)fail(422,'请使用上传按钮添加图片，不能直接引用本机文件路径');
      const {root,file}=resolveSource(source);
      let local;
      try {
        if(/^[a-z][\w+.-]*:|^\/\//i.test(href))fail(422,'图片地址不受支持，请重新上传');
        const decoded=decodeURIComponent(href.split('#')[0].split('?')[0]);
        local=fs.realpathSync(path.resolve(path.dirname(file),decoded));
      }catch{fail(422,`找不到图片：${href}`);}
      if(!local.startsWith(root+path.sep))fail(422,'图片必须位于来源仓库内');
      if(!fs.statSync(local).isFile()||fs.statSync(local).size>MAX_IMAGE)fail(413,'图片文件无效或超过 10 MB');
      assets[href]=putImage(fs.readFileSync(local)).url;
    });
    return assets;
  }
  function backup() {
    const dir=path.join(dataDir,'backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const target=path.join(dir,`studio-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.sqlite`);
    db.prepare('VACUUM INTO ?').run(target);fs.chmodSync(target,0o600);return target;
  }
  // Keep a consistent daily snapshot before changing existing drafts.
  let backedUpDay="";
  function beforeWrite() {
    const day=new Date().toISOString().slice(0,10);
    if(backedUpDay===day)return;
    const prefix='studio-'+day;
    const dir=path.join(dataDir,'backups');
    if(db.prepare('SELECT COUNT(*) n FROM drafts').get().n===0&&!db.prepare('SELECT id FROM organization WHERE id=1').get())return;
    if(!fs.existsSync(dir)||!fs.readdirSync(dir).some(n=>n.startsWith(prefix)))backup();
    backedUpDay=day;
  }
  return {
    filename, get, backup,
    bindings(){return db.prepare('SELECT * FROM article_bindings').all().map(r=>({articleId:r.article_id,path:r.path,route:r.route,hash:r.hash,task:r.task,aliases:JSON.parse(r.aliases_json)}));},
    binding(draft){return this.bindings().find(b=>b.articleId===draft.articleId||b.path===draft.source?.path||b.aliases.includes(draft.source?.path));},
    bindArticles(items){
      const posts=items.filter(a=>!a.persisted&&a.root==='blog'&&a.status==='published'&&a.articleId&&a.sourceHash),known=new Set(this.bindings().map(b=>b.articleId));
      for(const a of posts){
        if(!known.has(a.articleId))db.prepare('INSERT INTO article_bindings(article_id,path,route,hash,aliases_json) VALUES(?,?,?,?,?)').run(a.articleId,a.path,a.route,a.sourceHash,'[]');
        known.add(a.articleId);
      }
      const bindings=this.bindings(),byId=new Map(bindings.map(b=>[b.articleId,b])),byPath=new Map();
      for(const b of bindings)for(const p of [b.path,...b.aliases])if(!byPath.has(p))byPath.set(p,b);
      return items.map(a=>{const b=a.persisted?(byId.get(a.articleId)||byPath.get(a.source?.path)):null;return b?{...a,articleId:b.articleId,publication:{...(a.publication||{}),path:b.path,url:postUrl(b.route)}}:a;});
    },
    reconcilePublication(job){
      beforeWrite();return transaction(()=>{
        for(const item of job.bindings||[]){
          const old=this.bindings().find(b=>b.articleId===item.articleId);
          if(old?.task===job.id)continue;
          const aliases=[...new Set([...(old?.aliases||[]),item.oldPath].filter(Boolean))];
          db.prepare('INSERT INTO article_bindings(article_id,path,route,hash,task,aliases_json) VALUES(?,?,?,?,?,?) ON CONFLICT(article_id) DO UPDATE SET path=excluded.path,route=excluded.route,hash=excluded.hash,task=excluded.task,aliases_json=excluded.aliases_json').run(item.articleId,item.path,item.route,item.hash,job.id,JSON.stringify(aliases));
          for(const row of db.prepare('SELECT * FROM drafts').all()){
            const source=row.source_json?JSON.parse(row.source_json):null;
            if(row.id!==item.draftId&&!(source?.root==='blog'&&(source.articleId===item.articleId||source.path===item.oldPath||aliases.includes(source.path))))continue;
            const next={...source,root:'blog',path:item.path,articleId:item.articleId,baseHash:item.hash,referencePath:source?.referencePath||source?.path||item.path};
            db.prepare('UPDATE drafts SET source_key=?,source_json=? WHERE id=?').run('blog:'+item.path,JSON.stringify(next),row.id);
          }
        }
      });
    },
    organization(items){
      const row=db.prepare('SELECT state_json FROM organization WHERE id=1').get();
      return seedOrganization(row?JSON.parse(row.state_json):null,this.bindArticles(items));
    },
    moveOrganization(input,items){
      beforeWrite();
      return transaction(()=>{
        const current=this.organization(items);
        let next;try{next=moveOrganization(current,input,items);}catch(e){if(e instanceof OrganizationError)fail(e.status,e.message);throw e;}
        next.undoToken=randomUUID();
        db.prepare('INSERT INTO organization(id,state_json,undo_json) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,undo_json=excluded.undo_json').run(JSON.stringify(next),JSON.stringify(current));
        return next;
      });
    },
    editFolderOrganization(input,items){
      beforeWrite();return transaction(()=>{
        const current=this.organization(items);
        let next;try{next=editFolderOrganization(current,input,items,'folder:'+randomUUID());}catch(e){if(e instanceof OrganizationError)fail(e.status,e.message);throw e;}
        next.undoToken=randomUUID();
        db.prepare('INSERT INTO organization(id,state_json,undo_json) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,undo_json=excluded.undo_json').run(JSON.stringify(next),JSON.stringify(current));
        return next;
      });
    },
    undoOrganization(input,items){
      beforeWrite();return transaction(()=>{
        const row=db.prepare('SELECT * FROM organization WHERE id=1').get(),current=this.organization(items);
        if(!row?.undo_json||!input?.token||input.token!==current.undoToken||input.revision!==current.revision)fail(409,'目录已有新操作，不能撤销这次目录操作。');
        const next=seedOrganization({...JSON.parse(row.undo_json),revision:current.revision+1,undoToken:null},items);
        db.prepare('UPDATE organization SET state_json=?,undo_json=NULL WHERE id=1').run(JSON.stringify(next));return next;
      });
    },
    list({trash=false}={}){return db.prepare(`SELECT * FROM drafts WHERE deleted_at IS ${trash?'NOT ':''}NULL ORDER BY ${trash?'deleted_at':'updated_at'} DESC`).all().map(decode);},
    create(input,items=[]) {
      const value=fields(input);const id=input.id||randomUUID();if(!uuid.test(id))fail(400,'无效的草稿编号');
      const source=input.source ? {...input.source} : null;
      if(source) { resolveSource(source); if(typeof source.root!=='string'||typeof source.path!=='string')fail(400,'来源无效'); }
      const key=source?source.root+':'+source.path:null;
      beforeWrite();
      return transaction(()=>{
        const existing=db.prepare('SELECT * FROM drafts WHERE id=? OR source_key=?').get(id,key);
        if(existing){if(existing.deleted_at)fail(409,'这篇草稿已在回收站，请先恢复后再打开或导入。');return decode(existing);}
        let placement;
        if(input.organization!==undefined){
          if(source)fail(400,'导入文章不能在创建时覆盖目录。');
          placement=this.organization(items);
          if(input.organization?.revision!==placement.revision)fail(409,'目录已变化，请重新选择目录后创建文章。');
          const target=input.organization.target;
          if(target!==null&&!placement.folders.some(f=>f.id===target))fail(404,'目标目录不存在。');
          placement.placements['draft:'+id]=target;placement.revision++;placement.undoToken=null;
        }
        const copied=input.copyFrom?get(input.copyFrom):null;
        const sourceBytes=source?fs.readFileSync(resolveSource(source).file):null;
        const sourceData=sourceBytes?matter(sourceBytes.toString()).data:null;
        if(source){
          source.referencePath=source.path;
          const binding=this.bindings().find(b=>b.path===source.path);
          if(source.root==='blog')source.articleId=binding?.articleId||articleIdentity(source.path,sourceData);
          source.baseHash=createHash('sha256').update(sourceBytes).digest('hex');
        }
        if(value.cover==null&&source)value.cover=String(sourceData.image||'');
        if(value.cover==null&&copied)value.cover=copied.cover;
        if(value.cover==null&&copied?.source){
          // A retained draft must remain copyable after its original file moves away.
          try{value.cover=String(matter(fs.readFileSync(resolveSource(copied.source).file,'utf8')).data.image||'');}
          catch(error){if(!(error instanceof StoreError)&&!['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))throw error;}
        }
        const assets=snapshotAssets(value.body,source||copied?.source,copied?.assets||{},value.cover);const now=new Date().toISOString();
        db.prepare('INSERT INTO drafts(id,revision,title,body,category,tags,source_key,source_json,assets_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,1,value.title,value.body,value.category,value.tags,key,source?JSON.stringify(source):null,JSON.stringify(assets),now,now);
        db.prepare('UPDATE drafts SET article_id=?,cover=? WHERE id=?').run(source?.articleId||randomUUID(),value.cover??'',id);
        if(placement)db.prepare('INSERT INTO organization(id,state_json,undo_json) VALUES(1,?,NULL) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,undo_json=NULL').run(JSON.stringify(placement));
        return get(id);
      });
    },
    update(id,input) {
      const value=fields(input);if(!Number.isSafeInteger(input.revision)||input.revision<1)fail(400,'缺少草稿版本');
      beforeWrite();
      return transaction(()=>{
        const old=get(id);if(old.deletedAt)fail(409,'这篇草稿已移入回收站。请先恢复，或将当前修改另存副本。');if(old.revision!==input.revision)fail(409,'另一页面已保存新版。你的修改仍保留在当前页面，请另存副本后再比较。');
        const cover=value.cover===undefined?old.cover:value.cover;
        const assets=snapshotAssets(value.body,old.source,old.assets,cover);
        db.prepare('UPDATE drafts SET revision=revision+1,title=?,body=?,category=?,tags=?,cover=?,assets_json=?,updated_at=? WHERE id=?').run(value.title,value.body,value.category,value.tags,cover,JSON.stringify(assets),new Date().toISOString(),id);
        return get(id);
      });
    },
    duplicate(id,input){
      const old=get(id);
      if(old.deletedAt)fail(409,'请先恢复回收站中的草稿。');
      if(old.revision!==input?.revision)fail(409,'草稿已有变化，请刷新列表后再复制。');
      if(!uuid.test(input?.id))fail(400,'缺少副本编号');
      return this.create({...fields(old),title:(old.title||'未命名文章').slice(0,490)+'（副本）',id:input.id,copyFrom:id});
    },
    lifecycle(id,action,input){
      if(!['trash','restore','purge'].includes(action))fail(400,'无效操作');
      if(!Number.isSafeInteger(input?.revision)||input.revision<1)fail(400,'缺少草稿版本');
      beforeWrite();
      return transaction(()=>{
        const old=get(id);
        if(old.revision!==input.revision)fail(409,'草稿已在其他页面修改，请刷新列表后重试。');
        if(action==='trash'&&old.deletedAt)fail(409,'草稿已在回收站。');
        if(action!=='trash'&&!old.deletedAt)fail(409,'只能恢复或彻底删除回收站中的草稿。');
        if(action==='purge'){
          db.prepare('DELETE FROM drafts WHERE id=?').run(id);
          // Media may be shared with copies and other drafts. Do not delete it.
          return null;
        }
        db.prepare('UPDATE drafts SET deleted_at=?,revision=revision+1,updated_at=? WHERE id=?').run(action==='trash'?new Date().toISOString():null,new Date().toISOString(),id);
        return get(id);
      });
    },
    upload(bytes){beforeWrite();return putImage(bytes);},
    media(id){if(!hash.test(id))fail(404,'图片不存在');const row=db.prepare('SELECT * FROM media WHERE id=?').get(id);if(!row)fail(404,'图片不存在');return row;},
    close(){db.close();}
  };
}
