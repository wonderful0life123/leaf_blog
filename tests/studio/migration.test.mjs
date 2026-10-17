import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../../scripts/studio/store.mjs';
test('v1 数据升级前备份，重复打开不破坏已有草稿',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-migration-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const db=new DatabaseSync(path.join(dir,'studio.sqlite'));
 db.exec(`CREATE TABLE drafts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,category TEXT NOT NULL,tags TEXT NOT NULL,source_key TEXT UNIQUE,source_json TEXT,assets_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); PRAGMA user_version=1;`);
 const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 db.prepare('INSERT INTO drafts VALUES(?,1,?,?,?,?,NULL,NULL,?,?,?)').run(id,'原稿','原文','分类','标签','{}','2026-01-01','2026-01-01');db.close();
 let store=openStore({dataDir:dir});assert.equal(store.get(id).body,'原文');assert.equal(store.get(id).deletedAt,null);store.close();
 const files=fs.readdirSync(path.join(dir,'backups'));assert.equal(files.length,1);
 const backup=new DatabaseSync(path.join(dir,'backups',files[0]));assert.equal(backup.prepare('PRAGMA user_version').get().user_version,1);assert.equal(backup.prepare('SELECT body FROM drafts').get().body,'原文');backup.close();
 store=openStore({dataDir:dir});assert.equal(store.get(id).revision,1);store.close();assert.equal(fs.readdirSync(path.join(dir,'backups')).length,1);
});


test('真实 v3 数据迁移保留活动草稿、回收站、附件、目录与撤销，独立身份只生成一次',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-v3-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const filename=path.join(dir,'studio.sqlite'),db=new DatabaseSync(filename);
 db.exec(`CREATE TABLE drafts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,category TEXT NOT NULL,tags TEXT NOT NULL,source_key TEXT UNIQUE,source_json TEXT,assets_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);CREATE TABLE media(id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BLOB NOT NULL);CREATE TABLE organization(id INTEGER PRIMARY KEY,state_json TEXT NOT NULL,undo_json TEXT);PRAGMA user_version=3;`);
 const ids=['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'];
 const state=JSON.stringify({revision:7,folders:[{id:'f',name:'中文目录',parent:null}],placements:{['draft:'+ids[0]]:'f'},undoToken:'saved-token'}),undo=JSON.stringify({revision:6,folders:[],placements:{},undoToken:null});
 for(const [i,id] of ids.entries())db.prepare('INSERT INTO drafts VALUES(?,7,?,?,?,?,NULL,NULL,?,?,?,?)').run(id,'同名标题','私人正文'+i,'原分类','标签','{"图.png":"/studio-api/media/existing/"}','2026-01-01','2026-01-02',i?'2026-01-03':null);
 db.prepare('INSERT INTO media VALUES(?,?,?)').run('existing','image/png',Buffer.from('unchanged-image'));db.prepare('INSERT INTO organization VALUES(1,?,?)').run(state,undo);db.close();
 let store=openStore({dataDir:dir});const migrated=ids.map(id=>store.get(id));assert.notEqual(migrated[0].articleId,migrated[1].articleId);assert.ok(migrated.every(d=>d.articleId!==d.id));store.close();
 const after=new DatabaseSync(filename);assert.equal(after.prepare('PRAGMA user_version').get().user_version,4);assert.deepEqual(after.prepare('SELECT state_json,undo_json FROM organization').get(),Object.assign(Object.create(null),{state_json:state,undo_json:undo}));assert.equal(Buffer.from(after.prepare('SELECT bytes FROM media').get().bytes).toString(),'unchanged-image');after.close();
 assert.equal(migrated[0].body,'私人正文0');assert.equal(migrated[1].deletedAt,'2026-01-03');assert.equal(migrated[0].revision,7);
 store=openStore({dataDir:dir});assert.deepEqual(ids.map(id=>store.get(id)),migrated);store.close();
 const backups=fs.readdirSync(path.join(dir,'backups'));assert.equal(backups.length,1);const backup=new DatabaseSync(path.join(dir,'backups',backups[0]));assert.equal(backup.prepare('PRAGMA user_version').get().user_version,3);assert.equal(backup.prepare('SELECT count(*) n FROM drafts').get().n,2);backup.close();
});
