import {parentPort,workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const started=performance.now();
let phase='load';
const report=error=>parentPort.postMessage({phase,error:{code:error?.code}});
try {
  const {renderArticle}=await import(pathToFileURL(workerData.renderer).href);
  const loaded=performance.now();phase='warmup';
  // Exercise lazy code highlighting and math once, without reading any draft or
  // writing a preview artifact. No extra worker pool or periodic keep-alive work.
  await renderArticle('---\ntitle: Preview startup\npublished: 2000-01-01\ntags: []\n---\n\n```python\nprint("ready")\n```\n\n```bash\necho ready\n```\n\n```javascript\nconst ready = true;\n```\n\n$E=mc^2$\n',{});
  parentPort.on('message',async ({text,assets})=>{
    try {parentPort.postMessage({html:await renderArticle(text,assets)});}
    catch(error){phase='render';report(error);}
  });
  parentPort.postMessage({ready:true,loadMs:Math.round(loaded-started),warmupMs:Math.round(performance.now()-loaded)});
} catch(error){report(error);}
