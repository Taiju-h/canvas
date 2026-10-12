const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const ids=['1'.repeat(32),'2'.repeat(32),'3'.repeat(32)];let counter=10,available=true,workspaceRevision=1;
 let categories=['仕事 / 開発 / KaeruNote','仕事 / 開発 / KaeruNote / 子','空カテゴリ'];
 const blank=(category,html)=>({version:1,items:[],layers:[{id:'drawing',name:'描画 1',visible:true,locked:false}],grid:'none',snap:false,blocks:[],paintStrokes:[],attachments:[],fixedNote:{html,visible:true,locked:false},note:{category,tags:[]}});
 const documents=new Map(ids.map((id,i)=>[id,{id,title:['既存ノートA','既存ノートB','子カテゴリのノート'][i],revision:3,updated_at:100-i,content:blank(i===2?categories[1]:categories[0],'<p>元の本文'+i+'</p>')} ]));
 const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  let body='';if(req.method==='POST'||req.method==='PUT')for await(const chunk of req)body+=chunk;
  const payload=body?JSON.parse(body):{};
  if(url.pathname==='/__fixture/control'){
   if('available' in payload)available=payload.available;
   if(payload.moveRemote){const r=documents.get(ids[0]);r.content.note.category='他端末';r.revision++;categories.push('他端末');workspaceRevision++;}
   return json(res,{categories,documents:[...documents.values()]});
  }
  if(url.pathname==='/canvas/api.php'){
   if(!available)return json(res,{error:'テスト用の通信停止'},503);
   const api=url.searchParams.get('path');
   if(api==='/api/session')return json(res,{authenticated:true,accountId:'workspace-fixture',csrfToken:'fixture'});
   if(api==='/api/notes-index')return json(res,{documents:[...documents.values()].map(({content,...n})=>({...n,note:content.note,excerpt:content.fixedNote.html,searchText:content.fixedNote.html})),hasMore:false,nextOffset:documents.size});
   if(api==='/api/note-workspace'){
    if(req.method==='POST'){
     if(payload.revision!==workspaceRevision)return json(res,{error:'分類更新の競合'},409);
     for(const u of payload.updates||[])if(documents.get(u.id)?.revision!==u.revision)return json(res,{error:'ノート更新の競合'},409);
     const changed=[];for(const u of payload.updates||[]){const r=documents.get(u.id);r.content.note={...r.content.note,category:u.category,tags:u.tags};r.revision++;r.updated_at=Date.now();changed.push({id:r.id,revision:r.revision,updated_at:r.updated_at,note:r.content.note});}
     categories=payload.categories;workspaceRevision++;return json(res,{categories,revision:workspaceRevision,changed});
    }return json(res,{categories,revision:workspaceRevision});
   }
   if(api==='/api/documents'&&req.method==='POST'){const id=(counter++).toString(16).padStart(32,'0');documents.set(id,{id,title:payload.title,content:payload.content,revision:1,updated_at:Date.now()});return json(res,{id,revision:1});}
   const match=/^\/api\/documents\/([a-f0-9]{32})$/.exec(api||'');
   if(match){const r=documents.get(match[1]);if(!r)return json(res,{error:'not found'},404);if(req.method==='PUT'){if(payload.revision!==r.revision)return json(res,{error:'revision conflict'},409);r.content=payload.content;r.title=payload.title;r.revision++;r.updated_at=Date.now();return json(res,{id:r.id,revision:r.revision});}return json(res,r);}
   return json(res,{configured:false,documents:[]});
  }
  const relative=url.pathname.startsWith('/canvas/')?url.pathname.slice(8):url.pathname.slice(1);
  const file=path.resolve('public/canvas',relative||'index.html');
  if(!file.startsWith(path.resolve('public/canvas')+'/')){res.writeHead(403);res.end();return;}
  try{const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.svg')?'image/svg+xml':'text/html','Cache-Control':'no-cache'});res.end(data);}catch{res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(5187,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1280,height:950}});const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5187/canvas/');await page.getByLabel('メモのタイトル',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="メモのタイトル"]').value==='既存ノートA');
  const pick=async category=>{await page.locator('[data-category-path='+JSON.stringify(category)+']').click();await page.mouse.move(900,40);};
  for(const category of ['仕事','仕事 / 開発','仕事 / 開発 / KaeruNote']){await pick(category);assert.equal(await page.locator('.notes-sidebar').count(),1,'category must not close sidebar');}
  assert.equal(await page.locator('.notes-list-item').count(),3);
  await page.getByLabel('子カテゴリを含める',{exact:true}).uncheck();assert.equal(await page.locator('.notes-list-item').count(),2);
  await page.locator('.notes-fixed-editor').fill('切り替え前の日本語本文');
  await page.locator('.notes-list-item').filter({hasText:'既存ノートB'}).click();await page.waitForFunction(()=>!document.querySelector('.notes-sidebar'));
  await page.getByLabel('メモ一覧を開く',{exact:true}).click();await page.locator('.notes-list-item').filter({hasText:'既存ノートA'}).click();await page.waitForFunction(()=>document.querySelector('.notes-fixed-editor').textContent.includes('切り替え前'));
  await page.getByLabel('ノートの詳細',{exact:true}).click();assert.equal(await page.getByRole('region',{name:'ノート詳細ツール'}).count(),1);
  assert.equal(await page.locator('.notes-toolbar .notes-advanced-format').count(),0,'advanced tools are outside basic ribbon');
  await page.locator('.notes-fixed-editor').fill('書式選択を維持');await page.locator('.notes-fixed-editor').evaluate(el=>{el.focus();const r=document.createRange();r.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(r);});
  await page.getByLabel('ノートの詳細',{exact:true}).click();await page.getByLabel('ノートの詳細',{exact:true}).click();assert.equal(await page.evaluate(()=>getSelection().toString()),'書式選択を維持');
  await page.getByTitle('上付き',{exact:true}).click();assert.ok(await page.locator('.notes-fixed-editor sup').count());
  await page.getByTitle('キャンバスレイヤー',{exact:true}).click();await page.getByLabel('Canvasの詳細',{exact:true}).click();assert.equal(await page.getByRole('region',{name:'Canvas詳細ツール'}).count(),1);
  await page.getByLabel('グリッド種類').selectOption('square');await page.getByLabel('グリッド間隔').fill('40');assert.ok((await page.locator('.notes-plane').getAttribute('style')).includes('40px 40px'));
  await page.getByLabel('レイヤー不透明度').fill('60');
  await page.getByLabel('メモ一覧を開く',{exact:true}).click();await pick('空カテゴリ');assert.equal(await page.locator('.notes-list-item').count(),0);
  await page.waitForFunction(()=>navigator.serviceWorker.controller);await context.setOffline(true);await page.getByRole('button',{name:'＋ このカテゴリに新規ノート',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.classList.contains('notes-fixed-editor'));
  await page.locator('.notes-fixed-editor').fill('オフライン新規本文');await page.waitForTimeout(900);
  assert.equal(await page.locator('.notes-sidebar').count(),0);
  const cached=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('canvas-offline-v1',2);r.onsuccess=()=>{const tx=r.result.transaction('documents');const q=tx.objectStore('documents').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);};}));
  assert.ok(cached.some(n=>n.content.note.category==='空カテゴリ'&&n.content.fixedNote.html.includes('オフライン新規本文')));
  // An offline restart uses the service worker's cached shell and IndexedDB draft.
  await page.waitForFunction(()=>navigator.serviceWorker.controller);await page.reload();await page.waitForFunction(()=>document.querySelector('.notes-fixed-editor')?.textContent.includes('オフライン新規本文'));
  assert.equal(await page.getByLabel('ノートの詳細').getAttribute('aria-expanded'),'true');
  // No network is needed to switch cached notes or create categories.
  await page.getByLabel('メモ一覧を開く',{exact:true}).click();await page.getByRole('button',{name:'カテゴリを管理',exact:true}).click();
  await page.getByLabel('カテゴリの操作').selectOption('move');await page.getByLabel('対象カテゴリ',{exact:true}).selectOption('仕事 / 開発 / KaeruNote');await page.getByLabel('新しいカテゴリ名',{exact:true}).fill('復旧テスト');await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();
  const pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('kaerunote-workspace-offline-v2:workspace-fixture')));assert.equal(pending.pending.length,1);assert.ok(pending.baseNotes.length);
  // Competing remote metadata becomes a persistent choice, never a reload instruction.
  const remoteNote=documents.get(ids[0]);remoteNote.content.note.category='他端末';remoteNote.revision++;categories.push('他端末');workspaceRevision++;await context.setOffline(false);await page.reload();
  await page.getByRole('button',{name:'端末の分類操作を採用',exact:true}).waitFor();assert.ok(await page.locator('.kn-conflict-diffs').innerText().then(t=>t.includes('他端末')));
  await page.getByRole('button',{name:'端末の分類操作を採用',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kaerunote-workspace-offline-v2:workspace-fixture')).pending.length===0);
  await page.waitForTimeout(900);const result=await page.evaluate(()=>fetch('/__fixture/control',{method:'POST',body:'{}'}).then(r=>r.json()));
  assert.ok(result.documents.some(n=>n.content.fixedNote.html.includes('書式選択を維持')&&n.content.note.category.includes('復旧テスト')));
  await page.screenshot({path:'/tmp/kaeru-workspace-desktop.png'});
  // Mobile auto-close OFF is honored even when opening/creating a note.
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mp=await mobile.newPage();mp.setDefaultTimeout(12000);
  await mp.addInitScript(()=>{localStorage.setItem('kn-sidebar-autoclose','off');localStorage.setItem('kn-note-details','open');});
  await mp.goto('http://127.0.0.1:5187/canvas/');await mp.getByLabel('メモ一覧を開く',{exact:true}).click();await mp.locator('.notes-list-item').first().click();assert.equal(await mp.locator('.notes-sidebar').count(),1);
  await mp.getByRole('button',{name:'＋ このカテゴリに新規ノート',exact:true}).click();assert.equal(await mp.locator('.notes-sidebar').count(),1);
  await mp.getByLabel('サイドバーを閉じる',{exact:true}).click();await mp.getByLabel('ノートの詳細',{exact:true}).waitFor();
  const bounds=await mp.getByLabel('ノートの詳細',{exact:true}).boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391,'detail button within mobile width');
  await mp.screenshot({path:'/tmp/kaeru-workspace-mobile.png'});
  assert.deepEqual(errors,[]);console.log('Workspace desktop, touch, offline restart, draft preservation, category conflict and details checks passed');
 }catch(error){console.error(error);throw error;}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(()=>process.exit(1));
