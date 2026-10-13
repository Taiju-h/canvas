export function sameCommit(a:unknown,b:unknown){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=a.toLowerCase(),y=b.toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(x)&&/^[a-f0-9]{7,40}$/.test(y)&&(x.startsWith(y)||y.startsWith(x));
}
export async function prepareWebUpdate(timeoutMs=15000){
  const waits:Promise<unknown>[]=[];
  window.dispatchEvent(new CustomEvent('kaerunote-before-web-update',{detail:{waitUntil:(promise:Promise<unknown>)=>waits.push(promise)}}));
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([Promise.all(waits),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('端末への保存確認に時間がかかっています。編集内容を残して更新を中止しました。')),timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}

export function hasNewerWebVersion(commit:string|undefined,time:unknown,remote:{commit?:string;commitTime?:number}){
  if(!commit||!remote.commit||sameCommit(commit,remote.commit))return false;
  const installed=Number(time),candidate=Number(remote.commitTime);
  // Unknown/older production metadata must never downgrade a newer bundled APK.
  return Number.isFinite(candidate)&&candidate>0&&candidate>(Number.isFinite(installed)?installed:0);
}
