import {fetchWithTimeout} from './network';
export type Session={authenticated:boolean;memberAuthenticated?:boolean;accountId?:string;nickname?:string|null;csrfToken?:string;localOnly?:boolean;deviceOnly?:boolean};
export function cachedSession():Session|null{try{const raw=localStorage.getItem('canvasSessionCache'),s=raw?JSON.parse(raw):null;return s&&typeof s.authenticated==='boolean'&&(!s.authenticated||typeof s.accountId==='string'&&!!s.accountId)?s:null;}catch{return null;}}
export function cacheSession(session:Session){if(!session.authenticated)return;try{const {localOnly,...saved}=session;localStorage.setItem('canvasSessionCache',JSON.stringify(saved));}catch{}}
export function localSession():Session{
  const cached=cachedSession();if(cached?.authenticated&&cached.accountId)return{...cached,localOnly:true};
  let id=localStorage.getItem('canvasDeviceAccount');if(!id){id='device-'+crypto.randomUUID();localStorage.setItem('canvasDeviceAccount',id);}
  const session={authenticated:true,accountId:id,localOnly:true,deviceOnly:true};cacheSession(session);return session;
}
export async function readSession(forceRemote=false):Promise<Session>{
  const cached=cachedSession();
  if(!forceRemote&&cached?.authenticated&&cached.accountId&&(!navigator.onLine||cached.deviceOnly))return{...cached,localOnly:true};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('利用者確認の応答待ちを終了しました')),4000);
  try{
    const response=await fetchWithTimeout('/canvas/api.php?path=%2Fapi%2Fsession',{credentials:'same-origin',cache:'no-store',signal:controller.signal},4000);
    if(!response.ok)throw new Error('利用者情報を確認できません');
    const session=await response.json() as Session;
    if(typeof session.authenticated!=='boolean'||session.authenticated&&!session.accountId)throw new Error('利用者情報を確認できません');
    cacheSession(session);return session;
  }catch(error){if(!forceRemote&&cached?.authenticated&&cached.accountId)return{...cached,localOnly:true};throw error;}finally{clearTimeout(timer);}
}
