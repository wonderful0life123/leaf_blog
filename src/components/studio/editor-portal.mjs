// Svelte can detach the editor before action cleanup. Track our scroll lock
// independently of node.parentNode so every exit restores the previous state.
export function editorPortal(node, enabled) {
  const marker=document.createComment('writing-editor');
  node.before(marker);
  let previousOverflow,locked=false;
  function unlock(){
    if(!locked)return;
    document.body.style.overflow=previousOverflow;
    locked=false;
  }
  function update(active){
    if(active){
      if(!locked){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';locked=true;}
      if(node.parentNode!==document.body)document.body.appendChild(node);
    }else{
      if(node.parentNode===document.body)marker.after(node);
      unlock();
    }
  }
  update(enabled);
  return {update,destroy(){unlock();if(node.parentNode===document.body)node.remove();marker.remove();}};
}
