import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]}});
const {workspaceCommand}=await server.ssrLoadModule('/src/lib/workspace-shortcuts.ts');
const {selectionClipboard,parseSelectionClipboard,pasteSelection,SELECTION_PREFIX}=await server.ssrLoadModule('/src/lib/selection-clipboard.ts');
const {splitInkSelection}=await server.ssrLoadModule('/src/lib/canvas-ink.ts');
after(()=>server.close());
const command=(key,opts={},mode='canvas',editable=false)=>workspaceCommand({key,...opts},{mode,editable});
test('Windows and Mac commands keep native text editing, browser shortcuts and IME intact',()=>{
 for(const modifier of ['ctrlKey','metaKey']){
  assert.equal(command('z',{[modifier]:true}),'undo');assert.equal(command('Z',{[modifier]:true,shiftKey:true}),'redo');
  assert.equal(command('a',{[modifier]:true}),'all');assert.equal(command('d',{[modifier]:true}),'deselect');assert.equal(command('j',{[modifier]:true}),'duplicate');
  assert.equal(command('s',{[modifier]:true},'note',true),'save');assert.equal(command('z',{[modifier]:true},'canvas',true),null);
 }
 assert.equal(command('y',{ctrlKey:true}),'redo');
 for(const key of ['Delete','Backspace','ArrowDown','e',' '])assert.equal(command(key,{},'canvas',true),null);
 assert.equal(command('a',{ctrlKey:true},'note'),null);assert.equal(command('v',{ctrlKey:true},'excel'),null);
 assert.equal(command('e',{isComposing:true}),null);assert.equal(command('z',{ctrlKey:true,keyCode:229}),null);assert.equal(command('ArrowLeft',{altKey:true}),null);
 assert.equal(command('r',{ctrlKey:true}),null);assert.equal(command('w',{ctrlKey:true}),null);
 for(const [key,want] of [['B','brush'],['E','eraser'],['L','lasso'],['V','move'],['H','hand'],[' ','pan'],['[','smaller'],[']','larger'],['?','help'],['Escape','deselect'],['Delete','delete']])assert.equal(command(key),want);
});
const stroke={id:'ink',layerId:'canvas',points:[{x:10,y:50,p:.2},{x:110,y:50,p:.8}],color:'#123456',width:10,opacity:.7,brush:'pencil'};
const doc=()=>({version:1,grid:'none',snap:false,layers:[{id:'canvas',visible:true,locked:false},{id:'layout',studioKind:'layout',visible:true,locked:false}],items:[{id:'image',kind:'image',layerId:'layout',x:20,y:30,w:80,h:90,width:1,color:'#000',imageId:'asset',clip:{x:30,y:40,w:50,h:60}}],paintStrokes:[stroke],blocks:[{id:'text',layerId:'layout',x:20,y:180,w:200,h:140,html:'<p>選択した文章</p>'}],fixedNote:{html:'<p>コピーしない原本</p>'},note:{category:'保持'},attachments:[{id:'original-file'}]});
test('partial Canvas clipboard retains pressure and masks, independent identities and the source document',()=>{
 const source=doc(),before=structuredClone(source),outline=[{x:30,y:20},{x:60,y:20},{x:60,y:80},{x:30,y:80}];
 const split=splitInkSelection(source,{layerId:'canvas',points:outline},()=>'inner'),value=selectionClipboard(split.doc,'source','canvas',split.ids,outline);
 assert.equal(value.paintStrokes.length,1);assert.equal(value.paintStrokes[0].inkMasks[0].kind,'include');assert.equal(value.fixedNote,undefined);assert.equal(value.attachments,undefined);
 const parsed=parseSelectionClipboard(SELECTION_PREFIX+JSON.stringify(value));assert.ok(parsed);let id=0;
 const pasted=pasteSelection(source,parsed,'canvas',()=>`new-${id++}`,40,20);
 assert.equal(pasted.content.paintStrokes.length,2);const ink=pasted.content.paintStrokes.at(-1);assert.notEqual(ink.id,'inner');assert.equal(ink.points[0].p,.2);assert.equal(ink.points[0].x,50);assert.deepEqual(ink.inkMasks,value.paintStrokes[0].inkMasks);
 assert.deepEqual(pasted.content.fixedNote,source.fixedNote);assert.deepEqual(pasted.content.attachments,source.attachments);assert.deepEqual(source,before);
});
test('Layout paste moves clips and text together and remaps only selected block anchors',()=>{
 const source=doc();source.paintStrokes=[{...stroke,layerId:'layout',blockId:'text'}];const value=selectionClipboard(source,'source','layout',['image','ink','text'],[]);let n=0;
 const pasted=pasteSelection(source,value,'target',()=>`copy-${n++}`);const image=pasted.content.items.at(-1),block=pasted.content.blocks.at(-1),ink=pasted.content.paintStrokes.at(-1);
 assert.equal(image.layerId,'target');assert.equal(image.clip.x,54);assert.equal(image.x,44);assert.equal(block.x,44);assert.equal(ink.blockId,block.id);assert.deepEqual(pasted.ids,[image.id,ink.id,block.id]);
 const single=selectionClipboard(source,'source','layout',['ink'],[]);assert.equal(pasteSelection(source,single,'target',()=>`copy-${n++}`).content.paintStrokes.at(-1).blockId,undefined);
});
test('invalid or foreign clipboard content falls through to ordinary paste',()=>{
 for(const text of ['ordinary text','{}',SELECTION_PREFIX+'broken','null'])assert.equal(parseSelectionClipboard(text),null);
 const value=selectionClipboard(doc(),'source','canvas',['ink'],[]);value.paintStrokes[0].points[0].x=Infinity;assert.equal(parseSelectionClipboard(JSON.stringify(value)),null);
});
