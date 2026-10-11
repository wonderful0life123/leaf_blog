import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createStudioServer} from '../../scripts/studio/server.mjs';
import {serverConfig} from '../../scripts/studio/config.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64');
async function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wonder-auth-test-'));
  for(const d of ['web/studio','web/studio-static','posts','notes'])fs.mkdirSync(path.join(root,d),{recursive:true});
  fs.writeFileSync(path.join(root,'web/studio/index.html'),'<html>登录</html>');
  fs.writeFileSync(path.join(root,'web/studio-static/app.js'),'// compiled client');
  fs.writeFileSync(path.join(root,'notes/private.md'),'PRIVATE_CATALOG\n![图](image.png)');
  fs.writeFileSync(path.join(root,'notes/image.png'),png);
  const config={origin:'https://wonder.test',secure:true,ownerId:'222740128',clientId:'test-client',clientSecret:'test-secret',dataDir:path.join(root,'data'),webDir:path.join(root,'web'),sourceRoots:{blog:path.join(root,'posts'),notes:path.join(root,'notes')}};
  let profile={id:222740128,login:'wonderful0life123'},clock=Date.now(),calls=[],unavailable=false;
  const authOptions={now:()=>clock,fetcher:async(url,options)=>{
    calls.push({url,options});if(unavailable)throw new Error('Mock GitHub outage');
    if(url==='https://github.com/login/oauth/access_token')return {ok:true,json:async()=>({access_token:'mock-token'})};
    if(url==='https://api.github.com/user')return {ok:true,json:async()=>profile};
    throw Error('Unexpected external request');
  }};
  let server=createStudioServer(config,authOptions);
  async function listen(){server.listen(0,'127.0.0.1');await once(server,'listening');}
  await listen();
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  function request(url,options={}) {
    return new Promise((resolve,reject)=>{
      const body=options.body===undefined?undefined:Buffer.isBuffer(options.body)?options.body:Buffer.from(JSON.stringify(options.body));
      const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method:options.method||'GET',headers:{Host:'wonder.test',...(body?{'Content-Type':'application/json','Content-Length':body.length}:{}),...options.headers}},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const buffer=Buffer.concat(chunks);let data;try{data=JSON.parse(buffer);}catch{}resolve({status:res.statusCode,headers:res.headers,text:buffer.toString(),buffer,data});});
      });req.on('error',reject);req.end(body);
    });
  }
  async function begin(){const start=await request('/studio-auth/login/');assert.equal(start.status,302);return {start,url:new URL(start.headers.location),cookie:start.headers['set-cookie'][0].split(';')[0]};}
  async function finish(flow,cookie=flow.cookie){return request('/studio-auth/callback/?code=one-time-code&state='+flow.url.searchParams.get('state'),{headers:{Cookie:cookie,'sec-fetch-site':'cross-site'}});}
  async function login(){const flow=await begin(),response=await finish(flow);assert.equal(response.status,302);return response.headers['set-cookie'].find(c=>c.startsWith('__Host-wonder_session=')).split(';')[0];}
  return {root,config,calls,request,begin,finish,login,setUnavailable(){unavailable=true;},setProfile(v){profile=v;},advance(ms){clock+=ms;},async restart(){await new Promise(resolve=>server.close(resolve));server=createStudioServer(config,authOptions);await listen();}};
}
test('匿名用户可看登录外壳，但无法读取草稿、笔记、原图或上传图片',async t=>{
  const f=await setup(t);
  assert.equal((await f.request('/studio/')).status,200);
  for(const url of ['/studio-api/session/','/studio-api/catalog/','/studio-api/drafts/','/studio-api/media/'+'a'.repeat(64)+'/','/studio/assets/'+'a'.repeat(24)+'/'])assert.equal((await f.request(url)).status,401,url);
  assert.equal((await f.request('/studio-api/media/',{method:'POST',body:png,headers:{Origin:f.config.origin}})).status,401);
  assert.equal((await f.request('/studio-static/app.js')).status,200);
  assert.equal((await f.request('/studio-static/%2e%2e%2f../notes/private.md')).status,404);
  assert.equal((await f.request('/studio/',{headers:{Host:'evil.test'}})).status,403);
});
test('OAuth 带 PKCE，校验浏览器绑定和一次性 state，登录只允许指定账号',async t=>{
  const f=await setup(t),flow=await f.begin();
  assert.equal(flow.url.searchParams.get('scope'),'');assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
  assert.match(flow.start.headers['set-cookie'][0],/HttpOnly; SameSite=Lax.*; Secure/);
  assert.equal((await f.finish(flow,'')).headers.location,'/studio/?loginError=expired');assert.equal(f.calls.length,0);
  const result=await f.finish(flow);assert.equal(result.status,302);
  assert.equal(createHash('sha256').update(f.calls[0].options.body.get('code_verifier')).digest('base64url'),flow.url.searchParams.get('code_challenge'));
  assert.equal(f.calls[0].options.body.get('redirect_uri'),f.config.origin+'/studio-auth/callback/');
  assert.equal((await f.finish(flow)).headers.location,'/studio/?loginError=expired');assert.equal(f.calls.length,2);
  f.setProfile({id:123,login:'wonderful0life123'});const denied=await f.finish(await f.begin());assert.equal(denied.headers.location,'/studio/?loginError=denied');assert(!denied.headers['set-cookie'].some(c=>c.startsWith('__Host-wonder_session=')));
});
test('登录会话跨重启有效，草稿图片受保护，跨站写入与版本覆盖被拒绝，退出立即撤销',async t=>{
  const f=await setup(t),cookie=await f.login(),headers={Cookie:cookie,Origin:f.config.origin};
  assert.equal((await f.request('/studio-api/session/',{headers})).data.user.login,'wonderful0life123');
  const catalog=(await f.request('/studio-api/catalog/',{headers})).data;assert.equal(catalog.notes.length,1);
  const originalImage=Object.values(catalog.assetMap)[0];assert.deepEqual((await f.request('/studio/assets/'+originalImage+'/',{headers})).buffer,png);
  const image=(await f.request('/studio-api/media/',{method:'POST',headers,body:png})).data;
  const draft=(await f.request('/studio-api/drafts/',{method:'POST',headers,body:{title:'私有草稿',body:`![图](${image.url})`,category:'学习',tags:'测试'}})).data.draft;
  assert.equal((await f.request('/studio-api/drafts/'+draft.id+'/',{method:'PUT',headers:{Cookie:cookie},body:draft})).status,403);
  assert.equal((await f.request('/studio-api/drafts/'+draft.id+'/',{method:'PUT',headers:{...headers,Origin:'https://evil.test'},body:draft})).status,403);
  assert.equal((await f.request('/studio-api/drafts/'+draft.id+'/',{method:'PUT',headers,body:{...draft,title:'新版'}})).status,200);
  assert.equal((await f.request('/studio-api/drafts/'+draft.id+'/',{method:'PUT',headers,body:draft})).status,409);
  await f.restart();assert.equal((await f.request('/studio-api/drafts/',{headers})).data.drafts[0].title,'新版');
  assert.deepEqual((await f.request(image.url,{headers})).buffer,png);
  assert.equal((await f.request('/studio-api/logout/',{method:'POST',headers})).status,200);
  assert.equal((await f.request('/studio-api/drafts/',{headers})).status,401);
});
test('过期 state 与会话失效，改变允许账号也立即拒绝旧会话',async t=>{
  const f=await setup(t),flow=await f.begin();f.advance(600001);assert.equal((await f.finish(flow)).headers.location,'/studio/?loginError=expired');
  let cookie=await f.login();f.advance(7*24*60*60*1000+1);assert.equal((await f.request('/studio-api/session/',{headers:{Cookie:cookie}})).status,401);
  cookie=await f.login();f.config.ownerId='999';assert.equal((await f.request('/studio-api/session/',{headers:{Cookie:cookie}})).status,401);
});
test('配置必须完整、HTTPS 且草稿目录不能位于公开目录',()=>{
  const env={WONDER_STUDIO_ORIGIN:'https://wonder.test',WONDER_GITHUB_OWNER_ID:'222740128',WONDER_GITHUB_CLIENT_ID:'id',WONDER_GITHUB_CLIENT_SECRET:'secret',WONDER_STUDIO_DATA_DIR:'/private/wonder-data',WONDER_STUDIO_POSTS_DIR:'/opt/blog/posts',WONDER_STUDIO_NOTES_DIR:'/opt/notes'};
  assert.equal(serverConfig(env).secure,true);
  assert.throws(()=>serverConfig({...env,WONDER_GITHUB_CLIENT_SECRET:''}));
  assert.throws(()=>serverConfig({...env,WONDER_STUDIO_ORIGIN:'http://wonder.test'}));
  assert.throws(()=>serverConfig({...env,WONDER_STUDIO_DATA_DIR:'/var/www/private'}));
  assert.throws(()=>serverConfig({...env,WONDER_STUDIO_DATA_DIR:'/opt/notes/data'}));
  assert.equal(serverConfig({...env,WONDER_STUDIO_ORIGIN:'http://127.0.0.1:4312',WONDER_STUDIO_DEV_HTTP:'1'}).secure,false);
});
test('登录上游失败返回可重试页面，会话数据库不保存 GitHub token 或原始会话 cookie',async t=>{
  const f=await setup(t),cookie=await f.login();
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(path.join(f.config.dataDir,'auth.sqlite'),{readOnly:true});
  try{const rows=db.prepare('SELECT * FROM sessions').all();assert.equal(rows.length,1);assert.notEqual(rows[0].hash,cookie.split('=')[1]);assert(!JSON.stringify(rows).includes('mock-token'));}finally{db.close();}
  const flow=await f.begin();
  const denied=await f.request('/studio-auth/callback/?error=access_denied&state='+flow.url.searchParams.get('state'),{headers:{Cookie:flow.cookie}});
  assert.equal(denied.headers.location,'/studio/?loginError=expired');
  f.setUnavailable();const failed=await f.finish(await f.begin());assert.equal(failed.headers.location,'/studio/?loginError=unavailable');
});
