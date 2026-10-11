import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler } from '../../scripts/studio/http.mjs';

function call({method='GET',url='/drafts',headers={},address='127.0.0.1',body=''}={},store={list:()=>[]}) {
  return new Promise((resolve,reject)=>{
    const req=Readable.from([Buffer.from(body)]);Object.assign(req,{method,url,headers:{host:'127.0.0.1:4321',...headers},socket:{remoteAddress:address}});
    const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(value){resolve({status:this.status,headers:this.headers,body:JSON.parse(value)});}};
    createHandler(store)(req,res).catch(reject);
  });
}
test('本机同源读取允许，远端和跨站请求被拒绝',async()=>{
  assert.equal((await call()).status,200);
  for(const args of [{address:'10.0.0.2'},{headers:{host:'evil.example'}},{headers:{origin:'https://evil.example'}},{headers:{'sec-fetch-site':'cross-site'}}])assert.equal((await call(args)).status,403);
});
test('修改需要同源 Origin，JSON 格式、大小均受到校验',async()=>{
  assert.equal((await call({method:'POST'})).status,403);
  const headers={origin:'http://127.0.0.1:4321','content-type':'application/json'};
  assert.equal((await call({method:'POST',headers,body:'{broken'})).status,400);
  assert.equal((await call({method:'POST',headers:{...headers,'content-length':4*1024*1024}})).status,413);
  const body={title:'草稿'};const result=await call({method:'POST',headers,body:JSON.stringify(body)},{create:v=>v});
  assert.equal(result.status,201);assert.deepEqual(result.body.draft,body);
});
