import test from 'node:test';
import assert from 'node:assert/strict';
import {editorPortal} from '../../src/components/studio/editor-portal.mjs';

// Model the same lifecycle as Svelte: the element can be detached before the
// action's destroy callback runs. Only the DOM operations used by the action
// are needed here; the full editor -> list path is also checked in the browser.
function fixture(overflow='') {
  const body={style:{overflow},appendChild(node){node.parentNode=this;}};
  const parent={};
  const marker={parentNode:parent,after(node){node.parentNode=this.parentNode;},remove(){this.parentNode=null;}};
  const node={parentNode:parent,before(){},remove(){this.parentNode=null;}};
  globalThis.document={body,createComment:()=>marker};
  return {body,node,parent};
}

test('closing an already-detached focused editor releases the page scroll lock',()=>{
  const {body,node}=fixture();
  const action=editorPortal(node,true);
  assert.equal(body.style.overflow,'hidden');
  node.remove(); // Svelte removes the section before action cleanup.
  action.destroy();
  assert.equal(body.style.overflow,'');
});

test('focus toggles and repeated cleanup preserve the original overflow',()=>{
  const {body,node,parent}=fixture('auto');
  const action=editorPortal(node,true);
  action.update(true);
  action.update(false);
  assert.equal(body.style.overflow,'auto');
  assert.equal(node.parentNode,parent);
  action.update(true);
  node.remove();
  action.destroy();action.destroy();
  assert.equal(body.style.overflow,'auto');
});

test('closing an unfocused editor does not touch page overflow',()=>{
  const {body,node}=fixture('scroll');
  const action=editorPortal(node,false);
  node.remove();action.destroy();
  assert.equal(body.style.overflow,'scroll');
});
