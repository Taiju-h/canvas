const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const id='e'.repeat(32),white='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';let puts=0;
 let record={id,title:'Canvasツール検証',revision:1,updated_at:1,content:{version:1,grid:'none',snap:false,items:[],layers:[{id:'ink',name:'手書き',visible:true,locked:false}],blocks:[],paintStrokes:[{id:'original',layerId:'ink',points:[{x:40,y:420},{x:150,y:420}],color:'#29435a',width:3,opacity:1,brush:'gpen',pressure:false}],fixedNote:{html:'<p>切り替えても残す日本語の本文</p><img alt="筆のテスト画像" src="data:image/png;base64,'+white+'" style="width:340px;height:220px">',visible:true,locked:false},note:{category:'絵',tags:['保持']},attachments:[{id:'original-file',name:'原本.txt',mime:'text/plain',size:3}]}};
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
 });await new Promise(resolve=>server.listen(5194,'127.0.0.1',resolve));
 let browser,page;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1400,height:1050},hasTouch:true});page=await context.newPage();page.setDefaultTimeout(14000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5194/canvas/');await page.waitForFunction(()=>document.querySelector('[aria-label="メモのタイトル"]')?.value==='Canvasツール検証');
  const body=page.getByLabel('固定ノート本文',{exact:true}),image=page.getByAltText('筆のテスト画像',{exact:true});await image.evaluate(i=>i.decode());const html=await body.innerHTML();
  const dock=page.getByRole('complementary',{name:'右上のレイヤーとプロパティ',exact:true}),dockBox=await dock.boundingBox(),properties=await dock.getByRole('button',{name:'プロパティ',exact:true}).boundingBox(),list=await dock.locator('.notes-layer-panel').boundingBox();
  assert.equal(dockBox.x+dockBox.width,1400);assert.equal(dockBox.y,44);assert.ok(list.y>=properties.y+properties.height,'layers start at the upper right below properties and save');
  await page.getByRole('group',{name:'作業モード',exact:true}).getByRole('button',{name:'お絵かき',exact:true}).click();
  const toolbar=page.getByRole('toolbar',{name:'お絵かきツール',exact:true});await toolbar.waitFor();
  assert.equal(await toolbar.getByRole('group',{name:'枠と図形',exact:true}).count(),0);for(const name of ['筆','鉛筆','Gペン','エアブラシ'])assert.ok(await toolbar.getByRole('button',{name,exact:true}).isVisible());
  const details=await page.getByLabel('お絵かきの詳細',{exact:true}).boundingBox(),ribbon=await page.locator('.notes-drawing-ribbon').boundingBox();assert.ok(Math.abs(details.x+details.width-(ribbon.x+ribbon.width-8))<2&&Math.abs(details.y+details.height-(ribbon.y+ribbon.height-6))<2,'details stays at toolbar bottom right');
  await toolbar.getByRole('button',{name:'Gペン',exact:true}).click();await page.getByLabel('お絵かきの筆圧',{exact:true}).uncheck();await page.getByLabel('お絵かきのペンの太さ',{exact:true}).fill('12');
  await image.scrollIntoViewIfNeeded();let b=await image.boundingBox(),left={x:b.x+30,y:b.y+70},right={x:b.x+300,y:b.y+70},mid={x:b.x+160,y:b.y+70};
  const refresh=async()=>{b=await image.boundingBox();left={x:b.x+30,y:b.y+70};right={x:b.x+300,y:b.y+70};mid={x:b.x+160,y:b.y+70};};
  const pixel=async p=>{const bytes=await page.screenshot({clip:{x:Math.round(p.x),y:Math.round(p.y),width:1,height:1}});return page.evaluate(async base64=>{const img=await createImageBitmap(await(await fetch('data:image/png;base64,'+base64)).blob()),c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(0,0,1,1).data);},bytes.toString('base64'));};
  const dark=async p=>(await pixel(p)).slice(0,3).every(c=>c<150),white=async p=>(await pixel(p)).slice(0,3).every(c=>c>240);
  await page.mouse.move(left.x,left.y);await page.mouse.down();await page.mouse.move(right.x,right.y,{steps:24});await page.mouse.up();assert.ok(await dark(mid));const line=await page.locator('[data-stroke]').last().getAttribute('data-stroke');
  await toolbar.getByRole('button',{name:'消しゴム',exact:true}).click();const type=toolbar.getByLabel('消しゴムの種類',{exact:true});assert.equal(await type.inputValue(),'circle');await toolbar.getByLabel('消しゴムの大きさ',{exact:true}).fill('28');await refresh();
  await page.mouse.move(mid.x,mid.y);const cursor=await page.locator('[data-eraser-cursor] circle').last().boundingBox();assert.ok(Math.abs(cursor.width-28)<2,'circle shows the chosen diameter');
  await page.mouse.move(mid.x,mid.y-8);await page.mouse.down();await page.mouse.move(mid.x,mid.y+8,{steps:8});await page.mouse.up();
  assert.ok(await white(mid));assert.ok(await dark({x:left.x+30,y:left.y})&&await dark({x:right.x-30,y:right.y}),'circle removes only the touched pixels');assert.equal(await page.locator('[data-stroke="'+line+'"]').count(),1);
  await toolbar.getByLabel('お絵かきの元に戻す',{exact:true}).click();assert.ok(await dark(mid),'one Undo restores the partial erasure');
  await toolbar.getByRole('button',{name:'消しゴム',exact:true}).click({modifiers:['Shift']});assert.equal(await type.inputValue(),'stroke');
  const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mid.x,y:mid.y-8,id:0,force:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mid.x,y:mid.y+8,id:0,force:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.locator('[data-stroke="'+line+'"]').waitFor({state:'detached'});assert.ok(await white({x:left.x+30,y:left.y}),'cross eraser removes the whole line');await toolbar.getByLabel('お絵かきの元に戻す',{exact:true}).click();
  await toolbar.getByRole('button',{name:'消しゴム',exact:true}).click({modifiers:['Shift']});assert.equal(await type.inputValue(),'circle');
  const lasso=async()=>{await toolbar.getByRole('button',{name:'投げ縄選択',exact:true}).click();await refresh();const points=[[mid.x-35,mid.y-20],[mid.x+35,mid.y-20],[mid.x+35,mid.y+20],[mid.x-35,mid.y+20],[mid.x-35,mid.y-20]];await page.mouse.move(...points[0]);await page.mouse.down();for(const p of points.slice(1))await page.mouse.move(...p,{steps:6});await page.mouse.up();await toolbar.getByRole('button',{name:'選択を削除',exact:true}).waitFor();};
  await lasso();assert.ok(await page.locator('.notes-plane.tool-lasso').count(),'Canvas selection does not switch into Layout');
  await page.mouse.move(mid.x,mid.y);await page.mouse.down();await page.mouse.move(mid.x,mid.y+85,{steps:10});await page.mouse.up();assert.ok(await white(mid)&&await dark({x:mid.x,y:mid.y+85}));assert.ok(await dark({x:left.x+30,y:left.y}),'lasso moves only the selected part of a stroke');
  await toolbar.getByLabel('お絵かきの元に戻す',{exact:true}).click();assert.ok(await dark(mid)&&await white({x:mid.x,y:mid.y+85}));
  await lasso();await page.keyboard.press('Delete');assert.ok(await white(mid)&&await dark({x:left.x+30,y:left.y}),'Delete cuts the selected region without deleting the rest');await toolbar.getByLabel('お絵かきの元に戻す',{exact:true}).click();
  await toolbar.getByRole('button',{name:'消しゴム',exact:true}).click();await refresh();
  const touchCut=async cancel=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mid.x,y:mid.y-8,id:0,force:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mid.x,y:mid.y+8,id:0,force:1}]});await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});};
  await touchCut(true);assert.ok(await dark(mid),'cancelled circle erasing restores the source');await touchCut(false);assert.ok(await white(mid)&&await dark({x:left.x+30,y:left.y}),'touch circle erasing preserves the rest of the line');
  await page.screenshot({path:'/tmp/kaeru-canvas-toolbox-ink.png'});
  await toolbar.getByRole('button',{name:'鉛筆',exact:true}).click();await refresh();await page.mouse.move(left.x,left.y+55);await page.mouse.down();await page.mouse.move(right.x,right.y+55,{steps:20});await page.mouse.up();assert.ok(await page.locator('[data-ink-brush="pencil"]').count(),'pencil uses its own saved brush style');
  await page.getByTitle('レイアウトレイヤー',{exact:true}).click();await toolbar.getByLabel('図形プリセット',{exact:true}).selectOption('star');
  assert.equal(await toolbar.getByRole('group',{name:'Canvasブラシ',exact:true}).count(),0);for(const name of ['丸（楕円）','三角形','枠（四角形）','矢印'])assert.ok(await toolbar.getByRole('button',{name,exact:true}).isVisible());
  const drawPreset=async(x,y)=>{const plane=await page.locator('.notes-plane').boundingBox();await page.mouse.move(plane.x+x,plane.y+y);await page.mouse.down();await page.mouse.move(plane.x+x+130,plane.y+y+100,{steps:10});await page.mouse.up();};
  await drawPreset(440,100);assert.equal(await page.locator('[data-studio-family="layout"] [data-stroke] polygon').count(),1);
  await toolbar.getByLabel('選択図形をプリセットに追加',{exact:true}).click();await page.getByLabel('プリセット名',{exact:true}).fill('お気に入りの星');await page.getByRole('button',{name:'登録',exact:true}).click();
  const custom=await toolbar.getByLabel('図形プリセット',{exact:true}).inputValue();assert.ok(custom.startsWith('custom-'));await drawPreset(650,100);assert.equal(await page.locator('[data-studio-family="layout"] [data-stroke] polygon').count(),2);
  await page.waitForFunction(()=>document.querySelector('.notes-save-status')?.textContent?.includes('保存済み'));assert.equal(record.content.fixedNote.html,original.fixedNote.html);assert.deepEqual(record.content.attachments,original.attachments);assert.deepEqual(record.content.note,original.note);
  const saved=structuredClone(record.content);await page.reload();await body.waitFor();await page.getByTitle('レイアウトレイヤー',{exact:true}).click();assert.equal(await toolbar.getByLabel('図形プリセット',{exact:true}).locator('option').filter({hasText:'お気に入りの星'}).count(),1);assert.deepEqual(record.content,saved,'ink cuts, presets and original content survive reload');
  await image.evaluate(i=>i.decode());await image.scrollIntoViewIfNeeded();const restored=await image.boundingBox();assert.ok(await white({x:restored.x+160,y:restored.y+70})&&await dark({x:restored.x+60,y:restored.y+70}),'saved circular cuts stay partial after reload');
  await page.screenshot({path:'/tmp/kaeru-canvas-toolbox-layout.png'});
  await page.setViewportSize({width:390,height:844});await page.getByTitle('キャンバスレイヤー',{exact:true}).click();await toolbar.waitFor();
  if(await dock.count())await dock.getByLabel('レイヤー一覧を開閉',{exact:true}).tap();
  const mobileDetails=page.getByLabel('お絵かきの詳細',{exact:true});for(const control of [mobileDetails,page.locator('.notes-collapsed-dock-actions').getByLabel('レイヤー一覧を開閉',{exact:true}),toolbar.getByRole('button',{name:'消しゴム',exact:true}),toolbar.getByRole('button',{name:'投げ縄選択',exact:true})]){await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391,'mobile tools remain inside the viewport');assert.ok(await control.evaluate(n=>{const b=n.getBoundingClientRect();return n.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),'mobile target is not covered');}
  await mobileDetails.tap();await page.getByRole('region',{name:'Canvas詳細ツール',exact:true}).waitFor();await mobileDetails.tap();await page.screenshot({path:'/tmp/kaeru-canvas-toolbox-mobile.png'});
  assert.deepEqual(errors,[]);console.log('PASS circle and cross erasers, Shift switch, pixel-accurate lasso movement/delete, Undo, separate tools, reusable presets, dock/details placement, save/reload and touch layout');
 }catch(error){if(page)await page.screenshot({path:'/tmp/kaeru-canvas-toolbox-failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
