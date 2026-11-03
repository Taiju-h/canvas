import {useEffect,useRef,useState} from 'react';
import {ensureOfflineShell} from './offline-shell';
import {networkAvailable} from './network';
import type {useNotes} from './use-notes';

export type OfflineProgress={done:number;total:number;files:number;errors:number};
export function useDeviceOffline(store:ReturnType<typeof useNotes>,accountId:string,enabled:boolean){
  const [working,setWorking]=useState(false),[progress,setProgress]=useState<OfflineProgress|null>(null);
  const [message,setMessage]=useState('画面とノートの端末保存を確認しています'),[ready,setReady]=useState(false);
  const [generation,setGeneration]=useState(0),[online,setOnline]=useState(networkAvailable);
  const running=useRef<Promise<void>|null>(null),controller=useRef<AbortController|undefined>(undefined),latest=useRef(store),live=useRef(true),attempted=useRef('');
  latest.current=store;
  const signature=store.list.map(n=>`${n.id}:${n.revision}:${n.updated_at}`).sort().join('|');
  const signatureRef=useRef(signature);signatureRef.current=signature;
  useEffect(()=>{live.current=true;return()=>{live.current=false;controller.current?.abort();};},[]);
  function prepare(){
    if(running.current)return running.current;
    const startSignature=signatureRef.current;
    attempted.current=startSignature;
    const download=new AbortController();controller.current=download;
    const job=(async()=>{
      setWorking(true);setReady(false);setMessage('画面・ノート・画像を端末に保存中');
      try{
        let shellReady=false,shellError='このブラウザでは画面を端末に保存できません';
        try{shellReady=await ensureOfflineShell();}catch(error){shellError=error instanceof Error?error.message:String(error);}
        download.signal.throwIfAborted();
        if(!networkAvailable()){setMessage('通信なしで、端末に保存したノートと画像を使えます');return;}
        await latest.current.persistPending();
        const result=await latest.current.prepareOffline(true,p=>{if(live.current)setProgress(p);},download.signal);
        if(!live.current)return;
        setProgress(result);setGeneration(n=>n+1);
        if(result.errors){setMessage(`${result.errors}件が未取得です。接続・空き容量を確認して再試行できます`);return;}
        setReady(shellReady&&startSignature===signatureRef.current);
        setMessage(shellReady?'画面・全ノート・画像・添付を端末に保存しました':'ノート・画像・添付は端末に保存済み。画面の保存：'+shellError);
      }catch(error){if(live.current)setMessage(error instanceof Error?error.message:String(error));}
      finally{running.current=null;if(live.current)setWorking(false);}
    })();
    running.current=job;return job;
  }
  const prepareRef=useRef(prepare);prepareRef.current=prepare;
  useEffect(()=>{
    const changed=()=>{setOnline(networkAvailable());if(networkAvailable()){attempted.current='';setGeneration(n=>n+1);}else{setReady(false);setMessage('通信なしで、端末に保存したノートと画像を使えます');}};
    addEventListener('online',changed);addEventListener('offline',changed);
    return()=>{removeEventListener('online',changed);removeEventListener('offline',changed);};
  },[]);
  useEffect(()=>{
    if(!enabled||!store.indexReady)return;
    if(!online){setMessage('端末に保存したノートと画像を使えます。未取得分は接続後に保存します');void ensureOfflineShell().catch(()=>{});return;}
    if(attempted.current===signature||running.current)return;
    setReady(false);
    // Debounce editing and large imports; a failed pass is retried explicitly
    // or on the next connection/change, never in a tight background loop.
    const timer=setTimeout(()=>void prepareRef.current(),2000);
    return()=>clearTimeout(timer);
  },[enabled,store.indexReady,signature,online,accountId,generation]);
  return{working,progress,message,ready,generation,prepare,online};
}
