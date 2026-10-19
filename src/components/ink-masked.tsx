import type {ReactNode} from 'react';
import {maskTransform,type InkMask,type InkFrame} from '@/lib/ink-masks';

const coordinates=(points:InkMask['points'])=>points.map(p=>`${p.x},${p.y}`).join(' ');
export default function InkMasked({id,masks=[],frame,children}:{id:string;masks?:InkMask[];frame:InkFrame;children:ReactNode}){
  if(!masks.length)return children;
  const prefix='kn-ink-mask-'+id.replace(/[^a-zA-Z0-9-]/g,'');
  const cuts=masks.filter(m=>m.kind!=='include'),clips=masks.filter(m=>m.kind==='include');
  let content=children;
  for(let i=0;i<clips.length;i++)content=<g clipPath={`url(#${prefix}-inside-${i})`}>{content}</g>;
  return <g data-ink-masked="true">
    <defs>
      {clips.map((m,i)=><clipPath key={'inside-'+i} id={`${prefix}-inside-${i}`} clipPathUnits="userSpaceOnUse"><polygon points={coordinates(m.points)} transform={maskTransform(m,frame)}/></clipPath>)}
      {cuts.map((m,i)=>m.clip&&<clipPath key={'limit-'+i} id={`${prefix}-limit-${i}`} clipPathUnits="userSpaceOnUse"><polygon points={coordinates(m.clip)}/></clipPath>)}
      {!!cuts.length&&<mask id={prefix} maskUnits="userSpaceOnUse" x={frame.x-512} y={frame.y-512} width={frame.w+1024} height={frame.h+1024} style={{maskType:'luminance'}}>
        <rect x={frame.x-512} y={frame.y-512} width={frame.w+1024} height={frame.h+1024} fill="white" stroke="none"/>
        {cuts.map((m,i)=><g key={i} transform={maskTransform(m,frame)}><g clipPath={m.clip?`url(#${prefix}-limit-${i})`:undefined}>
          {m.kind==='erase'?(m.points.length===1?<circle cx={m.points[0].x} cy={m.points[0].y} r={m.radius} fill="black" stroke="none"/>:<polyline points={coordinates(m.points)} fill="none" stroke="black" strokeWidth={(m.radius||1)*2} strokeLinecap="round" strokeLinejoin="round"/>):<polygon points={coordinates(m.points)} fill="black" stroke="none"/>}
        </g></g>)}
      </mask>}
    </defs>
    <g mask={cuts.length?`url(#${prefix})`:undefined}>{content}</g>
  </g>;
}
