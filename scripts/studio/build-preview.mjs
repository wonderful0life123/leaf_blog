// Compile trusted rendering code and theme CSS once, at deployment, never per draft.
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const requireAstro=createRequire(import.meta.resolve('astro'));
const {build}=await import(requireAstro.resolve('vite'));
const {default:tailwindcss}=await import('@tailwindcss/vite');
const out=path.join(root,'.studio-preview');
const common={base:'./',root,configFile:false,publicDir:false,logLevel:'warn',resolve:{alias:{'@':path.join(root,'src')}},build:{outDir:out,emptyOutDir:false}};
fs.mkdirSync(out,{recursive:true});
await build({...common,build:{...common.build,ssr:path.join(root,'scripts/studio/publication-renderer.ts'),rollupOptions:{output:{entryFileNames:'renderer.mjs'}}}});
const {calloutTheme}=await import(new URL('../../.studio-preview/renderer.mjs',import.meta.url));
await build({...common,plugins:[tailwindcss()],resolve:{...common.resolve,alias:{...common.resolve.alias,'@preview-callouts-theme':`rehype-callouts/theme/${calloutTheme}`}},build:{...common.build,rollupOptions:{input:path.join(root,'scripts/studio/publication-preview-entry.ts'),output:{assetFileNames:asset=>asset.names?.some(n=>n.endsWith('.css'))?'assets/preview.css':'assets/[name][extname]',entryFileNames:'unused.js'}}}});
fs.writeFileSync(path.join(out,'version.json'),JSON.stringify({format:1}));
console.log('Private article renderer and shared theme assets compiled.');
