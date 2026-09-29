import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PanelLeft, Plus, Search, FileDown, Upload, Paperclip, Type, Pencil, MousePointer2, Hand, Undo2, Redo2, Bold, Italic, List, ListChecks, ImagePlus, Pin, X, Folder, Tag, Settings2, Copy, Trash2, Eraser, ZoomIn, ZoomOut } from 'lucide-react';
import EditableBlock from './note-block';
import { useNotes } from '@/lib/use-notes';
import { api, block, cleanHTML, download, escapeHTML, exportMarkdown, fileURL, id32, plainText, uploadAttachment, type NoteBlock, type NoteDoc, type NoteMeta, type NoteRecord, type Attachment } from '@/lib/notes';
import { readJex, type JexArchive } from '@/lib/jex';
import { importJex } from '@/lib/import-jex';
import type { Point } from '@/lib/canvas';
import '../notes.css';
import { getLocalImage, getLocalDoc } from '@/lib/local-docs';

function LegacyImage({docId,imageId,x,y,w,h}:{docId:string;imageId:string;x:number;y:number;w:number;h:number}) {
  const [url,setURL]=useState('');
  useEffect(()=>{let live=true;let objectURL='';void getLocalImage(imageId).then(blob=>{if(!live)return;
    if(blob){objectURL=URL.createObjectURL(blob);setURL(objectURL);}else if(!imageId.startsWith('local-'))setURL('/canvas/api.php?path='+encodeURIComponent(`/api/documents/${docId}/images/${imageId}`));
  }).catch(()=>{if(live&&!imageId.startsWith('local-'))setURL('/canvas/api.php?path='+encodeURIComponent(`/api/documents/${docId}/images/${imageId}`));});return()=>{live=false;if(objectURL)URL.revokeObjectURL(objectURL);};},[docId,imageId]);
  return url?<image href={url} x={x} y={y} width={w} height={h}/>:null;
}

type Action={kind:'move'|'resize'|'ink'|'pan';id?:string;start:Point;original:NoteDoc;points?:Point[];scroll?:{left:number;top:number};pen?:boolean;blockId?:string};
function storedSidebar(){try{return localStorage.getItem('canvas-notes-sidebar')!=='closed' && innerWidth>760;}catch{return innerWidth>760;}}
export default function NotesWorkspace({accountId}:{accountId:string}){
  const notes=useNotes(accountId);const {record}=notes;
  const [sidebar,setSidebar]=useState(storedSidebar);const [query,setQuery]=useState('');const [category,setCategory]=useState('');const [tag,setTag]=useState('');
  const [tool,setTool]=useState<'text'|'pen'|'select'|'hand'|'eraser'>('text');const [inkColor,setInkColor]=useState('#263443');const [inkWidth,setInkWidth]=useState(3);
  const [selected,setSelected]=useState('');const [focus,setFocus]=useState('');const [settings,setSettings]=useState(false);const [scale,setScale]=useState(1);
  const [archive,setArchive]=useState<JexArchive|null>(null);const [importOpen,setImportOpen]=useState(false);const [importMessage,setImportMessage]=useState('');const [importing,setImporting]=useState(false);
  const [attaching,setAttaching]=useState(false);
  const [draft,setDraft]=useState<Point[]>([]);const [sizes,setSizes]=useState<Record<string,number>>({});
  const scroll=useRef<HTMLDivElement>(null);const plane=useRef<HTMLDivElement>(null);const action=useRef<Action|null>(null);
  const current=useRef(record);current.current=record;const cancelImport=useRef(false);const fileInput=useRef<HTMLInputElement>(null);const jexInput=useRef<HTMLInputElement>(null);const organizationInput=useRef<HTMLInputElement>(null);
  const undoStack=useRef<NoteDoc[]>([]);const redoStack=useRef<NoteDoc[]>([]);const typing=useRef<{id:string;at:number}|null>(null);const [,redraw]=useState(0);const lastPen=useRef(0);const previousId=useRef('');
  const doc=record?.content;const meta=doc?.note||{category:'',tags:[]};
  useEffect(()=>{if(!record)return;const promoted=previousId.current.startsWith('local-')&&!record.id.startsWith('local-');previousId.current=record.id;if(promoted)return;setSelected('');setFocus(record.content.blocks?.[0]?.id||'');setSizes({});undoStack.current=[];redoStack.current=[];typing.current=null;setTool('text');scroll.current?.scrollTo(0,0);},[record?.id]);
  useEffect(()=>{const fit=()=>{if(innerWidth>760)return;const d=current.current?.content;if(!d)return;const b=d.blocks?.[0];if(b){setScale(Math.max(.2,Math.min(1,(scroll.current?.clientWidth||innerWidth)/(b.x+b.w+36))));}};const frame=requestAnimationFrame(fit);addEventListener('resize',fit);return()=>{cancelAnimationFrame(frame);removeEventListener('resize',fit);};},[record?.id]);
  function commit(next:NoteDoc, history=true){if(current.current?.content.note?.importState==='pending')return;const before=current.current?.content;if(!before)return;if(history){undoStack.current=[...undoStack.current.slice(-39),before];redoStack.current=[];}const title=current.current?.title==='新しいメモ' ? (next.blocks||[]).map(b=>plainText(b.html)).join(' ').trim().slice(0,60)||undefined : undefined;notes.change(next,title);redraw(v=>v+1);}
  function updateBlock(id:string,html:string,height:number){const d=current.current?.content;if(!d)return;const b=d.blocks?.find(b=>b.id===id);if(!b||b.html===html)return;
    const newGroup=!typing.current||typing.current.id!==id||Date.now()-typing.current.at>1200;
    typing.current={id,at:Date.now()};commit({...d,blocks:d.blocks?.map(b=>b.id===id?{...b,html,h:height}:b)},newGroup);}
  function undo(){const d=current.current?.content;const previous=undoStack.current.pop();if(!d||!previous)return;redoStack.current.push(d);setFocus('');(document.activeElement as HTMLElement)?.blur();notes.change(previous);redraw(v=>v+1);}
  function redo(){const d=current.current?.content;const next=redoStack.current.pop();if(!d||!next)return;undoStack.current.push(d);setFocus('');(document.activeElement as HTMLElement)?.blur();notes.change(next);redraw(v=>v+1);}
  function toggleSidebar(){setSidebar(old=>{const next=!old;try{localStorage.setItem('canvas-notes-sidebar',next?'open':'closed');}catch{}return next;});}
  function position(e:ReactPointerEvent):Point{const r=plane.current!.getBoundingClientRect();return{x:Math.max(0,(e.clientX-r.left)/scale),y:Math.max(0,(e.clientY-r.top)/scale),p:e.pressure||.5};}
  function addBlock(html='',background?:string){const d=current.current?.content;if(!d)return;const x=80+(scroll.current?.scrollLeft||0)/scale;const y=80+(scroll.current?.scrollTop||0)/scale;
    const b={...block(x,y,html),background};commit({...d,blocks:[...(d.blocks||[]),b]});setSelected(b.id);setFocus(b.id);setTool('text');}
  function drag(e:ReactPointerEvent,id:string,resize=false){e.preventDefault();e.stopPropagation();if(!doc)return;setSelected(id);setFocus('');typing.current=null;
    action.current={kind:resize?'resize':'move',id,start:position(e),original:doc};plane.current?.setPointerCapture(e.pointerId);}
  function down(e:ReactPointerEvent<HTMLDivElement>){if(!doc||notes.busy||importing)return;
    const target=e.target as Element;
    if(target.closest('button'))return;
    if(e.pointerType==='touch'&&Date.now()-lastPen.current<700){e.preventDefault();return;}
    const pen=e.pointerType==='pen';if(pen)lastPen.current=Date.now();
    const effective=pen?(e.button===5||tool==='eraser'?'eraser':'pen'):tool;
    if(e.pointerType==='touch'&&!pen){if(!e.isPrimary)return;action.current={kind:'pan',start:{x:e.clientX,y:e.clientY},original:doc,scroll:{left:scroll.current!.scrollLeft,top:scroll.current!.scrollTop}};return;} // A tap still focuses text; dragging pans the page.
    if(effective==='pen'){
      e.preventDefault();e.stopPropagation();(document.activeElement as HTMLElement)?.blur();setFocus('');typing.current=null;
      action.current={kind:'ink',start:position(e),original:doc,points:[position(e)],pen,blockId:target.closest('[data-note-block]')?.getAttribute('data-note-block')||undefined};e.currentTarget.setPointerCapture(e.pointerId);setDraft([position(e)]);return;
    }
    if(effective==='eraser'){
      e.preventDefault();e.stopPropagation();const id=target.closest('[data-stroke]')?.getAttribute('data-stroke');
      if(id)commit({...doc,items:doc.items.filter(i=>i.id!==id),paintStrokes:doc.paintStrokes?.filter(s=>s.id!==id)});return;
    }
    if(effective==='hand'||e.button===1){e.preventDefault();e.stopPropagation();action.current={kind:'pan',start:{x:e.clientX,y:e.clientY},original:doc,scroll:{left:scroll.current!.scrollLeft,top:scroll.current!.scrollTop}};e.currentTarget.setPointerCapture(e.pointerId);return;}
    if(effective==='select'){
      const id=target.closest('[data-note-block]')?.getAttribute('data-note-block')||target.closest('[data-stroke]')?.getAttribute('data-stroke');
      if(id)drag(e,id);else setSelected('');return;
    }
    if(effective==='text'&&!target.closest('[data-note-block]')){
      e.preventDefault();const p=position(e);const b=block(p.x,p.y);commit({...doc,blocks:[...(doc.blocks||[]),b]});setFocus(b.id);setSelected(b.id);
    }
  }
  function move(e:ReactPointerEvent<HTMLDivElement>){const a=action.current;if(!a)return;e.preventDefault();
    if(a.pen)lastPen.current=Date.now();
    if(a.kind==='pan'){scroll.current!.scrollTo(a.scroll!.left-(e.clientX-a.start.x),a.scroll!.top-(e.clientY-a.start.y));return;}
    const p=position(e);if(a.kind==='ink'){const last=a.points!.at(-1)!;if(Math.hypot(p.x-last.x,p.y-last.y)>.7){a.points!.push(p);setDraft([...a.points!]);}return;}
    const dx=p.x-a.start.x,dy=p.y-a.start.y;
    const next={...a.original,blocks:a.original.blocks?.map(b=>b.id===a.id?a.kind==='resize'?{...b,w:Math.max(220,Math.min(1800,b.w+dx))}:{...b,x:Math.max(0,b.x+dx),y:Math.max(0,b.y+dy)}:b),
      items:a.original.items.map(i=>i.id===a.id?{...i,x:i.x+dx,y:i.y+dy,points:i.points?.map(p=>({...p,x:p.x+dx,y:p.y+dy}))}:i),
      paintStrokes:a.original.paintStrokes?.map(s=>(s.id===a.id || (s.blockId===a.id && a.kind==='move'))?{...s,points:s.points.map(p=>({...p,x:p.x+dx,y:p.y+dy}))}:s)};
    notes.change(next);
  }
  function up(e:ReactPointerEvent<HTMLDivElement>,cancel=false){const a=action.current;if(!a)return;action.current=null;
    if(plane.current?.hasPointerCapture(e.pointerId))plane.current.releasePointerCapture(e.pointerId);
    if(a.kind==='ink'){
      if(!cancel){const points=a.points!;if(points.length===1)points.push({...points[0],x:points[0].x+.2});
        const visible=a.original.layers.find(l=>l.visible&&!l.locked);if(!visible){notes.setError('書き込み可能なレイヤーがありません');setDraft([]);return;}
        commit({...a.original,paintStrokes:[...(a.original.paintStrokes||[]),{id:id32(),layerId:visible.id,points,color:inkColor,width:inkWidth,opacity:1,blockId:a.blockId}]});}
      setDraft([]);if(a.pen)lastPen.current=Date.now();return;
    }
    if(a.kind==='move'||a.kind==='resize'){if(cancel)notes.change(a.original);else{undoStack.current=[...undoStack.current.slice(-39),a.original];redoStack.current=[];redraw(v=>v+1);}}
  }
  function format(command:string,value?:string){typing.current=null;document.execCommand(command,false,value);const el=document.activeElement as HTMLElement;
    const id=el.closest('[data-note-block]')?.getAttribute('data-note-block');if(id)updateBlock(id,el.innerHTML,el.scrollHeight+54);}
  async function attach(files:File[]){const initial=current.current;if(!initial||initial.content.note?.importState==='pending'||attaching)return;setAttaching(true);
    try{await notes.save();const r=current.current;if(!r||r.id.startsWith('local-'))throw new Error('添付にはサーバーへの接続が必要です');
      const targetId=r.id;
      for(const file of files){if(file.size===0||file.size>512*1024*1024)throw new Error('添付は1バイト～512MBです');
        const a:Attachment={id:id32(),name:file.name,mime:file.type||'application/octet-stream',size:file.size};
        await uploadAttachment(targetId,a,file);
        if(current.current?.id!==targetId)throw new Error('元のメモに戻って添付してください');
        const d=current.current.content;const url=fileURL(targetId,a.id);const html=file.type.startsWith('image/')?`<p><img src="${escapeHTML(url)}" alt="${escapeHTML(file.name)}"></p>`:`<p><a href="${escapeHTML(url)}">${escapeHTML(file.name)}</a></p>`;
        const y=Math.max(80,...(d.blocks||[]).map(b=>b.y+(sizes[b.id]||b.h)+30));const b=block(80,y,html);
        commit({...d,blocks:[...(d.blocks||[]),b],attachments:[...(d.attachments||[]),a]});setSelected(b.id);requestAnimationFrame(()=>scroll.current?.scrollTo({top:Math.max(0,(y-40)*scale),behavior:'smooth'}));
      }
    }catch(err){notes.setError(err instanceof Error?err.message:'添付できません');}finally{setAttaching(false);}
  }
  function changeMeta(patch:Partial<NoteMeta>){if(!doc)return;const next={...meta,...patch};
    next.organizationLog=[...(meta.organizationLog||[]).slice(-99),{at:new Date().toISOString(),category:next.category,tags:next.tags}];commit({...doc,note:next});}
  async function loadJex(file:File){setImportMessage('JEXを確認しています…');try{const value=await readJex(file);setArchive(value);setImportMessage('');}catch(err){setImportMessage(String(err));}}
  async function runImport(){if(!archive)return;cancelImport.current=false;setImporting(true);
    try{await notes.save();const existing=await notes.refresh();const result=await importJex(archive,existing,setImportMessage,()=>cancelImport.current);
      setImportMessage(`${result.completed}件を取り込みました。取り込み済み ${result.skipped}件は重複を避けてスキップしました。`);setArchive(null);await notes.refresh();
    }catch(err){setImportMessage(err instanceof Error?err.message:'取り込みに失敗しました');await notes.refresh().catch(()=>{});}finally{setImporting(false);}}
  async function applyOrganization(file:File){try{
    if(file.size>2_000_000)throw new Error('整理ファイルが大きすぎます');
    const payload=JSON.parse(await file.text()) as {version:number;notes:{id:string;category:string;tags:string[];revision:number}[]};
    if(payload.version!==1||!Array.isArray(payload.notes))throw new Error('整理ファイルの形式が不正です');
    const seen=new Set<string>();for(const entry of payload.notes){if(!/^[a-f0-9]{32}$/.test(entry.id)||seen.has(entry.id)||typeof entry.category!=='string'||entry.category.length>200||!Array.isArray(entry.tags)||entry.tags.length>50||entry.tags.some(t=>typeof t!=='string'||t.length>80)||!Number.isInteger(entry.revision))throw new Error('分類・タグ・IDの形式が不正です');seen.add(entry.id);}
    await notes.save();let changed=0;
    for(const entry of payload.notes){const cache=await getLocalDoc(entry.id);if(cache?.accountId===accountId && cache.dirty)throw new Error('未同期のメモがあります。同期してから分類を反映してください');const r=await(await api('/api/documents/'+entry.id)).json() as NoteRecord;if(r.revision!==entry.revision)throw new Error(`更新済みのメモがあるため停止しました（反映済み ${changed}件）。もう一度書き出して整理してください`);
      const old=r.content.note||{category:'',tags:[]};r.content.note={...old,category:entry.category,tags:[...new Set(entry.tags)],organizationLog:[...(old.organizationLog||[]).slice(-99),{at:new Date().toISOString(),category:entry.category,tags:entry.tags}]};
      await api('/api/documents/'+r.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:r.title,revision:r.revision,content:r.content})});changed++;}
    await notes.refresh();if(record)await notes.open(record.id);notes.setError(`分類を${changed}件反映しました`);
  }catch(err){notes.setError(String(err));}}
  async function exportAll(){try{await notes.save();const rows=await notes.refresh();const texts:string[]=[];const entries:{id:string;category:string;tags:string[];revision:number}[]=[];
    for(const n of rows){const cached=await getLocalDoc(n.id);let r:NoteRecord;
      if(cached?.accountId===accountId&&(cached.dirty||!navigator.onLine))r={...cached,content:cached.content as NoteDoc};
      else r=await(await api('/api/documents/'+n.id)).json() as NoteRecord;
      texts.push(exportMarkdown(r));if(!n.id.startsWith('local-'))entries.push({id:r.id,category:r.content.note?.category||'',tags:r.content.note?.tags||[],revision:r.revision});}
    download('Canvas-メモ整理.md',texts.join('\n\n<!-- 次のメモ -->\n\n'));download('Canvas-分類.json',JSON.stringify({version:1,notes:entries},null,2),'application/json');
  }catch(err){notes.setError(String(err));}}
  const categories=[...new Set(notes.list.map(n=>n.note?.category).filter((v):v is string=>!!v))].sort();
  const tags=[...new Set(notes.list.flatMap(n=>n.note?.tags||[]))].sort();
  const filtered=notes.list.filter(n=>(!category||n.note?.category===category)&&(!tag||n.note?.tags?.includes(tag))&&`${n.title} ${n.searchText||''} ${n.note?.category||''} ${(n.note?.tags||[]).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a,b)=>Number(!!b.note?.pinned)-Number(!!a.note?.pinned)||b.updated_at-a.updated_at);
  let width=1800,height=1400;
  for(const b of doc?.blocks||[]){width=Math.max(width,b.x+b.w+160);height=Math.max(height,b.y+(sizes[b.id]||b.h)+300);}
  for(const i of doc?.items||[]){width=Math.max(width,i.x+Math.abs(i.w)+160);height=Math.max(height,i.y+Math.abs(i.h)+300);}
  for(const s of doc?.paintStrokes||[])for(const p of s.points){width=Math.max(width,p.x+160);height=Math.max(height,p.y+300);}
  for(const l of doc?.layers||[])if(l.rasterBounds){const b=l.rasterBounds;width=Math.max(width,b.x+b.w+160);height=Math.max(height,b.y+b.h+300);}
  function stroke(points:Point[]){return points.map(p=>`${p.x},${p.y}`).join(' ');}
  return <main className={`notes-app ${sidebar?'sidebar-open':''}`}>
    <header className="notes-header">
      <button onClick={toggleSidebar} aria-label={sidebar?'メモ一覧を閉じる':'メモ一覧を開く'} aria-expanded={sidebar} title="メモ一覧を開閉"><PanelLeft size={21}/></button>
      <strong className="notes-brand">Canvas <span>Notes</span></strong><span className="notes-header-divider"/>
      <input aria-label="メモのタイトル" placeholder="新しいメモ" value={record?.title||''} maxLength={80} disabled={!record||notes.busy||importing||meta.importState==='pending'} onChange={e=>doc&&notes.change(doc,e.target.value)}/>
      <span className="notes-save-status" role="status">{attaching?'添付を送信中…':notes.status}</span>
      <button onClick={()=>void notes.save()} disabled={!record} title="保存">保存</button>
      <button onClick={()=>setSettings(!settings)} aria-label="メモ設定と書き出し" aria-expanded={settings}><Settings2 size={19}/></button>
    </header>
    <div className="notes-layout">
      {sidebar&&<><button className="notes-sidebar-backdrop" aria-label="メモ一覧を閉じる" onClick={toggleSidebar}/><aside className="notes-sidebar">
        <div className="notes-sidebar-head"><div><small>MY WORKSPACE</small><h1>メモ</h1></div><button className="notes-new" onClick={()=>void notes.create()} disabled={importing||attaching||notes.busy} aria-label="新しいメモ"><Plus size={22}/></button></div>
        <label className="notes-search"><Search size={17}/><input placeholder="メモを検索" aria-label="メモを検索" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button onClick={()=>setQuery('')} aria-label="検索を消す"><X size={14}/></button>}</label>
        <div className="notes-filters"><label><Folder size={15}/><select aria-label="カテゴリで絞り込み" value={category} onChange={e=>setCategory(e.target.value)}><option value="">すべてのカテゴリ</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
          <label><Tag size={15}/><select aria-label="タグで絞り込み" value={tag} onChange={e=>setTag(e.target.value)}><option value="">すべてのタグ</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label></div>
        <div className="notes-count">{filtered.length} 件のメモ</div>
        <div className="notes-list">{filtered.map(n=><button key={n.id} className={`notes-list-item ${n.id===record?.id?'active':''}`} disabled={importing||attaching||notes.busy} onClick={()=>{void notes.open(n.id);if(innerWidth<=760)setSidebar(false);}}>
          <strong>{n.note?.pinned&&<Pin size={13}/>} {n.title||'新しいメモ'}</strong><p>{n.excerpt||'テキストのないメモ'}</p><footer><time>{new Date(n.updated_at).toLocaleDateString('ja-JP',{month:'short',day:'numeric'})}</time><span>{n.note?.category?.split(' / ').at(-1)||'未分類'}</span>{n.note?.importState==='pending'&&<em>取込途中</em>}</footer></button>)}
          {!filtered.length&&<p className="notes-empty">該当するメモはありません</p>}</div>
        <button className="notes-import-button" onClick={()=>setImportOpen(true)}><Upload size={16}/> Joplinから取り込む</button>
      </aside></>}
      <section className="notes-editor">
        <div className={`notes-toolbar ${meta.importState==='pending'?'notes-disabled':''}`} role="toolbar" aria-label="編集ツール">
          <div className="notes-tool-group">{([['text',Type,'文字'],['pen',Pencil,'ペン'],['select',MousePointer2,'選択'],['hand',Hand,'移動'],['eraser',Eraser,'線を消す']] as const).map(([id,Icon,label])=><button key={id} className={tool===id?'active':''} onClick={()=>{setTool(id);if(id==='text')setFocus(selected||doc?.blocks?.[0]?.id||'');}} title={label} aria-label={label}><Icon size={18}/><span>{label}</span></button>)}</div>
          <div className="notes-tool-group"><button onClick={()=>addBlock()} title="文章ブロックを追加" aria-label="文章ブロックを追加"><Plus size={18}/></button><button onClick={()=>addBlock('', '#fff6cc')} title="付箋を追加">付箋</button><button onClick={()=>fileInput.current?.click()} title="画像・ファイルを添付" aria-label="画像・ファイルを添付"><ImagePlus size={18}/></button></div>
          <div className="notes-tool-group"><button onClick={undo} disabled={!undoStack.current.length} aria-label="元に戻す"><Undo2 size={18}/></button><button onClick={redo} disabled={!redoStack.current.length} aria-label="やり直す"><Redo2 size={18}/></button></div>
          <div className="notes-tool-group notes-format" onMouseDown={e=>e.preventDefault()}>
            <button title="太字" aria-label="太字" onClick={()=>format('bold')}><Bold size={17}/></button><button title="斜体" aria-label="斜体" onClick={()=>format('italic')}><Italic size={17}/></button>
            <button title="見出し" onClick={()=>format('formatBlock','h2')}>H2</button><button title="本文" onClick={()=>format('formatBlock','p')}>本文</button>
            <button title="箇条書き" aria-label="箇条書き" onClick={()=>format('insertUnorderedList')}><List size={18}/></button>
            <button title="チェックリスト" aria-label="チェックリスト" onClick={()=>format('insertHTML','<p><input type="checkbox"> やること</p>')}><ListChecks size={18}/></button>
            <button title="文字を大きく" onClick={()=>format('fontSize','5')}>A+</button><button title="文字色を青に" onClick={()=>format('foreColor','#2563eb')}><span style={{color:'#2563eb'}}>A</span></button>
          </div>
        </div>
        <div className="notes-context"><span>{tool==='pen'||tool==='eraser'?<><input aria-label="ペンの色" type="color" value={inkColor} onChange={e=>setInkColor(e.target.value)}/><input aria-label="ペンの太さ" type="range" min="1" max="20" value={inkWidth} onChange={e=>setInkWidth(Number(e.target.value))}/></>:<>文字を入力 · ペンを当てると手書き · つまみでブロックを移動</>}</span>
          {selected&&<div><button title="ブロックを複製" onClick={()=>{const b=doc?.blocks?.find(b=>b.id===selected);if(b&&doc)commit({...doc,blocks:[...(doc.blocks||[]),{...b,id:id32(),x:b.x+35,y:b.y+(sizes[b.id]||b.h)+24}]});}}><Copy size={15}/></button><button title="選択を削除" onClick={()=>{if(doc)commit({...doc,blocks:doc.blocks?.filter(b=>b.id!==selected),items:doc.items.filter(i=>i.id!==selected),paintStrokes:doc.paintStrokes?.filter(s=>s.id!==selected)});setSelected('');}}><Trash2 size={15}/></button></div>}
          <div className="notes-zoom"><button aria-label="縮小" onClick={()=>setScale(s=>Math.max(.2,s-.1))}><ZoomOut size={16}/></button>{Math.round(scale*100)}%<button aria-label="拡大" onClick={()=>setScale(s=>Math.min(2,s+.1))}><ZoomIn size={16}/></button></div>
        </div>
        {meta.importState==='pending'&&<div className="notes-warning">取り込み途中のメモです。同じJEXを選んで取り込みを再開してください。</div>}
        {notes.conflict&&<div className="notes-warning">他端末の更新と競合しています。今の内容は端末に保持しています。<button onClick={()=>void notes.recover()}>今の内容を別メモに保存</button></div>}
        {notes.error&&<div className="notes-warning" role="alert">{notes.error}<button onClick={()=>notes.setError('')} aria-label="通知を閉じる"><X size={15}/></button></div>}
        <div ref={scroll} className="notes-scroll" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void attach(Array.from(e.dataTransfer.files));}}>
          {!record?<div className="notes-welcome"><h2>メモを準備しています</h2><p>文章も、手書きも、ここに。</p><button onClick={()=>void notes.create()}>新しいメモを作る</button></div>:<div style={{width:width*scale,height:height*scale}}>
            <div ref={plane} className={`notes-plane tool-${tool}`} style={{width,height,transform:`scale(${scale})`,pointerEvents:notes.busy||importing||meta.importState==='pending'?'none':undefined}}
              onPointerDownCapture={down} onPointerMove={move} onPointerUp={e=>up(e)} onPointerCancel={e=>up(e,true)}>
              <svg className="notes-ink" width={width} height={height}>
                {doc?.layers.filter(l=>l.visible&&l.rasterImageId&&l.rasterBounds).map(l=><LegacyImage key={l.id} docId={record.id} imageId={l.rasterImageId!} {...l.rasterBounds!}/>)}
                {doc?.items.filter(i=>doc.layers.find(l=>l.id===i.layerId)?.visible!==false).map(i=><g key={i.id} data-stroke={i.id} stroke={i.color} strokeWidth={i.width} opacity={i.opacity??1} fill={i.fill||'none'}>
                  {i.kind==='path'?<polyline points={stroke(i.points||[])} fill="none" strokeLinecap="round"/>:i.kind==='rect'?<rect x={i.x} y={i.y} width={Math.abs(i.w)} height={Math.abs(i.h)}/>:i.kind==='ellipse'?<ellipse cx={i.x+i.w/2} cy={i.y+i.h/2} rx={Math.abs(i.w/2)} ry={Math.abs(i.h/2)}/>:i.kind==='line'?<line x1={i.x} y1={i.y} x2={i.x+i.w} y2={i.y+i.h}/>:i.kind==='image'&&i.imageId?<LegacyImage docId={record.id} imageId={i.imageId} x={i.x} y={i.y} w={i.w} h={i.h}/>:null}
                </g>)}
                {doc?.paintStrokes?.filter(s=>doc.layers.find(l=>l.id===s.layerId)?.visible!==false).map(s=><polyline key={s.id} data-stroke={s.id} points={stroke(s.points)} stroke={s.color} strokeWidth={s.width} opacity={s.opacity} strokeLinecap="round" strokeLinejoin="round" fill="none"/>)}
                {draft.length>0&&<polyline points={stroke(draft)} stroke={inkColor} strokeWidth={inkWidth} strokeLinecap="round" fill="none" pointerEvents="none"/>}
              </svg>
              {doc?.blocks?.map(b=><EditableBlock key={b.id} block={b} selected={selected===b.id} focused={focus===b.id} onFocus={()=>{setSelected(b.id);setFocus(b.id);}}
                onChange={(html,h)=>updateBlock(b.id,html,h)} onDrag={(e,resize)=>drag(e,b.id,resize)} onSize={h=>setSizes(old=>old[b.id]===h?old:{...old,[b.id]:h})}
                onPaste={files=>void attach(files)} onNavigate={id=>void notes.open(id)}/>)}
            </div>
          </div>}
        </div>
        {!!doc?.attachments?.length&&<div className="notes-attachments"><Paperclip size={15}/>{doc.attachments.map(a=><a key={a.id} href={fileURL(record!.id,a.id)} target="_blank" rel="noreferrer">{a.name} <small>{(a.size/1024/1024).toFixed(1)}MB</small></a>)}</div>}
      </section>
      {settings&&<aside className="notes-settings"><div className="notes-settings-title"><h2>メモの整理</h2><button onClick={()=>setSettings(false)} aria-label="設定を閉じる"><X size={18}/></button></div>
        <label>カテゴリ<input value={meta.category} maxLength={200} onChange={e=>changeMeta({category:e.target.value})} list="note-categories"/></label><datalist id="note-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
        <label>タグ（カンマ区切り）<input key={record?.id} defaultValue={meta.tags.join(', ')} onBlur={e=>changeMeta({tags:[...new Set(e.target.value.split(/[,、]/).map(t=>t.trim()).filter(Boolean))].slice(0,50)})}/></label>
        <button onClick={()=>changeMeta({pinned:!meta.pinned})}><Pin size={16}/>{meta.pinned?'ピン留めを解除':'一覧の上にピン留め'}</button>
        {meta.isTodo&&<label className="notes-todo"><input type="checkbox" checked={!!meta.completed} onChange={e=>changeMeta({completed:e.target.checked})}/>このToDoを完了</label>}
        <hr/><button onClick={()=>record&&download(record.title+'.md',exportMarkdown(record))}><FileDown size={16}/>このメモをMDに書き出す</button>
        <button onClick={()=>record&&download(record.title+'.txt',(doc?.blocks||[]).map(b=>{const el=document.createElement('div');el.innerHTML=cleanHTML(b.html);return el.innerText;}).join('\n\n'),'text/plain')}>テキストで書き出す</button>
        <button onClick={()=>void exportAll()}><FileDown size={16}/>全メモを整理用に書き出す</button>
        <p>書き出したMDと分類ファイルをChatGPTに渡して「整理して」と依頼できます。整理後の分類ファイルを読み込むと、カテゴリとタグを反映します。</p>
        <button onClick={()=>organizationInput.current?.click()}><Upload size={16}/>整理した分類を読み込む</button>
        <button onClick={()=>{setImportOpen(true);setSettings(false);}}><Upload size={16}/>JoplinのJEXを取り込む</button>
        {meta.sourceNotebook&&<p>元のノートブック<br/>{meta.sourceNotebook}</p>}
      </aside>}
    </div>
    <input ref={fileInput} hidden type="file" multiple onChange={e=>{void attach(Array.from(e.target.files||[]));e.target.value='';}}/>
    <input ref={organizationInput} hidden type="file" accept=".json" onChange={e=>{if(e.target.files?.[0])void applyOrganization(e.target.files[0]);e.target.value='';}}/>
    {importOpen&&<div className="notes-modal"><section role="dialog" aria-modal="true" aria-labelledby="jex-title"><div className="notes-settings-title"><h2 id="jex-title">Joplinから取り込む</h2><button disabled={importing} onClick={()=>setImportOpen(false)} aria-label="取り込み画面を閉じる"><X size={20}/></button></div>
      <p>JEXを選ぶと、メモ・ノートブック・タグ・画像・添付ファイルをまとめて取り込めます。</p>
      <button disabled={importing} className="notes-file-pick" onClick={()=>jexInput.current?.click()}><Upload size={24}/>JEXファイルを選択</button>
      <input hidden ref={jexInput} type="file" accept=".jex" onChange={e=>{if(e.target.files?.[0])void loadJex(e.target.files[0]);e.target.value='';}}/>
      {archive&&<><div className="notes-import-counts"><strong>{archive.notes.length}<span>メモ</span></strong><strong>{archive.notebooks.length}<span>ノートブック</span></strong><strong>{archive.resources.length}<span>添付</span></strong></div>
        <p>元の本文・分類も保持します。同じメモの再取り込みはスキップし、途中で止まった分は再開します。</p><button className="notes-primary" disabled={importing} onClick={()=>void runImport()}>取り込みを開始</button></>}
      <p role="status">{importMessage}</p>{importing&&<button onClick={()=>{cancelImport.current=true;setImportMessage('現在の添付を保存後に中断します…');}}>中断</button>}
    </section></div>}
  </main>;
}
