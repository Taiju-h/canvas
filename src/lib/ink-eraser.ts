import {inverseTransformPoint,type Item,type Point} from './canvas';
import type {NoteDoc} from './notes';

function pointDistance(p:Point,a:Point,b:Point){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function segmentDistance(a:Point,b:Point,c:Point,d:Point){
  const x=b.x-a.x,y=b.y-a.y,u=d.x-c.x,v=d.y-c.y,den=x*v-y*u;
  if(den){const t=((c.x-a.x)*v-(c.y-a.y)*u)/den,s=((c.x-a.x)*y-(c.y-a.y)*x)/den;
    if(t>=0&&t<=1&&s>=0&&s<=1)return 0;}
  return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
export function touches(points:Point[],from:Point,to:Point,radius:number,closed=false){
  if(points.length===1)return pointDistance(points[0],from,to)<=radius;
  for(let i=1;i<points.length;i++)if(segmentDistance(points[i-1],points[i],from,to)<=radius)return true;
  return closed&&points.length>1&&segmentDistance(points.at(-1)!,points[0],from,to)<=radius;
}
export function itemPoints(item:Item):Point[]{
  if(item.kind==='path'||item.kind==='polygon')return item.points||[];
  if(item.kind==='line')return [{x:item.x,y:item.y},{x:item.x+item.w,y:item.y+item.h}];
  if(item.kind==='rect')return [{x:item.x,y:item.y},{x:item.x+item.w,y:item.y},{x:item.x+item.w,y:item.y+item.h},{x:item.x,y:item.y+item.h}];
  if(item.kind==='ellipse')return Array.from({length:64},(_,i)=>{const a=i*Math.PI/32;return{x:item.x+item.w/2+Math.abs(item.w/2)*Math.cos(a),y:item.y+item.h/2+Math.abs(item.h/2)*Math.sin(a)};});
  return [];
}
const strokeBounds=new WeakMap<object,{x:number;y:number}>();
export function unrotate(stroke:NonNullable<NoteDoc['paintStrokes']>[number],p:Point):Point{
  if(!stroke.rotation||!stroke.points.length)return p;
  let center=strokeBounds.get(stroke);
  if(!center){let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const q of stroke.points){left=Math.min(left,q.x);top=Math.min(top,q.y);right=Math.max(right,q.x);bottom=Math.max(bottom,q.y);}
    center={x:(left+right)/2,y:(top+bottom)/2};strokeBounds.set(stroke,center);}
  const a=-stroke.rotation*Math.PI/180,dx=p.x-center.x,dy=p.y-center.y;
  return{x:center.x+dx*Math.cos(a)-dy*Math.sin(a),y:center.y+dx*Math.sin(a)+dy*Math.cos(a)};
}
/** Erase whole ink/vector strokes along the pointer sweep, retaining other note data. */
export function eraseInk(doc:NoteDoc,from:Point,to:Point,radius:number):NoteDoc{
  const writable=new Set(doc.layers.filter(l=>l.visible&&!l.locked).map(l=>l.id));
  const paintStrokes=doc.paintStrokes?.filter(s=>!writable.has(s.layerId)||!touches(s.points,unrotate(s,from),unrotate(s,to),radius+s.width*(s.pressure===false?1:1.43)/2));
  const items=doc.items.filter(i=>!writable.has(i.layerId)||!touches(itemPoints(i),inverseTransformPoint(i,from),inverseTransformPoint(i,to),radius+i.width/2,i.kind==='rect'||i.kind==='ellipse'||i.kind==='polygon'));
  if(items.length===doc.items.length&&paintStrokes?.length===doc.paintStrokes?.length)return doc;
  return {...doc,items,paintStrokes};
}
