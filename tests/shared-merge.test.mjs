import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSharedNotes,mergeSharedTitle} from '../src/lib/shared-merge.ts';

const item=(id,x)=>({id,kind:'rect',layerId:'layer',x,y:0,w:20,h:20,color:'#000000',width:2,opacity:1});
const doc=(items)=>({version:1,grid:'none',snap:false,layers:[{id:'layer',name:'Drawings',visible:true,locked:false}],items,blocks:[]});
test('separate shape edits merge without erasing either contributor',()=>{
 const base=doc([item('a',0),item('b',0)]);
 const local=doc([item('a',40),item('b',0)]);
 const remote=doc([item('a',0),item('b',90)]);
 const merged=mergeSharedNotes(base,local,remote);
 assert.ok(merged);
 assert.deepEqual(merged.items.map(x=>[x.id,x.x]),[['a',40],['b',90]]);
});
test('simultaneous changes to one object require explicit conflict resolution',()=>{
 const base=doc([item('a',0)]);
 assert.equal(mergeSharedNotes(base,doc([item('a',25)]),doc([item('a',60)])),null);
});
test('object deletion and unrelated updates merge',()=>{
 const base=doc([item('a',0),item('b',0)]);
 const merged=mergeSharedNotes(base,doc([item('b',0)]),doc([item('a',0),item('b',20)]));
 assert.deepEqual(merged.items.map(x=>x.id),['b']);
 assert.equal(merged.items[0].x,20);
});
test('concurrent incompatible title updates require review',()=>{
 assert.equal(mergeSharedTitle('Board','First','Second'),null);
 assert.equal(mergeSharedTitle('Board','First','Board'),'First');
});
