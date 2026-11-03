const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 let mode='failure',requests=0;const errors=[];
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/canvas/api.php')return json({authenticated:false});
  if(url.pathname==='/canvas/build-version.json'){
   requests++;if(mode==='failure')return json({error:'not connected'},503);
   return json({commit:mode==='newer'?'bbbbbbb':'1111111',commitTime:4102444800});
  }
  const relative=url.pathname.replace(/^\/(?:canvas\/)?/,'')||'index.html';
  const file=path.resolve('public/canvas',relative);
  if(!file.startsWith(path.resolve('public/canvas')+'/')){res.writeHead(403);return res.end();}
  try{const ext=path.extname(file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/json'})[ext]||'application/octet-stream'});res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(5197,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}});page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:5197/canvas/');
  const check=page.getByRole('button',{name:'更新を確認',exact:true});await check.waitFor();
  await page.waitForFunction(()=>!document.querySelector('.canvas-update-status>button')?.disabled);
  await check.click();await page.getByRole('alert').filter({hasText:'更新を確認できません'}).waitFor();
  mode='current';await check.click();await page.getByRole('status').filter({hasText:'最新版です'}).waitFor();
  assert.match(await page.locator('.canvas-update-message').innerText(),/現在の画面 1111111／公開版 1111111/);
  mode='newer';const previous=requests;await page.evaluate(()=>window.dispatchEvent(new Event('canvas-app-resume')));
  await page.getByRole('button',{name:'更新あり',exact:true}).waitFor();assert.ok(requests>previous,'returning to the app rechecks the public version');
  assert.deepEqual(errors,[]);console.log('PASS always-visible manual update check, failed check explanation, version comparison and native resume retry');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
