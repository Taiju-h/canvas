import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';

export type WorkspaceMenuItem={id:string;label:string;icon?:ReactNode;disabled?:boolean;separatorBefore?:boolean;onSelect:()=>void};

export function WorkspaceContextMenu({point,items,onClose}:{point:{x:number;y:number};items:WorkspaceMenuItem[];onClose:()=>void}){
  const menu=useRef<HTMLDivElement>(null);
  const previousFocus=useRef(document.activeElement as HTMLElement|null);
  const [position,setPosition]=useState(point);
  useLayoutEffect(()=>{
    const fit=()=>{
      const bounds=menu.current?.getBoundingClientRect();if(!bounds)return;
      setPosition({x:Math.max(8,Math.min(point.x,innerWidth-bounds.width-8)),y:Math.max(8,Math.min(point.y,innerHeight-bounds.height-8))});
    };
    fit();window.addEventListener('resize',fit);
    return()=>window.removeEventListener('resize',fit);
  },[point.x,point.y]);
  useEffect(()=>{
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus({preventScroll:true});
    const outside=(event:PointerEvent)=>{if(event.button!==2&&!menu.current?.contains(event.target as Node))onClose();};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[point.x,point.y]);
  return <div ref={menu} className="kn-workspace-popup" role="menu" aria-label="作業メニュー" style={{left:position.x,top:position.y}}
    onPointerDown={event=>event.stopPropagation()}
    onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();previousFocus.current?.isConnected&&previousFocus.current.focus({preventScroll:true});return;}
      if(event.key==='Tab'){onClose();return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      const buttons=Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'));
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      buttons[next]?.focus({preventScroll:true});
    }}>
    <div className="kn-workspace-popup-heading"><span>作業メニュー</span><button aria-label="右クリックメニューを閉じる" onClick={onClose}><X size={14}/></button></div>
    {items.map(item=><div key={item.id}>{item.separatorBefore&&<div role="separator"/>}<button role="menuitem" disabled={item.disabled}
      onClick={()=>{onClose();item.onSelect();}}>{item.icon}<span>{item.label}</span></button></div>)}
  </div>;
}
