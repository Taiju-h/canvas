import type {MouseEvent} from 'react';

export function safeReferenceURL(value:string):string|undefined{
  try{const url=new URL(value.trim());return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:undefined;}catch{return;}
}
export function noteLinkURL(value:string,base:string):string|undefined{
  try{
    const text=value.trim();if(!text||!/^(?:https?:\/\/|mailto:|tel:|www\.|\/|\?|#)/i.test(text))return;
    const url=new URL(/^www\./i.test(text)?'https://'+text:text,base);
    if(!['https:','http:','mailto:','tel:'].includes(url.protocol)||url.username||url.password)return;
    return url.href;
  }catch{return;}
}
export function noteLinkClick(event:MouseEvent<HTMLElement>,onNavigate:(id:string)=>void,onDownload:(id:string,name:string)=>void){
  if(event.defaultPrevented||event.button!==0)return false;
  const anchor=(event.target as Element).closest<HTMLAnchorElement>('a[href],a[data-kn-local-file]');
  if(!anchor||!event.currentTarget.contains(anchor))return false;
  event.preventDefault();
  // Selecting or dragging linked text remains an editing gesture.
  const selection=window.getSelection();
  if(event.detail>1||selection&&!selection.isCollapsed&&event.currentTarget.contains(selection.anchorNode))return true;
  const file=anchor.dataset.knLocalFile;if(file){onDownload(file,anchor.textContent||'attachment');return true;}
  const href=noteLinkURL(anchor.getAttribute('href')||'',location.href);if(!href)return true;
  const url=new URL(href),id=url.searchParams.get('d');
  if(url.origin===location.origin&&id&&/^(?:[a-f0-9]{32}|local-[a-f0-9]{32})$/i.test(id))onNavigate(id);
  else window.open(href,'_blank','noopener,noreferrer');
  return true;
}
/** Turn bare web URLs into links while leaving the text, images and formatting intact. */
export function linkifyNoteHTML(safeHTML:string){
  const root=document.createElement('template');root.innerHTML=safeHTML;
  const walker=document.createTreeWalker(root.content,NodeFilter.SHOW_TEXT),nodes:Text[]=[];
  while(walker.nextNode())nodes.push(walker.currentNode as Text);
  for(const text of nodes){
    if(text.parentElement?.closest('a,script,style,pre,code'))continue;
    const value=text.data,matches=[...value.matchAll(/https?:\/\/[^\s<>"']+/g)];if(!matches.length)continue;
    const fragment=document.createDocumentFragment();let offset=0;
    for(const match of matches){
      const raw=match[0].replace(/[.,;、。)\]]+$/,''),href=noteLinkURL(raw,location.href);if(!href)continue;
      fragment.append(value.slice(offset,match.index));const anchor=document.createElement('a');anchor.href=href;anchor.textContent=raw;anchor.target='_blank';anchor.rel='noopener noreferrer';fragment.append(anchor);offset=match.index+raw.length;
    }
    if(!offset)continue;fragment.append(value.slice(offset));text.replaceWith(fragment);
  }
  return root.innerHTML;
}
export type NoteLinkTarget={docId:string;element:HTMLElement|null;range:Range|null;href:string;label:string;media:boolean};
export function applyNoteLink(target:NoteLinkTarget,value:string,label:string,remove=false){
  const element=target.element?.isConnected?target.element:null;
  let root=element?.closest<HTMLElement>('.notes-fixed-editor,.note-content')||null;
  if(!root&&target.range?.startContainer.isConnected){const node=target.range.startContainer;root=(node instanceof Element?node:node.parentElement)?.closest<HTMLElement>('.notes-fixed-editor,.note-content')||null;}
  if(!root||root.getAttribute('contenteditable')!=='true')throw new Error('編集する場所をクリックしてから、もう一度リンクを設定してください');
  const href=noteLinkURL(value,location.href);if(!remove&&!href)throw new Error('開けるURLを入力してください');
  const existing=element?.closest<HTMLAnchorElement>('a');
  if(remove){if(existing)existing.replaceWith(...Array.from(existing.childNodes));}
  else if(existing){existing.href=href!;existing.removeAttribute('data-kn-local-file');if(!target.media&&label.trim()&&label!==target.label)existing.textContent=label.trim();existing.target='_blank';existing.rel='noopener noreferrer';}
  else if(element?.matches('img,video')){
    const anchor=document.createElement('a');anchor.href=href!;anchor.target='_blank';anchor.rel='noopener noreferrer';element.replaceWith(anchor);anchor.append(element);
    if(element instanceof HTMLVideoElement)element.controls=false;
  }else{
    const range=target.range;if(!range||!range.startContainer.isConnected||!root.contains(range.commonAncestorContainer))throw new Error('入力位置が変わりました。もう一度選択してください');
    root.focus();const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
    const anchor=document.createElement('a');anchor.href=href!;anchor.target='_blank';anchor.rel='noopener noreferrer';
    if(!range.collapsed&&label===target.label){const contents=range.extractContents();for(const nested of contents.querySelectorAll('a'))nested.replaceWith(...Array.from(nested.childNodes));anchor.append(contents);}
    else{anchor.textContent=label.trim()||href!;range.deleteContents();}
    range.insertNode(anchor);range.setStartAfter(anchor);range.collapse(true);selection?.removeAllRanges();selection?.addRange(range);
  }
  for(const video of root.querySelectorAll('video'))video.controls=!video.closest('a[href]');
  root.dispatchEvent(new Event('input',{bubbles:true}));
}
