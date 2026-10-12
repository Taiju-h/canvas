import {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,HeadingLevel} from 'docx';
import {toPng} from 'html-to-image';
import {cleanHTML,download,plainText,type NoteRecord} from './notes';

type WordChild=Paragraph|Table;
function nodesToWord(html:string):WordChild[]{
  const root=document.createElement('div');root.innerHTML=cleanHTML(html);
  const children:WordChild[]=[];
  const walk=(node:Element)=>{
    if(node.tagName==='TABLE'){
      const rows=Array.from(node.querySelectorAll('tr')).map(row=>new TableRow({children:Array.from(row.querySelectorAll('th,td')).map(cell=>
        new TableCell({children:[new Paragraph({text:cell.textContent||' '})]})
      )}));
      if(rows.length)children.push(new Table({rows}));
      return;
    }
    if(['DIV','SECTION'].includes(node.tagName)){for(const c of Array.from(node.children))walk(c);return;}
    if(['H1','H2','H3','H4'].includes(node.tagName)){
      children.push(new Paragraph({text:node.textContent||'',heading:node.tagName==='H1'?HeadingLevel.HEADING_1:HeadingLevel.HEADING_2}));
      return;
    }
    if(node.tagName==='UL'||node.tagName==='OL'){
      for(const li of Array.from(node.querySelectorAll('li')))children.push(new Paragraph({
        children:[new TextRun({text:(node.tagName==='OL'?'1. ':'• ')+(li.textContent||'')})]
      }));
      return;
    }
    const content=node.textContent||'';
    if(content.trim()||node.tagName==='P')children.push(new Paragraph({text:content||' '}));
  };
  for(const n of Array.from(root.children))walk(n);
  if(!children.length)children.push(new Paragraph({text:plainText(html)||' '}));
  return children;
}
export async function exportDocx(record:NoteRecord){
  const content=record.content as typeof record.content&{fixedNote?:{html:string}};
  const fixed=content.fixedNote?.html||'';
  const blocks=(content.blocks||[]).map(b=>b.html);
  const doc=new Document({sections:[{children:[
    new Paragraph({text:record.title,heading:HeadingLevel.TITLE}),
    ...nodesToWord(fixed),
    ...blocks.flatMap(nodesToWord)
  ]}]});
  const blob=await Packer.toBlob(doc);
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=(record.title||'KaeruNote').replace(/[\\/:*?"<>|]/g,'_')+'.docx';a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),20000);
}
export async function exportPng(element:HTMLElement,name:string){
  // Capture only a bounded viewport to avoid exhausting graphics memory.
  const url=await toPng(element,{cacheBust:true,pixelRatio:1,backgroundColor:'#ffffff'});
  const a=document.createElement('a');a.href=url;a.download=(name||'KaeruNote').replace(/[\\/:*?"<>|]/g,'_')+'.png';a.click();
}
export function exportPlain(record:NoteRecord){
  const content=record.content as typeof record.content&{fixedNote?:{html:string}};
  const parts=[content.fixedNote?.html||'',...(content.blocks||[]).map(b=>b.html)];
  download((record.title||'KaeruNote')+'.txt',parts.map(plainText).filter(Boolean).join('\n\n'),'text/plain');
}
