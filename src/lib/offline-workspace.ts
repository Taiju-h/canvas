import {categoryPaths,inCategory,movedCategory} from './note-organization';
import type {CategoryOperation} from '../components/note-categories';

export type PageClassification={id:string;category:string;tags:string[]};
export type WorkspaceOperation=CategoryOperation|{kind:'assign';notes:PageClassification[]};
export type OfflineWorkspace={categories:string[];revision:number;pending:WorkspaceOperation[];updatedAt:number;
  baseCategories?:string[];baseNotes?:import('./category-sync').Classification[];conflicts?:import('./category-sync').CategoryConflict[];resolution?:'local'|'remote';conflictFingerprint?:string};
const key=(accountId:string)=>'kaerunote-workspace-offline-v2:'+accountId;

export function loadOfflineWorkspace(accountId:string):OfflineWorkspace{
  try{
    const raw=localStorage.getItem(key(accountId));
    if(raw){
      const v=JSON.parse(raw) as Partial<OfflineWorkspace>;
      if(Array.isArray(v.categories)&&Array.isArray(v.pending))return{
        categories:categoryPaths(v.categories.filter((x):x is string=>typeof x==='string')),
        revision:Number(v.revision)||0,
        pending:v.pending.filter(op=>op.kind==='assign'?Array.isArray(op.notes)&&op.notes.every(n=>typeof n.id==='string'&&typeof n.category==='string'&&Array.isArray(n.tags)&&n.tags.every(t=>typeof t==='string')):['create','move','tag','delete'].includes(op.kind)&&typeof op.target==='string'),
        updatedAt:Number(v.updatedAt)||0,baseCategories:v.baseCategories,baseNotes:v.baseNotes,conflicts:v.conflicts,resolution:v.resolution,conflictFingerprint:v.conflictFingerprint
      };
    }
  }catch{/* Invalid or inaccessible local cache must never prevent opening a note. */}
  return{categories:[],revision:0,pending:[],updatedAt:0};
}
export function persistOfflineWorkspace(accountId:string,state:OfflineWorkspace){
  // Persist before mutating React state, so quota/private-mode errors do not fake success.
  localStorage.setItem(key(accountId),JSON.stringify({...state,updatedAt:Date.now()}));
}
export function locallyApplyCategory(paths:string[],op:WorkspaceOperation):string[]{
  if(op.kind==='assign')return categoryPaths([...paths,...op.notes.map(n=>n.category)]);
  if(op.kind==='create')return categoryPaths([...paths,op.target]);
  if(op.kind==='move')return categoryPaths(paths.map(path=>movedCategory(path,op.source,op.target)));
  if(op.kind==='delete')return categoryPaths([...paths.filter(path=>!inCategory(path,op.source)),op.target]);
  return op.remove?categoryPaths(paths.filter(path=>!inCategory(path,op.source))):categoryPaths(paths);
}
