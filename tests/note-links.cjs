const assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const {createFixture}=require('./note-links-fixture.cjs');
(async()=>{
 const fixture=createFixture();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+fixture.server.address().port;let browser,page;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1400,height:1100}});page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>リンク先</h1>'}));
  const title=page.getByLabel('メモのタイトル',{exact:true}),body=page.getByLabel('固定ノート本文',{exact:true});
  await page.goto(origin+'/canvas/');await page.waitForFunction(()=>document.querySelector('[aria-label="メモのタイトル"]')?.value==='製品紹介の資料');
  const save=async()=>{await page.getByLabel('保存',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.notes-save-status')?.textContent.includes('保存済み'));};
  const follow=async(locator,url)=>{const opened=context.waitForEvent('page');await locator.click();const popup=await opened;await popup.waitForURL(url);await popup.close();};
  // Existing and bare URLs both open with one click; non-link text accepts the native caret.
  await follow(body.getByRole('link',{name:'製品の紹介ページ',exact:true}),'https://example.com/#text');
  await follow(body.getByRole('link',{name:'https://example.com/#plain',exact:true}),'https://example.com/#plain');
  const text=body.locator('p').filter({hasText:'本文はクリックして編集できます。'});await text.click();await page.keyboard.press('End');await page.keyboard.insertText('追記');await save();assert.ok(fixture.documents.get(fixture.primaryId).content.fixedNote.html.includes('追記'));
  // Select ordinary text, set a URL, then change and remove it through the dedicated editor.
  await text.evaluate(p=>{p.parentElement.focus();const range=document.createRange();range.selectNodeContents(p);const s=window.getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.getByLabel('リンクを設定・変更',{exact:true}).click();let dialog=page.getByRole('dialog',{name:'リンクを設定',exact:true});await dialog.getByLabel('クリック先のURL').fill('https://example.com/#selected');await dialog.getByRole('button',{name:'リンクを保存',exact:true}).click();await dialog.waitFor({state:'detached'});
  await follow(text.getByRole('link'),'https://example.com/#selected');
  await text.getByRole('link').click({button:'right'});await page.getByRole('menuitem',{name:'リンクを設定・変更',exact:true}).click();await dialog.getByLabel('クリック先のURL').fill('https://example.com/#changed');await dialog.getByRole('button',{name:'リンクを保存',exact:true}).click();await dialog.waitFor({state:'detached'});await follow(text.getByRole('link'),'https://example.com/#changed');
  await text.getByRole('link').click({button:'right'});await page.getByRole('menuitem',{name:'リンクを設定・変更',exact:true}).click();await dialog.getByRole('button',{name:'リンクを解除',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await text.locator('a').count(),0);
  // Media destinations are separate from the cached source. Right-click exposes editing without following.
  const originals=structuredClone(fixture.documents.get(fixture.primaryId).content.attachments);
  for(const [selector,name,hash] of [['img','製品の画像','image'],['video','製品の動画','video']]){
    const media=body.locator(selector+'[title="'+name+'"],'+selector+'[alt="'+name+'"]');
    await media.click({button:'right'});await page.getByRole('menuitem',{name:'リンクを設定・変更',exact:true}).click();await dialog.getByLabel('クリック先のURL').fill('https://example.com/#'+hash);assert.equal(await dialog.getByLabel('リンクの表示文字').count(),0);await dialog.getByRole('button',{name:'リンクを保存',exact:true}).click();await dialog.waitFor({state:'detached'});await follow(media.locator('..'),'https://example.com/#'+hash);
  }
  await save();assert.deepEqual(fixture.documents.get(fixture.primaryId).content.attachments,originals);assert.ok(!fixture.documents.get(fixture.primaryId).content.fixedNote.html.includes('blob:'));
  await page.getByLabel('CRMとの関連付け',{exact:true}).click();const crm=page.getByRole('dialog',{name:'CRMとの関連付け',exact:true});await crm.getByLabel('CRMの関連先の名前').fill('サンプル顧客');await crm.getByLabel('CRMのページURL').fill('https://crm.example.test/customers/demo');await crm.getByRole('button',{name:'関連先を追加',exact:true}).click();await crm.getByRole('button',{name:'関連付けを保存',exact:true}).click();await crm.waitFor({state:'detached'});await save();assert.equal(fixture.documents.get(fixture.primaryId).content.note.crmLinks[0].label,'サンプル顧客');
  // Main resource cards follow their destination on one click, but keep preview/edit access.
  await page.getByRole('button',{name:'画像・YouTube・メモの資料を開く',exact:true}).click();const library=page.getByRole('dialog',{name:'画像・動画・メモ',exact:true});await library.getByLabel('資料を検索').fill('サンプル顧客');await library.getByLabel('資料のCRM関連先').selectOption('https://crm.example.test/customers/demo');
  const imageCard=library.locator('.kn-reference-card.kind-image').filter({hasText:'製品の画像'});await imageCard.waitFor();await follow(imageCard.getByRole('link',{name:'製品の画像のリンク先を開く',exact:true}),'https://example.com/#image');await imageCard.getByRole('button',{name:'プレビュー',exact:true}).click();await library.getByLabel('画像・動画のプレビューを閉じる').click();await page.screenshot({path:'/tmp/kaeru-links-library.png'});await library.getByLabel('資料を閉じる').click();
  // Internal note links navigate in the current app; the legacy text-block editor uses the same click rule.
  await body.getByRole('link',{name:'関連するメモ',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="メモのタイトル"]')?.value==='関連するメモ');
  await follow(page.getByLabel('メモ本文',{exact:true}).getByRole('link',{name:'文章ブロックのURL',exact:true}),'https://example.com/#block');
  await page.goto(origin+'/canvas/?d='+fixture.primaryId);await page.waitForFunction(()=>document.querySelector('[aria-label="メモのタイトル"]')?.value==='製品紹介の資料');
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();await body.locator('a[href="https://example.com/#image"] img').waitFor();assert.equal(await body.locator('a[href="https://example.com/#video"] video').count(),1);await page.getByLabel('CRMとの関連付け',{exact:true}).click();await crm.getByRole('link').filter({hasText:'サンプル顧客'}).waitFor();await crm.getByLabel('CRMの関連付けを閉じる').click();const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>リンク先</h1>'}));const mp=await mobile.newPage();await mp.goto(origin+'/canvas/?d='+fixture.primaryId);await mp.waitForFunction(()=>document.querySelector('[aria-label="メモのタイトル"]')?.value==='製品紹介の資料');const closeSidebar=mp.getByLabel('メモ一覧を閉じる',{exact:true});if(await closeSidebar.isVisible())await closeSidebar.tap();const tapped=mobile.waitForEvent('page');await mp.getByLabel('固定ノート本文',{exact:true}).locator('a[href="https://example.com/#image"]').tap();const linked=await tapped;await linked.waitForURL('https://example.com/#image');await linked.close();await mp.screenshot({path:'/tmp/kaeru-links-mobile.png'});await mobile.close();
  assert.deepEqual(errors,[]);console.log('PASS single-click links and media, native text editing, link editing/removal, internal note navigation, CRM search and offline persistence');
 }catch(error){if(page)await page.screenshot({path:'/tmp/kaeru-links-failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();await new Promise(resolve=>fixture.server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
