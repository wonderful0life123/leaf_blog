import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { APIRoute } from 'astro';
const mime: Record<string,string> = { '.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.avif':'image/avif','.gif':'image/gif' };
export function getStaticPaths() {
  // No vault files or image routes are emitted by a production build.
  if (!import.meta.env.DEV || process.env.WONDER_STUDIO_LOCAL !== '1') return [];
  const walk = (root: string): string[] => !fs.existsSync(root) ? [] : fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.name.startsWith('.')?[]:e.isDirectory()?walk(path.join(root,e.name)):e.isFile()&&mime[path.extname(e.name).toLowerCase()]?[path.join(root,e.name)]:[]);
  return Object.entries({notes:path.resolve('../obsidian_note'),blog:path.resolve('src/content/posts')}).flatMap(([kind,root])=>walk(root).map(file=>({params:{asset:createHash('sha256').update(kind+'/'+path.relative(root,file)).digest('hex').slice(0,24)},props:{file}})));
}
export const GET: APIRoute = ({ props }) => {
  if (!import.meta.env.DEV || process.env.WONDER_STUDIO_LOCAL !== '1') return new Response(null,{status:404});
  const file = props.file as string;
  return new Response(new Uint8Array(fs.readFileSync(file)),{headers:{'Content-Type':mime[path.extname(file).toLowerCase()],'X-Content-Type-Options':'nosniff'}});
};
