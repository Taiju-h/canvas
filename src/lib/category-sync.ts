import {categoryPaths,inCategory,movedCategory} from './note-organization';
import {locallyApplyCategory,type OfflineWorkspace} from './offline-workspace';
import type {CategoryOperation} from '../components/note-categories';

export type Classification={id:string;category:string;tags:string[];revision:number;title?:string};
export type CategoryConflict={name:string;base:string;local:string;remote:string};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const describe=(n:Pick<Classification,'category'|'tags'>)=>`${n.category||'未分類'} / タグ：${n.tags.join(', ')||'なし'}`;
export function applyClassification(note:Classification,operations:CategoryOperation[]):Classification{
  let value={...note,tags:[...note.tags]};
  for(const op of operations){
    if(op.kind==='create'||!inCategory(value.category,op.source))continue;
    if(op.kind==='move')value.category=movedCategory(value.category,op.source,op.target);
    else if(op.kind==='delete')value.category=op.target;
    else{value.tags=[...new Set([...value.tags,op.target])];if(op.remove)value.category='';}
  }
  return value;
}
/** A stable common base is kept until the whole atomic metadata transaction succeeds. */
export function planCategorySync(state:OfflineWorkspace,remote:{categories:string[];revision:number},rows:Classification[],localRows:Classification[]=[]){
  const conflicts:CategoryConflict[]=[];
  const base=state.baseCategories;
  if(!base||!state.baseNotes){
    conflicts.push({name:'変更前の分類がない旧端末データ',base:'不明',local:state.categories.join('\n'),remote:remote.categories.join('\n')});
  }else{
    const scopes=state.pending.flatMap(op=>op.kind==='create'?[op.target]:op.kind==='move'?[op.source,op.target]:[op.source]);
    const affected=(paths:string[])=>categoryPaths(paths).filter(p=>scopes.some(scope=>inCategory(p,scope)));
    const before=affected(base),server=affected(remote.categories),local=affected(state.categories);
    if(!same(before,server)&&!same(local,server))conflicts.push({name:'カテゴリ階層',base:before.join('\n')||'なし',local:local.join('\n')||'なし',remote:server.join('\n')||'なし'});
  }
  const known=new Map((state.baseNotes||[]).map(n=>[n.id,n]));
  const updates:Classification[]=[];
  const reconciled:Classification[]=[];
  for(const row of rows){
    const old=known.get(row.id),local=localRows.find(n=>n.id===row.id)||applyClassification(old||row,state.pending);
    const changed=old&&!same({category:old.category,tags:old.tags},{category:local.category,tags:local.tags});
    const remoteChanged=old&&old.category!==row.category;
    if(changed&&remoteChanged&&old.category!==local.category&&local.category!==row.category){
      conflicts.push({name:row.title||row.id,base:describe(old),local:describe(local),remote:describe(row)});
    }
    // A body-only revision change is safe: metadata POST uses the fresh revision.
    const next=changed?{...row,category:old!.category!==local.category?local.category:row.category,tags:[...new Set([...local.tags.filter(t=>!old!.tags.includes(t)||row.tags.includes(t)),...row.tags.filter(t=>!old!.tags.includes(t)||local.tags.includes(t))])]}:applyClassification(row,state.pending);
    if(changed||!same({category:row.category,tags:row.tags},{category:next.category,tags:next.tags}))reconciled.push(next);
    if(!same({category:row.category,tags:row.tags},{category:next.category,tags:next.tags}))updates.push(next);
  }
  // Locally created notes have no server row yet; keep their original queue result.
  for(const old of state.baseNotes||[])if(!rows.some(r=>r.id===old.id)&&old.id.startsWith('local-'))reconciled.push(applyClassification(old,state.pending));
  let categories=categoryPaths(remote.categories);
  for(const op of state.pending)categories=locallyApplyCategory(categories,op);
  categories=categoryPaths([...categories,...reconciled.map(n=>n.category)]);
  return{categories,updates,reconciled,conflicts};
}
