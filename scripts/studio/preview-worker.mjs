import {parentPort,workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const {renderArticle}=await import(pathToFileURL(workerData.renderer).href);
parentPort.on('message',async ({text,assets})=>{
  try {parentPort.postMessage({html:await renderArticle(text,assets)});}
  catch {parentPort.postMessage({error:true});}
});
