import type {Item,Point} from './canvas';
import type {NoteBlock,NoteDoc} from './notes';
import type {NoteAsset} from './note-files';
import type {InkMask} from './ink-masks';
import {moveInkSelection} from './canvas-ink';
export const SELECTION_MIME='application/x-kaerunote-selection+json';
export const SELECTION_PREFIX='KaeruNote selection\n';
export type SelectionClipboard={format:'kaerunote-selection';version:1;sourceId:string;family:'canvas'|'layout';items:Item[];paintStrokes:NonNullable<NoteDoc['paintStrokes']>;blocks:NoteBlock[];outline:Point[];assets:NoteAsset[]};
export function selectionClipboard(doc:NoteDoc,sourceId:string,family:'canvas'|'layout',ids:string[],outline:Point[]):SelectionClipboard{
  const selected=new Set(ids);
  return JSON.parse(JSON.stringify({format:'kaerunote-selection',version:1,sourceId,family,items:doc.items.filter(i=>selected.has(i.id)),paintStrokes:(doc.paintStrokes||[]).filter(i=>selected.has(i.id)),blocks:(doc.blocks||[]).filter(i=>selected.has(i.id)),outline,assets:[]}));
}
const points=(value:unknown):value is Point[]=>Array.isArray(value)&&value.length<=100000&&value.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
const masks=(value:InkMask[]|undefined)=>value===undefined||Array.isArray(value)&&value.length<=1000&&value.every(m=>m&&['erase','include','exclude'].includes(m.kind)&&points(m.points)&&(!m.clip||points(m.clip))&&m.frame&&[m.frame.x,m.frame.y,m.frame.w,m.frame.h].every(Number.isFinite)&&m.frame.w>0&&m.frame.h>0&&(m.kind!=='erase'||Number.isFinite(m.radius)&&(m.radius??0)>0));
export function parseSelectionClipboard(text:string):SelectionClipboard|null{
  if(text.startsWith(SELECTION_PREFIX))text=text.slice(SELECTION_PREFIX.length);
  if(!text||text.length>20*1024*1024)return null;
  try{const value=JSON.parse(text) as SelectionClipboard;
    if(value.format!=='kaerunote-selection'||value.version!==1||!['canvas','layout'].includes(value.family)||typeof value.sourceId!=='string'||!points(value.outline))return null;
    if(!Array.isArray(value.items)||!Array.isArray(value.paintStrokes)||!Array.isArray(value.blocks)||!Array.isArray(value.assets)||value.items.length+value.paintStrokes.length+value.blocks.length>10000||value.assets.length>1000)return null;
    if(value.items.some(i=>!i||!['path','line','rect','ellipse','polygon','image','box'].includes(i.kind)||typeof i.id!=='string'||![i.x,i.y,i.w,i.h,i.width].every(Number.isFinite)||(i.points!==undefined&&!points(i.points))||!masks(i.inkMasks)))return null;
    if(value.paintStrokes.some(s=>!s||typeof s.id!=='string'||!points(s.points)||![s.width,s.opacity].every(Number.isFinite)||!masks(s.inkMasks)))return null;
    if(value.blocks.some(b=>!b||typeof b.id!=='string'||typeof b.html!=='string'||![b.x,b.y,b.w,b.h].every(Number.isFinite)))return null;
    if(value.assets.some(a=>!a||typeof a.id!=='string'||!['file','image'].includes(a.kind)||typeof a.name!=='string'))return null;
    return value;
  }catch{return null;}
}
/** New IDs and target layers prevent paste from sharing object identities or block anchors. */
export function pasteSelection(doc:NoteDoc,value:SelectionClipboard,layerId:string,newId:()=>string,dx=24,dy=24){
  const mapping=new Map<string,string>();for(const item of [...value.items,...value.paintStrokes,...value.blocks])mapping.set(item.id,newId());
  const items=value.items.map(i=>({...i,id:mapping.get(i.id)!,layerId,keepLayer:true}));
  const paintStrokes=value.paintStrokes.map(s=>({...s,id:mapping.get(s.id)!,layerId,blockId:s.blockId?mapping.get(s.blockId):undefined}));
  const blocks=value.blocks.map(b=>({...b,id:mapping.get(b.id)!,layerId,x:b.x+dx,y:b.y+dy}));
  const ids=[...mapping.values()];
  const content=moveInkSelection({...doc,items:[...doc.items,...items],paintStrokes:[...(doc.paintStrokes||[]),...paintStrokes],blocks:[...(doc.blocks||[]),...blocks]},ids,dx,dy);
  const added=new Set(items.map(i=>i.id));
  content.items=content.items.map(i=>added.has(i.id)&&i.clip?{...i,clip:{...i.clip,x:i.clip.x+dx,y:i.clip.y+dy}}:i);
  return{content,ids,outline:value.outline.map(p=>({...p,x:p.x+dx,y:p.y+dy}))};
}
