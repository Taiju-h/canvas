import {useOfflineNoteImages} from '@/lib/offline-note-images';
import {flowNoteColumns} from '@/lib/rich-note-commands';
import {noteEditorKeyDown,noteCheckboxClick} from '@/lib/rich-editor-dom';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { cleanHTML, fileURL, type NoteBlock } from '@/lib/notes';
import {getLocalImage} from '@/lib/local-docs';

type Props={docId:string;block:NoteBlock;opacity?:number;zIndex?:number;readOnly?:boolean;focused:boolean;selected:boolean;onFocus:()=>void;onChange:(html:string,height:number)=>void;
  onDrag:(event:ReactPointerEvent,resize?:boolean)=>void;onSize:(height:number)=>void;onPaste:(files:File[])=>void;onNavigate:(id:string)=>void;onDownloadFile:(id:string,name:string)=>void};
export default function EditableBlock({docId,block,opacity=1,zIndex,readOnly,focused,selected,onFocus,onChange,onDrag,onSize,onPaste,onNavigate,onDownloadFile}:Props){
  const ref=useRef<HTMLDivElement>(null);const composing=useRef(false);const callback=useRef(onSize);callback.current=onSize;
  useLayoutEffect(()=>{const el=ref.current;if(!el)return;const html=cleanHTML(block.html);
    if(document.activeElement!==el && el.innerHTML!==html)el.innerHTML=html;
  },[block.html]);
  useOfflineNoteImages(ref,docId,block.html);
  useEffect(()=>{if(focused&&!readOnly)ref.current?.focus({preventScroll:true});},[focused,readOnly]);
  useEffect(()=>{const el=ref.current;if(!el)return;const observer=new ResizeObserver(()=>callback.current(Math.max(140,el.scrollHeight+54)));observer.observe(el);return()=>observer.disconnect();},[]);
  function emit(){if(readOnly)return;const el=ref.current;if(el){flowNoteColumns(el);onChange(cleanHTML(el.innerHTML),Math.max(140,el.scrollHeight+54));}}
  return <section data-note-block={block.id} data-layer-id={block.layerId} className={`note-block ${selected?'selected':''}`} style={{opacity,zIndex,left:block.x,top:block.y,width:block.w,minHeight:140,background:block.background||'#fff'}}>
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
          onDownloadFile(id,localLink.textContent||'attachment');return;
        }
        const anchor=(e.target as Element).closest('a');if(anchor && (e.ctrlKey||e.metaKey)){e.preventDefault();const url=new URL(anchor.href);const id=url.searchParams.get('d');if(url.origin===location.origin&&id)onNavigate(id);else window.open(url.href,'_blank','noopener,noreferrer');}}}
      onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();onPaste(Array.from(e.clipboardData.files));return;}
        e.preventDefault();const html=e.clipboardData.getData('text/html');if(html)document.execCommand('insertHTML',false,cleanHTML(html));else document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));emit();}} />
    <button className="note-resize" title="ドラッグして幅を変更" aria-label="文章ブロックの幅を変更" onPointerDown={e=>onDrag(e,true)}>↔</button>
  </section>;
}
