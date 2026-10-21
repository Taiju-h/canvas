import {fetchWithTimeout} from './network';
import {fileURL,type NoteRecord} from './notes';
import {getLocalImage} from './local-docs';

export type NoteAsset={id:string;kind:'file'|'image';name:string;mime?:string;size?:number;documentId?:string};
export function noteAssets(record:NoteRecord){
  const assets=new Map<string,NoteAsset>();
  for(const a of record.content.attachments||[])assets.set(a.id,{...a,kind:'file'});
  function image(id:string){
    const file=id.startsWith('file:');const key=file?id.slice(5):id;
    if(!key||assets.has(key))return;
    assets.set(key,{id:key,kind:file?'file':'image',name:key+'.png',mime:'image/png'});
  }
  for(const id of [...record.content.items.map(x=>x.imageId),...record.content.layers.map(x=>x.rasterImageId)])if(id)image(id);
  const template=document.createElement('template');template.innerHTML=[record.content.fixedNote?.html,...(record.content.blocks||[]).map(b=>b.html),record.content.legacyNoteBody?.block.html].filter(Boolean).join('\n');
  for(const node of template.content.querySelectorAll('[data-kn-local-image],[data-kn-local-file],img,a[href]')){
    const localImage=node.getAttribute('data-kn-local-image'),localFile=node.getAttribute('data-kn-local-file');
    if(localImage)image(localImage);
    if(localFile&&!assets.has(localFile))assets.set(localFile,{id:localFile,kind:'file',name:localFile});
    const value=node.getAttribute('src')||node.getAttribute('href');if(!value)continue;
    try{
      const url=new URL(value,location.href);if(url.origin!==location.origin||url.pathname!=='/canvas/api.php')continue;
      const match=/^\/api\/documents\/([a-f0-9]{32})\/(files|images)\/([a-zA-Z0-9-]+)$/.exec(url.searchParams.get('path')||'');
      if(match&&!assets.has(match[3]))assets.set(match[3],{id:match[3],kind:match[2]==='files'?'file':'image',name:match[3]+(match[2]==='images'?'.png':''),documentId:match[1]});
    }catch{/* A normal external link is kept in the document, never fetched for a backup. */}
  }
  return [...assets.values()];
}
export async function readNoteAsset(documentId:string,asset:NoteAsset,shareToken?:string,signal?:AbortSignal){
  let blob=await getLocalImage(asset.id);
  if(!blob){
    if(!navigator.onLine||documentId.startsWith('local-')||asset.id.startsWith('local-'))throw new Error(`「${asset.name}」はこの端末に未取得です。元の端末か、接続中に取り出してください。`);
    const id=asset.documentId||documentId;
    const url=asset.kind==='file'?fileURL(id,asset.id):'/canvas/api.php?path='+encodeURIComponent(`/api/documents/${id}/images/${asset.id}`);
    const response=await fetchWithTimeout(url,{credentials:'same-origin',headers:shareToken?{'X-Share-Token':shareToken}:undefined,signal});
    if(!response.ok)throw new Error(`「${asset.name}」を取得できません（${response.status}）。同じ利用者で開いているか確認してください。`);
    blob=await response.blob();
  }
  if(asset.size!==undefined&&asset.size>0&&blob.size!==asset.size)throw new Error(`「${asset.name}」の原本サイズが一致しません。保存を中止しました。`);
  return blob.type?blob:new Blob([blob],{type:asset.mime||'application/octet-stream'});
}
