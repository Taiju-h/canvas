import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/lib/offline-shell.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
test('an explicit update waits for the newly installed shell rather than accepting the older active worker',async()=>{
  const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldDocument=globalThis.document,oldWindow=globalThis.window;
  let resolveUpdate,activated,updated=false,unregistered=false;
  const active={state:'activated'},installing={state:'installing',addEventListener:(type,fn)=>activated=fn,removeEventListener:()=>{}};
  const registration={active,installing:null,waiting:null,update:()=>{updated=true;return new Promise(resolve=>{resolveUpdate=()=>{registration.installing=installing;resolve();};});}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false,serviceWorker:{register:async()=>registration,getRegistrations:async()=>[{scope:'https://canvas.example/canvas/',unregister:async()=>{unregistered=true;}}]}}});
  globalThis.window={};globalThis.document={documentElement:{dataset:{}}};
  try{
    const {ensureOfflineShell}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    assert.equal(await ensureOfflineShell(),true);
    let ready=false;const update=ensureOfflineShell(true).then(()=>{ready=true;});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(updated,true);assert.equal(ready,false);
    resolveUpdate();await new Promise(resolve=>setImmediate(resolve));assert.equal(ready,false,'old active worker is insufficient while a new shell is installing');
    installing.state='activated';activated();await update;
    assert.equal(ready,true);assert.equal(unregistered,true);assert.equal(document.documentElement.dataset.offlineReady,'true');
  }finally{
    if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;
    if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
    if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
  }
});
