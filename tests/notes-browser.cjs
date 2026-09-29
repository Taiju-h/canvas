const { chromium }=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const assert=require('node:assert/strict');
const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}); const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 let workspace={categories:[],revision:0};let rejectBatch=false;
 const docs=new Map();let counter=100;let putCount=0;let conflict=false;let delay=0;
 const make=(id,title,text)=>({id,title,revision:1,updated_at:Date.now(),content:{version:1,items:[],layers:[{id:'layer',name:'メモ',visible:true,locked:false}],grid:'none',snap:false,blocks:[{id:id+'block',x:80,y:60,w:660,h:240,html:'<h1>'+title+'</h1><p>'+text+'</p>'}],note:{category:'仕事 / アイデア',tags:['メモ']},attachments:[]}});
 docs.set('a'.repeat(32),make('a'.repeat(32),'今日のアイデア','文章を書く。思いついたことを、ここに残す。'));
 docs.set('b'.repeat(32),make('b'.repeat(32),'打ち合わせメモ','次回は画面を確認する。'));
 docs.get('b'.repeat(32)).content.note.category='私用 / 予定';
 await page.route('**/canvas/api.php?**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.searchParams.get('path');const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/api/session')return json({authenticated:true,accountId:'test-account',csrfToken:'test'});
  if(path==='/api/note-workspace'){
   if(req.method()==='GET')return json(workspace);
   const body=req.postDataJSON();if(rejectBatch||body.revision!==workspace.revision||body.updates.some(u=>docs.get(u.id)?.revision!==u.revision))return route.fulfill({status:409,contentType:'application/json',body:'{"error":"更新されたメモがあります。分類は変更していません"}'});
   const changed=[];for(const u of body.updates){const d=docs.get(u.id);d.content.note={...d.content.note,category:u.category,tags:u.tags};d.revision++;d.updated_at=Date.now();changed.push({id:d.id,note:d.content.note,revision:d.revision,updated_at:d.updated_at});}
   workspace={categories:body.categories,revision:workspace.revision+1};return json({...workspace,changed});
  }
  if(path==='/api/notes-index'){const offset=Number(url.searchParams.get('offset')||0);const all=[...docs.values()].map(d=>({...d,note:d.content.note,excerpt:d.content.blocks?.[0]?.html.replace(/<[^>]+>/g,'')||'',searchText:d.content.blocks?.map(b=>b.html.replace(/<[^>]+>/g,'')).join(' ')||'',content:undefined}));return json({documents:all.slice(offset,offset+100),hasMore:offset+100<all.length,nextOffset:offset+100});}
  if(path==='/api/documents'&&req.method()==='POST'){const body=req.postDataJSON();const id=(counter++).toString(16).padStart(32,'0');const d={...body,id,revision:1,updated_at:Date.now()};docs.set(id,d);return json(d);}
  const match=path?.match(/^\/api\/documents\/([a-f0-9]{32})$/);
  if(match){const id=match[1];const d=docs.get(id);if(req.method()==='GET')return json(d);if(req.method()==='PUT'){
   putCount++;if(conflict)return route.fulfill({status:409,contentType:'application/json',body:'{"error":"競合"}'});
   const body=req.postDataJSON();if(body.revision!==d.revision)return route.fulfill({status:409,body:'{}'});
   if(delay)await new Promise(r=>setTimeout(r,delay));const next={...d,...body,revision:d.revision+1,updated_at:Date.now()};docs.set(id,next);return json(next);}}
  return route.fulfill({status:404,body:'{}'});
 });
 await page.goto((process.env.CANVAS_TEST_URL||'http://127.0.0.1:5173/canvas/'));
 await page.getByRole('textbox',{name:'メモ本文'}).waitFor();
 const text=page.getByRole('textbox',{name:'メモ本文'});
 await assert.equal(await text.evaluate(e=>e===document.activeElement),true);
 await text.fill('日本語メモ\n二行目の文章');
 await page.waitForTimeout(1100);assert.match(docs.get('a'.repeat(32)).content.blocks[0].html,/日本語メモ/);
 const count=putCount;await page.waitForTimeout(3000);assert.equal(putCount,count,'No infinite auto-save loop');
 await page.getByRole('button',{name:'メモ一覧を閉じる',exact:true}).first().click();assert.equal(await page.locator('.notes-sidebar').count(),0);
 await page.reload();await text.waitFor();assert.equal(await page.locator('.notes-sidebar').count(),0);
 await page.getByRole('button',{name:'メモ一覧を開く',exact:true}).click();
 await page.getByRole('textbox',{name:'メモを検索'}).fill('次回');assert.equal(await page.locator('.notes-list-item').count(),1);await page.getByRole('button',{name:'検索を消す'}).click();
 // Nested folders, cross-category AND search, atomic bulk operations, and trash.
 await page.getByRole('button',{name:'カテゴリ 仕事',exact:true}).click();assert.equal(await page.locator('.notes-list-item').count(),1);
 await page.getByRole('textbox',{name:'メモを検索'}).fill('次回 画面');assert.equal(await page.locator('.notes-list-item').count(),1);assert.match(await page.locator('.notes-list-item').innerText(),/打ち合わせ/);
 await page.getByRole('combobox',{name:'検索範囲'}).selectOption('filtered');assert.equal(await page.locator('.notes-list-item').count(),0);
 await page.getByRole('combobox',{name:'検索範囲'}).selectOption('all');await page.getByRole('button',{name:'検索を消す'}).click();
 await page.getByRole('button',{name:'仕事を折りたたむ',exact:true}).click();assert.equal(await page.getByRole('button',{name:'カテゴリ 仕事 / アイデア',exact:true}).count(),0);await page.getByRole('button',{name:'仕事を展開',exact:true}).click();
 await page.getByRole('button',{name:'カテゴリを管理',exact:true}).click();await page.getByRole('textbox',{name:'新しいカテゴリ名'}).fill('会議');await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok(workspace.categories.includes('仕事 / 会議'));
 await page.getByRole('button',{name:'カテゴリを管理',exact:true}).click();await page.getByRole('combobox',{name:'カテゴリの操作'}).selectOption('move');await page.getByRole('combobox',{name:'対象カテゴリ',exact:true}).selectOption('仕事');await page.getByRole('textbox',{name:'新しいカテゴリ名'}).fill('資料');
 rejectBatch=true;await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();await page.getByRole('alert').filter({hasText:'分類は変更していません'}).waitFor();assert.equal(docs.get('a'.repeat(32)).content.note.category,'仕事 / アイデア');rejectBatch=false;
 await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(docs.get('a'.repeat(32)).content.note.category,'資料 / アイデア');assert.ok(workspace.categories.includes('資料 / 会議'));
 await page.getByRole('button',{name:'カテゴリを管理',exact:true}).click();await page.getByRole('combobox',{name:'カテゴリの操作'}).selectOption('tag');await page.getByRole('textbox',{name:'変換先のタグ'}).fill('保存版');await page.getByRole('button',{name:'タグへ変換',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.deepEqual(docs.get('a'.repeat(32)).content.note.tags,['メモ','保存版']);assert.equal(docs.get('a'.repeat(32)).content.note.category,'');
 await page.getByRole('button',{name:/^すべてのメモ/}).click();
 await page.getByRole('button',{name:'メモを削除',exact:true}).click();await page.getByRole('button',{name:'ゴミ箱へ移動',exact:true}).click();await page.waitForTimeout(1000);assert.ok(docs.get('a'.repeat(32)).content.note.trashedAt);assert.equal(await page.locator('.notes-list-item').count(),1);assert.equal(await text.getAttribute('contenteditable'),'false');
 await page.getByRole('button',{name:/^ゴミ箱/}).click();assert.equal(await page.locator('.notes-list-item').count(),1);await page.reload();await text.waitFor();assert.equal(await text.getAttribute('contenteditable'),'false');
 await page.getByRole('button',{name:'メモを復元',exact:true}).click();await page.waitForTimeout(1000);assert.ok(!docs.get('a'.repeat(32)).content.note.trashedAt);assert.equal(await page.locator('.notes-list-item').count(),2);
 await page.getByRole('button',{name:'拡大',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'ズーム倍率'}).inputValue(),'110');await page.getByRole('button',{name:'縮小',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'ズーム倍率'}).inputValue(),'100');
 await page.getByRole('combobox',{name:'ズーム倍率'}).selectOption('200');assert.match(await page.locator('.notes-plane').getAttribute('style'),/scale\(2\)/);await page.getByRole('button',{name:'画面に合わせる',exact:true}).click();await page.getByRole('button',{name:'100%',exact:true}).click();
 await page.locator('.notes-scroll').evaluate(el=>el.scrollTo(0,0));
 await page.locator('.notes-scroll').dispatchEvent('wheel',{deltaY:-50,ctrlKey:true,clientX:650,clientY:450});await page.waitForTimeout(100);assert.ok(Number(await page.getByRole('combobox',{name:'ズーム倍率'}).inputValue())>100);await page.getByRole('button',{name:'100%',exact:true}).click();await page.locator('.notes-scroll').evaluate(el=>el.scrollTo(0,0));
 // Pen events over text must draw, not select text. Anchor moves with the block.
 const box=await text.boundingBox();const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x+20,y:box.y+40,button:'left',buttons:1,clickCount:1,pointerType:'pen',force:.5});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:box.x+150,y:box.y+60,button:'left',buttons:1,pointerType:'pen',force:.6});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x+150,y:box.y+60,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
 await page.waitForTimeout(1000);assert.equal(docs.get('a'.repeat(32)).content.paintStrokes.length,1);
 const handle=page.getByRole('button',{name:'文章ブロックを移動'});const hb=await handle.boundingBox();await page.mouse.move(hb.x+10,hb.y+10);await page.mouse.down();await page.mouse.move(hb.x+95,hb.y+100,{steps:5});await page.mouse.up();await page.waitForTimeout(1000);assert.ok(docs.get('a'.repeat(32)).content.blocks[0].x>100);
 // Concurrent edit while a save is in flight must survive.
 delay=600;await text.fill('保存中の編集 A');await page.waitForTimeout(800);await text.fill('保存中の編集 B');await page.waitForTimeout(2000);assert.match(docs.get('a'.repeat(32)).content.blocks[0].html,/編集 B/);delay=0;
 // Offline draft survives reload, online conflict retains it.
 await context.setOffline(true);await text.fill('オフラインで書いた文章');await page.waitForTimeout(200);await context.setOffline(false);conflict=true;await page.reload();await text.waitFor();assert.match(await text.innerText(),/オフライン/);await page.waitForTimeout(1000);assert.ok(await page.getByRole('button',{name:'今の内容を別メモに保存'}).count());
 conflict=false;await page.getByRole('button',{name:'今の内容を別メモに保存'}).click();await page.waitForTimeout(1500);assert.ok([...docs.values()].some(d=>d.title.includes('競合から復元')));
 assert.deepEqual(errors,[]);
 if(process.env.CANVAS_SCREENSHOT_DIR)await page.screenshot({path:process.env.CANVAS_SCREENSHOT_DIR+'/notes-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'メモ一覧を閉じる',exact:true}).first().click();if(process.env.CANVAS_SCREENSHOT_DIR)await page.screenshot({path:process.env.CANVAS_SCREENSHOT_DIR+'/notes-mobile.png'});
 console.log('PASS: nested categories, move/tag conversion, rejected batch, cross search, trash/restore, zoom, focus, Japanese multiline, stable save, sidebar persistence, search, pen, move, concurrent save, offline recovery, conflict copy');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
