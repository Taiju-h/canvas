const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');

(async()=>{
 const account='organizer-fixture',ids=['a','b','c','d'].map(c=>c.repeat(32)),imageId='e'.repeat(32);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 const original=Buffer.from('original attachment\n原本のまま\n');
 let available=true,pauseWrites=false,missingAsset=false,workspaceRevision=1;
 let categories=['仕事','仕事 / 開発','個人','整理先','空フォルダ'];const trace=[];
 const blank=(category,html)=>({version:1,items:[],layers:[{id:'drawing',name:'描画 1',visible:true,locked:false}],grid:'none',snap:false,blocks:[],paintStrokes:[],attachments:[],fixedNote:{html,visible:true,locked:false},note:{category,tags:[]}});
 const documents=new Map(ids.map((id,i)=>[id,{id,title:['資料A','資料B','個人メモ','ゴミ箱の資料'][i],revision:3,updated_at:Date.now()-i*1000,content:blank(['仕事 / 開発','仕事 / 開発','個人','個人'][i],'<p>元の本文'+i+'</p>')} ]));
 documents.get(ids[0]).content.attachments=[{id:'original-image',name:'原本画像.png',mime:'image/png',size:png.length}];
 documents.get(ids[0]).content.fixedNote.html+='<img src="/canvas/api.php?path='+encodeURIComponent('/api/documents/'+ids[0]+'/files/original-image')+'" data-kn-local-file="original-image">';
 documents.get(ids[0]).content.note={...documents.get(ids[0]).content.note,sourceId:'original-jex-note',sourceMarkdown:'取り込み元の本文',sourceNotebook:'取り込み元フォルダ',importState:'complete'};
 documents.get(ids[1]).content.layers[0].rasterImageId=imageId;
 documents.get(ids[1]).content.layers[0].rasterBounds={x:81,y:92,w:230,h:140};
 documents.get(ids[1]).content.items=[{id:'shape-fixture',kind:'rect',layerId:'drawing',keepLayer:true,x:150,y:200,w:300,h:80,color:'#123456',width:3,rotation:12}];
 documents.get(ids[3]).content.note.trashedAt='2026-10-10T00:00:00Z';
 documents.get(ids[3]).content.attachments=[{id:'original-text',name:'原本.txt',mime:'text/plain',size:original.length}];
 const preserved=new Map([...documents].map(([id,r])=>[id,structuredClone(r.content)]));
 const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),chunks=[];
  if(req.method==='POST'||req.method==='PUT')for await(const chunk of req)chunks.push(chunk);
  const bytes=Buffer.concat(chunks),body=bytes.toString(),payload=body.startsWith('{')?JSON.parse(body):{};
  if(url.pathname==='/canvas/api.php'){
   if(!available)return json(res,{error:'テスト用通信停止'},503);
   const api=url.searchParams.get('path');
   if(api==='/api/session')return json(res,{authenticated:true,accountId:account,csrfToken:'fixture'});
   if(api==='/api/notes-index'){
    const offset=Number(url.searchParams.get('offset')||0),all=[...documents.values()];
    const rows=all.slice(offset,offset+2).map(({content,...n})=>{const note={...content.note};delete note.sourceMarkdown;delete note.organizationLog;return {...n,note,excerpt:content.fixedNote.html.replace(/<[^>]*>/g,''),searchText:content.fixedNote.html.replace(/<[^>]*>/g,'')};});
    return json(res,{documents:rows,hasMore:offset+2<all.length,nextOffset:offset+rows.length});
   }
   if(api==='/api/note-workspace'){
    if(req.method==='POST'){
     trace.push(structuredClone(payload));
     if(payload.revision!==workspaceRevision)return json(res,{error:'分類更新の競合'},409);
     for(const u of payload.updates||[])if(documents.get(u.id)?.revision!==u.revision)return json(res,{error:'ノート更新の競合'},409);
     const changed=[];
     for(const u of payload.updates||[]){const r=documents.get(u.id),old=r.content.note;r.content.note={...old,category:u.category,tags:u.tags,organizationLog:[...(old.organizationLog||[]),{at:new Date().toISOString(),category:u.category,tags:u.tags}]};r.revision++;r.updated_at=Date.now();changed.push({id:r.id,revision:r.revision,updated_at:r.updated_at,note:r.content.note});}
     categories=payload.categories;workspaceRevision++;return json(res,{categories,revision:workspaceRevision,changed});
    }return json(res,{categories,revision:workspaceRevision});
   }
   const fileMatch=/^\/api\/documents\/([a-f0-9]{32})\/files\/([a-z0-9-]+)$/.exec(api||'');
   if(fileMatch){if(missingAsset)return json(res,{error:'fixture missing original'},404);const image=fileMatch[2]==='original-image';res.writeHead(200,{'Content-Type':image?'image/png':'text/plain'});res.end(image?png:original);return;}
   const imageMatch=/^\/api\/documents\/([a-f0-9]{32})\/images\/([a-f0-9]{32})$/.exec(api||'');
   if(imageMatch){res.writeHead(200,{'Content-Type':'image/png'});res.end(png);return;}
   const match=/^\/api\/documents\/([a-f0-9]{32})$/.exec(api||'');
   if(match){const r=documents.get(match[1]);if(!r)return json(res,{error:'not found'},404);
    if(req.method==='PUT'){if(pauseWrites)return json(res,{error:'fixture delayed body save'},503);if(payload.revision!==r.revision)return json(res,{error:'revision conflict'},409);r.content=payload.content;r.title=payload.title;r.revision++;r.updated_at=Date.now();return json(res,{id:r.id,revision:r.revision});}return json(res,r);
   }return json(res,{configured:false});
  }
  const relative=url.pathname.startsWith('/canvas/')?url.pathname.slice(8):url.pathname.slice(1),file=path.resolve('public/canvas',relative||'index.html');
  if(!file.startsWith(path.resolve('public/canvas')+'/')){res.writeHead(403);res.end();return;}
  try{const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.wasm')?'application/wasm':'text/html','Cache-Control':'no-cache'});res.end(data);}catch{res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(5188,'127.0.0.1',r));
 let browser,page;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1280,height:950},acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(18000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>localStorage.getItem('organizer-fixture-offline')!=='on'});});
  await page.goto('http://127.0.0.1:5188/canvas/?d='+ids[0]);await page.getByRole('textbox',{name:'固定ノート本文'}).waitFor();
  const sourceURL=page.url(),downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'原本画像.pngの原本を保存',exact:true}).click();
  const savedOriginal=await downloadEvent;assert.equal(savedOriginal.suggestedFilename(),'原本画像.png');assert.deepEqual(fs.readFileSync(await savedOriginal.path()),png);
  assert.equal(page.url(),sourceURL);assert.equal(context.pages().length,1,'attachment downloads keep the editor and do not open a popup');assert.match(await page.locator('.notes-attachments').innerText(),/バイト/);assert.doesNotMatch(await page.locator('.notes-attachments').innerText(),/0\.0MB/);
  const openOrganizer=async()=>{const closed=await page.locator('.notes-organizer').count()===0;if(closed)await page.getByRole('button',{name:'ページ・フォルダを整理',exact:true}).click();await page.getByRole('heading',{name:'ページ・フォルダ整理',exact:true}).waitFor();};
  const organizer=page.locator('.notes-organizer'),table=page.locator('.notes-organizer-table');
  const selected=(title)=>table.getByRole('checkbox',{name:title+'を選択',exact:true});
  const pending=async()=>page.evaluate(account=>JSON.parse(localStorage.getItem('kaerunote-workspace-offline-v2:'+account)||'{}').pending?.length||0,account);
  const cleanDocs=async()=>page.waitForFunction(async account=>{const db=await new Promise(r=>{const q=indexedDB.open('canvas-offline-v1',2);q.onsuccess=()=>r(q.result);});const all=await new Promise(r=>{const q=db.transaction('documents').objectStore('documents').getAll();q.onsuccess=()=>r(q.result);});db.close();return all.filter(n=>n.accountId===account).every(n=>!n.dirty);},account);
  const settled=async()=>{await page.waitForFunction(account=>JSON.parse(localStorage.getItem('kaerunote-workspace-offline-v2:'+account)||'{}').pending?.length===0&&document.querySelector('.notes-organizer-bulk')?.textContent.includes('分類：同期完了')&&!document.querySelector('.notes-organizer-header button')?.disabled&&!document.querySelector('.notes-app>.notes-modal'),account);await cleanDocs();};
  await openOrganizer();assert.equal(new URL(page.url()).searchParams.get('view'),'organize');assert.equal(await table.locator('tbody tr').count(),3,'the index loads all pagination but hides trash');
  await selected('資料A').check();await selected('資料B').check();await page.getByLabel('選択ページの移動先',{exact:true}).selectOption('整理先');await page.getByRole('button',{name:'選択ページを移動',exact:true}).click();await settled();
  assert.deepEqual(trace[0].updates.map(u=>u.id).sort(),ids.slice(0,2).sort(),'bulk selection updates only those two pages');
  for(const id of ids.slice(0,2)){const r=documents.get(id),old=preserved.get(id);assert.equal(r.content.note.category,'整理先');assert.equal(r.content.fixedNote.html,old.fixedNote.html);assert.deepEqual(r.content.items,old.items);assert.deepEqual(r.content.layers.filter(l=>l.id==='drawing'),old.layers);assert.deepEqual(r.content.attachments,old.attachments);}
  assert.equal(documents.get(ids[0]).content.note.sourceId,'original-jex-note');assert.equal(documents.get(ids[2]).content.note.category,'個人');
  await selected('資料A').check();await page.getByLabel('選択ページのタグ',{exact:true}).fill('確認');await page.getByRole('button',{name:'タグを追加',exact:true}).click();await settled();assert.ok(documents.get(ids[0]).content.note.tags.includes('確認'));assert.deepEqual(documents.get(ids[1]).content.note.tags,[]);
  const beforeNoop=trace.length,revisionNoop=documents.get(ids[0]).revision;await selected('資料A').check();await page.getByRole('button',{name:'タグを追加',exact:true}).click();await page.getByText('選択したページはすでに指定の分類です。',{exact:true}).waitFor();assert.equal(trace.length,beforeNoop);assert.equal(documents.get(ids[0]).revision,revisionNoop,'a no-op does not reorder the note');
  await page.getByRole('button',{name:'整理画面でフォルダを追加',exact:true}).click();await page.getByLabel('新しいカテゴリ名',{exact:true}).fill('新しい空フォルダ');await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();await settled();assert.ok(categories.includes('新しい空フォルダ'));
  await organizer.getByTitle('新しい空フォルダ',{exact:true}).click();await organizer.getByRole('button',{name:'名前変更・移動',exact:true}).click();await page.getByLabel('新しいカテゴリ名',{exact:true}).fill('名前変更済み');await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();await settled();assert.ok(categories.includes('名前変更済み'));assert.ok(!categories.includes('新しい空フォルダ'));
  await organizer.getByTitle('名前変更済み',{exact:true}).click();await organizer.getByRole('button',{name:'フォルダを削除',exact:true}).click();await page.getByRole('button',{name:'カテゴリを削除（ノートは保持）',exact:true}).click();await settled();assert.ok(!categories.includes('名前変更済み'));assert.equal(documents.size,4);
  await organizer.getByRole('button',{name:/すべてのページ/}).click();await page.screenshot({path:'/tmp/kaeru-organizer-desktop.png'});
  // A failed second write must abort the whole IndexedDB transaction and allow retry.
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restoreOrganizerPut=()=>{IDBObjectStore.prototype.put=put;};let writes=0;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='documents'&&value.content?.note?.category==='空フォルダ'&&++writes===2)throw new DOMException('fixture quota','QuotaExceededError');return put.call(this,value,...args);};});
  await selected('資料A').check();await selected('資料B').check();await page.getByLabel('選択ページの移動先',{exact:true}).selectOption('空フォルダ');await page.getByRole('button',{name:'選択ページを移動',exact:true}).click();await organizer.getByRole('alert').filter({hasText:'端末へ一括保存できません'}).waitFor();assert.equal(await pending(),0);assert.equal(documents.get(ids[0]).content.note.category,'整理先');assert.equal(documents.get(ids[1]).content.note.category,'整理先');
  const localCategories=await page.evaluate(async ids=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('canvas-offline-v1',2);q.onsuccess=()=>r(q.result);q.onerror=j;});return Promise.all(ids.map(id=>new Promise(r=>{const q=db.transaction('documents').objectStore('documents').get(id);q.onsuccess=()=>r(q.result.content.note.category);})));},ids.slice(0,2));assert.deepEqual(localCategories,['整理先','整理先']);
  await page.evaluate(()=>window.restoreOrganizerPut());await page.getByRole('button',{name:'選択ページを移動',exact:true}).click();await settled();assert.equal(documents.get(ids[0]).content.note.category,'空フォルダ');
  // Keep a real unsynced text draft while online so export must prefer it over the server.
  await table.getByRole('button',{name:'資料A',exact:true}).click();pauseWrites=true;
  await page.getByRole('textbox',{name:'固定ノート本文'}).fill('サーバー未送信の本文');await page.waitForTimeout(1000);await openOrganizer();
  await page.getByRole('button',{name:'データを取り出す',exact:true}).click();await page.getByRole('heading',{name:'自分のデータを取り出す'}).waitFor();await page.screenshot({path:'/tmp/kaeru-organizer-data.png'});
  const zipEvent=page.waitForEvent('download');await page.getByRole('button',{name:/全4ページ・画像・添付をZIPで保存/}).click();const zipDownload=await zipEvent;assert.match(zipDownload.suggestedFilename(),/\.zip$/);
  const zipPath=await zipDownload.path();
  const extracted=JSON.parse(execFileSync('python3',['-c',`import sys,zipfile,json,base64
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 manifest=json.loads(z.read('manifest.json'))
 pages={p['id']:json.loads(z.read(p['path']+'/note.json')) for p in manifest['pages']}
 originals=[base64.b64encode(z.read(p['path']+'/'+a['path'])).decode() for p in manifest['pages'] for a in p['assets']]
 html=[z.read(p['path']+'/index.html').decode() for p in manifest['pages']]
 print(json.dumps({'manifest':manifest,'pages':pages,'originals':originals,'folders':json.loads(z.read('folders.json')),'html':html}))`,zipPath],{encoding:'utf8'}));
  assert.equal(extracted.manifest.pageCount,4);assert.equal(extracted.manifest.fileCount,3);assert.ok(extracted.folders.categories.includes('空フォルダ'));assert.ok(extracted.manifest.pages.some(p=>p.trashed));
  assert.match(extracted.pages[ids[0]].content.fixedNote.html,/サーバー未送信の本文/);assert.equal(extracted.pages[ids[0]].dirty,true);assert.doesNotMatch(documents.get(ids[0]).content.fixedNote.html,/サーバー未送信の本文/);assert.ok(extracted.originals.includes(png.toString('base64')));assert.ok(extracted.originals.includes(original.toString('base64')));assert.deepEqual(extracted.pages[ids[1]].content.items,preserved.get(ids[1]).items);assert.equal(extracted.pages[ids[0]].content.note.sourceMarkdown,'取り込み元の本文');assert.ok(!Object.hasOwn(extracted.pages[ids[0]],'accountId'));assert.ok(!JSON.stringify(extracted.pages).includes('csrfToken'));
  // Missing uncached original files must stop export and must not offer a partial ZIP.
  missingAsset=true;let unexpectedDownload=false;const onDownload=()=>{unexpectedDownload=true;};page.on('download',onDownload);await page.getByRole('button',{name:/全4ページ・画像・添付をZIPで保存/}).click();await page.locator('.notes-organizer-data').getByRole('alert').filter({hasText:'取得できません（404）'}).waitFor();assert.equal(unexpectedDownload,false);page.off('download',onDownload);missingAsset=false;
  await page.getByRole('button',{name:'データの取り出しを閉じる',exact:true}).click();pauseWrites=false;
  await page.evaluate(()=>dispatchEvent(new Event('online')));await cleanDocs();await page.waitForFunction(text=>document.querySelector('.notes-organizer-table')?.textContent.includes(text),'サーバー未送信の本文');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/kaeru-organizer-mobile.png'});
  const bounds=await organizer.boundingBox();assert.equal(Math.round(bounds.width),390);const mainHeader=await page.getByRole('button',{name:'データを取り出す',exact:true}).boundingBox();assert.ok(mainHeader.x>=0&&mainHeader.x+mainHeader.width<=391,'the mobile export entry is visible');
  await page.getByRole('button',{name:'データを取り出す',exact:true}).click();const dataBounds=await page.locator('.notes-organizer-data').boundingBox();assert.ok(dataBounds.x>=0&&dataBounds.x+dataBounds.width<=391&&dataBounds.y>=0&&dataBounds.y+dataBounds.height<=845);await page.getByRole('button',{name:'データの取り出しを閉じる',exact:true}).click();
  // Persist an offline selected-page move through reload, then detect a concurrent remote move.
  await page.setViewportSize({width:1280,height:950});await page.evaluate(()=>localStorage.setItem('organizer-fixture-offline','on'));available=false;
  await selected('資料A').check();await page.getByLabel('選択ページの移動先',{exact:true}).selectOption('整理先');await page.getByRole('button',{name:'選択ページを移動',exact:true}).click();await page.getByText(/1ページのフォルダを端末に保存しました/).waitFor();assert.equal(await pending(),1);
  await page.reload();await page.getByRole('heading',{name:'ページ・フォルダ整理'}).waitFor();await table.getByRole('button',{name:'資料A',exact:true}).waitFor();assert.equal(await pending(),1);assert.match(await table.locator('tr').filter({hasText:'資料A'}).innerText(),/整理先/);
  const remote=documents.get(ids[0]);remote.content.note.category='他端末';remote.revision++;categories.push('他端末');workspaceRevision++;const writesBeforeConflict=trace.length;
  available=true;await page.evaluate(()=>{localStorage.removeItem('organizer-fixture-offline');dispatchEvent(new Event('online'));});await page.locator('.notes-organizer-conflict').waitFor();assert.equal(trace.length,writesBeforeConflict,'unreviewed concurrent remote classification is never overwritten');assert.equal(remote.content.note.category,'他端末');
  await page.getByRole('button',{name:'サーバーの分類を採用',exact:true}).click();await settled();assert.equal(documents.get(ids[0]).content.note.category,'他端末');assert.match(documents.get(ids[0]).content.fixedNote.html,/サーバー未送信の本文/);assert.equal(await page.locator('.notes-organizer-conflict').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS original download, selected metadata-only moves/tags/folders, no-op preservation, atomic quota failure/retry, complete ZIP with dirty drafts/trash/originals, missing asset failure, mobile layout, offline restart/conflict resolution');
 }catch(error){if(page)await page.screenshot({path:'/tmp/kaeru-organizer-failed.png'}).catch(()=>{});throw error;}
 finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exit(1);});
