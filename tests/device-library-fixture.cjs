const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
function content(html=''){return{version:1,grid:'none',snap:false,items:[],layers:[{id:'ink',name:'描画 1',visible:true,locked:false}],paintStrokes:[],blocks:[],fixedNote:{html,visible:true,locked:false},attachments:[],note:{category:'',tags:[]}};}
function createFixture(){
 const owner='b'.repeat(32),documents=new Map(),owners=new Map(),assets=new Map(),folders={categories:['サーバー'],revision:1};
 const state={account:owner,failFileOnce:false,filePosts:0,deniedReads:0,postCount:0};
 const add=(record,account=owner)=>{documents.set(record.id,record);owners.set(record.id,account);return record;};
 const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/canvas/api.php'){
   const api=url.searchParams.get('path'),chunks=[];if(['POST','PUT'].includes(req.method))for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),isJSON=(req.headers['content-type']||'').includes('application/json'),data=isJSON?JSON.parse(bytes.toString()||'{}'):{};
   if(api==='/api/session')return json(res,{authenticated:true,accountId:state.account,csrfToken:'fixture'});
   if(api==='/api/notes-index'){const rows=[...documents.values()].filter(n=>owners.get(n.id)===state.account),offset=Number(url.searchParams.get('offset')||0);return json(res,{documents:rows.slice(offset,offset+100).map(({content,...n})=>({...n,note:content.note})),hasMore:offset+100<rows.length,nextOffset:offset+100});}
   if(api==='/api/note-workspace'){if(req.method==='POST'){if(data.revision!==folders.revision)return json(res,{error:'conflict'},409);folders.categories=data.categories;folders.revision++;}return json(res,folders);}
   if(api==='/api/documents'&&req.method==='POST'){const id=randomBytes(16).toString('hex'),record=add({id,title:data.title,content:data.content,revision:1,updated_at:Date.now()},state.account);state.postCount++;return json(res,{...record,owner:true});}
   const match=/^\/api\/documents\/([a-f0-9]{32})(?:\/(images|files)(?:\/([a-zA-Z0-9-]+))?)?$/.exec(api||'');
   if(match){const [_,id,kind,assetId]=match,record=documents.get(id);if(!record||owners.get(id)!==state.account){state.deniedReads++;return json(res,{error:'この作品を開く権限がありません'},403);}
    if(kind){
     const form=req.method==='POST'?await new Request('http://localhost/',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData():null;
     if(req.method==='POST'){
      const file=form.get('file'),buffer=Buffer.from(await file.arrayBuffer());
      if(kind==='images'){const imageId=randomBytes(16).toString('hex');assets.set(id+'/'+imageId,{bytes:buffer,mime:file.type||'image/png'});return json(res,{imageId});}
      const offset=Number(form.get('offset')),total=Number(form.get('total'));state.filePosts++;
      if(state.failFileOnce&&offset>=1024*1024){state.failFileOnce=false;return json(res,{error:'原本送信の接続が一度切れました'},503);}
      const previous=assets.get(id+'/'+assetId);if(previous?.complete&&previous.bytes.length===total)return json(res,{nextOffset:total,complete:true});
      const joined=Buffer.concat([offset?previous?.bytes||Buffer.alloc(0):Buffer.alloc(0),buffer]);assets.set(id+'/'+assetId,{bytes:joined,mime:file.type||'application/octet-stream',complete:joined.length===total});return json(res,{nextOffset:offset+buffer.length,complete:joined.length===total});
     }
     const value=assets.get(id+'/'+assetId);if(!value)return json(res,{error:'missing original'},404);res.writeHead(200,{'Content-Type':value.mime,'Cache-Control':'no-store'});res.end(value.bytes);return;
    }
    if(req.method==='PUT'){if(data.revision!==record.revision)return json(res,{error:'conflict'},409);Object.assign(record,{title:data.title,content:data.content,revision:record.revision+1,updated_at:Date.now()});return json(res,{id,revision:record.revision});}
    return json(res,{...record,owner:true});
   }
   return json(res,{configured:false,documents:[]});
  }
  const root=path.resolve('public/canvas'),file=url.pathname==='/sw.js'?path.resolve('public/sw.js'):path.resolve(root,url.pathname.replace(/^\/(?:canvas\/)?/,'')||'index.html');
  if(file!==path.resolve('public/sw.js')&&!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  try{const value=fs.readFileSync(file),ext=path.extname(file);res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[ext]||'text/html'});res.end(value);}catch{res.writeHead(404);res.end();}
 }catch(error){console.error(error);json(res,{error:String(error)},500);}});
 return{server,owner,documents,owners,assets,folders,state,add,content,png};
}
module.exports={createFixture,content,png};
if(require.main===module){const f=createFixture();f.add({id:'1'.repeat(32),title:'貼り付けと保存の確認',revision:1,updated_at:1,content:content('<p>保存したメモ</p>')});const i=process.argv.indexOf('--port');f.server.listen(Number(process.env.PORT||(i>=0?process.argv[i+1]:5173)),'0.0.0.0');}
