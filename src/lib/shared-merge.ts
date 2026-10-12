import type { NoteDoc } from './notes';

/** Conservative three-way merge: non-overlapping object edits are combined.
 * If two people change the same object, leave the local draft untouched.
 */
const same = (a: unknown,b: unknown) => JSON.stringify(a)===JSON.stringify(b);
const collections=new Set(['items','layers','blocks','paintStrokes','attachments','charts']);
function byId(value:unknown):value is {id:string} {return typeof value==='object'&&value!==null&&'id' in value&&typeof (value as {id:unknown}).id==='string';}
function mergeList(base:unknown,local:unknown,remote:unknown):unknown[]|null {
  const arrays=[base,local,remote].map(v=>v===undefined?[]:v);
  if(!arrays.every(v=>Array.isArray(v)&&(v as unknown[]).every(byId)))return null;
  const [old,left,right]=arrays as {id:string}[][];
  const b=new Map(old.map(x=>[x.id,x])),l=new Map(left.map(x=>[x.id,x])),r=new Map(right.map(x=>[x.id,x]));
  const ids=[...new Set([...right.map(x=>x.id),...left.map(x=>x.id),...old.map(x=>x.id)])];
  const result:unknown[]=[];
  for(const id of ids){
    const x=b.get(id),y=l.get(id),z=r.get(id);
    if(same(y,x)){if(z!==undefined)result.push(z);continue;}
    if(same(z,x)||same(y,z)){if(y!==undefined)result.push(y);continue;}
    return null;
  }
  return result;
}
export function mergeSharedNotes(base:NoteDoc,local:NoteDoc,remote:NoteDoc):NoteDoc|null {
  const result:Record<string,unknown>={...remote};
  const allKeys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]);
  for(const key of allKeys){
    const b=(base as unknown as Record<string,unknown>)[key],l=(local as unknown as Record<string,unknown>)[key],r=(remote as unknown as Record<string,unknown>)[key];
    if(same(l,b)){if(r===undefined)delete result[key];continue;}
    if(same(r,b)||same(l,r)){if(l===undefined)delete result[key];else result[key]=l;continue;}
    if(collections.has(key)){
      const merged=mergeList(b,l,r);if(!merged)return null;
      result[key]=merged;
    }else if(key==='note'){
      const merged:Record<string,unknown>={};
      const old=(b||{}) as Record<string,unknown>,left=(l||{}) as Record<string,unknown>,right=(r||{}) as Record<string,unknown>;
      for(const field of new Set([...Object.keys(old),...Object.keys(left),...Object.keys(right)])){
        if(same(left[field],old[field]))merged[field]=right[field];
        else if(same(right[field],old[field])||same(left[field],right[field]))merged[field]=left[field];
        else if(field==='tags'&&[old[field],left[field],right[field]].every(Array.isArray)){
          const before=old[field] as string[],a=left[field] as string[],z=right[field] as string[];
          merged[field]=[...new Set([...a.filter(x=>!before.includes(x)||z.includes(x)),...z.filter(x=>!before.includes(x)||a.includes(x))])];
        }else return null;
      }
      result[key]=merged;
    }else return null;
  }
  return result as NoteDoc;
}
export function mergeSharedTitle(base:string,local:string,remote:string):string|null {
  if(local===base)return remote;
  if(remote===base||local===remote)return local;
  return null;
}
