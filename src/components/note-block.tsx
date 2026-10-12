import {flowNoteColumns} from '@/lib/rich-note-commands';
import {noteEditorKeyDown,noteCheckboxClick} from '@/lib/rich-editor-dom';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { cleanHTML, fileURL, type NoteBlock } from '@/lib/notes';
import {getLocalImage} from '@/lib/local-docs';

type Props={docId:string;block:NoteBlock;opacity?:number;readOnly?:boolean;focused:boolean;selected:boolean;onFocus:()=>void;onChange:(html:string,height:number)=>void;
  onDrag:(event:ReactPointerEvent,resize?:boolean)=>void;onSize:(height:number)=>void;onPaste:(files:File[])=>void;onNavigate:(id:string)=>void};
export default function EditableBlock({docId,block,opacity=1,readOnly,focused,selected,onFocus,onChange,onDrag,onSize,onPaste,onNavigate}:Props){
  const ref=useRef<HTMLDivElement>(null);const composing=useRef(false);const callback=useRef(onSize);callback.current=onSize;
  useLayoutEffect(()=>{const el=ref.current;if(!el)return;const html=cleanHTML(block.html);
    if(document.activeElement!==el && el.innerHTML!==html)el.innerHTML=html;
  },[block.html]);
  useEffect(()=>{
    const root=ref.current;if(!root)return;
    const urls:string[]=[];let live=true;
    void (async()=>{
      for(const img of Array.from(root.querySelectorAll<HTMLImageElement>('img[data-kn-local-image]'))){
        const id=img.dataset.knLocalImage||'';if(!id)continue;
        const blob=await getLocalImage(id).catch(()=>undefined);
        if(!live)return;
        if(blob){const url=URL.createObjectURL(blob);urls.push(url);img.src=url;}
        else if(!docId.startsWith('local-'))img.src=fileURL(docId,id);
      }
    })();
    return()=>{live=false;urls.forEach(URL.revokeObjectURL);};
  },[docId,block.html]);
  useEffect(()=>{if(focused&&!readOnly)ref.current?.focus({preventScroll:true});},[focused,readOnly]);
  useEffect(()=>{const el=ref.current;if(!el)return;const observer=new ResizeObserver(()=>callback.current(Math.max(140,el.scrollHeight+54)));observer.observe(el);return()=>observer.disconnect();},[]);
  function emit(){if(readOnly)return;const el=ref.current;if(el){flowNoteColumns(el);onChange(cleanHTML(el.innerHTML),Math.max(140,el.scrollHeight+54));}}
  return <section data-note-block={block.id} data-layer-id={block.layerId} className={`note-block ${selected?'selected':''}`} style={{opacity,left:block.x,top:block.y,width:block.w,minHeight:140,background:block.background||'#fff'}}>
    <button className="note-block-handle" title="ドラッグして移動" aria-label="文章ブロックを移動" onPointerDown={e=>onDrag(e)}>⠿</button>
    <div ref={ref} className="note-content" contentEditable={!readOnly} suppressContentEditableWarning role="textbox" aria-label="メモ本文" aria-multiline="true" data-placeholder="ここから書き始める…" spellCheck
      onFocus={onFocus} onInput={()=>{if(!composing.current)emit();}} onCompositionStart={()=>{composing.current=true;}}
      onCompositionEnd={()=>{composing.current=false;emit();}} onBlur={emit}
      onKeyDown={e=>noteEditorKeyDown(e,emit)}
      onClick={e=>{noteCheckboxClick(e,emit);
        const localLink=(e.target as Element).closest<HTMLAnchorElement>('a[data-kn-local-file]');
        if(localLink?.dataset.knLocalFile){
          e.preventDefault();
          const id=localLink.dataset.knLocalFile;
          void getLocalImage(id).then(blob=>{
            if(blob){const url=URL.createObjectURL(blob),element=document.createElement('a');element.href=url;element.download=localLink.textContent||'attachment';element.click();setTimeout(()=>URL.revokeObjectURL(url),20000);}
            else if(!docId.startsWith('local-'))window.open(fileURL(docId,id),'_blank','noopener,noreferrer');
          });return;
        }
        const anchor=(e.target as Element).closest('a');if(anchor && (e.ctrlKey||e.metaKey)){e.preventDefault();const url=new URL(anchor.href);const id=url.searchParams.get('d');if(url.origin===location.origin&&id)onNavigate(id);else window.open(url.href,'_blank','noopener,noreferrer');}}}
      onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();onPaste(Array.from(e.clipboardData.files));return;}
        e.preventDefault();const html=e.clipboardData.getData('text/html');if(html)document.execCommand('insertHTML',false,cleanHTML(html));else document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));emit();}} />
    <button className="note-resize" title="ドラッグして幅を変更" aria-label="文章ブロックの幅を変更" onPointerDown={e=>onDrag(e,true)}>↔</button>
  </section>;
}
