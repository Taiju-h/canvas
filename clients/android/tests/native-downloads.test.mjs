import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../app/src/main/assets/native-downloads.js',import.meta.url),'utf8');
function harness(blobs) {
  const messages=[], files=[], events=[], clicks=[], listeners={};
  let transfer=null;
  const bridge={postMessage(raw) {
    const message=JSON.parse(raw); messages.push(message);
    const reply=error=>queueMicrotask(()=>bridge.onmessage({data:JSON.stringify({id:message.id,error})}));
    if(message.action==='begin') {
      assert.equal(transfer,null,'exports must be serialized until the save dialog completes');
      transfer={...message,chunks:[]}; reply();
    } else if(message.action==='chunk') {
      assert.equal(message.offset,transfer.chunks.reduce((total,b)=>total+b.length,0));
      const chunk=Buffer.from(message.data,'base64');assert.ok(chunk.length<=262144);transfer.chunks.push(chunk);reply();
    } else if(message.action==='finish') {
      assert.equal(Buffer.concat(transfer.chunks).length,transfer.size);
      const cancelled=transfer.name==='cancel.txt';
      if (!cancelled) files.push({...transfer,bytes:Buffer.concat(transfer.chunks)});
      transfer=null;
      setTimeout(()=>reply(cancelled?'保存を取り消しました':undefined),5);
    }
  }};
  class Anchor { click(){clicks.push(this.href);} hasAttribute(name){return name==='download'&&this.download!==undefined;} }
  class Reader { readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result='data:;base64,'+Buffer.from(bytes).toString('base64');this.onload();});} }
  const window={CanvasDownloads:bridge,dispatchEvent:event=>events.push(event)};
  const context={window,CanvasDownloads:bridge,HTMLAnchorElement:Anchor,FileReader:Reader,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},document:{addEventListener:(type,fn)=>{listeners[type]=fn;}},fetch:async url=>({ok:blobs.has(url),blob:async()=>blobs.get(url)})};
  vm.runInNewContext(script,context);
  return {window,Anchor,messages,files,events,clicks,listeners,context};
}
test('exports binary files in bounded chunks and queues the next save dialog',async()=>{
  const binary=Buffer.alloc(600000);for(let i=0;i<binary.length;i++)binary[i]=i%256;
  const h=harness(new Map([['blob:binary',new Blob([binary],{type:'application/octet-stream'})],['blob:text',new Blob(['日本語の本文'],{type:'text/plain'})]]));
  await Promise.all([h.window.__kaeruSaveBlob('blob:binary','image.png'),h.window.__kaeruSaveBlob('blob:text','メモ.txt')]);
  assert.equal(h.files.length,2);assert.deepEqual(h.files[0].bytes,binary);assert.equal(h.files[1].bytes.toString(),'日本語の本文');
  assert.equal(h.messages.filter(m=>m.action==='chunk'&&m.id==='1').length,3);assert.deepEqual(h.events,[]);
});
test('captures programmatic and attached local download links; leaves network links intact',async()=>{
  const h=harness(new Map([['blob:test',new Blob(['document'])]]));
  const a=new h.Anchor();a.href='blob:test';a.download='report.docx';a.click();
  await new Promise(r=>setTimeout(r,20));assert.equal(h.files[0].name,'report.docx');
  let prevented=false;h.listeners.click({target:{closest:()=>a},preventDefault(){prevented=true;}});
  await new Promise(r=>setTimeout(r,20));assert.ok(prevented);assert.equal(h.files.length,2);
  const network=new h.Anchor();network.href='https://canvas.uzero.style/file.php';network.download='file.pdf';network.click();
  assert.deepEqual(h.clicks,[network.href]);
  vm.runInNewContext(script,h.context);a.click();await new Promise(r=>setTimeout(r,20));assert.equal(h.files.length,3,'hook installation must be idempotent');
});
test('failed blob retrieval reports an error and does not block the next export',async()=>{
  const h=harness(new Map([['blob:ok',new Blob(['ok'])]]));
  await h.window.__kaeruSaveBlob('blob:missing','missing');await h.window.__kaeruSaveBlob('blob:ok','ok');
  assert.equal(h.events[0].type,'canvas-download-failed');assert.equal(h.files.length,1);
});
test('empty and data URL files use the same save path',async()=>{
  const h=harness(new Map([['data:test',new Blob([])]]));await h.window.__kaeruSaveBlob('data:test','empty.txt');
  assert.equal(h.files[0].bytes.length,0);
});

test('cancelled save dialog releases the queue for the next file',async()=>{
  const h=harness(new Map([['blob:test',new Blob(['test'])]]));
  await Promise.all([h.window.__kaeruSaveBlob('blob:test','cancel.txt'),h.window.__kaeruSaveBlob('blob:test','next.txt')]);
  assert.equal(h.files.length,1);assert.equal(h.files[0].name,'next.txt');
  assert.match(h.events[0].detail,/取り消し/);
});
