import {Worker} from 'node:worker_threads';
import {StoreError} from './store.mjs';

const messages={
  load:'预览渲染组件加载失败，请联系部署方检查构件与依赖。',
  warmup:'预览渲染器初始化失败，请联系部署方检查服务日志。',
  render:'文章渲染失败，请检查文章内容；具体原因已记录在服务日志。',
  timeout:'预览处理超时，请稍后重试；若反复出现，请检查服务器负载。',
  exit:'预览渲染进程已退出，请重试；若反复出现，请检查服务日志。',
  closed:'预览服务正在关闭，请稍后重试。',
};
function failure(phase,detail={}){
  // Never log Markdown, arbitrary exception messages or paths from user content.
  const code=/^[A-Z][A-Z0-9_]{0,63}$/.test(detail.code||'')?detail.code:undefined;
  console.warn('[studio-preview]',JSON.stringify({phase,code,exitCode:detail.exitCode}));
  return new StoreError(503,messages[phase]||messages.render);
}

// One worker per publisher. Initialization is shared with requests arriving during
// warmup, and requests are serialized so HTML cannot be delivered to another job.
export function previewClient(renderer){
  let state,closed=false,tail=Promise.resolve();
  function start(){
    if(closed)throw failure('closed');
    if(state)return state;
    const worker=new Worker(new URL('./preview-worker.mjs',import.meta.url),{workerData:{renderer}});
    const current={worker,ready:false,pending:null};state=current;
    current.promise=new Promise((resolve,reject)=>{current.resolve=resolve;current.reject=reject;});
    current.promise.catch(()=>{});
    function stop(error){
      if(state!==current)return;
      state=null;clearTimeout(current.timer);
      current.reject(error);current.pending?.reject(error);current.pending=null;
      void worker.terminate();
    }
    current.stop=stop;
    current.timer=setTimeout(()=>stop(failure('timeout')),30_000);
    worker.on('message',result=>{
      if(state!==current)return;
      if(result.error){stop(failure(result.phase,result.error));return;}
      if(result.ready){
        clearTimeout(current.timer);current.ready=true;worker.unref();current.resolve(result);return;
      }
      const pending=current.pending;
      if(pending){clearTimeout(current.timer);current.pending=null;worker.unref();pending.resolve(result.html);}
    });
    worker.on('error',error=>stop(failure(current.ready?'exit':'load',error)));
    worker.on('exit',exitCode=>{if(state===current)stop(failure('exit',{exitCode}));});
    return current;
  }
  return {
    warmup(){try{return start().promise;}catch(error){return Promise.reject(error);}},
    render(text,assets){
      const request=tail.then(async()=>{
        const started=performance.now(),current=start();
        await current.promise;
        if(state!==current||closed)throw failure(closed?'closed':'exit');
        return new Promise((resolve,reject)=>{
          current.pending={resolve,reject};current.worker.ref();
          // Keep the existing 30s request budget, including any unfinished startup.
          current.timer=setTimeout(()=>current.stop(failure('timeout')),Math.max(1,30_000-(performance.now()-started)));
          current.worker.postMessage({text,assets});
        });
      });
      tail=request.catch(()=>{});
      return request;
    },
    async close(){closed=true;if(state){const current=state;current.stop(new StoreError(503,messages.closed));await current.worker.terminate();}},
  };
}
