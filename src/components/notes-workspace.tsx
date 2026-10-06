import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PanelLeft, Plus, Search, FileDown, Upload, Paperclip, Type, Pencil, MousePointer2, Hand, Undo2, Redo2, Bold, Italic, List, ListChecks, ImagePlus, Pin, X, Folder, Tag, Settings2, Copy, Trash2, Eraser, ZoomIn, ZoomOut } from 'lucide-react';
import EditableBlock from './note-block';
import {CategoryTree,CategoryManager,type CategoryOperation} from './note-categories';
import {categoryPath,categoryPaths,inCategory,movedCategory,matchesSearch,searchExcerpt} from '@/lib/note-organization';
import { useNotes } from '@/lib/use-notes';
import { api, blankNote, block, cleanHTML, download, escapeHTML, exportMarkdown, fileURL, id32, plainText, uploadAttachment, type NoteBlock, type NoteDoc, type NoteMeta, type NoteRecord, type Attachment } from '@/lib/notes';
import { readJex, type JexArchive } from '@/lib/jex';
import { importJex } from '@/lib/import-jex';
import type { Point, Item } from '@/lib/canvas';
import { ChartsLayer, FixedNoteLayer, LayerPanel, SpreadsheetLayer, type CellRange, type ChartItem, type SheetData, type StudioNoteDoc } from './note-studio-layers';
import '../notes.css';
import { getLocalImage, getLocalDoc } from '@/lib/local-docs';

function LegacyImage({docId,imageId,x,y,w,h}:{docId:string;imageId:string;x:number;y:number;w:number;h:number}) {
  const [url,setURL]=useState('');
  useEffect(()=>{let live=true;let objectURL='';void getLocalImage(imageId).then(blob=>{if(!live)return;
    if(blob){objectURL=URL.createObjectURL(blob);setURL(objectURL);}else if(!imageId.startsWith('local-'))setURL('/canvas/api.php?path='+encodeURIComponent(`/api/documents/${docId}/images/${imageId}`));
  }).catch(()=>{if(live&&!imageId.startsWith('local-'))setURL('/canvas/api.php?path='+encodeURIComponent(`/api/documents/${docId}/images/${imageId}`));});return()=>{live=false;if(objectURL)URL.revokeObjectURL(objectURL);};},[docId,imageId]);
  return url?<image href={url} x={x} y={y} width={w} height={h}/>:null;
}

type Action={pointerId:number;verticalOnly?:boolean;kind:'move'|'resize'|'ink'|'pan'|'shape';id?:string;start:Point;original:NoteDoc;points?:Point[];scroll?:{left:number;top:number};pen?:boolean;blockId?:string;shapeKind?:'line'|'rect'|'ellipse'};
function storedSidebar(){try{return localStorage.getItem('canvas-notes-sidebar')!=='closed' && innerWidth>760;}catch{return innerWidth>760;}}
export default function NotesWorkspace({accountId}:{accountId:string}){
  const notes=useNotes(accountId);const {record}=notes;
  const [sidebar,setSidebar]=useState(storedSidebar);const [query,setQuery]=useState('');const [category,setCategory]=useState('');const [tag,setTag]=useState('');
  const [tool,setTool]=useState<'note'|'text'|'pen'|'select'|'magic'|'hand'|'eraser'|'line'|'rect'|'ellipse'|'sheet'>('note');const [inkColor,setInkColor]=useState('#263443');const [inkWidth,setInkWidth]=useState(3);const [brush,setBrush]=useState<'pen'|'gpen'|'marker'>('gpen');
  const [activeLayer,setActiveLayer]=useState('');const [layersOpen,setLayersOpen]=useState(true);const [sheetSelection,setSheetSelection]=useState<CellRange|undefined>();const [chartOpen,setChartOpen]=useState(false);const [chartType,setChartType]=useState<ChartItem['type']>('bar');const [chartLayer,setChartLayer]=useState('');const [draftShape,setDraftShape]=useState<Item|null>(null);
  const [selected,setSelected]=useState('');const [focus,setFocus]=useState('');const [settings,setSettings]=useState(false);const [scale,setScale]=useState(1);
  const [archive,setArchive]=useState<JexArchive|null>(null);const [importOpen,setImportOpen]=useState(false);const [importMessage,setImportMessage]=useState('');const [importing,setImporting]=useState(false);
  const [attaching,setAttaching]=useState(false);
  const [trash,setTrash]=useState(false);const [searchScope,setSearchScope]=useState<'all'|'filtered'>('all');
  const [categoryManager,setCategoryManager]=useState(false);const [organizing,setOrganizing]=useState(false);
  const [workspace,setWorkspace]=useState<{categories:string[];revision:number}|null>(null);
  const searchInput=useRef<HTMLInputElement>(null);const scaleRef=useRef(scale);scaleRef.current=scale;
  const [deleteOpen,setDeleteOpen]=useState(false);
  useEffect(()=>{void api('/api/note-workspace').then(r=>r.json()).then(setWorkspace).catch(()=>{});},[]);
  const [draft,setDraft]=useState<Point[]>([]);const [sizes,setSizes]=useState<Record<string,number>>({});
  const scroll=useRef<HTMLDivElement>(null);const plane=useRef<HTMLDivElement>(null);const action=useRef<Action|null>(null);
  const fittedViewport=useRef({id:'',width:0});const extent=useRef({id:'',width:1800,height:1400});const suppressClick=useRef(false);
  const current=useRef(record);current.current=record;const cancelImport=useRef(false);const fileInput=useRef<HTMLInputElement>(null);const imageInput=useRef<HTMLInputElement>(null);const jexInput=useRef<HTMLInputElement>(null);const organizationInput=useRef<HTMLInputElement>(null);
  const undoStack=useRef<NoteDoc[]>([]);const redoStack=useRef<NoteDoc[]>([]);const typing=useRef<{id:string;at:number}|null>(null);const [,redraw]=useState(0);const lastPen=useRef(0);const previousId=useRef('');
  const doc=record?.content;const studio=doc as StudioNoteDoc|undefined;const meta=doc?.note||{category:'',tags:[]};
  const fixedNote=studio?.fixedNote||{html:'',visible:true,locked:false};const sheet=studio?.sheet||{visible:false,locked:false,rows:20,cols:10,cells:{}};const charts=studio?.charts||[];
  useEffect(()=>{if(!record)return;const promoted=previousId.current.startsWith('local-')&&!record.id.startsWith('local-');previousId.current=record.id;if(promoted)return;setSelected('');setFocus('');setSizes({});undoStack.current=[];redoStack.current=[];typing.current=null;setTool('note');setSheetSelection(undefined);setActiveLayer(record.content.layers.find(l=>l.visible&&!l.locked)?.id||record.content.layers[0]?.id||'');scroll.current?.scrollTo(0,0);},[record?.id]);
  useEffect(()=>{const fit=()=>{
    const d=current.current;if(!d)return;const viewportWidth=scroll.current?.clientWidth||innerWidth;
    const previous=fittedViewport.current;const promoted=previous.id.startsWith('local-')&&!d.id.startsWith('local-');
    const changedDocument=previous.id!==d.id&&!promoted;const changedWidth=Math.abs(previous.width-viewportWidth)>1;
    fittedViewport.current={id:d.id,width:viewportWidth};
    // A keyboard or browser address bar changes height, not the document's zoom.
    if(innerWidth>760||(!changedDocument&&!changedWidth)||action.current)return;
    const b=d.content.blocks?.[0];if(b){const next=Math.max(.2,Math.min(1,viewportWidth/(b.x+b.w+36)));scaleRef.current=next;setScale(next);}
  };const frame=requestAnimationFrame(fit);addEventListener('resize',fit);return()=>{cancelAnimationFrame(frame);removeEventListener('resize',fit);};},[record?.id]);
  function commit(next:NoteDoc, history=true){if(organizing||current.current?.content.note?.trashedAt||current.current?.content.note?.importState==='pending')return;const before=current.current?.content;if(!before)return;if(history){undoStack.current=[...undoStack.current.slice(-39),before];redoStack.current=[];}const title=current.current?.title==='新しいメモ' ? (next.blocks||[]).map(b=>plainText(b.html)).join(' ').trim().slice(0,60)||undefined : undefined;notes.change(next,title);redraw(v=>v+1);}
  function updateBlock(id:string,html:string,height:number){const d=current.current?.content;if(!d)return;const b=d.blocks?.find(b=>b.id===id);if(!b||b.html===html)return;
    const newGroup=!typing.current||typing.current.id!==id||Date.now()-typing.current.at>1200;
    typing.current={id,at:Date.now()};commit({...d,blocks:d.blocks?.map(b=>b.id===id?{...b,html,h:height}:b)},newGroup);}
  function undo(){if(organizing||meta.trashedAt)return;const d=current.current?.content;const previous=undoStack.current.pop();if(!d||!previous)return;redoStack.current.push(d);setFocus('');(document.activeElement as HTMLElement)?.blur();notes.change(previous);redraw(v=>v+1);}
  function redo(){if(organizing||meta.trashedAt)return;const d=current.current?.content;const next=redoStack.current.pop();if(!d||!next)return;undoStack.current.push(d);setFocus('');(document.activeElement as HTMLElement)?.blur();notes.change(next);redraw(v=>v+1);}
  function toggleSidebar(){setSidebar(old=>{const next=!old;try{localStorage.setItem('canvas-notes-sidebar',next?'open':'closed');}catch{}return next;});}
  function position(e:ReactPointerEvent):Point{const r=plane.current!.getBoundingClientRect();return{x:Math.max(0,(e.clientX-r.left)/scale),y:Math.max(0,(e.clientY-r.top)/scale),p:e.pressure||.5};}
  function addBlock(html='',background?:string){const d=current.current?.content;if(!d)return;const x=80+(scroll.current?.scrollLeft||0)/scale;const y=80+(scroll.current?.scrollTop||0)/scale;
    const b={...block(x,y,html),background};commit({...d,blocks:[...(d.blocks||[]),b]});setSelected(b.id);setFocus(b.id);setTool('text');}
  function writableLayer(d:NoteDoc){return d.layers.find(l=>l.id===activeLayer&&l.visible&&!l.locked)||d.layers.find(l=>l.visible&&!l.locked);}
  function updateFixedNote(html:string){const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return;const state=d.fixedNote||{html:'',visible:true,locked:false};commit({...d,fixedNote:{...state,html}} as NoteDoc,false);}
  function updateSheet(next:SheetData){const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return;commit({...d,sheet:next} as NoteDoc,false);}
  function useNoteLayer(){setFocus('');setTool('note');(document.activeElement as HTMLElement)?.blur();}
  function useSheetLayer(){const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return;const state=d.sheet||{visible:false,locked:false,rows:20,cols:10,cells:{}};if(!state.visible)commit({...d,sheet:{...state,visible:true}} as NoteDoc);setFocus('');setTool('sheet');(document.activeElement as HTMLElement)?.blur();}
  async function placeImages(files:File[]){if(!files.length||attaching||organizing)return;setAttaching(true);
    try{await notes.save();const r=current.current;if(!r||r.id.startsWith('local-'))throw new Error('画像配置にはサーバーへの接続が必要です');let working=r.content as StudioNoteDoc;
      const layer=writableLayer(working);if(!layer)throw new Error('画像を置ける描画レイヤーがありません');
      let x=100+(scroll.current?.scrollLeft||0)/scale,y=100+(scroll.current?.scrollTop||0)/scale;
      for(const file of files){if(!file.type.startsWith('image/'))continue;if(file.size===0||file.size>512*1024*1024)throw new Error('画像は1バイト～512MBです');
        const a:Attachment={id:id32(),name:file.name,mime:file.type||'image/*',size:file.size};await uploadAttachment(r.id,a,file);
        let w=640,h=420;const url=URL.createObjectURL(file);try{const dims=await new Promise<{w:number;h:number}>(resolve=>{const image=new Image();image.onload=()=>resolve({w:image.naturalWidth||640,h:image.naturalHeight||420});image.onerror=()=>resolve({w:640,h:420});image.src=url;});const ratio=Math.min(1,720/Math.max(1,dims.w),520/Math.max(1,dims.h));w=Math.max(80,Math.round(dims.w*ratio));h=Math.max(60,Math.round(dims.h*ratio));}finally{URL.revokeObjectURL(url);}
        const item:Item={id:id32(),kind:'image',layerId:layer.id,x,y,w,h,color:'#000000',width:1,opacity:1,imageId:'file:'+a.id};working={...working,items:[...working.items,item],attachments:[...(working.attachments||[]),a]};x+=36;y+=36;
      }
      commit(working as NoteDoc);setSelected(working.items.at(-1)?.id||'');setTool('select');
    }catch(err){notes.setError(err instanceof Error?err.message:'画像を配置できません');}finally{setAttaching(false);}
  }
  function createChart(){const d=current.current?.content as StudioNoteDoc|undefined;if(!d||!sheetSelection)return;const layer=d.layers.find(l=>l.id===(chartLayer||activeLayer)&&l.visible&&!l.locked)||d.layers.find(l=>l.visible&&!l.locked);if(!layer){notes.setError('グラフを置ける描画レイヤーがありません');return;}
    const range=sheetSelection.start+(sheetSelection.end!==sheetSelection.start?':'+sheetSelection.end:'');const chart:ChartItem={id:id32(),layerId:layer.id,x:120+(scroll.current?.scrollLeft||0)/scale,y:120+(scroll.current?.scrollTop||0)/scale,w:520,h:310,type:chartType,range};commit({...d,charts:[...(d.charts||[]),chart]} as NoteDoc);setActiveLayer(layer.id);setSelected(chart.id);setChartOpen(false);setTool('select');}
  function drag(e:ReactPointerEvent,id:string,resize=false){e.preventDefault();e.stopPropagation();if(!doc||action.current||(!e.isPrimary&&e.pointerType==='touch'))return;setSelected(id);setFocus('');typing.current=null;
    action.current={pointerId:e.pointerId,kind:resize?'resize':'move',id,start:position(e),original:doc};plane.current?.setPointerCapture(e.pointerId);}
  function down(e:ReactPointerEvent<HTMLDivElement>){if(!doc||notes.busy||importing||organizing||meta.trashedAt)return;
    if(action.current||(!e.isPrimary&&e.pointerType==='touch')){e.preventDefault();return;}
    suppressClick.current=false;
    const target=e.target as Element;
    if(target.closest('button'))return;
    if(e.pointerType==='touch'&&Date.now()-lastPen.current<700){e.preventDefault();return;}
    const pen=e.pointerType==='pen';if(pen)lastPen.current=Date.now();
    const effective=pen?(e.button===5||tool==='eraser'?'eraser':'pen'):tool;
    if(e.pointerType==='touch'&&(effective==='text'||effective==='hand')){
      if(effective==='hand'){e.preventDefault();e.stopPropagation();}
      action.current={pointerId:e.pointerId,kind:'pan',verticalOnly:effective==='text',start:{x:e.clientX,y:e.clientY},original:doc,scroll:{left:scroll.current!.scrollLeft,top:scroll.current!.scrollTop}};
      if(effective==='hand')e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(effective==='pen'){
      e.preventDefault();e.stopPropagation();(document.activeElement as HTMLElement)?.blur();setFocus('');typing.current=null;
      action.current={pointerId:e.pointerId,kind:'ink',start:position(e),original:doc,points:[position(e)],pen,blockId:target.closest('[data-note-block]')?.getAttribute('data-note-block')||undefined};e.currentTarget.setPointerCapture(e.pointerId);setDraft([position(e)]);return;
    }
    if(effective==='eraser'){
      e.preventDefault();e.stopPropagation();const id=target.closest('[data-stroke]')?.getAttribute('data-stroke');
      if(id)commit({...doc,items:doc.items.filter(i=>i.id!==id),paintStrokes:doc.paintStrokes?.filter(s=>s.id!==id)});return;
    }
    if(effective==='hand'||e.button===1){e.preventDefault();e.stopPropagation();action.current={pointerId:e.pointerId,kind:'pan',start:{x:e.clientX,y:e.clientY},original:doc,scroll:{left:scroll.current!.scrollLeft,top:scroll.current!.scrollTop}};e.currentTarget.setPointerCapture(e.pointerId);return;}
    if(effective==='select'){
      const id=target.closest('[data-note-block]')?.getAttribute('data-note-block')||target.closest('[data-stroke]')?.getAttribute('data-stroke');
      if(id)drag(e,id);else setSelected('');return;
    }
    if(effective==='text'&&!target.closest('[data-note-block]')){
      e.preventDefault();const p=position(e);const b=block(p.x,p.y);commit({...doc,blocks:[...(doc.blocks||[]),b]});setFocus(b.id);setSelected(b.id);
    }
  }
  function move(e:ReactPointerEvent<HTMLDivElement>){const a=action.current;if(!a||a.pointerId!==e.pointerId)return;e.preventDefault();
    if(a.pen)lastPen.current=Date.now();
    if(a.kind==='pan'){const dx=e.clientX-a.start.x,dy=e.clientY-a.start.y;if(Math.hypot(dx,dy)<6)return;suppressClick.current=true;scroll.current!.scrollTo(a.scroll!.left-(a.verticalOnly?0:dx),a.scroll!.top-dy);return;}
    const p=position(e);if(a.kind==='ink'){const last=a.points!.at(-1)!;if(Math.hypot(p.x-last.x,p.y-last.y)>.7){a.points!.push(p);setDraft([...a.points!]);}return;}
    const dx=p.x-a.start.x,dy=p.y-a.start.y;
    const next={...a.original,blocks:a.original.blocks?.map(b=>b.id===a.id?a.kind==='resize'?{...b,w:Math.max(220,Math.min(1800,b.w+dx))}:{...b,x:Math.max(0,b.x+dx),y:Math.max(0,b.y+dy)}:b),
      items:a.original.items.map(i=>i.id===a.id?{...i,x:i.x+dx,y:i.y+dy,points:i.points?.map(p=>({...p,x:p.x+dx,y:p.y+dy}))}:i),
      paintStrokes:a.original.paintStrokes?.map(s=>(s.id===a.id || (s.blockId===a.id && a.kind==='move'))?{...s,points:s.points.map(p=>({...p,x:p.x+dx,y:p.y+dy}))}:s)};
    notes.change(next);
  }
  function up(e:ReactPointerEvent<HTMLDivElement>,cancel=false){const a=action.current;if(!a||a.pointerId!==e.pointerId)return;action.current=null;
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
  async function attach(files:File[]){const initial=current.current;if(!initial||initial.content.note?.importState==='pending'||initial.content.note?.trashedAt||organizing||attaching)return;setAttaching(true);
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
  function changeMeta(patch:Partial<NoteMeta>){if(!doc||meta.trashedAt||organizing)return;const next={...meta,...patch};
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
    for(const n of rows.filter(n=>!n.note?.trashedAt)){const cached=await getLocalDoc(n.id);let r:NoteRecord;
      if(cached?.accountId===accountId&&(cached.dirty||!navigator.onLine))r={...cached,content:cached.content as NoteDoc};
      else r=await(await api('/api/documents/'+n.id)).json() as NoteRecord;
      texts.push(exportMarkdown(r));if(!n.id.startsWith('local-'))entries.push({id:r.id,category:r.content.note?.category||'',tags:r.content.note?.tags||[],revision:r.revision});}
    download('Canvas-メモ整理.md',texts.join('\n\n<!-- 次のメモ -->\n\n'));download('Canvas-分類.json',JSON.stringify({version:1,notes:entries},null,2),'application/json');
  }catch(err){notes.setError(String(err));}}
  const categories=categoryPaths([...(workspace?.categories||[]),...notes.list.map(n=>n.note?.category||'')]);
  const tags=[...new Set(notes.list.filter(n=>!n.note?.trashedAt).flatMap(n=>n.note?.tags||[]))].sort();
  const searching=query.trim().length>0;
  const filtered=notes.list.filter(n=>Boolean(n.note?.trashedAt)===trash &&
    ((searching&&searchScope==='all')||((!category||inCategory(n.note?.category||'',category))&&(!tag||n.note?.tags?.includes(tag)))) &&
    matchesSearch(`${n.title} ${n.searchText||''} ${n.note?.category||''} ${(n.note?.tags||[]).join(' ')}`,query))
    .sort((a,b)=>Number(!!b.note?.pinned)-Number(!!a.note?.pinned)||b.updated_at-a.updated_at);
  function navigateCategory(path:string){setCategory(path);setTrash(false);setQuery('');}
  async function createNote(){setTrash(false);setQuery('');setTag('');const next=notesNew();await notes.create(next);}
  function notesNew(){const next=blankNote();next.note={category,tags:[]};return next;}
  function setTrashed(value:boolean){if(!doc||organizing||attaching||importing||notes.busy)return;
    (document.activeElement as HTMLElement)?.blur();
    const latest=current.current?.content;if(!latest)return;
    notes.change({...latest,note:{category:'',tags:[],...latest.note,trashedAt:value?new Date().toISOString():undefined}});
    setDeleteOpen(false);setFocus('');undoStack.current=[];redoStack.current=[];
  }
  async function organize(op:CategoryOperation){
    setOrganizing(true);try{
      await notes.flushAll();
      const ws=await(await api('/api/note-workspace')).json() as {categories:string[];revision:number};
      const rows=await notes.refresh(true);const paths=categoryPaths([...ws.categories,...rows.map(n=>n.note?.category||'')]);
      let next=paths;const updates:{id:string;revision:number;category:string;tags:string[]}[]=[];
      if(op.kind==='create'){if(paths.includes(op.target))throw new Error('カテゴリが既にあります');next=categoryPaths([...paths,op.target]);}
      else {
        if(!paths.includes(op.source))throw new Error('カテゴリが変更されています。再読み込みしてください');
        if(op.kind==='move'&&(paths.includes(op.target)||inCategory(op.target,op.source)))throw new Error('移動先が重複しているか、子カテゴリ内です');
        next=op.kind==='move'?categoryPaths(paths.map(p=>movedCategory(p,op.source,op.target))):op.remove?paths.filter(p=>!inCategory(p,op.source)):paths;
        for(const n of rows.filter(n=>inCategory(n.note?.category||'',op.source))){
          if(n.id.startsWith('local-'))throw new Error('メモの同期が終わってから操作してください');
          const nextTags=op.kind==='tag'?[...new Set([...(n.note?.tags||[]),op.target])]:n.note?.tags||[];
          if(nextTags.length>50)throw new Error('タグが50個を超えるメモがあります');
          updates.push({id:n.id,revision:n.revision,category:op.kind==='move'?movedCategory(n.note?.category||'',op.source,op.target):op.remove?'':n.note?.category||'',tags:nextTags});
        }
      }
      if(next.some(p=>p.length>200))throw new Error('移動後の子カテゴリが200文字を超えます');
      const result=await(await api('/api/note-workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:ws.revision,categories:next,updates})})).json();
      setWorkspace({categories:result.categories,revision:result.revision});await notes.acceptMetadata(result.changed);
      setCategory(op.kind==='tag'?'':op.target);if(op.kind==='tag')setTag(op.target);setQuery('');
    }finally{setOrganizing(false);}
  }
  function zoomTo(value:number,anchor?:{x:number;y:number}){
    const el=scroll.current;if(!el||action.current)return;const previous=scaleRef.current;const next=Math.max(.2,Math.min(4,Math.round(value*100)/100));
    const x=anchor?.x??el.clientWidth/2,y=anchor?.y??el.clientHeight/2;const left=(el.scrollLeft+x)/previous*next-x,top=(el.scrollTop+y)/previous*next-y;
    scaleRef.current=next;setScale(next);requestAnimationFrame(()=>el.scrollTo(Math.max(0,left),Math.max(0,top)));
  }
  function fitContent(){const el=scroll.current;const d=current.current?.content;if(!el||!d)return;
    const boxes=[...(d.blocks||[]).map(b=>({...b,h:sizes[b.id]||b.h})),...d.items,...d.layers.flatMap(l=>l.rasterBounds?[l.rasterBounds]:[])];
    let left=Infinity,top=Infinity,right=0,bottom=0;
    for(const b of boxes){left=Math.min(left,b.x,b.x+b.w);top=Math.min(top,b.y,b.y+b.h);right=Math.max(right,b.x,b.x+b.w);bottom=Math.max(bottom,b.y,b.y+b.h);}
    for(const s of d.paintStrokes||[])for(const p of s.points){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
    if(!Number.isFinite(left)){zoomTo(1);return;}
    const next=Math.max(.2,Math.min(2,(el.clientWidth-48)/Math.max(1,right-left),(el.clientHeight-48)/Math.max(1,bottom-top)));
    scaleRef.current=next;setScale(next);requestAnimationFrame(()=>el.scrollTo(Math.max(0,left*next-24),Math.max(0,top*next-24)));
  }
  useEffect(()=>{const el=scroll.current;if(!el)return;const wheel=(e:WheelEvent)=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const r=el.getBoundingClientRect();zoomTo(scaleRef.current*Math.exp(-e.deltaY*.005),{x:e.clientX-r.left,y:e.clientY-r.top});};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='f'){e.preventDefault();setSidebar(true);setSearchScope('all');requestAnimationFrame(()=>searchInput.current?.focus());}};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[]);
  let width=1800,height=1400;
  for(const b of doc?.blocks||[]){width=Math.max(width,b.x+b.w+160);height=Math.max(height,b.y+(sizes[b.id]||b.h)+300);}
  for(const i of doc?.items||[]){width=Math.max(width,i.x+Math.abs(i.w)+160);height=Math.max(height,i.y+Math.abs(i.h)+300);}
  for(const s of doc?.paintStrokes||[])for(const p of s.points){width=Math.max(width,p.x+160);height=Math.max(height,p.y+300);}
  for(const l of doc?.layers||[])if(l.rasterBounds){const b=l.rasterBounds;width=Math.max(width,b.x+b.w+160);height=Math.max(height,b.y+b.h+300);}
  // Grow the scroll surface in steps; measuring text or erasing must not shrink it under the finger.
  const extentId=record?.id||'';const promotedExtent=extent.current.id.startsWith('local-')&&!extentId.startsWith('local-');
  if(extent.current.id!==extentId&&!promotedExtent)extent.current={id:extentId,width:1800,height:1400};
  extent.current={id:extentId,width:Math.max(extent.current.width,Math.ceil(width/256)*256),height:Math.max(extent.current.height,Math.ceil(height/256)*256)};
  width=extent.current.width;height=extent.current.height;
  function stroke(points:Point[]){return points.map(p=>`${p.x},${p.y}`).join(' ');}
  return <main className={`notes-app ${sidebar?'sidebar-open':''}`}>
    <header className="notes-header">
      <button onClick={toggleSidebar} aria-label={sidebar?'メモ一覧を閉じる':'メモ一覧を開く'} aria-expanded={sidebar} title="メモ一覧を開閉"><PanelLeft size={21}/></button>
      <strong className="notes-brand">Canvas <span>Notes</span></strong><span className="notes-header-divider"/>
      <input aria-label="メモのタイトル" placeholder="新しいメモ" value={record?.title||''} maxLength={80} disabled={!record||notes.busy||importing||organizing||!!meta.trashedAt||meta.importState==='pending'} onChange={e=>doc&&notes.change(doc,e.target.value)}/>
      <button onClick={()=>{setSidebar(true);setSearchScope('all');requestAnimationFrame(()=>searchInput.current?.focus());}} aria-label="全メモを横断検索" title="横断検索（Ctrl+Shift+F）"><Search size={19}/></button>
      <span className="notes-save-status" role="status">{attaching?'添付を送信中…':notes.status}</span>
      <button onClick={()=>void notes.save()} disabled={!record} title="保存">保存</button>
      <button onClick={()=>setSettings(!settings)} aria-label="メモ設定と書き出し" aria-expanded={settings}><Settings2 size={19}/></button>
    </header>
    <div className="notes-layout">
      {sidebar&&<><button className="notes-sidebar-backdrop" aria-label="メモ一覧を閉じる" onClick={toggleSidebar}/><aside className="notes-sidebar">
        <div className="notes-sidebar-head"><div><small>MY WORKSPACE</small><h1>メモ</h1></div><button className="notes-new" onClick={()=>void createNote()} disabled={importing||attaching||notes.busy||organizing} aria-label="新しいメモ"><Plus size={22}/></button></div>
        <label className="notes-search"><Search size={17}/><input ref={searchInput} placeholder="全メモの本文・タグを検索" aria-label="メモを検索" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button onClick={()=>setQuery('')} aria-label="検索を消す"><X size={14}/></button>}</label>
        <div className="notes-search-options"><label>検索範囲<select aria-label="検索範囲" value={searchScope} onChange={e=>setSearchScope(e.target.value as 'all'|'filtered')}><option value="all">全カテゴリ横断</option><option value="filtered">選択中のカテゴリ・タグ</option></select></label><small>{trash?'ゴミ箱内を検索':'タイトル・本文・タグ・添付名'} · 空白でAND検索</small></div>
        <div className="notes-navigation"><button className={!trash&&!category?'active':''} onClick={()=>{setTrash(false);setCategory('');setTag('');setQuery('');}}>すべてのメモ <small>{notes.list.filter(n=>!n.note?.trashedAt).length}</small></button><button className={trash?'active':''} onClick={()=>{setTrash(true);setQuery('');setCategory('');setTag('');}}><Trash2 size={15}/>ゴミ箱 <small>{notes.list.filter(n=>n.note?.trashedAt).length}</small></button></div>
        <CategoryTree paths={categories} notes={notes.list} selected={category} onSelect={navigateCategory} disabled={organizing||importing||attaching} onManage={()=>setCategoryManager(true)}/>
        <div className="notes-filters"><label><Tag size={15}/><select aria-label="タグで絞り込み" value={tag} onChange={e=>{setTag(e.target.value);setQuery('');}}><option value="">すべてのタグ</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label></div>
        <div className="notes-count" role="status">{searching?(searchScope==='all'?'横断検索':'絞り込み検索'):trash?'ゴミ箱':category||'すべてのメモ'} · {filtered.length} 件</div>
        <div className="notes-list">{filtered.map(n=><button key={n.id} className={`notes-list-item ${n.id===record?.id?'active':''}`} disabled={importing||attaching||notes.busy||organizing} onClick={()=>{void notes.open(n.id);if(innerWidth<=760)setSidebar(false);}}>
          <strong>{n.note?.pinned&&<Pin size={13}/>} {n.title||'新しいメモ'}</strong><p>{searching?searchExcerpt(n.searchText||n.excerpt||'',query):n.excerpt||'テキストのないメモ'}</p><footer><time>{new Date(n.updated_at).toLocaleDateString('ja-JP',{month:'short',day:'numeric'})}</time><span title={n.note?.category}>{n.note?.category||'未分類'}</span>{n.note?.importState==='pending'&&<em>取込途中</em>}</footer></button>)}
          {!filtered.length&&<p className="notes-empty">該当するメモはありません</p>}</div>
        <button disabled={organizing||attaching} className="notes-import-button" onClick={()=>setImportOpen(true)}><Upload size={16}/> Joplinから取り込む</button>
      </aside></>}
      <section className="notes-editor">
        <div inert={!!meta.trashedAt||organizing||meta.importState==='pending'} className={`notes-toolbar ${meta.importState==='pending'||meta.trashedAt||organizing?'notes-disabled':''}`} role="toolbar" aria-label="編集ツール">
          <div className="notes-tool-group">{([['text',Type,'文字'],['pen',Pencil,'ペン'],['select',MousePointer2,'選択'],['hand',Hand,'移動'],['eraser',Eraser,'線を消す']] as const).map(([id,Icon,label])=><button key={id} className={tool===id?'active':''} onClick={()=>{setTool(id);if(id==='text')setFocus(selected||doc?.blocks?.[0]?.id||'');else{setFocus('');(document.activeElement as HTMLElement)?.blur();}}} title={label} aria-label={label}><Icon size={18}/><span>{label}</span></button>)}</div>
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
        <div className="notes-context"><span>{tool==='pen'||tool==='eraser'?<><span className="notes-touch-hint">{tool==='pen'?'指で描けます':'指で線を消せます'}</span><input aria-label="ペンの色" type="color" value={inkColor} onChange={e=>setInkColor(e.target.value)}/><input aria-label="ペンの太さ" type="range" min="1" max="20" value={inkWidth} onChange={e=>setInkWidth(Number(e.target.value))}/></>:<>文字はタップして入力 · 指で書くときは「ペン」 · 移動は「移動」</>}</span>
          {selected&&<div><button title="ブロックを複製" onClick={()=>{const b=doc?.blocks?.find(b=>b.id===selected);if(b&&doc)commit({...doc,blocks:[...(doc.blocks||[]),{...b,id:id32(),x:b.x+35,y:b.y+(sizes[b.id]||b.h)+24}]});}}><Copy size={15}/></button><button title="選択を削除" onClick={()=>{if(doc)commit({...doc,blocks:doc.blocks?.filter(b=>b.id!==selected),items:doc.items.filter(i=>i.id!==selected),paintStrokes:doc.paintStrokes?.filter(s=>s.id!==selected)});setSelected('');}}><Trash2 size={15}/></button></div>}
        </div>
        <div className="notes-viewbar" role="toolbar" aria-label="表示倍率"><strong>ズーム</strong><button aria-label="縮小" onClick={()=>zoomTo(scale-.1)} disabled={scale<=.2}><ZoomOut size={19}/>−</button><select aria-label="ズーム倍率" value={Math.round(scale*100)} onChange={e=>zoomTo(Number(e.target.value)/100)}>{[...new Set([20,25,50,75,100,125,150,200,300,400,Math.round(scale*100)])].sort((a,b)=>a-b).map(p=><option key={p} value={p}>{p}%</option>)}</select><button aria-label="拡大" onClick={()=>zoomTo(scale+.1)} disabled={scale>=4}><ZoomIn size={19}/>＋</button><button onClick={()=>zoomTo(1)}>100%</button><button onClick={fitContent}>画面に合わせる</button><small>Ctrl＋ホイール</small><div className="notes-viewbar-spacer"/><button className="notes-delete" disabled={!record||organizing||attaching||importing||notes.busy||meta.importState==='pending'} onClick={()=>meta.trashedAt?setTrashed(false):setDeleteOpen(true)}><Trash2 size={16}/>{meta.trashedAt?'メモを復元':'メモを削除'}</button></div>
        {meta.trashedAt&&<div className="notes-warning">このメモはゴミ箱にあります。本文・添付は保持されています。<button onClick={()=>setTrashed(false)}>元に戻す</button></div>}
        {meta.importState==='pending'&&<div className="notes-warning">取り込み途中のメモです。同じJEXを選んで取り込みを再開してください。</div>}
        {notes.conflict&&<div className="notes-warning">他端末の更新と競合しています。今の内容は端末に保持しています。<button onClick={()=>void notes.recover()}>今の内容を別メモに保存</button></div>}
        {notes.error&&<div className="notes-warning" role="alert">{notes.error}<button onClick={()=>notes.setError('')} aria-label="通知を閉じる"><X size={15}/></button></div>}
        <div ref={scroll} className="notes-scroll" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void attach(Array.from(e.dataTransfer.files));}}>
          {!record?<div className="notes-welcome"><h2>メモを準備しています</h2><p>文章も、手書きも、ここに。</p><button onClick={()=>void createNote()}>新しいメモを作る</button></div>:<div className="notes-surface" style={{width:width*scale,height:height*scale}}>
            <div ref={plane} className={`notes-plane tool-${tool}`} style={{width,height,transform:`scale(${scale})`,pointerEvents:notes.busy||importing||organizing||meta.trashedAt||meta.importState==='pending'?'none':undefined}}
              onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}} onPointerDownCapture={down} onPointerMove={move} onPointerUp={e=>up(e)} onPointerCancel={e=>up(e,true)}>
              <svg className="notes-ink" width={width} height={height}>
                {doc?.layers.filter(l=>l.visible&&l.rasterImageId&&l.rasterBounds).map(l=><LegacyImage key={l.id} docId={record.id} imageId={l.rasterImageId!} {...l.rasterBounds!}/>)}
                {doc?.items.filter(i=>doc.layers.find(l=>l.id===i.layerId)?.visible!==false).map(i=><g key={i.id} data-stroke={i.id} stroke={i.color} strokeWidth={i.width} opacity={i.opacity??1} fill={i.fill||'none'}>
                  {i.kind==='path'?<polyline points={stroke(i.points||[])} fill="none" strokeLinecap="round"/>:i.kind==='rect'?<rect x={i.x} y={i.y} width={Math.abs(i.w)} height={Math.abs(i.h)}/>:i.kind==='ellipse'?<ellipse cx={i.x+i.w/2} cy={i.y+i.h/2} rx={Math.abs(i.w/2)} ry={Math.abs(i.h/2)}/>:i.kind==='line'?<line x1={i.x} y1={i.y} x2={i.x+i.w} y2={i.y+i.h}/>:i.kind==='image'&&i.imageId?<LegacyImage docId={record.id} imageId={i.imageId} x={i.x} y={i.y} w={i.w} h={i.h}/>:null}
                </g>)}
                {doc?.paintStrokes?.filter(s=>doc.layers.find(l=>l.id===s.layerId)?.visible!==false).map(s=><polyline key={s.id} data-stroke={s.id} points={stroke(s.points)} stroke={s.color} strokeWidth={s.width} opacity={s.opacity} strokeLinecap="round" strokeLinejoin="round" fill="none"/>)}
                {draft.length>0&&<polyline points={stroke(draft)} stroke={inkColor} strokeWidth={inkWidth} strokeLinecap="round" fill="none" pointerEvents="none"/>}
              </svg>
              {doc?.blocks?.map(b=><EditableBlock key={b.id} block={b} readOnly={tool!=='text'||!!meta.trashedAt||organizing||importing||notes.busy||meta.importState==='pending'} selected={selected===b.id} focused={focus===b.id} onFocus={()=>{setSelected(b.id);setFocus(b.id);}}
                onChange={(html,h)=>updateBlock(b.id,html,h)} onDrag={(e,resize)=>drag(e,b.id,resize)} onSize={h=>setSizes(old=>old[b.id]===h?old:{...old,[b.id]:h})}
                onPaste={files=>void attach(files)} onNavigate={id=>void notes.open(id)}/>)}
            </div>
          </div>}
        </div>
        {!!doc?.attachments?.length&&<div className="notes-attachments"><Paperclip size={15}/>{doc.attachments.map(a=><a key={a.id} href={fileURL(record!.id,a.id)} target="_blank" rel="noreferrer">{a.name} <small>{(a.size/1024/1024).toFixed(1)}MB</small></a>)}</div>}
      </section>
      {settings&&<aside className="notes-settings"><div className="notes-settings-title"><h2>メモの整理</h2><button onClick={()=>setSettings(false)} aria-label="設定を閉じる"><X size={18}/></button></div>
        <label>カテゴリ（ / で入れ子）<input disabled={!!meta.trashedAt||organizing} key={record?.id+':category:'+meta.category} defaultValue={meta.category} maxLength={200} onBlur={e=>{e.target.value=categoryPath(e.target.value);changeMeta({category:e.target.value});}} list="note-categories"/></label><datalist id="note-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
        <button disabled={organizing||importing||attaching} onClick={()=>setCategoryManager(true)}>カテゴリの追加・移動・タグ化</button>
        <label>タグ（カンマ区切り）<input disabled={!!meta.trashedAt||organizing} key={record?.id+':tags:'+meta.tags.join(',')} defaultValue={meta.tags.join(', ')} onBlur={e=>changeMeta({tags:[...new Set(e.target.value.split(/[,、]/).map(t=>t.trim()).filter(Boolean))].slice(0,50)})}/></label>
        <button onClick={()=>changeMeta({pinned:!meta.pinned})}><Pin size={16}/>{meta.pinned?'ピン留めを解除':'一覧の上にピン留め'}</button>
        {meta.isTodo&&<label className="notes-todo"><input type="checkbox" checked={!!meta.completed} onChange={e=>changeMeta({completed:e.target.checked})}/>このToDoを完了</label>}
        <hr/><button onClick={()=>record&&download(record.title+'.md',exportMarkdown(record))}><FileDown size={16}/>このメモをMDに書き出す</button>
        <button onClick={()=>record&&download(record.title+'.txt',(doc?.blocks||[]).map(b=>{const el=document.createElement('div');el.innerHTML=cleanHTML(b.html);return el.innerText;}).join('\n\n'),'text/plain')}>テキストで書き出す</button>
        <button onClick={()=>void exportAll()}><FileDown size={16}/>全メモを整理用に書き出す</button>
        <p>書き出したMDと分類ファイルをChatGPTに渡して「整理して」と依頼できます。整理後の分類ファイルを読み込むと、カテゴリとタグを反映します。</p>
        <button disabled={organizing||!!meta.trashedAt} onClick={()=>organizationInput.current?.click()}><Upload size={16}/>整理した分類を読み込む</button>
        <button onClick={()=>{setImportOpen(true);setSettings(false);}}><Upload size={16}/>JoplinのJEXを取り込む</button>
        {meta.sourceNotebook&&<p>元のノートブック<br/>{meta.sourceNotebook}</p>}
      </aside>}
    </div>
    {categoryManager&&<CategoryManager paths={categories} initial={category} busy={organizing} onClose={()=>setCategoryManager(false)} onApply={organize}/>}
    {deleteOpen&&<div className="notes-modal"><section role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">メモをゴミ箱へ移動</h2><p>「{record?.title}」をゴミ箱へ移動します。あとから復元できます。</p><button onClick={()=>setDeleteOpen(false)}>キャンセル</button><button className="notes-primary" onClick={()=>setTrashed(true)}>ゴミ箱へ移動</button></section></div>}
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
