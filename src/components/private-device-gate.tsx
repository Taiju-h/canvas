import {useState} from 'react';
import {LockKeyhole} from 'lucide-react';
import {activateDevice} from '@/lib/private-devices';
import type {Session} from '@/lib/offline-session';

export const PRIVATE_APK='https://github.com/Taiju-h/canvas/releases/download/v0.4.6-private/KaeruNote-0.4.6.apk';
export default function PrivateDeviceGate({session,onReady,onRetry,busy:retrying=false}:{session:Session;onReady:(next:Session)=>void;onRetry:()=>void;busy?:boolean}){
  const [name,setName]=useState(''),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const canRegister=!!session.csrfToken&&!session.upgradeRequired&&!session.setupRequired;
  return <main className="visitor-gate kn-private-gate" aria-labelledby="private-title"><section className="visitor-card">
    <div className="visitor-mark"><LockKeyhole size={27}/></div><p className="kn-private-eyebrow">PERSONAL WORKSPACE</p>
    <h1 id="private-title">ご本人の端末を登録</h1>
    <p>KaeruNoteは個人専用です。ご自分のAndroid・PC・iPadに、1回限りの登録コードを入力してください。</p>
    {session.upgradeRequired?<p className="visitor-error" role="alert">Androidアプリの更新が必要です。<a href={PRIVATE_APK}>最新版をダウンロード</a>して上書き更新してください。</p>:
    session.setupRequired?<p className="visitor-error" role="alert">サーバーの個人専用設定が必要です。設定後に、最初の端末用コードをここで入力できます。</p>:null}
    {canRegister&&<form onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError('');
      try{const next=await activateDevice(session,code,name);setCode('');onReady(next);}catch(error){setError(error instanceof Error?error.message:'端末を登録できません');}finally{setBusy(false);}
    }}>
      <label htmlFor="private-device-name">この端末の名前</label><input id="private-device-name" value={name} onChange={e=>setName(e.target.value)} maxLength={80} placeholder="例：自分のAndroid" autoComplete="off" required/>
      <label htmlFor="private-device-code">登録コード</label><input id="private-device-code" value={code} onChange={e=>setCode(e.target.value)} maxLength={48} placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} required/>
      <p className="visitor-note">初回のコードはサーバー設定時に発行されます。2台目からは、登録済みの端末の「自分の端末」で発行できます。</p>
      <button type="submit" disabled={busy||!name.trim()||!code.trim()}>{busy?'登録中…':'この端末を登録して開く'}</button>
    </form>}
    {(error||session.error)&&<p role="alert" className="visitor-error">{error||session.error}</p>}
    <button type="button" className="kn-private-retry" onClick={onRetry} disabled={retrying||busy}>{retrying?'接続確認中…':'接続を再確認'}</button>
    <p className="visitor-note">登録後はこの端末に保存したメモをオフラインでも使えます。登録や解除で、保存データを削除することはありません。</p>
  </section></main>;
}
