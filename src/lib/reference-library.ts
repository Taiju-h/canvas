import type {NoteRecord} from './notes';
import {noteAssets,type NoteAsset} from './note-files';
import {crmLinks,type CRMLink} from './crm-links';
import {safeReferenceURL} from './note-links';
export {safeReferenceURL} from './note-links';

export type ReferenceKind='note'|'image'|'video'|'youtube'|'link';
export type ReferenceEntry={id:string;key:string;kind:ReferenceKind;documentId:string;title:string;parentTitle:string;
  category:string;tags:string[];pinned:boolean;updatedAt:number;excerpt:string;searchText?:string;url?:string;targetURL?:string;asset?:NoteAsset;crmLinks?:CRMLink[]};
export function youtubeVideoId(value:string):string|undefined{
  try{
    const url=new URL(value),host=url.hostname.toLowerCase().replace(/^www\./,'');
    const id=host==='youtu.be'?url.pathname.split('/')[1]:['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)
      ?url.pathname==='/watch'?url.searchParams.get('v'): /^\/(?:shorts|embed|live)\//.test(url.pathname)?url.pathname.split('/')[2]:undefined:undefined;
    return id&&/^[a-zA-Z0-9_-]{11}$/.test(id)?id:undefined;
  }catch{return;}
}
export function referenceKey(kind:ReferenceKind,value=''){return kind==='note'?'note':kind+':'+value;}
export function referencePinned(record:NoteRecord,key:string){return key==='note'?!!record.content.note?.pinned:!!record.content.note?.referencePins?.includes(key);}
export function noteReferenceEntries(record:NoteRecord):ReferenceEntry[]{
  const doc=record.content,meta=doc.note;
  if(meta?.trashedAt||meta?.importState==='pending')return[];
  const root=document.createElement('template');
  root.innerHTML=[doc.fixedNote?.html,...(doc.blocks||[]).map(b=>b.html),...(doc.items||[]).filter(i=>i.kind==='text').map(i=>i.text||'')].filter(Boolean).join('\n');
  root.content.querySelectorAll('br').forEach(el=>el.replaceWith('\n'));
  root.content.querySelectorAll('p,div,h1,h2,h3,h4,li,tr,blockquote,pre').forEach(el=>el.append('\n'));
  const fullText=(root.content.textContent||'').trim(),excerpt=fullText.slice(0,800);
  const rows=new Map<string,ReferenceEntry>();
  function add(kind:ReferenceKind,key:string,title:string,extra:Partial<ReferenceEntry>={}){
    if(rows.has(key))return;
    rows.set(key,{id:record.id+':'+key,key,kind,documentId:record.id,title:title||record.title,parentTitle:record.title,
      category:meta?.category||'',tags:meta?.tags||[],pinned:referencePinned(record,key),updatedAt:record.updated_at,excerpt,searchText:fullText,crmLinks:crmLinks(meta?.crmLinks),...extra});
  }
  add('note','note',record.title);
  const assets=noteAssets(record),mediaInfo=new Map<string,{title:string;targetURL?:string}>();
  for(const image of root.content.querySelectorAll<HTMLImageElement|HTMLVideoElement>('img,video')){
    const src=image.getAttribute('data-kn-offline-src')||image.getAttribute('src')||image.querySelector('source')?.getAttribute('src')||'';
    let local=image.getAttribute('data-kn-local-image')||image.getAttribute('data-kn-local-file');
    try{const url=new URL(src,location.href);if(url.origin===location.origin&&url.pathname==='/canvas/api.php')local=(url.searchParams.get('path')||'').match(/^\/api\/documents\/[a-f0-9]{32}\/(?:files|images)\/([a-zA-Z0-9-]+)$/)?.[1]||local;}catch{}
    const title=image instanceof HTMLImageElement?image.alt:image.title,targetURL=safeReferenceURL(image.closest('a[href]')?.getAttribute('href')||'');
    if(local)mediaInfo.set(local,{title,targetURL});
    if(local)continue;
    if(/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(src)||safeReferenceURL(src)){
      const url=safeReferenceURL(src)||src;
      if(new URL(url,location.href).pathname==='/canvas/api.php')continue;
      const kind=image.tagName==='VIDEO'?'video':'image';
      add(kind,referenceKey(kind,url),title||'本文の'+(kind==='video'?'動画':'画像'),{url,targetURL});
    }
  }
  for(const asset of assets){
    const kind=asset.mime?.startsWith('video/')||/\.(?:mp4|webm|mov|m4v|ogv)$/i.test(asset.name)?'video':asset.mime?.startsWith('image/')||asset.kind==='image'||/\.(?:png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(asset.name)?'image':undefined;
    if(kind){const info=mediaInfo.get(asset.id);add(kind,referenceKey(kind,asset.id),info?.title||asset.name,{asset,targetURL:info?.targetURL});}
  }
  function link(value:string,label='',context=''){
    const url=safeReferenceURL(value);if(!url)return;
    const parsed=new URL(url);
    if(parsed.origin===location.origin&&(parsed.pathname.endsWith('/api.php')||parsed.searchParams.has('d')))return;
    const kind=youtubeVideoId(url)?'youtube':'link',key=referenceKey(kind,url);
    const hint=context.trim().split('\n').filter(Boolean).at(-1)?.replace(/<br\s*\/?>/gi,' ').trim()||'';
    add(kind,key,label&&safeReferenceURL(label)!==url?label:hint&&hint.length<=80&&!safeReferenceURL(hint)?record.title+' · '+hint:parsed.hostname+parsed.pathname,{url});
  }
  for(const a of root.content.querySelectorAll('a[href]')){
    let previous=a.previousSibling;
    while(previous&&!previous.textContent?.trim())previous=previous.previousSibling;
    link(a.getAttribute('href')||'',a.textContent?.trim()||a.querySelector('img')?.alt||a.querySelector('video')?.title,previous?.textContent||a.parentElement?.previousElementSibling?.textContent||'');
  }
  // Older imported notes sometimes retain bare URLs instead of anchors.
  for(const match of fullText.matchAll(/https?:\/\/[^\s<>"']+/g))link(match[0].replace(/[.,;、。)\]]+$/,''),'',fullText.slice(Math.max(0,match.index-100),match.index));
  return [...rows.values()];
}
export function referenceMarkup(entry:ReferenceEntry){
  const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const href=entry.kind==='note'?'/canvas/?d='+encodeURIComponent(entry.documentId):entry.asset
    ?'/canvas/api.php?path='+encodeURIComponent(`/api/documents/${entry.asset.documentId||entry.documentId}/${entry.asset.kind==='file'?'files':'images'}/${entry.asset.id}`)
    :safeReferenceURL(entry.url||'')||(entry.kind==='image'&&/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(entry.url||'')?entry.url:undefined);
  if(!href)return '';
  if(entry.kind==='image'||entry.kind==='video'){
    const attr=entry.asset?` data-kn-local-${entry.asset.kind==='file'?'file':'image'}="${escape(entry.asset.id)}"`:'';
    const target=safeReferenceURL(entry.targetURL||'');
    const media=entry.kind==='image'?`<img src="${escape(href)}" alt="${escape(entry.title)}"${attr} style="max-width:100%;height:auto">`:`<video src="${escape(href)}" title="${escape(entry.title)}"${attr}${target?'':' controls'} preload="metadata" playsinline style="max-width:100%;height:auto"></video>`;
    return `<p>${target?`<a href="${escape(target)}" target="_blank" rel="noopener noreferrer">${media}</a>`:media}</p>`;
  }
  return `<p><a href="${escape(href)}"${entry.kind==='note'?'':' target="_blank" rel="noopener noreferrer"'}>${escape(entry.title)}</a></p>`;
}
