import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
const {safeReferenceURL,youtubeVideoId,referenceKey,referencePinned,referenceMarkup}=await server.ssrLoadModule('/src/lib/reference-library.ts');
after(()=>server.close());

test('only HTTP links are accepted and credential URLs cannot leak into the library',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,hello','file:///tmp/private','https://user:secret@example.com/','/canvas/?d=123'])assert.equal(safeReferenceURL(url),undefined);
  assert.equal(safeReferenceURL(' https://example.com/watch?a=1&b=2 '),'https://example.com/watch?a=1&b=2');
});
test('YouTube watch, short, embed, live and mobile links are classified without accepting lookalike hosts',()=>{
  for(const url of ['https://youtu.be/AbC_123-xYz?t=12','https://www.youtube.com/watch?v=AbC_123-xYz','https://m.youtube.com/watch?v=AbC_123-xYz','https://youtube.com/shorts/AbC_123-xYz','https://youtube.com/embed/AbC_123-xYz','https://youtube.com/live/AbC_123-xYz'])assert.equal(youtubeVideoId(url),'AbC_123-xYz');
  for(const url of ['https://youtube.com.evil.example/watch?v=AbC_123-xYz','https://evil.example/AbC_123-xYz','https://youtube.com/watch?v=bad'])assert.equal(youtubeVideoId(url),undefined);
});
test('favorites are stable across JSON reloads and keep individual links separate from memo pins',()=>{
  const key=referenceKey('youtube','https://youtu.be/AbC_123-xYz'),record=JSON.parse(JSON.stringify({content:{note:{pinned:true,referencePins:[key,'image:original']}}}));
  assert.equal(referencePinned(record,'note'),true);assert.equal(referencePinned(record,key),true);assert.equal(referencePinned(record,'image:other'),false);
});
test('image insertion keeps a stable attachment reference and escaped title, without transient Blob URLs',()=>{
  const html=referenceMarkup({kind:'image',documentId:'target',title:'<原本> "写真"',asset:{id:'original',documentId:'target',kind:'file',name:'original.png'}});
  assert.ok(html.includes('data-kn-local-file="original"'));assert.ok(html.includes('%2Fapi%2Fdocuments%2Ftarget%2Ffiles%2Foriginal'));assert.ok(html.includes('&lt;原本&gt; &quot;写真&quot;'));
  assert.ok(!html.includes('blob:'));
  assert.equal(referenceMarkup({kind:'link',url:'javascript:alert(1)',title:'unsafe'}),'');
  assert.ok(referenceMarkup({kind:'note',documentId:'local-abc',title:'参照'}).includes('d=local-abc'));
});
