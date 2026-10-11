import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore,StoreError} from './store.mjs';
import {createHandler} from './http.mjs';
import {openAuth} from './auth.mjs';
import {createCatalog} from './catalog.mjs';
import {serverConfig} from './config.mjs';
const MIME={'.js':'text/javascript','.css':'text/css','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.svg':'image/svg+xml'};
export function createStudioServer(config,authOptions={}) {
  const shell=path.join(config.webDir,'studio/index.html');
  if(!fs.existsSync(shell))throw new Error('缺少写作前端，请先执行 npm run studio:build');
  const store=openStore(config),auth=openAuth(config,authOptions),catalog=createCatalog(config.sourceRoots);
  const api=createHandler(store,{authorize:auth.requireUser,catalog});
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    try {
      if(req.headers.host!==new URL(config.origin).host)throw new StoreError(403,'站点地址不匹配');
      const url=new URL(req.url,config.origin),route=url.pathname;
      if(route==='/studio-auth/login/'&&req.method==='GET')return auth.start(req,res);
      if(route==='/studio-auth/callback/'&&req.method==='GET')return await auth.callback(req,res,url);
      if(route==='/studio-api/session/'&&req.method==='GET')return json(res,200,{user:auth.requireUser(req)});
      if(route==='/studio-api/logout/'&&req.method==='POST'){auth.logout(req,res);return json(res,200,{ok:true});}
      if(route.startsWith('/studio-api/')){req.url=req.url.slice('/studio-api'.length);return await api(req,res);}
      const image=route.match(/^\/studio\/assets\/([a-f\d]{24})\/$/);
      if(image&&req.method==='GET'){auth.requireUser(req);const img=catalog.image(image[1]);res.writeHead(200,{'Content-Type':img.mime});return res.end(img.bytes);}
      if(!['GET','HEAD'].includes(req.method))throw new StoreError(405,'不支持的操作');
      if(route==='/studio'){res.writeHead(302,{Location:'/studio/'});return res.end();}
      if(route==='/studio/') {
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        // This is a credential-free shell. Catalog, drafts and media are fetched only after authentication.
        return res.end(req.method==='HEAD'?undefined:fs.readFileSync(shell));
      }
      if(route.startsWith('/studio-static/')) {
        let file;try{file=fs.realpathSync(path.join(config.webDir,decodeURIComponent(route)));}catch{throw new StoreError(404,'资源不存在');}
        const root=fs.realpathSync(path.join(config.webDir,'studio-static'));
        const type=MIME[path.extname(file)];if(!file.startsWith(root+path.sep)||!type||!fs.statSync(file).isFile())throw new StoreError(404,'资源不存在');
        res.writeHead(200,{'Content-Type':type});if(req.method==='HEAD')return res.end();
        const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());return stream.pipe(res);
      }
      throw new StoreError(404,'页面不存在');
    }catch(error){if(error instanceof StoreError){if(req.url.startsWith('/studio-auth/')){const kind=error.status===403?'denied':error.status===502?'unavailable':error.status===429?'busy':'expired';res.writeHead(302,{Location:'/studio/?loginError='+kind});return res.end();}return json(res,error.status,{error:error.message});}console.error('[studio] Request failed:',error.code||error.name);json(res,500,{error:'服务暂时不可用，请稍后重试'});}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  server.on('close',()=>{store.close();auth.close();});
  return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  try {
    const config=serverConfig(),server=createStudioServer(config);
    server.listen(config.port,'127.0.0.1',()=>console.log(`[studio] Ready on 127.0.0.1:${config.port}`));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeIdleConnections();const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();});
  }catch(error){console.error('[studio] Startup failed:',error.message);process.exitCode=1;}
}
