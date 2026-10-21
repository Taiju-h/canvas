let starting:Promise<boolean>|undefined;
export function ensureOfflineShell():Promise<boolean>{
  if(!('serviceWorker' in navigator))return Promise.resolve(!!(window as Window&{CanvasApp?:unknown}).CanvasApp);
  if(!starting)starting=(async()=>{
    const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
    const worker=registration.installing||registration.waiting||registration.active;
    if(!worker)throw new Error('画面の端末保存を開始できません');
    if(worker.state!=='activated')await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('statechange',change);};
      const timer=setTimeout(()=>{cleanup();reject(new Error('画面の端末保存を確認できませんでした。接続後に再試行できます'));},30000);
      const change=()=>{if(worker.state==='activated'){cleanup();resolve();}else if(worker.state==='redundant'){cleanup();reject(new Error('画面の端末保存に失敗しました'));}};
      worker.addEventListener('statechange',change);change();
    });
    for(const old of await navigator.serviceWorker.getRegistrations())if(new URL(old.scope).pathname==='/canvas/')await old.unregister();
    document.documentElement.dataset.offlineReady='true';
    if(navigator.onLine)void registration.update().catch(()=>{});
    return true;
  })().catch(error=>{starting=undefined;document.documentElement.dataset.offlineReady='false';throw error;});
  return starting;
}
