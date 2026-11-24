import {fetchWithTimeout} from './network';
export type Session={
  authenticated:boolean;memberAuthenticated?:boolean;accountId?:string;nickname?:string|null;csrfToken?:string;
  localOnly?:boolean;deviceOnly?:boolean;privateAccess?:boolean;deviceAuthorized?:boolean;
  deviceId?:string;deviceName?:string;upgradeRequired?:boolean;minimumAndroidVersion?:string;
  setupRequired?:boolean;error?:string;
};
export function nativePrivateRequired():boolean {
  try{return !!(window as Window&{CanvasApp?:{requiresDeviceRegistration?:()=>boolean}}).CanvasApp?.requiresDeviceRegistration?.();}catch{return true;}
}
function privateKnown(){try{return nativePrivateRequired()||localStorage.getItem('canvasPrivateAccess')==='true';}catch{return nativePrivateRequired();}}
export function cachedSession():Session|null{
  try{const raw=localStorage.getItem('canvasSessionCache'),s=raw?JSON.parse(raw):null;return s&&typeof s.authenticated==='boolean'&&(!s.authenticated||typeof s.accountId==='string'&&!!s.accountId)?s:null;}catch{return null;}
}
export function cacheSession(session:Session){
  if(!session.authenticated&&!session.privateAccess)return;
  try{
    if(session.privateAccess)localStorage.setItem('canvasPrivateAccess','true');
    const {localOnly,...saved}=session;localStorage.setItem('canvasSessionCache',JSON.stringify(saved));
  }catch{}
}
export function requiresPrivateGate(session:Session){return !!session.privateAccess&&(!session.authenticated||session.deviceAuthorized!==true);}
function blocked(extra:Partial<Session>={}):Session{return{authenticated:false,privateAccess:true,deviceAuthorized:false,...extra};}
function usableCache(cached:Session|null){
  if(!cached?.authenticated||!cached.accountId)return false;
  return !privateKnown()||cached.privateAccess&&cached.deviceAuthorized===true;
}
export function localSession():Session{
  const cached=cachedSession();if(usableCache(cached))return{...cached!,localOnly:true};
  if(privateKnown())return blocked({error:'この端末の初回登録にはインターネット接続が必要です'});
  let id=localStorage.getItem('canvasDeviceAccount');if(!id){id='device-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem('canvasDeviceAccount',id);}
  const session={authenticated:true,accountId:id,localOnly:true,deviceOnly:true};cacheSession(session);return session;
}
export async function readSession(forceRemote=false):Promise<Session>{
  const cached=cachedSession();
  if(!forceRemote&&usableCache(cached)&&(!navigator.onLine||cached?.deviceOnly))return{...cached!,localOnly:true};
  if(!forceRemote&&!navigator.onLine&&privateKnown())return blocked({error:'この端末の初回登録にはインターネット接続が必要です'});
  try{
    const response=await fetchWithTimeout('/canvas/api.php?path=%2Fapi%2Fsession',{credentials:'same-origin',cache:'no-store'},4000);
    const payload=await response.json() as Session;
    // A private-mode denial supersedes old logins; only network failures may use enrolled offline data.
    if(payload.privateAccess){
      const session=payload.authenticated===true&&payload.deviceAuthorized===true&&typeof payload.accountId==='string'&&!!payload.accountId&&response.ok
        ?payload:blocked({csrfToken:payload.csrfToken,upgradeRequired:payload.upgradeRequired,minimumAndroidVersion:payload.minimumAndroidVersion,error:payload.error});
      cacheSession(session);return session;
    }
    if(!response.ok)throw new Error('利用者情報を確認できません');
    if(privateKnown()){
      const session=blocked({setupRequired:true,error:'サーバーの個人専用設定がまだ有効になっていません'});cacheSession(session);return session;
    }
    if(typeof payload.authenticated!=='boolean'||payload.authenticated&&!payload.accountId)throw new Error('利用者情報を確認できません');
    cacheSession(payload);return payload;
  }catch(error){
    if(usableCache(cached)){if(!forceRemote)return{...cached!,localOnly:true};throw error;}
    if(privateKnown())return blocked({error:'登録状況を確認できません。インターネット接続後に、接続を再確認してください'});
    throw error;
  }
}
