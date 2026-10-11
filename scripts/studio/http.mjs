import { StoreError } from './store.mjs';
const loopback = a => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(a);
export function createHandler(store, {authorize, catalog} = {}) {
  return async (req,res) => {
    const json = (status,value) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      if(authorize)authorize(req);
      else {
      // Stage one is explicitly local-only; do not deploy this gate as user authentication.
      const host=req.headers.host;
      if(!loopback(req.socket.remoteAddress)||!host||! /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))throw new StoreError(403,'此阶段仅允许本机访问');
      const origin=req.headers.origin;
      if((origin&&origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site')throw new StoreError(403,'不允许跨站访问草稿');
      }
      const host=req.headers.host;
      const method=req.method, pathname=new URL(req.url,`http://${host}`).pathname.replace(/\/$/,'');
      if(!['GET','POST','PUT'].includes(method))throw new StoreError(405,'不支持的操作');
      if(!authorize&&method!=='GET'&&req.headers.origin!==`http://${host}`)throw new StoreError(403,'保存请求缺少同源校验');
      async function body(max) {
        if(Number(req.headers['content-length'])>max)throw new StoreError(413,'内容过大');
        const chunks=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>max)throw new StoreError(413,'内容过大');chunks.push(chunk);}
        return Buffer.concat(chunks);
      }
      async function data() {
        if(!req.headers['content-type']?.startsWith('application/json'))throw new StoreError(415,'需要 JSON 数据');
        try{return JSON.parse((await body(3*1024*1024)).toString());}catch(e){if(e instanceof StoreError)throw e;throw new StoreError(400,'JSON 格式无效');}
      }
      if(pathname==='/catalog'&&method==='GET'&&catalog)return json(200,catalog.scan());
      if(pathname==='/drafts'&&method==='GET')return json(200,{drafts:store.list({trash:new URL(req.url,`http://${host}`).searchParams.get('state')==='trash'})});
      if(pathname==='/drafts'&&method==='POST')return json(201,{draft:store.create(await data())});
      const draft=pathname.match(/^\/drafts\/([^/]+)$/);
      if(draft&&method==='GET')return json(200,{draft:store.get(draft[1])});
      if(draft&&method==='PUT')return json(200,{draft:store.update(draft[1],await data())});
      const action=pathname.match(/^\/drafts\/([^/]+)\/(trash|restore|purge|duplicate)$/);
      if(action&&method==='POST'){
        const input=await data();
        return json(200,{draft:action[2]==='duplicate'?store.duplicate(action[1],input):store.lifecycle(action[1],action[2],input)});
      }
      if(pathname==='/media'&&method==='POST')return json(201,store.upload(await body(10*1024*1024)));
      const image=pathname.match(/^\/media\/([a-f\d]{64})$/);
      if(image&&method==='GET') {
        const m=store.media(image[1]);res.writeHead(200,{'Content-Type':m.mime,'Content-Length':m.bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return res.end(Buffer.from(m.bytes));
      }
      throw new StoreError(404,'接口不存在');
    }catch(e){if(e instanceof StoreError)return json(e.status,{error:e.message});console.error('[studio] Request failed:',e.code||e.name);json(500,{error:'保存服务暂时不可用，请保留当前页面并重试'});}
  };
}
