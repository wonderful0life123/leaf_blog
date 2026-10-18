import fs from 'node:fs';
const result={};
for(const route of ['/', '/posts/ai-infra/cuda/global-indexing/','/archive/']){
 const samples=[];
 for(let i=0;i<23;i++){
  const start=performance.now();
  const response=await fetch((process.argv[3]||'http://127.0.0.1:4343')+route);
  const headers=performance.now();const text=await response.text();
  samples.push({ttfb:headers-start,total:performance.now()-start,bytes:Buffer.byteLength(text),status:response.status});
 }
 const med=key=>samples.slice(3).map(s=>s[key]).sort((a,b)=>a-b)[10];
 result[route]={medianTtfb:med('ttfb'),medianTotal:med('total'),samples};
}
fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
console.log(Object.fromEntries(Object.entries(result).map(([route,r])=>[route,{ttfb:r.medianTtfb,total:r.medianTotal,bytes:r.samples[3].bytes}])));
