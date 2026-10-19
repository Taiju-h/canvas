import type {Point} from './canvas';

export type InkBrush='pen'|'gpen'|'marker'|'brush'|'airbrush';
type Sample=Point&{t:number};

export function pressureWidth(width:number,pressure?:number){
  const p=pressure&&pressure>0?pressure:.5;
  return Math.max(.8,width*(.38+p*1.05));
}

/** Even spacing makes spray density independent of device event frequency. */
export function sampleInk(points:Point[],spacing:number):Sample[]{
  if(!points.length)return [];
  const distances=[0];
  for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
  const total=distances.at(-1)!;
  if(total<.5)return [{...points[0],t:.5}];
  const steps=Math.min(2047,Math.max(1,Math.ceil(total/Math.max(.5,spacing))));
  const samples:Sample[]=[];let segment=1;
  for(let i=0;i<=steps;i++){
    const distance=total*i/steps;
    while(segment<points.length-1&&distances[segment]<distance)segment++;
    const a=points[segment-1],b=points[segment],span=distances[segment]-distances[segment-1];
    const ratio=span?(distance-distances[segment-1])/span:0;
    samples.push({x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio,p:(a.p??.5)+((b.p??.5)-(a.p??.5))*ratio,t:i/steps});
  }
  return samples;
}

const number=(value:number)=>Math.round(value*1000)/1000;
const coordinate=(point:Point)=>`${number(point.x)},${number(point.y)}`;

/** A filled, pressure-sensitive ribbon with thin entry and exit. */
export function brushOutline(points:Point[],width:number,pressure:boolean){
  const samples=sampleInk(points,Math.max(.8,width*.12));
  if(samples.length<2)return '';
  const left:Point[]=[],right:Point[]=[];
  for(let i=0;i<samples.length;i++){
    const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)],point=samples[i];
    const length=Math.hypot(b.x-a.x,b.y-a.y)||1;
    const radius=(pressure?pressureWidth(width,point.p):width)/2*(.12+.88*Math.pow(Math.sin(Math.PI*point.t),.55));
    const nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length;
    left.push({x:point.x+nx*radius,y:point.y+ny*radius});right.push({x:point.x-nx*radius,y:point.y-ny*radius});
  }
  const outline=[...left,...right.reverse()];
  return 'M'+coordinate(outline[0])+outline.slice(1).map(point=>' L'+coordinate(point)).join('')+' Z';
}

export function airbrushDabs(points:Point[],width:number,pressure:boolean){
  return sampleInk(points,Math.max(1,width*.16)).map(point=>({x:point.x,y:point.y,r:Math.max(.4,(pressure?pressureWidth(width,point.p):width)/2)}));
}
