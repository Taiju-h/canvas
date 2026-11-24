import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const scratch=mkdtempSync(join(tmpdir(),'kaeru-private-api-')),config=join(scratch,'config.ini'),stateFile=join(scratch,'state.json');
const owner='a'.repeat(32),doc='c'.repeat(32),foreign='d'.repeat(32),share='9'.repeat(64);
const hash=value=>createHash('sha256').update(value).digest('hex');
const invite=()=>randomBytes(16).toString('hex');let code=invite();
const initial={version:1,owner_id:owner,rate_salt:randomBytes(32).toString('hex'),devices:{},invites:{[hash(code)]:{created_at:Date.now(),expires_at:Date.now()+60000}}};
const db=process.env.CANVAS_PRIVATE_TEST_DB==='1';
writeFileSync(config,`[mysql]\nhost=127.0.0.1\nport=${process.env.CANVAS_TEST_MYSQL_PORT||3306}\ndatabase=canvas_private_test\nuser=root\npassword=fixture-only\n[auth]\npepper=${'0'.repeat(64)}\n[private_access]\nenabled=true\nowner_id=${owner}\n`);
writeFileSync(stateFile,JSON.stringify(initial));mkdirSync(join(scratch,'sessions'));
const env={...process.env,CANVAS_CONFIG_FILE:config,CANVAS_PRIVATE_STATE_FILE:stateFile};
if(db){const seed=spawnSync('php',['tests/private-access-seed.php'],{env,encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);}
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const base=`http://127.0.0.1:${port}`,php=spawn('php',['-d','display_errors=0','-d',`session.save_path=${join(scratch,'sessions')}`,'-S',`127.0.0.1:${port}`,'tests/private-access-router.php'],{env:{...env,PHP_CLI_SERVER_WORKERS:'4'},stdio:['ignore','ignore','pipe']});
let logs='';php.stderr.on('data',b=>logs+=b.toString());
function client(userAgent='private-device-test'){
  const jar=new Map();return {jar,async request(path,{method='GET',body,csrf,headers={}}={}){
    const url=path.startsWith('/test/')||path.includes('.php')?path:'/canvas/api.php?path='+encodeURIComponent(path);
    const response=await fetch(base+url,{method,redirect:'manual',headers:{'User-Agent':userAgent,Cookie:[...jar].map(([k,v])=>k+'='+v).join(';'),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
    for(const raw of response.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{}
    return {status:response.status,headers:response.headers,data,text};
  }};
}
const status=async(promise,expected)=>{const r=await promise;assert.equal(r.status,expected,r.text);return r;};
const activate=async(c,inviteCode,name='My device')=>{const s=await status(c.request('/api/session'),200);return c.request('/api/private/activate',{method:'POST',csrf:s.data.csrfToken,body:{code:inviteCode,name}});};
const readState=()=>JSON.parse(readFileSync(stateFile,'utf8'));
try{
  let ready=false;for(let i=0;i<100;i++){try{await client().request('/api/session');ready=true;break;}catch{await delay(30);}}assert.ok(ready,logs);
  const stranger=client();let session=await status(stranger.request('/api/session'),200);assert.equal(session.data.privateAccess,true);assert.equal(session.data.authenticated,false);
  for(const path of ['/api/documents','/api/notes-index','/api/note-workspace',`/api/documents/${doc}`,`/api/documents/${doc}/images/${'e'.repeat(32)}`,`/api/documents/${doc}/files/${'8'.repeat(32)}`,'/api/private/devices','/api/ai'])await status(stranger.request(path,{headers:{'X-Share-Token':share}}),401);
  await status(stranger.request('/api/visitor',{method:'POST',csrf:session.data.csrfToken,body:{nickname:'bypass',visitorToken:'1'.repeat(64)}}),401);
  await status(stranger.request('/test/legacy'),200);
  await status(stranger.request(`/api/documents/${foreign}/images/${'f'.repeat(32)}`,{headers:{'X-Share-Token':share}}),401);
  await status(stranger.request('/canvas/login.php'),303);await status(stranger.request('/canvas/admin-visitors.php'),403);
  await status(stranger.request('/api/private/activate',{method:'POST',body:{code,name:'no csrf'}}),403);
  await status(stranger.request('/api/private/activate',{method:'POST',csrf:session.data.csrfToken,body:{code,name:'no HTTPS'},headers:{Host:'example.test'}}),400);
  await status(stranger.request('/api/private/activate',{method:'POST',csrf:session.data.csrfToken,body:{code:[],name:'bad input'}}),400);
  const expired=invite(),expiredState=readState();expiredState.invites[hash(expired)]={created_at:1,expires_at:2};writeFileSync(stateFile,JSON.stringify(expiredState));await status(activate(stranger,expired,'expired code'),400);
  await status(activate(stranger,invite(),'wrong code'),400);assert.equal(Object.keys(readState().devices).length,0);

  const old=client('KaeruNoteAndroid/0.4.5-web-shell');assert.equal((await old.request('/api/session')).data.upgradeRequired,true);await status(activate(old,code),426);
  const first=client('KaeruNoteAndroid/0.4.6-private'),second=client();
  const before=await first.request('/api/session'),previousSession=first.jar.get('uzero_canvas_session');
  const registered=await status(first.request('/api/private/activate',{method:'POST',csrf:before.data.csrfToken,body:{code,name:'My Android'}}),200);
  assert.equal(registered.data.accountId,owner);assert.equal(registered.data.deviceAuthorized,true);
  assert.notEqual(first.jar.get('uzero_canvas_session'),previousSession);assert.notEqual(registered.data.csrfToken,before.data.csrfToken);
  const cookie=registered.headers.getSetCookie().find(v=>v.startsWith('__Secure-kn_device='));
  for(const flag of ['Secure','HttpOnly','SameSite=Strict','path=/canvas/'])assert.ok(cookie.toLowerCase().includes(flag.toLowerCase()),flag);
  assert.ok(!JSON.stringify(registered.data).includes(first.jar.get('__Secure-kn_device')),'The secret is never exposed to JavaScript');
  assert.ok(!readFileSync(stateFile,'utf8').includes(first.jar.get('__Secure-kn_device').split('.')[1]),'Only token hashes are stored');
  assert.ok(!readFileSync(stateFile,'utf8').includes(code),'Plain registration codes are not stored');
  await status(activate(second,code),400);assert.equal(Object.keys(readState().devices).length,1);
  await status(first.request('/test/legacy'),200);assert.equal((await first.request('/test/actor')).data.actor,owner,'Legacy user IDs cannot override the canonical owner');
  await status(first.request('/api/visitor',{method:'POST',csrf:registered.data.csrfToken,body:{nickname:'bypass'}}),403);
  await status(first.request(`/api/documents/${doc}/share`,{method:'POST',csrf:registered.data.csrfToken,body:{}}),403);
  await status(first.request('/api/private/devices',{method:'POST',body:{action:'invite'}}),403);
  let invitation=(await status(first.request('/api/private/devices',{method:'POST',csrf:registered.data.csrfToken,body:{action:'invite'}}),200)).data.code;
  // Separate PHP workers and sessions compete for the same one-use code.
  const racers=[client(),client()];const raced=await Promise.all(racers.map((c,i)=>activate(c,invitation,'PC '+i)));
  assert.deepEqual(raced.map(r=>r.status).sort(),[200,400]);const winner=racers[raced[0].status===200?0:1];
  assert.equal((await winner.request('/api/session')).data.accountId,owner);
  const devices=await status(first.request('/api/private/devices'),200);assert.equal(devices.data.devices.length,2);assert.ok(!devices.text.includes('token_hash'));
  if(db){
    const own=await status(first.request('/api/documents'),200);assert.deepEqual(own.data.documents.map(d=>d.id),[doc]);
    await status(winner.request(`/api/documents/${doc}`),200);
    assert.equal((await status(first.request(`/api/documents/${doc}/images/${'e'.repeat(32)}`),200)).text,'synthetic-image-c');
    assert.equal((await status(first.request(`/api/documents/${doc}/files/${'8'.repeat(32)}`),200)).text,'synthetic-attachment-c');
    // Even an enrolled device with an old member/share session cannot cross into another owner's data.
    for(const path of [`/api/documents/${foreign}`,`/api/documents/${foreign}/images/${'f'.repeat(32)}`,`/api/documents/${foreign}/files/${'8'.repeat(32)}`])await status(first.request(path,{headers:{'X-Share-Token':share}}),403);
  }
  const winnerId=(await winner.request('/api/session')).data.deviceId;
  await status(first.request('/api/private/devices',{method:'POST',csrf:registered.data.csrfToken,body:{action:'revoke',id:winnerId}}),200);
  await status(winner.request('/test/actor'),401);await status(winner.request('/api/private/devices'),401);
  assert.equal((await first.request('/api/session')).data.deviceAuthorized,true);
  // Expiry and revocation are checked from live server state on every request.
  const state=readState();state.devices[registered.data.deviceId].expires_at=Date.now()-1;writeFileSync(stateFile,JSON.stringify(state));await status(first.request('/test/actor'),401);
  writeFileSync(stateFile,'incomplete');await status(stranger.request('/api/session'),503);await status(first.request('/test/actor'),503);
  writeFileSync(stateFile,JSON.stringify({...initial,owner_id:'b'.repeat(32)}));await status(stranger.request('/api/session'),503);
  writeFileSync(stateFile,JSON.stringify(initial));const attempts=client();let last;
  for(let i=0;i<14;i++)last=await activate(attempts,'bad-code');assert.equal(last.status,429);
  if(db){
    const setupConfig=join(scratch,'setup.ini'),setupState=join(scratch,'setup','state.json'),setupEnv={...env,CANVAS_CONFIG_FILE:setupConfig,CANVAS_PRIVATE_STATE_FILE:setupState};
    writeFileSync(setupConfig,readFileSync(config,'utf8').replace('enabled=true','enabled=false'));
    const invalid=spawnSync('php',['bin/personal-access.php','setup'],{env:setupEnv,input:'999\n',encoding:'utf8'});assert.equal(invalid.status,1);assert.equal(existsSync(setupState),false);
    const setup=spawnSync('php',['bin/personal-access.php','setup'],{env:setupEnv,input:'1\n',encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
    const selected=JSON.parse(readFileSync(setupState,'utf8'));assert.equal(selected.owner_id,owner);assert.equal(Object.keys(selected.invites).length,1);assert.match(readFileSync(setupConfig,'utf8'),new RegExp('pepper='+ '0'.repeat(64)));
    const previous=readFileSync(setupState,'utf8'),repeat=spawnSync('php',['bin/personal-access.php','setup'],{env:setupEnv,encoding:'utf8'});assert.equal(repeat.status,1);assert.equal(readFileSync(setupState,'utf8'),previous);
    const extra=spawnSync('php',['bin/personal-access.php','invite'],{env:setupEnv,encoding:'utf8'});assert.equal(extra.status,0,extra.stderr);assert.equal(Object.keys(JSON.parse(readFileSync(setupState,'utf8')).invites).length,2);
  }
  console.log('PASS private API: stranger/legacy/share denial, one-use concurrent enrollment, CSRF, cookie flags, owner mapping, expiry, revocation, rate limiting, corrupt-state denial'+(db?', MySQL note/image/attachment isolation':''));
}finally{
  php.kill('SIGTERM');await new Promise(r=>{if(php.exitCode!==null)r();else php.once('exit',r);});rmSync(scratch,{recursive:true,force:true});
  if(db)for(const id of [doc,foreign])rmSync(resolve('var/attachments',id),{recursive:true,force:true});
}
