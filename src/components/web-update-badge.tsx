import {useEffect,useRef,useState} from 'react';
import {hasNewerWebVersion,prepareWebUpdate} from '@/lib/web-update';

type Bridge={applyWebUpdate?:()=>void;activateWebUpdate?:()=>void;confirmWebUpdate?:(commit:string)=>void};
const appBridge=()=> (window as Window&{CanvasApp?:Bridge}).CanvasApp;

export default function UpdateBadge({floating=false}:{floating?:boolean}){
  const [available,setAvailable]=useState(false),[phase,setPhase]=useState<'idle'|'saving'|'downloading'|'activating'>('idle'),[message,setMessage]=useState('');
  const busy=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function stopTimer(){if(timer.current)clearTimeout(timer.current);timer.current=undefined;}
  function fail(message:string){stopTimer();busy.current=false;setPhase('idle');setMessage(message);document.querySelector<HTMLElement>('.notes-app')?.removeAttribute('inert');}
  function watch(){stopTimer();timer.current=setTimeout(()=>fail('更新の応答がありません。編集内容は端末に残っています。もう一度お試しください。'),120000);}
  useEffect(()=>{
    let live=true;
    const check=async()=>{try{
      const remote=await fetch('/canvas/build-version.json?check='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject());
      if(live)setAvailable(hasNewerWebVersion(import.meta.env.VITE_APP_COMMIT,import.meta.env.VITE_APP_COMMIT_TIME,remote));
    }catch{}};
    const initial=setTimeout(()=>void check(),800),interval=setInterval(()=>void check(),5*60*1000);
    const failed=(event:Event)=>fail((event as CustomEvent<string>).detail||'更新できませんでした');
    const progress=()=>{if(busy.current)watch();};
    const ready=async()=>{
      if(!busy.current)return;
      try{
        stopTimer();setPhase('saving');await prepareWebUpdate();
        if(!busy.current)return;
        const bridge=appBridge();
        if(!bridge?.activateWebUpdate)throw new Error('アプリを最新版のAPKへ更新してください');
        setPhase('activating');watch();document.querySelector<HTMLElement>('.notes-app')?.setAttribute('inert','');bridge.activateWebUpdate();
      }catch(error){fail(error instanceof Error?error.message:'端末への保存を確認できません');}
    };
    addEventListener('canvas-update-ready',ready);addEventListener('canvas-update-failed',failed);addEventListener('canvas-update-progress',progress);addEventListener('online',check);
    appBridge()?.confirmWebUpdate?.(import.meta.env.VITE_APP_COMMIT||'');
    return()=>{live=false;clearTimeout(initial);clearInterval(interval);stopTimer();removeEventListener('canvas-update-ready',ready);removeEventListener('canvas-update-failed',failed);removeEventListener('canvas-update-progress',progress);removeEventListener('online',check);};
  },[]);
  async function update(){
    if(busy.current)return;
    busy.current=true;setPhase('saving');setMessage('');
    try{
      await prepareWebUpdate();
      if(!busy.current)return;
      setPhase('downloading');watch();
      const bridge=appBridge();
      if(bridge?.applyWebUpdate){if(!bridge.activateWebUpdate)document.querySelector<HTMLElement>('.notes-app')?.setAttribute('inert','');bridge.applyWebUpdate();}
      else{const url=new URL(location.href);url.searchParams.set('remoteui','1');url.searchParams.set('update',String(Date.now()));location.assign(url.toString());}
    }catch(error){fail(error instanceof Error?error.message:'端末への保存を確認できません');}
  }
  if(!available&&!message)return null;
  return <div className={'canvas-update-status '+(floating?'is-floating':'')}>
    {available&&<button title="新しいKaeruNoteがあります" aria-label={phase==='idle'?'更新あり':'更新処理中'} disabled={phase!=='idle'} onClick={()=>void update()}><b>!</b><span>{{idle:'更新あり',saving:'保存確認中…',downloading:'取得中…',activating:'切替中…'}[phase]}</span></button>}
    {message&&<div className="canvas-update-message" role="alert"><span>{message}</span><button aria-label="更新エラーを閉じる" onClick={()=>setMessage('')}>×</button></div>}
  </div>;
}
