import {getLocalImage} from './local-docs';
import {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,HeadingLevel,ImageRun,type IRunStylePropertiesOptions} from 'docx';
import {toPng} from 'html-to-image';
import {cleanHTML,download,plainText,fileURL,type NoteRecord} from './notes';

type WordChild=Paragraph|Table;
async function nodesToWord(html:string,docId:string):Promise<WordChild[]>{
  const root=document.createElement('div');root.innerHTML=cleanHTML(html);
  type Run=TextRun|ImageRun;
  const rgb=(color:string)=>{
    const match=color.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
    return match?match.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join(''):color.replace('#','');
  };
  async function inline(node:Node,style:IRunStylePropertiesOptions={}):Promise<Run[]>{
    if(node.nodeType===Node.TEXT_NODE)return [new TextRun({...style,text:node.textContent||''})];
    if(!(node instanceof HTMLElement))return [];
    const tag=node.tagName;
    if(tag==='BR')return [new TextRun({break:1})];
    if(tag==='INPUT')return [new TextRun({text:(node as HTMLInputElement).checked?'☑ ':'☐ '})];
    if(tag==='IMG'){
      try{
        const id=node.dataset.knLocalImage;
        const blob=id?await getLocalImage(id):undefined;
        const src=blob?URL.createObjectURL(blob):id?fileURL(docId,id):(node as HTMLImageElement).src;
        if(!src)return [new TextRun({text:node.getAttribute('alt')||'[画像]'})];
        try{
          const img=new Image();img.crossOrigin='anonymous';img.src=src;await img.decode();
          const ratio=Math.min(1,600/img.naturalWidth,800/img.naturalHeight),width=Math.max(1,Math.round(img.naturalWidth*ratio)),height=Math.max(1,Math.round(img.naturalHeight*ratio));
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.drawImage(img,0,0,width,height);
          const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));
          return [new ImageRun({type:'png',data:bytes,transformation:{width,height}})];
        }finally{if(blob)URL.revokeObjectURL(src);}
      }catch{return [new TextRun({text:node.getAttribute('alt')||'[画像を取得できません]'})];}
    }
    const color=rgb(node.style.color||node.getAttribute('color')||'');
    const size=node.style.fontSize?parseFloat(node.style.fontSize)*1.5:tag==='FONT'?[10,12,16,20,28,36,48][Number(node.getAttribute('size'))-1]*1.5:undefined;
    const opts:IRunStylePropertiesOptions={...style,
      ...(['B','STRONG'].includes(tag)?{bold:true}:{}),...(['I','EM'].includes(tag)?{italics:true}:{}),
      ...(tag==='U'?{underline:{}}:{}),...(['S','STRIKE'].includes(tag)?{strike:true}:{}),
      ...(tag==='SUP'?{superScript:true}:{}),...(tag==='SUB'?{subScript:true}:{}),
      ...(tag==='MARK'||node.style.backgroundColor?{highlight:'yellow'}:{}),
      ...(/^[a-f0-9]{6}$/i.test(color)?{color}:{}),...(size&&Number.isFinite(size)?{size}:{}),
    };
    const runs=(await Promise.all(Array.from(node.childNodes).map(n=>inline(n,opts)))).flat();
    return tag==='RT'?[new TextRun({text:'（'}),...runs,new TextRun({text:'）'})]:runs;
  }
  async function blocks(parent:Element):Promise<WordChild[]>{
    const result:WordChild[]=[];let pending:Run[]=[];
    const flush=()=>{if(pending.length){result.push(new Paragraph({children:pending}));pending=[];}};
    for(const node of Array.from(parent.childNodes)){
      if(!(node instanceof HTMLElement)){pending.push(...await inline(node));continue;}
      const tag=node.tagName;
      if(tag==='TABLE'){
        flush();const rows=[];
        for(const row of Array.from((node as HTMLTableElement).rows)){
          const cells=[];for(const cell of Array.from(row.cells)){const children=await blocks(cell);cells.push(new TableCell({children:children.length?children:[new Paragraph('')]}));}
          if(cells.length)rows.push(new TableRow({children:cells}));
        }
        if(rows.length)result.push(new Table({rows}));continue;
      }
      if(['DIV','SECTION','UL','OL'].includes(tag)){flush();result.push(...await blocks(node));continue;}
      if(['P','H1','H2','H3','H4','LI','BLOCKQUOTE','PRE'].includes(tag)){
        flush();const runs=await inline(node);
        if(tag==='LI')runs.unshift(new TextRun({text:node.parentElement?.tagName==='OL'?(Array.from(node.parentElement.children).indexOf(node)+1)+'. ':node.parentElement?.classList.contains('kn-checklist')?'':'• '}));
        result.push(new Paragraph({children:runs,heading:tag==='H1'?HeadingLevel.HEADING_1:/^H[234]$/.test(tag)?HeadingLevel.HEADING_2:undefined}));
      }else pending.push(...await inline(node));
    }
    flush();return result;
  }
  return blocks(root);
}
export async function exportDocx(record:NoteRecord){
  const content=record.content as typeof record.content&{fixedNote?:{html:string}};
  const fixed=content.fixedNote?.html||'';
  const blocks=(content.blocks||[]).map(b=>b.html);
  const doc=new Document({sections:[{children:[
    new Paragraph({text:record.title,heading:HeadingLevel.TITLE}),
    ...await nodesToWord(fixed,record.id),
    ...(await Promise.all(blocks.map(html=>nodesToWord(html,record.id)))).flat()
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
