import type {Point} from './canvas';

export type InkFrame={x:number;y:number;w:number;h:number};
/** Frames keep cuts attached when ink is moved or resized, without changing its source points. */
export type InkMask={id?:string;kind:'erase'|'exclude'|'include';points:Point[];frame:InkFrame;radius?:number;clip?:Point[]};
export function inkFrame(points:Point[]):InkFrame{
  if(!points.length)return{x:0,y:0,w:1,h:1};
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
  return{x,y,w:Math.max(1,right-x),h:Math.max(1,bottom-y)};
}
export function maskTransform(mask:InkMask,frame:InkFrame){
  return `translate(${frame.x} ${frame.y}) scale(${frame.w/Math.max(1,mask.frame.w)} ${frame.h/Math.max(1,mask.frame.h)}) translate(${-mask.frame.x} ${-mask.frame.y})`;
}
export function pointInPolygon(p:Point,polygon:Point[]){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    const cross=(p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x);
    if(Math.abs(cross)<1e-7&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y))return true;
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
export function polygonArea(points:Point[]){let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.y-a.y*b.x;}return Math.abs(area)/2;}
export function translatePolygon(points:Point[],dx:number,dy:number){return points.map(p=>({...p,x:p.x+dx,y:p.y+dy}));}
