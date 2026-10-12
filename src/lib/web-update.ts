export function sameCommit(a:unknown,b:unknown){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=a.toLowerCase(),y=b.toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(x)&&/^[a-f0-9]{7,40}$/.test(y)&&(x.startsWith(y)||y.startsWith(x));
}
export async function prepareWebUpdate(){
  const waits:Promise<unknown>[]=[];
  window.dispatchEvent(new CustomEvent('kaerunote-before-web-update',{detail:{waitUntil:(promise:Promise<unknown>)=>waits.push(promise)}}));
  await Promise.all(waits);
}
