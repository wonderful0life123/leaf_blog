import {openStore} from './store.mjs';
import {studioDataDir} from './plugin.mjs';
const store=openStore({dataDir:studioDataDir()});
try{console.log(store.backup());}finally{store.close();}
