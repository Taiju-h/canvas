const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const id='6'.repeat(32),imageId='offline-image',png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),source='/canvas/api.php?path='+encodeURIComponent(`/api/documents/${id}/images/${imageId}`);let sessionMode='normal',writes=0;
 let record={id,title:'通信なしで再起動',revision:1,updated_at:1,content:{version:1,grid:'none',snap:false,items:[],layers:[{id:'ink',name:'描画',visible:true,locked:false}],blocks:[],fixedNote:{html:'<p>端末で保持する本文</p><img alt="オフライン画像" src="'+source+'">',visible:true,locked:false},note:{category:'保存',tags:['原本']},attachments:[]}};
 const json=(res,value)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/canvas/api.php'){
  const api=url.searchParams.get('path');if(api==='/api/session'){if(sessionMode==='hang')return;if(sessionMode==='visitor')return json(res,{authenticated:false});return json(res,{authenticated:true,accountId:'offline-startup',csrfToken:'fixture'});}
  if(api==='/api/note-workspace')return json(res,{categories:['保存'],revision:1});if(api==='/api/notes-index')return json(res,{documents:[{id,title:record.title,revision:record.revision,updated_at:record.updated_at,note:record.content.note}],hasMore:false});
  if(api===`/api/documents/${id}/images/${imageId}`){res.writeHead(200,{'Content-Type':'image/png'});res.end(png);return;}
  if(api===`/api/documents/${id}`){if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks).toString());record={...record,...data,revision:record.revision+1};writes++;return json(res,{id,revision:record.revision});}return json(res,record);}return json(res,{});
 }
 const file=url.pathname==='/sw.js'?path.resolve('public/sw.js'):path.resolve('public/canvas',url.pathname.replace(/^\/(?:canvas\/)?/,'')||'index.html');
 if(!file.startsWith(path.resolve('public')+'/')){res.writeHead(403);res.end();return;}
 if(file.includes('/pdf-support/')){res.writeHead(404);res.end('optional missing font');return;}
 try{res.writeHead(200,{'Content-Type':file.endsWith('.js')||file.endsWith('.mjs')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')||file.endsWith('.webmanifest')?'application/json':'text/html'});res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(5196,'127.0.0.1',resolve));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'kaeru-offline-profile-'));let context,page;const errors=[];
 const launch=()=>chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,viewport:{width:1280,height:950},args:['--no-sandbox','--disable-dev-shm-usage']});
 const loadedImage=()=>page.getByAltText('オフライン画像',{exact:true}).evaluate(img=>img.complete&&img.naturalWidth===1&&img.src.startsWith('blob:'));
 const until=async fn=>{for(let i=0;i<160;i++){if(await fn())return;await page.waitForTimeout(50);}throw new Error('Expected persisted state was not reached');};
 try{
  context=await launch();page=context.pages()[0];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(16000);
  await page.goto('http://127.0.0.1:5196/canvas/');await page.getByLabel('固定ノート本文',{exact:true}).waitFor();await until(loadedImage);await page.waitForFunction(()=>document.documentElement.dataset.offlineReady==='true');
  assert.deepEqual(await page.evaluate(async()=>{const names=await caches.keys(),api=[];for(const n of names)for(const req of await(await caches.open(n)).keys())if(new URL(req.url).pathname.endsWith('.php'))api.push(req.url);return api;}),[],'private API responses are never shell-cached');
  console.log('online shell and image saved');await context.close();context=await launch();await context.setOffline(true);page=context.pages()[0];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(16000);
  await page.goto('http://127.0.0.1:5196/');const editor=page.getByLabel('固定ノート本文',{exact:true});await editor.waitFor();assert.match(await editor.innerText(),/端末で保持/);await until(loadedImage);
  await editor.locator('p').first().evaluate(p=>{p.textContent='再起動してオフライン編集';p.closest('[contenteditable]').dispatchEvent(new Event('input',{bubbles:true}));});
  await page.getByLabel('保存',{exact:true}).click();await until(()=>page.evaluate(async id=>{const db=await new Promise(resolve=>{const r=indexedDB.open('canvas-offline-v1',2);r.onsuccess=()=>resolve(r.result);});return new Promise(resolve=>{const q=db.transaction('documents').objectStore('documents').get(id);q.onsuccess=()=>resolve(q.result?.dirty&&q.result.content.fixedNote.html.includes('オフライン編集'));});},id));
  const localHTML=await page.evaluate(async id=>{const db=await new Promise(r=>{const q=indexedDB.open('canvas-offline-v1',2);q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=db.transaction('documents').objectStore('documents').get(id);q.onsuccess=()=>r(q.result.content.fixedNote.html);});},id);assert.ok(localHTML.includes(source));assert.ok(!localHTML.includes('blob:')&&!localHTML.includes('data-kn-offline-src'),'stable original image URL is persisted');
  await page.screenshot({path:'/tmp/kaeru-offline-startup.png'});await page.reload();await editor.waitFor();assert.match(await editor.innerText(),/再起動してオフライン編集/);await until(loadedImage);assert.equal(writes,0);
  await context.setOffline(false);await until(async()=>writes>0);assert.match(record.content.fixedNote.html,/再起動してオフライン編集/);assert.deepEqual(record.content.note,{category:'保存',tags:['原本']});
  console.log('offline cold restart and reconnect sync passed');sessionMode='hang';const started=Date.now();await page.reload();await editor.waitFor();assert.ok(Date.now()-started<9000,'unreachable session server has a bounded startup wait');assert.match(await editor.innerText(),/再起動してオフライン編集/);assert.ok(await page.locator('.kn-local-status').isVisible());
  console.log('hung session fallback passed');sessionMode='visitor';await page.getByRole('button',{name:'オンライン接続',exact:true}).click();await page.getByRole('button',{name:'端末に保存したノートを開く',exact:true}).click();await editor.waitFor();assert.match(await editor.innerText(),/再起動してオフライン編集/,'expired server login preserves local access');
  // An installed shell can also create a local-only notebook before its first login.
  await page.evaluate(()=>{localStorage.removeItem('canvasSessionCache');});await context.setOffline(true);await page.reload();await page.getByRole('button',{name:'この端末だけで使う',exact:true}).click();await editor.waitFor();await editor.fill('初回の端末専用ノート');await page.getByLabel('保存',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.notes-save-status')?.textContent?.includes('端末に保存'));
  await page.reload();await editor.waitFor();assert.match(await editor.innerText(),/初回の端末専用ノート/);assert.match(await page.locator('.kn-local-status').innerText(),/この端末に保存/);assert.deepEqual(errors,[]);
  console.log('PASS root and /canvas/ offline shell, missing optional fonts, browser restart, cached images and stable HTML, local edits and reconnect sync, bounded hung authentication, expired login and first-login-free local notebook');
 }catch(error){if(page)await page.screenshot({path:'/tmp/kaeru-offline-startup-failure.png'}).catch(()=>{});throw error;}finally{await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
