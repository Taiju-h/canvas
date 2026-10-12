import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]}});
const {planCategorySync,applyClassification}=await server.ssrLoadModule('/src/lib/category-sync.ts');
const {loadOfflineWorkspace,persistOfflineWorkspace}=await server.ssrLoadModule('/src/lib/offline-workspace.ts');
const {mergeSharedNotes}=await server.ssrLoadModule('/src/lib/shared-merge.ts');
const {sameCommit}=await server.ssrLoadModule('/src/lib/web-update.ts');
after(()=>server.close());
const row={id:'a',revision:3,category:'仕事 / 開発',tags:['元'],title:'本文は変更しない'};
const move={kind:'move',source:'仕事 / 開発',target:'仕事 / 設計'};
const state={categories:['仕事','仕事 / 設計'],revision:1,pending:[move],updatedAt:1,baseCategories:['仕事','仕事 / 開発'],baseNotes:[row]};
test('independent remote folders merge and fresh note revision is used',()=>{
 const remote={categories:['仕事','仕事 / 開発','家庭'],revision:5};
 const plan=planCategorySync(state,remote,[{...row,revision:12}]);
 assert.equal(plan.conflicts.length,0);assert.ok(plan.categories.includes('家庭'));
 assert.equal(plan.updates[0].revision,12);assert.equal(plan.updates[0].category,'仕事 / 設計');
});
test('same note classification on two devices requires a visible choice',()=>{
 const plan=planCategorySync(state,{categories:['仕事','仕事 / 開発','別分類'],revision:2},[{...row,category:'別分類',revision:5}]);
 assert.ok(plan.conflicts.some(c=>c.name===row.title&&c.base.includes('開発')&&c.local.includes('設計')&&c.remote.includes('別分類')));
});
test('remote deletion of the affected namespace is a conflict',()=>{
 assert.ok(planCategorySync(state,{categories:[],revision:2},[]).conflicts.length);
});
test('an already applied move can be acknowledged without duplicate changes',()=>{
 const plan=planCategorySync(state,{categories:['仕事','仕事 / 設計'],revision:2},[{...row,category:'仕事 / 設計',revision:4}]);
 assert.equal(plan.conflicts.length,0);assert.equal(plan.updates.length,0);
});
test('new server notes within the source are included; unrelated classifications stay untouched',()=>{
 const plan=planCategorySync(state,{categories:state.baseCategories,revision:1},[row,{...row,id:'b'}, {...row,id:'c',category:'私用'}]);
 assert.deepEqual(plan.updates.map(r=>r.id),['a','b']);assert.ok(!plan.reconciled.some(r=>r.id==='c'));
});
test('local notes and chained operations are retained',()=>{
 const local={...row,id:'local-a'};
 const chained={...state,baseNotes:[local],pending:[move,{kind:'tag',source:'仕事 / 設計',target:'完了',remove:true}]};
 const plan=planCategorySync(chained,{categories:state.baseCategories,revision:1},[]);
 assert.equal(plan.reconciled[0].category,'');assert.deepEqual(plan.reconciled[0].tags,['元','完了']);
});
test('independent tag additions preserve both devices',()=>{
 const plan=planCategorySync({...state,pending:[{kind:'tag',source:'仕事 / 開発',target:'端末',remove:false}],categories:state.baseCategories},{categories:state.baseCategories,revision:1},[{...row,tags:['元','他端末']}]);
 assert.equal(plan.conflicts.length,0);assert.deepEqual(plan.updates[0].tags,['元','端末','他端末']);
});
test('older pending queues without a common base are never silently replayed',()=>{
 assert.ok(planCategorySync({...state,baseCategories:undefined,baseNotes:undefined},{categories:[],revision:4},[]).conflicts.length);
});
test('common base, pending operations and conflict decisions survive reload',()=>{
 const storage=new Map();globalThis.localStorage={setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)};
 const saved={...state,conflicts:[{name:'分類',base:'旧',local:'端末',remote:'サーバー'}],resolution:'local',conflictFingerprint:'snapshot'};
 persistOfflineWorkspace('fixture',saved);const loaded=loadOfflineWorkspace('fixture');
 assert.deepEqual(loaded.baseNotes,saved.baseNotes);assert.deepEqual(loaded.pending,saved.pending);assert.equal(loaded.conflictFingerprint,'snapshot');
});
test('metadata acknowledgement merges with local text and preserves remote metadata fields',()=>{
 const base={version:1,items:[],layers:[],grid:'none',snap:false,note:{category:'旧',tags:[]},fixedNote:{html:'元'}};
 const local={...base,note:{category:'新',tags:['端末']},fixedNote:{html:'未同期の本文'}};
 const remote={...base,note:{category:'新',tags:['他端末'],pinned:true,organizationLog:[{at:'now'}]}};
 const merged=mergeSharedNotes(base,local,remote);assert.ok(merged);
 assert.equal(merged.fixedNote.html,'未同期の本文');assert.equal(merged.note.pinned,true);assert.deepEqual(merged.note.tags,['端末','他端末']);
});
test('same text object edit still conflicts instead of overwriting a draft',()=>{
 const base={version:1,items:[],layers:[],grid:'none',snap:false,fixedNote:{html:'元'}};
 assert.equal(mergeSharedNotes(base,{...base,fixedNote:{html:'端末'}},{...base,fixedNote:{html:'他端末'}}),null);
});
test('short and full build commits do not trigger a false APK update',()=>{
 assert.ok(sameCommit('f95ded9','f95ded96580657a9c9843fba5df5ce91b7342c4f'));assert.ok(!sameCommit('f95ded9','f2b880f'));assert.ok(!sameCommit('',''));assert.ok(!sameCommit('abc','abcdefg'));
});
test('category deletion keeps notes and tags, assigning the selected surviving parent',()=>{
 const op={kind:'delete',source:'仕事 / 開発',target:'仕事'};
 const value=applyClassification({...row,category:'仕事 / 開発 / 子'},[op]);
 assert.equal(value.category,'仕事');assert.deepEqual(value.tags,row.tags);
 const deleting={...state,pending:[op],categories:['仕事']};
 const plan=planCategorySync(deleting,{categories:[...state.baseCategories,'家庭'],revision:1},[row]);
 assert.equal(plan.conflicts.length,0);assert.equal(plan.updates[0].category,'仕事');assert.ok(plan.categories.includes('家庭'));assert.ok(!plan.categories.includes('仕事 / 開発'));
});
