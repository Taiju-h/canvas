import {toBlob} from 'html-to-image';
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
    const blob=await toBlob(node,{width,height,pixelRatio:1,style:{position:'relative',left:'0',top:'0'}});if(!blob)throw new Error('貼り付ける画像を作成できません');
    return{blob,width,height};
  }finally{node.remove();urls.forEach(url=>URL.revokeObjectURL(url));}
}
