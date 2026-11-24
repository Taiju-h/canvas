import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {after} from 'node:test';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
const {canvasLayerClipboard,moveCanvasLayer}=await server.ssrLoadModule('/src/lib/canvas-layer.ts');after(()=>server.close());
function document(){return{version:1,grid:'none',snap:false,fixedNote:{html:'<p>元の本文</p>',visible:true,locked:false},layers:[{id:'ink',name:'貼り付け',visible:true,locked:false,opacity:.5,rasterImageId:'original',rasterBounds:{x:10,y:20,w:100,h:60}},{id:'layout',name:'図形',studioKind:'layout',visible:true,locked:false}],items:[{id:'photo',kind:'image',layerId:'ink',imageId:'asset',x:30,y:50,w:40,h:50,width:1,color:'#000',opacity:1,clip:{x:31,y:52,w:30,h:40}},{id:'shape',kind:'rect',layerId:'layout',x:400,y:500,w:50,h:40,width:2,color:'#345',opacity:1}],paintStrokes:[{id:'stroke',layerId:'ink',points:[{x:10,y:20,p:.3},{x:40,y:60,p:.8}],color:'#123',width:4,opacity:.7}],blocks:[],attachments:[]};}
test('whole-layer move includes pixels, objects, clips and pressure strokes while preserving Note and Layout',()=>{
  const original=document(),snapshot=structuredClone(original),moved=moveCanvasLayer(original,'ink',25,-10);
  assert.deepEqual(moved.layers[0].rasterBounds,{x:35,y:10,w:100,h:60});assert.equal(moved.items[0].x,55);assert.equal(moved.items[0].clip.y,42);assert.equal(moved.paintStrokes[0].points[1].p,.8);assert.equal(moved.paintStrokes[0].points[1].y,50);
  assert.deepEqual(moved.items[1],original.items[1]);assert.deepEqual(moved.fixedNote,original.fixedNote);assert.deepEqual(original,snapshot);
});
test('whole Canvas copy includes its frozen original image and layer opacity; locks and other families are protected',()=>{
  const d=document(),value=canvasLayerClipboard(d,'source','ink');assert.equal(value.wholeLayer,true);assert.equal(value.layerOpacity,.5);assert.ok(value.items.some(i=>i.imageId==='original'));assert.equal(value.paintStrokes.length,1);assert.ok(!value.items.some(i=>i.id==='shape'));
  d.layers[0].locked=true;assert.equal(canvasLayerClipboard(d,'source','ink'),null);assert.equal(moveCanvasLayer(d,'ink',20,20),d);assert.equal(moveCanvasLayer(d,'layout',20,20),d);
});
