import {resizeTable} from './table-edit.mjs';
const copy=value=>({table:{rows:value.table.rows.map(row=>[...row]),align:[...value.table.align]},row:value.row,column:value.column});

// History belongs to one open table dialog. Saving remains one document edit.
export function createTableHistory(initial,{now=()=>Date.now(),limit=100}={}){
  let current=copy({table:initial,row:0,column:0}),past=[],future=[],group=null;
  function commit(next,key=null,composition=false){
    if(JSON.stringify(next.table)===JSON.stringify(current.table))return;
    const time=now(),merge=key&&group?.key===key&&(composition||time-group.time<=800);
    if(!merge){past.push(copy(current));if(past.length>limit)past.shift();}
    current=copy(next);future=[];group=key?{key,time}:null;
  }
  return {
    get value(){return copy(current);},
    get canUndo(){return past.length>0;},
    get canRedo(){return future.length>0;},
    breakGroup(){group=null;},
    focus(row,column){if(row!==current.row||column!==current.column)group=null;current={...current,row,column};},
    editCell(text,{inputType='insertText',composing=false}={}){
      const next=copy(current);next.table.rows[next.row][next.column]=text;
      const kind=composing?'composition':['insertText','deleteContentBackward','deleteContentForward'].includes(inputType)?inputType:null;
      commit(next,kind?`${next.row}:${next.column}:${kind}`:null,composing);
    },
    align(value){const next=copy(current);next.table.align[next.column]=value;commit(next);},
    resize(action){
      const next=copy(current);next.table=resizeTable(next.table,action,next.row,next.column);
      if(action==='add-row')next.row++;
      if(action==='add-column')next.column++;
      next.row=Math.min(next.row,next.table.rows.length-1);next.column=Math.min(next.column,next.table.align.length-1);
      commit(next);
    },
    undo(){group=null;if(!past.length)return false;future.push(copy(current));current=past.pop();return true;},
    redo(){group=null;if(!future.length)return false;past.push(copy(current));current=future.pop();return true;}
  };
}
