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
  blocks:[],fixedNote:{html:'<p>大事な日本語の本文</p>',visible:true,locked:false},attachments:[],note:{category:'仕事',tags:['保持']}}};
 const original=structuredClone(record.content),json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),payload=bytes.length?JSON.parse(bytes.toString()):{};
  if(url.pathname==='/canvas/api.php'){
   const api=url.searchParams.get('path');
   if(api==='/api/session')return json(res,{authenticated:true,accountId:'tablet-fixture',csrfToken:'fixture'});
   if(api==='/api/note-workspace')return json(res,{categories:['仕事'],revision:1});
   if(api==='/api/notes-index')return json(res,{documents:[{id,title:record.title,revision:record.revision,updated_at:record.updated_at,note:record.content.note,excerpt:'本文',searchText:'本文'}],hasMore:false,nextOffset:1});
   if(api===`/api/documents/${id}`){if(req.method==='PUT'){record={...record,content:payload.content,title:payload.title,revision:record.revision+1,updated_at:Date.now()};return json(res,{revision:record.revision,updated_at:record.updated_at});}return json(res,record);}
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
  const context=await browser.newContext({viewport:{width:1400,height:1000},hasTouch:true});page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5191/canvas/');await page.getByLabel('固定ノート本文').waitFor();
  await page.locator('.notes-studio-tools').getByRole('button',{name:'キャンバス',exact:true}).tap();
  await page.getByRole('button',{name:'消しゴム',exact:true}).tap();
  const cdp=await context.newCDPSession(page);
  const screen=async(x,y)=>{const box=await page.locator('.notes-plane').boundingBox(),scale=Number(await page.getByLabel('ズーム倍率',{exact:true}).inputValue())/100;return{x:box.x+x*scale,y:box.y+y*scale};};
  const sweep=async(points,cancel=false)=>{
   for(let i=0;i<points.length;i++){const p=await screen(...points[i]);await cdp.send('Input.dispatchTouchEvent',{type:i?'touchMove':'touchStart',touchPoints:[{...p,id:1,radiusX:8,radiusY:8,force:1}]});}
   await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  };
  const present=async(id)=>await page.locator('.notes-ink [data-stroke="'+id+'"]').count();
  await sweep([[300,140],[300,270]]);
  assert.equal(await present('ink-a'),0,'a finger starting off the line erases the first crossed stroke');
  assert.equal(await present('ink-b'),0,'the same captured gesture erases the second crossed stroke');
  await page.getByTitle('元に戻す',{exact:true}).tap();await page.locator('[data-stroke="ink-a"]').waitFor({state:'attached'});assert.equal(await present('ink-a'),1);assert.equal(await present('ink-b'),1,'one undo restores the whole gesture');
  await sweep([[300,140],[300,270]],true);await page.locator('[data-stroke="ink-a"]').waitFor({state:'attached'});assert.equal(await present('ink-a'),1);assert.equal(await present('ink-b'),1,'pointer cancellation restores the document');
  await sweep([[300,285],[300,355]]);assert.equal(await present('locked-ink'),1,'locked strokes are protected');
  await page.getByLabel('ズーム倍率',{exact:true}).selectOption('50');
  await sweep([[300,360],[300,480]]);assert.equal(await present('legacy-path'),0);assert.equal(await present('legacy-line'),0,'legacy lines erase at the displayed zoom');
  await sweep([[620,190],[730,190]]);assert.equal(await present('rotated-ink'),0,'rotated ink uses its displayed coordinates');
  const countBeforeDrawing=await page.locator('.notes-ink [data-stroke]').count();
  await page.getByRole('button',{name:'ペン',exact:true}).first().tap();
  const penFrom=await screen(300,150),penTo=await screen(300,270);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...penFrom,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...penFrom,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...penTo,buttons:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...penTo,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  assert.equal(await page.locator('.notes-ink [data-stroke]').count(),countBeforeDrawing+1,'pen input still draws');
  await page.getByRole('button',{name:'消しゴム',exact:true}).tap();
  const countBefore=await page.locator('.notes-ink [data-stroke]').count();
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...penFrom,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...penTo,buttons:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...penTo,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  assert.ok(await page.locator('.notes-ink [data-stroke]').count()<countBefore,'selected eraser works with a pen');
  for(const selector of ['.notes-header','.notes-sidebar','.notes-toolbar','.notes-studio-tools','.notes-layer-panel']){
   assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).userSelect),'none','UI text is not selectable: '+selector);
  }
  const ui=await page.getByRole('button',{name:'消しゴム',exact:true}).boundingBox();
  await page.mouse.dblclick(ui.x+ui.width/2,ui.y+ui.height/2);assert.equal(await page.evaluate(()=>getSelection().toString()),'','double-clicking menu text does not select it');
  await page.locator('.notes-studio-tools').getByRole('button',{name:'ノート',exact:true}).tap();
  const body=page.getByLabel('固定ノート本文');assert.equal(await body.evaluate(el=>getComputedStyle(el).userSelect),'text','Note body remains selectable');
  await body.click();await page.keyboard.press('Control+a');assert.ok((await page.evaluate(()=>getSelection().toString())).includes('大事な日本語'),'body text can be selected for editing');
  await page.getByLabel('メモのタイトル',{exact:true}).fill('名前を編集できる');await body.click();
  await page.waitForFunction(()=>document.querySelector('.notes-save-status')?.textContent?.includes('保存済み'));
  assert.equal(record.content.fixedNote.html,original.fixedNote.html);assert.deepEqual(record.content.note,original.note);assert.deepEqual(record.content.items.find(i=>i.id==='original-image'),original.items.find(i=>i.id==='original-image'));
  assert.ok(record.content.paintStrokes.some(s=>s.id==='locked-ink'));assert.ok(record.content.paintStrokes.some(s=>s.id==='hidden-ink'));
  const saved=structuredClone(record.content);await page.reload();await page.getByLabel('固定ノート本文').waitFor();
  assert.deepEqual(record.content,saved,'reloading preserves erased ink and unrelated content');
  assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/kaeru-tablet-ink.png'});
  console.log('Tablet touch / pen eraser, zoom, undo, cancellation, protected layers, UI selection and body preservation passed');
 }catch(e){if(page){await page.screenshot({path:'/tmp/kaeru-tablet-ink-failure.png'});console.error('Tablet state',await page.locator('.notes-plane').getAttribute('class'),await page.locator('.notes-ink [data-stroke]').evaluateAll(nodes=>nodes.map(n=>n.dataset.stroke)),await page.locator('.notes-warning').allTextContents());}throw e;}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1);});
