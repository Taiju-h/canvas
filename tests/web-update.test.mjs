import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {prepareWebUpdate} from '../src/lib/web-update.ts';

const originalWindow=globalThis.window;
afterEach(()=>{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;});
function storageWaits(...waits){
  globalThis.window={dispatchEvent:event=>{assert.equal(event.type,'kaerunote-before-web-update');waits.forEach(promise=>event.detail.waitUntil(promise));return true;}};
}
test('Web update waits for every registered local save before switching',async()=>{
  let savedA,savedB;
  storageWaits(new Promise(resolve=>savedA=resolve),new Promise(resolve=>savedB=resolve));
  let ready=false;const update=prepareWebUpdate().then(()=>ready=true);
  savedA();await new Promise(resolve=>setImmediate(resolve));assert.equal(ready,false);
  savedB();await update;assert.equal(ready,true);
});
test('a failed local save blocks Web update and a later retry is allowed',async()=>{
  storageWaits(Promise.reject(new Error('端末への保存失敗')));
  await assert.rejects(prepareWebUpdate(),/端末への保存失敗/);
  storageWaits(Promise.resolve());await prepareWebUpdate();
});
test('a stalled local save times out instead of leaving an unresponsive update button',async()=>{
  storageWaits(new Promise(()=>{}));
  await assert.rejects(prepareWebUpdate(20),/保存確認に時間がかかっています/);
  storageWaits();await prepareWebUpdate();
});
