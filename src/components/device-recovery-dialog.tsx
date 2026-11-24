import {useEffect,useRef,useState} from 'react';
import {Database,RefreshCw,X} from 'lucide-react';
import {prepareDeviceRecovery,copyDeviceRecovery,type RecoveryPlan,type RecoveryProgress} from '@/lib/device-recovery';
import {prepareWebUpdate} from '@/lib/web-update';
import {pauseNoteSync} from '@/lib/note-sync-pause';

export default function DeviceRecoveryDialog({accountId,onClose,onArchived,onSettle}:{accountId:string;onClose:()=>void;onArchived:(id:string)=>void;onSettle:()=>Promise<unknown>}){
  const [plan,setPlan]=useState<RecoveryPlan>(),[progress,setProgress]=useState<RecoveryProgress>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reconnect,setReconnect]=useState(false),[complete,setComplete]=useState(false);
  const cancelled=useRef(false),close=useRef<HTMLButtonElement>(null),release=useRef<(()=>void)|null>(null),firstId=useRef<string|undefined>(undefined);
  async function inspect(){
    cancelled.current=false;setBusy(true);setError('');setPlan(undefined);setComplete(false);setReconnect(false);
    try{if(!release.current)release.current=pauseNoteSync();await prepareWebUpdate();await onSettle();setPlan(await prepareDeviceRecovery(accountId,setProgress,()=>cancelled.current));}
    catch(e){setError(e instanceof Error?e.message:String(e));setReconnect(!!(e as {reconnect?:boolean}).reconnect);}finally{setBusy(false);}
  }
  useEffect(()=>{close.current?.focus();void inspect();return()=>{cancelled.current=true;release.current?.();};},[]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();if(busy)cancelled.current=true;else if(!complete)onClose();}
    if(event.key==='Tab'){
      const dialog=close.current?.closest('section'),items=Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]')||[]),first=items[0],last=items.at(-1);
      if(!dialog?.contains(document.activeElement)||event.shiftKey&&document.activeElement===first){event.preventDefault();(event.shiftKey?last:first)?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  };addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[busy,complete]);
  async function openSaved(){await prepareWebUpdate();const url=new URL(location.href);if(firstId.current)url.searchParams.set('d',firstId.current);location.replace(url.href);}
  return <div className="kn-devices-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="device-recovery-title" className="kn-devices kn-device-recovery">
    <header><h2 id="device-recovery-title"><Database size={21}/>端末のメモをDBへ保存</h2><button ref={close} disabled={busy} onClick={()=>complete?void openSaved():onClose()} aria-label="端末の保存確認を閉じる"><X size={20}/></button></header>
    <p>この端末にあるご自分のメモを、Android・PC・iPadで使う保存先へコピーします。本文・Canvas・レイアウト・画像・添付の原本を保持します。</p>
    {progress&&<p role="status">{progress.phase} · {progress.done} / {progress.total}<br/>{progress.page}</p>}
    {plan&&<><p>保存先：<strong>{plan.destinationName}</strong></p><dl className="kn-recovery-counts"><div><dt>端末にある保存分</dt><dd>{plan.localCount}件</dd></div><div><dt>接続中のDB</dt><dd>{plan.serverCount}件</dd></div><div><dt>保存先に確認済み</dt><dd>{complete?plan.alreadySaved+plan.sources.length:plan.alreadySaved}件</dd></div><div><dt>{complete?'今回保存したメモ':'コピーするメモ'}</dt><dd>{plan.sources.length}件</dd></div></dl>
      <details><summary>サーバー初期設定で同じ保存先を選ぶ場合</summary><p>setupの一覧で、次の保存先IDと一致する行を選びます。</p><input aria-label="初期設定で選ぶ保存先ID" value={plan.accountId} readOnly onFocus={e=>e.target.select()}/></details>
      {!!plan.sources.length&&<details open><summary>保存するメモの確認</summary><ul className="kn-recovery-pages">{plan.sources.map(s=><li key={s.record.id}>{s.record.title}<small>{s.record.content.note?.category||'未分類'}</small></li>)}</ul></details>}
      <p className="visitor-note">すでにDBにある内容を上書きせず、端末で変更した分は新しいメモとして残します。元の端末データと履歴は保持します。中断後も同じ内容の二重取り込みを避けて再開します。</p>
      {!complete&&<button className="kn-device-invite" disabled={busy||!plan.sources.length&&!plan.folderAdditions} onClick={async()=>{
        cancelled.current=false;setBusy(true);setError('');try{const result=await copyDeviceRecovery(plan,setProgress,()=>cancelled.current,onArchived);firstId.current=result.firstId;setPlan({...plan,serverCount:result.serverCount});setComplete(true);}catch(e){setError(e instanceof Error?e.message:String(e));setPlan(undefined);setReconnect(!!(e as {reconnect?:boolean}).reconnect);}finally{setBusy(false);}
      }}>{plan.sources.length}件・{plan.folderAdditions}フォルダをDBへ保存</button>}
    </>}
    {error&&<p className="visitor-error" role="alert">{error}</p>}
    {reconnect&&<button disabled={busy} onClick={()=>{onClose();window.dispatchEvent(new Event('kaerunote-reconnect-request'));}}>保存先を再確認</button>}
    {complete?<><p role="status">DBへの保存が完了しました。同じ保存先に登録した他の端末から開けます。</p><button onClick={()=>void openSaved()}>保存したメモを開く</button></>:
      <button disabled={busy} onClick={()=>void inspect()}><RefreshCw size={16}/>保存状況を再確認</button>}
    {busy&&<button onClick={()=>{cancelled.current=true;}}>処理を中断する</button>}
  </section></div>;
}
