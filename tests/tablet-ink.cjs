const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const id='e'.repeat(32),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 const ink=(id,y,layerId='drawing')=>({id,layerId,points:[{x:180,y},{x:520,y}],color:'#333333',width:3,opacity:1,pressure:false});
 let record={id,title:'タブレット操作検証',revision:1,updated_at:1,content:{version:1,grid:'none',snap:false,
  layers:[{id:'drawing',name:'手書き',visible:true,locked:false},{id:'locked',name:'保護',visible:true,locked:true},{id:'hidden',name:'非表示',visible:false,locked:false},{id:'layout',name:'配置',studioKind:'layout',visible:true,locked:false}],
  paintStrokes:[ink('ink-a',180),ink('ink-b',240),ink('locked-ink',300,'locked'),ink('hidden-ink',340,'hidden'),{...ink('rotated-ink',190),points:[{x:600,y:190},{x:750,y:190}],rotation:90}],
  items:[{id:'legacy-path',kind:'path',layerId:'drawing',x:180,y:400,w:340,h:0,points:[{x:180,y:400},{x:520,y:400}],width:3,color:'#333333'},
   {id:'legacy-line',kind:'line',layerId:'drawing',x:180,y:450,w:340,h:0,width:3,color:'#333333'},
   {id:'original-image',kind:'image',layerId:'layout',imageId:'f'.repeat(32),x:180,y:120,w:340,h:340,width:0,color:'#333333'}],
  blocks:[],fixedNote:{html:'<p>大事な日本語の本文</p><img alt="注釈用の画像" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC" style="width:340px;height:200px">',visible:true,locked:false},attachments:[],note:{category:'仕事',tags:['保持']},studioOrder:['canvas','note','layout','graph']}};
 const original=structuredClone(record.content),json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),payload=bytes.length?JSON.parse(bytes.toString()):{};
  if(url.pathname==='/canvas/api.php'){
   const api=url.searchParams.get('path');
   if(api==='/api/session')return json(res,{authenticated:true,accountId:'tablet-fixture',csrfToken:'fixture'});
   if(api==='/api/note-workspace')return json(res,{categories:['仕事'],revision:1});
   if(api==='/api/notes-index')return json(res,{documents:[{id,title:record.title,revision:record.revision,updated_at:record.updated_at,note:record.content.note,excerpt:'本文',searchText:'本文'}],hasMore:false,nextOffset:1});
   if(api===`/api/documents/${id}`){if(req.method==='PUT'){record={...record,content:payload.content,title:payload.title,revision:record.revision+1,updated_at:Date.now()};return json(res,{id,revision:record.revision,updated_at:record.updated_at});}return json(res,record);}
   if(api===`/api/documents/${id}/images/${'f'.repeat(32)}`){res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);}
   return json(res,{error:api},404);
  }
  let rel=decodeURIComponent(url.pathname).replace(/^\/(?:canvas\/)?/,'');if(!rel)rel='index.html';
  const file=path.resolve('public/canvas',rel);if(!file.startsWith(path.resolve('public/canvas')+'/'))return json(res,{},403);
  try{const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html'});res.end(data);}catch{res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(5191,'127.0.0.1',resolve));
 let browser,page;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1400,height:1000},isMobile:true,hasTouch:true});page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5191/canvas/');await page.getByLabel('固定ノート本文').waitFor();
  await page.waitForFunction(()=>document.querySelector('[aria-label="メモのタイトル"]')?.value==='タブレット操作検証');
  await page.locator('.notes-studio-tools').getByRole('button',{name:'キャンバス',exact:true}).tap();
  await page.getByRole('button',{name:'消しゴム',exact:true}).tap();
  const cdp=await context.newCDPSession(page);
  let tapToken=0;
  const tapControl=async locator=>{await locator.waitFor({state:'visible'});const token=++tapToken;await locator.evaluate((el,token)=>el.addEventListener('click',()=>{window.tabletTapDone=token;},{once:true}),token);const box=await locator.boundingBox();await cdp.send('Input.synthesizeTapGesture',{x:box.x+box.width/2,y:box.y+box.height/2,gestureSourceType:'touch',duration:50});await page.waitForFunction(token=>window.tabletTapDone===token,token);};
  const screen=async(x,y)=>{const box=await page.locator('.notes-plane').boundingBox(),scale=Number(await page.getByLabel('ズーム倍率',{exact:true}).inputValue())/100;return{x:box.x+x*scale,y:box.y+y*scale};};
  const sweep=async(points,cancel=false)=>{
   for(let i=0;i<points.length;i++){const p=await screen(...points[i]);await cdp.send('Input.dispatchTouchEvent',{type:i?'touchMove':'touchStart',touchPoints:[{...p,id:0,radiusX:8,radiusY:8,force:1}]});}
   await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  };
  const present=async(id)=>await page.locator('.notes-ink [data-stroke="'+id+'"]').count();
  assert.equal(await present('ink-a'),1,'the first fixture stroke is present before erasing');assert.equal(await present('ink-b'),1,'the second fixture stroke is present before erasing');
  await page.evaluate(()=>{window.tabletEvents=[];document.addEventListener('pointerdown',e=>window.tabletEvents.push(['down',e.pointerId,e.pointerType,e.button,e.isPrimary,e.defaultPrevented,e.target?.closest('button')?.disabled]));document.addEventListener('pointerup',e=>window.tabletEvents.push(['up',e.pointerId,e.pointerType,e.target?.tagName]));document.addEventListener('click',e=>window.tabletEvents.push(['click',e.target?.closest('button')?.title,e.target?.closest('button')?.textContent]));});
  await sweep([[300,140],[300,270]]);
  assert.equal(await present('ink-a'),0,'a finger starting off the line erases the first crossed stroke');
  assert.equal(await present('ink-b'),0,'the same captured gesture erases the second crossed stroke');
  await tapControl(page.getByTitle('元に戻す',{exact:true}));await page.locator('[data-stroke="ink-a"]').waitFor({state:'attached'});assert.equal(await present('ink-a'),1);assert.equal(await present('ink-b'),1,'one undo restores the whole gesture');
  await sweep([[300,140],[300,270]],true);await page.locator('[data-stroke="ink-a"]').waitFor({state:'attached'});assert.equal(await present('ink-a'),1);assert.equal(await present('ink-b'),1,'pointer cancellation restores the document');
  await sweep([[300,285],[300,355]]);assert.equal(await present('locked-ink'),1,'locked strokes are protected');
  await page.getByLabel('ズーム倍率',{exact:true}).selectOption('50');
  await sweep([[300,360],[300,480]]);assert.equal(await present('legacy-path'),0);assert.equal(await present('legacy-line'),0,'legacy lines erase at the displayed zoom');
  await sweep([[620,190],[730,190]]);assert.equal(await present('rotated-ink'),0,'rotated ink uses its displayed coordinates');
  const countBeforeDrawing=await page.locator('.notes-ink [data-stroke]').count();
  await tapControl(page.getByRole('button',{name:'ペン',exact:true}).first());
  const penFrom=await screen(300,150),penTo=await screen(300,270);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...penFrom,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...penFrom,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...penTo,buttons:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...penTo,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  assert.equal(await page.locator('.notes-ink [data-stroke]').count(),countBeforeDrawing+1,'pen input still draws');
  await tapControl(page.getByRole('button',{name:'消しゴム',exact:true}));
  const countBefore=await page.locator('.notes-ink [data-stroke]').count();
  await sweep([[300,150],[300,270]]);
  assert.ok(await page.locator('.notes-ink [data-stroke]').count()<countBefore,'explicit eraser selection allows a finger immediately after pen input');
  await tapControl(page.getByTitle('元に戻す',{exact:true}));
  await page.waitForFunction(n=>document.querySelectorAll('.notes-ink [data-stroke]').length===n,countBefore);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...penFrom,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...penTo,buttons:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...penTo,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  assert.ok(await page.locator('.notes-ink [data-stroke]').count()<countBefore,'selected eraser works with a pen');
  for(const selector of ['.notes-header','.notes-sidebar','.notes-toolbar','.notes-studio-tools','.notes-layer-panel']){
   assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).userSelect),'none','UI text is not selectable: '+selector);
  }
  const ui=await page.getByRole('button',{name:'消しゴム',exact:true}).boundingBox();
  await page.mouse.dblclick(ui.x+ui.width/2,ui.y+ui.height/2);assert.equal(await page.evaluate(()=>getSelection().toString()),'','double-clicking menu text does not select it');
  await tapControl(page.locator('.notes-studio-tools').getByRole('button',{name:'ノート',exact:true}));
  const body=page.getByLabel('固定ノート本文');assert.equal(await body.evaluate(el=>getComputedStyle(el).userSelect),'text','Note body remains selectable');
  await body.click();await page.keyboard.press('Control+a');assert.ok((await page.evaluate(()=>getSelection().toString())).includes('大事な日本語'),'body text can be selected for editing');
  await page.getByLabel('メモのタイトル',{exact:true}).fill('名前を編集できる');await body.click();
  await page.waitForFunction(()=>document.querySelector('.notes-save-status')?.textContent?.includes('保存済み'));
  assert.equal(record.content.fixedNote.html,original.fixedNote.html);assert.deepEqual(record.content.note,original.note);assert.deepEqual(record.content.items.find(i=>i.id==='original-image'),original.items.find(i=>i.id==='original-image'));
  assert.ok(record.content.paintStrokes.some(s=>s.id==='locked-ink'));assert.ok(record.content.paintStrokes.some(s=>s.id==='hidden-ink'));
  await tapControl(page.locator('.notes-studio-tools').getByRole('button',{name:'キャンバス',exact:true}));
  await page.getByLabel('ズーム倍率',{exact:true}).selectOption('100');
  await tapControl(page.getByRole('button',{name:'ペン',exact:true}).first());
  const noteImage=page.getByAltText('注釈用の画像',{exact:true});await noteImage.waitFor();await noteImage.evaluate(image=>image.decode());await noteImage.scrollIntoViewIfNeeded();
  const imageBox=await noteImage.boundingBox(),inkPoint={x:Math.round(imageBox.x+120),y:Math.round(imageBox.y+24)};
  await page.mouse.move(inkPoint.x-50,inkPoint.y);await page.mouse.down();await page.mouse.move(inkPoint.x+50,inkPoint.y,{steps:8});await page.mouse.up();
  const pixelAt=async point=>{const pixel=await page.screenshot({clip:{x:Math.round(point.x),y:Math.round(point.y),width:1,height:1}});return page.evaluate(async base64=>{const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+base64)).blob()),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.drawImage(image,0,0);return Array.from(context.getImageData(0,0,1,1).data);},pixel.toString('base64'));};
  const rgba=await pixelAt(inkPoint);
  assert.ok(rgba.slice(0,3).every(channel=>channel<120),'handwriting on a Canvas above Note must remain visible over an opaque inline image: '+rgba);
  assert.equal(record.content.fixedNote.html,original.fixedNote.html,'annotating an image must preserve the Note HTML');
  const canvasGroup=page.locator('.notes-layer-group').filter({has:page.getByTitle('キャンバスレイヤーを追加',{exact:true})});
  await tapControl(canvasGroup.getByTitle('この親レイヤーを下へ',{exact:true}));
  assert.ok((await pixelAt(inkPoint)).slice(0,3).every(channel=>channel>240),'moving Canvas below Note puts its ink behind the opaque image');
  await tapControl(canvasGroup.getByTitle('この親レイヤーを上へ',{exact:true}));
  assert.ok((await pixelAt(inkPoint)).slice(0,3).every(channel=>channel<120),'moving Canvas back above Note restores the visible annotation');
  await tapControl(page.getByRole('button',{name:'消しゴム',exact:true}));
  const annotationPlane=await page.locator('.notes-plane').boundingBox();
  await sweep([[inkPoint.x-annotationPlane.x,inkPoint.y-annotationPlane.y-12],[inkPoint.x-annotationPlane.x,inkPoint.y-annotationPlane.y+12]]);
  assert.ok((await pixelAt(inkPoint)).slice(0,3).every(channel=>channel>240),'the eraser removes the annotation without erasing the Note image');
  await tapControl(page.getByTitle('元に戻す',{exact:true}));
  assert.ok((await pixelAt(inkPoint)).slice(0,3).every(channel=>channel<120),'undo restores the visible annotation on top of the image');
  await tapControl(page.getByRole('button',{name:'ペン',exact:true}).first());
  const noteFont=await body.evaluate(el=>getComputedStyle(el).fontSize);
  for(const zoom of ['50','200']){
   await page.getByLabel('ズーム倍率',{exact:true}).selectOption(zoom);await noteImage.scrollIntoViewIfNeeded();
   const image=await noteImage.boundingBox();assert.ok(Math.abs(image.width-imageBox.width)<1,'the Note image does not scale with Canvas zoom');
   assert.equal(await body.evaluate(el=>getComputedStyle(el).fontSize),noteFont);
   const point={x:Math.round(image.x+120),y:Math.round(image.y+(zoom==='50'?65:100))};
   for(const [index,x] of [point.x-40,point.x,point.x+40].entries())await cdp.send('Input.dispatchTouchEvent',{type:index?'touchMove':'touchStart',touchPoints:[{x,y:point.y,id:0,force:1}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.ok((await pixelAt(point)).slice(0,3).every(channel=>channel<160),'finger ink remains visible at Canvas zoom '+zoom+'%');
  }
  await page.getByLabel('ズーム倍率',{exact:true}).selectOption('100');
  await tapControl(page.locator('.notes-studio-tools').getByRole('button',{name:'ノート',exact:true}));
  await noteImage.scrollIntoViewIfNeeded();const activeImage=await noteImage.boundingBox(),penPoint={x:Math.round(activeImage.x+120),y:Math.round(activeImage.y+145)};
  const activeCount=await page.locator('.notes-ink[data-studio-family="canvas"] [data-stroke]').count();
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:penPoint.x-40,y:penPoint.y,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:penPoint.x-40,y:penPoint.y,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:penPoint.x+40,y:penPoint.y,buttons:1,pointerType:'pen'});
  assert.ok((await pixelAt(penPoint)).slice(0,3).every(channel=>channel<160),'the live pen preview is visible over the Note image before saving');
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:penPoint.x+40,y:penPoint.y,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  assert.equal(await page.locator('.notes-ink[data-studio-family="canvas"] [data-stroke]').count(),activeCount+1,'a stylus can annotate the active Note without changing to a text box');
  assert.equal(await body.getAttribute('contenteditable'),'true','the Note remains available for text editing after stylus input');
  const scrollBefore=await page.locator('.notes-scroll').evaluate(el=>el.scrollTop);
  for(const [index,y] of [penPoint.y,penPoint.y-90].entries())await cdp.send('Input.dispatchTouchEvent',{type:index?'touchMove':'touchStart',touchPoints:[{x:penPoint.x+70,y,id:0,force:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await page.locator('.notes-scroll').evaluate(el=>el.scrollTop)>scrollBefore+50,'finger scrolling in the active Note still moves the shared viewport');
  const noteTop=await body.boundingBox(),canvasTop=await page.locator('.notes-plane').boundingBox();assert.ok(Math.abs(noteTop.y-canvasTop.y)<1,'Note and ink share vertical scrolling');
  await page.waitForFunction(()=>document.querySelector('.notes-save-status')?.textContent?.includes('保存済み'));
  assert.equal(record.content.fixedNote.html,original.fixedNote.html);assert.deepEqual(record.content.note,original.note);assert.deepEqual(record.content.attachments,original.attachments);
  await noteImage.scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/kaeru-tablet-ink-over-note.png'});
  const saved=structuredClone(record.content);await page.reload();await page.getByLabel('固定ノート本文').waitFor();
  assert.deepEqual(record.content,saved,'reloading preserves erased ink and unrelated content');
  await noteImage.evaluate(image=>image.decode());await noteImage.scrollIntoViewIfNeeded();const restoredImage=await noteImage.boundingBox();
  assert.ok((await pixelAt({x:restoredImage.x+120,y:restoredImage.y+24})).slice(0,3).every(channel=>channel<120),'saved ink is still visible over the Note image after reload');
  assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/kaeru-tablet-ink.png'});
  console.log('Tablet touch / pen eraser, zoom, undo, cancellation, protected layers, UI selection and body preservation passed');
 }catch(e){if(page){await page.screenshot({path:'/tmp/kaeru-tablet-ink-failure.png'});console.error('Tablet state',await page.locator('.notes-plane').getAttribute('class'),await page.locator('.notes-ink [data-stroke]').evaluateAll(nodes=>nodes.map(n=>n.dataset.stroke)),await page.locator('.notes-warning').allTextContents(),JSON.stringify(await page.evaluate(()=>window.tabletEvents)),record.content.paintStrokes.map(s=>s.id));}throw e;}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1);});
