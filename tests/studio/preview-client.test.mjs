import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {previewClient} from '../../scripts/studio/preview-client.mjs';

function fixture(t,source){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-preview-worker-'));
 const renderer=path.join(root,'renderer.mjs');fs.writeFileSync(renderer,source);
 const client=previewClient(renderer);
 t.after(async()=>{await client.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,renderer,client};
}
test('startup shares one worker with immediate requests; concurrent jobs receive their own HTML',async t=>{
 const {client}=fixture(t,`let calls=0;export async function renderArticle(text){calls++;await new Promise(r=>setTimeout(r,20));return text+':'+calls;}`);
 const warmup=client.warmup();
 const [a,b]=await Promise.all([client.render('first',{}),client.render('second',{})]);
 assert.equal((await warmup).ready,true);assert.equal(a,'first:2');assert.equal(b,'second:3');
 assert.deepEqual(await client.warmup(),await warmup);
 assert.equal(await client.render('third',{}),'third:4');
});
test('missing renderer dependency reports deployment failure and can recover without restarting Studio',async t=>{
 const {client,renderer}=fixture(t,`import 'missing-wonder-renderer-dependency';export function renderArticle(){return '';}`);
 await assert.rejects(client.warmup(),error=>error.status===503&&/组件加载失败/.test(error.message)&&!error.message.includes('missing-wonder'));
 fs.writeFileSync(renderer,`export function renderArticle(text){return text;}`);
 assert.equal(await client.render('recovered',{}),'recovered');
});
test('render exceptions and worker exits are distinct and next request restarts a failed worker',async t=>{
 const {client}=fixture(t,`export function renderArticle(text){if(text==='bad'){throw new Error('PRIVATE draft secret');}if(text==='exit')process.exit(42);return text;}`);
 await client.warmup();
 await assert.rejects(client.render('bad',{}),error=>/文章渲染失败/.test(error.message)&&!error.message.includes('PRIVATE'));
 assert.equal(await client.render('good',{}),'good');
 await assert.rejects(client.render('exit',{}),/进程已退出/);
 assert.equal(await client.render('next',{}),'next');
});
test('close cancels startup and queued requests without restarting a worker',async t=>{
 const {client}=fixture(t,`await new Promise(r=>setTimeout(r,1000));export function renderArticle(t){return t;}`);
 const warming=client.warmup(),request=client.render('pending',{});
 const rejected=Promise.all([assert.rejects(warming,/正在关闭/),assert.rejects(request,/正在关闭/)]);
 await client.close();await rejected;
 await assert.rejects(client.warmup(),/正在关闭/);
});
