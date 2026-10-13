export function formatFileSize(bytes:number){
  if(bytes<1024)return `${bytes}バイト`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)}KB`;
  return `${(bytes/1024/1024).toFixed(1)}MB`;
}

/** Save the actual bytes, without opening a popup or replacing the editor. */
export async function saveBlob(name:string,blob:Blob){
  const filename=name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')||'KaeruNote';
  const native=(window as Window&{__kaeruSaveBlob?:(url:string,name:string)=>Promise<void>}).__kaeruSaveBlob;
  const app=(window as Window&{CanvasApp?:{getAppVersion?:()=>string}}).CanvasApp;
  if(app&&!native)throw new Error(app.getAppVersion?'アプリの保存機能を準備できません。アプリを開き直してから保存してください。':'ファイル保存に対応したAPK 0.4.4以上へ上書き更新してください。');
  const url=URL.createObjectURL(blob);
  let failure='';
  const failed=(event:Event)=>{failure=(event as CustomEvent<string>).detail||'ファイルを保存できません';};
  try{
    if(native){
      addEventListener('canvas-download-failed',failed);
      await native(url,filename);
      if(failure)throw new Error(failure);
    }else{
      const link=document.createElement('a');link.href=url;link.download=filename;
      document.body.append(link);link.click();link.remove();
    }
  }finally{
    removeEventListener('canvas-download-failed',failed);
    setTimeout(()=>URL.revokeObjectURL(url),native?0:60000);
  }
}
