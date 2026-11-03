import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const script=await readFile(new URL('../src/service-worker.js',import.meta.url),'utf8');
function worker({missing}={}){
  const handlers=new Map(),stores=new Map(),requests=[],origin='https://canvas.example';
  const normal=input=>new URL(typeof input==='string'?input:input.url,origin).href;
  const caches={keys:async()=>[...stores.keys()],delete:async k=>stores.delete(k),open:async name=>{
    if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);
    return {match:async req=>entries.get(normal(req))?.clone(),put:async(req,res)=>entries.set(normal(req),res),addAll:async urls=>{
      if(urls.includes(missing))throw new Error('required file missing');
      for(const url of urls)entries.set(normal(url),new Response(url));
    }};
  }};
  const self={location:{origin},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>handlers.set(name,fn)};
  vm.runInNewContext(script,{self,caches,URL,Response,AbortController,setTimeout,clearTimeout,fetch:async req=>{
    const url=normal(req);requests.push(url);
    if(url.endsWith('offline-assets.json'))return Response.json(['/canvas/assets/main.js','/canvas/assets/main.css','/canvas/assets/pdf-support/missing-font']);
    throw new Error('network disconnected');
  }});
  async function lifecycle(name){let result;handlers.get(name)({waitUntil:p=>result=p});return result;}
  async function request(path,mode='navigate',method='GET'){
    let result;handlers.get('fetch')({request:{url:normal(path),mode,method},respondWith:p=>result=p});return result;
  }
  return{lifecycle,request,stores,requests};
}
test('an installed app starts at root and /canvas/ with the network disconnected and performs no navigation fetch',async()=>{
  const w=worker();await w.lifecycle('install');const before=w.requests.length;
  for(const path of ['/','/index.php','/canvas/','/canvas/?d=local-note','/canvas/index.html'])assert.equal(await(await w.request(path)).text(),'/canvas/index.html');
  assert.equal(w.requests.length,before,'cached startup does not wait for a server or a login redirect');
  assert.equal(await(await w.request('/canvas/assets/main.js','cors')).text(),'/canvas/assets/main.js');
});
test('missing optional PDF support does not break app installation, while a required asset blocks installation',async()=>{
  const optional=worker({missing:'/canvas/assets/pdf-support/missing-font'});await optional.lifecycle('install');
  const required=worker({missing:'/canvas/assets/main.js'});await assert.rejects(required.lifecycle('install'),/required file missing/);
});
test('private API, login and write requests never use the app shell cache',async()=>{
  const w=worker();await w.lifecycle('install');
  for(const [path,mode,method] of [['/canvas/api.php?path=session','cors','GET'],['/canvas/login.php','navigate','GET'],['/canvas/','navigate','POST']])assert.equal(await w.request(path,mode,method),undefined);
  for(const store of w.stores.values())for(const url of store.keys())assert.ok(!url.includes('.php'));
});
