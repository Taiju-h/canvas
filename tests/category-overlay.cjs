const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const {createServer}=await import('vite');
 const baseline=process.argv.includes('--baseline');
 const roots=Array.from({length:400},(_,i)=>'一覧'+String(i).padStart(3,'0'));
 const longParts=['長い大カテゴリの名前','長い第二階層の名前','長い第三階層の名前','長い第四階層の名前','長い末端カテゴリの名前'];
 const categories=['単純 / 末端A','単純 / 末端B','仕事 / 会議 / 企画 / 調査 / 結果','仕事 / 会議 / 企画 / 調査 / 資料','仕事 / 会議 / 別件',longParts.join(' / '),...roots,...Array.from({length:200},(_,i)=>'一覧399 / 子'+String(i).padStart(3,'0'))];
 const fixture=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {CategoryTree,CategoryManager} from '${baseline?'/__baseline-category.tsx':'/src/components/note-categories.tsx'}';import {categoryPaths} from '/src/lib/note-organization.ts';import '/src/styles.css';import '/src/notes.css';
 const paths=categoryPaths(${JSON.stringify(categories)});const notes=paths.map((category,i)=>({id:String(i),note:{category,tags:[]}}));
 function Fixture(){const [selected,select]=useState(''),[manage,setManage]=useState(false),[tick,setTick]=useState(0);window.pickCategory=select;window.rerender=()=>setTick(v=>v+1);window.selectedCategory=selected;
 return <div className="notes-app" style={{display:'block',padding:20}}><aside className="notes-sidebar" style={{position:'relative',width:'min(380px,calc(100vw - 40px))',height:570,zIndex:1}}><CategoryTree paths={[...paths]} notes={notes} selected={selected} disabled={false} onSelect={select} onManage={()=>setManage(true)}/></aside><output id="chosen">{selected}</output>{manage&&<CategoryManager paths={paths} initial={selected} busy={false} onClose={()=>setManage(false)} onApply={async op=>{window.operations=(window.operations||[]).concat(op);}}/>}</div>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
 const server=await createServer({server:{host:'127.0.0.1',port:5185},plugins:[{name:'category-fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{
 if(req.url?.startsWith('/canvas/__category-test.html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/canvas/__category-fixture.tsx"></script></body></html>'));return;}next();});},resolveId(id){if(id.includes('__category-fixture.tsx')||id.includes('__baseline-category.tsx'))return id;},load(id){if(id.includes('__category-fixture.tsx'))return fixture;if(id.includes('__baseline-category.tsx'))return execFileSync('git',['show','dc21b1bf374291c360e76ca88e095d7715c9b166:src/components/note-categories.tsx'],{encoding:'utf8'});}}]});
 await server.listen();
 let browser,page;
 try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:5185/canvas/__category-test.html');await page.locator('.notes-category-choice').first().waitFor();
 const pick=async p=>{await page.evaluate(p=>window.pickCategory(p),p);await page.waitForFunction(p=>!p||Array.from(document.querySelectorAll('[data-category-path]')).some(n=>n.dataset.categoryPath===p&&n.getAttribute('aria-current')==='true'),p);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 const panes=page.locator('.notes-category-multi-pane');
 await page.locator('[data-category-path="単純"]').click();await page.mouse.move(700,650);await page.waitForTimeout(220);
 assert.equal(await panes.count(),2,'leaf-only children must use their own overlay pane');
 assert.equal(await page.locator('.notes-category-inline-children').count(),0);
 if(baseline)throw new Error('Expected the baseline leaf-overlay regression to be detected');
 const stage=await page.locator('.notes-category-cascade-stage').boundingBox();
 let boxes=await panes.evaluateAll(nodes=>nodes.map(n=>({left:n.offsetLeft,width:n.offsetWidth,z:Number(n.style.zIndex)})));
 assert.ok(Math.abs(boxes[1].left/stage.width-.2)<.015);
 assert.ok(Math.abs(boxes[1].width/stage.width-.8)<.015);
 await page.mouse.move(stage.x+10,stage.y+65);await page.waitForTimeout(240);
 assert.equal(await panes.first().getAttribute('class').then(c=>c.includes('is-focused')),true);
 await page.evaluate(()=>window.rerender());await page.waitForTimeout(50);assert.ok((await panes.first().getAttribute('class')).includes('is-focused'),'unrelated rerender preserves parent preview');
 await page.mouse.move(stage.x+stage.width-10,stage.y+65);await page.waitForTimeout(240);
 assert.ok((await panes.last().getAttribute('class')).includes('is-focused'),'moving from parent into exposed child restores child front');
 await page.locator('[data-category-path="単純 / 末端B"]').click();assert.equal(await page.locator('#chosen').innerText(),'単純 / 末端B');assert.equal(await panes.count(),2);
 await pick('');
 for(const p of ['仕事','仕事 / 会議','仕事 / 会議 / 企画','仕事 / 会議 / 企画 / 調査','仕事 / 会議 / 企画 / 調査 / 結果']){await page.locator('[data-category-path='+JSON.stringify(p)+']').click();await page.mouse.move(700,650);await page.waitForTimeout(240);assert.equal(await page.locator('#chosen').innerText(),p);assert.ok(await panes.count()<=3);}
 assert.equal(await page.locator('.notes-category-breadcrumb button').count(),6);
 boxes=await panes.evaluateAll(nodes=>nodes.map(n=>({left:n.offsetLeft,width:n.offsetWidth})));
 assert.ok(Math.abs((boxes[1].left-boxes[0].left)/boxes[0].width-.2)<.02);
 assert.ok(Math.abs((boxes[2].left-boxes[1].left)/boxes[1].width-.2)<.02);
 for(let i=0;i<3;i++){const b=await panes.nth(i).boundingBox();await page.mouse.move(b.x+5,b.y+65);await page.waitForTimeout(240);assert.ok((await panes.nth(i).getAttribute('class')).includes('is-focused'));}
 await page.locator('.notes-category-breadcrumb button[title="仕事 / 会議 / 企画"]').click();
 assert.equal(await page.locator('#chosen').innerText(),'仕事 / 会議 / 企画');assert.ok((await panes.nth(1).getAttribute('class')).includes('is-focused'),'breadcrumb shows the pane containing the selected ancestor');
 await page.locator('.notes-category-breadcrumb button[title="仕事"]').click();assert.equal(await page.locator('#chosen').innerText(),'仕事');assert.ok((await panes.first().getAttribute('class')).includes('is-focused'));
 await pick('一覧399 / 子199');
 const scroll=await page.locator('.notes-category-scroll').evaluateAll(nodes=>nodes.map(n=>({scroll:n.scrollTop,height:n.clientHeight,content:n.scrollHeight})));
 assert.ok(scroll.every(s=>s.scroll>0),'both selected child and its root ancestor auto-scroll into view: '+JSON.stringify(scroll));
 const selected=page.locator('[data-category-path="一覧399 / 子199"]');const row=await selected.boundingBox(),area=await page.locator('.notes-category-scroll').last().boundingBox();assert.ok(row.y>=area.y&&row.y+row.height<=area.y+area.height);
 await page.locator('.notes-category-scroll').last().evaluate(n=>n.scrollTop=0);await page.mouse.move(700,650);await page.waitForTimeout(200);assert.ok(await page.locator('.notes-category-scroll').last().evaluate(n=>n.scrollTop===0),'manual scrolling remains possible');
 await pick('単純');await page.mouse.move(700,650);await page.waitForTimeout(240);await page.screenshot({path:'/tmp/kaeru-category-overlay-desktop.png'});
 // CategoryManager is unchanged; verify each form still emits the correct command.
 await page.getByRole('button',{name:'カテゴリを管理',exact:true}).click();await page.getByLabel('新しいカテゴリ名',{exact:true}).fill('新しい子');await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();
 await page.getByRole('button',{name:'カテゴリを管理',exact:true}).click();await page.getByLabel('カテゴリの操作').selectOption('move');await page.getByLabel('対象カテゴリ',{exact:true}).selectOption('単純');await page.getByLabel('親カテゴリ',{exact:true}).selectOption('仕事');await page.getByLabel('新しいカテゴリ名',{exact:true}).fill('移動先');await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();
 await page.getByRole('button',{name:'カテゴリを管理',exact:true}).click();await page.getByLabel('カテゴリの操作').selectOption('move');await page.getByLabel('対象カテゴリ',{exact:true}).selectOption('単純');await page.getByLabel('新しいカテゴリ名',{exact:true}).fill('改名');await page.getByRole('button',{name:'カテゴリを保存',exact:true}).click();
 await page.getByRole('button',{name:'カテゴリを管理',exact:true}).click();await page.getByLabel('カテゴリの操作').selectOption('tag');await page.getByLabel('変換先のタグ').fill('保存版');await page.getByRole('button',{name:'タグへ変換',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.operations.map(({kind,source,target})=>({kind,source,target}))),[{kind:'create',source:'単純',target:'単純 / 新しい子'},{kind:'move',source:'単純',target:'仕事 / 移動先'},{kind:'move',source:'単純',target:'改名'},{kind:'tag',source:'単純',target:'保存版'}]);
 assert.deepEqual(errors,[]);
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const mobile=await touch.newPage();mobile.setDefaultTimeout(10000);
 await mobile.goto('http://127.0.0.1:5185/canvas/__category-test.html');await mobile.locator('[data-category-path="単純"]').tap();await mobile.waitForTimeout(240);
 const mstage=await mobile.locator('.notes-category-cascade-stage').boundingBox();
 await mobile.touchscreen.tap(mstage.x+8,mstage.y+70);await mobile.waitForTimeout(240);assert.ok((await mobile.locator('.notes-category-multi-pane').first().getAttribute('class')).includes('is-focused'));assert.equal(await mobile.locator('#chosen').innerText(),'単純','first tap on covered parent only brings it forward');
 await mobile.touchscreen.tap(mstage.x+mstage.width-8,mstage.y+70);await mobile.waitForTimeout(240);assert.ok((await mobile.locator('.notes-category-multi-pane').last().getAttribute('class')).includes('is-focused'));assert.equal(await mobile.locator('#chosen').innerText(),'単純','first tap on covered child only brings it forward');
 await mobile.locator('[data-category-path="単純 / 末端A"]').tap();assert.equal(await mobile.locator('#chosen').innerText(),'単純 / 末端A');
 await mobile.locator('.notes-category-level-label').tap();await mobile.waitForTimeout(240);assert.ok((await mobile.locator('.notes-category-multi-pane').first().getAttribute('class')).includes('is-focused'));
 await mobile.evaluate(p=>window.pickCategory(p),longParts.join(' / '));await mobile.waitForFunction(()=>document.querySelector('.notes-category-breadcrumb [aria-current=page]')?.title==='長い大カテゴリの名前 / 長い第二階層の名前 / 長い第三階層の名前 / 長い第四階層の名前 / 長い末端カテゴリの名前');await mobile.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const bread=mobile.locator('.notes-category-breadcrumb');assert.ok(await bread.evaluate(n=>n.scrollLeft>0),'selected breadcrumb is scrolled into view');
 await mobile.locator('.notes-category-breadcrumb button').first().tap();assert.equal(await mobile.locator('#chosen').innerText(),'');
 await mobile.evaluate(()=>window.pickCategory('仕事 / 会議 / 企画 / 調査 / 結果'));await mobile.waitForFunction(()=>document.querySelector('.notes-category-choice[aria-current=true]')?.dataset.categoryPath==='仕事 / 会議 / 企画 / 調査 / 結果');await mobile.locator('.notes-category-level-label').last().tap();await mobile.waitForTimeout(240);assert.ok((await mobile.locator('.notes-category-multi-pane').nth(1).getAttribute('class')).includes('is-focused'));await mobile.locator('.notes-category-level-label').nth(1).tap();await mobile.waitForTimeout(240);assert.ok((await mobile.locator('.notes-category-multi-pane').first().getAttribute('class')).includes('is-focused'));
 await mobile.screenshot({path:'/tmp/kaeru-category-overlay-mobile.png'});
 console.log('PASS leaf overlays, 80% overlap, mouse parent/child switching, 5 levels, breadcrumbs, 400 roots/200 children scroll, touch switching, create/rename/move/tag commands');
 await touch.close();
 }catch(error){if(page)await page.screenshot({path:'/tmp/kaeru-category-overlay-failure.png'});throw error;}finally{await browser?.close();await server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
