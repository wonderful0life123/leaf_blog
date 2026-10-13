import {marked} from 'marked';
import {StateEffect,StateField,MapMode} from '@codemirror/state';
import {isolateHistory} from '@codemirror/commands';
import {imageEdit} from './editor-tools.mjs';
export function readTable(source){
  const token=marked.lexer(source).find(t=>t.type==='table');
  if(!token)throw new Error('暂时无法编辑这张表格，请使用源码模式。');
  return {rows:[token.header,...token.rows].map(row=>row.map(cell=>cell.text)),align:[...token.align]};
}
export const emptyTable=()=>({rows:[['列一','列二'],['','']],align:[null,null]});
export function writeTable(table){
  const width=table.align.length;
  if(!width||!table.rows.length||table.rows.some(row=>row.length!==width))throw new Error('表格至少需要一行表头和一列。');
  const row=cells=>'| '+cells.map(text=>String(text).replace(/[\r\n]+/g,' ').replace(/\|/g,'\\|').trim()).join(' | ')+' |';
  const divider=row(table.align.map(a=>({left:':---',center:':---:',right:'---:'})[a]||'---'));
  return [row(table.rows[0]),divider,...table.rows.slice(1).map(row)].join('\n');
}
export function resizeTable(table,action,row,column){
  const next={rows:table.rows.map(cells=>[...cells]),align:[...table.align]};
  if(action==='add-row')next.rows.splice(row+1,0,Array(next.align.length).fill(''));
  if(action==='delete-row'&&row>0)next.rows.splice(row,1);
  if(action==='add-column'){next.align.splice(column+1,0,null);for(const cells of next.rows)cells.splice(column+1,0,'');}
  if(action==='delete-column'&&next.align.length>1){next.align.splice(column,1);for(const cells of next.rows)cells.splice(column,1);}
  return next;
}
export const beginTable=StateEffect.define(),endTable=StateEffect.define();
export const tableTarget=StateField.define({
  create:()=>null,
  update(target,tr){
    if(target){
      let invalid=target.invalid;
      tr.changes.iterChangedRanges((from,to)=>{if(from<target.to&&to>target.from)invalid=true;});
      const from=tr.changes.mapPos(target.from,target.from===target.to?-1:1,MapMode.TrackDel);
      const to=tr.changes.mapPos(target.to,-1,MapMode.TrackDel);
      target={...target,from:from??0,to:to??0,invalid:invalid||from===null||to===null};
    }
    for(const effect of tr.effects){if(effect.is(beginTable))target=effect.value;if(effect.is(endTable))target=null;}
    return target;
  }
});
export function applyTable(state,table){
  const target=state.field(tableTarget);
  if(!target||target.invalid||state.sliceDoc(target.from,target.to)!==target.source)throw new Error('原表格或插入位置已变化。请取消后重新打开，避免覆盖新内容。');
  const text=writeTable(table);
  const changes=target.insert?imageEdit({doc:state.doc,sliceDoc:(...args)=>state.sliceDoc(...args),selection:{main:target}},text).changes:{from:target.from,to:target.to,insert:text};
  return {changes,effects:endTable.of(true),annotations:isolateHistory.of('full'),userEvent:'input'};
}
