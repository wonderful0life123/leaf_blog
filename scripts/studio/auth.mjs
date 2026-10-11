import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {StoreError} from './store.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const TTL=7*24*60*60;
const OAUTH_ERRORS=new Set(['incorrect_client_credentials','redirect_uri_mismatch','bad_verification_code','unverified_user_email','application_suspended','expired_token','access_denied']);
const NETWORK_CODES=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT']);
export function openAuth(config,{fetcher=fetch,now=Date.now,reportFailure=event=>console.error('[studio] OAuth upstream failure',JSON.stringify(event))}={}) {
  fs.mkdirSync(config.dataDir,{recursive:true,mode:0o700});
  const file=path.join(config.dataDir,'auth.sqlite');
  if(!fs.existsSync(file))fs.closeSync(fs.openSync(file,'wx',0o600));
  const db=new DatabaseSync(file);fs.chmodSync(file,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,login TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states(hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const prefix=config.secure?'__Host-wonder_':'wonder_dev_';
  const cookieName=prefix+'session',flowName=prefix+'oauth';
  const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.secure?'; Secure':''}`;
  function readCookie(req,name) {
    const values=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
    return values.length===1?values[0].slice(name.length+1):'';
  }
  function cleanup(){db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());db.prepare('DELETE FROM oauth_states WHERE expires<=?').run(now());}
  function checkRequest(req,mutation=false) {
    if(req.headers.host!==new URL(config.origin).host)throw new StoreError(403,'站点地址不匹配');
    if((req.headers.origin&&req.headers.origin!==config.origin)||req.headers['sec-fetch-site']==='cross-site')throw new StoreError(403,'不允许跨站访问草稿');
    if(mutation&&req.headers.origin!==config.origin)throw new StoreError(403,'保存请求缺少同源校验');
  }
  function user(req) {
    const token=readCookie(req,cookieName);
    if(!/^[\w-]{43}$/.test(token))return null;
    const row=db.prepare('SELECT user_id,login FROM sessions WHERE hash=? AND expires>?').get(digest(token),now());
    return row&&row.user_id===config.ownerId?{id:row.user_id,login:row.login}:null;
  }
  function requireUser(req){checkRequest(req,!['GET','HEAD'].includes(req.method));const value=user(req);if(!value)throw new StoreError(401,'登录已失效，请重新登录后重试保存；当前文字仍保留在页面中。');return value;}
  const redirect=(res,url,cookies)=>{res.writeHead(302,{'Location':url,'Set-Cookie':cookies,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();};
  let starts=[];
  function start(req,res) {
    checkRequest(req);cleanup();starts=starts.filter(t=>t>now()-60000);
    if(starts.length>=20||db.prepare('SELECT COUNT(*) n FROM oauth_states').get().n>=64)throw new StoreError(429,'登录尝试较多，请稍后再试');
    starts.push(now());
    const state=random(),binding=random(),verifier=random();
    db.prepare('INSERT INTO oauth_states VALUES(?,?,?,?)').run(digest(state),digest(binding),verifier,now()+600000);
    const url=new URL('https://github.com/login/oauth/authorize');
    for(const [key,value] of Object.entries({client_id:config.clientId,redirect_uri:config.origin+'/studio-auth/callback/',state,scope:'',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',allow_signup:'false'}))url.searchParams.set(key,value);
    redirect(res,url.href,[cookie(flowName,binding,600)]);
  }
  async function callback(req,res,url) {
    // GitHub's cross-site callback is allowed only after validating single-use state + browser binding.
    if(req.headers.host!==new URL(config.origin).host)throw new StoreError(403,'站点地址不匹配');
    const state=url.searchParams.get('state'),code=url.searchParams.get('code'),binding=readCookie(req,flowName);
    if(url.searchParams.getAll('state').length!==1||!state||!binding||state.length>200||binding.length>200)throw new StoreError(400,'登录验证失效，请重新开始');
    const pending=db.prepare('DELETE FROM oauth_states WHERE hash=? AND browser_hash=? AND expires>? RETURNING verifier').get(digest(state),digest(binding),now());
    if(!pending)throw new StoreError(400,'登录验证失效，请重新开始');
    res.setHeader('Set-Cookie',cookie(flowName,'',0));
    if(url.searchParams.has('error')||url.searchParams.getAll('code').length!==1||!code||code.length>512)throw new StoreError(400,'GitHub 授权未完成，请重新登录');
    let profile,stage='token_exchange',reason='network_error',status=null;
    try {
      const response=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:config.origin+'/studio-auth/callback/',code_verifier:pending.verifier}),signal:AbortSignal.timeout(10000),redirect:'error'});
      status=Number.isInteger(response.status)?response.status:null;reason='http_error';
      if(!response.ok)throw Error('OAuth exchange failed');
      reason='invalid_json';const result=await response.json();
      reason=OAUTH_ERRORS.has(result?.error)?result.error:'missing_access_token';
      if(typeof result?.access_token!=='string'||!result.access_token)throw Error('OAuth token missing');
      stage='user_profile';reason='network_error';status=null;
      const account=await fetcher('https://api.github.com/user',{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+result.access_token,'User-Agent':'wonder-writing-studio'},signal:AbortSignal.timeout(10000),redirect:'error'});
      status=Number.isInteger(account.status)?account.status:null;reason='http_error';
      if(!account.ok)throw Error('GitHub identity failed');
      reason='invalid_json';profile=await account.json();
      reason='invalid_profile';
      if(!Number.isSafeInteger(profile?.id)||profile.id<=0||typeof profile.login!=='string'||!profile.login)throw Error('GitHub profile invalid');
      // The GitHub token is intentionally not saved: this stage only verifies identity.
    }catch(error){
      // Only bounded labels/statuses: never log error messages, URLs, response bodies or credentials.
      const code=error?.cause?.code||error?.code;
      const networkCode=NETWORK_CODES.has(code)?code:error?.name==='TimeoutError'?'TIMEOUT':undefined;
      try{reportFailure({stage,reason,status,...(networkCode?{networkCode}:{})});}catch{}
      throw new StoreError(502,'GitHub 登录暂时不可用，请重新尝试');
    }
    if(String(profile.id)!==config.ownerId||typeof profile.login!=='string')throw new StoreError(403,'这个 GitHub 账号没有写作权限');
    const old=readCookie(req,cookieName);if(old)db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(old));
    cleanup();
    db.exec('DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions ORDER BY expires DESC LIMIT -1 OFFSET 19)');
    const token=random();db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),String(profile.id),profile.login,now()+TTL*1000);
    redirect(res,'/studio/',[cookie(flowName,'',0),cookie(cookieName,token,TTL)]);
  }
  function logout(req,res){requireUser(req);db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(readCookie(req,cookieName)));res.setHeader('Set-Cookie',cookie(cookieName,'',0));}
  return {checkRequest,requireUser,user,start,callback,logout,close(){db.close();}};
}
