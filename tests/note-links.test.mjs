import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
const {noteLinkURL,safeReferenceURL}=await server.ssrLoadModule('/src/lib/note-links.ts');
const {crmLinks}=await server.ssrLoadModule('/src/lib/crm-links.ts');
const {referenceMarkup}=await server.ssrLoadModule('/src/lib/reference-library.ts');
after(()=>server.close());

test('editor links allow explicit web, mail, phone and note URLs while rejecting executable, credential and mistyped URLs',()=>{
  const base='https://canvas.example/canvas/';
  for(const value of ['javascript:alert(1)','data:text/html,hello','blob:https://canvas.example/a','file:///private','https://user:secret@example.com/','not a URL','example.com'])assert.equal(noteLinkURL(value,base),undefined,value);
  assert.equal(noteLinkURL('www.example.com',base),'https://www.example.com/');
  assert.equal(noteLinkURL('/canvas/?d='+'a'.repeat(32),base),base+'?d='+'a'.repeat(32));
  assert.equal(noteLinkURL('mailto:hello@example.com',base),'mailto:hello@example.com');
  assert.equal(noteLinkURL('tel:+8112345678',base),'tel:+8112345678');
  assert.equal(safeReferenceURL('https://crm.example/customers/1'),'https://crm.example/customers/1');
});
test('CRM associations survive JSON storage with their entity type and keep unsafe or duplicate records out',()=>{
  const good={id:'customer-1',label:'サンプル社',url:'https://crm.example/customers/1',kind:'customer'};
  const data=JSON.parse(JSON.stringify([good,good,{...good,id:'bad-url',url:'javascript:alert(1)'},{...good,id:'credential',url:'https://user:secret@crm.example/'},{...good,id:'bad-kind',kind:'__proto__'},null]));
  assert.deepEqual(crmLinks(data),[good]);assert.deepEqual(crmLinks(undefined),[]);
  assert.equal(crmLinks(Array.from({length:55},(_,i)=>({...good,id:String(i)}))).length,50);
});
test('linked media keeps its own source and stable attachment when the click target changes',()=>{
  for(const kind of ['image','video']){
    const html=referenceMarkup({kind,documentId:'target',title:'原本',asset:{id:'original',kind:'file',name:'asset'},targetURL:'https://example.com/detail?x=1&y=2'});
    assert.ok(html.includes('<a href="https://example.com/detail?x=1&amp;y=2"'));
    assert.ok(html.includes('data-kn-local-file="original"'));assert.ok(html.includes('%2Fapi%2Fdocuments%2Ftarget%2Ffiles%2Foriginal'));
    assert.ok(!html.includes('blob:'));if(kind==='video')assert.ok(!html.includes(' controls'));
  }
  const html=referenceMarkup({kind:'video',documentId:'target',title:'動画',url:'https://media.example/clip.webm',targetURL:'javascript:alert(1)'});
  assert.ok(html.includes(' controls'));assert.ok(!html.includes('<a'));
});
