import {useOfflineNoteImages} from '@/lib/offline-note-images';
import {flowNoteColumns} from '@/lib/rich-note-commands';
import {noteEditorKeyDown,noteCheckboxClick} from '@/lib/rich-editor-dom';
import {linkifyNoteHTML,noteLinkClick} from '@/lib/note-links';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { cleanHTML, fileURL, type NoteBlock } from '@/lib/notes';
import {getLocalImage} from '@/lib/local-docs';

type Props={docId:string;block:NoteBlock;opacity?:number;zIndex?:number;readOnly?:boolean;focused:boolean;selected:boolean;onFocus:()=>void;onChange:(html:string,height:number)=>void;
  onDrag:(event:ReactPointerEvent,resize?:boolean)=>void;onSize:(height:number)=>void;onPaste:(files:File[])=>void;onNavigate:(id:string)=>void;onDownloadFile:(id:string,name:string)=>void};
export default function EditableBlock({docId,block,opacity=1,zIndex,readOnly,focused,selected,onFocus,onChange,onDrag,onSize,onPaste,onNavigate,onDownloadFile}:Props){
  const ref=useRef<HTMLDivElement>(null);const composing=useRef(false),renderedDocument=useRef('');const callback=useRef(onSize);callback.current=onSize;
  useLayoutEffect(()=>{const el=ref.current;if(!el)return;const html=linkifyNoteHTML(cleanHTML(block.html));
    if((renderedDocument.current!==docId||document.activeElement!==el)&&el.innerHTML!==html)el.innerHTML=html;
    renderedDocument.current=docId;
  },[block.html,docId]);
  useOfflineNoteImages(ref,docId,block.html);
  useEffect(()=>{if(focused&&!readOnly)ref.current?.focus({preventScroll:true});},[focused,readOnly]);
  useEffect(()=>{const el=ref.current;if(!el)return;const observer=new ResizeObserver(()=>callback.current(Math.max(140,el.scrollHeight+54)));observer.observe(el);return()=>observer.disconnect();},[]);
  function emit(){if(readOnly)return;const el=ref.current;if(el){flowNoteColumns(el);onChange(cleanHTML(el.innerHTML),Math.max(140,el.scrollHeight+54));}}
  return <section data-note-block={block.id} data-layer-id={block.layerId} className={`note-block ${selected?'selected':''}`} style={{opacity,zIndex,left:block.x,top:block.y,width:block.w,minHeight:140,background:block.background||'#fff'}}>
    <button className="note-block-handle" title="ドラッグして移動" aria-label="文章ブロックを移動" onPointerDown={e=>onDrag(e)}>⠿</button>
    <div ref={ref} className="note-content" contentEditable={!readOnly} suppressContentEditableWarning role="textbox" aria-label="メモ本文" aria-multiline="true" data-placeholder="ここから書き始める…" spellCheck
      onFocus={onFocus} onInput={()=>{if(!composing.current)emit();}} onCompositionStart={()=>{composing.current=true;}}
      onCompositionEnd={()=>{composing.current=false;emit();}} onBlur={e=>{if(!(e.relatedTarget as Element)?.closest?.('.kn-note-link-dialog,.kn-workspace-popup,.notes-toolbar')){const el=ref.current;if(el){const html=linkifyNoteHTML(el.innerHTML);if(el.innerHTML!==html)el.innerHTML=html;}}emit();}}
      onKeyDown={e=>noteEditorKeyDown(e,emit)}
      onClick={e=>{noteCheckboxClick(e,emit);if(!composing.current)noteLinkClick(e,onNavigate,onDownloadFile);}}
      onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();onPaste(Array.from(e.clipboardData.files));return;}
        e.preventDefault();const html=e.clipboardData.getData('text/html');if(html)document.execCommand('insertHTML',false,linkifyNoteHTML(cleanHTML(html)));else {const text=e.clipboardData.getData('text/plain');const el=document.createElement('div');el.textContent=text;document.execCommand('insertHTML',false,linkifyNoteHTML(el.innerHTML.replace(/\n/g,'<br>')));}emit();}} />
    <button className="note-resize" title="ドラッグして幅を変更" aria-label="文章ブロックの幅を変更" onPointerDown={e=>onDrag(e,true)}>↔</button>
  </section>;
}
