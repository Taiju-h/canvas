import {cleanHTML,type NoteDoc} from './notes';
import {displayCell,type SheetData} from '../components/note-studio-layers';

export type ReferenceSource={id:string;alias?:string;sheet?:SheetData};
const EXPR=/\{\{([A-Za-z][A-Za-z0-9_-]{0,39}:)?([A-Z]{1,3}[1-9][0-9]{0,4})\}\}/g;
const VALID=/^(?:([A-Za-z][A-Za-z0-9_-]{0,39}):)?([A-Z]{1,3}[1-9][0-9]{0,4})$/;
function findValue(reference:string,self:ReferenceSource,sources:ReferenceSource[]):string{
  const m=VALID.exec(reference);if(!m)return '#INVALID!';
  const source=m[1]?(sources.find(x=>x.id===m[1]||x.alias===m[1])):self;
  if(!source?.sheet)return '#REF!';
  return displayCell(source.sheet,m[2]);
}
/** Materialize {{C1}} or {{alias:C5}} only when explicitly saved/refreshed. */
export function materializeSheetReferences(html:string,self:ReferenceSource,sources:ReferenceSource[]){
  const root=document.createElement('div');root.innerHTML=cleanHTML(html);
  // Refresh existing references while preserving the original formula in its attribute.
  root.querySelectorAll<HTMLElement>('[data-kn-ref]').forEach(element=>{
    const reference=element.dataset.knRef||'';
    element.textContent=findValue(reference,self,sources);
  });
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const nodes:Text[]=[];let current:Node|null;
  while((current=walker.nextNode())){
    if(current.parentElement?.closest('script,style,[data-kn-ref],ruby,rt'))continue;
    if(EXPR.test(current.textContent||''))nodes.push(current as Text);
    EXPR.lastIndex=0;
  }
  for(const node of nodes){
    const str=node.textContent||'',fragment=document.createDocumentFragment();
    let offset=0,match:RegExpExecArray|null;
    EXPR.lastIndex=0;
    while((match=EXPR.exec(str))){
      if(match.index>offset)fragment.append(document.createTextNode(str.slice(offset,match.index)));
      const name=(match[1]||'')+match[2];
      const element=document.createElement('span');
      element.className='kn-sheet-ref';element.setAttribute('data-kn-ref',name);
      element.textContent=findValue(name,self,sources);
      fragment.append(element);offset=EXPR.lastIndex;
    }
    if(offset<str.length)fragment.append(document.createTextNode(str.slice(offset)));
    node.replaceWith(fragment);
  }
  return cleanHTML(root.innerHTML);
}
export function referencedAliases(html:string):string[]{
  const result=new Set<string>();
  const regex=/data-kn-ref=["']([^"']+)["']|\{\{([^}]+)\}\}/g;
  let match:RegExpExecArray|null;
  while((match=regex.exec(html))){
    const ref=match[1]||match[2];
    const found=VALID.exec(ref);
    if(found?.[1])result.add(found[1]);
  }
  return [...result];
}
export function referenceSourceFromNote(id:string,doc:NoteDoc):ReferenceSource{
  const note=doc as NoteDoc&{sheet?:SheetData};
  return{id,alias:doc.note?.alias,sheet:note.sheet};
}
