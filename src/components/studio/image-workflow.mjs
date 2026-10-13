import {StateEffect, StateField, MapMode} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';
import {imageEdit} from './editor-tools.mjs';

export const trackImage = StateEffect.define();
export const forgetImage = StateEffect.define();
export const imageAnchors = StateField.define({
  create:()=>new Map(),
  update(anchors,tr){
    const next=new Map();
    const completed=tr.isUserEvent('input.upload')?tr.effects.find(e=>e.is(forgetImage)):null;
    const uploaded=completed?anchors.get(completed.value):null;
    for(const [id,target] of anchors){
      let invalid=target.invalid;
      if(target.from!==target.to)tr.changes.iterChangedRanges((from,to)=>{
        if(from<target.to&&to>target.from)invalid=true;
      });
      const assoc=uploaded&&!(target.from===uploaded.from&&target.order<uploaded.order)?1:-1;
      const from=tr.changes.mapPos(target.from,target.from===target.to?assoc:1,MapMode.TrackDel);
      const to=tr.changes.mapPos(target.to,target.from===target.to?assoc:-1,MapMode.TrackDel);
      next.set(id,{...target,from:from??0,to:to??0,invalid:invalid||from===null||to===null});
    }
    for(const effect of tr.effects){
      if(effect.is(trackImage))next.set(effect.value.id,effect.value);
      if(effect.is(forgetImage))next.delete(effect.value);
    }
    return next;
  }
});
export function imageMarkdown(alt,url,title=''){
  const text=String(alt).replace(/\\/g,'\\\\').replace(/[\[\]]/g,'\\$&').replace(/[\r\n]+/g,' ');
  const src=String(url).replace(/[\s<>]/g,c=>encodeURIComponent(c)).replace(/[()\\]/g,'\\$&');
  const label=title?' "'+String(title).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\r\n]+/g,' ')+'"':'';
  return `![${text}](${src}${label})`;
}
export function imageTarget(state,id){
  const target=state.field(imageAnchors).get(id);
  if(!target||target.invalid||(target.source!==undefined&&state.sliceDoc(target.from,target.to)!==target.source))throw new Error('原位置或图片已被修改，请重新选择后操作。');
  return target;
}
export function replaceImage(state,id,text){
  const target=imageTarget(state,id);
  return {changes:{from:target.from,to:target.to,insert:text},effects:forgetImage.of(id),annotations:isolateHistory.of('full'),userEvent:'input.upload'};
}
// Files and upload states stay in this editor session, never in Markdown or SQLite.
export function imageUploads({getState,dispatch,upload,onUpdate=()=>{}}){
  let jobs=[],running=false,closed=false,serial=0;
  const emit=()=>{if(!closed)onUpdate(jobs.map(({file,...job})=>job));};
  async function run(){
    if(running||closed)return;
    running=true;
    try{
      for(;;){
        const job=jobs.find(j=>j.state==='queued');if(!job||closed)break;
        job.state='uploading';emit();
        try{
          imageTarget(getState(),job.id);
          if(job.file.size>10*1024*1024)throw new Error('每张图片最多 10 MB');
          if(!job.url)job.url=await upload(job.file);
          if(closed)return;
          if(!/^\/studio-api\/media\/[a-f\d]{64}\/?$/.test(job.url))throw new Error('图片地址无效，请重试。');
          const state=getState(),target=imageTarget(state,job.id);
          const text=imageMarkdown(job.alt,job.url);
          if(target.source!==undefined)dispatch(replaceImage(state,job.id,text));
          else {
            const edit=imageEdit({doc:state.doc,sliceDoc:(...args)=>state.sliceDoc(...args),selection:{main:target}},text);
            // Map the live selection through insertion; never pull the user back.
            dispatch({changes:edit.changes,effects:forgetImage.of(job.id),annotations:isolateHistory.of('full'),userEvent:'input.upload'});
          }
          job.state='done';job.error='';job.file=null;
        }catch(error){if(closed)return;job.state='failed';job.error=error.message||'上传失败，请重试。';}
        emit();
      }
    }finally{running=false;}
  }
  return {
    enqueue(files,target){
      if(closed)return;
      for(const file of files){
        const id=`image-upload-${++serial}`;
        dispatch({effects:trackImage.of({...target,id,order:serial})});
        jobs.push({id,file,name:file.name,alt:target.alt??file.name,state:'queued',error:''});
      }
      emit();void run();
    },
    retry(id){const job=jobs.find(j=>j.id===id);if(job?.state!=='failed'||closed)return;job.state='queued';job.error='';emit();void run();},
    dismiss(id){const job=jobs.find(j=>j.id===id);if(!job||!['done','failed'].includes(job.state))return;dispatch({effects:forgetImage.of(id)});jobs=jobs.filter(j=>j.id!==id);emit();},
    close(){closed=true;jobs=[];}
  };
}
