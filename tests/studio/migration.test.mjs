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
