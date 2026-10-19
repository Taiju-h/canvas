import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]}});
const {eraseCanvasInk,splitInkSelection,moveInkSelection}=await server.ssrLoadModule('/src/lib/canvas-ink.ts');
const {pointInPolygon,maskTransform}=await server.ssrLoadModule('/src/lib/ink-masks.ts');
const {builtInShapePresets,createShapePreset,instantiateShapePreset,readShapePresets}=await server.ssrLoadModule('/src/lib/shape-presets.ts');
after(()=>server.close());
const ink=(id,layerId='c')=>({id,layerId,points:[{x:0,y:50},{x:100,y:50}],width:8,color:'#123456',opacity:.8,brush:'pencil'});
const doc=()=>({version:1,grid:'none',snap:false,layers:[{id:'c',studioKind:'canvas',visible:true,locked:false},{id:'other',studioKind:'canvas',visible:true,locked:false},{id:'locked',studioKind:'canvas',visible:true,locked:true},{id:'layout',studioKind:'layout',visible:true,locked:false}],paintStrokes:[ink('a'),ink('b','other'),ink('locked','locked')],items:[{id:'rect',layerId:'layout',kind:'rect',x:10,y:10,w:50,h:60,width:3,color:'#123456'}],fixedNote:{html:'<p>原本</p>',visible:true,locked:false},attachments:[{id:'file',name:'原本.pdf'}],note:{category:'親 / 子',tags:['保持']}});
test('circle erasure retains geometry and source data, isolates the active layer and groups one gesture',()=>{
 const input=doc(),before=structuredClone(input);let next=eraseCanvasInk(input,[{x:50,y:40},{x:50,y:60}],10,'c','circle','gesture');
 assert.equal(next.paintStrokes.length,3);assert.deepEqual(next.paintStrokes[0].points,input.paintStrokes[0].points);assert.equal(next.paintStrokes[0].inkMasks.length,1);
 next=eraseCanvasInk(next,[{x:50,y:40},{x:50,y:60},{x:70,y:60}],10,'c','circle','gesture');assert.equal(next.paintStrokes[0].inkMasks.length,1);
 for(const key of ['items','fixedNote','attachments','note'])assert.deepEqual(next[key],input[key]);assert.deepEqual(next.paintStrokes.slice(1),input.paintStrokes.slice(1));assert.deepEqual(input,before);
 assert.equal(eraseCanvasInk(input,[{x:50,y:50}],10,'locked','circle','no'),input);assert.equal(eraseCanvasInk(input,[{x:50,y:50}],10,'layout','circle','no'),input);
 const whole=eraseCanvasInk(input,[{x:50,y:40},{x:50,y:60}],10,'c','stroke','whole');assert.deepEqual(whole.paintStrokes.map(s=>s.id),['b','locked']);
});
test('a lasso splits selected parts with complementary masks, and cuts follow moved ink through JSON reload',()=>{
 const input=doc(),polygon=[{x:30,y:20},{x:60,y:20},{x:60,y:80},{x:30,y:80}];let id=0;
 assert.ok(pointInPolygon({x:30,y:50},polygon));assert.ok(!pointInPolygon({x:70,y:50},polygon));
 const split=splitInkSelection(input,{points:polygon,layerId:'c'},()=>`selected-${id++}`);assert.equal(split.ids.length,1);assert.equal(input.paintStrokes.length,3);
 const outer=split.doc.paintStrokes.find(s=>s.id==='a'),inner=split.doc.paintStrokes.find(s=>s.id===split.ids[0]);assert.equal(outer.inkMasks[0].kind,'exclude');assert.equal(inner.inkMasks[0].kind,'include');
 const moved=moveInkSelection(split.doc,split.ids,25,10),copy=JSON.parse(JSON.stringify(moved));assert.deepEqual(copy,moved);assert.equal(copy.paintStrokes.find(s=>s.id===split.ids[0]).points[0].x,25);assert.deepEqual(copy.fixedNote,input.fixedNote);
 assert.equal(maskTransform(inner.inkMasks[0],{x:25,y:60,w:100,h:1}),'translate(25 60) scale(1 1) translate(0 -50)');
});
test('shape library and saved composite presets preserve editable geometry, style and independent IDs',()=>{
 assert.ok(builtInShapePresets.length>=20);let n=0;
 const items=instantiateShapePreset(builtInShapePresets.find(p=>p.id==='star'),{x:40,y:60,w:200,h:100},'layout',()=>`i${n++}`,'#884400',4);
 const saved=createShapePreset('mine','星のプリセット',items),loaded=readShapePresets(JSON.stringify([saved]));assert.equal(loaded.length,1);
 const a=instantiateShapePreset(loaded[0],{x:500,y:600,w:200,h:100},'new-layout',()=>`i${n++}`,'#000000',1);assert.equal(a[0].color,'#884400');assert.equal(a[0].kind,'polygon');assert.equal(a[0].layerId,'new-layout');assert.notEqual(a[0].id,items[0].id);
 assert.throws(()=>createShapePreset('bad','画像',[{...items[0],kind:'image'}]));assert.deepEqual(readShapePresets('broken'),[]);
});
