import {test,after,afterEach,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
const {readSession,cacheSession,cachedSession,localSession,requiresPrivateGate}=await server.ssrLoadModule('/src/lib/offline-session.ts');
const {revokePrivateDevice}=await server.ssrLoadModule('/src/lib/private-devices.ts');
const descriptors=Object.fromEntries(['window','localStorage','navigator','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
let values;
beforeEach(()=>{
  values=new Map();Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
});
afterEach(()=>{for(const [key,descriptor] of Object.entries(descriptors)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
after(()=>server.close());
const enrolled=()=>({authenticated:true,accountId:'a'.repeat(32),privateAccess:true,deviceAuthorized:true,deviceId:'b'.repeat(32),csrfToken:'csrf'});
const remote=(value,status=200)=>{globalThis.fetch=async()=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});};
const offline=()=>{navigator.onLine=false;globalThis.fetch=async()=>{throw new TypeError('offline');};};
test('new private APK rejects a legacy login cache and cannot create a bypass notebook offline',async()=>{
  cacheSession({authenticated:true,accountId:'legacy',csrfToken:'old'});window.CanvasApp={requiresDeviceRegistration:()=>true};offline();
  assert.equal(requiresPrivateGate(await readSession()),true);assert.equal(requiresPrivateGate(localSession()),true);
  assert.equal(values.has('canvasDeviceAccount'),false);
});
test('an enrolled Android, PC or iPad may cold-start its saved data offline',async()=>{
  cacheSession(enrolled());offline();const result=await readSession();
  assert.equal(result.accountId,enrolled().accountId);assert.equal(result.localOnly,true);assert.equal(requiresPrivateGate(result),false);
});
test('a live revocation replaces the cached grant and does not fall back to local access',async()=>{
  cacheSession(enrolled());remote({privateAccess:true,deviceAuthorized:false,authenticated:false,csrfToken:'new'});
  assert.equal(requiresPrivateGate(await readSession()),true);assert.equal(cachedSession().authenticated,false);
  offline();assert.equal(requiresPrivateGate(await readSession()),true);assert.equal(localSession().authenticated,false);
});
test('a private server error fails closed without modifying the saved notes',async()=>{
  values.set('unchanged-note-marker','pending local data');cacheSession(enrolled());remote({privateAccess:true,error:'state unavailable'},503);
  assert.equal(requiresPrivateGate(await readSession()),true);assert.equal(values.get('unchanged-note-marker'),'pending local data');
});
test('network failures preserve enrolled offline editing; a forced recheck cannot revoke a grant',async()=>{
  cacheSession(enrolled());globalThis.fetch=async()=>{throw new TypeError('unreachable');};
  assert.equal((await readSession()).localOnly,true);await assert.rejects(readSession(true),/unreachable/);
  assert.equal(cachedSession().deviceAuthorized,true);
});
test('an unconfigured server cannot authenticate the private shell with its old public login',async()=>{
  window.CanvasApp={requiresDeviceRegistration:()=>true};remote({authenticated:true,accountId:'old-owner',csrfToken:'old'});
  const result=await readSession();assert.equal(result.setupRequired,true);assert.equal(result.authenticated,false);assert.equal(localSession().authenticated,false);
});
test('old Android upgrade denial also blocks previously cached offline authorization',async()=>{
  cacheSession(enrolled());remote({privateAccess:true,authenticated:false,deviceAuthorized:false,upgradeRequired:true,minimumAndroidVersion:'0.4.6'});
  assert.equal((await readSession()).upgradeRequired,true);assert.equal(localSession().authenticated,false);
});
test('confirming this device revocation clears its offline grant before any follow-up request',async()=>{
  cacheSession(enrolled());const events=[];window.dispatchEvent=e=>events.push(e.type);
  remote({currentRevoked:true});assert.equal((await revokePrivateDevice('csrf',enrolled().deviceId)).currentRevoked,true);
  offline();assert.equal(cachedSession().authenticated,false);assert.equal(localSession().authenticated,false);
  assert.deepEqual(events,['kaerunote-device-denied']);
});
test('the existing public deployment retains its previous local-only fallback',async()=>{
  cacheSession({authenticated:true,accountId:'legacy'});remote({authenticated:false});
  assert.equal((await readSession()).authenticated,false);assert.equal(localSession().accountId,'legacy');
});
