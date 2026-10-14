import {useEffect,useRef,type MouseEvent,type PointerEvent} from 'react';

type Tap={id:number;button:HTMLButtonElement;x:number;y:number;started:number;moved:boolean;handled:boolean;fallback:boolean;ended?:number;timer?:ReturnType<typeof setTimeout>};
/** Recover a missing touch compatibility click without activating a drag twice. */
export function useTouchButtons(){
  const tap=useRef<Tap|null>(null);
  const clear=()=>{if(tap.current?.timer)clearTimeout(tap.current.timer);tap.current=null;};
  useEffect(()=>clear,[]);
  const buttonAt=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLButtonElement>('button'):null;
  return {
    onPointerDownCapture(e:PointerEvent<HTMLElement>){
      clear();
      if(e.pointerType!=='touch'||!e.isPrimary||e.button!==0)return;
      const button=buttonAt(e.target);
      if(!button||button.disabled||button.closest('.notes-plane,.notes-focus-float')||button.closest('[inert]'))return;
      tap.current={id:e.pointerId,button,x:e.clientX,y:e.clientY,started:Date.now(),moved:false,handled:false,fallback:false};
    },
    onPointerMoveCapture(e:PointerEvent<HTMLElement>){const t=tap.current;if(t?.id===e.pointerId&&Math.hypot(e.clientX-t.x,e.clientY-t.y)>8)t.moved=true;},
    onPointerCancelCapture(e:PointerEvent<HTMLElement>){if(tap.current?.id===e.pointerId)clear();},
    onPointerUpCapture(e:PointerEvent<HTMLElement>){
      const t=tap.current;if(!t||t.id!==e.pointerId)return;
      if(t.moved||Date.now()-t.started>650||buttonAt(e.target)!==t.button){clear();return;}
      t.ended=Date.now();
      t.timer=setTimeout(()=>{
        if(tap.current!==t||t.handled||!t.button.isConnected||t.button.disabled||t.button.closest('[inert]'))return;
        t.fallback=true;t.button.click();
      },80);
    },
    onClickCapture(e:MouseEvent<HTMLElement>){
      const t=tap.current;if(!t||buttonAt(e.target)!==t.button)return;
      if(t.fallback&&e.nativeEvent.isTrusted&&e.detail>0&&Date.now()-(t.ended||0)<900){e.preventDefault();e.stopPropagation();return;}
      t.handled=true;if(t.timer)clearTimeout(t.timer);
    },
  };
}
