import path from 'node:path';
import {openStore} from './store.mjs';
import {createHandler} from './http.mjs';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const studioDataDir=()=>path.resolve(process.env.WONDER_STUDIO_DATA_DIR || path.join(repo,'../wonder-studio-data'));
export function studioLocalPlugin() {
  return {
    name:'wonder-local-drafts', apply:'serve',
    async configureServer(server) {
      if(process.env.WONDER_STUDIO_LOCAL!=='1')return;
      const store=openStore({dataDir:studioDataDir(),sourceRoots:{blog:path.join(repo,'src/content/posts'),notes:path.resolve(repo,'../obsidian_note')}});
      server.middlewares.use('/studio-api',createHandler(store));
      server.httpServer?.once('close',()=>store.close());
      console.log('[studio] Local drafts: '+store.filename);
    }
  };
}
