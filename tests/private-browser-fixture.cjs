const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
// Synthetic UI-only fixture. Real authentication is covered by private-access-api.mjs.
function createFixture(){
  const owner='a'.repeat(32),id='c'.repeat(32),csrf='synthetic-private-csrf';
  const fixture={mode:'private',allowWrites:true,writes:0,deviceReads:0,devices:new Map(),codes:new Set(['11111111222222223333333344444444']),record:{id,title:'個人用テストノート',revision:1,updated_at:1,content:{version:1,grid:'none',snap:false,items:[],layers:[{id:'ink',name:'描画',visible:true,locked:false}],blocks:[],fixedNote:{html:'<p>本人の端末で読むテスト本文</p>',visible:true,locked:false},note:{category:'個人',tags:[]},attachments:[]}}};
  const normalize=value=>String(value||'').replace(/[\s-]/g,'').toUpperCase();
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://localhost');
    const json=(data,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
    if(url.pathname==='/canvas/api.php'){
      const api=url.searchParams.get('path'),token=(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith('__Secure-kn_device='))?.split('=')[1];
      const device=fixture.devices.get(token),authorized=!!device&&!device.revokedAt;
      const old=/KaeruNoteAndroid\/0\.4\.[0-5](?:\D|$)/.test(req.headers['user-agent']||'');
      const session=()=>fixture.mode==='public'?{authenticated:true,accountId:'legacy',csrfToken:csrf}:{authenticated:authorized&&!old,privateAccess:true,deviceAuthorized:authorized&&!old,accountId:authorized&&!old?owner:null,deviceId:authorized&&!old?device.id:null,deviceName:authorized&&!old?device.name:null,csrfToken:csrf,upgradeRequired:old,minimumAndroidVersion:'0.4.6'};
      if(api==='/api/session')return json(session());
      let body={};if(req.method==='POST'||req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}
      if(api==='/api/private/activate'&&req.method==='POST'){
        if(old)return json({error:'新しいAndroidアプリへ更新してください',privateAccess:true},426);
        if(req.headers['x-csrf-token']!==csrf)return json({error:'登録画面を再読み込みしてください'},403);
        const code=normalize(body.code);if(!fixture.codes.has(code))return json({error:'登録コードが違うか、使用済み・期限切れです',privateAccess:true},400);
        fixture.codes.delete(code);const secret=randomBytes(32).toString('hex'),entry={id:randomBytes(16).toString('hex'),name:body.name,createdAt:Date.now(),expiresAt:Date.now()+86400000,revokedAt:null};fixture.devices.set(secret,entry);
        return json({authenticated:true,privateAccess:true,deviceAuthorized:true,accountId:owner,deviceId:entry.id,deviceName:entry.name,csrfToken:csrf},200,{'Set-Cookie':`__Secure-kn_device=${secret}; Path=/canvas/; Max-Age=86400; Secure; HttpOnly; SameSite=Strict`});
      }
      if(!authorized||old)return json({error:'この端末は未登録です',privateAccess:true,deviceAuthorized:false},401);
      if(api==='/api/private/devices'){
        if(req.method==='GET')return json({devices:[...fixture.devices.values()].map(d=>({...d,current:d.id===device.id}))});
        if(body.action==='invite'){const code=randomBytes(16).toString('hex').toUpperCase();fixture.codes.add(code);return json({code:code.match(/.{8}/g).join('-'),expiresInMinutes:15});}
        if(body.action==='revoke'){const d=[...fixture.devices.values()].find(d=>d.id===body.id);d.revokedAt=Date.now();return json({currentRevoked:d.id===device.id});}
      }
      if(api==='/api/note-workspace')return json({categories:['個人'],revision:1});
      if(api==='/api/notes-index')return json({documents:[{id,title:fixture.record.title,revision:fixture.record.revision,updated_at:fixture.record.updated_at,note:fixture.record.content.note}],hasMore:false});
      if(api==='/api/documents')return json({documents:[fixture.record]});
      if(api===`/api/documents/${id}`){fixture.deviceReads++;if(req.method==='PUT'){if(!fixture.allowWrites)return json({error:'synthetic write outage'},503);fixture.record={...fixture.record,...body,revision:fixture.record.revision+1};fixture.writes++;return json({id,revision:fixture.record.revision});}return json(fixture.record);}
      return json({});
    }
    const root=path.resolve(__dirname,'../public/canvas'),file=url.pathname==='/sw.js'?path.resolve(__dirname,'../public/sw.js'):path.resolve(root,decodeURIComponent(url.pathname).replace(/^\/(?:canvas\/)?/,'')||'index.html');
    if(file!==path.resolve(__dirname,'../public/sw.js')&&!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
    const ext=path.extname(file),mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.woff2':'font/woff2'}[ext]||'text/html';
    try{res.writeHead(200,{'Content-Type':mime});res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
  }catch(e){console.error(e);res.writeHead(500);res.end('Synthetic fixture failed');}});
  return {...fixture,server,fixture};
}
module.exports={createFixture};
if(require.main===module){const {server}=createFixture();const i=process.argv.indexOf('--port');server.listen(Number(process.env.PORT||(i>=0?process.argv[i+1]:5173)),'0.0.0.0',()=>console.log('Synthetic private-device preview ready'));}
