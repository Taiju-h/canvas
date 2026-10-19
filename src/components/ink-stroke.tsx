import type {Point} from '@/lib/canvas';
import {airbrushDabs,brushOutline,pressureWidth,type InkBrush} from '@/lib/ink-brushes';

/** Use the same SVG marks for the live preview, saved ink and PNG export. */
export default function InkStroke({id,points,color,width,opacity,brush='pen',pressure=true}:{id:string;points:Point[];color:string;width:number;opacity:number;brush?:InkBrush;pressure?:boolean}){
  if(!points.length)return null;
  if(brush==='airbrush'){
    const gradient='kn-spray-'+id.replace(/[^a-zA-Z0-9-]/g,'');
    return <g data-ink-brush="airbrush" opacity={opacity} pointerEvents="none">
      <defs><radialGradient id={gradient}><stop offset="0" stopColor={color} stopOpacity=".28"/><stop offset=".45" stopColor={color} stopOpacity=".16"/><stop offset="1" stopColor={color} stopOpacity="0"/></radialGradient></defs>
      {airbrushDabs(points,width,pressure).map((point,index)=><circle key={index} cx={point.x} cy={point.y} r={point.r} fill={'url(#'+gradient+')'} stroke="none"/>)}
    </g>;
  }
  if(brush==='brush'){
    const path=brushOutline(points,width,pressure);
    return <g data-ink-brush="brush" fill={color} stroke="none" opacity={opacity} pointerEvents="none">{path?<path d={path}/>:<circle cx={points[0].x} cy={points[0].y} r={(pressure?pressureWidth(width,points[0].p):width)/2}/>}</g>;
  }
  if(brush==='marker')return <polyline data-ink-brush={brush} points={points.map(point=>`${point.x},${point.y}`).join(' ')} stroke={color} strokeWidth={width} opacity={opacity} strokeLinecap="round" fill="none" pointerEvents="none"/>;
  return <g data-ink-brush={brush} stroke={color} strokeLinecap="round" opacity={opacity} pointerEvents="none">{points.length<2?<circle cx={points[0].x} cy={points[0].y} r={width/2} fill={color} stroke="none"/>:points.slice(1).map((point,index)=><line key={index} x1={points[index].x} y1={points[index].y} x2={point.x} y2={point.y} strokeWidth={pressure?pressureWidth(width,point.p):width}/>)}</g>;
}
