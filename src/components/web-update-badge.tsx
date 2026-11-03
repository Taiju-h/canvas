import {useEffect,useRef,useState} from 'react';
import {describeWebUpdate,hasNewerWebVersion,prepareWebUpdate} from '@/lib/web-update';
import {ensureOfflineShell} from '@/lib/offline-shell';
import {fetchWithTimeout} from '@/lib/network';
import {RefreshCw} from 'lucide-react';

type Bridge={applyWebUpdate?:()=>void;activateWebUpdate?:()=>void;confirmWebUpdate?:(commit:string)=>void;getAppVersion?:()=>string};
const appBridge=()=> (window as Window&{CanvasApp?:Bridge}).CanvasApp;

export default function UpdateBadge({floating=false}:{floating?:boolean}){
  const [available,setAvailable]=useState(false),[phase,setPhase]=useState<'idle'|'saving'|'downloading'|'activating'>('idle'),[message,setMessage]=useState('');
  const [checking,setChecking]=useState(false),[messageError,setMessageError]=useState(false);
  const checkRef=useRef<(manual?:boolean)=>Promise<void>>(async()=>{});
  const busy=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function stopTimer(){if(timer.current)clearTimeout(timer.current);timer.current=undefined;}
  function fail(message:string){stopTimer();busy.current=false;setPhase('idle');setMessageError(true);setMessage(message);document.querySelector<HTMLElement>('.notes-app')?.removeAttribute('inert');}
  function watch(){stopTimer();timer.current=setTimeout(()=>fail('更新の応答がありません。編集内容は端末に残っています。もう一度お試しください。'),120000);}
  useEffect(()=>{
    let live=true,inflight=false;const controller=new AbortController();
    const check=async(manual=false)=>{
      if(inflight||busy.current)return;
      inflight=true;setChecking(true);
      if(manual){setMessage('');setMessageError(false);}
      try{
        const response=await fetchWithTimeout('/canvas/build-version.json?check='+Date.now(),{cache:'no-store',credentials:'same-origin',signal:controller.signal},8000);
        if(!response.ok)throw new Error('更新サーバー応答 '+response.status);
        const remote=await response.json() as {commit?:string;commitTime?:number};
        if(!remote||typeof remote.commit!=='string'||!/^[a-f0-9]{7,40}$/i.test(remote.commit))throw new Error('公開版の情報を読み取れません');
        if(!live)return;
        setAvailable(hasNewerWebVersion(import.meta.env.VITE_APP_COMMIT,import.meta.env.VITE_APP_COMMIT_TIME,remote));
        if(manual)setMessage(describeWebUpdate(import.meta.env.VITE_APP_COMMIT,import.meta.env.VITE_APP_COMMIT_TIME,remote,appBridge()?.getAppVersion?.()||''));
      }catch(error){if(live&&manual){setMessageError(true);setMessage('更新を確認できません。接続後に「更新確認」を押してください。'+(error instanceof Error?error.message:''));}}
      finally{inflight=false;if(live)setChecking(false);}
    };
    checkRef.current=check;
    const checkNow=()=>void check(),visible=()=>{if(document.visibilityState==='visible')checkNow();};
    const retries=[800,10000,30000].map(delay=>setTimeout(checkNow,delay)),interval=setInterval(checkNow,5*60*1000);
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
    addEventListener('canvas-update-ready',ready);addEventListener('canvas-update-failed',failed);addEventListener('canvas-update-progress',progress);
    for(const event of ['online','pageshow','focus','canvas-app-resume'])addEventListener(event,checkNow);
    document.addEventListener('visibilitychange',visible);
    appBridge()?.confirmWebUpdate?.(import.meta.env.VITE_APP_COMMIT||'');
    return()=>{live=false;controller.abort();retries.forEach(clearTimeout);clearInterval(interval);stopTimer();removeEventListener('canvas-update-ready',ready);removeEventListener('canvas-update-failed',failed);removeEventListener('canvas-update-progress',progress);for(const event of ['online','pageshow','focus','canvas-app-resume'])removeEventListener(event,checkNow);document.removeEventListener('visibilitychange',visible);};
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
      else{
        if('serviceWorker' in navigator)await ensureOfflineShell(true);
        if(!busy.current)return;
        const url=new URL(location.href);url.searchParams.set('remoteui','1');url.searchParams.set('update',String(Date.now()));location.assign(url.toString());
      }
    }catch(error){fail(error instanceof Error?error.message:'端末への保存を確認できません');}
  }
  return <div className={'canvas-update-status '+(floating?'is-floating ':'')+(!available?'is-current':'')}>
    <button title={available?'新しいKaeruNoteがあります':'使用中の版と公開版を確認'} aria-label={phase==='idle'?available?'更新あり':'更新を確認':'更新処理中'} disabled={phase!=='idle'||checking} onClick={()=>available?void update():void checkRef.current(true)}>{available?<b>!</b>:<RefreshCw size={16}/>}<span>{checking?'確認中…':phase==='idle'&&!available?'更新確認':{idle:'更新あり',saving:'保存確認中…',downloading:'取得中…',activating:'切替中…'}[phase]}</span></button>
    {message&&<div className={'canvas-update-message'+(!messageError?' is-info':'')} role={messageError?'alert':'status'}><span>{message}</span><button aria-label="更新メッセージを閉じる" onClick={()=>setMessage('')}>×</button></div>}
  </div>;
}
