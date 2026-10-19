const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const id='d'.repeat(32),white='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';let puts=0;
 let record={id,title:'描画モード検証',revision:1,updated_at:1,content:{version:1,grid:'none',snap:false,items:[],layers:[{id:'ink',name:'手書き',visible:true,locked:false}],blocks:[],paintStrokes:[{id:'original',layerId:'ink',points:[{x:40,y:420},{x:150,y:420}],color:'#29435a',width:3,opacity:1,brush:'gpen',pressure:false}],fixedNote:{html:'<p>切り替えても残す日本語の本文</p><img alt="筆のテスト画像" src="data:image/png;base64,'+white+'" style="width:340px;height:220px">',visible:true,locked:false},note:{category:'絵',tags:['保持']},attachments:[{id:'original-file',name:'原本.txt',mime:'text/plain',size:3}]}};
 const original=structuredClone(record.content),json=(res,data)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
  if(url.pathname==='/canvas/api.php'){
   const api=url.searchParams.get('path');
   if(api==='/api/session')return json(res,{authenticated:true,accountId:'drawing-fixture',csrfToken:'fixture'});
   if(api==='/api/note-workspace')return json(res,{categories:['絵'],revision:1});
   if(api==='/api/notes-index')return json(res,{documents:[{id,title:record.title,revision:record.revision,updated_at:record.updated_at,note:record.content.note,excerpt:'本文',searchText:'本文'}],hasMore:false,nextOffset:1});
   if(api===`/api/documents/${id}`){if(req.method==='PUT'){puts++;record={...record,title:payload.title,content:payload.content,revision:record.revision+1,updated_at:Date.now()};return json(res,{id,revision:record.revision});}return json(res,record);}
   return json(res,{});
  }
  const rel=url.pathname.replace(/^\/(?:canvas\/)?/,'')||'index.html',file=path.resolve('public/canvas',rel);
  if(!file.startsWith(path.resolve('public/canvas')+'/')){res.writeHead(403);res.end();return;}
  try{res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html'});res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(5193,'127.0.0.1',resolve));
 let browser,page;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1400,height:1000},hasTouch:true});page=await context.newPage();page.setDefaultTimeout(14000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5193/canvas/');await page.waitForFunction(()=>document.querySelector('[aria-label="メモのタイトル"]')?.value==='描画モード検証');
  const body=page.getByLabel('固定ノート本文',{exact:true}),image=page.getByAltText('筆のテスト画像',{exact:true}),picker=page.getByRole('group',{name:'作業モード',exact:true});
  await image.evaluate(el=>el.decode());const html=await body.innerHTML(),noteId=new URL(page.url()).searchParams.get('d'),memoWidth=(await page.locator('.notes-stage-center').boundingBox()).width;
  assert.equal(await picker.getByRole('button',{name:'メモ帳',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.notes-sidebar').count(),1);
  await picker.getByRole('button',{name:'お絵かき',exact:true}).click();const toolbar=page.getByRole('toolbar',{name:'お絵かきツール',exact:true});await toolbar.waitFor();
  assert.equal(await page.locator('.notes-sidebar').count(),0);assert.equal(await page.locator('.notes-layer-panel').count(),0);assert.ok((await page.locator('.notes-stage-center').boundingBox()).width>memoWidth+400);
  assert.equal(await body.innerHTML(),html);assert.equal(new URL(page.url()).searchParams.get('d'),noteId);assert.equal(puts,0,'layout changes must not rewrite the Note');
  await page.getByLabel('お絵かきの筆圧',{exact:true}).uncheck();await page.getByLabel('描画ブラシ',{exact:true}).selectOption('brush');await page.getByLabel('お絵かきのペンの太さ',{exact:true}).fill('36');
  const pixelAt=async point=>{const bytes=await page.screenshot({clip:{x:Math.round(point.x),y:Math.round(point.y),width:1,height:1}});return page.evaluate(async data=>{const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+data)).blob()),c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);return Array.from(ctx.getImageData(0,0,1,1).data);},bytes.toString('base64'));};
  const draw=async offset=>{await image.scrollIntoViewIfNeeded();const b=await image.boundingBox();const start={x:Math.round(b.x+40),y:Math.round(b.y+offset)},end={x:Math.round(b.x+280),y:start.y};await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:24});return {start,end,mid:{x:Math.round(b.x+160),y:start.y}};};
  const brush=await draw(50);assert.ok((await pixelAt({x:brush.mid.x,y:brush.mid.y+12})).slice(0,3).every(c=>c<190),'the live brush has a broad center');await page.mouse.up();
  assert.ok((await pixelAt({x:brush.start.x+4,y:brush.start.y+12})).slice(0,3).every(c=>c>240),'brush entry tapers instead of drawing a uniform thick line');
  await page.getByLabel('描画ブラシ',{exact:true}).selectOption('airbrush');await page.getByLabel('お絵かきのペンの太さ',{exact:true}).fill('48');
  const air=await draw(130);await page.mouse.up();const center=await pixelAt(air.mid),edge=await pixelAt({x:air.mid.x,y:air.mid.y+20}),outside=await pixelAt({x:air.mid.x,y:air.mid.y+30});
  assert.ok(center[0]<210&&edge[0]>center[0]+15&&edge[0]<252&&outside[0]>248,'airbrush opacity fades toward its edge: '+JSON.stringify({center,edge,outside}));
  await page.screenshot({path:'/tmp/kaeru-drawing-brushes.png'});
  const airMark=page.locator('[data-stroke]').filter({has:page.locator('[data-ink-brush="airbrush"]')});const airId=await airMark.getAttribute('data-stroke');
  await toolbar.getByRole('button',{name:'消しゴム',exact:true}).click();const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:air.mid.x,y:air.mid.y-8,id:0,force:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:air.mid.x,y:air.mid.y+8,id:0,force:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.locator('[data-stroke="'+airId+'"]').waitFor({state:'detached'});assert.ok((await pixelAt(air.mid)).slice(0,3).every(c=>c>240),'eraser removes airbrush ink and preserves the white image');
  await page.getByLabel('お絵かきの元に戻す',{exact:true}).click();await page.locator('[data-stroke="'+airId+'"]').waitFor();
  await picker.getByRole('button',{name:'完全作業領域',exact:true}).click();await page.locator('.notes-stage.focus-mode').waitFor();
  const full=await page.locator('.notes-stage').boundingBox();assert.ok(full.x===0&&full.y===0&&full.width===1400&&full.height===1000,'full workspace occupies the viewport');
  await page.getByRole('button',{name:'描画設定を開閉',exact:true}).click();await page.getByLabel('集中表示のブラシ',{exact:true}).selectOption('brush');await page.getByRole('button',{name:'描画設定を開閉',exact:true}).click();
  const focused=await draw(185);await page.mouse.up();assert.ok((await pixelAt(focused.mid)).slice(0,3).every(c=>c<160));assert.equal(await body.innerHTML(),html);await page.screenshot({path:'/tmp/kaeru-drawing-focus.png'});
  await page.getByTitle('通常表示へ戻る',{exact:true}).click();await toolbar.waitFor();assert.equal(await page.locator('.notes-sidebar').count(),0);
  await picker.getByRole('button',{name:'メモ帳',exact:true}).click();assert.equal(await page.locator('.notes-sidebar').count(),1);assert.equal(await page.locator('.notes-layer-panel').count(),1);assert.equal(await body.getAttribute('contenteditable'),'true');assert.equal(await body.innerHTML(),html);
  const count=await page.locator('[data-stroke]').count();await page.getByTitle('元に戻す',{exact:true}).click();assert.equal(await page.locator('[data-stroke]').count(),count-1);await page.getByTitle('やり直す',{exact:true}).click();assert.equal(await page.locator('[data-stroke]').count(),count);
  await page.waitForFunction(()=>document.querySelector('.notes-save-status')?.textContent?.includes('保存済み'));
  assert.equal(record.content.fixedNote.html,original.fixedNote.html);assert.deepEqual(record.content.note,original.note);assert.deepEqual(record.content.attachments,original.attachments);assert.deepEqual(record.content.paintStrokes.find(s=>s.id==='original'),original.paintStrokes[0]);
  assert.ok(record.content.paintStrokes.some(s=>s.brush==='brush')&&record.content.paintStrokes.some(s=>s.brush==='airbrush'));
  const saved=structuredClone(record.content);await page.reload();await image.waitFor();await image.evaluate(el=>el.decode());assert.equal(await body.innerHTML(),html);assert.deepEqual(record.content,saved);
  await picker.getByRole('button',{name:'お絵かき',exact:true}).click();await page.reload();await toolbar.waitFor();assert.equal(await page.locator('.notes-sidebar').count(),0);assert.equal(await page.locator('[data-stroke]').count(),count);assert.equal(new URL(page.url()).searchParams.get('d'),noteId);
  await page.getByLabel('お絵かきのファイル一覧',{exact:true}).click();await page.locator('.notes-list-item').filter({hasText:'描画モード検証'}).click();await toolbar.waitFor();assert.equal(await body.innerHTML(),html);
  await picker.getByRole('button',{name:'メモ帳',exact:true}).click();await page.setViewportSize({width:390,height:844});
  if(await page.locator('.notes-sidebar').count())await page.getByLabel('メモ一覧を閉じる',{exact:true}).click();await picker.getByRole('button',{name:'お絵かき',exact:true}).tap();await toolbar.waitFor();
  const mobileToolbar=await toolbar.boundingBox(),mobileStage=await page.locator('.notes-stage-center').boundingBox();assert.ok(mobileToolbar.x>=0&&mobileToolbar.x+mobileToolbar.width<=391&&mobileStage.height>350);
  for(const control of await toolbar.locator('button,select,input').all()){
   await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391,'drawing controls remain reachable within the mobile width');
  }
  await page.screenshot({path:'/tmp/kaeru-drawing-mobile.png'});await picker.getByRole('button',{name:'完全作業領域',exact:true}).tap();await page.getByTitle('通常表示へ戻る',{exact:true}).tap();await toolbar.waitFor();
  assert.deepEqual(errors,[]);console.log('PASS three workspace modes, tapered brush and soft airbrush pixels, live previews, touch eraser/undo, preserved Note/files/legacy ink, reload and mobile layout');
 }catch(error){if(page)await page.screenshot({path:'/tmp/kaeru-drawing-failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
