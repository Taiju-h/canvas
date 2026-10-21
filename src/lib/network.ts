// Local documents remain usable when Wi-Fi is connected but the server cannot be reached.
let localMode=false;
export function setLocalMode(value:boolean){localMode=value;}
export function networkAvailable(){return !localMode&&navigator.onLine;}
export async function fetchWithTimeout(input:RequestInfo|URL,init:RequestInit={},timeout=8000){
  const controller=new AbortController(),abort=()=>controller.abort(init.signal?.reason);
  if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Error('通信を待たず端末のデータを使います')),timeout);
  try{return await fetch(input,{...init,signal:controller.signal});}
  finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
}
