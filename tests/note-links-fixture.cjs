const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const primaryId='1'.repeat(32),secondaryId='2'.repeat(32);
const image=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="110" viewBox="0 0 240 110"><rect width="240" height="110" rx="8" fill="#e5d6bc"/><rect x="94" y="22" width="52" height="64" rx="7" fill="#a08055"/><circle cx="120" cy="42" r="9" fill="#f6eee0"/></svg>');
const video=Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAI9EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIn7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiEB5AAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYj4m4M3LtF5AZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCB8LqBbpqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYj4m4M3LtF5AWfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuNDAwMDAwMDAwAB9DtnVAgueBAKPigQAAgBAIAJ0BKvAAbgAARwiFhYiFhIgCAgJ1qgIGbMtSF2lQLJdrxcnIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk4/g/v6JaH/n5n+6f5369f6rxBmesgCjmYEAyAAxAgAFEKwAGAAYWC/0AAiACLl3AAAcU7trkbuPs4EAt4r3gQHxggGf8IED','base64');
function createFixture(){
 const content={version:1,items:[],layers:[{id:'drawing',name:'描画 1',visible:true,locked:false}],grid:'none',snap:false,paintStrokes:[],blocks:[],attachments:[{id:'sample-image',name:'sample.svg',mime:'image/svg+xml',size:image.length},{id:'sample-video',name:'sample.webm',mime:'video/webm',size:video.length}],fixedNote:{visible:true,locked:false,html:`<h2>資料リンクの動作確認</h2><p>本文はクリックして編集できます。</p><p><a href="https://example.com/#text">製品の紹介ページ</a></p><p>https://example.com/#plain</p><p><a href="/canvas/?d=${secondaryId}">関連するメモ</a></p><p><img data-kn-local-image="sample-image" alt="製品の画像" style="width:240px"></p><p><video data-kn-local-file="sample-video" title="製品の動画" controls style="width:240px"></video></p>`},note:{category:'資料 / 製品',tags:['製品'],pinned:true}};
 const documents=new Map([[primaryId,{id:primaryId,title:'製品紹介の資料',revision:3,updated_at:1000,content}],[secondaryId,{id:secondaryId,title:'関連するメモ',revision:2,updated_at:900,content:{...structuredClone(content),attachments:[],studioOrder:['layout','note','canvas'],fixedNote:{visible:true,locked:false,html:'<p>関連メモの本文</p>'},note:{category:'資料 / 製品',tags:[]},blocks:[{id:'text-block',layerId:'drawing',x:80,y:600,w:420,h:180,html:'<p><a href="https://example.com/#block">文章ブロックのURL</a></p><p>編集できるブロック</p>'}]}}]]);
 const assets=new Map([['sample-image',image],['sample-video',video]]);let nextId=3,available=true;
 const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost'),chunks=[];
   if(['POST','PUT'].includes(req.method))for await(const chunk of req)chunks.push(chunk);
   const bytes=Buffer.concat(chunks),text=bytes.toString(),payload=text.startsWith('{')?JSON.parse(text):{};
   if(url.pathname==='/canvas/api.php'){
    if(!available)return json(res,{error:'fixture offline'},503);
    const api=url.searchParams.get('path');
    if(api==='/api/session')return json(res,{authenticated:true,accountId:'note-links-fixture',csrfToken:'fixture'});
    if(api==='/api/note-workspace')return json(res,{categories:['資料 / 製品'],revision:1});
    if(api==='/api/notes-index')return json(res,{documents:[...documents.values()].map(({content,...r})=>({...r,note:content.note,excerpt:'資料',searchText:content.fixedNote.html})),hasMore:false,nextOffset:documents.size});
    if(api==='/api/documents'&&req.method==='POST'){const id=(nextId++).toString(16).padStart(32,'0');documents.set(id,{id,title:payload.title,content:payload.content,revision:1,updated_at:Date.now()});return json(res,{id,revision:1});}
    const file=/^\/api\/documents\/[a-f0-9]{32}\/(?:files|images)\/([a-z0-9-]+)$/.exec(api||'');
    if(file){
     if(req.method==='POST'){const offset=Number(/name="offset"\r\n\r\n(\d+)/.exec(text)?.[1]||0),start=bytes.indexOf(Buffer.from('\r\n\r\n'))+4,end=bytes.indexOf(Buffer.from('\r\n--'),start),data=bytes.subarray(start,end);assets.set(file[1],Buffer.concat([offset?assets.get(file[1])||Buffer.alloc(0):Buffer.alloc(0),data]));return json(res,{nextOffset:offset+data.length});}
     const mime=file[1]==='sample-video'?'video/webm':'image/svg+xml';res.writeHead(200,{'Content-Type':mime});res.end(assets.get(file[1])||image);return;
    }
    const match=/^\/api\/documents\/([a-f0-9]{32})$/.exec(api||'');
    if(match){const record=documents.get(match[1]);if(!record)return json(res,{error:'not found'},404);if(req.method==='PUT'){if(payload.revision!==record.revision)return json(res,{error:'revision conflict'},409);Object.assign(record,{title:payload.title,content:payload.content,revision:record.revision+1,updated_at:Date.now()});return json(res,{id:record.id,revision:record.revision});}return json(res,record);}
    return json(res,{configured:false,documents:[]});
   }
   const relative=url.pathname.replace(/^\/(?:canvas\/)?/,'')||'index.html',file=path.resolve('public/canvas',relative);
   if(!file.startsWith(path.resolve('public/canvas')+'/')){res.writeHead(403);res.end();return;}
   try{const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':/\.(js|mjs)$/.test(file)?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-cache'});res.end(data);}catch{res.writeHead(404);res.end();}
  }catch(error){json(res,{error:String(error)},500);}
 });
 return {server,documents,assets,primaryId,secondaryId,setAvailable:value=>{available=value;}};
}
module.exports={createFixture};
if(require.main===module){const fixture=createFixture(),portAt=process.argv.indexOf('--port');fixture.server.listen(Number(portAt<0?process.env.PORT||3000:process.argv[portAt+1]),'0.0.0.0');}
