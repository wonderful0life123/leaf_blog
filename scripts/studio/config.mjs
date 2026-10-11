import path from 'node:path';
export function serverConfig(env=process.env) {
  const required=name=>{const value=env[name]?.trim();if(!value||value.startsWith('REPLACE_'))throw new Error(`缺少配置 ${name}`);return value;};
  const origin=new URL(required('WONDER_STUDIO_ORIGIN'));
  if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new Error('WONDER_STUDIO_ORIGIN 必须是站点源地址');
  const devHttp=env.WONDER_STUDIO_DEV_HTTP==='1' && origin.protocol==='http:' && ['127.0.0.1','localhost'].includes(origin.hostname);
  if(origin.protocol!=='https:'&&!devHttp)throw new Error('服务器写作空间需要 HTTPS');
  const ownerId=required('WONDER_GITHUB_OWNER_ID');
  if(!/^[1-9]\d*$/.test(ownerId))throw new Error('GitHub 账号编号必须为数字');
  const port=Number(env.WONDER_STUDIO_PORT||4312);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('无效的服务端口');
  const dataDir=path.resolve(required('WONDER_STUDIO_DATA_DIR'));
  const webDir=path.resolve(env.WONDER_STUDIO_WEB_DIR||'studio-dist');
  const sourceRoots={blog:path.resolve(required('WONDER_STUDIO_POSTS_DIR')),notes:path.resolve(required('WONDER_STUDIO_NOTES_DIR'))};
  const within=(a,b)=>a===b||a.startsWith(b+path.sep);
  for(const publicRoot of [webDir,path.resolve('dist'),path.resolve('public'),path.resolve('src'),'/var/www',...Object.values(sourceRoots)]) {
    if(within(dataDir,publicRoot)||within(publicRoot,dataDir))throw new Error('草稿目录必须与源码、笔记和公开文件目录分开');
  }
  return {origin:origin.origin,secure:!devHttp,ownerId,port,dataDir,webDir,sourceRoots,
    clientId:required('WONDER_GITHUB_CLIENT_ID'),clientSecret:required('WONDER_GITHUB_CLIENT_SECRET')};
}
