import {categoryPaths,inCategory,movedCategory} from './note-organization';
import type {CategoryOperation} from '../components/note-categories';

export type OfflineWorkspace={categories:string[];revision:number;pending:CategoryOperation[];updatedAt:number};
const key=(accountId:string)=>'kaerunote-workspace-offline-v2:'+accountId;

export function loadOfflineWorkspace(accountId:string):OfflineWorkspace{
  try{
    const raw=localStorage.getItem(key(accountId));
    if(raw){
      const v=JSON.parse(raw) as Partial<OfflineWorkspace>;
      if(Array.isArray(v.categories)&&Array.isArray(v.pending))return{
        categories:categoryPaths(v.categories.filter((x):x is string=>typeof x==='string')),
        revision:Number(v.revision)||0,
        pending:v.pending.filter(op=>['create','move','tag'].includes(op.kind)&&typeof op.target==='string'),
        updatedAt:Number(v.updatedAt)||0
      };
    }
  }catch{/* Invalid or inaccessible local cache must never prevent opening a note. */}
  return{categories:[],revision:0,pending:[],updatedAt:0};
}
export function persistOfflineWorkspace(accountId:string,state:OfflineWorkspace){
  // Persist before mutating React state, so quota/private-mode errors do not fake success.
  localStorage.setItem(key(accountId),JSON.stringify({...state,updatedAt:Date.now()}));
}
export function locallyApplyCategory(paths:string[],op:CategoryOperation):string[]{
  if(op.kind==='create')return categoryPaths([...paths,op.target]);
  if(op.kind==='move')return categoryPaths(paths.map(path=>movedCategory(path,op.source,op.target)));
  return op.remove?categoryPaths(paths.filter(path=>!inCategory(path,op.source))):categoryPaths(paths);
}
