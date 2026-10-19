import {inverseTransformPoint,type Item,type Point} from './canvas';
import type {NoteDoc} from './notes';
import {itemPoints,touches,unrotate} from './ink-eraser';
import {inkFrame,pointInPolygon,type InkMask,type InkFrame} from './ink-masks';

type Stroke=NonNullable<NoteDoc['paintStrokes']>[number];
type Ink=Stroke|Item;
export type EraserMode='circle'|'stroke';
export type InkSelection={points:Point[];layerId:string;ids?:string[]};
const isItem=(ink:Ink):ink is Item=>'kind' in ink;
const pointsOf=(ink:Ink)=>isItem(ink)?itemPoints(ink):ink.points;
const frameOf=(ink:Ink):InkFrame=>isItem(ink)&&!ink.points?.length?{x:Math.min(ink.x,ink.x+ink.w),y:Math.min(ink.y,ink.y+ink.h),w:Math.max(1,Math.abs(ink.w)),h:Math.max(1,Math.abs(ink.h))}:inkFrame(pointsOf(ink));
const localPoint=(ink:Ink,p:Point)=>isItem(ink)?inverseTransformPoint(ink,p):unrotate(ink,p);
const closed=(ink:Ink)=>isItem(ink)&&['rect','ellipse','polygon'].includes(ink.kind);
const supported=(ink:Ink)=>!isItem(ink)||['path','line','rect','ellipse','polygon'].includes(ink.kind);
const writable=(doc:NoteDoc,id:string)=>doc.layers.some(l=>l.id===id&&l.visible&&!l.locked&&(!('studioKind' in l)||!l.studioKind||l.studioKind==='canvas'));
export function inkPolygonMask(ink:Ink,polygon:Point[],kind:'include'|'exclude'):InkMask{
  return{kind,points:polygon.map(p=>localPoint(ink,p)),frame:frameOf(ink)};
}
/** Circular cuts affect existing ink on the active Canvas only; Note and Layout are untouched. */
export function eraseCanvasInk(doc:NoteDoc,path:Point[],radius:number,layerId:string,mode:EraserMode,gesture:string,selection?:Point[]):NoteDoc{
  if(!path.length||!writable(doc,layerId))return doc;
  const from=path[Math.max(0,path.length-2)],to=path.at(-1)!;let changed=false;
  const erase=<T extends Ink>(ink:T):T|null=>{
    if(ink.layerId!==layerId||!supported(ink))return ink;
    const masks=ink.inkMasks||[],prior=masks.findIndex(m=>m.id===gesture);
    const hit=touches(pointsOf(ink),localPoint(ink,from),localPoint(ink,to),radius+ink.width*.72,closed(ink));
    if(!hit&&prior<0)return ink;
    if(mode==='stroke'){
      if(selection&&!intersectsPolygon(ink,selection))return ink;
      changed=true;return null;
    }
    const mask:InkMask={id:gesture,kind:'erase',points:path.map(p=>localPoint(ink,p)),radius,frame:frameOf(ink),clip:selection?.map(p=>localPoint(ink,p))};
    changed=true;return{...ink,inkMasks:prior<0?[...masks,mask]:masks.map((m,i)=>i===prior?mask:m)};
  };
  const paintStrokes=doc.paintStrokes?.map(erase).filter((ink):ink is Stroke=>ink!==null),items=doc.items.map(erase).filter((ink):ink is Item=>ink!==null);
  return changed?{...doc,paintStrokes,items}:doc;
}
function intersectsPolygon(ink:Ink,polygon:Point[]){
  const shape=polygon.map(p=>localPoint(ink,p)),points=pointsOf(ink);
  return points.some(p=>pointInPolygon(p,shape))||shape.some((p,i)=>touches(points,p,shape[(i+1)%shape.length],ink.width*.72,closed(ink)));
}
/** Split selected pixels with complementary masks. Source geometry is retained for Undo/export. */
export function splitInkSelection(doc:NoteDoc,selection:InkSelection,newId:()=>string):{doc:NoteDoc;ids:string[]}{
  if(!writable(doc,selection.layerId))return{doc,ids:[]};
  if(selection.ids)return{doc,ids:selection.ids};
  const ids:string[]=[];
  const split=<T extends Ink>(ink:T):T[]=>{
    if(ink.layerId!==selection.layerId||!supported(ink)||!intersectsPolygon(ink,selection.points))return[ink];
    const id=newId();ids.push(id);
    return[{...ink,inkMasks:[...(ink.inkMasks||[]),inkPolygonMask(ink,selection.points,'exclude')]},{...ink,id,inkMasks:[...(ink.inkMasks||[]),inkPolygonMask(ink,selection.points,'include')]}];
  };
  return{doc:{...doc,items:doc.items.flatMap(split),paintStrokes:doc.paintStrokes?.flatMap(split)},ids};
}
export function moveInkSelection(doc:NoteDoc,ids:string[],dx:number,dy:number):NoteDoc{
  const selected=new Set(ids),move=(p:Point)=>({...p,x:p.x+dx,y:p.y+dy});
  return{...doc,items:doc.items.map(i=>!selected.has(i.id)?i:{...i,x:i.x+dx,y:i.y+dy,points:i.points?.map(move),origin:i.origin?move(i.origin):undefined}),paintStrokes:doc.paintStrokes?.map(s=>!selected.has(s.id)?s:{...s,points:s.points.map(move)})};
}
