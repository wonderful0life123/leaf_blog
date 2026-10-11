import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { marked } from 'marked';

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
  PRAGMA user_version=1;`);
  fs.chmodSync(filename,0o600);
  const decode = row => row ? ({id:row.id,revision:row.revision,title:row.title,body:row.body,category:row.category,tags:row.tags,
    source:row.source_json?JSON.parse(row.source_json):null,assets:JSON.parse(row.assets_json),createdAt:row.created_at,updatedAt:row.updated_at,status:'draft',persisted:true}) : null;
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
  function snapshotAssets(body, source, existing = {}) {
    const assets={...existing};
    // Parse Markdown tokens so code examples are not treated as attachments.
    marked.walkTokens(marked.lexer(body), token => {
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
    if(db.prepare('SELECT COUNT(*) n FROM drafts').get().n===0)return;
    if(!fs.existsSync(dir)||!fs.readdirSync(dir).some(n=>n.startsWith(prefix)))backup();
    backedUpDay=day;
  }
  return {
    filename, get, backup,
    list(){return db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC').all().map(decode);},
    create(input) {
      const value=fields(input);const id=input.id||randomUUID();if(!uuid.test(id))fail(400,'无效的草稿编号');
      const source=input.source ? {...input.source} : null;
      if(source) { resolveSource(source); if(typeof source.root!=='string'||typeof source.path!=='string')fail(400,'来源无效'); }
      const key=source?source.root+':'+source.path:null;
      beforeWrite();
      return transaction(()=>{
        const existing=db.prepare('SELECT * FROM drafts WHERE id=? OR source_key=?').get(id,key);
        if(existing)return decode(existing);
        if(source)source.baseHash=createHash('sha256').update(fs.readFileSync(resolveSource(source).file)).digest('hex');
        const assets=snapshotAssets(value.body,source,input.copyFrom?get(input.copyFrom).assets:{});const now=new Date().toISOString();
        db.prepare('INSERT INTO drafts VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,1,value.title,value.body,value.category,value.tags,key,source?JSON.stringify(source):null,JSON.stringify(assets),now,now);
        return get(id);
      });
    },
    update(id,input) {
      const value=fields(input);if(!Number.isSafeInteger(input.revision)||input.revision<1)fail(400,'缺少草稿版本');
      beforeWrite();
      return transaction(()=>{
        const old=get(id);if(old.revision!==input.revision)fail(409,'另一页面已保存新版。你的修改仍保留在当前页面，请另存副本后再比较。');
        const assets=snapshotAssets(value.body,old.source,old.assets);
        db.prepare('UPDATE drafts SET revision=revision+1,title=?,body=?,category=?,tags=?,assets_json=?,updated_at=? WHERE id=?').run(value.title,value.body,value.category,value.tags,JSON.stringify(assets),new Date().toISOString(),id);
        return get(id);
      });
    },
    upload(bytes){beforeWrite();return putImage(bytes);},
    media(id){if(!hash.test(id))fail(404,'图片不存在');const row=db.prepare('SELECT * FROM media WHERE id=?').get(id);if(!row)fail(404,'图片不存在');return row;},
    close(){db.close();}
  };
}
