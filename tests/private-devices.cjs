const assert=require('node:assert/strict'),{createFixture}=require('./private-browser-fixture.cjs');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
  const {server,fixture}=createFixture();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']}),contexts=[],errors=[];
  const context=async options=>{const c=await browser.newContext(options);contexts.push(c);return c;};
  const page=async c=>{const p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));p.setDefaultTimeout(18000);return p;};
  const until=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Expected private device state was not reached');};
  const enroll=async(p,name,code)=>{await p.getByLabel('この端末の名前',{exact:true}).fill(name);await p.getByLabel('登録コード',{exact:true}).fill(code);await p.getByRole('button',{name:'この端末を登録して開く',exact:true}).click();await p.getByLabel('固定ノート本文',{exact:true}).waitFor();};
  let first;
  try{
    const fresh=await context({viewport:{width:393,height:851}});await fresh.addInitScript(()=>{window.CanvasApp={requiresDeviceRegistration:()=>true};localStorage.setItem('canvasSessionCache',JSON.stringify({authenticated:true,accountId:'legacy'}));Object.defineProperty(navigator,'onLine',{get:()=>false});});
    const locked=await page(fresh);await locked.goto(base+'/canvas/');await locked.getByRole('heading',{name:'ご本人の端末を登録'}).waitFor();assert.equal(await locked.getByLabel('固定ノート本文',{exact:true}).count(),0);assert.equal(await locked.getByRole('button',{name:'この端末だけで使う'}).count(),0);
    await locked.screenshot({path:'/tmp/kaeru-private-first-offline.png'});await fresh.close();
    const android=await context({viewport:{width:1360,height:920},userAgent:'Mozilla/5.0 KaeruNoteAndroid/0.4.6-private'});first=await page(android);
    await first.goto(base+`/canvas/?d=${fixture.record.id}#share=${'9'.repeat(64)}`);await first.getByRole('heading',{name:'ご本人の端末を登録'}).waitFor();assert.equal(fixture.deviceReads,0,'A shared hash cannot mount the private editor');
    await first.getByLabel('この端末の名前',{exact:true}).fill('本人のAndroid');await first.getByLabel('登録コード',{exact:true}).fill('wrong');await first.getByRole('button',{name:'この端末を登録して開く'}).click();await first.getByRole('alert').filter({hasText:'登録コードが違う'}).waitFor();
    await first.screenshot({path:'/tmp/kaeru-private-registration.png'});await enroll(first,'本人のAndroid','11111111-22222222-33333333-44444444');
    assert.equal(await first.getByLabel('作品を共有',{exact:true}).count(),0);assert.ok(!(await first.evaluate(()=>document.cookie)).includes('__Secure-kn_device'),'The grant is HttpOnly');
    await first.getByLabel('自分の端末を管理',{exact:true}).click();await first.getByRole('button',{name:'別の自分の端末を追加する'}).click();const code=await first.getByLabel('追加端末の登録コード').inputValue();
    await first.screenshot({path:'/tmp/kaeru-private-devices.png'});await first.getByLabel('端末管理を閉じる').click();
    const ipad=await context({viewport:{width:820,height:1180},hasTouch:true,isMobile:true});const second=await page(ipad);await second.goto(base+'/canvas/');await enroll(second,'本人のiPad',code);
    assert.equal((await second.evaluate(()=>JSON.parse(localStorage.getItem('canvasSessionCache')))).accountId,'a'.repeat(32));
    await first.waitForFunction(()=>document.documentElement.dataset.offlineReady==='true');await android.setOffline(true);await first.reload();await first.getByLabel('固定ノート本文',{exact:true}).waitFor();
    await first.getByLabel('固定ノート本文',{exact:true}).fill('登録済み端末でオフライン編集');await first.getByLabel('保存',{exact:true}).click();await first.waitForFunction(()=>document.querySelector('.notes-save-status')?.textContent?.includes('端末に保存'));
    await first.reload();await first.getByLabel('固定ノート本文',{exact:true}).waitFor();assert.match(await first.getByLabel('固定ノート本文',{exact:true}).innerText(),/オフライン編集/);
    await android.setOffline(false);await until(()=>fixture.writes>0);assert.match(fixture.record.content.fixedNote.html,/オフライン編集/);
    fixture.allowWrites=false;const editor=first.getByLabel('固定ノート本文',{exact:true});await editor.fill('解除前の未同期編集を残す');await first.getByLabel('保存',{exact:true}).click();
    await second.getByLabel('自分の端末を管理',{exact:true}).click();const row=second.getByRole('listitem').filter({hasText:'本人のAndroid'});await row.getByRole('button',{name:'登録を解除',exact:true}).click();await row.getByRole('button',{name:'解除する',exact:true}).click();
    await first.evaluate(()=>window.dispatchEvent(new Event('focus')));await first.getByRole('heading',{name:'ご本人の端末を登録'}).waitFor();
    const saved=await first.evaluate(async id=>{const db=await new Promise(r=>{const q=indexedDB.open('canvas-offline-v1',2);q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=db.transaction('documents').objectStore('documents').get(id);q.onsuccess=()=>r(q.result);});},fixture.record.id);
    assert.ok(saved.dirty);assert.match(saved.content.fixedNote.html,/未同期編集を残す/);assert.equal(await first.getByLabel('固定ノート本文',{exact:true}).isVisible().catch(()=>false),false);
    await android.setOffline(true);await first.reload();await first.getByRole('heading',{name:'ご本人の端末を登録'}).waitFor();assert.equal(await first.getByLabel('固定ノート本文',{exact:true}).count(),0);
    const old=await context({viewport:{width:393,height:851},userAgent:'Mozilla/5.0 KaeruNoteAndroid/0.4.5-web-shell'}),oldPage=await page(old);await oldPage.goto(base+'/canvas/native-shell.html');assert.match(await oldPage.getByRole('link',{name:'最新版をダウンロード'}).getAttribute('href'),/0\.4\.6/);assert.equal(await oldPage.getByLabel('登録コード',{exact:true}).count(),0);assert.equal(new URL(oldPage.url()).pathname,'/canvas/');
    fixture.mode='public';const setup=await context();await setup.addInitScript(()=>{window.CanvasApp={requiresDeviceRegistration:()=>true};});const setupPage=await page(setup);await setupPage.goto(base+'/canvas/');await setupPage.getByRole('alert').filter({hasText:'サーバーの個人専用設定が必要'}).waitFor();assert.equal(await setupPage.getByLabel('固定ノート本文',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);console.log('PASS private UI: first offline denial, share bypass denial, wrong/valid code, HttpOnly cookie, Android+iPad owner, device invitation/revocation, offline reload/edit/sync, unsynced edit preservation, old APK and unconfigured server gates');
  }catch(e){if(first)await first.screenshot({path:'/tmp/kaeru-private-failure.png'}).catch(()=>{});throw e;}finally{for(const c of contexts)await c.close().catch(()=>{});await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1);});
