import {escapeHTML} from './notes';
export type TableOptions={kind:'table'|'columns';rows:number;cols:number;width:number;align:'left'|'center'|'right'|'fit';height:'auto'|'fixed';lines:number;flow:'expand'|'next'};
export function tableMarkup(o:TableOptions):string{
  const cols=Math.max(1,Math.min(12,Math.floor(o.cols))),rows=Math.max(1,Math.min(20,Math.floor(o.rows)));
  const width=o.align==='fit'?100:Math.max(10,Math.min(100,Math.floor(o.width)));
  const margin=o.align==='center'?'margin-left:auto;margin-right:auto':o.align==='right'?'margin-left:auto': 'margin-left:0';
  const style='width:'+width+'%;'+margin+';table-layout:fixed;border-collapse:collapse';
  const cells=Array.from({length:rows},()=>'<tr>'+Array.from({length:cols},()=>'<td><p><br></p></td>').join('')+'</tr>').join('');
  return '<table data-kn-layout="'+o.kind+'" data-kn-align="'+o.align+'" data-kn-width="'+width+'" data-kn-height="'+(o.height==='fixed'?o.lines:'auto')+
    '" data-kn-flow="'+o.flow+'" style="'+style+'"><tbody>'+cells+'</tbody></table><p><br></p>';
}
export function selectedNoteRoot():HTMLElement|null{
  const selection=window.getSelection(),node=selection?.anchorNode;
  const element=node instanceof Element?node:node?.parentElement;
  return element?.closest<HTMLElement>('.notes-fixed-editor,.note-content')||null;
}
export function currentTable():HTMLTableElement|null{
  const selection=window.getSelection(),node=selection?.anchorNode;
  return (node instanceof Element?node:node?.parentElement)?.closest('table')||null;
}
export function currentCell():HTMLTableCellElement|null{
  const selection=window.getSelection(),node=selection?.anchorNode;
  return (node instanceof Element?node:node?.parentElement)?.closest('td,th')||null;
}
export function insertRichHTML(html:string){
  let root=selectedNoteRoot();
  if(!root){root=document.querySelector<HTMLElement>('.notes-fixed-editor[contenteditable=true],.note-content[contenteditable=true]');root?.focus();}
  if(!root)return false;
  document.execCommand('insertHTML',false,html);
  root.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
export function editTable(action:'row+'|'row-'|'col+'|'col-',table?:HTMLTableElement|null,cell?:HTMLTableCellElement|null){
  const target=table||currentTable();if(!target)return false;
  const rows=Array.from(target.rows),selected=cell||currentCell()||rows[0]?.cells[0];
  if(!selected)return false;
  const row=(selected.parentElement as HTMLTableRowElement),ri=Math.max(0,rows.indexOf(row)),ci=Math.max(0,Array.from(row.cells).indexOf(selected));
  if(action==='row+'||action==='row-'){
    if(action==='row-'&&rows.length<=1)return false;
    if(action==='row-')row.remove();
    else{
      const added=target.insertRow(ri+1);
      for(let i=0;i<row.cells.length;i++){const td=added.insertCell(i);td.innerHTML='<p><br></p>';}
    }
  }else{
    if(action==='col-'&&row.cells.length<=1)return false;
    for(const r of rows){
      if(action==='col-')r.deleteCell(Math.min(ci,r.cells.length-1));
      else r.insertCell(ci+1).innerHTML='<p><br></p>';
    }
  }
  target.closest('.notes-fixed-editor,.note-content')?.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
export function setTableOptions(table:HTMLTableElement,opts:TableOptions){
  table.setAttribute('data-kn-layout',opts.kind);
  table.setAttribute('data-kn-align',opts.align);
  table.setAttribute('data-kn-width',String(opts.width));
  table.setAttribute('data-kn-height',opts.height==='fixed'?String(opts.lines):'auto');
  table.setAttribute('data-kn-flow',opts.flow);
  table.style.width=(opts.align==='fit'?100:opts.width)+'%';
  table.style.marginLeft=opts.align==='right'||opts.align==='center'?'auto':'0';
  table.style.marginRight=opts.align==='center'?'auto':'0';
  table.closest('.notes-fixed-editor,.note-content')?.dispatchEvent(new Event('input',{bubbles:true}));
}
export function selectedString():string {return window.getSelection()?.toString()||'';}
export function applyRuby(reading:string,color:string){
  const text=selectedString();if(!text.trim()||!reading.trim())return false;
  return insertRichHTML('<ruby>'+escapeHTML(text)+'<rt style="color:'+color+'">'+escapeHTML(reading)+'</rt></ruby>');
}
export function applyRedMark(kind:'circle'|'underline'|'wave'){
  const text=selectedString();if(!text)return false;
  return insertRichHTML('<span class="kn-red-'+kind+'">'+escapeHTML(text)+'</span>');
}
