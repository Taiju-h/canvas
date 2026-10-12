import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PanelLeft, Plus, MoreHorizontal, Search, Share2, Save, FileDown, Upload, Paperclip, Type, Pencil, MousePointer2, MousePointer, Hand, Undo2, Redo2, Bold, Italic, Underline, Superscript, Subscript, Highlighter, Table2, Columns3, ChevronDown, ChevronLeft, List, ListChecks, ImagePlus, Pin, X, Folder, Tag, Settings2, Copy, Trash2, Eraser, ZoomIn, ZoomOut, Box, Maximize2, Minimize2, Palette } from 'lucide-react';
import EditableBlock from './note-block';
import {CategoryTree,CategoryManager,type CategoryOperation} from './note-categories';
import {categoryPath,categoryPaths,inCategory,movedCategory,matchesSearch,searchExcerpt} from '@/lib/note-organization';
import { useNotes, type SharedAccess } from '@/lib/use-notes';
import { api, blankNote, block, cleanHTML, download, escapeHTML, exportMarkdown, fileURL, id32, plainText, uploadAttachment, type NoteBlock, type NoteDoc, type NoteMeta, type NoteRecord, type Attachment } from '@/lib/notes';
import { readJex, type JexArchive } from '@/lib/jex';
import { importJex } from '@/lib/import-jex';
import { inverseTransformPoint, type Point, type Item } from '@/lib/canvas';
import { ChartsLayer, FixedNoteLayer, LayerPanel, SpreadsheetLayer, type CellRange, type ChartItem, type SheetData, type StudioNoteDoc } from './note-studio-layers';
import '../notes.css';
import { getLocalImage, getLocalDoc, putLocalImage, listLocalDocs } from '@/lib/local-docs';
import { loadOfflineWorkspace, persistOfflineWorkspace, locallyApplyCategory, type OfflineWorkspace } from '@/lib/offline-workspace';
import {tableMarkup,editTable,currentTable,currentCell,setTableOptions,selectedString,insertRichHTML,applyRuby,applyRedMark,type TableOptions} from '@/lib/rich-note-commands';
import {listLocalRevisions,type LocalRevision} from '@/lib/local-docs';

function LegacyImage({docId,imageId,x,y,w,h}:{docId:string;imageId:string;x:number;y:number;w:number;h:number}) {
  const [url,setURL]=useState('');
  useEffect(()=>{let live=true;let objectURL='';void getLocalImage(imageId).then(blob=>{if(!live)return;
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
  return <div className="notes-color-studio" onMouseDown={e=>e.preventDefault()}>
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
type Action={pointerId:number;verticalOnly?:boolean;moved?:boolean;handle?:string;kind:'move'|'resize'|'ink'|'pan'|'shape'|'shapeResize'|'shapeRotate'|'vertexMove'|'segmentMove';id?:string;start:Point;original:NoteDoc;points?:Point[];scroll?:{left:number;top:number};pen?:boolean;blockId?:string;shapeKind?:'line'|'rect'|'ellipse'};
function storedSidebar(){try{return localStorage.getItem('canvas-notes-sidebar')!=='closed' && innerWidth>760;}catch{return innerWidth>760;}}
export default function NotesWorkspace({accountId,sharedAccess}:{accountId:string;sharedAccess?:SharedAccess}){
  const notes=useNotes(accountId,sharedAccess);const {record}=notes;
  const [shareOpen,setShareOpen]=useState(false);
  const [shareLink,setShareLink]=useState('');
  const [shareEnabled,setShareEnabled]=useState(false);
  const [shareBusy,setShareBusy]=useState(false);
  const [shareError,setShareError]=useState('');
  const [shareCopied,setShareCopied]=useState(false);
  const lastShareDoc=useRef('');
  const [sidebar,setSidebar]=useState(()=>sharedAccess?false:storedSidebar());
  const [sidebarAutoClose,setSidebarAutoClose]=useState(()=>{try{return localStorage.getItem('kn-sidebar-autoclose')!=='off';}catch{return true;}});
  const [relatedPanel,setRelatedPanel]=useState(false);const [sidebarMenuOpen,setSidebarMenuOpen]=useState(false);const [query,setQuery]=useState('');const [category,setCategory]=useState('');const [tag,setTag]=useState('');
  const [tool,setTool]=useState<'note'|'text'|'pen'|'select'|'vertex'|'magic'|'hand'|'eraser'|'line'|'rect'|'ellipse'|'sheet'>('note');const [workspaceMode,setWorkspaceMode]=useState<'note'|'canvas'|'layout'|'excel'|'graph'>('note');const [inkColor,setInkColor]=useState('#263443');const [inkWidth,setInkWidth]=useState(3);const [inkOpacity,setInkOpacity]=useState(1);const [brush,setBrush]=useState<'pen'|'gpen'|'marker'>('gpen');
  const [activeLayer,setActiveLayer]=useState('');const [layersOpen,setLayersOpen]=useState(true);const [sheetSelection,setSheetSelection]=useState<CellRange|undefined>();const [sheetPreviewOpen,setSheetPreviewOpen]=useState(false);const [chartOpen,setChartOpen]=useState(false);const [chartType,setChartType]=useState<ChartItem['type']>('bar');const [chartLayer,setChartLayer]=useState('');const [draftShape,setDraftShape]=useState<Item|null>(null);
  const [selected,setSelected]=useState('');const [activeAnchor,setActiveAnchor]=useState<ActiveAnchor|null>(null);const [activeSegment,setActiveSegment]=useState<ActiveAnchor|null>(null);const [multiSelected,setMultiSelected]=useState<string[]>([]);const [multiMode,setMultiMode]=useState(false);const [hoveredShape,setHoveredShape]=useState('');const [overlapItems,setOverlapItems]=useState<string[]>([]);const [overlapAt,setOverlapAt]=useState<Point|null>(null);const [overlapOpen,setOverlapOpen]=useState(false);const [fineX,setFineX]=useState(0);const [fineY,setFineY]=useState(0);const [fineAngle,setFineAngle]=useState(0);const [focus,setFocus]=useState('');const [settings,setSettings]=useState(false);const [scale,setScale]=useState(1);
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const [fontStep,setFontStep]=useState(3);
  const [bulletSize,setBulletSize]=useState<'large'|'medium'|'small'>('large');
  const [rubyColor,setRubyColor]=useState('#9d5b30');
  const [imagePlacement,setImagePlacement]=useState<'inline'|'overlay'>('inline');
  const [imageAlign,setImageAlign]=useState<'left'|'center'|'right'>('left');
  const [tableOpen,setTableOpen]=useState(false);
  const [tableSelected,setTableSelected]=useState(false);
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
  const [categoryManager,setCategoryManager]=useState(false);const [organizing,setOrganizing]=useState(false);
  const [workspace,setWorkspace]=useState<OfflineWorkspace>(()=>loadOfflineWorkspace(accountId));
  const workspaceRef=useRef(workspace);workspaceRef.current=workspace;
  const syncingWorkspace=useRef(false);
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
  const [draft,setDraft]=useState<Point[]>([]);const [sizes,setSizes]=useState<Record<string,number>>({});
  const hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null);const scroll=useRef<HTMLDivElement>(null);const plane=useRef<HTMLDivElement>(null);const action=useRef<Action|null>(null);
  const fittedViewport=useRef({id:'',width:0});const extent=useRef({id:'',width:1800,height:1400});const suppressClick=useRef(false);
  const current=useRef(record);current.current=record;const cancelImport=useRef(false);const fileInput=useRef<HTMLInputElement>(null);const imageInput=useRef<HTMLInputElement>(null);const jexInput=useRef<HTMLInputElement>(null);const organizationInput=useRef<HTMLInputElement>(null);
  const undoStack=useRef<NoteDoc[]>([]);const redoStack=useRef<NoteDoc[]>([]);const typing=useRef<{id:string;at:number}|null>(null);const [,redraw]=useState(0);const lastPen=useRef(0);const previousId=useRef('');const focusRestore=useRef({sidebar:false,layersOpen:true});const colorFadeTimer=useRef<number|undefined>(undefined);const colorCloseTimer=useRef<number|undefined>(undefined);
  const doc=record?.content;const selectedShape=doc?.items.find(i=>i.id===selected);const selectedStroke=doc?.paintStrokes?.find(i=>i.id===selected);const selectedGraphic:Graphic|undefined=selectedShape||selectedStroke;
  const selectedIds=selected?[...new Set([selected,...multiSelected.filter(id=>!!doc?.items.some(i=>i.id===id)||!!doc?.paintStrokes?.some(i=>i.id===id))])]:[];const studio=doc as StudioNoteDoc|undefined;const meta=doc?.note||{category:'',tags:[]};
  const fixedNote=studio?.fixedNote||{html:'',visible:true,locked:false};const sheet=studio?.sheet||{visible:false,locked:false,rows:20,cols:10,cells:{}};const sheetHasData=Object.values(sheet.cells||{}).some(value=>String(value).trim()!=='');const sheetForView=sheetPreviewOpen&&!sheet.visible?{...sheet,visible:true}:sheet;const charts=studio?.charts||[];
  useEffect(()=>{if(!record)return;const promoted=previousId.current.startsWith('local-')&&!record.id.startsWith('local-');previousId.current=record.id;if(promoted)return;setSelected('');setActiveAnchor(null);setActiveSegment(null);setMultiSelected([]);setHoveredShape('');setOverlapItems([]);setOverlapAt(null);setFocus('');setSizes({});undoStack.current=[];redoStack.current=[];typing.current=null;setTool(sharedAccess?'select':'note');setWorkspaceMode(sharedAccess?'layout':'note');setSheetSelection(undefined);setSheetPreviewOpen(false);const layers=(record.content as StudioNoteDoc).layers;setActiveLayer((sharedAccess?layers.find(l=>(l.studioKind||'canvas')==='layout'&&l.visible&&!l.locked)?.id:undefined)||layers.find(l=>(l.studioKind||'canvas')==='canvas'&&l.visible&&!l.locked)?.id||layers.find(l=>l.visible&&!l.locked)?.id||layers[0]?.id||'');scroll.current?.scrollTo(0,0);},[record?.id]);
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
  function toggleSidebar(){if(sharedAccess)return;setSidebar(old=>{const next=!old;try{localStorage.setItem('canvas-notes-sidebar',next?'open':'closed');}catch{}return next;});}
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
    const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return'';
    let layer=d.layers.find(l=>(l.studioKind||'canvas')===kind&&l.visible&&!l.locked);
    if(!layer){const id=id32();layer={id,name:(kind==='canvas'?'キャンバス ':'レイアウト ')+(d.layers.filter(l=>(l.studioKind||'canvas')===kind).length+1),visible:true,locked:false,studioKind:kind};commit({...d,layers:[...d.layers,layer]} as NoteDoc);}
    setActiveLayer(layer.id);setWorkspaceMode(kind);return layer.id;
  }
  function chooseTool(next:typeof tool){
    if(next!=='sheet'&&workspaceMode==='excel'&&!sheetHasData)setSheetPreviewOpen(false);
    if(next==='note'||next==='text'){setWorkspaceMode('note');setTool(next);return;}
    if(next==='sheet'){useSheetLayer();return;}
    if(next==='pen'||next==='eraser'){activateFamily('canvas');setTool(next);setFocus('');return;}
    if(next==='select'||next==='vertex'||next==='magic'||next==='line'||next==='rect'||next==='ellipse'){activateFamily('layout');setTool(next);setFocus('');return;}
    setTool(next);setFocus('');
  }
  function toggleFocusMode(){setFocusMode(v=>{const next=!v;if(next){focusRestore.current={sidebar,layersOpen};setSidebar(false);setLayersOpen(false);setFocusFloat({x:Math.max(16,innerWidth-76),y:72});setDrawer('');}else{setSidebar(focusRestore.current.sidebar);setLayersOpen(focusRestore.current.layersOpen);setDrawer('');setFocusDrag(null);}return next;});}
  function focusButtonDown(e:ReactPointerEvent<HTMLButtonElement>){if(!focusMode)return;const r=e.currentTarget.getBoundingClientRect();setFocusDrag({dx:e.clientX-r.left,dy:e.clientY-r.top});e.currentTarget.setPointerCapture(e.pointerId);}
  function focusButtonMove(e:ReactPointerEvent<HTMLButtonElement>){if(!focusMode||!focusDrag)return;setFocusFloat({x:Math.max(8,Math.min(innerWidth-58,e.clientX-focusDrag.dx)),y:Math.max(8,Math.min(innerHeight-58,e.clientY-focusDrag.dy))});}
  function focusButtonUp(e:ReactPointerEvent<HTMLButtonElement>){setFocusDrag(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}
  function wakeColorPanel(){if(colorFadeTimer.current)window.clearTimeout(colorFadeTimer.current);if(colorCloseTimer.current)window.clearTimeout(colorCloseTimer.current);setColorOpen(true);setColorFading(false);}
  function fadeColorPanel(){wakeColorPanel();colorFadeTimer.current=window.setTimeout(()=>setColorFading(true),550);colorCloseTimer.current=window.setTimeout(()=>{setColorOpen(false);setColorFading(false);},1050);}
  function setDrawingColor(value:string){setInkColor(value);fadeColorPanel();}
  function position(e:ReactPointerEvent):Point{const r=plane.current!.getBoundingClientRect();const pressure=e.pointerType==='pen'?(e.pressure>0?e.pressure:.5):1;return{x:Math.max(0,(e.clientX-r.left)/scale),y:Math.max(0,(e.clientY-r.top)/scale),p:pressure};}
  function coalescedPositions(e:ReactPointerEvent):Point[]{const r=plane.current!.getBoundingClientRect();const native=e.nativeEvent;const events=typeof native.getCoalescedEvents==='function'?native.getCoalescedEvents():[native];return events.map(value=>({x:Math.max(0,(value.clientX-r.left)/scale),y:Math.max(0,(value.clientY-r.top)/scale),p:e.pointerType==='pen'?(value.pressure>0?value.pressure:.5):1}));}
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
  function updateFixedNote(html:string){const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return;const state=d.fixedNote||{html:'',visible:true,locked:false};commit({...d,fixedNote:{...state,html}} as NoteDoc,false);}
  function updateSheet(next:SheetData){
    const d=current.current?.content as StudioNoteDoc|undefined;if(!d)return;
    const hasData=Object.values(next.cells||{}).some(value=>String(value).trim()!=='');
    if(!hasData&&!sheetHasData)return;
    setSheetPreviewOpen(false);
    commit({...d,sheet:{...next,visible:true}} as NoteDoc,false);
  }
  function leaveTransientSheet(){if(workspaceMode==='excel'&&!sheetHasData){setSheetPreviewOpen(false);setSheetSelection(undefined);}}
  function useNoteLayer(){leaveTransientSheet();setFocus('');setWorkspaceMode('note');setTool('note');(document.activeElement as HTMLElement)?.blur();}
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
  async function placeImages(files:File[]){
    if(!files.length||attaching||organizing)return;
    if(workspaceMode==='note'&&imagePlacement==='inline'){
      await attach(files);
      return;
    }
    setAttaching(true);
    try{
      const r=current.current;if(!r)return;
      let working=r.content as StudioNoteDoc;
      let layer=writableLayer(working,'layout');
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
        const item:Item={id:id32(),kind:'image',layerId:layer.id,x,y,w,h,color:'#000000',width:1,opacity:1,imageId:localImageId};
        working={...working,items:[...working.items,item]};y+=40;
      }
      commit(working as NoteDoc);setSelected(working.items.at(-1)?.id||'');setTool('select');
      if(navigator.onLine)void notes.save();
    }catch(err){notes.setError(err instanceof Error?err.message:'画像を配置できません');}
    finally{setAttaching(false);}
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
    const shown=(g:Graphic)=>{const layer=d.layers.find(l=>l.id===g.layerId);return !!layer&&layer.visible&&!layer.locked;};
    return [...d.items,...(d.paintStrokes||[])].filter(shown)
      .map((graphic,index)=>({graphic,index,distance:graphicDistance(graphic,p)}))
      .filter(entry=>entry.distance<=Math.max(radius,entry.graphic.width/2))
      .sort((a,b)=>a.distance-b.distance||b.index-a.index)
      .map(entry=>entry.graphic);
  }
  function drag(e:ReactPointerEvent,id:string,resize=false){e.preventDefault();e.stopPropagation();if(!doc||action.current||(!e.isPrimary&&e.pointerType==='touch'))return;setSelected(id);setFocus('');typing.current=null;
    action.current={pointerId:e.pointerId,kind:resize?'resize':'move',id,start:position(e),original:doc};plane.current?.setPointerCapture(e.pointerId);}
  function down(e:ReactPointerEvent<HTMLDivElement>){if(!doc||notes.busy||importing||organizing||meta.trashedAt)return;
    if(action.current||(!e.isPrimary&&e.pointerType==='touch')){e.preventDefault();return;}
    suppressClick.current=false;
    const target=e.target as Element;
    if(target.closest('button,.notes-sheet-layer,.notes-fixed-layer'))return;
    const control=target.closest('[data-shape-handle]');
    if(control&&selectedGraphic){const handle=control.getAttribute('data-shape-handle')||'';e.preventDefault();e.stopPropagation();clearOverlapTimer();setOverlapItems([]);
      if(handle.startsWith('vertex:')){setActiveAnchor({id:selectedGraphic.id,index:Number(handle.slice(7))});setActiveSegment(null);}
      else setActiveSegment(null);
      action.current={pointerId:e.pointerId,kind:handle==='rotate'?'shapeRotate':handle.startsWith('vertex:')?'vertexMove':'shapeResize',handle,id:selectedGraphic.id,start:position(e),original:doc};
      e.currentTarget.setPointerCapture(e.pointerId);return;}
    if(e.pointerType==='touch'&&(tool==='pen'||tool==='eraser')&&Date.now()-lastPen.current<700){e.preventDefault();return;}
    const pen=e.pointerType==='pen';if(pen)lastPen.current=Date.now();
    const penEraser=pen&&(e.button===5||(e.buttons&32)!==0);const effective=penEraser?'eraser':pen&&(tool==='note'||tool==='text')?'pen':tool;
    if(effective==='line'||effective==='rect'||effective==='ellipse'){
      const layer=writableLayer(doc,'layout');if(!layer){notes.setError('レイアウトレイヤーを選んでください');return;}e.preventDefault();e.stopPropagation();setFocus('');typing.current=null;
      const p=position(e);const item:Item={id:id32(),kind:effective,layerId:layer.id,x:p.x,y:p.y,w:0,h:0,color:inkColor,width:Math.max(1,inkWidth),opacity:1,fill:'none'};setDraftShape(item);
      action.current={pointerId:e.pointerId,kind:'shape',start:p,original:doc,shapeKind:effective,id:item.id};e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(e.pointerType==='touch'&&(effective==='text'||effective==='note'||effective==='hand')){
      if(effective==='hand'){e.preventDefault();e.stopPropagation();}
      action.current={pointerId:e.pointerId,kind:'pan',verticalOnly:effective!=='hand',start:{x:e.clientX,y:e.clientY},original:doc,scroll:{left:scroll.current!.scrollLeft,top:scroll.current!.scrollTop}};
      if(effective==='hand')e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(effective==='pen'){
      e.preventDefault();e.stopPropagation();(document.activeElement as HTMLElement)?.blur();setFocus('');typing.current=null;
      const layer=writableLayer(doc,'canvas');if(!layer){notes.setError('キャンバスレイヤーを選んでください');return;}setActiveLayer(layer.id);setWorkspaceMode('canvas');
      action.current={pointerId:e.pointerId,kind:'ink',start:position(e),original:doc,points:[position(e)],pen,blockId:target.closest('[data-note-block]')?.getAttribute('data-note-block')||undefined};e.currentTarget.setPointerCapture(e.pointerId);setDraft([position(e)]);return;
    }
    if(effective==='eraser'){
      e.preventDefault();e.stopPropagation();const id=target.closest('[data-stroke]')?.getAttribute('data-stroke');
      if(id){const d=doc as StudioNoteDoc;commit({...d,items:d.items.filter(i=>i.id!==id),paintStrokes:d.paintStrokes?.filter(stroke=>stroke.id!==id),charts:(d.charts||[]).filter(c=>c.id!==id)} as NoteDoc);}return;
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
        if(e.shiftKey||multiMode){e.preventDefault();selectGraphic(id,true);return;}
        const graphic=doc.items.find(i=>i.id===id)||doc.paintStrokes?.find(i=>i.id===id);
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
        selectGraphic(id);
        drag(e,id);
      }else{setSelected('');setMultiSelected([]);setActiveAnchor(null);setActiveSegment(null);}
      return;
    }
    if(effective==='text'&&!target.closest('[data-note-block]')){
      e.preventDefault();const p=position(e);const b=block(p.x,p.y);commit({...doc,blocks:[...(doc.blocks||[]),b]});setFocus(b.id);setSelected(b.id);
    }
  }
  function move(e:ReactPointerEvent<HTMLDivElement>){
    const a=action.current;
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
    if(a.kind==='pan'){const dx=e.clientX-a.start.x,dy=e.clientY-a.start.y;if(Math.hypot(dx,dy)<6)return;suppressClick.current=true;scroll.current!.scrollTo(a.scroll!.left-(a.verticalOnly?0:dx),a.scroll!.top-dy);return;}
    const p=position(e);if(a.kind==='ink'){for(const point of coalescedPositions(e)){const last=a.points!.at(-1)!;if(Math.hypot(point.x-last.x,point.y-last.y)>.35){a.points!.push(point);}}setDraft([...a.points!]);return;}
    if(a.kind==='shape'){setDraftShape(old=>old?{...old,w:p.x-a.start.x,h:p.y-a.start.y}:old);return;}
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
    const dx=p.x-a.start.x,dy=p.y-a.start.y;
    const next={...original,blocks:original.blocks?.map(b=>b.id===a.id?a.kind==='resize'?{...b,w:Math.max(220,Math.min(1800,b.w+dx))}:{...b,x:Math.max(0,b.x+dx),y:Math.max(0,b.y+dy)}:b),
      items:original.items.map(i=>i.id===a.id?translateShape(i,dx,dy):i),
      paintStrokes:original.paintStrokes?.map(stroke=>(stroke.id===a.id || (stroke.blockId===a.id && a.kind==='move'))?{...stroke,points:stroke.points.map(point=>({...point,x:point.x+dx,y:point.y+dy}))}:stroke),
      charts:(original.charts||[]).map(c=>c.id===a.id?{...c,x:c.x+dx,y:c.y+dy}:c)};
    notes.change(next as NoteDoc);
  }
  function up(e:ReactPointerEvent<HTMLDivElement>,cancel=false){const a=action.current;if(!a||a.pointerId!==e.pointerId)return;action.current=null;
    if(plane.current?.hasPointerCapture(e.pointerId))plane.current.releasePointerCapture(e.pointerId);
    if(a.kind==='ink'){
      if(!cancel){const points=a.points!;if(points.length===1)points.push({...points[0],x:points[0].x+.2});
        const layer=writableLayer(a.original,'canvas');if(!layer){notes.setError('キャンバスレイヤーを選んでください');setDraft([]);return;}
        commit({...a.original,paintStrokes:[...(a.original.paintStrokes||[]),{id:id32(),layerId:layer.id,points,color:inkColor,width:inkWidth,opacity:(brush==='marker'?.32:1)*inkOpacity,blockId:a.blockId,brush} as any]});}
      setDraft([]);if(a.pen)lastPen.current=Date.now();return;
    }
    if(a.kind==='shape'){const shape=draftShape;setDraftShape(null);if(!cancel&&shape&&Math.hypot(shape.w,shape.h)>2){commit({...a.original,items:[...a.original.items,shape]});setSelected(shape.id);setActiveLayer(shape.layerId);}return;}
    if(a.kind==='move'||a.kind==='resize'||a.kind==='shapeResize'||a.kind==='shapeRotate'||a.kind==='vertexMove'||a.kind==='segmentMove'){if(cancel&&a.moved)notes.change(a.original);else if(a.moved){undoStack.current=[...undoStack.current.slice(-39),a.original];redoStack.current=[];redraw(v=>v+1);}}
  }
  function format(command:string,value?:string){
    typing.current=null;
    document.execCommand(command,false,value);
    const el=document.activeElement as HTMLElement;
    const id=el?.closest?.('[data-note-block]')?.getAttribute('data-note-block');
    if(id)updateBlock(id,el.innerHTML,el.scrollHeight+54);
    const fixed=el?.closest?.('.notes-fixed-editor') as HTMLElement|null;
    if(fixed)updateFixedNote(fixed.innerHTML);
  }
  function chooseFont(delta:number){
    const next=Math.max(1,Math.min(7,fontStep+delta));
    setFontStep(next);format('fontSize',String(next));
  }
  function applyBullets(size:'large'|'medium'|'small'){
    setBulletSize(size);
    const element=window.getSelection()?.anchorNode?.parentElement;
    let list=element?.closest('ul');
    if(!list){format('insertUnorderedList');list=window.getSelection()?.anchorNode?.parentElement?.closest('ul')||null;}
    if(!list)return;
    list.classList.add('kn-bullet-list');
    list.setAttribute('data-kn-list',size);
    list.closest('.notes-fixed-editor,.note-content')?.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function openTableSettings(kind:'table'|'columns',edit=false){
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
    const current=lastTable.current;
    if(current&&current.isConnected&&tableSelected){
      setTableOptions(current,tableOpts);
    }else insertRichHTML(tableMarkup(tableOpts));
    setTableOpen(false);
  }
  useEffect(()=>{
    const onSelect=()=>{
      const selected=currentTable(),cell=currentCell();
      if(selected){lastTable.current=selected;lastCell.current=cell;}
      const isInNote=!!window.getSelection()?.anchorNode?.parentElement?.closest('.notes-fixed-editor,.note-content');
      setTableSelected(!!selected&&isInNote);
    };
    document.addEventListener('selectionchange',onSelect);
    return()=>document.removeEventListener('selectionchange',onSelect);
  },[]);
  function ruby(skipPrompt=false){
    const selected=selectedString().trim();if(!selected){notes.setError('ルビを付ける文字を選択してください');return;}
    const memoryKey='kaerunote-ruby:'+selected,remembered=localStorage.getItem(memoryKey)||'';
    const reading=skipPrompt&&remembered?remembered:window.prompt('「'+selected+'」の読みがな',remembered);
    if(!reading)return;
    localStorage.setItem(memoryKey,reading);
    applyRuby(reading,rubyColor);
  }
  async function openRevisions(){
    if(!record)return;
    try{setRevisions(await listLocalRevisions(record.id));setRevisionsOpen(true);}
    catch(error){notes.setError('端末の履歴を開けません：'+String(error));}
  }
  function restoreRevision(snapshot:LocalRevision){
    if(!window.confirm(new Date(snapshot.createdAt).toLocaleString('ja-JP')+'の内容に戻しますか？ 現在の状態も保存してください。'))return;
    notes.change(snapshot.content as NoteDoc,snapshot.title);
    setRevisionsOpen(false);
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
      }
      commit(working as NoteDoc);
      // IndexedDB stores the actual binary even without any connection.
      // On reconnect useNotes uploads pending attachments and clears their flag.
      if(navigator.onLine)void notes.save();
    }catch(err){notes.setError(err instanceof Error?err.message:'添付できません');}
    finally{setAttaching(false);}
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
  function navigateCategory(path:string){setCategory(path);setTrash(false);setQuery('');if(sidebarAutoClose)setSidebar(false);}
  async function createNote(){setTrash(false);setQuery('');setTag('');const next=notesNew();await notes.create(next);}
  function notesNew(){const next=blankNote();next.note={category,tags:[]};return next;}
  function setTrashed(value:boolean){if(!doc||organizing||attaching||importing||notes.busy)return;
    (document.activeElement as HTMLElement)?.blur();
    const latest=current.current?.content;if(!latest)return;
    notes.change({...latest,note:{category:'',tags:[],...latest.note,trashedAt:value?new Date().toISOString():undefined}});
    setDeleteOpen(false);setFocus('');undoStack.current=[];redoStack.current=[];
  }
  async function syncOfflineCategories(){
    if(!navigator.onLine||syncingWorkspace.current||sharedAccess)return;
    const first=workspaceRef.current;
    if(!first.pending.length)return;
    syncingWorkspace.current=true;
    try{
      const server=await(await api('/api/note-workspace')).json() as {categories:string[];revision:number};
      // Replay operations over fresh server categories. Never drop an unsynced
      // operation or overwrite unrelated categories created on another device.
      let paths=categoryPaths(server.categories);
      for(const op of first.pending)paths=locallyApplyCategory(paths,op);
      if(paths.some(p=>p.length>200)||paths.length>2000)throw new Error('カテゴリの容量上限を超えています');
      // Apply queued moves/tags to remote notes that were NOT edited locally.
      // Dirty local notes carry their own metadata changes and use the normal
      // document save path, avoiding overwriting unsynced offline work.
      const locallyDirty=new Set((await listLocalDocs()).filter(n=>n.accountId===accountId&&n.dirty).map(n=>n.id));
      const remoteRows:import('@/lib/notes').NoteIndex[]=[];
      for(let offset=0;offset<5000;offset+=100){
        const response=await fetch('/canvas/api.php?path='+encodeURIComponent('/api/notes-index')+'&offset='+offset,
          {credentials:'same-origin',cache:'no-store'});
        if(!response.ok)throw new Error('分類同期のためのメモ一覧を取得できません');
        const page=await response.json() as {documents:import('@/lib/notes').NoteIndex[];hasMore:boolean};
        remoteRows.push(...page.documents);
        if(!page.hasMore)break;
      }
      const updates:{id:string;revision:number;category:string;tags:string[]}[]=[];
      for(const row of remoteRows){
        if(locallyDirty.has(row.id))continue;
        let category=row.note?.category||'',tags=row.note?.tags||[];
        for(const op of first.pending){
          if(op.kind==='move'&&inCategory(category,op.source))category=movedCategory(category,op.source,op.target);
          if(op.kind==='tag'&&inCategory(category,op.source)){
            tags=[...new Set([...tags,op.target])];if(op.remove)category='';
          }
        }
        if(category!==(row.note?.category||'')||tags.join('\u001f')!==(row.note?.tags||[]).join('\u001f'))
          updates.push({id:row.id,revision:row.revision,category,tags});
      }
      const synced=await(await api('/api/note-workspace',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({revision:server.revision,categories:paths,updates})})).json() as {
        categories:string[];revision:number;changed:{id:string;revision:number;updated_at:number;note:NoteMeta}[]
      };
      if(synced.changed?.length)await notes.acceptMetadata(synced.changed);
      const current=workspaceRef.current;
      const remaining=current.pending.slice(first.pending.length);
      // Operations added while syncing remain in the queue and on the display.
      let visible=categoryPaths(synced.categories);
      for(const op of remaining)visible=locallyApplyCategory(visible,op);
      updateWorkspace({categories:visible,revision:synced.revision,pending:remaining,updatedAt:Date.now()});
    }catch(error){
      notes.setError('分類は端末に保存済み・同期待ちです。'+(error instanceof Error?error.message:'接続を確認してください'));
    }finally{syncingWorkspace.current=false;}
  }
  useEffect(()=>{
    const onOnline=()=>{void syncOfflineCategories();};
    addEventListener('online',onOnline);
    const interval=window.setInterval(()=>{if(navigator.onLine&&workspaceRef.current.pending.length)void syncOfflineCategories();},12000);
    onOnline();
    return()=>{removeEventListener('online',onOnline);clearInterval(interval);};
  },[accountId,!!sharedAccess]);
  async function organize(op:CategoryOperation){
    if(organizing||sharedAccess)return;
    setOrganizing(true);
    try{
      const previous=workspaceRef.current;
      const existing=categoryPaths([...previous.categories,...notes.list.map(n=>n.note?.category||'')]);
      if(op.kind==='create'&&existing.includes(op.target))throw new Error('カテゴリが既にあります');
      if(op.kind!=='create'&&!existing.includes(op.source))throw new Error('対象カテゴリが見つかりません');
      if(op.kind==='move'&&(existing.includes(op.target)||inCategory(op.target,op.source)))throw new Error('移動先が重複しているか、子カテゴリ内です');
      const next=locallyApplyCategory(existing,op);
      if(next.some(p=>p.length>200)||next.length>2000)throw new Error('カテゴリ数・文字数の上限を超えます');
      // All local work is persisted before any network operation.
      const updated={...previous,categories:next,pending:[...previous.pending,op],updatedAt:Date.now()};
      updateWorkspace(updated);
      if(op.kind!=='create')await notes.applyOfflineCategory(op);
      navigateCategory(op.kind==='tag'?'':op.target);
      if(op.kind==='tag')setTag(op.target);
      if(navigator.onLine)void syncOfflineCategories();
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
  function pressureWidth(base:number,p?:number){const pressure=p&&p>0?p:.5;return Math.max(.8,base*(.38+pressure*1.05));}
  function paintStrokeView(value:PaintStroke){
    const mode=value.brush||'pen',b=graphicBox(value),cx=b.x+b.w/2,cy=b.y+b.h/2;
    return <g key={value.id} data-stroke={value.id} transform={value.rotation?`rotate(${value.rotation} ${cx} ${cy})`:undefined} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {mode!=='marker'&&value.points.length>1?
        <g stroke={value.color} opacity={value.opacity}>{value.points.slice(1).map((point,index)=><line key={index} x1={value.points[index].x} y1={value.points[index].y} x2={point.x} y2={point.y} strokeWidth={pressureWidth(value.width,point.p)}/>)}</g>:
        <polyline points={stroke(value.points)} stroke={value.color} strokeWidth={value.width} opacity={value.opacity}/>}
      <polyline points={stroke(value.points)} stroke="transparent" strokeWidth={Math.max(18,value.width)} pointerEvents={workspaceMode==='layout'&&(tool==='select'||tool==='vertex'||tool==='magic')||tool==='eraser'?'stroke':'none'}/>
    </g>;
  }
  return <main className={`notes-app ${!sharedAccess&&sidebar?'sidebar-open':''} ${sharedAccess?'notes-shared-board':''}`}>
    <header className="notes-header notes-header-compact">
      {!sharedAccess&&<button className="notes-header-icon" onClick={toggleSidebar} aria-label={sidebar?'メモ一覧を閉じる':'メモ一覧を開く'} aria-expanded={sidebar} title="メモ一覧を開閉"><PanelLeft size={19}/></button>}
      <strong className="notes-brand">Kaeru<span>Note</span></strong>
      <span className="notes-header-divider"/>
      <input aria-label="メモのタイトル" placeholder="新しいメモ" value={record?.title||''} maxLength={80} disabled={!record||notes.busy||importing||organizing||!!meta.trashedAt||meta.importState==='pending'} onChange={e=>doc&&notes.change(doc,e.target.value)}/>
      <div className="notes-header-actions">
        {sharedAccess?<span className="notes-shared-indicator" title="このリンクの作品だけが表示されています">共有作品を編集中</span>:
          <>
            <button className="notes-header-icon" onClick={()=>{setSidebar(true);setSearchScope('all');requestAnimationFrame(()=>searchInput.current?.focus());}} aria-label="全メモを横断検索" title="メモを検索"><Search size={18}/></button>
            <button className="notes-header-share" disabled={!record||record.id.startsWith('local-')||notes.conflict} onClick={()=>setShareOpen(true)} aria-label="作品を共有" title="リンクを発行して共同編集"><Share2 size={16}/><span>共有</span></button>
          </>}
        <span className="notes-save-status" role="status" title={attaching?'添付を送信中…':notes.status}>{attaching?'添付中':notes.status}</span>
        <button className="notes-header-icon" onClick={()=>void notes.save()} disabled={!record} title="今すぐ保存" aria-label="保存"><Save size={18}/></button>
        {!sharedAccess&&<button className="notes-header-icon" onClick={()=>setSettings(!settings)} aria-label="環境設定と書き出し" title="環境設定" aria-expanded={settings}><Settings2 size={19}/></button>}
      </div>
    </header>
    <div className="notes-layout">
      {!sharedAccess&&sidebar&&<><button className="notes-sidebar-backdrop" aria-label="メモ一覧を閉じる" onClick={toggleSidebar}/><aside className="notes-sidebar">
        <div className="notes-sidebar-head"><small>MY WORKSPACE</small><div className="notes-sidebar-head-actions">
          <button className="notes-new" onClick={()=>void createNote()} disabled={importing||attaching||notes.busy||organizing} aria-label="新しいメモ"><Plus size={22}/></button>
          <div className="notes-sidebar-more">
            <button className="notes-sidebar-menu-toggle" aria-label="メモメニュー" aria-expanded={sidebarMenuOpen} onClick={()=>setSidebarMenuOpen(open=>!open)} title="メニュー"><MoreHorizontal size={20}/></button>
            {sidebarMenuOpen&&<div className="notes-sidebar-menu" role="menu">
              <button role="menuitem" disabled={organizing||importing||attaching} onClick={()=>{setSidebarMenuOpen(false);setImportOpen(true);}}><Upload size={16}/>Joplinから取り込む</button>
              <button role="menuitem" onClick={()=>{setSidebarMenuOpen(false);setSettings(true);}}><Settings2 size={16}/>メモの整理・設定</button>
            </div>}
          </div>
          <button className="notes-sidebar-close" onClick={()=>{setSidebarMenuOpen(false);toggleSidebar();}} aria-label="サイドバーを閉じる" title="閉じる"><X size={20}/></button>
        </div></div>
        <label className="notes-search"><Search size={17}/><input ref={searchInput} placeholder="全メモの本文・タグを検索" aria-label="メモを検索" value={query} onChange={e=>setQuery(e.target.value)} onBlur={()=>rememberSearch()} onKeyDown={e=>{if(e.key==='Enter')rememberSearch();}}/>{query&&<button onClick={()=>setQuery('')} aria-label="検索を消す"><X size={14}/></button>}</label>
        {!!recentSearches.length&&<div className="notes-search-history" aria-label="最近の検索">{recentSearches.map(value=><button key={value} title={value} onClick={()=>{setQuery(value);setSearchScope('all');}}>{value}</button>)}</div>}
        <div className="notes-search-options"><label>検索範囲<select aria-label="検索範囲" value={searchScope} onChange={e=>setSearchScope(e.target.value as 'all'|'filtered')}><option value="all">全カテゴリ横断</option><option value="filtered">選択中のカテゴリ・タグ</option></select></label><small>{trash?'ゴミ箱内を検索':'タイトル・本文・タグ・添付名'} · 空白でAND検索</small></div>
        <div className="notes-navigation"><button className={!trash&&!category?'active':''} onClick={()=>{setTrash(false);setCategory('');setTag('');setQuery('');}}>すべてのメモ <small>{notes.list.filter(n=>!n.note?.trashedAt).length}</small></button><button className={trash?'active':''} onClick={()=>{setTrash(true);setQuery('');setCategory('');setTag('');}}><Trash2 size={15}/>ゴミ箱 <small>{notes.list.filter(n=>n.note?.trashedAt).length}</small></button></div>
        <CategoryTree paths={categories} notes={notes.list} selected={category} onSelect={navigateCategory} disabled={organizing||importing||attaching} onManage={()=>setCategoryManager(true)}/>
        <div className="notes-filters"><label><Tag size={15}/><select aria-label="タグで絞り込み" value={tag} onChange={e=>{setTag(e.target.value);setQuery('');}}><option value="">すべてのタグ</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label></div>
        <div className="notes-count" role="status">{searching?(searchScope==='all'?'横断検索':'絞り込み検索'):trash?'ゴミ箱':category||'すべてのメモ'} · {filtered.length} 件</div>
        <div className="notes-list">{filtered.map(n=><button key={n.id} className={`notes-list-item ${n.id===record?.id?'active':''}`} disabled={importing||attaching||notes.busy||organizing} onClick={()=>{void notes.open(n.id);if(sidebarAutoClose||innerWidth<=760)setSidebar(false);}}>
          <strong>{n.note?.pinned&&<Pin size={13}/>} {n.title||'新しいメモ'}</strong><p>{searching?searchExcerpt(n.searchText||n.excerpt||'',query):n.excerpt||'テキストのないメモ'}</p><footer><time>{new Date(n.updated_at).toLocaleDateString('ja-JP',{month:'short',day:'numeric'})}</time><span title={n.note?.category}>{n.note?.category||'未分類'}</span>{n.note?.importState==='pending'&&<em>取込途中</em>}</footer></button>)}
          {!filtered.length&&<p className="notes-empty">該当するメモはありません</p>}</div>
      </aside></>}
      <section className="notes-editor">
        <div inert={!!meta.trashedAt||organizing||meta.importState==='pending'} className={`notes-toolbar ${workspaceMode==='note'?'notes-toolbar-word':''} ${meta.importState==='pending'||meta.trashedAt||organizing?'notes-disabled':''}`} role="toolbar" aria-label="編集オプション">
          {workspaceMode==='note'?<>
            <div className="notes-tool-group"><button title="元に戻す" onClick={undo} disabled={!undoStack.current.length}><Undo2 size={18}/></button><button title="やり直す" onClick={redo} disabled={!redoStack.current.length}><Redo2 size={18}/></button></div>
            <div className="notes-tool-group notes-format" onMouseDown={e=>e.preventDefault()}>
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
            <div className="notes-tool-group notes-note-insert" onMouseDown={e=>e.preventDefault()}>
              <button title="通常の表を挿入" onClick={()=>openTableSettings('table')}><Table2 size={17}/><span>表</span></button>
              <button title="段組みの表組みレイアウト" onClick={()=>openTableSettings('columns')}><Columns3 size={17}/><span>表組み</span></button>
              <button title="ノートにファイルを添付" onClick={()=>fileInput.current?.click()}><Paperclip size={17}/><span>添付</span></button>
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
              <button title="画像をノートに挿入" onClick={()=>imageInput.current?.click()}><ImagePlus size={17}/>画像</button>
              <button title="ノートの作業エリアを拡大" onClick={toggleFocusMode}><Maximize2 size={17}/></button>
              <button className={advancedOpen?'active':''} onClick={()=>setAdvancedOpen(x=>!x)} title="高度な書式オプションを開閉" aria-expanded={advancedOpen}><ChevronDown size={16}/><span>詳細</span></button>
            </div>
            {advancedOpen&&<div className="notes-tool-group notes-advanced-format" onMouseDown={e=>e.preventDefault()}>
              <button title="上付き" onClick={()=>format('superscript')}><Superscript size={16}/></button>
              <button title="下付き" onClick={()=>format('subscript')}><Subscript size={16}/></button>
              <button title="蛍光ペン（文字背景色）" onClick={()=>format('backColor','#fff170')}><Highlighter size={16}/></button>
              <button title="手書き風の赤丸" onClick={()=>applyRedMark('circle')}>赤丸</button>
              <button title="手書き風の赤線" onClick={()=>applyRedMark('underline')}>赤線</button>
              <button title="手書き風の赤波線" onClick={()=>applyRedMark('wave')}>波線</button>
              <label>ルビ色<input type="color" value={rubyColor} onChange={e=>setRubyColor(e.target.value)}/></label>
              <button title="選んだ漢字にルビ。Shiftを押すと前回の読みを使用" onClick={e=>ruby(e.shiftKey)}>ルビ</button>
            </div>}
            {tableSelected&&<div className="notes-tool-group notes-table-controls" onMouseDown={e=>e.preventDefault()}>
              <strong>表の編集</strong>
              <button title="行を追加" onClick={()=>editTable('row+',lastTable.current,lastCell.current)}>行＋</button>
              <button title="行を削除" onClick={()=>editTable('row-',lastTable.current,lastCell.current)}>行−</button>
              <button title="列を追加" onClick={()=>editTable('col+',lastTable.current,lastCell.current)}>列＋</button>
              <button title="列を削除" onClick={()=>editTable('col-',lastTable.current,lastCell.current)}>列−</button>
              <button title="最初の表設定を再表示" onClick={()=>openTableSettings('table',true)}>設定</button>
            </div>}
          </>:<>
            <div className="notes-tool-group"><button onClick={undo} disabled={!undoStack.current.length}><Undo2 size={18}/></button><button onClick={redo} disabled={!redoStack.current.length}><Redo2 size={18}/></button></div>
            {(workspaceMode==='canvas')&&<div className="notes-tool-group"><select aria-label="ブラシ" value={brush} onChange={e=>setBrush(e.target.value as typeof brush)}><option value="gpen">Gペン</option><option value="pen">ペン</option><option value="marker">マーカー</option></select><button className="notes-color-button" onClick={()=>{if(colorOpen)setColorOpen(false);else wakeColorPanel();}}><span style={{background:inkColor}}/>色</button><label className="notes-width-control">太さ<input type="range" min="1" max="40" value={inkWidth} onChange={e=>setInkWidth(Number(e.target.value))}/><b>{inkWidth}px</b></label><label className="notes-opacity-control">透明度<input type="range" min="5" max="100" value={Math.round(inkOpacity*100)} onChange={e=>setInkOpacity(Number(e.target.value)/100)}/><b>{Math.round(inkOpacity*100)}%</b></label></div>}
            {(workspaceMode==='layout')&&<div className="notes-tool-group"><button className="notes-color-button" onClick={()=>{if(colorOpen)setColorOpen(false);else wakeColorPanel();}}><span style={{background:inkColor}}/>色</button><label className="notes-width-control">線幅<input type="range" min="1" max="20" value={inkWidth} onChange={e=>setInkWidth(Number(e.target.value))}/><b>{inkWidth}px</b></label><button onClick={()=>imageInput.current?.click()}><ImagePlus size={18}/><span>画像</span></button></div>}
            {(workspaceMode==='excel'||workspaceMode==='graph')&&<div className="notes-tool-group"><span>{workspaceMode==='excel'?'Excelレイヤー':'グラフレイヤー'}</span>{workspaceMode==='excel'&&<button disabled={!sheetSelection} onClick={()=>setChartOpen(true)}>グラフ作成</button>}</div>}
          </>}
          <div className="notes-tool-group notes-inspector-toggle">
            <button className={!relatedPanel&&layersOpen?'active':''} onClick={()=>{setRelatedPanel(false);setLayersOpen(v=>relatedPanel?true:!v);}} title="レイヤーパネルを開閉" aria-expanded={!relatedPanel&&layersOpen}>{!relatedPanel&&layersOpen?<ChevronDown size={15}/>:<ChevronLeft size={15}/>} レイヤー</button>
            <button className={relatedPanel?'active':''} onClick={()=>{setRelatedPanel(v=>!v);setLayersOpen(true);}} title="ChatGPTが関連付けたノートを表示">関連ノート</button>
          </div>
        </div>
        {colorOpen&&<div className={'notes-color-popover '+(colorFading?'fading':'')} onPointerDown={wakeColorPanel}><ColorStudio color={inkColor} onChange={value=>{setDrawingColor(value);if(workspaceMode==='note')format('foreColor',value);}}/></div>}
        <div className="notes-context"><span>{tool==='pen'||tool==='eraser'||tool==='line'||tool==='rect'||tool==='ellipse'?<>{tool==='pen'?'ペン：色・太さ・透明度は上のツールから変更できます。':tool==='eraser'?'消しゴム：ペンの消しゴムボタンにも対応しています。':'レイアウト図形を作成します。'}</>:tool==='note'?<>固定ノート：通常のワープロ入力です。下のキャンバスをズーム・移動しても文字サイズと位置は変わりません。</>:tool==='sheet'?<>Excelレイヤー：セルを編集。Shift＋クリックで範囲選択。{sheetSelection&&<b>{sheetSelection.start}{sheetSelection.end!==sheetSelection.start?':'+sheetSelection.end:''}</b>}<button disabled={!sheetSelection} onClick={()=>{setChartLayer(activeLayer||doc?.layers[0]?.id||'');setChartOpen(true);}}>グラフ作成</button></>:tool==='text'?<>テキストボックス：キャンバス上の好きな位置に独立した文章ブロックを置きます。</>:tool==='magic'?<>マジック選択：クリックした図形・画像・線・グラフを直接つかみます。</>:<>左のツールバーから操作を選択します。</>}</span>
          {workspaceMode==='layout'&&<div className="notes-shape-tools" role="toolbar" aria-label="図形の選択ツール">
            <strong>図形編集 v0.4.2</strong>
            <button className={tool==='select'?'active':''} onClick={()=>chooseTool('select')} title="図形全体を選択して移動・拡縮・回転"><MousePointer2 size={16}/> 黒矢印</button>
            <button className={tool==='vertex'?'active':''} onClick={()=>chooseTool('vertex')} title="頂点と線分を個別編集"><MousePointer size={16}/> 白矢印</button>
            <button className={multiMode?'active':''} onClick={()=>setMultiMode(v=>!v)} title="スマホ・タブレットでShiftの代わりにタップを追加選択へ切り替えます。再タップすると選択解除">複数選択 {multiMode?'ON':'OFF'}</button>
            <small>{selectedGraphic?'選択中：'+graphicName(selectedGraphic)+'（'+selectedIds.length+'個）':multiMode?'図形をタップして追加・解除できます':'図形または手書き線を選択できます'}</small>
            {selectedIds.length>=2&&<span className="notes-composite-actions">
              <strong>複数図形：{selectedIds.length}個</strong>
              <button disabled={selectedIds.length!==2||selectedIds.some(id=>{const item=doc?.items.find(i=>i.id===id);return item?.kind!=='rect'||!!item?.rotation;})} onClick={intersectSelectedRects} title="四角形2つの重複部分を残す">共通部分</button>
              <button disabled={selectedIds.length!==2||!selectedIds.some(id=>doc?.items.find(i=>i.id===id)?.kind==='image')||!selectedIds.some(id=>doc?.items.find(i=>i.id===id)?.kind==='rect')||selectedIds.some(id=>!!doc?.items.find(i=>i.id===id)?.rotation)} onClick={clipImageByRect} title="四角形を画像の切り抜きマスクに使う">画像くり抜き</button>
            </span>}
          </div>}
          {workspaceMode==='layout'&&selectedGraphic&&<div className="notes-shape-inspector" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'4px 8px'}}>
            <label>線色 <input type="color" value={/^#[0-9a-f]{6}$/i.test(selectedGraphic.color)?selectedGraphic.color:'#263443'} onChange={e=>editSelectedShape(i=>({...i,color:e.target.value}))}/></label>
            {selectedShape&&<><label>塗り <input type="color" value={selectedShape.fill&&/^#[0-9a-f]{6}$/i.test(selectedShape.fill)?selectedShape.fill:'#ffffff'} onChange={e=>editSelectedShape(i=>({...i,fill:e.target.value}))}/></label>
            <button onClick={()=>editSelectedShape(i=>({...i,fill:'none'}))}>塗りなし</button></>}
            <label>線幅 <input type="number" min="0.5" max="100" step="0.5" style={{width:55}} value={selectedGraphic.width} onChange={e=>editSelectedShape(i=>({...i,width:Math.max(.5,Number(e.target.value)||.5)}))}/></label>
            <label>透明度 <input type="range" min="0" max="100" value={Math.round((selectedGraphic.opacity??1)*100)} onChange={e=>editSelectedShape(i=>({...i,opacity:Number(e.target.value)/100}))}/></label>
            <span>{Math.round((selectedGraphic.opacity??1)*100)}%</span>
            {tool==='vertex'&&<strong className="notes-anchor-message">{activeAnchor?.id===selected?'頂点 '+(activeAnchor.index+1)+' 選択中':activeSegment?.id===selected?'線分 '+(activeSegment.index+1)+' 選択中':'頂点はタップで黄色くなり、ドラッグで移動できます'}</strong>}
          </div>}
          {selected&&<div><button title="ブロックを複製" onClick={()=>{const b=doc?.blocks?.find(b=>b.id===selected);if(b&&doc)commit({...doc,blocks:[...(doc.blocks||[]),{...b,id:id32(),x:b.x+35,y:b.y+(sizes[b.id]||b.h)+24}]});}}><Copy size={15}/></button><button title="選択を削除（複数選択時はまとめて削除）" onClick={()=>{if(doc){const d=doc as StudioNoteDoc,ids=new Set(selectedIds.length?selectedIds:[selected]);commit({...d,blocks:d.blocks?.filter(b=>!ids.has(b.id)),items:d.items.filter(i=>!ids.has(i.id)),paintStrokes:d.paintStrokes?.filter(stroke=>!ids.has(stroke.id)),charts:(d.charts||[]).filter(c=>!ids.has(c.id))} as NoteDoc);}setSelected('');setMultiSelected([]);setActiveAnchor(null);setActiveSegment(null);}}><Trash2 size={15}/></button></div>}
        </div>
        {workspaceMode!=='note'&&<><div className="notes-viewbar" role="toolbar" aria-label="表示倍率"><strong>ズーム</strong><button aria-label="縮小" onClick={()=>zoomTo(scale-.1)} disabled={scale<=.2}><ZoomOut size={19}/>−</button><select aria-label="ズーム倍率" value={Math.round(scale*100)} onChange={e=>zoomTo(Number(e.target.value)/100)}>{[...new Set([20,25,50,75,100,125,150,200,300,400,Math.round(scale*100)])].sort((a,b)=>a-b).map(p=><option key={p} value={p}>{p}%</option>)}</select><button aria-label="拡大" onClick={()=>zoomTo(scale+.1)} disabled={scale>=4}><ZoomIn size={19}/>＋</button><button onClick={()=>zoomTo(1)}>100%</button><button onClick={fitContent}>画面に合わせる</button><small>Ctrl＋ホイール</small><div className="notes-viewbar-spacer"/><button className="notes-focus-inline" title="作業エリアだけ拡大" onClick={toggleFocusMode}><Maximize2 size={16}/>作業拡大</button>{!sharedAccess&&<button className="notes-delete" disabled={!record||organizing||attaching||importing||notes.busy||meta.importState==='pending'} onClick={()=>meta.trashedAt?setTrashed(false):setDeleteOpen(true)}><Trash2 size={16}/>{meta.trashedAt?'メモを復元':'メモを削除'}</button>}</div></>}
        {meta.trashedAt&&<div className="notes-warning">このメモはゴミ箱にあります。本文・添付は保持されています。<button onClick={()=>setTrashed(false)}>元に戻す</button></div>}
        {meta.importState==='pending'&&<div className="notes-warning">取り込み途中のメモです。同じJEXを選んで取り込みを再開してください。</div>}
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
            <button className="notes-drawer-handle top" onClick={()=>setDrawer(drawer==='top'?'':'top')}>⌄</button>
            <button className="notes-drawer-handle left" onClick={()=>setDrawer(drawer==='left'?'':'left')}>›</button>
            <button className="notes-drawer-handle right" onClick={()=>setDrawer(drawer==='right'?'':'right')}>‹</button>
            <div className={`notes-focus-drawer top ${drawer==='top'?'open':''}`}><ColorStudio color={inkColor} onChange={value=>{setInkColor(value);if(workspaceMode==='note')format('foreColor',value);window.setTimeout(()=>setDrawer(''),850);}}/><div className="notes-focus-drawing-controls"><label className="notes-width-control">太さ<input type="range" min="1" max="40" value={inkWidth} onChange={e=>setInkWidth(Number(e.target.value))}/><b>{inkWidth}px</b></label><label className="notes-opacity-control">透明度<input type="range" min="5" max="100" value={Math.round(inkOpacity*100)} onChange={e=>setInkOpacity(Number(e.target.value)/100)}/><b>{Math.round(inkOpacity*100)}%</b></label></div></div>
            <div className={`notes-focus-drawer left ${drawer==='left'?'open':''}`}><button onClick={()=>chooseTool('pen')}><Pencil size={20}/><small>ペン</small></button><button onClick={()=>chooseTool('eraser')}><Eraser size={20}/><small>消し</small></button><button onClick={()=>chooseTool('select')}><MousePointer2 size={20}/><small>選択</small></button><button onClick={()=>chooseTool('hand')}><Hand size={20}/><small>移動</small></button></div>
            <div className={`notes-focus-drawer right ${drawer==='right'?'open':''}`}>{studio&&<LayerPanel doc={studio} activeLayer={activeLayer} onActive={id=>{setActiveLayer(id);const layer=studio.layers.find(l=>l.id===id);setWorkspaceMode((layer?.studioKind||'canvas')==='layout'?'layout':'canvas');}} onSelectObject={(id,kind)=>{setSelected(id);setFocus(kind==='text'?id:'');}} onChange={next=>commit(next as NoteDoc)} onNoteTool={useNoteLayer} onSheetTool={useSheetLayer}/>}</div>
          </>}
          <nav className="notes-studio-tools" aria-label="制作ツール">
            <button className={'studio-family '+(workspaceMode==='note'?'active':'')} onClick={useNoteLayer} title="ノートレイヤー"><Type size={22}/><small>ノート</small></button>
            <button className={'studio-family '+(workspaceMode==='canvas'?'active':'')} onClick={()=>{activateFamily('canvas');chooseTool('pen');}} title="キャンバスレイヤー"><Pencil size={22}/><small>キャンバス</small></button>
            <button className={'studio-family '+(workspaceMode==='layout'?'active':'')} onClick={()=>{activateFamily('layout');chooseTool('select');}} title="レイアウトレイヤー"><Box size={22}/><small>レイアウト</small></button>
            <button className={'studio-family '+(workspaceMode==='excel'?'active':'')} onClick={useSheetLayer} title="Excelレイヤー"><span className="studio-glyph">▦</span><small>Excel</small></button>
            <button className={'studio-family '+(workspaceMode==='graph'?'active':'')} onClick={useGraphLayer} title="グラフレイヤー"><span className="studio-glyph">▥</span><small>グラフ</small></button>
            <span className="studio-sep"/>
            {workspaceMode==='canvas'&&<>
              <button className={tool==='pen'?'active':''} onClick={()=>chooseTool('pen')}><Pencil size={20}/><small>ペン</small></button>
              <button className={tool==='eraser'?'active':''} onClick={()=>chooseTool('eraser')}><Eraser size={20}/><small>消し</small></button>
              <button className={tool==='hand'?'active':''} onClick={()=>chooseTool('hand')}><Hand size={20}/><small>移動</small></button>
            </>}
            {workspaceMode==='layout'&&<>
              <button className={tool==='select'?'active':''} onClick={()=>chooseTool('select')} title="黒矢印：図形全体・拡縮・回転"><MousePointer2 size={20}/><small>黒矢印</small></button>
              <button className={tool==='vertex'?'active':''} onClick={()=>chooseTool('vertex')} title="白矢印：頂点・線分を編集"><MousePointer size={20}/><small>白矢印</small></button>
              <button className={tool==='magic'?'active':''} onClick={()=>chooseTool('magic')}><span className="studio-glyph">W</span><small>マジック</small></button>
              <button className={tool==='line'?'active':''} onClick={()=>chooseTool('line')}><span className="studio-glyph">╱</span><small>直線</small></button>
              <button className={tool==='rect'?'active':''} onClick={()=>chooseTool('rect')}><span className="studio-glyph">□</span><small>四角</small></button>
              <button className={tool==='ellipse'?'active':''} onClick={()=>chooseTool('ellipse')}><span className="studio-glyph">○</span><small>丸</small></button>
              <button onClick={()=>imageInput.current?.click()}><ImagePlus size={20}/><small>画像</small></button>
              <button className={tool==='hand'?'active':''} onClick={()=>chooseTool('hand')}><Hand size={20}/><small>移動</small></button>
            </>}
            {workspaceMode==='excel'&&<button disabled={!sheetSelection} onClick={()=>setChartOpen(true)}><span className="studio-glyph">▥</span><small>グラフ作成</small></button>}
          </nav>
          <div className="notes-stage-center">
            <div ref={scroll} className="notes-scroll" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const files=Array.from(e.dataTransfer.files);const images=files.filter(file=>file.type.startsWith('image/'));if(images.length===files.length&&files.length)void placeImages(images);else void attach(files);}}>
              {!record?<div className="notes-welcome"><h2>メモを準備しています</h2><p>文章も、手書きも、ここに。</p><button onClick={()=>void createNote()}>新しいメモを作る</button></div>:<div className="notes-surface" style={{width:width*scale,height:height*scale}}>
                <div ref={plane} className={`notes-plane tool-${tool}`} tabIndex={0} style={{width,height,transform:`scale(${scale})`,pointerEvents:notes.busy||importing||organizing||meta.trashedAt||meta.importState==='pending'?'none':undefined}}
                  onPasteCapture={pasteWorkspace} onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}} onPointerDownCapture={down} onPointerMove={move} onPointerUp={e=>up(e)} onPointerCancel={e=>up(e,true)}>
                  <SpreadsheetLayer sheet={sheetForView} active={tool==='sheet'} selection={sheetSelection} onChange={updateSheet} onSelect={setSheetSelection}/>
                  <svg className="notes-ink" width={width} height={height}>
                    <defs>{doc?.items.filter(i=>i.kind==='image'&&i.clip).map(i=><clipPath key={i.id} id={'kn-clip-'+i.id} clipPathUnits="userSpaceOnUse"><rect x={i.clip!.x} y={i.clip!.y} width={i.clip!.w} height={i.clip!.h}/></clipPath>)}</defs>
                    {doc?.layers.filter(l=>l.visible&&l.rasterImageId&&l.rasterBounds).map(l=><LegacyImage key={l.id} docId={record.id} imageId={l.rasterImageId!} {...l.rasterBounds!}/>)}
                    {doc?.items.filter(i=>doc.layers.find(l=>l.id===i.layerId)?.visible!==false).map(i=><g key={i.id} data-stroke={i.id} stroke={i.color} strokeWidth={i.width} opacity={i.opacity??1} fill={i.fill||'none'} transform={i.rotation?(()=>{const b=shapeBox(i);return `rotate(${i.rotation} ${b.x+b.w/2} ${b.y+b.h/2})`;})():undefined} clipPath={i.kind==='image'&&i.clip?'url(#kn-clip-'+i.id+')':undefined}>
                      {workspaceMode==='layout'&&(tool==='select'||tool==='vertex'||tool==='magic')&&(()=>{
                        const b=shapeBox(i);
                        return i.kind==='line'?<line x1={i.x} y1={i.y} x2={i.x+i.w} y2={i.y+i.h} stroke="transparent" strokeWidth={Math.max(16,i.width)} pointerEvents="stroke"/>:
                          i.kind==='path'?<polyline points={stroke(i.points||[])} stroke="transparent" strokeWidth={Math.max(16,i.width)} fill="none" pointerEvents="stroke"/>:
                          i.kind==='ellipse'?<ellipse cx={b.x+b.w/2} cy={b.y+b.h/2} rx={b.w/2} ry={b.h/2} fill="transparent" stroke="none" pointerEvents="all"/>:
                          <rect x={b.x} y={b.y} width={Math.max(6,b.w)} height={Math.max(6,b.h)} fill="transparent" stroke="none" pointerEvents="all"/>;
                      })()}
                      {i.kind==='path'?<polyline points={stroke(i.points||[])} fill="none" strokeLinecap="round"/>:i.kind==='polygon'?<polygon points={stroke(i.points||[])} strokeLinejoin="round"/>:i.kind==='rect'?<rect x={Math.min(i.x,i.x+i.w)} y={Math.min(i.y,i.y+i.h)} width={Math.abs(i.w)} height={Math.abs(i.h)}/>:i.kind==='ellipse'?<ellipse cx={i.x+i.w/2} cy={i.y+i.h/2} rx={Math.abs(i.w/2)} ry={Math.abs(i.h/2)}/>:i.kind==='line'?<line x1={i.x} y1={i.y} x2={i.x+i.w} y2={i.y+i.h}/>:i.kind==='image'&&i.imageId?(i.imageId.startsWith('file:')?<image href={fileURL(record.id,i.imageId.slice(5))} x={i.x} y={i.y} width={i.w} height={i.h}/>:<LegacyImage docId={record.id} imageId={i.imageId} x={i.x} y={i.y} w={i.w} h={i.h}/>):null}
                    </g>)}
                    {doc?.paintStrokes?.filter(stroke=>doc.layers.find(l=>l.id===stroke.layerId)?.visible!==false).map(paintStrokeView)}
                    {workspaceMode==='layout'&&hoveredShape&&!selectedIds.includes(hoveredShape)&&(()=>{
                      const graphic:Graphic|undefined=doc?.items.find(i=>i.id===hoveredShape)||doc?.paintStrokes?.find(i=>i.id===hoveredShape);
                      if(!graphic)return null;const b=graphicBox(graphic),cx=b.x+b.w/2,cy=b.y+b.h/2;
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
                      if(!graphic)return null;
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
                    {draft.length>0&&(brush!=='marker'?<g stroke={inkColor} strokeLinecap="round" opacity={inkOpacity} pointerEvents="none">{draft.slice(1).map((point,index)=><line key={index} x1={draft[index].x} y1={draft[index].y} x2={point.x} y2={point.y} strokeWidth={pressureWidth(inkWidth,point.p)}/>)}</g>:<polyline points={stroke(draft)} stroke={inkColor} strokeWidth={inkWidth} opacity={.32*inkOpacity} strokeLinecap="round" fill="none" pointerEvents="none"/>)}
                    {draftShape&&<g stroke={draftShape.color} strokeWidth={draftShape.width} fill="none" pointerEvents="none">{draftShape.kind==='line'?<line x1={draftShape.x} y1={draftShape.y} x2={draftShape.x+draftShape.w} y2={draftShape.y+draftShape.h}/>:draftShape.kind==='rect'?<rect x={Math.min(draftShape.x,draftShape.x+draftShape.w)} y={Math.min(draftShape.y,draftShape.y+draftShape.h)} width={Math.abs(draftShape.w)} height={Math.abs(draftShape.h)}/>:<ellipse cx={draftShape.x+draftShape.w/2} cy={draftShape.y+draftShape.h/2} rx={Math.abs(draftShape.w/2)} ry={Math.abs(draftShape.h/2)}/>}</g>}
                  </svg>
                  {overlapAt&&overlapItems.length>1&&workspaceMode==='layout'&&<div className="notes-overlap-picker" style={{left:Math.max(8,Math.min(width-190,overlapAt.x+14)),top:Math.max(8,overlapAt.y-10)}}>
                    <button type="button" title="密集した線や図形から選ぶ" aria-expanded={overlapOpen} onPointerDown={e=>e.stopPropagation()} onClick={()=>setOverlapOpen(v=>!v)}>近くの図形 {overlapItems.length}件 ▾</button><button className="notes-overlap-dismiss" type="button" title="候補を閉じる" aria-label="候補リストを閉じる" onPointerDown={e=>e.stopPropagation()} onClick={()=>{clearOverlapTimer();setOverlapItems([]);setOverlapAt(null);setOverlapOpen(false);}}>×</button>
                    {overlapOpen&&<div className="notes-overlap-list" role="group" aria-label="密集部分の図形候補">{overlapItems.map((id,index)=>{const graphic:Graphic|undefined=doc?.items.find(i=>i.id===id)||doc?.paintStrokes?.find(i=>i.id===id);
                      if(!graphic)return null;const layer=doc?.layers.find(l=>l.id===graphic.layerId);
                      return <button key={id} type="button" aria-pressed={selectedIds.includes(id)} onPointerDown={e=>e.stopPropagation()} onPointerEnter={()=>setHoveredShape(id)} onClick={()=>{selectGraphic(id,multiMode);setOverlapItems([]);setOverlapAt(null);setOverlapOpen(false);setHoveredShape(id);}}>{index+1}. {graphicName(graphic)} <small>{layer?.name||'レイヤー'}</small></button>;
                    })}</div>}
                  </div>}
                  <ChartsLayer sheet={sheet} charts={charts} visibleLayers={new Set((doc?.layers||[]).filter(l=>l.visible).map(l=>l.id))}/>
                  {doc?.blocks?.map(noteBlock=><EditableBlock key={noteBlock.id} docId={record!.id} block={noteBlock} readOnly={tool!=='text'||!!meta.trashedAt||organizing||importing||notes.busy||meta.importState==='pending'} selected={selected===noteBlock.id} focused={focus===noteBlock.id} onFocus={()=>{setSelected(noteBlock.id);setFocus(noteBlock.id);}}
                    onChange={(html,h)=>updateBlock(noteBlock.id,html,h)} onDrag={(e,resize)=>drag(e,noteBlock.id,resize)} onSize={h=>setSizes(old=>old[noteBlock.id]===h?old:{...old,[noteBlock.id]:h})}
                    onPaste={files=>void attach(files)} onNavigate={id=>void notes.open(id)}/>)}
                </div>
              </div>}
            </div>
            {record&&<FixedNoteLayer docId={record.id} html={fixedNote.html} visible={fixedNote.visible} locked={fixedNote.locked||!!meta.trashedAt||organizing||importing||notes.busy||meta.importState==='pending'} active={tool==='note'} onChange={updateFixedNote}/>}
          </div>
          {!focusMode&&layersOpen&&!relatedPanel&&studio&&<LayerPanel doc={studio} activeLayer={activeLayer} onActive={id=>{setActiveLayer(id);const layer=studio.layers.find(l=>l.id===id);setWorkspaceMode((layer?.studioKind||'canvas')==='layout'?'layout':'canvas');setTool((layer?.studioKind||'canvas')==='layout'?'select':'pen');}} onSelectObject={(id,kind)=>{setSelected(id);setFocus(kind==='text'?id:'');setWorkspaceMode(kind==='text'?'note':'graph');setTool(kind==='text'?'text':'select');}} onChange={next=>commit(next as NoteDoc)} onNoteTool={useNoteLayer} onSheetTool={useSheetLayer}/>}
          {!focusMode&&layersOpen&&relatedPanel&&<aside className="notes-layer-panel kn-related-panel" aria-label="関連ノート">
            <div className="notes-layer-title"><strong>関連ノート</strong><button onClick={()=>setRelatedPanel(false)} title="レイヤー一覧に戻る">←</button></div>
            <p>関連付けはChatGPTの内容解析後に作成します。まだこのノートに関連付けられた項目はありません。</p>
            <button onClick={()=>{setSettings(true);setRelatedPanel(false);}}>ChatGPT連携の設定を確認</button>
            <p>※ APIキーや機密データをブラウザへ保存する方式にはしません。サーバー側の安全な接続が必要です。</p>
          </aside>}
          {workspaceMode==='layout'&&selectedGraphic&&<div className="notes-fine-panel" role="group" aria-label="図形の微調整">
            <strong>図形の微調整</strong>
            <label>横移動 <input type="range" min="-20" max="20" step="1" value={fineX} onChange={e=>{const v=Number(e.target.value);editSelectedShape(i=>moveGraphic(i,v-fineX,0));setFineX(v);}} onPointerUp={()=>setFineX(0)}/><span>±20px</span></label>
            <label>縦移動 <input type="range" min="-20" max="20" step="1" value={fineY} onChange={e=>{const v=Number(e.target.value);editSelectedShape(i=>moveGraphic(i,0,v-fineY));setFineY(v);}} onPointerUp={()=>setFineY(0)}/><span>±20px</span></label>
            <label>回転 <input type="range" min="-30" max="30" step="1" value={fineAngle} onChange={e=>{const v=Number(e.target.value);editSelectedShape(i=>({...i,rotation:(i.rotation||0)+v-fineAngle}));setFineAngle(v);}} onPointerUp={()=>setFineAngle(0)}/><span>{Math.round(selectedGraphic.rotation||0)}°</span></label>
            <div className="notes-fine-buttons"><button onClick={()=>editSelectedShape(i=>moveGraphic(i,-1,0))}>←1</button><button onClick={()=>editSelectedShape(i=>moveGraphic(i,1,0))}>1→</button><button onClick={()=>editSelectedShape(i=>moveGraphic(i,0,-1))}>↑1</button><button onClick={()=>editSelectedShape(i=>moveGraphic(i,0,1))}>↓1</button></div>
          </div>}
        </div>
        {!!doc?.attachments?.length&&<div className="notes-attachments"><Paperclip size={15}/>{doc.attachments.map(a=><a key={a.id} href={fileURL(record!.id,a.id)} target="_blank" rel="noreferrer">{a.name} <small>{(a.size/1024/1024).toFixed(1)}MB</small></a>)}</div>}
      </section>
      {!sharedAccess&&settings&&<aside className="notes-settings"><div className="notes-settings-title"><h2>環境設定・メモの整理</h2><button onClick={()=>setSettings(false)} aria-label="設定を閉じる"><X size={18}/></button></div>
        <section className="kn-settings-group">
          <h3>表示と操作</h3>
          <label className="notes-check"><input type="checkbox" checked={sidebarAutoClose} onChange={e=>{
            setSidebarAutoClose(e.target.checked);
            try{localStorage.setItem('kn-sidebar-autoclose',e.target.checked?'on':'off');}catch{}
          }}/>カテゴリ・ノートを選んだら左のメニューを自動で閉じる</label>
          <p>初期設定はONです。OFFにすると複数のメモを連続して選びやすくなります。</p>
          <button onClick={()=>void openRevisions()}>ローカル履歴を表示</button>
          <p>保存時に端末内へ最大25世代を記録します。履歴から復元しても、元の世代は残ります。</p>
          <p>同期が不要なノート編集とカテゴリ変更は端末に保存します。共有やChatGPT連携にはネットワーク接続が必要です。</p>
        </section>
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
        {tableOpts.height==='fixed'&&<label>高さ（文字の行数）<input type="number" min={1} max={50} value={tableOpts.lines} onChange={e=>setTableOpts(o=>({...o,lines:Math.max(1,Math.min(50,Number(e.target.value)||1))}))}/></label>}
        <label>文字のあふれ方<select value={tableOpts.flow} onChange={e=>setTableOpts(o=>({...o,flow:e.target.value as TableOptions['flow']}))}><option value="expand">セルを拡張</option><option value="next">次のセルへ（手動移動・自動連結は開発中）</option></select></label>
        <div className="notes-dialog-actions"><button onClick={()=>setTableOpen(false)}>キャンセル</button><button className="notes-primary" onClick={applyTable}>適用</button></div>
      </section>
    </div>}
    {categoryManager&&<CategoryManager paths={categories} initial={category} busy={organizing} onClose={()=>setCategoryManager(false)} onApply={organize}/>}
    {deleteOpen&&<div className="notes-modal"><section role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">メモをゴミ箱へ移動</h2><p>「{record?.title}」をゴミ箱へ移動します。あとから復元できます。</p><button onClick={()=>setDeleteOpen(false)}>キャンセル</button><button className="notes-primary" onClick={()=>setTrashed(true)}>ゴミ箱へ移動</button></section></div>}
    {chartOpen&&<div className="notes-modal"><section role="dialog" aria-modal="true" aria-labelledby="chart-title"><div className="notes-settings-title"><h2 id="chart-title">グラフを作成</h2><button onClick={()=>setChartOpen(false)} aria-label="閉じる"><X size={18}/></button></div><p>Excelレイヤーで選択した範囲を参照する、グラフレイヤーの子オブジェクトを作成します。元データを変更するとグラフも更新されます。</p><label>種類<select value={chartType} onChange={e=>setChartType(e.target.value as ChartItem['type'])}><option value="bar">棒グラフ</option><option value="line">折れ線グラフ</option><option value="pie">円グラフ</option></select></label><div className="notes-dialog-actions"><button onClick={()=>setChartOpen(false)}>キャンセル</button><button className="notes-primary" onClick={createChart}>作成</button></div></section></div>}
    <input ref={fileInput} hidden type="file" multiple onChange={e=>{void attach(Array.from(e.target.files||[]));e.target.value='';}}/>
    <input ref={imageInput} hidden type="file" accept="image/*" multiple onChange={e=>{void placeImages(Array.from(e.target.files||[]));e.target.value='';}}/>
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
