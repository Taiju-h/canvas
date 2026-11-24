import {fetchWithTimeout} from './network';
import {cacheSession,type Session} from './offline-session';
export type PrivateDevice={id:string;name:string;createdAt:number;expiresAt:number;revokedAt:number|null;current:boolean};
async function request(path:string,csrfToken?:string,body?:unknown){
  const response=await fetchWithTimeout('/canvas/api.php?path='+encodeURIComponent(path),{
    method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrfToken||''},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const result=await response.json();
  if(!response.ok){
    if(result.privateAccess&&result.deviceAuthorized===false){
      cacheSession({authenticated:false,privateAccess:true,deviceAuthorized:false});
      window.dispatchEvent(new Event('kaerunote-device-denied'));
    }
    throw new Error(result.error||'端末の登録情報を取得できません');
  }
  return result;
}
export async function activateDevice(session:Session,code:string,name:string):Promise<Session>{
  const result=await request('/api/private/activate',session.csrfToken,{code,name});
  if(!result.privateAccess||result.deviceAuthorized!==true||!result.accountId)throw new Error('端末登録を完了できません');
  try{(window as Window&{CanvasApp?:{persistDeviceRegistration?:()=>void}}).CanvasApp?.persistDeviceRegistration?.();}catch{}
  cacheSession(result);return result;
}
export async function listPrivateDevices():Promise<PrivateDevice[]>{return(await request('/api/private/devices')).devices;}
export async function invitePrivateDevice(csrf:string){return await request('/api/private/devices',csrf,{action:'invite'}) as {code:string;expiresInMinutes:number};}
export async function revokePrivateDevice(csrf:string,id:string){return await request('/api/private/devices',csrf,{action:'revoke',id}) as {currentRevoked:boolean};}
