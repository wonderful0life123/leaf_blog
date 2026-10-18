import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {createStudioServer} from '../../scripts/studio/server.mjs';
import {serverConfig} from '../../scripts/studio/config.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=','base64');
test('草稿复制、回收站、恢复和彻底删除接口要求登录同源及当前版本',async t=>{
 const f=await setup(t),cookie=await f.login(),headers={Cookie:cookie,Origin:f.config.origin};
 const d=(await f.request('/studio-api/drafts/',{method:'POST',headers,body:{title:'管理测试',body:'正文',category:'测试',tags:''}})).data.draft;
 for(const action of ['duplicate','trash','restore','purge']){
  const url=`/studio-api/drafts/${d.id}/${action}/`;
  assert.equal((await f.request(url,{method:'POST',headers:{Origin:f.config.origin},body:{revision:1,id:randomUUID()}})).status,401);
  assert.equal((await f.request(url,{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test'},body:{revision:1}})).status,403);
 }
 const action=async(name,revision=1)=>f.request(`/studio-api/drafts/${d.id}/${name}/`,{method:'POST',headers,body:{revision,id:randomUUID()}});
 assert.equal((await action('duplicate')).status,200);
 const deleted=(await action('trash')).data.draft;
 assert.equal((await f.request('/studio-api/drafts/?state=trash',{headers})).data.drafts[0].id,d.id);
 assert.equal((await action('restore')).status,409);
 const restored=(await action('restore',deleted.revision)).data.draft;
 const deletedAgain=(await action('trash',restored.revision)).data.draft;
 assert.equal((await action('purge',deletedAgain.revision)).status,200);
 assert.equal((await f.request(`/studio-api/drafts/${d.id}/`,{headers})).status,404);
 assert.equal((await f.request('/studio-api/drafts/?state=trash',{headers})).data.drafts.length,0);
});
async function setup(t,overrides={}) {
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
  },...overrides};
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

test('OAuth 故障日志区分失败阶段且不泄露凭据或上游原文',async t=>{
  const cases=[
    {name:'secret mismatch',stage:'token_exchange',reason:'incorrect_client_credentials',status:200,fetcher:async()=>({ok:true,status:200,json:async()=>({error:'incorrect_client_credentials',error_description:'SECRET_UPSTREAM_TEXT'})})},
    {name:'network timeout',stage:'token_exchange',reason:'network_error',networkCode:'UND_ERR_CONNECT_TIMEOUT',fetcher:async()=>{throw Object.assign(new Error('SECRET_UPSTREAM_TEXT'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});}},
    {name:'identity denied',stage:'user_profile',reason:'http_error',status:401,fetcher:async url=>url.includes('/access_token')?{ok:true,status:200,json:async()=>({access_token:'SECRET_UPSTREAM_TEXT'})}:{ok:false,status:401}},
    {name:'invalid token response',stage:'token_exchange',reason:'invalid_json',status:200,fetcher:async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('SECRET_UPSTREAM_TEXT');}})},
    {name:'unknown provider error',stage:'token_exchange',reason:'missing_access_token',status:200,fetcher:async()=>({ok:true,status:200,json:async()=>({error:'SECRET_UPSTREAM_TEXT'})})},
    {name:'invalid profile',stage:'user_profile',reason:'invalid_profile',status:200,fetcher:async url=>({ok:true,status:200,json:async()=>url.includes('/access_token')?{access_token:'SECRET_UPSTREAM_TEXT'}:{message:'SECRET_UPSTREAM_TEXT'}})},
  ];
  for(const c of cases)await t.test(c.name,async t=>{
    const reports=[],f=await setup(t,{fetcher:c.fetcher,reportFailure:event=>reports.push(event)});
    const result=await f.finish(await f.begin());
    assert.equal(result.headers.location,'/studio/?loginError=unavailable');
    assert.equal(reports.length,1);
    assert.equal(reports[0].stage,c.stage);assert.equal(reports[0].reason,c.reason);
    if(c.status)assert.equal(reports[0].status,c.status);
    if(c.networkCode)assert.equal(reports[0].networkCode,c.networkCode);
    const output=JSON.stringify(reports)+result.text+JSON.stringify(result.headers);
    for(const secret of ['SECRET_UPSTREAM_TEXT','test-secret','one-time-code'])assert(!output.includes(secret));
    assert(!result.headers['set-cookie'].some(c=>c.startsWith('__Host-wonder_session=')));
  });
});
test('发布设置、任务与私密预览均需登录，提交需要同源请求',async t=>{
 const f=await setup(t),cookie=await f.login(),headers={Cookie:cookie,Origin:f.config.origin};
 const draft=(await f.request('/studio-api/drafts/',{method:'POST',headers,body:{title:'发布权限',body:'PRIVATE_PREVIEW',category:'',tags:''}})).data.draft;
 const info=`/studio-api/drafts/${draft.id}/publication/`,job=`/studio-api/publications/${randomUUID()}/`;
 for(const url of [info,job,job+'preview/posts/private/'])assert.equal((await f.request(url)).status,401);
 for(const url of [info,job])assert.equal((await f.request(url,{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test'},body:{confirm:true}})).status,403);
 assert.equal((await f.request(info,{headers})).data.enabled,false);
 assert.equal((await f.request(info,{method:'POST',headers,body:{revision:1}})).status,503);
});
for(const previewOnly of [false,true])test(`${previewOnly?'单篇':'旧版构建'}预览 HTML 与 CSS 受保护、禁止缓存、禁止脚本并正确改写字体地址`,async t=>{
 const f=await setup(t),id=randomUUID(),dir=path.join(f.config.dataDir,'publications',id),output=previewOnly?'work/preview':'work/dist';
 fs.mkdirSync(path.join(dir,output+'/posts/test'),{recursive:true});fs.mkdirSync(path.join(dir,output+'/_astro'));
 fs.writeFileSync(path.join(dir,'job.json'),JSON.stringify({id,state:'ready',built:true,previewOnly,url:'/posts/test/',createdAt:new Date().toISOString()}));
 fs.writeFileSync(path.join(dir,output+'/posts/test/index.html'),'<html><script>private()</script><link rel="stylesheet" href="/_astro/font.css"><p>PRIVATE_RENDER</p></html>');
 fs.writeFileSync(path.join(dir,output+'/_astro/font.css'),'@font-face{src:url(/_astro/font.woff2)}');
 const url=`/studio-api/publications/${id}/preview`,cookie=await f.login();
 assert.equal((await f.request(url+'/posts/test/')).status,401);assert.equal((await f.request(url+'/_astro/font.css')).status,401);
 const html=await f.request(url+'/posts/test/',{headers:{Cookie:cookie}});assert.equal(html.status,200);assert.match(html.headers['content-security-policy'],/default-src 'none'/);assert.match(html.headers['cache-control'],/private, no-store/);assert.equal(html.headers['x-frame-options'],'SAMEORIGIN');assert.ok(!html.text.includes('<script'));assert.ok(html.text.includes('PRIVATE_RENDER'));
 const css=await f.request(url+'/_astro/font.css',{headers:{Cookie:cookie}});assert.equal(css.status,200);assert.ok(css.text.includes(url+'/_astro/font.woff2'));assert.equal((await f.request(url+'/%2e%2e%2fjob.json',{headers:{Cookie:cookie}})).status,404);
 for(const resource of ['/posts/test/','/_astro/font.css'])assert.equal((await f.request(url+resource)).status,401,'已登录读取后匿名仍不可访问');
});

test('目录移动与撤销受登录、同源和版本保护，刷新及服务重启后保留',async t=>{
 const f=await setup(t),cookie=await f.login(),headers={Cookie:cookie,Origin:f.config.origin};
 fs.mkdirSync(path.join(f.root,'posts','目录'),{recursive:true});fs.writeFileSync(path.join(f.root,'posts','目录','文章.md'),'---\ntitle: 文章\n---\n原文');
 for(const route of ['organization','organization/move','organization/undo'])assert.equal((await f.request('/studio-api/'+route+'/',{method:route==='organization'?'GET':'POST',headers:{Origin:f.config.origin},body:route==='organization'?undefined:{revision:0}})).status,401);
 const organization=(await f.request('/studio-api/organization/',{headers})).data.organization;assert.equal(organization.revision,0);
 const body={revision:0,kind:'article',id:'blog:目录/文章.md',target:null};
 assert.equal((await f.request('/studio-api/organization/move/',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test'},body})).status,403);
 const moved=await f.request('/studio-api/organization/move/',{method:'POST',headers,body});assert.equal(moved.status,200);assert.equal(moved.data.organization.placements['article:legacy:目录/文章.md'],null);
 assert.equal((await f.request('/studio-api/organization/move/',{method:'POST',headers,body})).status,409);
 await f.restart();const fresh=await f.request('/studio-api/organization/',{headers});assert.match(fresh.headers['cache-control'],/no-store/);assert.equal(fresh.data.organization.revision,1);
 const undo=await f.request('/studio-api/organization/undo/',{method:'POST',headers,body:{revision:1,token:moved.data.organization.undoToken}});assert.equal(undo.status,200);assert.equal(undo.data.organization.placements['article:legacy:目录/文章.md'],'folder:目录');
 assert.equal(fs.readFileSync(path.join(f.root,'posts','目录','文章.md'),'utf8'),'---\ntitle: 文章\n---\n原文');
});

test('目录增删改接口保护与指定目录创建文章',async t=>{
 const f=await setup(t),cookie=await f.login(),headers={Cookie:cookie,Origin:f.config.origin};
 const url='/studio-api/organization/folders/',body={revision:0,action:'create',name:'工作台验收',parent:null};
 assert.equal((await f.request(url,{method:'POST',headers:{Origin:f.config.origin},body})).status,401);
 assert.equal((await f.request(url,{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test'},body})).status,403);
 const created=await f.request(url,{method:'POST',headers,body});assert.equal(created.status,200);assert.match(created.headers['cache-control'],/no-store/);
 const state=created.data.organization,target=state.folders.find(f=>f.name===body.name).id;
 const response=await f.request('/studio-api/drafts/',{method:'POST',headers,body:{id:randomUUID(),title:'目录草稿',body:'内容',category:'',tags:'',organization:{target,revision:state.revision}}});assert.equal(response.status,201);
 const result=response.data;assert.equal(result.organization.placements['draft:'+result.draft.id],target);
 assert.equal((await f.request(url,{method:'POST',headers,body:{revision:result.organization.revision,action:'delete',id:target}})).status,409);
 const renamed=await f.request(url,{method:'POST',headers,body:{revision:result.organization.revision,action:'rename',id:target,name:'已改名'}});assert.equal(renamed.status,200);
 await f.restart();assert.equal((await f.request('/studio-api/organization/',{headers})).data.organization.folders.find(f=>f.id===target).name,'已改名');
});

test('打开已发布文章的创建响应即带正确状态，保存修改及恢复原文同步更新',async t=>{
 const f=await setup(t),cookie=await f.login(),headers={Cookie:cookie,Origin:f.config.origin};
 fs.writeFileSync(path.join(f.config.sourceRoots.blog,'status.md'),'---\ntitle: 状态验收\ntags: [CUDA]\n---\n正文');
 const created=await f.request('/studio-api/drafts/',{method:'POST',headers,body:{title:'状态验收',body:'正文',category:'',tags:'CUDA',source:{root:'blog',path:'status.md'}}});
 assert.equal(created.status,201);let draft=created.data.draft;
 assert.equal(draft.status,'published');assert.equal(draft.hasUnpublishedChanges,false);
 const save=body=>f.request('/studio-api/drafts/'+draft.id+'/',{method:'PUT',headers,body:{...draft,body}});
 draft=(await save('修改正文')).data.draft;assert.equal(draft.hasUnpublishedChanges,true);
 draft=(await save('正文')).data.draft;assert.equal(draft.status,'published');assert.equal(draft.hasUnpublishedChanges,false);
 const listed=await f.request('/studio-api/drafts/',{headers});assert.equal(listed.data.drafts.find(d=>d.id===draft.id).status,'published');
});

test('Studio starts preview warmup before any authenticated request and keeps anonymous access blocked',async t=>{
 const f=await setup(t),repo=path.join(f.root,'publisher'),compiled=path.join(repo,'.studio-preview');
 fs.mkdirSync(path.join(repo,'src/content/posts'),{recursive:true});
 fs.mkdirSync(path.join(compiled,'assets'),{recursive:true});
 fs.writeFileSync(path.join(compiled,'assets/preview.css'),'/* fixture */');
 fs.writeFileSync(path.join(compiled,'renderer.mjs'),`import fs from 'node:fs';export function renderArticle(){fs.writeFileSync(new URL('./warmed',import.meta.url),'ready');return '<html>ready</html>';}`);
 f.config.publication={repoDir:repo,enabled:false};
 await f.restart();
 const marker=path.join(compiled,'warmed');
 for(let i=0;i<100&&!fs.existsSync(marker);i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(fs.readFileSync(marker,'utf8'),'ready');
 assert.equal((await f.request('/studio/')).status,200);
 assert.equal((await f.request('/studio-api/drafts/')).status,401);
 assert.deepEqual(fs.readdirSync(path.join(f.config.dataDir,'publications')),[]);
});
