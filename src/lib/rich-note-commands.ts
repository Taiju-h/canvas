import {escapeHTML} from './notes';
export type TableOptions={kind:'table'|'columns';rows:number;cols:number;width:number;align:'left'|'center'|'right'|'fit';height:'auto'|'fixed';lines:number;flow:'expand'|'next'};
export function tableMarkup(o:TableOptions):string{
  const cols=Math.max(1,Math.min(12,Math.floor(o.cols))),rows=Math.max(1,Math.min(20,Math.floor(o.rows)));
  const width=o.align==='fit'?100:Math.max(10,Math.min(100,Math.floor(o.width)));
  const margin=o.align==='center'?'margin-left:auto;margin-right:auto':o.align==='right'?'margin-left:auto': 'margin-left:0';
  const style='width:'+width+'%;'+margin+';table-layout:fixed;border-collapse:collapse';
  const inner=o.height==='fixed'||o.kind==='columns'&&o.flow==='next'
    ?'<div class="kn-fixed-cell" style="height:'+Math.max(1,Math.min(50,o.lines))*24+'px;overflow:hidden"><p><br></p></div>'
    :'<p><br></p>';
  const cells=Array.from({length:rows},()=>'<tr>'+Array.from({length:cols},()=>'<td>'+inner+'</td>').join('')+'</tr>').join('');
  return '<table data-kn-layout="'+o.kind+'" data-kn-align="'+o.align+'" data-kn-width="'+width+'" data-kn-height="'+(o.height==='fixed'||o.kind==='columns'&&o.flow==='next'?o.lines:'auto')+
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
      for(let i=0;i<row.cells.length;i++){const td=added.insertCell(i);td.innerHTML=row.cells[i]?.querySelector('.kn-fixed-cell')
        ?'<div class="kn-fixed-cell" style="height:'+((Number(target.getAttribute('data-kn-height'))||4)*24)+'px;overflow:hidden"><p><br></p></div>':'<p><br></p>';}
    }
  }else{
    if(action==='col-'&&row.cells.length<=1)return false;
    for(const r of rows){
      if(action==='col-')r.deleteCell(Math.min(ci,r.cells.length-1));
      else r.insertCell(ci+1).innerHTML='<p><br></p>';
    }
  }
  normalizeTableCells(target);
  target.closest('.notes-fixed-editor,.note-content')?.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
export function setTableOptions(table:HTMLTableElement,opts:TableOptions){
  const rows=Math.max(1,Math.min(20,Math.floor(opts.rows))),cols=Math.max(1,Math.min(12,Math.floor(opts.cols)));
  while(table.rows.length>rows)table.deleteRow(table.rows.length-1);
  while(table.rows.length<rows)table.insertRow();
  for(const row of Array.from(table.rows)){
    while(row.cells.length>cols)row.deleteCell(row.cells.length-1);
    while(row.cells.length<cols)row.insertCell().innerHTML='<p><br></p>';
  }
  table.setAttribute('data-kn-layout',opts.kind);
  table.setAttribute('data-kn-align',opts.align);
  table.setAttribute('data-kn-width',String(opts.width));
  table.setAttribute('data-kn-height',opts.height==='fixed'||opts.kind==='columns'&&opts.flow==='next'?String(opts.lines):'auto');
  table.setAttribute('data-kn-flow',opts.flow);
  table.style.width=(opts.align==='fit'?100:opts.width)+'%';
  table.style.marginLeft=opts.align==='right'||opts.align==='center'?'auto':'0';
  table.style.marginRight=opts.align==='center'?'auto':'0';
  for(const cell of Array.from(table.querySelectorAll('td,th'))){
    let container=cell.querySelector<HTMLElement>('.kn-fixed-cell');
    if(opts.height==='fixed'||opts.kind==='columns'&&opts.flow==='next'){
      if(!container){
        container=document.createElement('div');container.className='kn-fixed-cell';
        while(cell.firstChild)container.append(cell.firstChild);
        cell.append(container);
      }
      container.style.height=Math.max(1,Math.min(50,opts.lines))*24+'px';
      container.style.overflow='hidden';
    }else if(container){
      while(container.firstChild)cell.insertBefore(container.firstChild,container);
      container.remove();
    }
  }
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

function normalizeTableCells(table:HTMLTableElement){
  const lines=Number(table.dataset.knHeight);
  if(!Number.isFinite(lines)||lines<1)return;
  for(const row of Array.from(table.rows))for(const cell of Array.from(row.cells)){
    let box=Array.from(cell.children).find(el=>el.classList.contains('kn-fixed-cell')) as HTMLElement|undefined;
    if(!box){box=document.createElement('div');box.className='kn-fixed-cell';while(cell.firstChild)box.append(cell.firstChild);cell.append(box);}
    box.style.height=Math.min(50,lines)*24+'px';box.style.overflow='hidden';
  }
}
/** Flow overflowing column content without discarding text or inline formatting. */
export function flowNoteColumns(root:HTMLElement){
  for(const table of Array.from(root.querySelectorAll<HTMLTableElement>('table[data-kn-layout="columns"][data-kn-flow="next"]'))){
    normalizeTableCells(table);
    if(!table.getBoundingClientRect().width)continue;
    const selection=window.getSelection();let caret:HTMLSpanElement|undefined;
    if(selection?.isCollapsed&&selection.rangeCount&&table.contains(selection.anchorNode)){
      caret=document.createElement('span');caret.style.display='none';selection.getRangeAt(0).cloneRange().insertNode(caret);
    }
    let cells=Array.from(table.rows).flatMap(row=>Array.from(row.cells));
    for(let i=0;i<cells.length&&i<2400;i++){
      const box=cells[i].querySelector<HTMLElement>(':scope > .kn-fixed-cell');if(!box)continue;
      let moves=0;
      while(box.scrollHeight>box.clientHeight+2&&box.childNodes.length&&moves++<20000){
        // A single indivisible image/table may be taller than the configured area.
        const texts=document.createTreeWalker(box,NodeFilter.SHOW_TEXT);let last:Text|undefined,node:Node|null;
        while((node=texts.nextNode()))if(node.textContent?.length)last=node as Text;
        let part:DocumentFragment;const tail=box.lastChild;
        if(!last&&box.childNodes.length<=1)break;
        if(i+1===cells.length){
          if(table.rows.length>=200)break;
          const row=table.insertRow();for(let c=0;c<table.rows[0].cells.length;c++)row.insertCell().innerHTML='<p><br></p>';
          normalizeTableCells(table);cells=Array.from(table.rows).flatMap(r=>Array.from(r.cells));
        }
        const next=cells[i+1].querySelector<HTMLElement>(':scope > .kn-fixed-cell')!;
        if(next.textContent==='')next.replaceChildren();
        if(tail instanceof HTMLElement&&tail!==last?.parentElement&&tail.textContent===''){
          part=document.createDocumentFragment();part.append(tail);
        }else if(last){
          const range=document.createRange(),length=last.data.length;
          const low=last.data.charCodeAt(length-1);const count=low>=0xDC00&&low<=0xDFFF&&length>1?2:1;
          range.setStart(last,length-count);range.setEnd(box,box.childNodes.length);
          part=range.extractContents();
        }else{part=document.createDocumentFragment();part.append(tail!);}
        // Join like paragraph wrappers, avoiding a paragraph per moved character.
        const a=part.lastChild,b=next.firstChild;
        if(a instanceof HTMLElement&&b instanceof HTMLElement&&a.outerHTML.slice(0,a.outerHTML.indexOf('>')+1)===b.outerHTML.slice(0,b.outerHTML.indexOf('>')+1)){
          while(b.firstChild)a.append(b.firstChild);b.remove();
        }
        next.prepend(part);box.normalize();next.normalize();
        for(const empty of Array.from(box.querySelectorAll('p,div,span,b,strong,i,em')))if(!empty.childNodes.length&&empty!==caret)empty.remove();
      }
    }
    if(caret?.isConnected&&selection){const range=document.createRange();range.setStartBefore(caret);range.collapse(true);selection.removeAllRanges();selection.addRange(range);caret.remove();}
  }
}
