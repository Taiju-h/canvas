import {useEffect,useRef,useState} from 'react';
import {LockKeyhole,X} from 'lucide-react';
import {listPrivateDevices,invitePrivateDevice,revokePrivateDevice,type PrivateDevice} from '@/lib/private-devices';
import type {Session} from '@/lib/offline-session';

export default function PrivateDeviceManager({session,onClose,onRevoked}:{session:Session;onClose:()=>void;onRevoked:()=>void}){
  const [devices,setDevices]=useState<PrivateDevice[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true),[code,setCode]=useState(''),[expires,setExpires]=useState(0),[confirm,setConfirm]=useState('');
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{close.current?.focus();let live=true;void listPrivateDevices().then(d=>{if(live)setDevices(d);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};addEventListener('keydown',key);return()=>{live=false;removeEventListener('keydown',key);};},[]);
  useEffect(()=>{if(!code)return;const timer=setTimeout(()=>{setCode('');setExpires(0);},Math.max(0,expires-Date.now()));return()=>clearTimeout(timer);},[code,expires]);
  async function revoke(device:PrivateDevice){
    setBusy(true);setError('');try{const result=await revokePrivateDevice(session.csrfToken||'',device.id);setConfirm('');if(result.currentRevoked){onRevoked();return;}setDevices(await listPrivateDevices());}catch(e){setError(e instanceof Error?e.message:'解除できません');}finally{setBusy(false);}
  }
  return <div className="kn-devices-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="devices-title" className="kn-devices">
    <header><h2 id="devices-title"><LockKeyhole size={21}/>自分の端末</h2><button ref={close} onClick={onClose} aria-label="端末管理を閉じる"><X size={20}/></button></header>
    <p>登録したAndroid・PC・iPadから、同じ個人用データを使えます。</p>
    <button className="kn-device-invite" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const invite=await invitePrivateDevice(session.csrfToken||'');setCode(invite.code);setExpires(Date.now()+invite.expiresInMinutes*60000);}catch(e){setError(e instanceof Error?e.message:'コードを発行できません');}finally{setBusy(false);}}}>別の自分の端末を追加する</button>
    {code&&<div className="kn-device-code" role="status"><strong>15分有効・1台だけ登録できます</strong><input aria-label="追加端末の登録コード" value={code} readOnly onFocus={e=>e.target.select()}/><p>追加する端末で <a href="https://canvas.uzero.style/canvas/" target="_blank" rel="noreferrer">KaeruNote</a> を開いて入力してください。コードはご本人だけが使ってください。</p></div>}
    {error&&<p className="visitor-error" role="alert">{error}</p>}
    <ul className="kn-device-list">{devices.map(d=><li key={d.id}><div><strong>{d.name}</strong><small>{d.current?'この端末 · ':''}{d.revokedAt?'解除済み':d.expiresAt<=Date.now()?'期限切れ':'登録済み'}</small></div>{!d.revokedAt&&d.expiresAt>Date.now()&&(confirm===d.id?<div className="kn-device-confirm"><p>{d.current?'この端末の登録を解除しますか？':'この端末のサーバー利用を止めますか？'} 保存データは残ります。</p><button disabled={busy} onClick={()=>void revoke(d)}>解除する</button><button disabled={busy} onClick={()=>setConfirm('')}>戻る</button></div>:<button disabled={busy} onClick={()=>setConfirm(d.id)}>登録を解除</button>)}</li>)}</ul>
    <p className="visitor-note">解除はオンライン接続時に反映されます。オフライン保存済みのデータは遠隔削除されません。紛失時は端末の画面ロックも使ってください。</p>
  </section></div>;
}
