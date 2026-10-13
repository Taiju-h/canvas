import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateLegacyNoteBody} from '../src/lib/note-body-migration.ts';
import {mergeSharedNotes} from '../src/lib/shared-merge.ts';

const body={id:'old-body',x:80,y:80,w:660,h:240,html:'<p><b>編集済み本文</b><ruby>字<rt>じ</rt></ruby></p><img data-kn-local-image="original-image"><a data-kn-local-file="original-file" href="#">原本</a>'};
const legacy=()=>({version:1,grid:'none',snap:false,items:[{id:'shape',kind:'rect',layerId:'ink',x:50,y:50,w:10,h:10}],layers:[{id:'ink',name:'メモ',visible:true,locked:false}],blocks:[{...body}],paintStrokes:[],attachments:[{id:'original-file',name:'原本.pdf',mime:'application/pdf',size:12}],note:{category:'親 / 子',tags:['元'],sourceId:'joplin-source',sourceMarkdown:'取り込み時の古い本文',sourceNotebook:'元のフォルダ',sourceCreated:'2025-01-01',importState:'complete'}});

test('old JEX body moves into Note without rebuilding or losing attachments and metadata',()=>{
  const input=legacy(),before=JSON.stringify(input),result=migrateLegacyNoteBody(input);
  assert.equal(result.fixedNote.html,body.html);assert.deepEqual(result.legacyNoteBody.block,body);assert.deepEqual(result.blocks,[]);
  for(const key of ['items','layers','paintStrokes','attachments','note'])assert.deepEqual(result[key],input[key]);
  assert.equal(JSON.stringify(input),before,'reading must not modify the source record');
  assert.equal(migrateLegacyNoteBody(result),result,'migration is idempotent');
});
test('new Note content is authoritative, including image-only content',()=>{
  for(const html of ['<p>新しい本文</p>','<img data-kn-local-image="new-image">']){
    const input={...legacy(),fixedNote:{html,visible:true,locked:false}};assert.equal(migrateLegacyNoteBody(input),input);
  }
});
test('empty Note placeholders allow recovery of the edited old body and preserve other layout text',()=>{
  const extra={...body,id:'layout',html:'別の文章ボックス',x:700},input={...legacy(),fixedNote:{html:'<p><br></p>',visible:true,locked:false},blocks:[{...body},extra]};
  const result=migrateLegacyNoteBody(input);assert.equal(result.fixedNote.html,body.html);assert.deepEqual(result.blocks,[extra]);
});
test('old primary Notes migrate but modern layout boxes and annotated geometry remain intact',()=>{
  const old={...legacy(),note:{category:'仕事',tags:[]}};assert.equal(migrateLegacyNoteBody(old).fixedNote.html,body.html);
  const modern={...old,fixedNote:{html:'',visible:true,locked:false},blocks:[{...body,layerId:'layout'}]};assert.equal(migrateLegacyNoteBody(modern),modern);
  const importedLayout={...legacy(),fixedNote:{html:'',visible:true,locked:false},blocks:[{...body,layerId:'layout'}]};assert.equal(migrateLegacyNoteBody(importedLayout),importedLayout,'clearing a modern JEX Note must not turn a separate layout box into its body');
  const annotated={...legacy(),paintStrokes:[{id:'ink',blockId:body.id,layerId:'ink',points:[{x:2,y:2}],color:'#000',width:3,opacity:1}]};assert.equal(migrateLegacyNoteBody(annotated),annotated);
});
test('source layer visibility and locking are retained',()=>{
  const input=legacy();input.layers[0].visible=false;input.layers[0].locked=true;
  const result=migrateLegacyNoteBody(input);assert.equal(result.fixedNote.visible,false);assert.equal(result.fixedNote.locked,true);
});
test('normalized old-body edits retain three-way merge and detect concurrent body conflicts',()=>{
  const base=migrateLegacyNoteBody(legacy()),local={...base,fixedNote:{...base.fixedNote,html:'端末の編集'}};
  const remote=migrateLegacyNoteBody({...legacy(),note:{...legacy().note,category:'他端末の分類'}});
  const merged=mergeSharedNotes(base,local,remote);assert.equal(merged.fixedNote.html,'端末の編集');assert.equal(merged.note.category,'他端末の分類');assert.deepEqual(merged.legacyNoteBody,base.legacyNoteBody);
  const conflicting=legacy();conflicting.blocks[0].html='他端末の本文';assert.equal(mergeSharedNotes(base,local,migrateLegacyNoteBody(conflicting)),null);
});
