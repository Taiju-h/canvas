import {useEffect,useRef,useState,type PointerEvent,type ReactNode} from 'react';

const WIDTH_KEY='kn-file-sidebar-width';
function readWidth(){
  try{const value=Number(localStorage.getItem(WIDTH_KEY));return Number.isFinite(value)&&value>0?value:null;}catch{return null;}
}
function widthBounds(viewport:number){
  const max=Math.max(160,Math.min(560,viewport-(viewport<=760?24:viewport>900?640:380)));
  return {min:Math.min(220,max),max};
}

/** File navigation owns its size; resizing never changes the open document. */
export default function ResizableNoteSidebar({children}:{children:ReactNode}){
  const [preferredWidth,setPreferredWidth]=useState(readWidth);
  const [viewport,setViewport]=useState(()=>window.innerWidth);
  const [resizing,setResizing]=useState(false);
  const drag=useRef<{id:number;x:number;width:number}|null>(null);
  const {min,max}=widthBounds(viewport);
  const defaultWidth=viewport<=760?Math.min(300,viewport*.86):viewport<=1100?250:290;
  const clamp=(value:number)=>Math.round(Math.max(min,Math.min(max,value)));
  const width=clamp(preferredWidth??defaultWidth);
  useEffect(()=>{
    const resize=()=>setViewport(window.innerWidth);
    window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[]);
  useEffect(()=>{try{if(preferredWidth===null)localStorage.removeItem(WIDTH_KEY);else localStorage.setItem(WIDTH_KEY,String(preferredWidth));}catch{}},[preferredWidth]);
  function start(event:PointerEvent<HTMLDivElement>){
    if(event.button!==0||!event.isPrimary)return;
    event.preventDefault();event.currentTarget.focus();
    drag.current={id:event.pointerId,x:event.clientX,width};
    event.currentTarget.setPointerCapture(event.pointerId);setResizing(true);
  }
  function move(event:PointerEvent<HTMLDivElement>){
    const active=drag.current;if(!active||active.id!==event.pointerId)return;
    event.preventDefault();setPreferredWidth(clamp(active.width+event.clientX-active.x));
  }
  function finish(event:PointerEvent<HTMLDivElement>){
    if(drag.current?.id!==event.pointerId)return;
    drag.current=null;setResizing(false);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <aside id="notes-file-navigation" className={'notes-sidebar notes-sidebar-resizable'+(resizing?' is-resizing':'')} style={{width}}>
    {children}
    <div className="notes-sidebar-resize" role="separator" tabIndex={0} aria-label="ファイルメニューの幅" aria-orientation="vertical" aria-controls="notes-file-navigation" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} aria-valuetext={width+'ピクセル'} title="左右にドラッグして幅を変更・ダブルクリックで元の幅へ"
      onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
      onLostPointerCapture={()=>{drag.current=null;setResizing(false);}}
      onDoubleClick={()=>setPreferredWidth(null)}
      onKeyDown={event=>{
        if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setPreferredWidth(clamp(width+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?64:16)));}
        else if(event.key==='Home'||event.key==='End'){event.preventDefault();setPreferredWidth(event.key==='Home'?min:max);}
        else if(event.key==='Enter'){event.preventDefault();setPreferredWidth(null);}
      }}/>
  </aside>;
}
