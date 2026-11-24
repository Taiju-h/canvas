import type {NoteDoc} from './notes';
import {moveInkSelection} from './canvas-ink';
import {selectionClipboard} from './selection-clipboard';

/** A whole Canvas layer includes frozen images as well as editable strokes. */
export function canvasLayerClipboard(doc:NoteDoc,sourceId:string,layerId:string){
  const layer=doc.layers.find(l=>l.id===layerId);
  if(!layer||!layer.visible||layer.locked||('studioKind' in layer&&layer.studioKind&&layer.studioKind!=='canvas'))return null;
  let source=doc;const ids=[...doc.items,...(doc.paintStrokes||[]),...(doc.blocks||[])].filter(i=>i.layerId===layerId).map(i=>i.id);
  if(layer.rasterImageId&&layer.rasterBounds){const id='raster-'+layer.id;ids.push(id);source={...doc,items:[...doc.items,{id,kind:'image',layerId,...layer.rasterBounds,imageId:layer.rasterImageId,color:'#000000',width:1,opacity:1,keepLayer:true}]};}
  if(!ids.length)return null;
  return{...selectionClipboard(source,sourceId,'canvas',ids,[]),wholeLayer:true,layerOpacity:layer.opacity??1};
}
export function moveCanvasLayer(doc:NoteDoc,layerId:string,dx:number,dy:number):NoteDoc{
  const layer=doc.layers.find(l=>l.id===layerId);
  if(!layer||!layer.visible||layer.locked||('studioKind' in layer&&layer.studioKind&&layer.studioKind!=='canvas'))return doc;
  const ids=doc.items.filter(i=>i.layerId===layerId).map(i=>i.id).concat((doc.paintStrokes||[]).filter(s=>s.layerId===layerId).map(s=>s.id));
  const next=moveInkSelection(doc,ids,dx,dy);
  return{...next,items:next.items.map(i=>i.layerId===layerId&&i.clip?{...i,clip:{...i.clip,x:i.clip.x+dx,y:i.clip.y+dy}}:i),
    layers:next.layers.map(l=>l.id===layerId&&l.rasterBounds?{...l,rasterBounds:{...l.rasterBounds,x:l.rasterBounds.x+dx,y:l.rasterBounds.y+dy}}:l),
    blocks:next.blocks?.map(b=>b.layerId===layerId?{...b,x:b.x+dx,y:b.y+dy}:b)};
}
