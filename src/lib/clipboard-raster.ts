import {cleanHTML} from './notes';
import {getLocalImage} from './local-docs';

/** Canvas paste becomes pixels; Layout keeps an editable text/image object. */
export async function clipboardRaster(html:string,width=720){
  const node=document.createElement('div'),urls:string[]=[];
  Object.assign(node.style,{position:'fixed',left:'-12000px',top:'0',width:width+'px',boxSizing:'border-box',padding:'12px',font:'16px/1.7 system-ui,sans-serif',color:'#263443',whiteSpace:'pre-wrap',overflowWrap:'anywhere',background:'transparent'});
  node.innerHTML=cleanHTML(html);document.body.append(node);
  try{
    if(node.querySelector('video'))throw new Error('動画はレイアウトのまま貼り付けてください');
    for(const image of node.querySelectorAll('img')){
      const id=image.getAttribute('data-kn-local-image')||image.getAttribute('data-kn-local-file');
      if(id){const blob=await getLocalImage(id);if(!blob)throw new Error('貼り付ける画像の原本が端末にありません');const url=URL.createObjectURL(blob);urls.push(url);image.src=url;}
      image.style.maxWidth='100%';
      if(!image.complete)await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('貼り付ける画像を読み込めません'));});
    }
    const height=Math.max(48,Math.ceil(node.scrollHeight));
    if(height>8192)throw new Error('Canvasに貼り付ける文章が長いため、分けて貼り付けてください');
    // Draw from DOM positions directly. SVG foreignObject snapshots can produce
    // transparent pixels in WebView/Chromium despite successfully returning PNG.
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw new Error('Canvasを作成できません');
    const origin=node.getBoundingClientRect();
    for(const element of [node,...node.querySelectorAll<HTMLElement>('*')]){
      const style=getComputedStyle(element),bounds=element.getBoundingClientRect(),x=bounds.left-origin.left,y=bounds.top-origin.top;
      if(style.backgroundColor!=='rgba(0, 0, 0, 0)'&&style.backgroundColor!=='transparent'){context.fillStyle=style.backgroundColor;context.fillRect(x,y,bounds.width,bounds.height);}
      if(element instanceof HTMLImageElement){context.drawImage(element,x,y,bounds.width,bounds.height);continue;}
      for(const [side,start,end] of [['Top',[x,y],[x+bounds.width,y]],['Bottom',[x,y+bounds.height],[x+bounds.width,y+bounds.height]],['Left',[x,y],[x,y+bounds.height]],['Right',[x+bounds.width,y],[x+bounds.width,y+bounds.height]]] as const){
        const size=parseFloat(style.getPropertyValue('border-'+side.toLowerCase()+'-width'));
        if(size&&style.getPropertyValue('border-'+side.toLowerCase()+'-style')!=='none'){context.strokeStyle=style.getPropertyValue('border-'+side.toLowerCase()+'-color');context.lineWidth=size;context.beginPath();context.moveTo(...start);context.lineTo(...end);context.stroke();}
      }
    }
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),range=document.createRange();let text:Node|null;
    const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});let count=0;
    while((text=walker.nextNode())){
      const style=getComputedStyle(text.parentElement!);context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;context.fillStyle=style.color;context.textBaseline='top';
      for(const part of segmenter.segment(text.textContent||'')){
        if(++count>30000)throw new Error('Canvasに貼り付ける文章が長いため、分けて貼り付けてください');
        range.setStart(text,part.index);range.setEnd(text,part.index+part.segment.length);const bounds=range.getBoundingClientRect();if(!bounds.width||!part.segment.trim())continue;
        const x=bounds.left-origin.left,y=bounds.top-origin.top;context.fillText(part.segment,x,y);
        if(style.textDecorationLine.includes('underline'))context.fillRect(x,y+parseFloat(style.fontSize)+1,bounds.width,1);
      }
    }
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('貼り付ける画像を作成できません')),'image/png'));
    return{blob,width,height};
  }finally{node.remove();urls.forEach(url=>URL.revokeObjectURL(url));}
}
