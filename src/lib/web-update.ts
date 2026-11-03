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

export function describeWebUpdate(commit:string|undefined,time:unknown,remote:{commit?:string;commitTime?:number},appVersion=''){
  const versions=`現在の画面 ${commit?.slice(0,7)||'不明'}／公開版 ${remote.commit?.slice(0,7)||'不明'}${appVersion?'／アプリ '+appVersion:''}`;
  if(!commit||!remote.commit)return versions+'。版情報を確認できません。';
  if(sameCommit(commit,remote.commit))return versions+'。最新版です。';
  if(hasNewerWebVersion(commit,time,remote))return versions+'。更新できます。「更新あり」から取り込んでください。';
  if(!Number.isFinite(Number(remote.commitTime))||Number(remote.commitTime)<=0)return versions+'。公開版の日時を確認できません。';
  return versions+'。公開版は現在の画面より新しくないため、更新しません。';
}
