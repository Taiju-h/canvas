import {useEffect,type RefObject} from 'react';
import {getLocalImage,putLocalImage} from './local-docs';
import {fileURL} from './notes';
import {readNoteAsset,type NoteAsset} from './note-files';
import {networkAvailable} from './network';
function reference(image:HTMLImageElement,docId:string):NoteAsset|undefined{
  const id=image.getAttribute('data-kn-local-image')||image.getAttribute('data-kn-local-file');
  if(id)return{id,kind:'file',name:id,documentId:docId};
  try{const url=new URL(image.dataset.knOfflineSrc||image.getAttribute('src')||'',location.href);if(url.origin!==location.origin||url.pathname!=='/canvas/api.php')return;
    const m=/^\/api\/documents\/([a-f0-9]{32})\/(files|images)\/([a-zA-Z0-9-]+)$/.exec(url.searchParams.get('path')||'');
    if(m)return{id:m[3],kind:m[2]==='files'?'file':'image',name:m[3],documentId:m[1]};
  }catch{}
}
export function useOfflineNoteImages(ref:RefObject<HTMLDivElement|null>,docId:string,html:string,visible=true){
  useEffect(()=>{
    const root=ref.current;if(!root||!visible)return;let live=true;const urls:string[]=[];
    void(async()=>{for(const image of root.querySelectorAll<HTMLImageElement>('img')){
      const asset=reference(image,docId);if(!asset)continue;
      try{let blob=await getLocalImage(asset.id);
        if(!blob&&networkAvailable()&&!asset.id.startsWith('local-')){blob=await readNoteAsset(docId,asset);await putLocalImage(asset.id,blob);}
        if(!live||!root.contains(image))return;
        if(blob){const original=image.dataset.knOfflineSrc||image.getAttribute('src')||'';if(original&&!original.startsWith('blob:'))image.dataset.knOfflineSrc=original;const url=URL.createObjectURL(blob);urls.push(url);image.src=url;}
        else if(image.hasAttribute('data-kn-local-image')&&!docId.startsWith('local-'))image.src=fileURL(docId,asset.id);
      }catch{/* Keep the original reference and alt text when the asset is not on this device. */}
    }})();return()=>{live=false;urls.forEach(URL.revokeObjectURL);};
  },[ref,docId,html,visible]);
}
