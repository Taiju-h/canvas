import {ensureOfflineShell} from '@/lib/offline-shell';
import {networkAvailable,fetchWithTimeout} from '@/lib/network';
import {planCategorySync,type Classification} from '@/lib/category-sync';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PanelLeft, PanelLeftClose, PanelLeftOpen, Plus, MoreHorizontal, Search, Share2, Save, FileDown, FileText, Upload, Paperclip, Type, Pencil, MousePointer2, MousePointer, Hand, Undo2, Redo2, Bold, Italic, Underline, Superscript, Subscript, Highlighter, Table2, Columns3, ChevronDown, ChevronLeft, ChevronRight, List, ListChecks, ImagePlus, Pin, X, Folder, Tag, Settings2, Copy, Trash2, Eraser, ZoomIn, ZoomOut, Box, Maximize2, Minimize2, Palette, Square, Circle, Minus, Triangle, ArrowRight, Keyboard, Move } from 'lucide-react';
import EditableBlock from './note-block';
import InkStroke from './ink-stroke';
import WorkspaceViewSwitch, {type WorkspaceView} from './workspace-view-switch';
import type {InkBrush} from '@/lib/ink-brushes';
import {CategoryTree,CategoryManager,type CategoryOperation} from './note-categories';
import {WorkspaceContextMenu,type WorkspaceMenuItem} from './workspace-context-menu';
import UpdateBadge from './web-update-badge';
import NoteOrganizer from './note-organizer';
import ResizableNoteSidebar from './resizable-note-sidebar';
import {isScreenFullscreen,setScreenFullscreen} from '@/lib/screen-fullscreen';
import {categoryPath,categoryPaths,inCategory,movedCategory,matchesSearch,searchExcerpt} from '@/lib/note-organization';
import { useNotes, type SharedAccess } from '@/lib/use-notes';
import { api, blankNote, block, cleanHTML, markdownHTML, download, escapeHTML, exportMarkdown, fileURL, id32, plainText, uploadAttachment, type NoteBlock, type NoteDoc, type NoteMeta, type NoteRecord, type Attachment } from '@/lib/notes';
import { readJex, type JexArchive } from '@/lib/jex';
import { importJex } from '@/lib/import-jex';
import { inverseTransformPoint, type Point, type Item } from '@/lib/canvas';
import { ChartsLayer, FixedNoteLayer, LayerPanel, SpreadsheetLayer, studioLayerOrder, type CellRange, type ChartItem, type SheetData, type StudioNoteDoc } from './note-studio-layers';
import '../notes.css';
import { getLocalImage, getLocalDoc, putLocalImage, listLocalDocs } from '@/lib/local-docs';
import { loadOfflineWorkspace, persistOfflineWorkspace, locallyApplyCategory, type OfflineWorkspace } from '@/lib/offline-workspace';
import {tableMarkup,editTable,currentTable,currentCell,setTableOptions,selectedNoteRoot,selectedString,insertRichHTML,applyRuby,applyRedMark,type TableOptions} from '@/lib/rich-note-commands';
import {exportDocx,exportPng,exportPlain} from '@/lib/note-export';
import {materializeSheetReferences,referenceSourceFromNote,referencedAliases} from '@/lib/sheet-references';
import {listLocalRevisions,saveLocalRevision,type LocalRevision} from '@/lib/local-docs';
import {readNoteAsset,noteAssets} from '@/lib/note-files';
import {workspaceCommand} from '@/lib/workspace-shortcuts';
import {selectionClipboard,parseSelectionClipboard,pasteSelection,SELECTION_MIME,SELECTION_PREFIX,type SelectionClipboard} from '@/lib/selection-clipboard';
import WorkspaceShortcutHelp from './workspace-shortcut-help';
import {saveBlob,formatFileSize} from '@/lib/file-download';
import {eraseCanvasInk,splitInkSelection,moveInkSelection,inkPolygonMask,type EraserMode,type InkSelection} from '@/lib/canvas-ink';
import {inkFrame,pointInPolygon,polygonArea,translatePolygon} from '@/lib/ink-masks';
import InkMasked from './ink-masked';
import {CanvasBrushes,CanvasEraser,CanvasLasso} from './canvas-tool-controls';
import LayoutShapeTools from './layout-shape-tools';
import {builtInShapePresets,createShapePreset,instantiateShapePreset,readShapePresets} from '@/lib/shape-presets';
import {useTouchButtons} from '@/lib/use-touch-buttons';

function LegacyImage({docId,imageId,x,y,w,h}:{docId:string;imageId:string;x:number;y:number;w:number;h:number}) {
  const [url,setURL]=useState('');
  useEffect(()=>{let live=true;let objectURL='';void getLocalImage(imageId).then(async blob=>{if(!blob&&networkAvailable()&&!imageId.startsWith('local-')){try{blob=await readNoteAsset(docId,{id:imageId,kind:'image',name:imageId});await putLocalImage(imageId,blob);}catch{}}if(!live)return;
    if(blob){objectURL=URL.createObjectURL(blob);setURL(objectURL);}else if(!imageId.startsWith('local-'))setURL('/canvas/api.php?path='+encodeURIComponent(`/api/documents/${docId}/images/${imageId}`));
  }).catch(()=>{if(live&&!imageId.startsWith('local-'))setURL('/canvas/api.php?path='+encodeURIComponent(`/api/documents/${docId}/images/${imageId}`));});return()=>{live=false;if(objectURL)URL.revokeObjectURL(objectURL);};},[docId,imageId]);
  return url?<image href={url} x={x} y={y} width={w} height={h}/>:null;
}


type ColorMode='palette'|'wheel'|'hsb'|'cmyk';
const COLOR_PALETTE=['#000000','#343739','#ffffff','#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e','#7f1d1d','#78350f','#365314','#064e3b','#164e63','#1e3a8a','#312e81','#581c87','#831843'];
function clamp255(n:number){return Math.max(0,Math.min(255,Math.round(n)));}
function rgbHex(r:number,g:number,b:number){return '#'+[r,g,b].map(v=>clamp255(v).toString(16).padStart(2,'0')).join('');}
function hsbToHex(h:number,s:number,v:number){const hh=((h%360)+360)%360,ss=Math.max(0,Math.min(100,s))/100,vv=Math.max(0,Math.min(100,v))/100,c=vv*ss,x=c*(1-Math.abs((hh/60)%2-1)),m=vv-c;let r=0,g=0,b=0;if(hh<60){r=c;g=x}else if(hh<120){r=x;g=c}else if(hh<180){g=c;b=x}else if(hh<240){g=x;b=c}else if(hh<300){r=x;b=c}else{r=c;b=x}return rgbHex((r+m)*255,(g+m)*255,(b+m)*255);}
function cmykToHex(c:number,m:number,y:number,k:number){const C=Math.max(0,Math.min(100,c))/100,M=Math.max(0,Math.min(100,m))/100,Y=Math.max(0,Math.min(100,y))/100,K=Math.max(0,Math.min(100,k))/100;return rgbHex(255*(1-C)*(1-K),255*(1-M)*(1-K),255*(1-Y)*(1-K));}
function ColorStudio({color,onChange}:{color:string;onChange:(color:string)=>void}){
  const [mode,setMode]=useState<ColorMode>('palette');const [h,setH]=useState(220);const [s,setS]=useState(85);const [b,setB]=useState(90);const [c,setC]=useState(0);const [m,setM]=useState(45);const [y,setY]=useState(80);const [k,setK]=useState(5);
  const wheel=(e:ReactPointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);const next=(Math.atan2(dy,dx)*180/Math.PI+450)%360;setH(next);onChange(hsbToHex(next,s,b));};
  const hsb=(H=h,S=s,B=b)=>{setH(H);setS(S);setB(B);onChange(hsbToHex(H,S,B));};
  const cmyk=(C=c,M=m,Y=y,K=k)=>{setC(C);setM(M);setY(Y);setK(K);onChange(cmykToHex(C,M,Y,K));};
  return <div className="notes-color-studio" onMouseDown={e=>{if((e.target as Element).closest('button'))e.preventDefault();}}>
    <div className="notes-color-tabs"><Palette size={15}/>{(['palette','wheel','hsb','cmyk'] as ColorMode[]).map(v=><button key={v} className={mode===v?'active':''} onClick={()=>setMode(v)}>{v==='palette'?'パレット':v==='wheel'?'カラーサークル':v.toUpperCase()}</button>)}</div>
    {mode==='palette'&&<div className="notes-color-palette">{COLOR_PALETTE.map(v=><button key={v} title={v} aria-label={v} className={color.toLowerCase()===v?'active':''} style={{background:v}} onClick={()=>onChange(v)}/>)}</div>}
    {mode==='wheel'&&<div className="notes-color-wheel-wrap"><div className="notes-color-wheel" onPointerDown={wheel} onPointerMove={e=>{if(e.buttons)wheel(e);}}><i style={{transform:`rotate(${h}deg) translateX(42px)`}}/></div><div className="notes-color-sliders"><label>S <input type="range" min="0" max="100" value={s} onChange={e=>hsb(h,Number(e.target.value),b)}/></label><label>B <input type="range" min="0" max="100" value={b} onChange={e=>hsb(h,s,Number(e.target.value))}/></label></div></div>}
    {mode==='hsb'&&<div className="notes-color-fields">{[['H',h,360],['S',s,100],['B',b,100]].map(([name,val,max])=><label key={String(name)}>{name}<input type="number" min="0" max={Number(max)} value={Math.round(Number(val))} onChange={e=>{const n=Number(e.target.value);if(name==='H')hsb(n,s,b);else if(name==='S')hsb(h,n,b);else hsb(h,s,n);}}/></label>)}</div>}
    {mode==='cmyk'&&<div className="notes-color-fields">{[['C',c],['M',m],['Y',y],['K',k]].map(([name,val])=><label key={String(name)}>{name}<input type="number" min="0" max="100" value={Math.round(Number(val))} onChange={e=>{const n=Number(e.target.value);if(name==='C')cmyk(n,m,y,k);else if(name==='M')cmyk(c,n,y,k);else if(name==='Y')cmyk(c,m,n,k);else cmyk(c,m,y,n);}}/></label>)}</div>}
    <div className="notes-color-current"><span style={{background:color}}/><code>{color.toUpperCase()}</code><input type="color" value={color} onChange={e=>onChange(e.target.value)}/></div>
  </div>;
}

type ShapeBox={x:number;y:number;w:number;h:number};
function shapeBox(item:Item):ShapeBox{
  if(item.points?.length){const xs=item.points.map(p=>p.x),ys=item.points.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};}
  return{x:Math.min(item.x,item.x+item.w),y:Math.min(item.y,item.y+item.h),w:Math.abs(item.w),h:Math.abs(item.h)};
}
function shapeVertices(item:Item):Point[]{
  if(item.kind==='path'||item.kind==='polygon')return item.points||[];
  if(item.kind==='line')return[{x:item.x,y:item.y},{x:item.x+item.w,y:item.y+item.h}];
  if(item.kind==='rect'){const b=shapeBox(item);return[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}];}
  if(item.kind==='ellipse'){const b=shapeBox(item);return[{x:b.x+b.w/2,y:b.y},{x:b.x+b.w,y:b.y+b.h/2},{x:b.x+b.w/2,y:b.y+b.h},{x:b.x,y:b.y+b.h/2}];}
  return[];
}
function resizedShape(item:Item,from:ShapeBox,to:ShapeBox):Item{
  const px=(x:number)=>to.x+(x-from.x)*(to.w/Math.max(0.0001,from.w));
  const py=(y:number)=>to.y+(y-from.y)*(to.h/Math.max(0.0001,from.h));
  return{...item,x:px(item.x),y:py(item.y),w:px(item.x+item.w)-px(item.x),h:py(item.y+item.h)-py(item.y),
    points:item.points?.map(p=>({...p,x:px(p.x),y:py(p.y)}))};
}
function changedVertex(item:Item,index:number,point:Point):Item{
  if(item.kind==='ellipse'){
    const b=shapeBox(item);let left=b.x,right=b.x+b.w,top=b.y,bottom=b.y+b.h;
    if(index===0)top=Math.min(bottom-6,point.y);
    if(index===1)right=Math.max(left+6,point.x);
    if(index===2)bottom=Math.max(top+6,point.y);
    if(index===3)left=Math.min(right-6,point.x);
    return{...item,x:left,y:top,w:right-left,h:bottom-top};
  }
  const vertices=shapeVertices(item).map((p,i)=>i===index?{...p,x:point.x,y:point.y}:p);
  if(item.kind==='line'&&vertices.length===2)return{...item,x:vertices[0].x,y:vertices[0].y,w:vertices[1].x-vertices[0].x,h:vertices[1].y-vertices[0].y};
  if(!vertices.length)return item;
  const xs=vertices.map(p=>p.x),ys=vertices.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
  return{...item,kind:item.kind==='rect'?'polygon':item.kind,points:vertices,x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
}
function translateShape(item:Item,dx:number,dy:number):Item{
  return{...item,x:item.x+dx,y:item.y+dy,points:item.points?.map(p=>({...p,x:p.x+dx,y:p.y+dy})),
    clip:item.clip?{...item.clip,x:item.clip.x+dx,y:item.clip.y+dy}:undefined};
}

type PaintStroke=NonNullable<NoteDoc['paintStrokes']>[number];
type Graphic=Item|PaintStroke;
const graphicBoundsCache=new WeakMap<Graphic,ShapeBox>();
type ActiveAnchor={id:string;index:number};
function isItemGraphic(value:Graphic):value is Item{return 'kind' in value;}
function graphicBox(g:Graphic):ShapeBox{
  const cached=graphicBoundsCache.get(g);if(cached)return cached;
  let b:ShapeBox;
  if(isItemGraphic(g))b=shapeBox(g);
  else {
    const points=g.points;
    if(!points.length)b={x:0,y:0,w:0,h:0};
    else {
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(const p of points){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
      b={x:left,y:top,w:right-left,h:bottom-top};
    }
  }
  graphicBoundsCache.set(g,b);return b;
}
function graphicVertices(g:Graphic):Point[]{return isItemGraphic(g)?shapeVertices(g):g.points;}
function graphicName(g:Graphic){if(!isItemGraphic(g))return 'フリーハンド';return g.kind==='rect'?'四角形':g.kind==='ellipse'?'楕円':g.kind==='line'?'直線':g.kind==='image'?'画像':g.kind==='path'?'パス':'図形';}
function graphicRotate(point:Point,center:Point,degree:number):Point{
  const angle=degree*Math.PI/180,dx=point.x-center.x,dy=point.y-center.y;
  return{x:center.x+dx*Math.cos(angle)-dy*Math.sin(angle),y:center.y+dx*Math.sin(angle)+dy*Math.cos(angle)};
}
function graphicInversePoint(g:Graphic,point:Point):Point{
  if(isItemGraphic(g))return inverseTransformPoint(g,point);
  const b=graphicBox(g);return graphicRotate(point,{x:b.x+b.w/2,y:b.y+b.h/2},-(g.rotation||0));
}
function distanceToLine(p:Point,a:Point,b:Point){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length>0?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function nearestSegment(g:Graphic,point:Point):{index:number;distance:number}|null{
  const vertices=graphicVertices(g),isClosed=isItemGraphic(g)&&(g.kind==='rect'||g.kind==='polygon');
  if(vertices.length<2)return vertices.length===1?{index:0,distance:Math.hypot(point.x-vertices[0].x,point.y-vertices[0].y)}:null;
  let closest={index:0,distance:Infinity};
  for(let i=0;i<vertices.length-(isClosed?0:1);i++){
    const d=distanceToLine(point,vertices[i],vertices[(i+1)%vertices.length]);
    if(d<closest.distance)closest={index:i,distance:d};
  }
  return closest;
}
function graphicDistance(g:Graphic,screenPoint:Point):number{
  const p=graphicInversePoint(g,screenPoint),b=graphicBox(g);
  const outX=Math.max(b.x-p.x,0,p.x-b.x-b.w),outY=Math.max(b.y-p.y,0,p.y-b.y-b.h);
  if(!isItemGraphic(g)||g.kind==='line'||g.kind==='path'||g.kind==='polygon'){
    if(outX>24||outY>24)return Math.hypot(outX,outY);
    return nearestSegment(g,p)?.distance??Infinity;
  }
  if(g.kind==='ellipse'){
    const rx=Math.max(.001,b.w/2),ry=Math.max(.001,b.h/2),normalized=Math.hypot((p.x-b.x-rx)/rx,(p.y-b.y-ry)/ry);
    return Math.max(0,normalized-1)*Math.min(rx,ry);
  }
  return Math.hypot(outX,outY);
}
function resizedGraphic(g:Graphic,from:ShapeBox,to:ShapeBox):Graphic{
  if(isItemGraphic(g))return resizedShape(g,from,to);
  const px=(x:number)=>from.w<1?x+to.x-from.x:to.x+(x-from.x)*(to.w/from.w);
  const py=(y:number)=>from.h<1?y+to.y-from.y:to.y+(y-from.y)*(to.h/from.h);
  return{...g,points:g.points.map(p=>({...p,x:px(p.x),y:py(p.y)}))};
}
function moveGraphic(g:Graphic,dx:number,dy:number):Graphic{
  return isItemGraphic(g)?translateShape(g,dx,dy):{...g,points:g.points.map(p=>({...p,x:p.x+dx,y:p.y+dy}))};
}
function updateGraphicVertex(g:Graphic,index:number,point:Point):Graphic{
  if(isItemGraphic(g))return changedVertex(g,index,point);
  const before=g.points[index];if(!before)return g;
  const dx=point.x-before.x,dy=point.y-before.y,spread=g.points.length>28?Math.max(3,Math.min(12,Math.round(g.points.length/50))):0;
  return{...g,points:g.points.map((p,i)=>{const distance=Math.abs(i-index);
    if(!spread&&i!==index)return p;
    if(spread&&distance>spread*3)return p;
    const weight=spread?Math.exp(-.5*(distance/spread)**2):1;
    return{...p,x:p.x+dx*weight,y:p.y+dy*weight};})};
}
function updateGraphicSegment(g:Graphic,index:number,dx:number,dy:number):Graphic{
  const vertices=graphicVertices(g);if(vertices.length<2)return g;
  const other=(index+1)%vertices.length;
  if(isItemGraphic(g)){
    if(g.kind==='line')return{...g,x:g.x+dx,y:g.y+dy};
    if(g.kind!=='rect'&&g.kind!=='path'&&g.kind!=='polygon')return g;
    const first=changedVertex(g,index,{x:vertices[index].x+dx,y:vertices[index].y+dy});
    return changedVertex(first,other,{x:vertices[other].x+dx,y:vertices[other].y+dy});
  }
  const a=updateGraphicVertex(g,index,{x:vertices[index].x+dx,y:vertices[index].y+dy});
  return updateGraphicVertex(a,other,{x:vertices[other].x+dx,y:vertices[other].y+dy});
}
function editableVertexIndices(g:Graphic,limit=24):number[]{
  const points=graphicVertices(g);
  if(points.length<=limit)return points.map((_,index)=>index);
  const indices=[0];for(let i=1;i<limit-1;i++)indices.push(Math.round(i*(points.length-1)/(limit-1)));
  indices.push(points.length-1);return [...new Set(indices)];
}
type Action={shiftToggle?:string;ids?:string[];layerId?:string;selection?:InkSelection;selectionBase?:{doc:NoteDoc;ids:string[]};pointerId:number;verticalOnly?:boolean;moved?:boolean;handle?:string;kind:'preset'|'lasso'|'canvasMove'|'move'|'resize'|'ink'|'erase'|'pan'|'shape'|'shapeResize'|'shapeRotate'|'vertexMove'|'segmentMove';id?:string;start:Point;original:NoteDoc;next?:NoteDoc;points?:Point[];scroll?:{left:number;top:number};pen?:boolean;blockId?:string;shapeKind?:'line'|'rect'|'ellipse'};
function preference(key:string,fallback:string){try{return localStorage.getItem(key)||fallback;}catch{return fallback;}}
function savePreference(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Preferences do not gate editing. */}}
function storedSidebar(){try{return localStorage.getItem('canvas-notes-sidebar')!=='closed' && innerWidth>760;}catch{return innerWidth>760;}}
export default function NotesWorkspace({accountId,sharedAccess}:{accountId:string;sharedAccess?:SharedAccess}){
  const notes=useNotes(accountId,sharedAccess);const {record}=notes;
  const touchButtons=useTouchButtons(accountId+':'+(record?.id||'')+':'+notes.busy);
  useEffect(()=>{
    let composing=false;
    const start=()=>{composing=true;},end=()=>{composing=false;};
    const before=(event:Event)=>{(event as CustomEvent<{waitUntil:(job:Promise<unknown>)=>void}>).detail.waitUntil((async()=>{
      if(composing)throw new Error('日本語入力を確定してから更新してください');
      (document.activeElement as HTMLElement)?.blur();await notes.persistPending();
      if(sharedAccess){await notes.save();if(notes.hasUnsynced())throw new Error('共有ノートの保存を完了してから更新してください');}
    })());};
    document.addEventListener('compositionstart',start);document.addEventListener('compositionend',end);window.addEventListener('kaerunote-before-web-update',before);
    return()=>{document.removeEventListener('compositionstart',start);document.removeEventListener('compositionend',end);window.removeEventListener('kaerunote-before-web-update',before);};
  },[notes.record?.dirty,!!sharedAccess]);
  const [shareOpen,setShareOpen]=useState(false);
  const [shareLink,setShareLink]=useState('');
  const [shareEnabled,setShareEnabled]=useState(false);
  const [shareBusy,setShareBusy]=useState(false);
  const [shareError,setShareError]=useState('');
  const [shareCopied,setShareCopied]=useState(false);
  const lastShareDoc=useRef('');
  const [sidebar,setSidebar]=useState(()=>sharedAccess||preference('kn-workspace-view','memo')==='drawing'?false:storedSidebar());
  const [screenFullscreen,setScreenFullscreenState]=useState(isScreenFullscreen);
  useEffect(()=>{const changed=()=>setScreenFullscreenState(isScreenFullscreen());document.addEventListener('fullscreenchange',changed);window.addEventListener('canvas-fullscreen-change',changed);return()=>{document.removeEventListener('fullscreenchange',changed);window.removeEventListener('canvas-fullscreen-change',changed);};},[]);
  // The wide chooser is temporary navigation, never a restored editing layout.
  const [categoryBrowserOpen,setCategoryBrowserOpen]=useState(false);
  const [organizerOpen,setOrganizerOpen]=useState(()=>!sharedAccess&&new URL(location.href).searchParams.get('view')==='organize');
  function showOrganizer(open:boolean){
    (document.activeElement as HTMLElement)?.blur();setOrganizerOpen(open);setCategoryBrowserOpen(false);setSidebarMenuOpen(false);setSettings(false);setWorkspaceMenu(null);
    const url=new URL(location.href);if(open)url.searchParams.set('view','organize');else url.searchParams.delete('view');history.replaceState(null,'',url);
  }
  useEffect(()=>{setCategoryBrowserOpen(false);},[accountId]);
  useEffect(()=>{
    if(!categoryBrowserOpen)return;
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||document.querySelector('[role="dialog"],.notes-modal,.kn-workspace-popup'))return;
      event.preventDefault();collapseCategoryBrowser();
    };
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[categoryBrowserOpen]);
  // Manual navigation is the new default, including devices with the old ON preference.
  const [sidebarAutoClose,setSidebarAutoClose]=useState(()=>preference('kn-navigation-autoclose','off')==='on');
  const [workspaceMenu,setWorkspaceMenu]=useState<{x:number;y:number;noteId:string;range:Range|null;copyText:string}|null>(null);
  const [relatedPanel,setRelatedPanel]=useState(false);
  const [sheetDependents,setSheetDependents]=useState<{id:string;title:string}[]>([]);
  const [aiConfigured,setAiConfigured]=useState<boolean|null>(null);
  const [aiBusy,setAiBusy]=useState(false);
  const aiTarget=useRef('');
  const [aiResult,setAiResult]=useState('');
  const aiAudioInput=useRef<HTMLInputElement>(null);
  const [offlinePreparing,setOfflinePreparing]=useState(false);
  const [offlineProgress,setOfflineProgress]=useState<{done:number;total:number;files:number;errors:number}|null>(null);const [sidebarMenuOpen,setSidebarMenuOpen]=useState(false);const [query,setQuery]=useState('');const [category,setCategory]=useState('');const [tag,setTag]=useState('');
  const [tool,setTool]=useState<'note'|'text'|'pen'|'select'|'vertex'|'magic'|'hand'|'eraser'|'lasso'|'inkMove'|'preset'|'line'|'rect'|'ellipse'|'sheet'>('note');const [workspaceMode,setWorkspaceMode]=useState<'note'|'canvas'|'layout'|'excel'|'graph'>('note');const [inkColor,setInkColor]=useState('#263443');const [inkWidth,setInkWidth]=useState(3);const [inkOpacity,setInkOpacity]=useState(1);const [brush,setBrush]=useState<InkBrush>('gpen');
  const brushWidths=useRef<Record<InkBrush,number>>({pen:3,pencil:4,gpen:3,marker:18,brush:18,airbrush:48});
  const [shapePreset,setShapePreset]=useState('triangle');const [draftPreset,setDraftPreset]=useState<Item[]>([]);const [layoutWidth,setLayoutWidth]=useState(3);
  const [customPresets,setCustomPresets]=useState(()=>readShapePresets(preference('kn-shape-presets:'+accountId,'[]')));
  useEffect(()=>setCustomPresets(readShapePresets(preference('kn-shape-presets:'+accountId,'[]'))),[accountId]);
  const shapePresets=[...builtInShapePresets,...customPresets];
  const [narrowPanels,setNarrowPanels]=useState(()=>innerWidth<=900);useEffect(()=>{const resize=()=>setNarrowPanels(innerWidth<=900);addEventListener('resize',resize);return()=>removeEventListener('resize',resize);},[]);
  const [shortcutHelp,setShortcutHelp]=useState(false);const spaceTool=useRef<typeof tool|null>(null);const pasteAtOrigin=useRef(false);const pastingSelection=useRef(false);const clipboardSequence=useRef({text:'',count:0});
  const [eraserMode,setEraserMode]=useState<EraserMode>('circle');const [eraserSize,setEraserSize]=useState(32);
  const [eraserCursor,setEraserCursor]=useState<Point|null>(null);const [lassoDraft,setLassoDraft]=useState<Point[]>([]);const [canvasSelection,setCanvasSelection]=useState<InkSelection|null>(null);
  const [workspaceView,setWorkspaceView]=useState<'memo'|'drawing'>(()=>preference('kn-workspace-view','memo')==='drawing'?'drawing':'memo');
  const memoPanels=useRef({sidebar:storedSidebar(),layersOpen:true});
  useEffect(()=>{savePreference('kn-workspace-view',workspaceView);},[workspaceView]);
  const [activeLayer,setActiveLayer]=useState('');const [layersOpen,setLayersOpen]=useState(()=>preference('kn-workspace-view','memo')!=='drawing');const [sheetSelection,setSheetSelection]=useState<CellRange|undefined>();const [sheetPreviewOpen,setSheetPreviewOpen]=useState(false);const [chartOpen,setChartOpen]=useState(false);const [chartType,setChartType]=useState<ChartItem['type']>('bar');const [chartLayer,setChartLayer]=useState('');const [draftShape,setDraftShape]=useState<Item|null>(null);
  const [selected,setSelected]=useState('');const [activeAnchor,setActiveAnchor]=useState<ActiveAnchor|null>(null);const [activeSegment,setActiveSegment]=useState<ActiveAnchor|null>(null);const [multiSelected,setMultiSelected]=useState<string[]>([]);const [multiMode,setMultiMode]=useState(false);const [hoveredShape,setHoveredShape]=useState('');const [overlapItems,setOverlapItems]=useState<string[]>([]);const [overlapAt,setOverlapAt]=useState<Point|null>(null);const [overlapOpen,setOverlapOpen]=useState(false);const [fineX,setFineX]=useState(0);const [fineY,setFineY]=useState(0);const [fineAngle,setFineAngle]=useState(0);const [focus,setFocus]=useState('');const [settings,setSettings]=useState(false);const [scale,setScale]=useState(1);
  const [layerProperties,setLayerProperties]=useState('');
  const layerImportTarget=useRef<{id:string;docId:string}|null>(null);
  const layerImageInput=useRef<HTMLInputElement>(null),layerPdfInput=useRef<HTMLInputElement>(null),noteTextInput=useRef<HTMLInputElement>(null);
  const [layerImportProgress,setLayerImportProgress]=useState('');
  const [advancedOpen,setAdvancedOpen]=useState(()=>preference('kn-note-details','closed')==='open');
  const [canvasDetailsOpen,setCanvasDetailsOpen]=useState(()=>preference('kn-canvas-details','closed')==='open');
  const [includeChildren,setIncludeChildren]=useState(()=>preference('kn-category-descendants','on')!=='off');
  const [inkPressure,setInkPressure]=useState(true);
  const [classificationStatus,setClassificationStatus]=useState<'saved'|'syncing'|'pending'|'conflict'|'complete'>(()=>loadOfflineWorkspace(accountId).pending.length?'pending':'saved');
  useEffect(()=>{savePreference('kn-note-details',advancedOpen?'open':'closed');},[advancedOpen]);
  useEffect(()=>{savePreference('kn-canvas-details',canvasDetailsOpen?'open':'closed');},[canvasDetailsOpen]);
  useEffect(()=>{savePreference('kn-category-descendants',includeChildren?'on':'off');},[includeChildren]);
  const [fontStep,setFontStep]=useState(3);
  const [bulletSize,setBulletSize]=useState<'large'|'medium'|'small'>('large');
  const [rubyColor,setRubyColor]=useState('#9d5b30');
  const [highlightColor,setHighlightColor]=useState('#fff170');
  const [imagePlacement,setImagePlacement]=useState<'inline'|'overlay'>('inline');
  const [imageAlign,setImageAlign]=useState<'left'|'center'|'right'>('left');
  const [tableOpen,setTableOpen]=useState(false);
  const [tableSelected,setTableSelected]=useState(false);
  const savedCaret=useRef<Range|null>(null);
  const editingTable=useRef(false);
  const formatCaret=useRef<Range|null>(null);
  const lastTable=useRef<HTMLTableElement|null>(null);
  const lastCell=useRef<HTMLTableCellElement|null>(null);
  const [tableOpts,setTableOpts]=useState<TableOptions>({kind:'table',rows:3,cols:3,width:100,align:'fit',height:'auto',lines:4,flow:'expand'});
  const [revisionsOpen,setRevisionsOpen]=useState(false);
  const [revisions,setRevisions]=useState<LocalRevision[]>([]);
  const [focusMode,setFocusMode]=useState(false);const [focusFloat,setFocusFloat]=useState({x:0,y:0});const [focusDrag,setFocusDrag]=useState<{dx:number;dy:number}|null>(null);const [drawer,setDrawer]=useState<'top'|'left'|'right'|''>('');const [colorOpen,setColorOpen]=useState(false);const [colorFading,setColorFading]=useState(false);
  const [archive,setArchive]=useState<JexArchive|null>(null);const [importOpen,setImportOpen]=useState(false);const [importMessage,setImportMessage]=useState('');const [importing,setImporting]=useState(false);
  const [attaching,setAttaching]=useState(false);
  const [trash,setTrash]=useState(false);const [searchScope,setSearchScope]=useState<'all'|'filtered'>('all');
  const [recentSearches,setRecentSearches]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('canvas-search-history')||'[]').filter((v:unknown)=>typeof v==='string').slice(0,12);}catch{return[];}});
  const [categoryManager,setCategoryManager]=useState(false);const [categoryManagerKind,setCategoryManagerKind]=useState<CategoryOperation['kind']>('create');const [organizing,setOrganizing]=useState(false);
  const [workspace,setWorkspace]=useState<OfflineWorkspace>(()=>loadOfflineWorkspace(accountId));
  const workspaceRef=useRef(workspace);workspaceRef.current=workspace;
  const syncingWorkspace=useRef(false);const organizingRef=useRef(false);
  function updateWorkspace(next:OfflineWorkspace){
    persistOfflineWorkspace(accountId,next);
    workspaceRef.current=next;setWorkspace(next);
  }
  const searchInput=useRef<HTMLInputElement>(null);const scaleRef=useRef(scale);scaleRef.current=scale;
  const [deleteOpen,setDeleteOpen]=useState(false);
  useEffect(()=>{
    // Never replace locally queued changes with a server response on startup.
    let live=true;
    const offline=loadOfflineWorkspace(accountId);setWorkspace(offline);workspaceRef.current=offline;
    void api('/api/note-workspace').then(r=>r.json()).then((remote:{categories:string[];revision:number})=>{
      if(!live)return;
      const current=workspaceRef.current;
      if(current.pending.length)return;
      updateWorkspace({categories:categoryPaths(remote.categories),revision:remote.revision,pending:[],updatedAt:Date.now()});
    }).catch(()=>{});
    return()=>{live=false;};
  },[accountId]);
  useEffect(()=>{
    if(!sidebarMenuOpen)return;
    const closeOutside=(event:PointerEvent)=>{
      if(!(event.target as Element).closest?.('.notes-sidebar-more'))setSidebarMenuOpen(false);
    };
    const closeEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setSidebarMenuOpen(false);};
    document.addEventListener('pointerdown',closeOutside);
    document.addEventListener('keydown',closeEscape);
    return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape);};
  },[sidebarMenuOpen]);
  const [fixedHeight,setFixedHeight]=useState(0);
  const [draft,setDraft]=useState<Point[]>([]);const [sizes,setSizes]=useState<Record<string,number>>({});
  const hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const scroll=useRef<HTMLDivElement>(null);const plane=useRef<HTMLDivElement>(null);const action=useRef<Action|null>(null);
  const fittedViewport=useRef({id:'',width:0});const extent=useRef({id:'',width:1800,height:1400});const suppressClick=useRef(false);
  const current=useRef(record);current.current=record;const cancelImport=useRef(false);const fileInput=useRef<HTMLInputElement>(null);const imageInput=useRef<HTMLInputElement>(null);const jexInput=useRef<HTMLInputElement>(null);const organizationInput=useRef<HTMLInputElement>(null);
  const undoStack=useRef<NoteDoc[]>([]);const redoStack=useRef<NoteDoc[]>([]);const typing=useRef<{id:string;at:number}|null>(null);const [,redraw]=useState(0);const lastPen=useRef(0);const previousId=useRef('');const focusRestore=useRef({sidebar:false,layersOpen:true});const colorFadeTimer=useRef<number|undefined>(undefined);const colorCloseTimer=useRef<number|undefined>(undefined);
  const doc=record?.content;const selectedShape=doc?.items.find(i=>i.id===selected);const selectedStroke=doc?.paintStrokes?.find(i=>i.id===selected);const selectedGraphic:Graphic|undefined=selectedShape||selectedStroke;
  const selectedIds=selected?[...new Set([selected,...multiSelected.filter(id=>!!doc?.items.some(i=>i.id===id)||!!doc?.paintStrokes?.some(i=>i.id===id)||!!doc?.blocks?.some(i=>i.id===id))])]:[];const studio=doc as StudioNoteDoc|undefined;const meta=doc?.note||{category:'',tags:[]};
  const fixedNote=studio?.fixedNote||{html:'',visible:true,locked:false};const sheet=studio?.sheet||{visible:false,locked:false,rows:20,cols:10,cells:{}};const sheetHasData=Object.values(sheet.cells||{}).some(value=>String(value).trim()!=='');const sheetForView=sheetPreviewOpen&&!sheet.visible?{...sheet,visible:true}:sheet;const charts=studio?.charts||[];
  const layerOrder=studioLayerOrder(studio);
  const familyZ=(family:typeof layerOrder[number])=>(layerOrder.length-layerOrder.indexOf(family))*10;
  const drawingFamily=(layerId?:string)=>studio?.layers.find(layer=>layer.id===layerId)?.studioKind||'canvas';
  useEffect(()=>{if(!record)return;const promoted=previousId.current.startsWith('local-')&&notes.resolveId(previousId.current)===record.id;previousId.current=record.id;if(promoted)return;spaceTool.current=null;pasteAtOrigin.current=false;setShortcutHelp(false);setFixedHeight(0);setSelected('');setCanvasSelection(null);setLassoDraft([]);setEraserCursor(null);setActiveAnchor(null);setActiveSegment(null);setMultiSelected([]);setHoveredShape('');setOverlapItems([]);setOverlapAt(null);setFocus('');setSizes({});undoStack.current=[];redoStack.current=[];typing.current=null;setTool(sharedAccess?'select':workspaceView==='drawing'?'pen':'note');setWorkspaceMode(sharedAccess?'layout':workspaceView==='drawing'?'canvas':'note');setSheetSelection(undefined);setSheetPreviewOpen(false);const layers=(record.content as StudioNoteDoc).layers;setActiveLayer((sharedAccess?layers.find(l=>(l.studioKind||'canvas')==='layout'&&l.visible&&!l.locked)?.id:undefined)||layers.find(l=>(l.studioKind||'canvas')==='canvas'&&l.visible&&!l.locked)?.id||layers.find(l=>l.visible&&!l.locked)?.id||layers[0]?.id||'');scroll.current?.scrollTo(0,0);},[record?.id]);
  useEffect(()=>{const fit=()=>{
    const d=current.current;if(!d)return;const viewportWidth=scroll.current?.clientWidth||innerWidth;
    const previous=fittedViewport.current;const promoted=previous.id.startsWith('local-')&&notes.resolveId(previous.id)===d.id;
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
  function undo(){setCanvasSelection(null);setSelected('');setMultiSelected([]);setActiveAnchor(null);setActiveSegment(null);if(organizing||meta.trashedAt)return;const d=current.current?.content;const previous=undoStack.current.pop();if(!d||!previous)return;redoStack.current.push(d);setFocus('');(document.activeElement as HTMLElement)?.blur();notes.change(previous);redraw(v=>v+1);}
  function redo(){setCanvasSelection(null);setSelected('');setMultiSelected([]);setActiveAnchor(null);setActiveSegment(null);if(organizing||meta.trashedAt)return;const d=current.current?.content;const next=redoStack.current.pop();if(!d||!next)return;undoStack.current.push(d);setFocus('');(document.activeElement as HTMLElement)?.blur();notes.change(next);redraw(v=>v+1);}
  function toggleSidebar(){if(sharedAccess)return;setWorkspaceMenu(null);setSidebarMenuOpen(false);setCategoryBrowserOpen(false);if(focusMode){setFocusMode(false);setLayersOpen(focusRestore.current.layersOpen);setDrawer('');}setSidebar(old=>{const next=!old;try{localStorage.setItem('canvas-notes-sidebar',next?'open':'closed');}catch{}return next;});}
  useEffect(()=>{
    if(!shareOpen||!record||record.id.startsWith('local-')||sharedAccess)return;
    let mounted=true;
    if(lastShareDoc.current!==record.id){
      lastShareDoc.current=record.id;
      setShareLink('');setShareCopied(false);
    }
    setShareError('');
    void api('/api/documents/'+record.id+'/share').then(r=>r.json()).then((res:{enabled:boolean})=>{
      if(mounted)setShareEnabled(!!res.enabled);
    }).catch(err=>{if(mounted)setShareError(err instanceof Error?err.message:'共有状態を確認できません');});
    return()=>{mounted=false;};
  },[shareOpen,record?.id,!!sharedAccess]);

  async function createShare(){
    if(!record||sharedAccess||record.id.startsWith('local-'))return;
    if(shareEnabled&&!window.confirm('新しい共有リンクを発行すると、以前の共有リンクは使えなくなります。続けますか？'))return;
    setShareBusy(true);setShareError('');
    try{
      await notes.save();
      if(notes.conflict)throw new Error('未解決の保存競合があります。共有前に競合を解消してください');
      const result=await(await api('/api/documents/'+record.id+'/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create'})})).json() as {token:string};
      const url=new URL('/canvas/',location.origin);
      url.searchParams.set('d',record.id);url.hash=new URLSearchParams({share:result.token}).toString();
      setShareLink(url.toString());setShareEnabled(true);setShareCopied(false);
    }catch(e){setShareError(e instanceof Error?e.message:'リンクを発行できません');}
    finally{setShareBusy(false);}
  }
  async function revokeShare(){
    if(!record||sharedAccess)return;
    setShareBusy(true);setShareError('');
    try{
      await api('/api/documents/'+record.id+'/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revoke'})});
      setShareEnabled(false);setShareLink('');setShareCopied(false);
    }catch(e){setShareError(e instanceof Error?e.message:'共有を停止できません');}
    finally{setShareBusy(false);}
  }
  async function copyShare(){
    try{
      await navigator.clipboard.writeText(shareLink);setShareCopied(true);
    }catch{setShareError('コピーできませんでした。上のURL欄を選択してコピーしてください。');}
  }
  function rememberSearch(value=query){const q=value.trim();if(!q)return;setRecentSearches(old=>{const next=[q,...old.filter(v=>v!==q)].slice(0,12);try{localStorage.setItem('canvas-search-history',JSON.stringify(next));}catch{}return next;});}
  function activateFamily(kind:'canvas'|'layout'){
    if(workspaceMode!==kind)setCanvasSelection(null);
    const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return'';
    const writable=(layer:StudioNoteDoc['layers'][number])=>(layer.studioKind||'canvas')===kind&&layer.visible&&!layer.locked;
    let layer=d.layers.find(l=>l.id===activeLayer&&writable(l))||d.layers.find(writable);
    if(!layer){const id=id32();layer={id,name:(kind==='canvas'?'キャンバス ':'レイアウト ')+(d.layers.filter(l=>(l.studioKind||'canvas')===kind).length+1),visible:true,locked:false,studioKind:kind};commit({...d,layers:[...d.layers,layer]} as NoteDoc);}
    setActiveLayer(layer.id);setWorkspaceMode(kind);return layer.id;
  }
  function selectDrawingLayer(id:string,addedKind?:'canvas'|'layout'){
    if(id!==activeLayer)setCanvasSelection(null);
    const layer=(current.current?.content as StudioNoteDoc|undefined)?.layers.find(l=>l.id===id);if(!layer&&!addedKind)return;
    const kind=layer?.studioKind||addedKind||'canvas';
    setActiveLayer(id);setWorkspaceMode(kind);setTool(kind==='layout'?'select':'pen');setFocus('');
  }
  function chooseTool(next:typeof tool){
    if(next!=='sheet'&&workspaceMode==='excel'&&!sheetHasData)setSheetPreviewOpen(false);
    if(next==='note'){setWorkspaceMode('note');setTool(next);return;}
    if(next==='text'){activateFamily('layout');setTool(next);return;}
    if(next==='sheet'){useSheetLayer();return;}
    if(next==='pen'||next==='eraser'||next==='lasso'||next==='inkMove'){setSelected('');setMultiSelected([]);setActiveAnchor(null);setActiveSegment(null);lastPen.current=0;activateFamily('canvas');setTool(next);setFocus('');return;}
    if(next==='select'||next==='vertex'||next==='magic'||next==='line'||next==='rect'||next==='ellipse'||next==='preset'){activateFamily('layout');setTool(next);setFocus('');return;}
    setTool(next);setFocus('');
  }
  function toggleFocusMode(){if(action.current)return;const next=!focusMode;if(next){focusRestore.current={sidebar,layersOpen};setSidebar(false);setLayersOpen(false);setFocusFloat({x:Math.max(16,innerWidth-76),y:72});setDrawer('');}else{setSidebar(focusRestore.current.sidebar);setLayersOpen(focusRestore.current.layersOpen);setDrawer('');setFocusDrag(null);}setFocusMode(next);}
  function chooseWorkspaceView(next:WorkspaceView){
    if(action.current)return;
    (document.activeElement as HTMLElement)?.blur();setCategoryBrowserOpen(false);setWorkspaceMenu(null);setColorOpen(false);
    if(next==='focus'){if(!focusMode)toggleFocusMode();return;}
    const panels=focusMode?focusRestore.current:{sidebar,layersOpen};
    if(focusMode)toggleFocusMode();
    if(next==='drawing'&&workspaceView!=='drawing'){memoPanels.current=panels;setSidebar(false);setLayersOpen(false);setAdvancedOpen(false);setCanvasDetailsOpen(false);}
    if(next==='memo'&&workspaceView!=='memo'){setSidebar(!sharedAccess&&memoPanels.current.sidebar);setLayersOpen(memoPanels.current.layersOpen);}
    setWorkspaceView(next);
    if(next==='drawing'){
      // A layout change must not create a layer in a locked document.
      const layer=(current.current?.content as StudioNoteDoc|undefined)?.layers.find(layer=>(layer.studioKind||'canvas')==='canvas'&&layer.visible&&!layer.locked);
      if(layer)setActiveLayer(layer.id);
      lastPen.current=0;setWorkspaceMode('canvas');setTool('pen');setFocus('');
    }else useNoteLayer();
  }
  function selectBrush(next:InkBrush){brushWidths.current[brush]=inkWidth;setBrush(next);setInkWidth(brushWidths.current[next]);chooseTool('pen');}
  function brushPicker(label:string){return <select aria-label={label} value={brush} onChange={event=>selectBrush(event.target.value as InkBrush)}><option value="gpen">Gペン</option><option value="pen">ペン</option><option value="pencil">鉛筆</option><option value="marker">マーカー</option><option value="brush">筆</option><option value="airbrush">エアブラシ</option></select>;}
  function choosePreset(id:string){if(!shapePresets.some(p=>p.id===id))return;setShapePreset(id);chooseTool('preset');}
  function saveShapePreset(name:string){
    const d=current.current?.content;if(!d)return;
    try{const items=selectedIds.map(id=>d.items.find(i=>i.id===id)).filter((i):i is Item=>!!i);if(items.length!==selectedIds.length)throw new Error('レイアウトの図形を選択してください');
      const preset=createShapePreset('custom-'+id32(),name,items),next=[...customPresets,preset].slice(-100);localStorage.setItem('kn-shape-presets:'+accountId,JSON.stringify(next));setCustomPresets(next);setShapePreset(preset.id);
    }catch(error){notes.setError(error instanceof Error?error.message:'図形を登録できませんでした');}
  }
  function layoutShapeTools(){return <LayoutShapeTools tool={tool} preset={shapePreset} presets={shapePresets} onTool={chooseTool} onPreset={choosePreset} onSave={saveShapePreset} canSave={selectedIds.length>0&&selectedIds.every(id=>{const item=doc?.items.find(i=>i.id===id);return item&&drawingFamily(item.layerId)==='layout'&&['rect','ellipse','polygon','path','line'].includes(item.kind);})}/>;}
  function chooseEraser(alternate=false){if(alternate)setEraserMode(mode=>mode==='circle'?'stroke':'circle');chooseTool('eraser');}
  function eraserControl(compact=false){return <CanvasEraser active={tool==='eraser'} mode={eraserMode} size={eraserSize} onChoose={chooseEraser} onMode={mode=>{setEraserMode(mode);chooseTool('eraser');}} onSize={setEraserSize} compact={compact}/>;}
  function canvasSelectionActions(){return (tool==='lasso'||canvasSelection)&&<div className="notes-lasso-actions" role="group" aria-label="投げ縄の選択範囲"><button disabled={!canvasSelection} onClick={()=>changeCanvasSelection('duplicate')}>選択を複製</button><button disabled={!canvasSelection} onClick={()=>changeCanvasSelection('delete')}>選択を削除</button><button disabled={!canvasSelection} onClick={()=>setCanvasSelection(null)}>選択解除</button></div>;}
  function changeCanvasSelection(operation:'delete'|'duplicate'|'move',dx=0,dy=0,history=true){
    const d=current.current?.content;if(!d||!canvasSelection)return;
    const split=splitInkSelection(d,canvasSelection,id32);if(!split.ids.length){setCanvasSelection(null);return;}
    const ids=new Set(split.ids);
    if(operation==='delete'){commit({...split.doc,items:split.doc.items.filter(i=>!ids.has(i.id)),paintStrokes:split.doc.paintStrokes?.filter(i=>!ids.has(i.id))});setCanvasSelection(null);return;}
    if(operation==='duplicate'){
      const cloneIds:string[]=[],clone=<T extends {id:string}>(i:T)=>{const id=id32();cloneIds.push(id);return{...i,id};};
      const next={...d,items:[...d.items,...split.doc.items.filter(i=>ids.has(i.id)).map(clone)],paintStrokes:[...(d.paintStrokes||[]),...(split.doc.paintStrokes||[]).filter(i=>ids.has(i.id)).map(clone)]};
      commit(moveInkSelection(next,cloneIds,24,24));setCanvasSelection({...canvasSelection,ids:cloneIds,points:translatePolygon(canvasSelection.points,24,24)});return;
    }
    commit(moveInkSelection(split.doc,split.ids,dx,dy),history);setCanvasSelection({...canvasSelection,ids:split.ids,points:translatePolygon(canvasSelection.points,dx,dy)});
  }
  function clearObjectSelection(){setCanvasSelection(null);setSelected('');setMultiSelected([]);setActiveAnchor(null);setActiveSegment(null);setOverlapItems([]);}
  function layerEditable(d:NoteDoc,layerId?:string,family?:'canvas'|'layout'){
    const layer=(d as StudioNoteDoc).layers.find(l=>l.id===layerId);return !!layer&&layer.visible&&!layer.locked&&(!family||(layer.studioKind||'canvas')===family);
  }
  function layoutSelectedIds(d=current.current?.content){if(!d)return[];const requested=new Set(selectedIds);return [...d.items,...(d.paintStrokes||[]),...(d.blocks||[])].filter(i=>requested.has(i.id)&&layerEditable(d,i.layerId,'layout')).map(i=>i.id);}
  function selectionOutline(d:NoteDoc,ids:string[]):Point[]{
    const wanted=new Set(ids),points:Point[]=[];
    for(const g of [...d.items,...(d.paintStrokes||[])])if(wanted.has(g.id)){
      const b=graphicBox(g),pad=g.width*.75+2,center={x:b.x+b.w/2,y:b.y+b.h/2};
      points.push(...[{x:b.x-pad,y:b.y-pad},{x:b.x+b.w+pad,y:b.y-pad},{x:b.x+b.w+pad,y:b.y+b.h+pad},{x:b.x-pad,y:b.y+b.h+pad}].map(p=>graphicRotate(p,center,g.rotation||0)));
    }
    for(const b of d.blocks||[])if(wanted.has(b.id))points.push({x:b.x,y:b.y},{x:b.x+b.w,y:b.y+(sizes[b.id]||b.h)});
    if(!points.length)return[];const b=inkFrame(points);return[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}];
  }
  function allCanvasSelection(d=current.current?.content):InkSelection|null{
    if(!d)return null;const layers=(d as StudioNoteDoc).layers,active=layers.find(l=>l.id===activeLayer&&(l.studioKind||'canvas')==='canvas');
    const layer=active||(layers.find(l=>(l.studioKind||'canvas')==='canvas'&&l.visible&&!l.locked));if(!layer||!layer.visible||layer.locked)return null;
    const ids=[...d.items,...(d.paintStrokes||[])].filter(i=>i.layerId===layer.id).map(i=>i.id);if(!ids.length)return null;
    return{layerId:layer.id,ids,points:selectionOutline(d,ids)};
  }
  function selectAllObjects(){const d=current.current?.content;if(!d)return;
    if(workspaceMode==='canvas'){const selection=allCanvasSelection(d);setCanvasSelection(selection);if(selection){setActiveLayer(selection.layerId);setTool('inkMove');}setSelected('');setMultiSelected([]);}
    else if(workspaceMode==='layout'){const ids=[...d.items,...(d.paintStrokes||[]),...(d.blocks||[])].filter(i=>layerEditable(d,i.layerId,'layout')).map(i=>i.id);setSelected(ids.at(-1)||'');setMultiSelected(ids.slice(0,-1));setTool('select');setActiveAnchor(null);setActiveSegment(null);}
  }
  function moveLayoutSelection(d:NoteDoc,ids:string[],dx:number,dy:number):NoteDoc{
    const wanted=new Set(ids),anchored=(d.paintStrokes||[]).filter(s=>s.blockId&&wanted.has(s.blockId)&&layerEditable(d,s.layerId)).map(s=>s.id),next=moveInkSelection(d,[...ids,...anchored],dx,dy);
    return{...next,items:next.items.map(i=>wanted.has(i.id)&&i.clip?{...i,clip:{...i.clip,x:i.clip.x+dx,y:i.clip.y+dy}}:i),blocks:d.blocks?.map(b=>wanted.has(b.id)?{...b,x:b.x+dx,y:b.y+dy}:b)};
  }
  function deleteObjectSelection(){if(workspaceMode==='canvas'){changeCanvasSelection('delete');return;}const d=current.current?.content;if(!d)return;
    if(workspaceMode==='graph'){const chart=(d as StudioNoteDoc).charts?.find(c=>c.id===selected);if(chart&&!chart.locked&&layerEditable(d,chart.layerId))commit({...d,charts:((d as StudioNoteDoc).charts||[]).filter(c=>c.id!==selected)} as NoteDoc);clearObjectSelection();return;}
    const ids=new Set(layoutSelectedIds(d));if(!ids.size)return;
    commit({...d,items:d.items.filter(i=>!ids.has(i.id)),paintStrokes:d.paintStrokes?.filter(i=>!ids.has(i.id)),blocks:d.blocks?.filter(i=>!ids.has(i.id))});clearObjectSelection();
  }
  function copyObjectSelection():SelectionClipboard|null{
    const r=current.current;if(!r||(workspaceMode!=='canvas'&&workspaceMode!=='layout'))return null;
    let d=r.content,ids:string[]=[],outline:Point[]=[];
    if(workspaceMode==='canvas'){if(!canvasSelection)return null;const split=splitInkSelection(d,canvasSelection,id32);d=split.doc;ids=split.ids;outline=canvasSelection.points;}
    else{ids=layoutSelectedIds(d);outline=selectionOutline(d,ids);}
    if(!ids.length)return null;const value=selectionClipboard(d,r.id,workspaceMode,ids,outline);
    const selectedDoc={...d,items:value.items,paintStrokes:value.paintStrokes,blocks:value.blocks,layers:[],attachments:[],fixedNote:{html:'',visible:false,locked:false},legacyNoteBody:undefined};
    value.assets=noteAssets({...r,content:selectedDoc}).map(a=>({...a,...d.attachments?.find(file=>file.id===a.id)}));return value;
  }
  function duplicateObjectSelection(){const d=current.current?.content,value=copyObjectSelection();if(!d||!value)return;const layer=value.family==='canvas'?canvasSelection?.layerId:(d as StudioNoteDoc).layers.find(l=>l.id===activeLayer&&layerEditable(d,l.id,'layout'))?.id||value.items[0]?.layerId||value.blocks[0]?.layerId||value.paintStrokes[0]?.layerId;if(!layer||!layerEditable(d,layer,value.family))return;
    const pasted=pasteSelection(d,value,layer,id32);commit(pasted.content);setActiveLayer(layer);setFocus('');if(value.family==='canvas')setCanvasSelection({layerId:layer,ids:pasted.ids,points:pasted.outline});else{setSelected(pasted.ids.at(-1)||'');setMultiSelected(pasted.ids.slice(0,-1));}
  }
  async function pasteObjectSelection(value:SelectionClipboard,inPlace=false){
    const target=current.current;if(!target||pastingSelection.current)return;pastingSelection.current=true;
    const original=value;value=JSON.parse(JSON.stringify(value));const addedFiles:Attachment[]=[];
    try{
      if(value.sourceId!==target.id&&value.assets.length){
        const mapped=new Map<string,string>();
        for(const asset of value.assets){const blob=await readNoteAsset(value.sourceId,asset),id='local-'+id32();await putLocalImage(id,blob);mapped.set(asset.id,id);if(asset.kind==='file')addedFiles.push({id,name:asset.name,mime:blob.type||asset.mime||'application/octet-stream',size:blob.size,pending:true});}
        value.items=value.items.map(i=>{if(!i.imageId)return i;const file=i.imageId.startsWith('file:'),id=file?i.imageId.slice(5):i.imageId;return{...i,imageId:mapped.has(id)?(file?'file:':'')+mapped.get(id):i.imageId};});
        value.blocks=value.blocks.map(b=>{const template=document.createElement('template');template.innerHTML=cleanHTML(b.html);for(const el of template.content.querySelectorAll('img,a')){
          let id=el.getAttribute('data-kn-local-image')||el.getAttribute('data-kn-local-file')||'';
          if(!id){try{const url=new URL(el.getAttribute('src')||el.getAttribute('href')||'',location.href);if(url.origin===location.origin&&url.pathname==='/canvas/api.php')id=/\/(?:files|images)\/([^/]+)$/.exec(url.searchParams.get('path')||'')?.[1]||'';}catch{}}
          const next=mapped.get(id.replace(/^file:/,''));if(!next)continue;
          if(el.tagName==='IMG'){el.setAttribute('data-kn-local-image',next);el.setAttribute('src','');}else{el.setAttribute('data-kn-local-file',next);el.setAttribute('href',fileURL(target.id,next));}
        }return{...b,html:cleanHTML(template.innerHTML)};});
      }
      const latest=current.current;if(!latest||latest.id!==notes.resolveId(target.id))throw new Error('貼り付け先ノートが切り替わりました');
      let d=latest.content as StudioNoteDoc;const active=d.layers.find(l=>l.id===activeLayer&&(l.studioKind||'canvas')===value.family);
      if(active&&(!active.visible||active.locked))throw new Error('貼り付け先レイヤーを表示し、ロックを解除してください');
      let layer=active||d.layers.find(l=>(l.studioKind||'canvas')===value.family&&l.visible&&!l.locked);
      if(!layer){if(d.layers.some(l=>(l.studioKind||'canvas')===value.family))throw new Error('貼り付け先レイヤーのロックを解除してください');layer={id:id32(),name:value.family==='canvas'?'キャンバス':'レイアウト',studioKind:value.family,visible:true,locked:false};d={...d,layers:[...d.layers,layer]};}
      const key=JSON.stringify(original);if(clipboardSequence.current.text!==key)clipboardSequence.current={text:key,count:0};const offset=inPlace?0:24*++clipboardSequence.current.count;
      value.blocks=value.blocks.map(b=>({...b,html:cleanHTML(b.html)}));const pasted=pasteSelection(d,value,layer.id,id32,offset,offset);commit({...pasted.content,attachments:[...(d.attachments||[]),...addedFiles]});setActiveLayer(layer.id);setWorkspaceMode(value.family);setTool(value.family==='canvas'?'inkMove':'select');setFocus('');
      if(value.family==='canvas'){setSelected('');setMultiSelected([]);setCanvasSelection({layerId:layer.id,ids:pasted.ids,points:pasted.outline});}else{setCanvasSelection(null);setSelected(pasted.ids.at(-1)||'');setMultiSelected(pasted.ids.slice(0,-1));}
    }catch(error){notes.setError(error instanceof Error?error.message:'選択範囲を貼り付けできませんでした');}finally{pastingSelection.current=false;}
  }
  useEffect(()=>{
    const textTarget=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
    const blocked=()=>organizing||importing||attaching||notes.busy||meta.trashedAt||meta.importState==='pending'||pastingSelection.current||document.querySelector('[role="dialog"],.kn-workspace-popup')||categoryBrowserOpen;
    const outside=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('.notes-sidebar,.notes-settings');
    const releaseSpace=()=>{const previous=spaceTool.current;spaceTool.current=null;if(previous)setTool(current=>current==='hand'?previous:current);};
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||blocked()||event.isComposing||event.keyCode===229)return;
      const editable=textTarget(event.target)||textTarget(document.activeElement),command=workspaceCommand(event,{editable,mode:workspaceMode});
      if(!command||outside(event.target)||action.current)return;
      if(command==='copy'||command==='cut'||command==='paste'){if(command==='paste')pasteAtOrigin.current=event.shiftKey;return;}
      event.preventDefault();
      if(command==='undo')undo();else if(command==='redo')redo();else if(command==='save')void notes.save();else if(command==='help')setShortcutHelp(true);
      else if(command==='all')selectAllObjects();else if(command==='deselect')clearObjectSelection();else if(command==='delete')deleteObjectSelection();else if(command==='duplicate')duplicateObjectSelection();
      else if(['left','right','up','down'].includes(command)){const step=event.shiftKey?10:1,dx=command==='left'?-step:command==='right'?step:0,dy=command==='up'?-step:command==='down'?step:0;if(workspaceMode==='canvas')changeCanvasSelection('move',dx,dy,!event.repeat);else{const d=current.current?.content,ids=layoutSelectedIds(d);if(d&&ids.length)commit(moveLayoutSelection(d,ids,dx,dy),!event.repeat);}}
      else if(command==='brush')chooseTool('pen');else if(command==='eraser')chooseEraser(event.shiftKey);else if(command==='lasso')chooseTool('lasso');else if(command==='move')chooseTool(workspaceMode==='canvas'?'inkMove':'select');else if(command==='hand')chooseTool('hand');
      else if(command==='pan'){if(!event.repeat&&!spaceTool.current){spaceTool.current=tool;setTool('hand');}}
      else if(command==='smaller'||command==='larger'){const step=command==='smaller'?-2:2;if(tool==='eraser')setEraserSize(size=>Math.max(2,Math.min(240,size+step)));else if(workspaceMode==='canvas')setInkWidth(size=>Math.max(1,Math.min(160,size+step)));else setLayoutWidth(size=>Math.max(1,Math.min(100,size+step)));}
      else if(command==='fit')fitContent();else if(command==='actual')zoomTo(1);else zoomTo(scaleRef.current+(command==='zoomIn'?.1:-.1));
    };
    const up=(event:KeyboardEvent)=>{if(event.code==='Space'||event.key===' ')releaseSpace();};
    const copy=(event:ClipboardEvent)=>{
      if(event.defaultPrevented||blocked()||outside(event.target)||textTarget(event.target)||textTarget(document.activeElement)||action.current)return;
      const value=copyObjectSelection();if(!value||!event.clipboardData)return;
      try{const text=JSON.stringify(value);event.clipboardData.setData(SELECTION_MIME,text);event.clipboardData.setData('text/plain',SELECTION_PREFIX+text);event.preventDefault();if(event.type==='cut')deleteObjectSelection();}
      catch{notes.setError('コピーできませんでした。選択した内容は変更していません');}
    };
    const paste=(event:ClipboardEvent)=>{
      if(event.defaultPrevented||blocked()||outside(event.target)||textTarget(event.target)||textTarget(document.activeElement)||action.current||(workspaceMode!=='canvas'&&workspaceMode!=='layout'))return;
      const value=parseSelectionClipboard(event.clipboardData?.getData(SELECTION_MIME)||event.clipboardData?.getData('text/plain')||'');if(!value)return;
      event.preventDefault();event.stopPropagation();const inPlace=pasteAtOrigin.current;pasteAtOrigin.current=false;void pasteObjectSelection(value,inPlace);
    };
    addEventListener('keydown',key);addEventListener('keyup',up);addEventListener('blur',releaseSpace);document.addEventListener('copy',copy,true);document.addEventListener('cut',copy,true);document.addEventListener('paste',paste,true);
    return()=>{removeEventListener('keydown',key);removeEventListener('keyup',up);removeEventListener('blur',releaseSpace);document.removeEventListener('copy',copy,true);document.removeEventListener('cut',copy,true);document.removeEventListener('paste',paste,true);};
  });
  function detailsToggle(drawing=false){const open=workspaceMode==='note'?advancedOpen:canvasDetailsOpen;return <button className={'kn-details-toggle '+(open?'active':'')} onPointerDown={e=>e.preventDefault()} onClick={()=>workspaceMode==='note'?setAdvancedOpen(v=>!v):setCanvasDetailsOpen(v=>!v)} aria-label={drawing?'お絵かきの詳細':workspaceMode==='note'?'ノートの詳細':'Canvasの詳細'} aria-expanded={open} aria-controls="kn-editor-details">{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}詳細</button>;}
  function selectionMoveTool(){return <button aria-label="選択範囲の移動" title="選択範囲の移動（V）" aria-pressed={tool==='inkMove'} className={tool==='inkMove'?'active':''} onClick={()=>chooseTool('inkMove')}><Move size={18}/></button>;}
  function shortcutHelpButton(){return <button aria-label="キーボードショートカット" title="ショートカット一覧（?）" onClick={()=>setShortcutHelp(true)}><Keyboard size={16}/>キー一覧</button>;}
  function canvasMainTools(){return <><button aria-pressed={tool==='pen'} className={tool==='pen'?'active':''} onClick={()=>chooseTool('pen')}><Pencil size={18}/>ペン</button>{eraserControl()}<CanvasLasso active={tool==='lasso'} onChoose={()=>chooseTool('lasso')}/>{selectionMoveTool()}<button aria-label="Canvasの移動" aria-pressed={tool==='hand'} onClick={()=>chooseTool('hand')}><Hand size={18}/></button></>;}
  function layoutMainTools(){return <><button className={tool==='select'?'active':''} aria-pressed={tool==='select'} onClick={()=>chooseTool('select')} title="図形全体を選択して移動・拡縮・回転"><MousePointer2 size={17}/>黒矢印</button><button className={tool==='vertex'?'active':''} aria-pressed={tool==='vertex'} onClick={()=>chooseTool('vertex')} title="頂点と線分を個別編集"><MousePointer size={17}/>白矢印</button>{layoutShapeTools()}<button onClick={()=>addBlock()}><Type size={17}/>テキストボックス</button><button onClick={()=>imageInput.current?.click()}><ImagePlus size={17}/>画像</button></>;}
  function layerToggle(){return <button className={layersOpen?'active':''} aria-label="レイヤー一覧を開閉" title="レイヤーパネルを開閉" aria-expanded={layersOpen} onClick={()=>setLayersOpen(open=>!open)}>{layersOpen?<ChevronDown size={15}/>:<ChevronRight size={15}/>}レイヤー</button>;}
  function layerDock(){if(focusMode||!layersOpen)return null;return <aside className="notes-editor-dock" aria-label="右上のレイヤーとプロパティ"><div className="notes-dock-actions"><button onClick={()=>setLayerProperties(workspaceMode==='note'?'note':activeLayer)} disabled={!record} title="選択レイヤーの名前・透明度・読み込み・書き出し">プロパティ</button><button onClick={()=>setRelatedPanel(value=>!value)} aria-pressed={relatedPanel}>関連ノート</button>{shortcutHelpButton()}{layerToggle()}</div>
          {!focusMode&&layersOpen&&!relatedPanel&&studio&&<LayerPanel doc={studio} activeLayer={activeLayer} onActive={selectDrawingLayer} onSelectObject={(id,kind)=>{setSelected(id);setFocus(kind==='text'?id:'');setWorkspaceMode(kind==='text'?'layout':'graph');setTool(kind==='text'?'text':'select');}} onChange={next=>commit(next as NoteDoc)} onNoteTool={useNoteLayer} onSheetTool={useSheetLayer} onProperties={setLayerProperties}/>}
          {!focusMode&&layersOpen&&relatedPanel&&<aside className="notes-layer-panel kn-related-panel" aria-label="関連ノート">
            <div className="notes-layer-title"><strong>関連ノート</strong><button onClick={()=>setRelatedPanel(false)} title="レイヤー一覧に戻る">←</button></div>
            {meta.relatedNotes?.length?meta.relatedNotes.map(item=><button key={item.id} onClick={()=>void notes.open(item.id)} title={item.reason}>
              {notes.list.find(n=>n.id===item.id)?.title||item.id.slice(0,8)} <small>{item.reason}</small>
            </button>):<p>関連付けられたノートがありません。ChatGPTに本文を読ませて関連付けできます。</p>}
            <button disabled={aiBusy||!aiConfigured} onClick={()=>void callChatGPT('related')}>{aiBusy?'解析中…':'ChatGPTに読ませて関連付け'}</button>
            <p>※ 送信前に確認します。関連付けの結果はノートに保存されます。APIキーはサーバーだけで管理します。</p>
          </aside>}
        </aside>;}
  function modePicker(){return <WorkspaceViewSwitch value={focusMode?'focus':workspaceView} onChange={chooseWorkspaceView}/>;}
  function focusButtonDown(e:ReactPointerEvent<HTMLButtonElement>){if(!focusMode)return;const r=e.currentTarget.getBoundingClientRect();setFocusDrag({dx:e.clientX-r.left,dy:e.clientY-r.top});e.currentTarget.setPointerCapture(e.pointerId);}
  function focusButtonMove(e:ReactPointerEvent<HTMLButtonElement>){if(!focusMode||!focusDrag)return;setFocusFloat({x:Math.max(8,Math.min(innerWidth-58,e.clientX-focusDrag.dx)),y:Math.max(8,Math.min(innerHeight-58,e.clientY-focusDrag.dy))});}
  function focusButtonUp(e:ReactPointerEvent<HTMLButtonElement>){setFocusDrag(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}
  function wakeColorPanel(){if(colorFadeTimer.current)window.clearTimeout(colorFadeTimer.current);if(colorCloseTimer.current)window.clearTimeout(colorCloseTimer.current);setColorOpen(true);setColorFading(false);}
  function fadeColorPanel(){wakeColorPanel();colorFadeTimer.current=window.setTimeout(()=>setColorFading(true),550);colorCloseTimer.current=window.setTimeout(()=>{setColorOpen(false);setColorFading(false);},1050);}
  function setDrawingColor(value:string){setInkColor(value);fadeColorPanel();}
  function position(e:ReactPointerEvent):Point{const r=plane.current!.getBoundingClientRect();const pressure=inkPressure&&e.pointerType==='pen'?(e.pressure>0?e.pressure:.5):1;return{x:Math.max(0,(e.clientX-r.left)/scale),y:Math.max(0,(e.clientY-r.top)/scale),p:pressure};}
  function coalescedPositions(e:ReactPointerEvent):Point[]{const r=plane.current!.getBoundingClientRect();const native=e.nativeEvent;const batch=typeof native.getCoalescedEvents==='function'?native.getCoalescedEvents():[];const events=batch.length?batch:[native];return events.map(value=>({x:Math.max(0,(value.clientX-r.left)/scale),y:Math.max(0,(value.clientY-r.top)/scale),p:inkPressure&&e.pointerType==='pen'?(value.pressure>0?value.pressure:.5):1}));}
  function addBlock(html='',background?:string){
    const doc=current.current?.content as StudioNoteDoc|undefined;if(!doc)return;
    const x=80+(scroll.current?.scrollLeft||0)/scale,y=80+(scroll.current?.scrollTop||0)/scale;
    let layer=doc.layers.find(l=>l.id===activeLayer&&l.studioKind==='layout'&&l.visible&&!l.locked)||
      doc.layers.find(l=>l.studioKind==='layout'&&l.visible&&!l.locked);
    let d=doc;
    if(!layer){
      layer={id:id32(),name:'レイアウト '+(doc.layers.filter(l=>l.studioKind==='layout').length+1),studioKind:'layout',visible:true,locked:false};
      d={...doc,layers:[...doc.layers,layer]};
    }
    const b={...block(x,y,html),background,layerId:layer.id};
    commit({...d,blocks:[...(d.blocks||[]),b]});setActiveLayer(layer.id);setWorkspaceMode('layout');setSelected(b.id);setFocus(b.id);setTool('text');
  }
  function writableLayer(d:NoteDoc,kind?:'canvas'|'layout'){const layers=(d as StudioNoteDoc).layers;const matches=(l:(typeof layers)[number])=>(!kind||(l.studioKind||'canvas')===kind)&&l.visible&&!l.locked;return layers.find(l=>l.id===activeLayer&&matches(l))||layers.find(matches);}
  function updateFixedNote(html:string){const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return;const state=d.fixedNote||{html:'',visible:true,locked:false};if(cleanHTML(state.html)===html)return;commit({...d,fixedNote:{...state,html}} as NoteDoc,false);}
  async function updateSpreadsheetReferences(changedSheet?:SheetData){
    const currentRecord=current.current;if(!currentRecord)return;
    const snapshot=currentRecord.content as StudioNoteDoc;
    await notes.refreshReferences(currentRecord.id);
    if(current.current?.id!==currentRecord.id)return;
    const cached=await listLocalDocs();
    const alias=currentRecord.content.note?.alias||'';
    const dependents=cached.filter(row=>row.id!==currentRecord.id&&row.accountId===accountId)
      .filter(row=>{
        const d=row.content as StudioNoteDoc;
        const all=(d.fixedNote?.html||'')+' '+(d.blocks||[]).map(b=>b.html).join(' ');
        const found=referencedAliases(all);
        return found.includes(currentRecord.id)||(alias&&found.includes(alias));
      }).map(row=>({id:row.id,title:row.title}));
    setSheetDependents(dependents);
  }
  useEffect(()=>{
    if(workspaceMode!=='excel'||!record?.id)return;
    void updateSpreadsheetReferences();
  },[workspaceMode,record?.id]);
  function updateSheet(next:SheetData){
    const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return;
    const hasData=Object.values(next.cells||{}).some(value=>String(value).trim()!=='');
    if(!hasData&&!sheetHasData)return;
    setSheetPreviewOpen(false);
    commit({...d,sheet:{...next,visible:true}} as NoteDoc,false);

  }
  function leaveTransientSheet(){if(workspaceMode==='excel'&&!sheetHasData){setSheetPreviewOpen(false);setSheetSelection(undefined);}}
  function useNoteLayer(){setCategoryBrowserOpen(false);leaveTransientSheet();setFocus('');setWorkspaceMode('note');setTool('note');(document.activeElement as HTMLElement)?.blur();}
  function useSheetLayer(){const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return;const state=d.sheet||{visible:false,locked:false,rows:20,cols:10,cells:{}};if(sheetHasData&&!state.visible)commit({...d,sheet:{...state,visible:true}} as NoteDoc,false);if(!sheetHasData)setSheetPreviewOpen(true);setFocus('');setWorkspaceMode('excel');setTool('sheet');(document.activeElement as HTMLElement)?.blur();}
  function useGraphLayer(){leaveTransientSheet();setFocus('');setWorkspaceMode('graph');setTool('select');(document.activeElement as HTMLElement)?.blur();}
  function pasteIntoSheet(text:string){
    const d=current.current?.content as StudioNoteDoc|undefined;if(!d||!text)return;
    const state=d.sheet||{visible:true,locked:false,rows:20,cols:10,cells:{}};if(state.locked)return;
    const start=(sheetSelection?.start||'A1').toUpperCase();const match=/^([A-Z]+)(\d+)$/.exec(start);if(!match)return;
    let col=0;for(const ch of match[1])col=col*26+ch.charCodeAt(0)-64;col--;const row=Number(match[2])-1;
    const key=(r:number,c:number)=>{let n=c+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s+(r+1);};
    const rows=text.replace(/\r/g,'').split('\n');const cells={...state.cells};
    rows.forEach((line,ri)=>line.split('\t').forEach((value,ci)=>{if(row+ri<state.rows&&col+ci<state.cols)cells[key(row+ri,col+ci)]=value;}));
    updateSheet({...state,visible:true,cells});setSheetSelection({start,end:key(Math.min(state.rows-1,row+rows.length-1),Math.min(state.cols-1,col+Math.max(0,...rows.map(line=>line.split('\t').length-1))))});
  }
  function pasteWorkspace(e:React.ClipboardEvent<HTMLDivElement>){
    const target=e.target as Element;if(target.closest('[contenteditable="true"]'))return;
    if(tool==='sheet'){const text=e.clipboardData.getData('text/plain');if(text){e.preventDefault();pasteIntoSheet(text);}return;}
    if(tool==='note')return;
    const files=Array.from(e.clipboardData.items).map(item=>item.kind==='file'?item.getAsFile():null).filter((file):file is File=>!!file&&file.type.startsWith('image/'));
    if(files.length){e.preventDefault();void placeImages(files);return;}
    const text=e.clipboardData.getData('text/plain');if(text.trim()){e.preventDefault();addBlock(escapeHTML(text).replace(/\n/g,'<br>'));}
  }
  async function placeImages(files:File[],targetLayerId?:string){
    if(!files.length||attaching||organizing)return;
    if(!targetLayerId&&workspaceMode==='note'&&imagePlacement==='inline'){
      await attach(files);
      return;
    }
    setAttaching(true);
    try{
      const r=current.current;if(!r)return;
      let working=r.content as StudioNoteDoc;
      let layer=targetLayerId?working.layers.find(l=>l.id===targetLayerId):writableLayer(working,'layout');
      if(targetLayerId&&(!layer||layer.locked))throw new Error('読み込み先レイヤーが見つからないかロックされています');
      if(!layer){
        layer={id:id32(),name:'レイアウト '+(working.layers.filter(l=>l.studioKind==='layout').length+1),visible:true,locked:false,studioKind:'layout'};
        working={...working,layers:[...working.layers,layer]};
      }
      setActiveLayer(layer.id);setWorkspaceMode('layout');
      let x=100+(scroll.current?.scrollLeft||0)/scale,y=100+(scroll.current?.scrollTop||0)/scale;
      for(const file of files){
        if(!file.type.startsWith('image/'))continue;
        if(file.size===0||file.size>512*1024*1024)throw new Error('画像は1バイト～512MBです');
        const localImageId='local-'+id32();
        await putLocalImage(localImageId,file);
        let w=640,h=420;const url=URL.createObjectURL(file);
        try{
          const dims=await new Promise<{w:number;h:number}>(resolve=>{
            const image=new Image();image.onload=()=>resolve({w:image.naturalWidth||640,h:image.naturalHeight||420});
            image.onerror=()=>resolve({w:640,h:420});image.src=url;
          });
          const ratio=Math.min(1,720/Math.max(1,dims.w),520/Math.max(1,dims.h));
          w=Math.max(80,Math.round(dims.w*ratio));h=Math.max(60,Math.round(dims.h*ratio));
        }finally{URL.revokeObjectURL(url);}
        const viewWidth=(scroll.current?.clientWidth||900)/scale;
        if(imageAlign==='center')x=Math.max(40,(viewWidth-w)/2);
        if(imageAlign==='right')x=Math.max(40,viewWidth-w-40);
        const item:Item={id:id32(),kind:'image',layerId:layer.id,x,y,w,h,color:'#000000',width:1,opacity:1,imageId:localImageId,keepLayer:!!targetLayerId};
        working={...working,items:[...working.items,item]};y+=40;
      }
      const latest=current.current;if(!latest||latest.id!==notes.resolveId(r.id))throw new Error('読み込み先ノートが切り替わりました');
      const added=working.items.filter(i=>!r.content.items.some(old=>old.id===i.id));
      commit({...latest.content,layers:latest.content.layers.some(l=>l.id===layer!.id)?latest.content.layers:[...latest.content.layers,layer],items:[...latest.content.items,...added]} as NoteDoc);setSelected(added.at(-1)?.id||'');setTool('select');
      if(networkAvailable())void notes.save();
    }catch(err){notes.setError(err instanceof Error?err.message:'画像を配置できません');}
    finally{setAttaching(false);}
  }
  function requestLayerImport(kind:'image'|'pdf'|'text'){
    if(!record)return;layerImportTarget.current={id:layerProperties,docId:record.id};
    (kind==='image'?layerImageInput:kind==='pdf'?layerPdfInput:noteTextInput).current?.click();
  }
  async function importNoteText(file:File){
    const target=layerImportTarget.current;if(!target)return;
    setAttaching(true);
    try{
      if(file.size>8*1024*1024)throw new Error('テキストの読み込みは8MBまでです');
      const text=await file.text(),latest=current.current;
      if(!latest||latest.id!==notes.resolveId(target.docId))throw new Error('読み込み先ノートが切り替わりました');
      const d=latest.content as StudioNoteDoc,state=d.fixedNote||{html:'',visible:true,locked:false};
      if(state.locked)throw new Error('ノートレイヤーのロックを解除してください');
      const html=/\.md$/i.test(file.name)?markdownHTML(text):'<p>'+escapeHTML(text).replace(/\r?\n/g,'<br>')+'</p>';
      commit({...d,fixedNote:{...state,visible:true,html:state.html+html}} as NoteDoc);await notes.persistPending();setLayerImportProgress('テキストをノート末尾へ追加しました');
    }catch(error){notes.setError(String(error));}finally{setAttaching(false);}
  }
  async function importLayerPdf(file:File){
    const target=layerImportTarget.current;if(!target)return;setAttaching(true);let done=0;
    try{
      const {readPdfPages}=await import('@/lib/pdf-import');
      const originalId='local-'+id32();let originalSaved=false,nextPageY=80;
      await readPdfPages(file,async(blob,page,total)=>{
        const latest=current.current;if(!latest||latest.id!==notes.resolveId(target.docId))throw new Error('読み込み先ノートが切り替わりました');
        let d=latest.content as StudioNoteDoc;const layer=d.layers.find(l=>l.id===target.id);if(!layer||layer.locked)throw new Error('読み込み先レイヤーのロックを解除してください');
        if(!originalSaved){await putLocalImage(originalId,file);originalSaved=true;}
        const imageId='local-'+id32();await putLocalImage(imageId,blob);
        const url=URL.createObjectURL(blob);let w=800,h=1100;try{const image=new Image();image.src=url;await image.decode();w=image.naturalWidth;h=image.naturalHeight;}finally{URL.revokeObjectURL(url);}
        // Re-read after image decoding so simultaneous text edits are preserved.
        d=current.current!.content as StudioNoteDoc;
        const item:Item={id:id32(),kind:'image',layerId:layer.id,keepLayer:true,x:80,y:nextPageY,w:w*Math.min(1,900/w),h:h*Math.min(1,900/w),imageId,color:'#000000',width:1,opacity:1};
        nextPageY+=item.h+32;
        const attachments=d.attachments?.some(a=>a.id===originalId)?d.attachments:[...(d.attachments||[]),{id:originalId,name:file.name,mime:'application/pdf',size:file.size,pending:true}];
        commit({...d,items:[...d.items,item],attachments});await notes.persistPending();done=page;setLayerImportProgress('PDF '+page+' / '+total+'ページを端末に保存しました');
      });
      setLayerImportProgress('PDF '+done+'ページと原本を読み込みました');setWorkspaceMode('layout');setTool('select');setActiveLayer(target.id);
    }catch(error){notes.setError('PDF読み込み：'+String(error)+(done?'（'+done+'ページは端末に保存済み）':''));}
    finally{setAttaching(false);}
  }
  async function exportLayer(kind:'png'|'json'|'txt'|'md'|'docx'){
    if(!record)return;const d=record.content as StudioNoteDoc;
    const name=layerProperties==='note'?(d.studioNames?.note||'ノート'):d.layers.find(l=>l.id===layerProperties)?.name||'レイヤー';
    try{
      const content:StudioNoteDoc=layerProperties==='note'?{...d,blocks:[],items:[],paintStrokes:[],charts:[]}:{...d,fixedNote:{html:'',visible:false,locked:false},items:d.items.filter(i=>i.layerId===layerProperties),paintStrokes:d.paintStrokes?.filter(i=>i.layerId===layerProperties),blocks:d.blocks?.filter(b=>b.layerId===layerProperties),layers:d.layers.filter(l=>l.id===layerProperties),charts:d.charts?.filter(c=>c.layerId===layerProperties)};
      const selectedRecord={...record,title:name,content};
      if(kind==='txt')exportPlain(selectedRecord);
      else if(kind==='md')download(name+'.md',exportMarkdown(selectedRecord));
      else if(kind==='docx')await exportDocx(selectedRecord);
      else if(kind==='json')download(name+'.json',JSON.stringify({format:'kaerunote-layer',version:1,content},null,2),'application/json');
      else{const area=layerProperties==='note'?document.querySelector<HTMLElement>('.notes-fixed-editor'):scroll.current;
        if(area)await exportPng(area,name,node=>{const id=node.getAttribute?.('data-layer-id');if(id)return id===layerProperties;return !node.matches?.('.notes-fixed-layer,.notes-sheet-layer,.notes-chart,.notes-overlap-picker,.notes-fine-panel,[data-shape-handle]');});}
    }catch(error){notes.setError('レイヤー書き出し：'+String(error));}
  }
  function createChart(){const d=current.current?.content as StudioNoteDoc|undefined;if(!d||!sheetSelection)return;
    const range=sheetSelection.start+(sheetSelection.end!==sheetSelection.start?':'+sheetSelection.end:'');const chart:ChartItem={id:id32(),layerId:'graph-root',x:120+(scroll.current?.scrollLeft||0)/scale,y:120+(scroll.current?.scrollTop||0)/scale,w:520,h:310,type:chartType,range,visible:true,locked:false,name:'グラフ '+((d.charts||[]).length+1)};commit({...d,charts:[...(d.charts||[]),chart]} as NoteDoc);setSelected(chart.id);setChartOpen(false);setTool('select');}
  function intersectSelectedRects(){
    const d=current.current?.content;if(!d||selectedIds.length!==2)return;
    const [a,b]=selectedIds.map(id=>d.items.find(i=>i.id===id));
    if(!a||!b||a.kind!=='rect'||b.kind!=='rect'||a.rotation||b.rotation)return;
    const x=Math.max(shapeBox(a).x,shapeBox(b).x),y=Math.max(shapeBox(a).y,shapeBox(b).y);
    const right=Math.min(shapeBox(a).x+shapeBox(a).w,shapeBox(b).x+shapeBox(b).w);
    const bottom=Math.min(shapeBox(a).y+shapeBox(a).h,shapeBox(b).y+shapeBox(b).h);
    if(right<=x||bottom<=y){notes.setError('この2つの四角形は重なっていません');return;}
    commit({...d,items:d.items.filter(i=>i.id!==b.id).map(i=>i.id===a.id?{...i,x,y,w:right-x,h:bottom-y}:i)});
    setSelected(a.id);setMultiSelected([]);
  }
  function clipImageByRect(){
    const d=current.current?.content;if(!d||selectedIds.length!==2)return;
    const pair=selectedIds.map(id=>d.items.find(i=>i.id===id));
    const image=pair.find(i=>i?.kind==='image'),rect=pair.find(i=>i?.kind==='rect');
    if(!image||!rect||image.rotation||rect.rotation)return;
    const a=shapeBox(image),b=shapeBox(rect),x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
    const w=Math.min(a.x+a.w,b.x+b.w)-x,h=Math.min(a.y+a.h,b.y+b.h)-y;
    if(w<=0||h<=0){notes.setError('画像と四角形の範囲が重なっていません');return;}
    commit({...d,items:d.items.filter(i=>i.id!==rect.id).map(i=>i.id===image.id?{...i,clip:{x,y,w,h}}:i)});
    setSelected(image.id);setMultiSelected([]);
  }
  function selectGraphic(id:string,extend=false){
    if(!extend){setSelected(id);setMultiSelected([]);}
    else{
      const previous=selectedIds.filter(v=>v!==id),next=selectedIds.includes(id)?previous:[...selectedIds,id];
      setSelected(next.at(-1)||'');setMultiSelected(next.slice(0,-1));
    }
    setActiveAnchor(null);setActiveSegment(null);setFineX(0);setFineY(0);setFineAngle(0);
  }
  function editSelectedShape(updater:(i:Graphic)=>Graphic){
    const d=current.current?.content;if(!d||!selectedGraphic)return;
    commit({...d,items:d.items.map(i=>i.id===selected?updater(i) as Item:i),
      paintStrokes:d.paintStrokes?.map(i=>i.id===selected?updater(i) as PaintStroke:i)});
  }
  function clearOverlapTimer(){if(hoverTimer.current!==null){clearTimeout(hoverTimer.current);hoverTimer.current=null;}}
  function nearbyShapes(p:Point,radius=30/scale):Graphic[]{
    const d=current.current?.content;if(!d)return[];
    const shown=(g:Graphic)=>layerEditable(d,g.layerId,'layout');
    return [...d.items,...(d.paintStrokes||[])].filter(shown)
      .map((graphic,index)=>({graphic,index,distance:graphicDistance(graphic,p)}))
      .filter(entry=>entry.distance<=Math.max(radius,entry.graphic.width/2))
      .sort((a,b)=>a.distance-b.distance||b.index-a.index)
      .map(entry=>entry.graphic);
  }
  function drag(e:ReactPointerEvent,id:string,resize=false){e.preventDefault();e.stopPropagation();if(!doc||action.current||(!e.isPrimary&&e.pointerType==='touch'))return;
    const object=doc.items.find(i=>i.id===id)||doc.paintStrokes?.find(i=>i.id===id)||doc.blocks?.find(i=>i.id===id);
    if(object&&!layerEditable(doc,object.layerId,'layout'))return;
    const ids=object?(!resize&&selectedIds.includes(id)?layoutSelectedIds(doc):[id]):undefined;
    if(!selectedIds.includes(id)){setSelected(id);setMultiSelected([]);}setFocus('');typing.current=null;
    action.current={pointerId:e.pointerId,kind:resize?'resize':'move',id,ids,start:position(e),original:doc};plane.current?.setPointerCapture(e.pointerId);}
  function eraseAlong(a:Action,to:Point){
    const path=a.points||[a.start];if(Math.hypot(path.at(-1)!.x-to.x,path.at(-1)!.y-to.y)>.1)path.push(to);a.points=path;
    const next=eraseCanvasInk(a.next||a.original,path,eraserSize/2,a.layerId||'',eraserMode,a.id||'',canvasSelection&&canvasSelection.layerId===a.layerId?canvasSelection.points:undefined);
    a.start=to;
    if(next===(a.next||a.original))return;
    a.next=next;a.moved=true;notes.change(next);
  }
  function down(e:ReactPointerEvent<HTMLDivElement>){if(!doc||notes.busy||importing||organizing||meta.trashedAt||meta.importState==='pending')return;
    if(e.button===2)return;
    if(action.current||(!e.isPrimary&&e.pointerType==='touch')){e.preventDefault();return;}
    suppressClick.current=false;
    const target=e.target as Element;
    if(target.closest('button,.notes-sheet-layer'))return;
    if(target.closest('.notes-fixed-layer')&&e.pointerType!=='pen'&&!['pen','eraser','lasso','inkMove','hand'].includes(tool)&&!(e.pointerType==='touch'&&tool==='note'))return;
    const control=target.closest('[data-shape-handle]');
    if(control&&selectedGraphic){const handle=control.getAttribute('data-shape-handle')||'';e.preventDefault();e.stopPropagation();clearOverlapTimer();setOverlapItems([]);
      if(handle.startsWith('vertex:')){setActiveAnchor({id:selectedGraphic.id,index:Number(handle.slice(7))});setActiveSegment(null);}
      else setActiveSegment(null);
      action.current={pointerId:e.pointerId,kind:handle==='rotate'?'shapeRotate':handle.startsWith('vertex:')?'vertexMove':'shapeResize',handle,id:selectedGraphic.id,start:position(e),original:doc};
      e.currentTarget.setPointerCapture(e.pointerId);return;}
    if(e.pointerType==='touch'&&(tool==='pen'||tool==='eraser')&&Date.now()-lastPen.current<700){e.preventDefault();return;}
    const pen=e.pointerType==='pen';if(pen)lastPen.current=Date.now();
    const penEraser=pen&&(e.button===5||(e.buttons&32)!==0);const effective=penEraser?'eraser':pen&&(tool==='note'||tool==='text')?'pen':tool;
    if(effective==='preset'){
      const layer=writableLayer(doc,'layout'),preset=shapePresets.find(p=>p.id===shapePreset);if(!layer||!preset)return;e.preventDefault();e.stopPropagation();setFocus('');const p=snapCanvas(position(e));
      action.current={pointerId:e.pointerId,kind:'preset',start:p,original:doc,layerId:layer.id};setDraftPreset(instantiateShapePreset(preset,{...p,w:1,h:1},layer.id,id32,inkColor,layoutWidth));e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(effective==='line'||effective==='rect'||effective==='ellipse'){
      const layer=writableLayer(doc,'layout');if(!layer){notes.setError('レイアウトレイヤーを選んでください');return;}e.preventDefault();e.stopPropagation();setFocus('');typing.current=null;
      const p=snapCanvas(position(e));const item:Item={id:id32(),kind:effective,layerId:layer.id,x:p.x,y:p.y,w:0,h:0,color:inkColor,width:Math.max(1,layoutWidth),opacity:1,fill:'none'};setDraftShape(item);
      action.current={pointerId:e.pointerId,kind:'shape',start:p,original:doc,shapeKind:effective,id:item.id};e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(e.pointerType==='touch'&&(effective==='text'||effective==='note'||effective==='hand')){
      if(effective==='hand'){e.preventDefault();e.stopPropagation();}
      action.current={pointerId:e.pointerId,kind:'pan',verticalOnly:effective!=='hand',start:{x:e.clientX,y:e.clientY},original:doc,scroll:{left:scroll.current!.scrollLeft,top:scroll.current!.scrollTop}};
      if(effective==='hand')e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(effective==='pen'){
      e.preventDefault();e.stopPropagation();(document.activeElement as HTMLElement)?.blur();setFocus('');typing.current=null;
      const layer=writableLayer(doc,'canvas');if(!layer){notes.setError('キャンバスレイヤーを選んでください');return;}setActiveLayer(layer.id);if(tool!=='note'&&tool!=='text')setWorkspaceMode('canvas');
      suppressClick.current=true;
      action.current={pointerId:e.pointerId,kind:'ink',start:position(e),original:doc,points:[position(e)],pen,blockId:target.closest('[data-note-block]')?.getAttribute('data-note-block')||undefined};e.currentTarget.setPointerCapture(e.pointerId);setDraft([position(e)]);return;
    }
    if(effective==='lasso'||effective==='inkMove'){
      e.preventDefault();e.stopPropagation();(document.activeElement as HTMLElement)?.blur();setFocus('');setSelected('');setMultiSelected([]);const p=position(e),layer=writableLayer(doc,'canvas');if(!layer)return;
      const selection=canvasSelection||(effective==='inkMove'?allCanvasSelection(doc):null);
      if(selection?.layerId===layer.id&&(effective==='inkMove'||pointInPolygon(p,selection.points))){
        const base=splitInkSelection(doc,selection,id32);setCanvasSelection(selection);
        action.current={pointerId:e.pointerId,kind:'canvasMove',start:p,original:doc,selection,selectionBase:base};
      }else if(effective==='lasso'){setCanvasSelection(null);setLassoDraft([p]);action.current={pointerId:e.pointerId,kind:'lasso',start:p,original:doc,points:[p],layerId:layer.id};}
      e.currentTarget.setPointerCapture(e.pointerId);suppressClick.current=true;return;
    }
    if(effective==='eraser'){
      e.preventDefault();e.stopPropagation();(document.activeElement as HTMLElement)?.blur();setFocus('');typing.current=null;
      const p=position(e);const a:Action={pointerId:e.pointerId,kind:'erase',start:p,original:doc,pen,id:id32(),points:[p],layerId:writableLayer(doc,'canvas')?.id};action.current=a;
      e.currentTarget.setPointerCapture(e.pointerId);eraseAlong(a,p);return;
    }
    if(effective==='hand'||e.button===1){e.preventDefault();e.stopPropagation();action.current={pointerId:e.pointerId,kind:'pan',start:{x:e.clientX,y:e.clientY},original:doc,scroll:{left:scroll.current!.scrollLeft,top:scroll.current!.scrollTop}};e.currentTarget.setPointerCapture(e.pointerId);return;}
    if(effective==='select'||effective==='vertex'||effective==='magic'){
      const p=position(e),close=nearbyShapes(p,Math.max(10,13/scale)),near=nearbyShapes(p,35/scale);
      const nodeId=target.closest('[data-note-block]')?.getAttribute('data-note-block');
      const domId=target.closest('[data-stroke]')?.getAttribute('data-stroke');
      const id=nodeId||close[0]?.id||domId||'';
      clearOverlapTimer();setOverlapItems([]);setOverlapOpen(false);
      if(e.pointerType==='touch'&&near.length>1){
        const at={...p},ids=near.map(i=>i.id);
        hoverTimer.current=setTimeout(()=>{setOverlapItems(ids);setOverlapAt(at);setOverlapOpen(false);},600);
      }
      if(id){
        const graphic=doc.items.find(i=>i.id===id)||doc.paintStrokes?.find(i=>i.id===id),object=graphic||doc.blocks?.find(b=>b.id===id);if(!object||!layerEditable(doc,object.layerId,'layout'))return;
        if(multiMode){e.preventDefault();selectGraphic(id,true);return;}
        if(e.shiftKey){e.preventDefault();e.stopPropagation();const present=selectedIds.includes(id);if(!present)selectGraphic(id,true);setFocus('');typing.current=null;
          action.current={pointerId:e.pointerId,kind:'move',id,ids:[...new Set([...layoutSelectedIds(doc),id])],shiftToggle:present?id:undefined,start:p,original:doc};e.currentTarget.setPointerCapture(e.pointerId);return;}
        if(effective==='vertex'&&graphic){
          const local=graphicInversePoint(graphic,p),segment=nearestSegment(graphic,local);
          selectGraphic(id);
          if(segment&&segment.distance<=Math.max(10,13/scale)){
            setActiveSegment({id,index:segment.index});setActiveAnchor(null);
            e.preventDefault();action.current={pointerId:e.pointerId,kind:'segmentMove',handle:'segment:'+segment.index,id,start:p,original:doc};
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          return;
        }
        if(!selectedIds.includes(id))selectGraphic(id);
        drag(e,id);
      }else{setSelected('');setMultiSelected([]);setActiveAnchor(null);setActiveSegment(null);}
      return;
    }
    if(effective==='text'&&!target.closest('[data-note-block]')){
      const layer=writableLayer(doc,'layout');if(!layer)return;e.preventDefault();const p=position(e),b={...block(p.x,p.y),layerId:layer.id};commit({...doc,blocks:[...(doc.blocks||[]),b]});setFocus(b.id);setSelected(b.id);
    }
  }
  function move(e:ReactPointerEvent<HTMLDivElement>){
    const a=action.current;
    if(tool==='eraser'||a?.kind==='erase')setEraserCursor(position(e));
    if(!a){
      if((tool==='select'||tool==='vertex'||tool==='magic')&&workspaceMode==='layout'&&!(e.target as Element).closest('.notes-overlap-picker')){
        const p=position(e);
        // Keep the nearby-object button alive while the user moves the cursor toward it.
        if(overlapAt&&overlapItems.length>1&&Math.hypot(p.x-overlapAt.x,p.y-overlapAt.y)<110/scale)return;
        const hit=nearbyShapes(p,Math.max(10,13/scale)),matches=nearbyShapes(p,35/scale);
        setHoveredShape(hit[0]?.id||'');
        clearOverlapTimer();
        if(matches.length>1){
          const ids=matches.map(i=>i.id),at={...p};
          hoverTimer.current=setTimeout(()=>{setOverlapItems(ids);setOverlapAt(at);setOverlapOpen(false);},600);
        }else{setOverlapItems([]);setOverlapAt(null);setOverlapOpen(false);}
      }
      return;
    }
    if(a.pointerId!==e.pointerId)return;e.preventDefault();
    if(a.pen)lastPen.current=Date.now();
    if(a.kind==='preset'){const p=snapCanvas(position(e)),preset=shapePresets.find(value=>value.id===shapePreset);if(!preset)return;let w=Math.abs(p.x-a.start.x),h=Math.abs(p.y-a.start.y);if(e.shiftKey){h=w*preset.h/preset.w;}setDraftPreset(instantiateShapePreset(preset,{x:Math.min(p.x,a.start.x),y:Math.min(p.y,a.start.y),w,h},a.layerId!,id32,inkColor,layoutWidth));return;}
    if(a.kind==='lasso'){const p=position(e);if(Math.hypot(p.x-a.points!.at(-1)!.x,p.y-a.points!.at(-1)!.y)>2/scale){a.points!.push(p);setLassoDraft([...a.points!]);}return;}
    if(a.kind==='canvasMove'){const p=position(e);let dx=p.x-a.start.x,dy=p.y-a.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}if(!a.moved&&Math.hypot(dx,dy)<2/scale)return;a.moved=true;suppressClick.current=true;const base=a.selectionBase!;if(base.ids.length)notes.change(moveInkSelection(base.doc,base.ids,dx,dy));setCanvasSelection({...a.selection!,ids:base.ids,points:translatePolygon(a.selection!.points,dx,dy)});return;}
    if(a.kind==='erase'){for(const p of coalescedPositions(e))eraseAlong(a,p);return;}
    if(a.kind==='pan'){const dx=e.clientX-a.start.x,dy=e.clientY-a.start.y;if(Math.hypot(dx,dy)<6)return;suppressClick.current=true;scroll.current!.scrollTo(a.scroll!.left-(a.verticalOnly?0:dx),a.scroll!.top-dy);return;}
    const p=a.kind==='ink'||a.kind==='shapeRotate'?position(e):snapCanvas(position(e));if(a.kind==='ink'){for(const point of coalescedPositions(e)){const last=a.points!.at(-1)!;if(Math.hypot(point.x-last.x,point.y-last.y)>.35){a.points!.push(point);}}setDraft([...a.points!]);return;}
    if(a.kind==='shape'){const point=snapCanvas(p);setDraftShape(old=>old?{...old,w:point.x-a.start.x,h:point.y-a.start.y}:old);return;}
    const distance=Math.hypot(p.x-a.start.x,p.y-a.start.y);
    if(hoverTimer.current&&distance>7)clearOverlapTimer();
    if(distance<(e.pointerType==='touch'?5/scale:.7)&&!a.moved)return;
    a.moved=true;
    const original=a.original as StudioNoteDoc;
    if(a.kind==='shapeResize'||a.kind==='shapeRotate'||a.kind==='vertexMove'||a.kind==='segmentMove'){
      const originalGraphic:Graphic|undefined=original.items.find(i=>i.id===a.id)||original.paintStrokes?.find(i=>i.id===a.id);
      if(!originalGraphic)return;
      const b=graphicBox(originalGraphic),center={x:b.x+b.w/2,y:b.y+b.h/2};
      let altered:Graphic=originalGraphic;
      if(a.kind==='shapeRotate'){
        const initialAngle=Math.atan2(a.start.y-center.y,a.start.x-center.x),angle=Math.atan2(p.y-center.y,p.x-center.x);
        altered={...originalGraphic,rotation:(originalGraphic.rotation||0)+(angle-initialAngle)*180/Math.PI};
      }else{
        const start=graphicInversePoint(originalGraphic,a.start),end=graphicInversePoint(originalGraphic,p);
        const dx=end.x-start.x,dy=end.y-start.y;
        if(a.kind==='shapeResize'){
          const h=a.handle||'',edge={left:b.x,right:b.x+b.w,top:b.y,bottom:b.y+b.h};
          if(h.includes('w'))edge.left=Math.min(edge.right-6,edge.left+dx);
          if(h.includes('e'))edge.right=Math.max(edge.left+6,edge.right+dx);
          if(h.includes('n'))edge.top=Math.min(edge.bottom-6,edge.top+dy);
          if(h.includes('s'))edge.bottom=Math.max(edge.top+6,edge.bottom+dy);
          altered=resizedGraphic(originalGraphic,b,{x:edge.left,y:edge.top,w:edge.right-edge.left,h:edge.bottom-edge.top});
        }else if(a.kind==='vertexMove'){
          const index=Number((a.handle||'').split(':')[1]),vertex=graphicVertices(originalGraphic)[index];
          if(!vertex)return;
          altered=updateGraphicVertex(originalGraphic,index,{x:vertex.x+dx,y:vertex.y+dy});
        }else altered=updateGraphicSegment(originalGraphic,Number((a.handle||'').split(':')[1]),dx,dy);
      }
      notes.change({...original,items:original.items.map(i=>i.id===a.id?altered as Item:i),
        paintStrokes:original.paintStrokes?.map(i=>i.id===a.id?altered as PaintStroke:i)} as NoteDoc);return;
    }
    let dx=p.x-a.start.x,dy=p.y-a.start.y;
    if(a.kind==='move'&&e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
    if(a.kind==='move'&&a.ids?.length){notes.change(moveLayoutSelection(original,a.ids,dx,dy));return;}
    const next={...original,blocks:original.blocks?.map(b=>b.id===a.id?a.kind==='resize'?{...b,w:Math.max(220,Math.min(1800,b.w+dx))}:{...b,x:Math.max(0,b.x+dx),y:Math.max(0,b.y+dy)}:b),
      items:original.items.map(i=>i.id===a.id?translateShape(i,dx,dy):i),
      paintStrokes:original.paintStrokes?.map(stroke=>(stroke.id===a.id || (stroke.blockId===a.id && a.kind==='move'))?{...stroke,points:stroke.points.map(point=>({...point,x:point.x+dx,y:point.y+dy}))}:stroke),
      charts:(original.charts||[]).map(c=>c.id===a.id?{...c,x:c.x+dx,y:c.y+dy}:c)};
    notes.change(next as NoteDoc);
  }
  function up(e:ReactPointerEvent<HTMLDivElement>,cancel=false){const a=action.current;if(!a||a.pointerId!==e.pointerId)return;action.current=null;
    if(plane.current?.hasPointerCapture(e.pointerId))plane.current.releasePointerCapture(e.pointerId);
    if(a.shiftToggle&&!a.moved&&!cancel)selectGraphic(a.shiftToggle,true);
    if(a.kind==='preset'){const values=draftPreset;setDraftPreset([]);if(!cancel&&values.length&&Math.hypot(position(e).x-a.start.x,position(e).y-a.start.y)>2){commit({...a.original,items:[...a.original.items,...values]});setSelected(values[0].id);setMultiSelected(values.slice(1).map(i=>i.id));setActiveLayer(a.layerId!);}return;}
    if(a.kind==='lasso'){setLassoDraft([]);if(!cancel&&a.points!.length>=3&&polygonArea(a.points!)>4)setCanvasSelection({points:a.points!,layerId:a.layerId!});return;}
    if(a.kind==='canvasMove'){if(cancel){if(a.moved&&a.selectionBase?.ids.length)notes.change(a.original);setCanvasSelection(a.selection!);}else if(a.moved&&a.selectionBase?.ids.length){undoStack.current=[...undoStack.current.slice(-39),a.original];redoStack.current=[];redraw(v=>v+1);}return;}
    if(a.kind==='erase'){
      if(!cancel)eraseAlong(a,position(e));
      if(a.moved){if(cancel)notes.change(a.original);else{undoStack.current=[...undoStack.current.slice(-39),a.original];redoStack.current=[];}redraw(v=>v+1);}
      if(a.pen)lastPen.current=Date.now();return;
    }
    if(a.kind==='ink'){
      if(!cancel){const points=a.points!;if(points.length===1)points.push({...points[0],x:points[0].x+.2});
        const layer=writableLayer(a.original,'canvas');if(!layer){notes.setError('キャンバスレイヤーを選んでください');setDraft([]);return;}
        commit({...a.original,paintStrokes:[...(a.original.paintStrokes||[]),{id:id32(),layerId:layer.id,points,color:inkColor,width:inkWidth,opacity:(brush==='marker'?.32:1)*inkOpacity,blockId:a.blockId,brush,pressure:inkPressure,...(canvasSelection?.layerId===layer.id?{inkMasks:[inkPolygonMask({id:'draft',layerId:layer.id,points,color:inkColor,width:inkWidth,opacity:inkOpacity},canvasSelection.points,'include')]}:{})}]});}
      setDraft([]);if(a.pen)lastPen.current=Date.now();return;
    }
    if(a.kind==='shape'){const shape=draftShape;setDraftShape(null);if(!cancel&&shape&&Math.hypot(shape.w,shape.h)>2){commit({...a.original,items:[...a.original.items,shape]});setSelected(shape.id);setActiveLayer(shape.layerId);}return;}
    if(a.kind==='move'||a.kind==='resize'||a.kind==='shapeResize'||a.kind==='shapeRotate'||a.kind==='vertexMove'||a.kind==='segmentMove'){if(cancel&&a.moved)notes.change(a.original);else if(a.moved){undoStack.current=[...undoStack.current.slice(-39),a.original];redoStack.current=[];redraw(v=>v+1);}}
  }
  function restoreFormatSelection(){
    const live=window.getSelection();const range=selectedNoteRoot()&&live?.rangeCount?live.getRangeAt(0).cloneRange():formatCaret.current;if(!range?.startContainer.isConnected)return;
    const node=range.startContainer,element=node instanceof Element?node:node.parentElement;
    const root=element?.closest<HTMLElement>('.notes-fixed-editor,.note-content');
    if(!root||root.getAttribute('contenteditable')!=='true')return;
    root.focus();const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
  }
  function format(command:string,value?:string){
    restoreFormatSelection();
    typing.current=null;
    document.execCommand(command,false,value);
    const el=document.activeElement as HTMLElement;
    const id=el?.closest?.('[data-note-block]')?.getAttribute('data-note-block');
    if(id)updateBlock(id,el.innerHTML,el.scrollHeight+54);
    const fixed=el?.closest?.('.notes-fixed-editor') as HTMLElement|null;
    if(fixed)updateFixedNote(fixed.innerHTML);
  }
  function openWorkspaceMenu(target:Element,x:number,y:number){
    const selection=window.getSelection(),root=target.closest<HTMLElement>('.notes-fixed-editor,.note-content');
    const selectedRange=root&&selection?.rangeCount&&root.contains(selection.getRangeAt(0).commonAncestorContainer)?selection.getRangeAt(0).cloneRange():null;
    const range=root?.getAttribute('contenteditable')==='true'?selectedRange:null;
    if(range)formatCaret.current=range.cloneRange();
    let copyText=selectedRange?.toString()||'';
    if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement)copyText=target.value.slice(target.selectionStart||0,target.selectionEnd||0);
    const graphicId=target.closest('[data-stroke]')?.getAttribute('data-stroke');
    if(graphicId&&!selectedIds.includes(graphicId))selectGraphic(graphicId);
    setWorkspaceMenu({x,y,noteId:record?.id||'',range,copyText});
  }
  async function clipboardWorkspace(action:'copy'|'cut'|'paste'){
    const menu=workspaceMenu;if(!menu)return;
    try{
      // Write first: a rejected clipboard request must never remove local text.
      if(action!=='paste')await navigator.clipboard.writeText(menu.copyText);
      const text=action==='paste'?await navigator.clipboard.readText():'';
      if(action==='copy')return;
      const latest=current.current;
      if(!latest||latest.id!==notes.resolveId(menu.noteId)||organizingRef.current||latest.content.note?.trashedAt)throw new Error('編集先が変わりました。もう一度右クリックしてください。');
      if(menu.range){
        const node=menu.range.startContainer,element=node instanceof Element?node:node.parentElement;
        const root=element?.closest<HTMLElement>('.notes-fixed-editor,.note-content');
        if(!root||!node.isConnected||root.getAttribute('contenteditable')!=='true')throw new Error('入力位置が変わりました。もう一度右クリックしてください。');
        root.focus();const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(menu.range);formatCaret.current=menu.range;
        format(action==='cut'?'delete':'insertText',text);
      }else if(action==='paste'&&tool==='sheet')pasteIntoSheet(text);
      else if(action==='paste'&&workspaceMode!=='note'&&text)addBlock(escapeHTML(text).replace(/\n/g,'<br>'));
    }catch(error){notes.setError('クリップボードを利用できません。'+(error instanceof Error?error.message:'キーボードのコピー・貼り付けも使えます。'));}
  }
  function workspaceMenuItems():WorkspaceMenuItem[]{
    const editable=!!doc&&!notes.busy&&!organizing&&!importing&&!attaching&&!meta.trashedAt&&meta.importState!=='pending';
    const menu=workspaceMenu!;
    const items:WorkspaceMenuItem[]=[];
    if(!sharedAccess)items.push(
      {id:'navigation',label:sidebar?'左メニューを隠す':'左メニューを表示',icon:<PanelLeft size={16}/>,onSelect:toggleSidebar},
      {id:'categories',label:'カテゴリ・Noteを選ぶ',icon:<Folder size={16}/>,disabled:organizing||importing||attaching,onSelect:()=>{if(focusMode){setFocusMode(false);setLayersOpen(focusRestore.current.layersOpen);}setSidebar(true);setTrash(false);setCategoryBrowserOpen(true);}},
      {id:'new',label:'このカテゴリに新規Note',icon:<Plus size={16}/>,disabled:!editable,onSelect:()=>void createNote()});
    if(menu.range||menu.copyText)items.push(
      {id:'copy',label:'コピー',icon:<Copy size={16}/>,separatorBefore:true,disabled:!menu.copyText,onSelect:()=>void clipboardWorkspace('copy')},
      {id:'cut',label:'切り取り',disabled:!editable||!menu.range||!menu.copyText,onSelect:()=>void clipboardWorkspace('cut')});
    if(menu.range||workspaceMode!=='note')items.push({id:'paste',label:'貼り付け',disabled:!editable,onSelect:()=>void clipboardWorkspace('paste')});
    if(menu.range)items.push({id:'bold',label:'太字',icon:<Bold size={16}/>,disabled:!editable,onSelect:()=>{formatCaret.current=menu.range;format('bold');}});
    items.push(
      {id:'undo',label:'元に戻す',icon:<Undo2 size={16}/>,separatorBefore:true,disabled:!editable||!undoStack.current.length,onSelect:undo},
      {id:'redo',label:'やり直す',icon:<Redo2 size={16}/>,disabled:!editable||!redoStack.current.length,onSelect:redo},
      {id:'details',label:(workspaceMode==='note'?'Note':'Canvas')+'の詳細'+((workspaceMode==='note'?advancedOpen:canvasDetailsOpen)?'を閉じる':'を表示'),icon:<Settings2 size={16}/>,separatorBefore:true,onSelect:()=>workspaceMode==='note'?setAdvancedOpen(open=>!open):setCanvasDetailsOpen(open=>!open)});
    if(workspaceMode!=='note')items.push(
      {id:'pen',label:'ペン',icon:<Pencil size={16}/>,disabled:!editable,onSelect:()=>chooseTool('pen')},
      {id:'select',label:'図形を選択',icon:<MousePointer2 size={16}/>,disabled:!editable,onSelect:()=>chooseTool('select')},
      {id:'hand',label:'画面を移動',icon:<Hand size={16}/>,onSelect:()=>chooseTool('hand')},
      {id:'zoom-in',label:'拡大',icon:<ZoomIn size={16}/>,separatorBefore:true,disabled:scale>=4,onSelect:()=>zoomTo(scale+.1)},
      {id:'zoom-out',label:'縮小',icon:<ZoomOut size={16}/>,disabled:scale<=.2,onSelect:()=>zoomTo(scale-.1)},
      {id:'zoom-reset',label:'倍率を100%に戻す',onSelect:()=>zoomTo(1)});
    if(selectedShape)items.push(
      {id:'front',label:'選択図形を最前面へ',separatorBefore:true,disabled:!editable||!!doc?.layers.find(layer=>layer.id===selectedShape.layerId)?.locked,onSelect:()=>reorderGraphic('front')},
      {id:'back',label:'選択図形を最背面へ',disabled:!editable||!!doc?.layers.find(layer=>layer.id===selectedShape.layerId)?.locked,onSelect:()=>reorderGraphic('back')});
    return items;
  }
  function chooseFont(delta:number){
    const next=Math.max(1,Math.min(7,fontStep+delta));
    setFontStep(next);format('fontSize',String(next));
  }
  function applyBullets(size:'large'|'medium'|'small'){
    restoreFormatSelection();setBulletSize(size);
    const element=window.getSelection()?.anchorNode?.parentElement;
    let list=element?.closest('ul');
    if(!list){format('insertUnorderedList');list=window.getSelection()?.anchorNode?.parentElement?.closest('ul')||null;}
    if(!list)return;
    list.classList.add('kn-bullet-list');
    list.setAttribute('data-kn-list',size);
    list.closest('.notes-fixed-editor,.note-content')?.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function openTableSettings(kind:'table'|'columns',edit=false){
    editingTable.current=edit;
    const selection=window.getSelection();
    savedCaret.current=selection?.rangeCount&&selectedNoteRoot()?selection.getRangeAt(0).cloneRange():null;
    const table=edit?(currentTable()||lastTable.current):null;
    if(table){
      const values=Array.from(table.rows);
      setTableOpts({
        kind:table.getAttribute('data-kn-layout')==='columns'?'columns':'table',
        rows:values.length,cols:values[0]?.cells.length||1,
        width:Number(table.getAttribute('data-kn-width'))||100,
        align:(table.getAttribute('data-kn-align') as TableOptions['align'])||'fit',
        height:table.getAttribute('data-kn-height')==='auto'?'auto':'fixed',
        lines:Number(table.getAttribute('data-kn-height'))||4,
        flow:table.getAttribute('data-kn-flow')==='next'?'next':'expand'
      });
    }else setTableOpts(o=>({...o,kind}));
    setTableOpen(true);
  }
  function applyTable(){
    const selection=window.getSelection();
    if(savedCaret.current&&selection){
      selection.removeAllRanges();selection.addRange(savedCaret.current);
    }
    const current=lastTable.current;
    if(editingTable.current&&current&&current.isConnected){
      setTableOptions(current,tableOpts);
    }else insertRichHTML(tableMarkup(tableOpts));
    editingTable.current=false;savedCaret.current=null;setTableOpen(false);
  }
  useEffect(()=>{
    const onSelect=()=>{
      const selected=currentTable(),cell=currentCell();
      if(selected){lastTable.current=selected;lastCell.current=cell;}
      const anchor=window.getSelection()?.anchorNode;const anchorElement=anchor instanceof Element?anchor:anchor?.parentElement;
      const isInNote=!!anchorElement?.closest('.notes-fixed-editor,.note-content');
      const selection=window.getSelection();if(isInNote&&selection?.rangeCount)formatCaret.current=selection.getRangeAt(0).cloneRange();
      setTableSelected(!!selected&&isInNote);
    };
    document.addEventListener('selectionchange',onSelect);
    return()=>document.removeEventListener('selectionchange',onSelect);
  },[]);
  function ruby(skipPrompt=false){
    restoreFormatSelection();
    const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null;
    const selected=selectedString().trim();if(!selected){notes.setError('ルビを付ける文字を選択してください');return;}
    const memoryKey='kaerunote-ruby:'+selected,remembered=localStorage.getItem(memoryKey)||'';
    const reading=skipPrompt&&remembered?remembered:window.prompt('「'+selected+'」の読みがな',remembered);
    if(!reading)return;
    localStorage.setItem(memoryKey,reading);
    if(range&&selection){selection.removeAllRanges();selection.addRange(range);}
    applyRuby(reading,rubyColor);
  }
  useEffect(()=>{
    if(!settings&&!relatedPanel)return;
    let mounted=true;
    void api('/api/ai').then(r=>r.json()).then((status:{configured:boolean})=>{if(mounted)setAiConfigured(!!status.configured);})
      .catch(()=>{if(mounted)setAiConfigured(false);});
    return()=>{mounted=false;};
  },[settings,relatedPanel]);
  async function callChatGPT(action:'organize'|'related',send=true){
    const currentRecord=current.current;
    if(!currentRecord||currentRecord.id.startsWith('local-')){notes.setError('ChatGPT接続は最初にノートをサーバーへ保存してください');return;}
    if(!networkAvailable()){notes.setError('AI処理にはネット接続が必要です。メモの編集はオフラインで続けられます');return;}
    if(send&&!window.confirm(action==='related'?'このノートと関連候補のタイトル・本文抜粋をOpenAI APIへ送信します。続けますか？':'このノートの内容をOpenAI APIへ送信して整理します。続けますか？'))return;
    aiTarget.current=currentRecord.id;setAiBusy(true);
    try{
      await notes.save();
      if(current.current?.id!==currentRecord.id)throw new Error('解析対象のノートを切り替えたため中止しました');
      if(current.current?.dirty||notes.conflict)throw new Error('同期が終わっていません。保存完了を確認してください');
      const response=await api('/api/ai/'+action,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:currentRecord.id})});
      const result=await response.json();
      if(current.current?.id!==currentRecord.id)throw new Error('解析対象のノートを切り替えたため結果を反映しませんでした');
      if(action==='organize')setAiResult(String(result.text||''));
      else{
        const related=(result.related as {id:string;reason:string}[]||[])
          .filter(item=>notes.list.some(n=>n.id===item.id)).slice(0,8);
        const d=current.current?.content;if(d){
          commit({...d,note:{category:'',tags:[],...d.note,relatedNotes:related}});
          setRelatedPanel(true);setLayersOpen(true);
        }
        if(!related.length)notes.setError('AIが確実に関連付けられるノートはありませんでした');
      }
    }catch(e){notes.setError('ChatGPT解析：'+String(e));}
    finally{setAiBusy(false);}
  }
  async function transcribeAudio(file:File){
    if(!file)return;
    if(!networkAvailable()){notes.setError('音声文字起こしにはネット接続が必要です');return;}
    if(!window.confirm('この音声をOpenAI APIへ送信して文字起こしします。続けますか？'))return;
    aiTarget.current=current.current?.id||'';setAiBusy(true);
    try{
      const form=new FormData();form.set('audio',file);
      const response=await api('/api/ai/transcribe',{method:'POST',body:form});
      const result=await response.json() as {text:string};
      if(current.current?.id!==aiTarget.current)throw new Error('対象のノートを切り替えたため結果を反映しませんでした');
      setAiResult(result.text||'');
    }catch(e){notes.setError('文字起こし：'+String(e));}
    finally{setAiBusy(false);}
  }
  function insertAIResult(){
    const d=current.current?.content as StudioNoteDoc|undefined;
    if(!d||!aiResult.trim())return;
    if(current.current?.id!==aiTarget.current){notes.setError('AI結果を生成したノートを開いてから挿入してください');return;}
    const fixed=d.fixedNote||{html:'',visible:true,locked:false};
    commit({...d,fixedNote:{...fixed,html:fixed.html+'<h2>AI整理結果</h2><p>'+escapeHTML(aiResult).replace(/\n/g,'<br>')+'</p>'}} as NoteDoc);
    setAiResult('');
  }
  async function prepareOffline(){
    if(offlinePreparing)return;
    setOfflinePreparing(true);setOfflineProgress(null);
    try{
      if(!await ensureOfflineShell())throw new Error('このブラウザでは画面を端末に保存できません');const result=await notes.prepareOffline(true,setOfflineProgress);
      notes.setError(result.errors
        ?'端末への準備：'+result.done+'件・添付'+result.files+'件を保存。'+result.errors+'件は保存できませんでした（空き容量や権限を確認してください）'
        :'オフライン準備完了：'+result.done+'件のノートと添付'+result.files+'件を端末へ保存しました');
    }catch(err){notes.setError('オフライン準備：'+String(err));}
    finally{setOfflinePreparing(false);}
  }
  async function openRevisions(){
    if(!record)return;
    try{setRevisions(await listLocalRevisions(record.id));setRevisionsOpen(true);}
    catch(error){notes.setError('端末の履歴を開けません：'+String(error));}
  }
  async function restoreRevision(snapshot:LocalRevision){
    if(!window.confirm(new Date(snapshot.createdAt).toLocaleString('ja-JP')+'の内容に戻しますか？ 現在の状態も履歴に残します。'))return;
    const before=current.current;if(!before)return;
    try{
      await saveLocalRevision({...before,base:before.content,dirty:!!before.dirty,owner:true,accountId});
      if(current.current!==before){notes.setError('復元前の保存中に編集されました。もう一度復元してください');return;}
      notes.change(snapshot.content as NoteDoc,snapshot.title);await notes.save();setRevisionsOpen(false);
    }catch(err){notes.setError('復元前の履歴を保存できません：'+String(err));}
  }
  async function attach(files:File[]){
    const initial=current.current;
    if(!initial||initial.content.note?.importState==='pending'||initial.content.note?.trashedAt||organizing||attaching)return;
    setAttaching(true);
    try{
      let working=initial.content as StudioNoteDoc;
      let layer=working.layers.find(l=>l.id===activeLayer&&l.studioKind==='layout'&&l.visible&&!l.locked)||
        working.layers.find(l=>l.studioKind==='layout'&&l.visible&&!l.locked);
      for(const file of files){
        if(file.size===0||file.size>512*1024*1024)throw new Error('添付は1バイト～512MBです');
        const a:Attachment={id:id32(),name:file.name,mime:file.type||'application/octet-stream',size:file.size,pending:true};
        await putLocalImage(a.id,file);
        working=(current.current?.content||working) as StudioNoteDoc;
        const encoded=escapeHTML(file.name),html=file.type.startsWith('image/')
          ?'<p class="kn-image-wrap-'+imageAlign+'"><img data-kn-local-image="'+a.id+'" alt="'+encoded+'"></p>'
          :'<p><a href="#" data-kn-local-file="'+a.id+'">'+encoded+'</a></p>';
        if(workspaceMode==='note'){
          const fixed=working.fixedNote||{html:'',visible:true,locked:false};
          working={...working,fixedNote:{...fixed,html:fixed.html+html},attachments:[...(working.attachments||[]),a]};
        }else{
          if(!layer){
            layer={id:id32(),name:'レイアウト 1',visible:true,locked:false,studioKind:'layout'};
            working={...working,layers:[...working.layers,layer]};
          }
          const y=Math.max(80,...(working.blocks||[]).map(b=>b.y+b.h+30));
          const b={...block(80,y,html),layerId:layer.id};
          working={...working,blocks:[...(working.blocks||[]),b],attachments:[...(working.attachments||[]),a]};
        }
        commit(working as NoteDoc);
      }
      // IndexedDB stores the actual binary even without any connection.
      // On reconnect useNotes uploads pending attachments and clears their flag.
      if(networkAvailable())void notes.save();
    }catch(err){notes.setError(err instanceof Error?err.message:'添付できません');}
    finally{setAttaching(false);}
  }
  function saveAttachment(id:string,fallbackName:string){
    if(!record)return;
    const asset=doc?.attachments?.find(a=>a.id===id)||{id,name:fallbackName};
    void readNoteAsset(record.id,{...asset,kind:'file'},sharedAccess?.token).then(blob=>saveBlob(asset.name,blob)).catch(err=>notes.setError('添付を保存できません：'+String(err)));
  }
  function changeMeta(patch:Partial<NoteMeta>){if(!doc||meta.trashedAt||organizing)return;const next={...meta,...patch};
    next.organizationLog=[...(meta.organizationLog||[]).slice(-99),{at:new Date().toISOString(),category:next.category,tags:next.tags}];commit({...doc,note:next});}
  async function loadJex(file:File){setImportMessage('JEXを確認しています…');try{const value=await readJex(file);setArchive(value);setImportMessage('');}catch(err){setImportMessage(String(err));}}
  async function runImport(){if(!archive)return;cancelImport.current=false;setImporting(true);
    try{await notes.save();const existing=await notes.refresh();const result=await importJex(archive,existing,setImportMessage,()=>cancelImport.current,accountId);
      setImportMessage(`${result.completed}件を取り込みました。取り込み済み ${result.skipped}件は重複を避けてスキップしました。`);setArchive(null);const rows=await notes.refresh();if(networkAvailable())for(const row of rows)if(row.note?.importState==='complete')void notes.save(row.id);
    }catch(err){setImportMessage(err instanceof Error?err.message:'取り込みに失敗しました');await notes.refresh().catch(()=>{});}finally{setImporting(false);}}
  async function applyOrganization(file:File){try{
    if(file.size>2_000_000)throw new Error('整理ファイルが大きすぎます');
    const payload=JSON.parse(await file.text()) as {version:number;notes:{id:string;category:string;tags:string[];revision:number}[]};
    if(!payload||payload.version!==1||!Array.isArray(payload.notes))throw new Error('整理ファイルの形式が不正です');
    const seen=new Set<string>();for(const entry of payload.notes){if(!/^(?:local-)?[a-f0-9]{32}$/.test(entry.id)||seen.has(entry.id)||typeof entry.category!=='string'||entry.category.length>200||!Array.isArray(entry.tags)||entry.tags.length>50||entry.tags.some(t=>typeof t!=='string'||t.length>80)||!Number.isInteger(entry.revision))throw new Error('分類・タグ・IDの形式が不正です');seen.add(entry.id);}
    const changed=await assignPages(payload.notes,true);
    notes.setError(`分類を${changed}件、端末に反映しました`);
  }catch(err){notes.setError(String(err));}}
  async function exportAll(throwErrors=false){try{await notes.persistPending();const rows=networkAvailable()?await notes.refresh(true):notes.list;const texts:string[]=[];const entries:{id:string;category:string;tags:string[];revision:number}[]=[];
    for(const n of rows.filter(n=>!n.note?.trashedAt)){const r=await notes.readForExport(n.id);
      texts.push(exportMarkdown(r));entries.push({id:r.id,category:r.content.note?.category||'',tags:r.content.note?.tags||[],revision:r.revision});}
    download('Canvas-メモ整理.md',texts.join('\n\n<!-- 次のメモ -->\n\n'));download('Canvas-分類.json',JSON.stringify({version:1,notes:entries},null,2),'application/json');
  }catch(err){if(throwErrors)throw err;notes.setError(String(err));}}
  const categories=categoryPaths([...(workspace?.categories||[]),...notes.list.map(n=>n.note?.category||'')]);
  const tags=[...new Set(notes.list.filter(n=>!n.note?.trashedAt).flatMap(n=>n.note?.tags||[]))].sort();
  const searching=query.trim().length>0;
  const filtered=notes.list.filter(n=>Boolean(n.note?.trashedAt)===trash &&
    ((searching&&searchScope==='all')||((!category||(includeChildren?inCategory(n.note?.category||'',category):(n.note?.category||'')===category))&&(!tag||n.note?.tags?.includes(tag)))) &&
    matchesSearch(`${n.title} ${n.searchText||''} ${n.note?.category||''} ${(n.note?.tags||[]).join(' ')}`,query))
    .sort((a,b)=>Number(!!b.note?.pinned)-Number(!!a.note?.pinned)||b.updated_at-a.updated_at);
  function navigateCategory(path:string){setCategoryBrowserOpen(true);setCategory(path);setTrash(false);setQuery('');setTag('');}
  function collapseCategoryBrowser(){setCategoryBrowserOpen(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.notes-category-open')?.focus({preventScroll:true}));}
  function finishNoteSelection(){if(workspaceView==='drawing'){setCategoryBrowserOpen(false);setWorkspaceMode('canvas');setTool('pen');}else useNoteLayer();if(sidebarAutoClose)setSidebar(false);requestAnimationFrame(()=>requestAnimationFrame(()=>{const active=document.activeElement;if(workspaceView==='drawing'||active&&active!==document.body&&!active.classList.contains('notes-fixed-editor'))return;document.querySelector<HTMLElement>('.notes-fixed-editor[contenteditable=true]')?.focus();}));}
  async function openNote(id:string){(document.activeElement as HTMLElement)?.blur();if(await notes.open(id))finishNoteSelection();}
  async function createNote(){try{(document.activeElement as HTMLElement)?.blur();await notes.persistPending();setTrash(false);setQuery('');setTag('');const next=notesNew();await notes.create(next);finishNoteSelection();}catch(error){notes.setError(String(error));}}
  function notesNew(){const next=blankNote();next.note={category,tags:[]};return next;}
  const browsingNotes=categoryBrowserOpen&&!trash;
  function noteList(){return <div className="notes-list">{filtered.map(n=><button key={n.id} className={`notes-list-item ${n.id===record?.id?'active':''}`} disabled={importing||attaching||notes.busy||organizing} onClick={()=>void openNote(n.id)}>
    <strong><FileText size={17}/>{n.note?.pinned&&<Pin size={13}/>} {n.title||'新しいメモ'}</strong><p>{searching?searchExcerpt(n.searchText||n.excerpt||'',query):n.excerpt||'テキストのないメモ'}</p><footer><time>{new Date(n.updated_at).toLocaleDateString('ja-JP',{month:'short',day:'numeric'})}</time><span title={n.note?.category}>{n.note?.category||'未分類'}</span>{n.note?.importState==='pending'&&<em>取込途中</em>}</footer></button>)}
    {!filtered.length&&<div className="notes-empty"><FileText size={27}/><p>{browsingNotes&&!searching?'このフォルダにはNoteがありません。':'該当するNoteはありません。'}</p>{browsingNotes&&<small>「新規Note」で作成できます。</small>}</div>}</div>;}
  function categoryScope(){return <label><input type="checkbox" checked={includeChildren} onChange={e=>setIncludeChildren(e.target.checked)}/>子カテゴリを含める</label>;}
  const folderNotePicker=<section className="notes-folder-note-picker" aria-label="選択フォルダのNote一覧">
    <header><div><small>NOTE</small><h2>{category.split(' / ').at(-1)||'すべてのNote'}</h2><span>{filtered.length} 件</span></div>
      <button className="notes-folder-new" aria-label="＋ このカテゴリに新規ノート" disabled={importing||attaching||notes.busy||organizing} onClick={()=>void createNote()}><Plus size={16}/>新規Note</button></header>
    <div className="notes-folder-scope">{categoryScope()}{searching&&searchScope==='all'&&<small>全カテゴリの検索結果</small>}</div>
    {noteList()}
    <footer role="status">分類：{{saved:'保存済み',syncing:'同期中',pending:'端末に保存済み・同期待ち',conflict:'競合あり',complete:'同期完了'}[classificationStatus]}</footer>
  </section>;
  function setTrashed(value:boolean){if(!doc||organizing||attaching||importing||notes.busy)return;
    (document.activeElement as HTMLElement)?.blur();
    const latest=current.current?.content;if(!latest)return;
    notes.change({...latest,note:{category:'',tags:[],...latest.note,trashedAt:value?new Date().toISOString():undefined}});
    setDeleteOpen(false);setFocus('');undoStack.current=[];redoStack.current=[];
  }
  async function syncOfflineCategories(){
    if(!networkAvailable()||syncingWorkspace.current||organizingRef.current||sharedAccess)return;
    const first=workspaceRef.current;
    if(!first.pending.length)return;
    syncingWorkspace.current=true;setClassificationStatus('syncing');
    try{
      await notes.persistPending();
      const server=await(await api('/api/note-workspace')).json() as {categories:string[];revision:number};
      const remoteRows:import('@/lib/notes').NoteIndex[]=[];
      let offset=0;
      while(true){
        const response=await fetch('/canvas/api.php?path='+encodeURIComponent('/api/notes-index')+'&offset='+offset,{credentials:'same-origin',cache:'no-store'});
        if(!response.ok)throw new Error('分類同期のためのメモ一覧を取得できません');
        const page=await response.json() as {documents:import('@/lib/notes').NoteIndex[];hasMore:boolean;nextOffset:number};
        remoteRows.push(...page.documents);if(!page.hasMore)break;
        if(page.nextOffset<=offset)throw new Error('一覧の取得位置が不正です');offset=page.nextOffset;
      }
      const rows:Classification[]=remoteRows.map(row=>({id:row.id,title:row.title,revision:row.revision,category:row.note?.category||'',tags:row.note?.tags||[]}));
      const snapshot={...server,categories:categoryPaths([...server.categories,...rows.map(row=>row.category)])};
      const localRows=(await listLocalDocs()).filter(n=>n.accountId===accountId&&n.dirty).map(n=>({id:n.id,title:n.title,revision:n.revision,category:(n.content as NoteDoc).note?.category||'',tags:(n.content as NoteDoc).note?.tags||[]}));
      const planned=planCategorySync(first,snapshot,rows,localRows);
      const fingerprint=JSON.stringify({revision:server.revision,rows:[...rows].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>[r.id,r.category,r.tags]),pending:first.pending,local:[...localRows].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>[r.id,r.category,r.tags])});
      // A choice only applies to the exact remote classification the user saw.
      if(planned.conflicts.length&&(!first.resolution||first.conflictFingerprint!==fingerprint)){
        updateWorkspace({...workspaceRef.current,conflicts:planned.conflicts,resolution:undefined,conflictFingerprint:fingerprint});setClassificationStatus('conflict');return;
      }
      const useRemote=first.resolution==='remote';
      const paths=useRemote?snapshot.categories:planned.categories;
      if(paths.some(p=>p.length>200)||paths.length>2000)throw new Error('カテゴリの容量上限を超えています');
      const result=await(await api('/api/note-workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:server.revision,categories:paths,updates:useRemote?[]:planned.updates.map(({id,revision,category,tags})=>({id,revision,category,tags}))})})).json() as {categories:string[];revision:number;changed:{id:string;revision:number;updated_at:number;note:NoteMeta}[]};
      // Reconcile classification only; unsynced text, files and drawing remain untouched.
      const reconciled=useRemote?[...rows.filter(r=>planned.reconciled.some(n=>n.id===r.id)),...(first.baseNotes||[]).filter(r=>r.id.startsWith('local-')&&planned.reconciled.some(n=>n.id===r.id))]:planned.reconciled;
      await notes.reconcileClassification(reconciled);
      if(result.changed?.length)await notes.acceptMetadata(result.changed);
      const current=workspaceRef.current,remaining=current.pending.slice(first.pending.length);
      let visible=categoryPaths(result.categories);for(const op of remaining)visible=locallyApplyCategory(visible,op);
      updateWorkspace({categories:visible,revision:result.revision,pending:remaining,updatedAt:Date.now(),baseCategories:remaining.length?result.categories:undefined,baseNotes:remaining.length?reconciled:undefined});
      setClassificationStatus(remaining.length?'pending':'complete');await notes.resumeSync();
    }catch(error){setClassificationStatus('pending');notes.setError('分類は端末に保存済み・同期待ちです。'+(error instanceof Error?error.message:'接続を確認してください'));}
    finally{syncingWorkspace.current=false;}
  }
  function resolveClassification(resolution:'local'|'remote'){
    updateWorkspace({...workspaceRef.current,resolution});void syncOfflineCategories();
  }
  useEffect(()=>{
    const onOnline=()=>{void syncOfflineCategories();};
    addEventListener('online',onOnline);
    const interval=window.setInterval(()=>{if(networkAvailable()&&workspaceRef.current.pending.length)void syncOfflineCategories();},12000);
    onOnline();
    return()=>{removeEventListener('online',onOnline);clearInterval(interval);};
  },[accountId,!!sharedAccess]);
  async function organize(op:CategoryOperation){
    if(organizing||syncingWorkspace.current||sharedAccess)return;
    setOrganizing(true);organizingRef.current=true;
    try{
      const previous=workspaceRef.current;
      const existing=categoryPaths([...previous.categories,...notes.list.map(n=>n.note?.category||'')]);
      if(op.kind==='create'&&existing.includes(op.target))throw new Error('カテゴリが既にあります');
      if(op.kind!=='create'&&!existing.includes(op.source))throw new Error('対象カテゴリが見つかりません');
      if(op.kind==='move'&&(existing.includes(op.target)||inCategory(op.target,op.source)))throw new Error('移動先が重複しているか、子カテゴリ内です');
      const next=locallyApplyCategory(existing,op);
      if(next.some(p=>p.length>200)||next.length>2000)throw new Error('カテゴリ数・文字数の上限を超えます');
      // All local work is persisted before any network operation.
      await notes.persistPending();
      const updated:OfflineWorkspace={...previous,categories:next,pending:[...previous.pending,op],updatedAt:Date.now(),conflicts:undefined,resolution:undefined,conflictFingerprint:undefined,baseCategories:previous.pending.length?previous.baseCategories:existing,baseNotes:previous.pending.length?previous.baseNotes:notes.list.map(row=>({id:row.id,title:row.title,revision:row.revision,category:row.note?.category||'',tags:row.note?.tags||[]}))};
      updateWorkspace(updated);setClassificationStatus('pending');
      await notes.settleSaves();
      const settled=workspaceRef.current;updateWorkspace({...settled,baseNotes:settled.baseNotes?.map(n=>({...n,id:notes.resolveId(n.id)}))});
      if(op.kind!=='create')await notes.applyOfflineCategory(op);
      navigateCategory(op.kind==='tag'?'':op.target);
      if(op.kind==='tag')setTag(op.target);
    }finally{setOrganizing(false);organizingRef.current=false;if(networkAvailable())void syncOfflineCategories();}
  }
  async function assignPages(entries:Classification[],strictRevision=false){
    if(organizingRef.current||syncingWorkspace.current||sharedAccess)throw new Error('分類の同期・整理が終わるまでお待ちください');
    if(!entries.length||entries.length>5000)throw new Error('整理するページ数が不正です');
    const seen=new Set<string>();for(const n of entries){if(!n||typeof n.id!=='string'||!/^(?:local-)?[a-f0-9]{32}$/.test(n.id)||seen.has(n.id)||typeof n.category!=='string'||n.category.length>200||!Array.isArray(n.tags)||n.tags.length>50||n.tags.some(t=>typeof t!=='string'||t.length>80)||!Number.isInteger(n.revision))throw new Error('分類・タグ・ページIDの形式が不正です');seen.add(n.id);}
    setOrganizing(true);organizingRef.current=true;
    let previous:OfflineWorkspace|undefined,queued=false;
    try{
      const viewed=notes.list;
      await notes.persistPending();const rows=await notes.refresh();
      for(const n of entries){const id=notes.resolveId(n.id),index=rows.find(r=>r.id===id);if(!index)throw new Error('この利用者の一覧にないページがあります');const row=await notes.readForExport(id,index.revision);if(strictRevision&&(index.revision!==n.revision||row.revision!==n.revision))throw new Error('書き出し後に更新されたページがあります。もう一度書き出してください');if(row.content.note?.importState==='pending')throw new Error('取り込み途中のページは、完了後に整理してください');}
      previous=workspaceRef.current;
      const existing=categoryPaths([...previous.categories,...rows.map(n=>n.note?.category||'')]);
      const changes=entries.map(n=>({id:notes.resolveId(n.id),category:categoryPath(n.category),tags:[...new Set(n.tags)]}));
      const paths=categoryPaths([...existing,...changes.map(n=>n.category)]);if(paths.length>2000)throw new Error('フォルダ数の上限を超えます');
      const baseNotes=new Map((previous.pending.length?previous.baseNotes||[]:[]).map(n=>[n.id,n]));
      for(const n of [...viewed.filter(n=>entries.some(e=>notes.resolveId(e.id)===n.id)),...rows])if(!baseNotes.has(n.id))baseNotes.set(n.id,{id:n.id,title:n.title,revision:n.revision,category:n.note?.category||'',tags:n.note?.tags||[]});
      updateWorkspace({...previous,categories:paths,pending:[...previous.pending,{kind:'assign',notes:changes}],updatedAt:Date.now(),conflicts:undefined,resolution:undefined,conflictFingerprint:undefined,baseCategories:previous.pending.length?previous.baseCategories:existing,baseNotes:[...baseNotes.values()]});queued=true;setClassificationStatus('pending');
      await notes.settleSaves();
      const settled=workspaceRef.current;
      updateWorkspace({...settled,pending:settled.pending.map(op=>op.kind==='assign'?{...op,notes:op.notes.map(n=>({...n,id:notes.resolveId(n.id)}))}:op),baseNotes:settled.baseNotes?.map(n=>({...n,id:notes.resolveId(n.id)}))});
      const resolved=changes.map(n=>({...n,id:notes.resolveId(n.id),revision:entries.find(e=>notes.resolveId(e.id)===notes.resolveId(n.id))!.revision}));
      await notes.applyLocalMetadata(resolved,{sync:false,strictRevision:false});
      return entries.length;
    }catch(error){if(queued&&previous)updateWorkspace(previous);setClassificationStatus(workspaceRef.current.pending.length?'pending':'saved');throw error;}
    finally{setOrganizing(false);organizingRef.current=false;if(networkAvailable())void syncOfflineCategories();}
  }
  function reorderGraphic(direction:'front'|'back'){
    if(!doc||!selectedShape)return;
    const items=[...doc.items.filter(i=>i.id!==selectedShape.id)];direction==='front'?items.push(selectedShape):items.unshift(selectedShape);commit({...doc,items});
  }
  function gridStyle(d:NoteDoc|undefined){
    const step=d?.gridSpacing||24;
    if(d?.grid==='none')return{backgroundImage:'none'};
    if(d?.grid==='iso'){
      const h=step*Math.sqrt(3)/2;
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+step+'" height="'+h*2+'"><path d="M0 0L'+step/2+' '+h+'L'+step+' '+h*2+'M'+step+' 0L'+step/2+' '+h+'L0 '+h*2+'M0 0H'+step+'M0 '+h+'H'+step+'M0 '+h*2+'H'+step+'" fill="none" stroke="#e3dfd5" stroke-width="1"/></svg>';
      return{backgroundImage:'url("data:image/svg+xml,'+encodeURIComponent(svg)+'")',backgroundSize:step+'px '+h*2+'px'};
    }
    return{backgroundImage:'linear-gradient(#e3dfd5 1px,transparent 1px),linear-gradient(90deg,#e3dfd5 1px,transparent 1px)',backgroundSize:step+'px '+step+'px'};
  }
  function snapCanvas(p:Point){
    const d=current.current?.content;if(!d?.snap||d.grid==='none')return p;const step=d.gridSpacing||24;
    if(d.grid==='iso'){const y=Math.round(p.y/(step*Math.sqrt(3)/2))*step*Math.sqrt(3)/2;const shift=(Math.round(p.y/(step*Math.sqrt(3)/2))%2)*step/2;return{...p,x:Math.round((p.x-shift)/step)*step+shift,y};}
    return{...p,x:Math.round(p.x/step)*step,y:Math.round(p.y/step)*step};
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
  const extentId=record?.id||'';const promotedExtent=extent.current.id.startsWith('local-')&&notes.resolveId(extent.current.id)===extentId;
  if(extent.current.id!==extentId&&!promotedExtent)extent.current={id:extentId,width:1800,height:1400};
  extent.current={id:extentId,width:Math.max(extent.current.width,Math.ceil(width/256)*256),height:Math.max(extent.current.height,Math.ceil(height/256)*256)};
  width=extent.current.width;height=extent.current.height;
  function stroke(points:Point[]){return points.map(p=>`${p.x},${p.y}`).join(' ');}
  function paintStrokeView(value:PaintStroke){
    const mode=value.brush||'pen',b=graphicBox(value),cx=b.x+b.w/2,cy=b.y+b.h/2;
    return <g key={value.id} data-stroke={value.id} data-layer-id={value.layerId} transform={value.rotation?`rotate(${value.rotation} ${cx} ${cy})`:undefined} opacity={doc?.layers.find(l=>l.id===value.layerId)?.opacity??1} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <InkMasked id={value.id} masks={value.inkMasks} frame={inkFrame(value.points)}><InkStroke id={value.id} points={value.points} color={value.color} width={value.width} opacity={value.opacity} brush={mode} pressure={value.pressure}/></InkMasked>
      <polyline points={stroke(value.points)} stroke="transparent" strokeWidth={Math.max(18,value.width)} pointerEvents={workspaceMode==='layout'&&(tool==='select'||tool==='vertex'||tool==='magic')||tool==='eraser'?'stroke':'none'}/>
    </g>;
  }
  return <main data-workspace-mode={workspaceMode} className={`notes-app view-${workspaceView} ${focusMode?'is-focus-view':''} ${!sharedAccess&&sidebar?'sidebar-open':''} ${sharedAccess?'notes-shared-board':''} ${organizerOpen?'is-organizing-pages':''}`}
    onPointerDownCapture={event=>{touchButtons.onPointerDownCapture(event);if(event.button===2){event.preventDefault();event.stopPropagation();}}}
    onPointerMoveCapture={touchButtons.onPointerMoveCapture} onPointerUpCapture={touchButtons.onPointerUpCapture} onPointerCancelCapture={touchButtons.onPointerCancelCapture} onClickCapture={touchButtons.onClickCapture} onContextMenuCapture={touchButtons.onContextMenuCapture}
    onContextMenu={event=>{if(organizerOpen)return;event.preventDefault();openWorkspaceMenu(event.target as Element,event.clientX,event.clientY);}}>
    {workspaceMenu&&<WorkspaceContextMenu point={workspaceMenu} items={workspaceMenuItems()} onClose={()=>setWorkspaceMenu(null)}/>}
    <header className="notes-header notes-header-compact">
      {!sharedAccess&&<button className="notes-header-icon notes-sidebar-toggle" onClick={toggleSidebar} aria-label={sidebar?'メモ一覧を閉じる':'メモ一覧を開く'} aria-expanded={sidebar} aria-controls="notes-file-navigation" title={sidebar?'メモ一覧を閉じる':'メモ一覧を開く'}>{sidebar?<PanelLeftClose size={19}/>:<PanelLeftOpen size={19}/>}</button>}
      <strong className="notes-brand">Kaeru<span>Note</span></strong>
      <span className="notes-header-divider"/>
      <input aria-label="メモのタイトル" placeholder="新しいメモ" value={record?.title||''} maxLength={80} disabled={!record||notes.busy||importing||organizing||!!meta.trashedAt||meta.importState==='pending'} onChange={e=>doc&&notes.change(doc,e.target.value)}/>
      <div className="notes-header-actions">
        <UpdateBadge/>
        <button className="notes-header-icon" title={screenFullscreen?'全画面を解除':'全画面にする'} aria-label={screenFullscreen?'全画面を解除':'全画面にする'} aria-pressed={screenFullscreen} onClick={()=>void setScreenFullscreen(!screenFullscreen).catch(error=>notes.setError(error instanceof Error?error.message:'全画面表示を変更できません'))}>{screenFullscreen?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button>
        {sharedAccess?<span className="notes-shared-indicator" title="このリンクの作品だけが表示されています">共有作品を編集中</span>:
          <>
            <button className="notes-header-icon" onClick={()=>{setSidebar(true);setSearchScope('all');requestAnimationFrame(()=>searchInput.current?.focus());}} aria-label="全メモを横断検索" title="メモを検索"><Search size={18}/></button>
            <button className="notes-header-share" disabled={!record||record.id.startsWith('local-')||notes.conflict} onClick={()=>setShareOpen(true)} aria-label="作品を共有" title="リンクを発行して共同編集"><Share2 size={16}/><span>共有</span></button>
          </>}
        <span className="notes-save-status" role="status" title={attaching?'添付を送信中…':notes.status}>{attaching?'添付中':notes.status}</span>
        <button className="notes-header-icon" onClick={()=>void notes.save()} disabled={!record} title="今すぐ保存" aria-label="保存" aria-keyshortcuts="Control+s Meta+s"><Save size={18}/></button>
        {!sharedAccess&&<button className="notes-header-icon" onClick={()=>setSettings(!settings)} aria-label="環境設定と書き出し" title="環境設定" aria-expanded={settings}><Settings2 size={19}/></button>}
      </div>
    </header>
    <div className="notes-layout">
      {!sharedAccess&&sidebar&&<><div className="notes-sidebar-backdrop" aria-hidden="true"/><ResizableNoteSidebar>
        <div className="notes-sidebar-head"><small>MY WORKSPACE</small><div className="notes-sidebar-head-actions">
          <button className="notes-new" onClick={()=>void createNote()} disabled={importing||attaching||notes.busy||organizing} aria-label="新しいメモ"><Plus size={22}/></button>
          <div className="notes-sidebar-more">
            <button className="notes-sidebar-menu-toggle" aria-label="メモメニュー" aria-expanded={sidebarMenuOpen} onClick={()=>setSidebarMenuOpen(open=>!open)} title="メニュー"><MoreHorizontal size={20}/></button>
            {sidebarMenuOpen&&<div className="notes-sidebar-menu" role="menu">
              <button role="menuitem" disabled={organizing||importing||attaching} onClick={()=>{setSidebarMenuOpen(false);setImportOpen(true);}}><Upload size={16}/>Joplinから取り込む</button>
              <button role="menuitem" onClick={()=>{setSidebarMenuOpen(false);setSettings(true);}}><Settings2 size={16}/>メモの整理・設定</button>
            </div>}
          </div>
        </div></div>
        <button className="notes-organize-open" onClick={()=>showOrganizer(true)}><Folder size={17}/>ページ・フォルダを整理</button>
        <label className="notes-search"><Search size={17}/><input ref={searchInput} placeholder="全メモの本文・タグを検索" aria-label="メモを検索" value={query} onChange={e=>setQuery(e.target.value)} onBlur={()=>rememberSearch()} onKeyDown={e=>{if(e.key==='Enter')rememberSearch();}}/>{query&&<button onClick={()=>setQuery('')} aria-label="検索を消す"><X size={14}/></button>}</label>
        {!!recentSearches.length&&<div className="notes-search-history" aria-label="最近の検索">{recentSearches.map(value=><button key={value} title={value} onClick={()=>{setQuery(value);setSearchScope('all');}}>{value}</button>)}</div>}
        <div className="notes-search-options"><label>検索範囲<select aria-label="検索範囲" value={searchScope} onChange={e=>setSearchScope(e.target.value as 'all'|'filtered')}><option value="all">全カテゴリ横断</option><option value="filtered">選択中のカテゴリ・タグ</option></select></label><small>{trash?'ゴミ箱内を検索':'タイトル・本文・タグ・添付名'} · 空白でAND検索</small></div>
        <div className="notes-navigation"><button className={!trash&&!category?'active':''} onClick={()=>{setTrash(false);setCategory('');setTag('');setQuery('');}}>すべてのメモ <small>{notes.list.filter(n=>!n.note?.trashedAt).length}</small></button><button className={trash?'active':''} onClick={()=>{setTrash(true);setQuery('');setCategory('');setTag('');}}><Trash2 size={15}/>ゴミ箱 <small>{notes.list.filter(n=>n.note?.trashedAt).length}</small></button></div>
        <CategoryTree paths={categories} notes={notes.list} selected={category} expanded={browsingNotes} notePicker={folderNotePicker} onExpand={()=>{setTrash(false);setCategoryBrowserOpen(true);}} onCollapse={collapseCategoryBrowser} onSelect={navigateCategory} disabled={organizing||importing||attaching} onManage={()=>{setCategoryManagerKind('create');setCategoryManager(true);}} onCreate={()=>{setCategoryManagerKind('create');setCategoryManager(true);}} onDelete={()=>{setCategoryManagerKind('delete');setCategoryManager(true);}}/>
        <div className="notes-filters"><label><Tag size={15}/><select aria-label="タグで絞り込み" value={tag} onChange={e=>{setTag(e.target.value);setQuery('');}}><option value="">すべてのタグ</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label></div>
        <div className="notes-count" role="status">{searching?(searchScope==='all'?'横断検索':'絞り込み検索'):trash?'ゴミ箱':category||'すべてのメモ'} · {filtered.length} 件</div>
        {!browsingNotes&&<div className="notes-inline-folder" role="region" aria-label="左メニューのNote一覧">
          {category&&<button className="notes-inline-parent" title={category.split(' / ').slice(0,-1).join(' / ')||'全体'} aria-label="親フォルダを開く" onClick={()=>navigateCategory(category.split(' / ').slice(0,-1).join(' / '))}><ChevronLeft size={14}/><Folder size={14}/><span>{category.split(' / ').slice(-2,-1)[0]||'全体'}</span></button>}
          <div className="notes-inline-files"><div className="kn-category-list-heading">
          <strong>カテゴリ：{category||'すべて'}</strong>
          {categoryScope()}
          {searching&&searchScope==='all'&&<small>横断検索中：カテゴリ・タグの絞り込みは適用されません</small>}
          <small role="status">分類：{{saved:'保存済み',syncing:'同期中',pending:'端末に保存済み・同期待ち',conflict:'競合あり',complete:'同期完了'}[classificationStatus]}</small>
        </div>
        <button className="kn-category-create" disabled={importing||attaching||notes.busy||organizing} onClick={()=>void createNote()}>＋ このカテゴリに新規ノート</button>
        {noteList()}</div></div>}
      </ResizableNoteSidebar></>}
      <section className="notes-editor"><div className="notes-editor-main">
        {!focusMode&&!layersOpen&&<div className="notes-collapsed-dock-actions"><button onClick={()=>setLayerProperties(workspaceMode==='note'?'note':activeLayer)} disabled={!record}>プロパティ</button>{layerToggle()}</div>}
        {workspaceView==='drawing'&&!focusMode&&(workspaceMode==='canvas'||workspaceMode==='layout')&&<div className="notes-drawing-ribbon"><div className="notes-drawing-toolbar" role="toolbar" aria-label="お絵かきツール" inert={!record||notes.busy||importing||organizing||!!meta.trashedAt||meta.importState==='pending'}>
          {modePicker()}
          <div className="notes-tool-group">
            <button aria-label="お絵かきの元に戻す" aria-keyshortcuts="Control+z Meta+z" onClick={undo} disabled={!undoStack.current.length}><Undo2 size={18}/></button>
            <button aria-label="お絵かきのやり直す" aria-keyshortcuts="Control+Shift+z Meta+Shift+z Control+y" onClick={redo} disabled={!redoStack.current.length}><Redo2 size={18}/></button>
            {workspaceMode==='canvas'?canvasMainTools():layoutMainTools()}
          </div>
          {workspaceMode==='canvas'&&<>
            <CanvasBrushes brush={brush} active={tool==='pen'} onSelect={selectBrush}/>
            <div className="notes-tool-group notes-brush-controls">{brushPicker('描画ブラシ')}
              <input aria-label="お絵かきの色" type="color" value={inkColor} onChange={event=>setInkColor(event.target.value)}/>
              {tool!=='eraser'&&<label>太さ<input aria-label="お絵かきのペンの太さ" type="range" min="1" max="160" value={inkWidth} onChange={event=>setInkWidth(Number(event.target.value))}/><b>{inkWidth}px</b></label>}
              <label>濃さ<input aria-label="お絵かきの濃さ" type="range" min="5" max="100" value={Math.round(inkOpacity*100)} onChange={event=>setInkOpacity(Number(event.target.value)/100)}/><b>{Math.round(inkOpacity*100)}%</b></label>
              <label><input aria-label="お絵かきの筆圧" type="checkbox" checked={inkPressure} onChange={event=>setInkPressure(event.target.checked)}/>筆圧</label>
            </div>{canvasSelectionActions()}
          </>}
          {workspaceMode==='layout'&&<div className="notes-tool-group notes-drawing-style"><input aria-label="レイアウトの色" type="color" value={inkColor} onChange={e=>setInkColor(e.target.value)}/><label>線幅<input aria-label="レイアウトの線幅" type="range" min="1" max="100" value={layoutWidth} onChange={e=>setLayoutWidth(Number(e.target.value))}/>{layoutWidth}px</label></div>}
          <div className="notes-tool-group">
            <button aria-label="お絵かきの縮小" onClick={()=>zoomTo(scale-.1)} disabled={scale<=.2}><ZoomOut size={18}/></button>
            <select aria-label="お絵かきの倍率" value={Math.round(scale*100)} onChange={event=>zoomTo(Number(event.target.value)/100)}>{[...new Set([20,25,50,75,100,125,150,200,300,400,Math.round(scale*100)])].sort((a,b)=>a-b).map(value=><option key={value} value={value}>{value}%</option>)}</select>
            <button aria-label="お絵かきの拡大" onClick={()=>zoomTo(scale+.1)} disabled={scale>=4}><ZoomIn size={18}/></button>
          </div>
        </div>{detailsToggle(true)}</div>}
        <div className="notes-basic-ribbon" inert={!!meta.trashedAt||organizing||meta.importState==='pending'}>
        <div inert={!!meta.trashedAt||organizing||meta.importState==='pending'} className={`notes-toolbar ${workspaceMode==='note'?'notes-toolbar-word':''} ${meta.importState==='pending'||meta.trashedAt||organizing?'notes-disabled':''}`} role="toolbar" aria-label="編集オプション">
          {workspaceMode==='note'?<>
            <div className="notes-tool-group"><button title="元に戻す" aria-keyshortcuts="Control+z Meta+z" onClick={undo} disabled={!undoStack.current.length}><Undo2 size={18}/></button><button title="やり直す" aria-keyshortcuts="Control+Shift+z Meta+Shift+z Control+y" onClick={redo} disabled={!redoStack.current.length}><Redo2 size={18}/></button></div>
            <div className="notes-tool-group notes-format" onMouseDown={e=>{if((e.target as Element).closest('button'))e.preventDefault();}}>
              <button title="太字" onClick={()=>format('bold')}><Bold size={17}/></button>
              <button title="斜体" onClick={()=>format('italic')}><Italic size={17}/></button>
              <button title="下線" onClick={()=>format('underline')}><Underline size={17}/></button>
              <button title="文字を小さく" aria-label="文字サイズを小さく" onClick={()=>chooseFont(-1)}>A−</button>
              <span className="notes-font-step">{[10,12,16,20,28,36,48][fontStep-1]}px</span>
              <button title="文字を大きく" aria-label="文字サイズを大きく" onClick={()=>chooseFont(1)}>A＋</button>
              <button className="notes-color-button" title="文字色" onClick={()=>{if(colorOpen)setColorOpen(false);else wakeColorPanel();}}><span style={{background:inkColor}}/>文字色</button>
              <button title="見出し1" onClick={()=>format('formatBlock','h1')}>H1</button><button title="見出し2" onClick={()=>format('formatBlock','h2')}>H2</button>
              <button title="本文" onClick={()=>format('formatBlock','p')}>本文</button>
              <label className="notes-bullet-picker" title="箇条書きのマークの大きさ">●
                <select aria-label="リストのマーク" value={bulletSize} onChange={e=>applyBullets(e.target.value as typeof bulletSize)}>
                  <option value="large">● 大</option><option value="medium">● 中</option><option value="small">・ 小</option>
                </select>
              </label>
              <button title="選んだマークの箇条書き" onClick={()=>applyBullets(bulletSize)}><List size={18}/></button>
              <button title="チェックリスト（文字なしで挿入）" onClick={()=>insertRichHTML('<ul class="kn-checklist"><li><input type="checkbox"> <span>&nbsp;</span></li></ul>')}><ListChecks size={18}/></button>
            </div>
            <div className="notes-tool-group notes-note-insert" onMouseDown={e=>{if((e.target as Element).closest('button'))e.preventDefault();}}>
              <button title="通常の表を挿入" onClick={()=>openTableSettings('table')}><Table2 size={17}/><span>表</span></button>
              <button title="段組みの表組みレイアウト" onClick={()=>openTableSettings('columns')}><Columns3 size={17}/><span>表組み</span></button>
              <button title="ノートにファイルを添付" onClick={()=>fileInput.current?.click()}><Paperclip size={17}/><span>添付</span></button>
              <button title="画像をノートに挿入" onClick={()=>imageInput.current?.click()}><ImagePlus size={17}/>画像</button>
              <button title="ノートの作業エリアを拡大" onClick={toggleFocusMode}><Maximize2 size={17}/></button>

            </div>
          </>:<>
            <div className="notes-tool-group"><button title="元に戻す" aria-keyshortcuts="Control+z Meta+z" onClick={undo} disabled={!undoStack.current.length}><Undo2 size={18}/></button><button title="やり直す" aria-keyshortcuts="Control+Shift+z Meta+Shift+z Control+y" onClick={redo} disabled={!redoStack.current.length}><Redo2 size={18}/></button></div>
            {workspaceMode==='canvas'&&<>
              <div className="notes-tool-group">{canvasMainTools()}</div><CanvasBrushes brush={brush} active={tool==='pen'} onSelect={selectBrush}/>
              <div className="notes-tool-group notes-drawing-style"><button className="notes-color-button" onClick={()=>colorOpen?setColorOpen(false):wakeColorPanel()}><span style={{background:inkColor}}/>色</button>{tool!=='eraser'&&<label className="notes-width-control">太さ<input aria-label="描画の線幅" type="range" min="1" max="160" value={inkWidth} onChange={e=>setInkWidth(Number(e.target.value))}/><b>{inkWidth}px</b></label>}</div>{canvasSelectionActions()}
            </>}
            {workspaceMode==='layout'&&<><div className="notes-tool-group notes-layout-tools">{layoutMainTools()}</div><div className="notes-tool-group notes-drawing-style"><button className="notes-color-button" onClick={()=>colorOpen?setColorOpen(false):wakeColorPanel()}><span style={{background:inkColor}}/>色</button><label className="notes-width-control">線幅<input aria-label="描画の線幅" type="range" min="1" max="100" value={layoutWidth} onChange={e=>setLayoutWidth(Number(e.target.value))}/><b>{layoutWidth}px</b></label></div></>}
            {(workspaceMode==='excel'||workspaceMode==='graph')&&<div className="notes-tool-group"><span>{workspaceMode==='excel'?'Excelレイヤー':'グラフレイヤー'}</span>{workspaceMode==='excel'&&<>
              <button disabled={!sheetSelection} onClick={()=>setChartOpen(true)}>グラフ作成</button>
              <button onClick={()=>void updateSpreadsheetReferences()}>参照値を更新</button>
              <small>参照元ノート：{sheetDependents.length}件</small>
            </>}</div>}
          </>}

        </div>
          {detailsToggle()}
        </div>
        {workspaceMode==='note'&&advancedOpen&&<div id="kn-editor-details" className="notes-details notes-toolbar-word" role="region" aria-label="ノート詳細ツール" inert={!!meta.trashedAt||organizing}>
            <div className="notes-tool-group notes-advanced-format" onMouseDown={e=>{if((e.target as Element).closest('button'))e.preventDefault();}}>
              <label className="kn-image-setting">画像
                <select aria-label="画像の配置" value={imagePlacement} onChange={e=>setImagePlacement(e.target.value as typeof imagePlacement)}>
                  <option value="inline">文章に回り込ませる</option><option value="overlay">上に重ねる</option>
                </select>
              </label>
              <label className="kn-image-setting">位置
                <select aria-label="画像の配置位置" value={imageAlign} onChange={e=>setImageAlign(e.target.value as typeof imageAlign)}>
                  <option value="left">左</option><option value="center">中央</option><option value="right">右</option>
                </select>
              </label>
              <button title="上付き" onClick={()=>format('superscript')}><Superscript size={16}/></button>
              <button title="下付き" onClick={()=>format('subscript')}><Subscript size={16}/></button>
              <button title="蛍光ペン（文字背景色）" onClick={()=>format('backColor',highlightColor)}><Highlighter size={16}/></button><label title="選択した文字の背景色を指定します">背景色<input type="color" aria-label="文字背景色" value={highlightColor} onChange={e=>{setHighlightColor(e.target.value);format('backColor',e.target.value);}}/></label>
              <button title="手書き風の赤丸" onClick={()=>applyRedMark('circle')}>赤丸</button>
              <button title="手書き風の赤線" onClick={()=>applyRedMark('underline')}>赤線</button>
              <button title="手書き風の赤波線" onClick={()=>applyRedMark('wave')}>波線</button>
              <label>ルビ色<input type="color" value={rubyColor} onChange={e=>setRubyColor(e.target.value)}/></label>
              <button title="選んだ漢字にルビ。Shiftを押すと前回の読みを使用" onClick={e=>ruby(e.shiftKey)}>ルビ</button>
            </div>
            {tableSelected&&<div className="notes-tool-group notes-table-controls" onMouseDown={e=>{if((e.target as Element).closest('button'))e.preventDefault();}}>
              <strong>表の編集</strong>
              <button title="行を追加" onClick={()=>editTable('row+',lastTable.current,lastCell.current)}>行＋</button>
              <button title="行を削除" onClick={()=>editTable('row-',lastTable.current,lastCell.current)}>行−</button>
              <button title="列を追加" onClick={()=>editTable('col+',lastTable.current,lastCell.current)}>列＋</button>
              <button title="列を削除" onClick={()=>editTable('col-',lastTable.current,lastCell.current)}>列−</button>
              <button title="最初の表設定を再表示" onClick={()=>openTableSettings('table',true)}>設定</button>
            </div>}
        </div>}
        {workspaceMode!=='note'&&canvasDetailsOpen&&<div id="kn-editor-details" className="notes-details" role="region" aria-label="Canvas詳細ツール" inert={!!meta.trashedAt||organizing}>
          {workspaceMode==='canvas'&&tool==='eraser'&&<div className="notes-tool-group"><strong>消しゴム設定</strong>{eraserControl()}</div>}
          {workspaceMode==='canvas'&&tool!=='eraser'&&(tool==='pen'||!selectedGraphic)&&<div className="notes-tool-group"><strong>ペン設定</strong>{brushPicker("ブラシ")}<label className="notes-width-control">太さ<input type="range" min="1" max="160" value={inkWidth} onChange={e=>setInkWidth(Number(e.target.value))}/><b>{inkWidth}px</b></label><label className="notes-opacity-control">透明度<input type="range" min="5" max="100" value={Math.round(inkOpacity*100)} onChange={e=>setInkOpacity(Number(e.target.value)/100)}/><b>{Math.round(inkOpacity*100)}%</b></label><label><input type="checkbox" checked={inkPressure} onChange={e=>setInkPressure(e.target.checked)}/>筆圧</label></div>}
          {workspaceMode==='layout'&&selectedGraphic&&<div className="notes-shape-inspector" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'4px 8px'}}>
            <label>線色 <input type="color" value={/^#[0-9a-f]{6}$/i.test(selectedGraphic.color)?selectedGraphic.color:'#263443'} onChange={e=>editSelectedShape(i=>({...i,color:e.target.value}))}/></label>
            {selectedShape&&<><label>塗り <input type="color" value={selectedShape.fill&&/^#[0-9a-f]{6}$/i.test(selectedShape.fill)?selectedShape.fill:'#ffffff'} onChange={e=>editSelectedShape(i=>({...i,fill:e.target.value}))}/></label>
            <button onClick={()=>editSelectedShape(i=>({...i,fill:'none'}))}>塗りなし</button></>}
            <label>線幅 <input type="number" min="0.5" max="100" step="0.5" style={{width:55}} value={selectedGraphic.width} onChange={e=>editSelectedShape(i=>({...i,width:Math.max(.5,Number(e.target.value)||.5)}))}/></label>
            <label>透明度 <input type="range" min="0" max="100" value={Math.round((selectedGraphic.opacity??1)*100)} onChange={e=>editSelectedShape(i=>({...i,opacity:Number(e.target.value)/100}))}/></label>
            <span>{Math.round((selectedGraphic.opacity??1)*100)}%</span>
            {tool==='vertex'&&<strong className="notes-anchor-message">{activeAnchor?.id===selected?'頂点 '+(activeAnchor.index+1)+' 選択中':activeSegment?.id===selected?'線分 '+(activeSegment.index+1)+' 選択中':'頂点はタップで黄色くなり、ドラッグで移動できます'}</strong>}
          </div>}
          {selectedShape?.kind==='image'&&<div className="notes-tool-group"><strong>画像の配置</strong>{(['x','y','w','h'] as const).map(key=><label key={key}>{({x:'横位置',y:'縦位置',w:'幅',h:'高さ'})[key]}<input aria-label={'画像の'+({x:'横位置',y:'縦位置',w:'幅',h:'高さ'})[key]} type="number" value={Math.round(selectedShape[key])} onChange={e=>editSelectedShape(i=>({...i,[key]:key==='w'||key==='h'?Math.max(1,Number(e.target.value)):Number(e.target.value)}))}/></label>)}<label>回転<input aria-label="画像の回転" type="number" value={selectedShape.rotation||0} onChange={e=>editSelectedShape(i=>({...i,rotation:Number(e.target.value)}))}/></label><button onClick={()=>reorderGraphic('front')}>最前面</button><button onClick={()=>reorderGraphic('back')}>最背面</button></div>}
          {tool==='text'&&<div className="notes-tool-group" onMouseDown={e=>{if((e.target as Element).closest('button'))e.preventDefault();}}><strong>文字設定</strong><button onClick={()=>chooseFont(-1)}>A−</button><button onClick={()=>chooseFont(1)}>A＋</button><button onClick={()=>format('bold')}>太字</button><button onClick={()=>format('italic')}>斜体</button><button onClick={()=>format('underline')}>下線</button>{(['Left','Center','Right'] as const).map(align=><button key={align} onClick={()=>format('justify'+align)}>{({Left:'左寄せ',Center:'中央',Right:'右寄せ'})[align]}</button>)}<input aria-label="Canvas文字色" type="color" value={inkColor} onChange={e=>{setInkColor(e.target.value);format('foreColor',e.target.value);}}/></div>}
          {doc&&<div className="notes-tool-group"><strong>グリッド</strong><select aria-label="グリッド種類" value={doc.grid} onChange={e=>commit({...doc,grid:e.target.value as NoteDoc['grid']})}><option value="none">なし</option><option value="square">方眼</option><option value="iso">斜方眼</option></select><label>間隔<input aria-label="グリッド間隔" type="number" min="8" max="100" value={doc.gridSpacing||24} onChange={e=>commit({...doc,gridSpacing:Math.max(8,Math.min(100,Number(e.target.value)||24))})}/></label><label><input type="checkbox" checked={doc.snap} onChange={e=>commit({...doc,snap:e.target.checked})}/>吸着</label></div>}
          {doc&&doc.layers.find(l=>l.id===activeLayer)&&<div className="notes-tool-group"><strong>レイヤー設定</strong><button onClick={()=>setLayersOpen(true)}>表示・ロック・重なり順</button><label>不透明度<input aria-label="レイヤー不透明度" type="range" min="0" max="100" value={Math.round((doc.layers.find(l=>l.id===activeLayer)?.opacity??1)*100)} onChange={e=>commit({...doc,layers:doc.layers.map(l=>l.id===activeLayer?{...l,opacity:Number(e.target.value)/100}:l)})}/></label></div>}
        </div>}
        {colorOpen&&<div className={'notes-color-popover '+(colorFading?'fading':'')} onPointerDown={wakeColorPanel}><ColorStudio color={inkColor} onChange={value=>{setDrawingColor(value);if(workspaceMode==='note')format('foreColor',value);}}/></div>}
        <div className="notes-context"><span>{tool==='pen'||tool==='eraser'||tool==='line'||tool==='rect'||tool==='ellipse'?<>{tool==='pen'?'ペン：太さ・透明度・筆圧は「詳細」で変更できます。':tool==='eraser'?'消しゴム：ペンの消しゴムボタンにも対応しています。':'レイアウト図形を作成します。'}</>:tool==='note'?<>ノートの文字サイズはCanvasのズームとは独立しています。上下スクロールはCanvasと連動します。</>:tool==='sheet'?<>Excelレイヤー：セルを編集。Shift＋クリックで範囲選択。{sheetSelection&&<b>{sheetSelection.start}{sheetSelection.end!==sheetSelection.start?':'+sheetSelection.end:''}</b>}<button disabled={!sheetSelection} onClick={()=>{setChartLayer(activeLayer||doc?.layers[0]?.id||'');setChartOpen(true);}}>グラフ作成</button></>:tool==='text'?<>テキストボックス：レイアウト上の好きな位置に独立した文章ブロックを置きます。</>:tool==='magic'?<>マジック選択：クリックした図形・画像・線・グラフを直接つかみます。</>:<>左のツールバーから操作を選択します。</>}</span>
          {workspaceView==='memo'&&!focusMode&&modePicker()}
          {workspaceMode==='layout'&&<div className="notes-shape-tools" role="toolbar" aria-label="図形の選択ツール">
            <strong>図形編集</strong>
            <button className={multiMode?'active':''} onClick={()=>setMultiMode(v=>!v)} title="スマホ・タブレットでShiftの代わりにタップを追加選択へ切り替えます。再タップすると選択解除">複数選択 {multiMode?'ON':'OFF'}</button>
            <small>{selectedGraphic?'選択中：'+graphicName(selectedGraphic)+'（'+selectedIds.length+'個）':multiMode?'図形をタップして追加・解除できます':'図形または手書き線を選択できます'}</small>
            {selectedIds.length>=2&&<span className="notes-composite-actions">
              <strong>複数図形：{selectedIds.length}個</strong>
              <button disabled={selectedIds.length!==2||selectedIds.some(id=>{const item=doc?.items.find(i=>i.id===id);return item?.kind!=='rect'||!!item?.rotation;})} onClick={intersectSelectedRects} title="四角形2つの重複部分を残す">共通部分</button>
              <button disabled={selectedIds.length!==2||!selectedIds.some(id=>doc?.items.find(i=>i.id===id)?.kind==='image')||!selectedIds.some(id=>doc?.items.find(i=>i.id===id)?.kind==='rect')||selectedIds.some(id=>!!doc?.items.find(i=>i.id===id)?.rotation)} onClick={clipImageByRect} title="四角形を画像の切り抜きマスクに使う">画像くり抜き</button>
            </span>}
          </div>}
          {selected&&<div><button title="ブロックを複製" onClick={()=>{const b=doc?.blocks?.find(b=>b.id===selected);if(b&&doc)commit({...doc,blocks:[...(doc.blocks||[]),{...b,id:id32(),x:b.x+35,y:b.y+(sizes[b.id]||b.h)+24}]});}}><Copy size={15}/></button><button title="選択を削除（複数選択時はまとめて削除）" onClick={deleteObjectSelection}><Trash2 size={15}/></button></div>}
        </div>
        {workspaceMode!=='note'&&<><div className="notes-viewbar" role="toolbar" aria-label="表示倍率"><strong>ズーム</strong><button aria-label="縮小" onClick={()=>zoomTo(scale-.1)} disabled={scale<=.2}><ZoomOut size={19}/>−</button><select aria-label="ズーム倍率" value={Math.round(scale*100)} onChange={e=>zoomTo(Number(e.target.value)/100)}>{[...new Set([20,25,50,75,100,125,150,200,300,400,Math.round(scale*100)])].sort((a,b)=>a-b).map(p=><option key={p} value={p}>{p}%</option>)}</select><button aria-label="拡大" onClick={()=>zoomTo(scale+.1)} disabled={scale>=4}><ZoomIn size={19}/>＋</button><button onClick={()=>zoomTo(1)}>100%</button><button onClick={fitContent}>画面に合わせる</button><small>Ctrl＋ホイール</small><div className="notes-viewbar-spacer"/><button className="notes-focus-inline" title="作業エリアだけ拡大" onClick={toggleFocusMode}><Maximize2 size={16}/>作業拡大</button>{!sharedAccess&&<button className="notes-delete" disabled={!record||organizing||attaching||importing||notes.busy||meta.importState==='pending'} onClick={()=>meta.trashedAt?setTrashed(false):setDeleteOpen(true)}><Trash2 size={16}/>{meta.trashedAt?'メモを復元':'メモを削除'}</button>}</div></>}
        {meta.trashedAt&&<div className="notes-warning">このメモはゴミ箱にあります。本文・添付は保持されています。<button onClick={()=>setTrashed(false)}>元に戻す</button></div>}
        {meta.importState==='pending'&&<div className="notes-warning">取り込み途中のメモです。同じJEXを選んで取り込みを再開してください。</div>}
        {!!workspace.conflicts?.length&&<div className="notes-warning kn-classification-conflicts" role="alert">
          <strong>分類が競合しています。端末の本文・添付と未同期分類は保存されています。</strong>
          <p>下の選択は未同期の分類操作全体に適用します。本文・添付は変更しません。</p>
          <div className="kn-conflict-diffs">{workspace.conflicts.map((c,i)=><details key={i} open><summary>{c.name}</summary><dl><dt>変更前</dt><dd>{c.base}</dd><dt>この端末</dt><dd>{c.local}</dd><dt>サーバー</dt><dd>{c.remote}</dd></dl></details>)}</div>
          <button disabled={classificationStatus==='syncing'} onClick={()=>resolveClassification('local')}>端末の分類操作を採用</button>
          <button disabled={classificationStatus==='syncing'} onClick={()=>resolveClassification('remote')}>サーバーの分類を採用</button>
        </div>}
        {notes.conflict&&<div className="notes-warning" role="alert">
          {sharedAccess?'同じ箇所が別の人と競合しました。リロードせず、変更内容を保存用ファイルに退避してください。':'他端末の更新と競合しています。今の内容は端末に保持しています。'}
          {sharedAccess?<button onClick={()=>{if(record)download('KaeruNote-競合バックアップ.json',JSON.stringify({title:record.title,content:record.content},null,2),'application/json');}}>編集内容を保存</button>:
          <button onClick={()=>void notes.recover()}>今の内容を別メモに保存</button>}
        </div>}
        {notes.error&&<div className="notes-warning" role="alert">
          {notes.error}
          {sharedAccess&&record?.dirty&&<button onClick={()=>download('KaeruNote-未保存バックアップ.json',JSON.stringify({title:record.title,content:record.content},null,2),'application/json')}>編集内容を保存</button>}
          <button onClick={()=>notes.setError('')} aria-label="通知を閉じる"><X size={15}/></button>
        </div>}
        <div className={`notes-stage ${layersOpen?'layers-open':''} ${focusMode?'focus-mode':''}`}>
          {focusMode&&<button className="notes-focus-float floating" style={{left:focusFloat.x,top:focusFloat.y}} title="通常表示へ戻る" onClick={toggleFocusMode} onPointerDown={focusButtonDown} onPointerMove={focusButtonMove} onPointerUp={focusButtonUp} onPointerCancel={focusButtonUp}><Minimize2 size={20}/><small>戻る</small></button>}
          {focusMode&&<>
            <button className="notes-drawer-handle top" aria-label="描画設定を開閉" onClick={()=>setDrawer(drawer==='top'?'':'top')}>⌄</button>
            <button className="notes-drawer-handle left" aria-label="描画ツールを開閉" onClick={()=>setDrawer(drawer==='left'?'':'left')}>›</button>
            <button className="notes-drawer-handle right" aria-label="集中表示のレイヤーを開閉" onClick={()=>setDrawer(drawer==='right'?'':'right')}>‹</button>
            <div className={`notes-focus-drawer top ${drawer==='top'?'open':''}`} inert={drawer!=='top'}><ColorStudio color={inkColor} onChange={value=>{setInkColor(value);if(workspaceMode==='note')format('foreColor',value);window.setTimeout(()=>setDrawer(''),850);}}/><div className="notes-focus-drawing-controls">{modePicker()}{brushPicker('集中表示のブラシ')}{tool==='eraser'?eraserControl():<label className="notes-width-control">太さ<input aria-label="集中表示のペンの太さ" type="range" min="1" max="160" value={inkWidth} onChange={e=>setInkWidth(Number(e.target.value))}/><b>{inkWidth}px</b></label>}<label className="notes-opacity-control">透明度<input type="range" min="5" max="100" value={Math.round(inkOpacity*100)} onChange={e=>setInkOpacity(Number(e.target.value)/100)}/><b>{Math.round(inkOpacity*100)}%</b></label></div></div>
            <div className={`notes-focus-drawer left ${drawer==='left'?'open':''}`} inert={drawer!=='left'}><button onClick={()=>chooseTool('pen')}><Pencil size={20}/><small>ペン</small></button>{eraserControl(true)}<button title="集中表示で元に戻す" onClick={undo} disabled={!undoStack.current.length}><Undo2 size={20}/><small>戻す</small></button><CanvasLasso active={tool==='lasso'} onChoose={()=>chooseTool('lasso')}/>{selectionMoveTool()}<button onClick={()=>chooseTool('hand')}><Hand size={20}/><small>移動</small></button></div>
            <div className={`notes-focus-drawer right ${drawer==='right'?'open':''}`} inert={drawer!=='right'}>{studio&&<LayerPanel doc={studio} activeLayer={activeLayer} onActive={selectDrawingLayer} onSelectObject={(id,kind)=>{setSelected(id);setFocus(kind==='text'?id:'');}} onChange={next=>commit(next as NoteDoc)} onNoteTool={useNoteLayer} onSheetTool={useSheetLayer} onProperties={setLayerProperties}/>}</div>
          </>}
          <nav className="notes-studio-tools" aria-label="制作ツール">
            <button className={'studio-family '+(workspaceMode==='note'?'active':'')} onClick={useNoteLayer} title="ノートレイヤー"><Type size={22}/><small>ノート</small></button>
            <button className={'studio-family '+(workspaceMode==='canvas'?'active':'')} onClick={()=>{activateFamily('canvas');chooseTool('pen');}} title="キャンバスレイヤー"><Pencil size={22}/><small>キャンバス</small></button>
            <button className={'studio-family '+(workspaceMode==='layout'?'active':'')} onClick={()=>{activateFamily('layout');chooseTool('select');}} title="レイアウトレイヤー"><Box size={22}/><small>レイアウト</small></button>
            <button className={'studio-family '+(workspaceMode==='excel'?'active':'')} onClick={useSheetLayer} title="Excelレイヤー"><span className="studio-glyph">▦</span><small>Excel</small></button>
            <button className={'studio-family '+(workspaceMode==='graph'?'active':'')} onClick={useGraphLayer} title="グラフレイヤー"><span className="studio-glyph">▥</span><small>グラフ</small></button>
            <span className="studio-sep"/>
            {workspaceMode==='canvas'&&<>
              <CanvasBrushes brush={brush} active={tool==='pen'} onSelect={selectBrush} vertical/>
              {eraserControl(true)}<CanvasLasso active={tool==='lasso'} onChoose={()=>chooseTool('lasso')}/>{selectionMoveTool()}
              <button className={tool==='hand'?'active':''} onClick={()=>chooseTool('hand')}><Hand size={20}/><small>移動</small></button>
            </>}
            {workspaceMode==='layout'&&<>
              <button className={tool==='select'?'active':''} onClick={()=>chooseTool('select')} title="黒矢印：図形全体・拡縮・回転"><MousePointer2 size={20}/><small>黒矢印</small></button>
              <button className={tool==='vertex'?'active':''} onClick={()=>chooseTool('vertex')} title="白矢印：頂点・線分を編集"><MousePointer size={20}/><small>白矢印</small></button>
              <button className={tool==='magic'?'active':''} onClick={()=>chooseTool('magic')}><span className="studio-glyph">W</span><small>マジック</small></button>
              <button className={tool==='preset'&&shapePreset==='triangle'?'active':''} onClick={()=>choosePreset('triangle')}><Triangle size={20}/><small>三角</small></button>
              <button className={tool==='preset'&&shapePreset==='arrow'?'active':''} onClick={()=>choosePreset('arrow')}><ArrowRight size={20}/><small>矢印</small></button>
              <button className={tool==='rect'?'active':''} onClick={()=>chooseTool('rect')}><span className="studio-glyph">□</span><small>四角</small></button>
              <button className={tool==='ellipse'?'active':''} onClick={()=>chooseTool('ellipse')}><span className="studio-glyph">○</span><small>丸</small></button>
              <button onClick={()=>imageInput.current?.click()}><ImagePlus size={20}/><small>画像</small></button>
              <button className={tool==='hand'?'active':''} onClick={()=>chooseTool('hand')}><Hand size={20}/><small>移動</small></button>
            </>}
            {workspaceMode==='excel'&&<button disabled={!sheetSelection} onClick={()=>setChartOpen(true)}><span className="studio-glyph">▥</span><small>グラフ作成</small></button>}
          </nav>
          <div className="notes-stage-center">
            <div ref={scroll} className="notes-scroll" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const files=Array.from(e.dataTransfer.files);const images=files.filter(file=>file.type.startsWith('image/'));if(images.length===files.length&&files.length)void placeImages(images);else void attach(files);}}>
              {!record?<div className="notes-welcome"><h2>メモを準備しています</h2><p>文章も、手書きも、ここに。</p><button onClick={()=>void createNote()}>新しいメモを作る</button></div>:<div className="notes-surface" style={{width:Math.max(width*scale,scroll.current?.clientWidth||0),height:Math.max(height*scale,fixedHeight)}}>
                <div ref={plane} className={`notes-plane tool-${tool}`} tabIndex={0} style={{...gridStyle(doc),width,height,transform:`scale(${scale})`,pointerEvents:notes.busy||importing||organizing||meta.trashedAt||meta.importState==='pending'?'none':undefined}}
                  onPasteCapture={pasteWorkspace} onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}} onPointerLeave={()=>{if(!action.current)setEraserCursor(null);}} onPointerDownCapture={down} onPointerMove={move} onPointerUp={e=>up(e)} onPointerCancel={e=>up(e,true)}>
                  <SpreadsheetLayer sheet={sheetForView} active={tool==='sheet'} selection={sheetSelection} onChange={updateSheet} onSelect={setSheetSelection}/>
                  {(['canvas','layout'] as const).map(family=><svg key={family} className="notes-ink" data-studio-family={family} style={{zIndex:familyZ(family)+1}} width={width} height={height}>
                    <defs>{doc?.items.filter(i=>i.kind==='image'&&i.clip&&drawingFamily(i.layerId)===family).map(i=><clipPath key={i.id} id={'kn-clip-'+i.id} clipPathUnits="userSpaceOnUse"><rect x={i.clip!.x} y={i.clip!.y} width={i.clip!.w} height={i.clip!.h}/></clipPath>)}</defs>
                    {doc?.layers.filter(l=>l.visible&&l.rasterImageId&&l.rasterBounds&&drawingFamily(l.id)===family).map(l=><g key={l.id} data-layer-id={l.id} opacity={l.opacity??1}><LegacyImage docId={record.id} imageId={l.rasterImageId!} {...l.rasterBounds!}/></g>)}
                    {doc?.items.filter(i=>doc.layers.find(l=>l.id===i.layerId)?.visible!==false&&drawingFamily(i.layerId)===family).sort((a,b)=>doc.layers.findIndex(l=>l.id===a.layerId)-doc.layers.findIndex(l=>l.id===b.layerId)).map(i=><g key={i.id} data-stroke={i.id} data-layer-id={i.layerId} stroke={i.color} strokeWidth={i.width} opacity={(i.opacity??1)*(doc.layers.find(l=>l.id===i.layerId)?.opacity??1)} fill={i.fill||'none'} transform={i.rotation?(()=>{const b=shapeBox(i);return `rotate(${i.rotation} ${b.x+b.w/2} ${b.y+b.h/2})`;})():undefined} clipPath={i.kind==='image'&&i.clip?'url(#kn-clip-'+i.id+')':undefined}>
                      {workspaceMode==='layout'&&(tool==='select'||tool==='vertex'||tool==='magic')&&(()=>{
                        const b=shapeBox(i);
                        return i.kind==='line'?<line x1={i.x} y1={i.y} x2={i.x+i.w} y2={i.y+i.h} stroke="transparent" strokeWidth={Math.max(16,i.width)} pointerEvents="stroke"/>:
                          i.kind==='path'?<polyline points={stroke(i.points||[])} stroke="transparent" strokeWidth={Math.max(16,i.width)} fill="none" pointerEvents="stroke"/>:
                          i.kind==='ellipse'?<ellipse cx={b.x+b.w/2} cy={b.y+b.h/2} rx={b.w/2} ry={b.h/2} fill="transparent" stroke="none" pointerEvents="all"/>:
                          <rect x={b.x} y={b.y} width={Math.max(6,b.w)} height={Math.max(6,b.h)} fill="transparent" stroke="none" pointerEvents="all"/>;
                      })()}
                      <InkMasked id={i.id} masks={i.inkMasks} frame={{...shapeBox(i),w:Math.max(1,shapeBox(i).w),h:Math.max(1,shapeBox(i).h)}}>{i.kind==='path'?<polyline points={stroke(i.points||[])} fill="none" strokeLinecap="round"/>:i.kind==='polygon'?<polygon points={stroke(i.points||[])} strokeLinejoin="round"/>:i.kind==='rect'?<rect x={Math.min(i.x,i.x+i.w)} y={Math.min(i.y,i.y+i.h)} width={Math.abs(i.w)} height={Math.abs(i.h)}/>:i.kind==='ellipse'?<ellipse cx={i.x+i.w/2} cy={i.y+i.h/2} rx={Math.abs(i.w/2)} ry={Math.abs(i.h/2)}/>:i.kind==='line'?<line x1={i.x} y1={i.y} x2={i.x+i.w} y2={i.y+i.h}/>:i.kind==='image'&&i.imageId?(i.imageId.startsWith('file:')?<image href={fileURL(record.id,i.imageId.slice(5))} x={i.x} y={i.y} width={i.w} height={i.h}/>:<LegacyImage docId={record.id} imageId={i.imageId} x={i.x} y={i.y} w={i.w} h={i.h}/>):null}</InkMasked>
                    </g>)}
                    {doc?.paintStrokes?.filter(stroke=>doc.layers.find(l=>l.id===stroke.layerId)?.visible!==false&&drawingFamily(stroke.layerId)===family).sort((a,b)=>doc.layers.findIndex(l=>l.id===a.layerId)-doc.layers.findIndex(l=>l.id===b.layerId)).map(paintStrokeView)}
                    {workspaceMode==='layout'&&hoveredShape&&!selectedIds.includes(hoveredShape)&&(()=>{
                      const graphic:Graphic|undefined=doc?.items.find(i=>i.id===hoveredShape)||doc?.paintStrokes?.find(i=>i.id===hoveredShape);
                      if(!graphic||drawingFamily(graphic.layerId)!==family)return null;const b=graphicBox(graphic),cx=b.x+b.w/2,cy=b.y+b.h/2;
                      return <g pointerEvents="none" transform={graphic.rotation?'rotate('+graphic.rotation+' '+cx+' '+cy+')':undefined} stroke="#44b5ff" strokeWidth={Math.max(3,graphic.width+2)} fill="none" opacity={.92}>
                        {!isItemGraphic(graphic)?<polyline points={stroke(graphic.points)} strokeLinecap="round" strokeLinejoin="round"/>:
                          graphic.kind==='rect'?<rect x={b.x} y={b.y} width={b.w} height={b.h}/>:
                          graphic.kind==='ellipse'?<ellipse cx={cx} cy={cy} rx={b.w/2} ry={b.h/2}/>:
                          graphic.kind==='line'?<line x1={graphic.x} y1={graphic.y} x2={graphic.x+graphic.w} y2={graphic.y+graphic.h}/>:
                          graphic.kind==='path'?<polyline points={stroke(graphic.points||[])} strokeLinecap="round"/>:
                          graphic.kind==='polygon'?<polygon points={stroke(graphic.points||[])}/>:
                          <rect x={b.x} y={b.y} width={b.w} height={b.h}/>}
                        <rect x={b.x-6} y={b.y-6} width={b.w+12} height={b.h+12} rx={3} stroke="#65b5ed" strokeWidth={1.5} strokeDasharray="3 4"/>
                      </g>;
                    })()}
                    {workspaceMode==='layout'&&selectedIds.map(id=>{
                      const graphic:Graphic|undefined=doc?.items.find(i=>i.id===id)||doc?.paintStrokes?.find(i=>i.id===id);
                      if(!graphic||drawingFamily(graphic.layerId)!==family)return null;
                      const b=graphicBox(graphic),cx=b.x+b.w/2,cy=b.y+b.h/2,points=graphicVertices(graphic);
                      const handles:[string,number,number][]=[['nw',b.x,b.y],['n',cx,b.y],['ne',b.x+b.w,b.y],['e',b.x+b.w,cy],['se',b.x+b.w,b.y+b.h],['s',cx,b.y+b.h],['sw',b.x,b.y+b.h],['w',b.x,cy]];
                      const currentSegment=activeSegment?.id===id?activeSegment.index:-1;
                      const segFrom=currentSegment>=0?points[currentSegment]:undefined;
                      const segTo=currentSegment>=0?points[(currentSegment+1)%points.length]:undefined;
                      return <g key={'selection-'+id} stroke="#1686f7" strokeWidth={1.5} transform={graphic.rotation?'rotate('+graphic.rotation+' '+cx+' '+cy+')':undefined}>
                        <rect pointerEvents="none" x={b.x-4} y={b.y-4} width={b.w+8} height={b.h+8} fill="none" strokeDasharray="5 3"/>
                        {id===selected&&(tool==='select'||tool==='magic')&&<>
                          {handles.map(([handle,x,y])=><rect key={handle} data-shape-handle={handle} className="notes-shape-handle" x={x-5} y={y-5} width={10} height={10} fill="#ffffff"/>)}
                          <line pointerEvents="none" x1={cx} y1={b.y} x2={cx} y2={b.y-30}/>
                          <circle data-shape-handle="rotate" className="notes-shape-handle" cx={cx} cy={b.y-30} r={7} fill="#ffffff"/>
                        </>}
                        {id===selected&&tool==='vertex'&&<g>
                          {segFrom&&segTo&&<line x1={segFrom.x} y1={segFrom.y} x2={segTo.x} y2={segTo.y} pointerEvents="none" stroke="#f59e0b" strokeWidth={4}/>}
                          {editableVertexIndices(graphic,isItemGraphic(graphic)?100:22).map(index=>{
                            const p=points[index],active=activeAnchor?.id===id&&activeAnchor.index===index;
                            return <circle key={index} data-shape-handle={'vertex:'+index} className={'notes-shape-handle notes-vertex-anchor '+(active?'active':'')} cx={p.x} cy={p.y} r={active?7:5.5} stroke={active?'#ac5900':'#1686f7'} strokeWidth={active?2.5:1.5} fill={active?'#ffb62d':'#ffffff'}/>;
                          })}
                        </g>}
                      </g>;
                    })}
                    {family==='canvas'&&draft.length>0&&<InkMasked id="draft" frame={inkFrame(draft)} masks={canvasSelection?[inkPolygonMask({id:"draft",layerId:canvasSelection.layerId,points:draft,color:inkColor,width:inkWidth,opacity:inkOpacity},canvasSelection.points,"include")]:undefined}><InkStroke id="draft" points={draft} color={inkColor} width={inkWidth} opacity={(brush==='marker'?.32:1)*inkOpacity} brush={brush} pressure={inkPressure}/></InkMasked>}
                    {family==='layout'&&draftPreset.map(i=><g key={i.id} data-preset-preview="true" stroke={i.color} strokeWidth={i.width} fill={i.fill||'none'} opacity={i.opacity??1} transform={i.rotation?`rotate(${i.rotation} ${i.x+i.w/2} ${i.y+i.h/2})`:undefined} pointerEvents="none">{i.kind==='polygon'?<polygon points={stroke(i.points||[])}/>:i.kind==='path'?<polyline points={stroke(i.points||[])}/>:i.kind==='line'?<line x1={i.x} y1={i.y} x2={i.x+i.w} y2={i.y+i.h}/>:i.kind==='rect'?<rect x={i.x} y={i.y} width={i.w} height={i.h}/>:<ellipse cx={i.x+i.w/2} cy={i.y+i.h/2} rx={i.w/2} ry={i.h/2}/>}</g>)}
                    {family==='layout'&&draftShape&&<g stroke={draftShape.color} strokeWidth={draftShape.width} fill="none" pointerEvents="none">{draftShape.kind==='line'?<line x1={draftShape.x} y1={draftShape.y} x2={draftShape.x+draftShape.w} y2={draftShape.y+draftShape.h}/>:draftShape.kind==='rect'?<rect x={Math.min(draftShape.x,draftShape.x+draftShape.w)} y={Math.min(draftShape.y,draftShape.y+draftShape.h)} width={Math.abs(draftShape.w)} height={Math.abs(draftShape.h)}/>:<ellipse cx={draftShape.x+draftShape.w/2} cy={draftShape.y+draftShape.h/2} rx={Math.abs(draftShape.w/2)} ry={Math.abs(draftShape.h/2)}/>}</g>}
                  </svg>)}
                  {workspaceMode==='canvas'&&<svg className="notes-canvas-overlay" width={width} height={height} style={{zIndex:90}} aria-hidden="true">
                    {(lassoDraft.length>1||canvasSelection)&&<g className="notes-lasso-outline" fill="none"><polygon points={stroke(lassoDraft.length?lassoDraft:canvasSelection!.points)} stroke="white" strokeWidth={2.5/scale}/><polygon points={stroke(lassoDraft.length?lassoDraft:canvasSelection!.points)} stroke="#252525" strokeWidth={1/scale} strokeDasharray={`${5/scale} ${5/scale}`}/></g>}
                    {tool==='eraser'&&eraserCursor&&<g data-eraser-cursor={eraserMode}><circle cx={eraserCursor.x} cy={eraserCursor.y} r={eraserSize/2} fill="none" stroke="white" strokeWidth={3/scale}/><circle cx={eraserCursor.x} cy={eraserCursor.y} r={eraserSize/2} fill="none" stroke="#292929" strokeWidth={1/scale}/>{eraserMode==='stroke'&&<path d={`M${eraserCursor.x-4/scale},${eraserCursor.y-4/scale}l${8/scale},${8/scale}m0,${-8/scale}l${-8/scale},${8/scale}`} stroke="#292929" strokeWidth={1.5/scale}/>}</g>}
                  </svg>}
                  {overlapAt&&overlapItems.length>1&&workspaceMode==='layout'&&<div className="notes-overlap-picker" style={{left:Math.max(8,Math.min(width-190,overlapAt.x+14)),top:Math.max(8,overlapAt.y-10)}}>
                    <button type="button" title="密集した線や図形から選ぶ" aria-expanded={overlapOpen} onPointerDown={e=>e.stopPropagation()} onClick={()=>setOverlapOpen(v=>!v)}>近くの図形 {overlapItems.length}件 ▾</button><button className="notes-overlap-dismiss" type="button" title="候補を閉じる" aria-label="候補リストを閉じる" onPointerDown={e=>e.stopPropagation()} onClick={()=>{clearOverlapTimer();setOverlapItems([]);setOverlapAt(null);setOverlapOpen(false);}}>×</button>
                    {overlapOpen&&<div className="notes-overlap-list" role="group" aria-label="密集部分の図形候補">{overlapItems.map((id,index)=>{const graphic:Graphic|undefined=doc?.items.find(i=>i.id===id)||doc?.paintStrokes?.find(i=>i.id===id);
                      if(!graphic)return null;const layer=doc?.layers.find(l=>l.id===graphic.layerId);
                      return <button key={id} type="button" aria-pressed={selectedIds.includes(id)} onPointerDown={e=>e.stopPropagation()} onPointerEnter={()=>setHoveredShape(id)} onClick={()=>{selectGraphic(id,multiMode);setOverlapItems([]);setOverlapAt(null);setOverlapOpen(false);setHoveredShape(id);}}>{index+1}. {graphicName(graphic)} <small>{layer?.name||'レイヤー'}</small></button>;
                    })}</div>}
                  </div>}
                  <div className="notes-graph-layer" style={{zIndex:familyZ('graph')}}><ChartsLayer sheet={sheet} charts={charts} visibleLayers={new Set((doc?.layers||[]).filter(l=>l.visible).map(l=>l.id))}/></div>
                  {doc?.blocks?.filter(b=>doc.layers.find(l=>l.id===b.layerId)?.visible!==false).map(noteBlock=><EditableBlock key={noteBlock.id} docId={record!.id} onDownloadFile={saveAttachment} block={noteBlock} zIndex={familyZ('layout')} opacity={doc.layers.find(l=>l.id===noteBlock.layerId)?.opacity??1} readOnly={tool!=='text'||!!doc?.layers.find(l=>l.id===noteBlock.layerId)?.locked||!!meta.trashedAt||organizing||importing||notes.busy||meta.importState==='pending'} selected={selectedIds.includes(noteBlock.id)} focused={focus===noteBlock.id} onFocus={()=>{setSelected(noteBlock.id);setFocus(noteBlock.id);}}
                    onChange={(html,h)=>updateBlock(noteBlock.id,html,h)} onDrag={(e,resize)=>drag(e,noteBlock.id,resize)} onSize={h=>setSizes(old=>old[noteBlock.id]===h?old:{...old,[noteBlock.id]:h})}
                    onPaste={files=>void attach(files)} onNavigate={id=>void notes.open(id)}/>)}
                  {record&&<FixedNoteLayer docId={record.id} onDownloadFile={saveAttachment} html={fixedNote.html} opacity={fixedNote.opacity??1} width={scroll.current?.clientWidth||innerWidth} viewportHeight={scroll.current?.clientHeight||400} onHeight={setFixedHeight} visible={fixedNote.visible} locked={fixedNote.locked||!!meta.trashedAt||organizing||importing||notes.busy||meta.importState==='pending'} active={tool==='note'} scale={scale} zIndex={familyZ('note')} height={Math.max(height*scale,fixedHeight)} onChange={updateFixedNote} onPaste={files=>void attach(files)}/>}
                </div>
              </div>}
            </div>

          </div>
          {!focusMode&&workspaceMode==='excel'&&sheetDependents.length>0&&<div className="kn-sheet-dependents" role="region" aria-label="このExcelレイヤーを参照しているノート">
            <strong>このExcelを参照中</strong>
            {sheetDependents.map(d=><button key={d.id} title={d.title} onClick={()=>void notes.open(d.id)}>{d.title}</button>)}
          </div>}
          {narrowPanels&&layerDock()}
          {workspaceMode==='layout'&&selectedGraphic&&<div className="notes-fine-panel" role="group" aria-label="図形の微調整">
            <strong>図形の微調整</strong>
            <label>横移動 <input type="range" min="-20" max="20" step="1" value={fineX} onChange={e=>{const v=Number(e.target.value);editSelectedShape(i=>moveGraphic(i,v-fineX,0));setFineX(v);}} onPointerUp={()=>setFineX(0)}/><span>±20px</span></label>
            <label>縦移動 <input type="range" min="-20" max="20" step="1" value={fineY} onChange={e=>{const v=Number(e.target.value);editSelectedShape(i=>moveGraphic(i,0,v-fineY));setFineY(v);}} onPointerUp={()=>setFineY(0)}/><span>±20px</span></label>
            <label>回転 <input type="range" min="-30" max="30" step="1" value={fineAngle} onChange={e=>{const v=Number(e.target.value);editSelectedShape(i=>({...i,rotation:(i.rotation||0)+v-fineAngle}));setFineAngle(v);}} onPointerUp={()=>setFineAngle(0)}/><span>{Math.round(selectedGraphic.rotation||0)}°</span></label>
            <div className="notes-fine-buttons"><button onClick={()=>editSelectedShape(i=>moveGraphic(i,-1,0))}>←1</button><button onClick={()=>editSelectedShape(i=>moveGraphic(i,1,0))}>1→</button><button onClick={()=>editSelectedShape(i=>moveGraphic(i,0,-1))}>↑1</button><button onClick={()=>editSelectedShape(i=>moveGraphic(i,0,1))}>↓1</button></div>
          </div>}
        </div>
        {!!doc?.attachments?.length&&<div className="notes-attachments"><Paperclip size={15}/>{doc.attachments.map(a=><button key={a.id} title="添付の原本をファイルとして保存" aria-label={a.name+'の原本を保存'} onClick={()=>saveAttachment(a.id,a.name)}><FileDown size={14}/>{a.name} <small>{formatFileSize(a.size)}</small></button>)}</div>}
        </div>
        {!narrowPanels&&layerDock()}
      </section>
      {!sharedAccess&&settings&&<aside className="notes-settings"><div className="notes-settings-title"><h2>環境設定・メモの整理</h2><button onClick={()=>setSettings(false)} aria-label="設定を閉じる"><X size={18}/></button></div>
        <button onClick={()=>showOrganizer(true)}><Folder size={17}/>ページ・フォルダを整理／データを取り出す</button>
        {shortcutHelpButton()}
        <section className="kn-settings-group">
          <h3>ChatGPT接続</h3>
          <p>接続状態：{aiConfigured===null?'確認中':aiConfigured?'利用できます':'APIキー未設定'}</p>
          <p>ノート整理・関連ノート解析・音声文字起こしに対応。実行時だけ必要な内容をOpenAI APIへ送信します。オフラインでは使いません。</p>
          <button disabled={aiBusy||!aiConfigured} onClick={()=>void callChatGPT('organize')}>{aiBusy?'解析中…':'現在のノートを整理する'}</button>
          <button disabled={aiBusy||!aiConfigured} onClick={()=>aiAudioInput.current?.click()}>音声を文字起こし</button>
          <p>サーバー側の環境変数 KAERUNOTE_OPENAI_API_KEY が必要です。キーをGitに入れないでください。</p>
          {aiResult&&<div className="kn-ai-result"><label>AIの結果（編集可能）<textarea rows={9} value={aiResult} onChange={e=>setAiResult(e.target.value)}/></label>
            <button onClick={insertAIResult}>確認してノート末尾に追加</button>
            <button onClick={()=>setAiResult('')}>破棄</button></div>}
        </section>
        <section className="kn-settings-group">
          <h3>表示と操作</h3>
          <label className="notes-check"><input type="checkbox" checked={sidebarAutoClose} onChange={e=>{
            setSidebarAutoClose(e.target.checked);
            savePreference('kn-navigation-autoclose',e.target.checked?'on':'off');
          }}/>Noteを開く・新規作成したら左のメニューを自動で閉じる</label>
          <p>初期設定はOFFです。左メニューはウインドウマークで、カテゴリ選択は「閉じる」で手動開閉できます。</p>
          <button disabled={offlinePreparing} onClick={()=>void prepareOffline()}>{offlinePreparing?'オフライン準備中…':'すべてのノートと添付を端末に保存'}</button>
          <p>ブラウザ／アプリ内部のオフライン用保存です。ファイルとして取り出すには「ページ・フォルダを整理／データを取り出す」を開いてZIPを保存してください。</p>
          {offlineProgress&&<p role="status">ノート {offlineProgress.done}/{offlineProgress.total}件、添付 {offlineProgress.files}件、未取得 {offlineProgress.errors}件</p>}
          <p>ネット接続中に一度実行すると、端末の容量が許す範囲で全ノート・画像・添付を保存します。保存済みの内容は通信なしで開けます。端末の空き容量とブラウザの保存制限に注意してください。</p>
          <button onClick={()=>void openRevisions()}>ローカル履歴を表示</button>
          <p>保存時に端末内へ最大25世代を記録します。履歴から復元しても、元の世代は残ります。</p>
          <p>同期が不要なノート編集とカテゴリ変更は端末に保存します。共有やChatGPT連携にはネットワーク接続が必要です。</p>
        </section>
        <label>別ノート参照用の名前（例：lN111）
          <input key={record?.id+':alias:'+meta.alias} defaultValue={meta.alias||''} placeholder="lN111" onBlur={e=>{
            const value=e.target.value.trim();
            if(value&&!/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(value)){notes.setError('別名は半角英字で始め、英数字と _ - のみ使えます');return;}
            if(value!==(meta.alias||''))changeMeta({alias:value});
          }}/>
        </label>
        <p>Excel参照：同じノートは <code>{'{{C1}}'}</code>、別ノートは <code>{'{{lN111:C5}}'}</code> のように書きます。参照先のノートに上記の別名を設定してください。保存または「参照値を更新」で反映します。</p>
        <label>カテゴリ（ / で入れ子）<input disabled={!!meta.trashedAt||organizing} key={record?.id+':category:'+meta.category} defaultValue={meta.category} maxLength={200} onBlur={e=>{e.target.value=categoryPath(e.target.value);changeMeta({category:e.target.value});}} list="note-categories"/></label><datalist id="note-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
        <button disabled={organizing||importing||attaching} onClick={()=>setCategoryManager(true)}>カテゴリの追加・移動・タグ化</button>
        <label>タグ（カンマ区切り）<input disabled={!!meta.trashedAt||organizing} key={record?.id+':tags:'+meta.tags.join(',')} defaultValue={meta.tags.join(', ')} onBlur={e=>changeMeta({tags:[...new Set(e.target.value.split(/[,、]/).map(t=>t.trim()).filter(Boolean))].slice(0,50)})}/></label>
        <button onClick={()=>changeMeta({pinned:!meta.pinned})}><Pin size={16}/>{meta.pinned?'ピン留めを解除':'一覧の上にピン留め'}</button>
        {meta.isTodo&&<label className="notes-todo"><input type="checkbox" checked={!!meta.completed} onChange={e=>changeMeta({completed:e.target.checked})}/>このToDoを完了</label>}
        <hr/><section className="kn-settings-group"><h3>書き出し</h3>
          <p>ノートを画像・テキスト・Word形式で保存します。画像は現在の作業画面、Wordは文章と表を対象とします。</p>
          <button onClick={()=>{const area=document.querySelector<HTMLElement>('.notes-stage');if(area&&record)void exportPng(area,record.title).catch(err=>notes.setError('画像書き出し失敗：'+String(err)));}}>画像（PNG）で書き出す</button>
          <button onClick={()=>{if(record)exportPlain(record);}}>テキスト（TXT）で書き出す</button>
          <button onClick={()=>{if(record)void exportDocx(record).catch(err=>notes.setError('Word書き出し失敗：'+String(err)));}}>Word（DOCX）で書き出す</button>
        </section>
        <button onClick={()=>record&&download(record.title+'.md',exportMarkdown(record))}><FileDown size={16}/>このメモをMDに書き出す</button>

        <button onClick={()=>void exportAll()}><FileDown size={16}/>全メモを整理用に書き出す</button>
        <p>書き出したMDと分類ファイルをChatGPTに渡して「整理して」と依頼できます。整理後の分類ファイルを読み込むと、カテゴリとタグを反映します。</p>
        <button disabled={organizing||!!meta.trashedAt} onClick={()=>organizationInput.current?.click()}><Upload size={16}/>整理した分類を読み込む</button>
        <button onClick={()=>{setImportOpen(true);setSettings(false);}}><Upload size={16}/>JoplinのJEXを取り込む</button>
        {meta.sourceNotebook&&<p>元のノートブック<br/>{meta.sourceNotebook}</p>}
      </aside>}
    </div>
    {!sharedAccess&&shareOpen&&<div className="notes-modal" onMouseDown={e=>{if(e.target===e.currentTarget)setShareOpen(false);}}>
      <section role="dialog" aria-modal="true" aria-labelledby="notes-share-title" className="notes-share-dialog">
        <div className="notes-settings-title">
          <h2 id="notes-share-title"><Share2 size={19}/> 作品を共有</h2>
          <button aria-label="共有画面を閉じる" onClick={()=>setShareOpen(false)}><X size={19}/></button>
        </div>
        <p>共有リンクを知っている人は、この作品を開いて編集できます。相手の画面には、あなたのメモ一覧は表示されません。</p>
        <p>変更は約2.5秒ごとに反映されます。異なる図形への編集は統合しますが、同じ箇所を同時に変更すると競合確認が必要です。</p>
        {shareLink&&<div className="notes-share-link">
          <label htmlFor="notes-share-url">編集用リンク</label>
          <input id="notes-share-url" readOnly value={shareLink} onFocus={e=>e.currentTarget.select()}/>
          <button className="notes-primary" onClick={()=>void copyShare()}>{shareCopied?'コピーしました':'リンクをコピー'}</button>
        </div>}
        {!shareLink&&shareEnabled&&<p className="notes-share-hint">すでに共有リンクが発行されています。新しいリンクを発行すると、古いリンクは無効になります。</p>}
        {shareError&&<p role="alert" className="notes-share-error">{shareError}</p>}
        <div className="notes-share-actions">
          <button disabled={shareBusy} className="notes-primary" onClick={()=>void createShare()}>{shareBusy?'処理中…':shareEnabled?'新しい共有リンクを発行':'共有リンクを発行'}</button>
          {shareEnabled&&<button disabled={shareBusy} onClick={()=>void revokeShare()}>共有を停止</button>}
        </div>
        <p className="notes-share-footnote">※ リンクの扱いに注意してください。未公開の情報を含む作品は、必要な相手だけに渡してください。</p>
      </section>
    </div>}
    {revisionsOpen&&<div className="notes-modal">
      <section className="kn-revisions-dialog" role="dialog" aria-modal="true" aria-labelledby="kn-revisions-title">
        <div className="notes-settings-title"><h2 id="kn-revisions-title">この端末の保存履歴</h2>
          <button aria-label="閉じる" onClick={()=>setRevisionsOpen(false)}><X size={18}/></button></div>
        <p>復元すると現在のノートの内容が変更されます。必要な世代を選んでください。</p>
        {revisions.length===0?<p>保存された履歴がありません。</p>:revisions.map(row=><button className="kn-revision-row" key={row.id} onClick={()=>restoreRevision(row)}>
          <strong>{new Date(row.createdAt).toLocaleString('ja-JP')}</strong><span>{row.title}</span><small>Revision {row.revision}</small>
        </button>)}
      </section>
    </div>}
    {tableOpen&&<div className="notes-modal" onMouseDown={e=>{if(e.target===e.currentTarget)setTableOpen(false);}}>
      <section role="dialog" aria-modal="true" aria-labelledby="kn-table-title" className="kn-table-dialog">
        <div className="notes-settings-title"><h2 id="kn-table-title">{tableOpts.kind==='columns'?'段組み・表組み':'表'}の設定</h2>
          <button aria-label="閉じる" onClick={()=>setTableOpen(false)}><X size={18}/></button></div>
        <p>通常の表は行と列にデータを入力します。表組みはレイアウト用で、セルを自由に文章配置に使えます。</p>
        <label>種類<select value={tableOpts.kind} onChange={e=>setTableOpts(o=>({...o,kind:e.target.value as TableOptions['kind']}))}><option value="table">通常の表</option><option value="columns">段組みレイアウト</option></select></label>
        <div className="kn-table-options-row"><label>行数<input type="number" min={1} max={20} value={tableOpts.rows} onChange={e=>setTableOpts(o=>({...o,rows:Math.max(1,Math.min(20,Number(e.target.value)||1))}))}/></label>
          <label>列数<input type="number" min={1} max={12} value={tableOpts.cols} onChange={e=>setTableOpts(o=>({...o,cols:Math.max(1,Math.min(12,Number(e.target.value)||1))}))}/></label>
          <label>幅（画面％）<input type="number" min={10} max={100} value={tableOpts.width} onChange={e=>setTableOpts(o=>({...o,width:Math.max(10,Math.min(100,Number(e.target.value)||10))}))}/></label></div>
        <label>横位置<select value={tableOpts.align} onChange={e=>setTableOpts(o=>({...o,align:e.target.value as TableOptions['align']}))}><option value="fit">画面幅にフィット</option><option value="left">左</option><option value="center">中央</option><option value="right">右</option></select></label>
        <label>高さ<select value={tableOpts.height} onChange={e=>setTableOpts(o=>({...o,height:e.target.value as TableOptions['height']}))}><option value="auto">自動（推奨）</option><option value="fixed">固定（文字が見切れる場合があります）</option></select></label>
        {(tableOpts.height==='fixed'||tableOpts.kind==='columns'&&tableOpts.flow==='next')&&<label>高さ（文字の行数）<input type="number" min={1} max={50} value={tableOpts.lines} onChange={e=>setTableOpts(o=>({...o,lines:Math.max(1,Math.min(50,Number(e.target.value)||1))}))}/></label>}
        <label>文字のあふれ方<select value={tableOpts.flow} onChange={e=>setTableOpts(o=>({...o,flow:e.target.value as TableOptions['flow']}))}><option value="expand">セルを拡張</option><option value="next">次のセルへ自動で流し込む（段組み）</option></select></label>
        <div className="notes-dialog-actions"><button onClick={()=>setTableOpen(false)}>キャンセル</button><button className="notes-primary" onClick={applyTable}>適用</button></div>
      </section>
    </div>}
    {categoryManager&&<CategoryManager paths={categories} initial={category} initialKind={categoryManagerKind} busy={organizing||classificationStatus==='syncing'} onClose={()=>setCategoryManager(false)} onApply={organize}/>}
    {deleteOpen&&<div className="notes-modal"><section role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">メモをゴミ箱へ移動</h2><p>「{record?.title}」をゴミ箱へ移動します。あとから復元できます。</p><button onClick={()=>setDeleteOpen(false)}>キャンセル</button><button className="notes-primary" onClick={()=>setTrashed(true)}>ゴミ箱へ移動</button></section></div>}
    {chartOpen&&<div className="notes-modal"><section role="dialog" aria-modal="true" aria-labelledby="chart-title"><div className="notes-settings-title"><h2 id="chart-title">グラフを作成</h2><button onClick={()=>setChartOpen(false)} aria-label="閉じる"><X size={18}/></button></div><p>Excelレイヤーで選択した範囲を参照する、グラフレイヤーの子オブジェクトを作成します。元データを変更するとグラフも更新されます。</p><label>種類<select value={chartType} onChange={e=>setChartType(e.target.value as ChartItem['type'])}><option value="bar">棒グラフ</option><option value="line">折れ線グラフ</option><option value="pie">円グラフ</option></select></label><div className="notes-dialog-actions"><button onClick={()=>setChartOpen(false)}>キャンセル</button><button className="notes-primary" onClick={createChart}>作成</button></div></section></div>}
    {layerProperties&&studio&&<div className="notes-modal"><section className="kn-layer-properties" role="dialog" aria-modal="true" aria-labelledby="layer-properties-title">
      <div className="notes-settings-title"><h2 id="layer-properties-title">レイヤープロパティ</h2><button onClick={()=>setLayerProperties('')} aria-label="レイヤープロパティを閉じる"><X size={20}/></button></div>
      {(()=>{const isNote=layerProperties==='note',layer=isNote?{id:'note',name:studio.studioNames?.note||'ノート',...fixedNote}:studio.layers.find(l=>l.id===layerProperties);if(!layer)return <p>レイヤーが見つかりません</p>;
        const patch=(value:Record<string,unknown>)=>{const d=current.current?.content as StudioNoteDoc;if(isNote){const {name,...properties}=value;commit({...d,studioNames:name?{...d.studioNames,note:String(name)}:d.studioNames,fixedNote:{...d.fixedNote!,...properties}} as NoteDoc);}else commit({...d,layers:d.layers.map(l=>l.id===layerProperties?{...l,...value}:l)});};
        return <><label>名前<input aria-label="レイヤー名" maxLength={60} value={layer.name} onChange={e=>patch({name:e.target.value})}/></label>
          <label>不透明度<input aria-label="プロパティの不透明度" type="range" min="0" max="100" value={Math.round((layer.opacity??1)*100)} onChange={e=>patch({opacity:Number(e.target.value)/100})}/><output>{Math.round((layer.opacity??1)*100)}%</output></label>
          <label><input type="checkbox" checked={layer.visible} onChange={e=>patch({visible:e.target.checked})}/>表示</label><label><input type="checkbox" checked={layer.locked} onChange={e=>patch({locked:e.target.checked})}/>ロック</label>
          <div className="kn-layer-property-actions"><strong>読み込み</strong>{isNote?<button disabled={attaching||layer.locked} onClick={()=>requestLayerImport('text')}>テキスト読み込み（TXT／MD）</button>:<><button disabled={attaching||layer.locked} onClick={()=>requestLayerImport('image')}>画像読み込み</button><button disabled={attaching||layer.locked} onClick={()=>requestLayerImport('pdf')}>PDF読み込み</button></>}</div>
          {layerImportProgress&&<p role="status">{layerImportProgress}</p>}
          <div className="kn-layer-property-actions"><strong>書き出し</strong>{isNote?<><button onClick={()=>void exportLayer('txt')}>TXT</button><button onClick={()=>void exportLayer('md')}>MD</button><button onClick={()=>void exportLayer('docx')}>Word</button></>:<><button disabled={!layer.visible} onClick={()=>void exportLayer('png')}>表示範囲をPNG</button><button onClick={()=>void exportLayer('json')}>配置JSON</button></>}</div>
          {!isNote&&<small>配置JSONの画像はノート内の参照です。PDFは各ページを画像として配置し、原本も添付に保持します。</small>}
        </>;})()}
    </section></div>}
    <input hidden ref={layerImageInput} type="file" accept="image/*" multiple onChange={e=>{const target=layerImportTarget.current;if(target&&current.current?.id===notes.resolveId(target.docId))void placeImages(Array.from(e.target.files||[]),target.id);e.target.value='';}}/>
    <input hidden ref={layerPdfInput} type="file" accept="application/pdf,.pdf" onChange={e=>{if(e.target.files?.[0])void importLayerPdf(e.target.files[0]);e.target.value='';}}/>
    <input hidden ref={noteTextInput} type="file" accept="text/plain,text/markdown,.txt,.md" onChange={e=>{if(e.target.files?.[0])void importNoteText(e.target.files[0]);e.target.value='';}}/>
    <input ref={aiAudioInput} hidden type="file" accept=".flac,.mp3,.mp4,.mpeg,.mpga,.m4a,.ogg,.wav,.webm,audio/*" onChange={e=>{const file=e.target.files?.[0];if(file)void transcribeAudio(file);e.target.value='';}}/>
    <input ref={fileInput} hidden type="file" multiple onChange={e=>{void attach(Array.from(e.target.files||[]));e.target.value='';}}/>
    <input ref={imageInput} hidden type="file" accept="image/*" multiple onChange={e=>{void placeImages(Array.from(e.target.files||[]));e.target.value='';}}/>
    <input ref={organizationInput} hidden type="file" accept=".json" onChange={e=>{if(e.target.files?.[0])void applyOrganization(e.target.files[0]);e.target.value='';}}/>
    {shortcutHelp&&<WorkspaceShortcutHelp onClose={()=>setShortcutHelp(false)}/>}
    {importOpen&&<div className="notes-modal"><section role="dialog" aria-modal="true" aria-labelledby="jex-title"><div className="notes-settings-title"><h2 id="jex-title">Joplinから取り込む</h2><button disabled={importing} onClick={()=>setImportOpen(false)} aria-label="取り込み画面を閉じる"><X size={20}/></button></div>
      <p>JEXを選ぶと、メモ・ノートブック・タグ・画像・添付ファイルをまとめて取り込めます。</p>
      <button disabled={importing} className="notes-file-pick" onClick={()=>jexInput.current?.click()}><Upload size={24}/>JEXファイルを選択</button>
      <input hidden ref={jexInput} type="file" accept=".jex" onChange={e=>{if(e.target.files?.[0])void loadJex(e.target.files[0]);e.target.value='';}}/>
      {archive&&<><div className="notes-import-counts"><strong>{archive.notes.length}<span>メモ</span></strong><strong>{archive.notebooks.length}<span>ノートブック</span></strong><strong>{archive.resources.length}<span>添付</span></strong></div>
        <p>元の本文・分類も保持します。同じメモの再取り込みはスキップし、途中で止まった分は再開します。</p><button className="notes-primary" disabled={importing} onClick={()=>void runImport()}>取り込みを開始</button></>}
      <p role="status">{importMessage}</p>{importing&&<button onClick={()=>{cancelImport.current=true;setImportMessage('現在の添付を保存後に中断します…');}}>中断</button>}
    </section></div>}
    {!sharedAccess&&organizerOpen&&<NoteOrganizer accountId={accountId} store={notes} categories={categories} workspace={workspace} status={{saved:'保存済み',syncing:'同期中',pending:'端末に保存済み・同期待ち',conflict:'競合あり',complete:'同期完了'}[classificationStatus]} busy={organizing||importing||attaching||notes.busy||classificationStatus==='syncing'} onClose={()=>showOrganizer(false)} onOpen={async id=>{if(!await notes.open(id))throw new Error('ページを開けません。この端末への保存状況と接続を確認してください');finishNoteSelection();showOrganizer(false);}} onFolder={(kind,path)=>{setCategory(path);setCategoryManagerKind(kind);setCategoryManager(true);}} onAssign={assignPages} onResolve={resolveClassification} onExportForAI={()=>exportAll(true)} onImport={async file=>{if(file.size>2_000_000)throw new Error('整理ファイルが大きすぎます');const payload=JSON.parse(await file.text());if(!payload||payload.version!==1||!Array.isArray(payload.notes))throw new Error('整理ファイルの形式が不正です');await assignPages(payload.notes,true);}}/>}
  </main>;
}
