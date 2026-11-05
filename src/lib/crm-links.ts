import {safeReferenceURL} from './note-links';

export type CRMLink={id:string;label:string;url:string;kind:'customer'|'company'|'deal'|'other'};
export const crmKinds:Record<CRMLink['kind'],string>={customer:'顧客',company:'会社',deal:'案件',other:'その他'};
/** Only explicit links are stored here. Provider credentials and remote records are not note content. */
export function crmLinks(value:unknown):CRMLink[]{
  if(!Array.isArray(value))return[];
  const seen=new Set<string>();
  return value.flatMap(item=>{
    if(!item||typeof item.id!=='string'||!item.id||seen.has(item.id)||typeof item.label!=='string'||typeof item.url!=='string')return[];
    const url=safeReferenceURL(item.url);if(!url||!Object.hasOwn(crmKinds,item.kind))return[];
    seen.add(item.id);return[{id:item.id,label:item.label.slice(0,160),url,kind:item.kind} as CRMLink];
  }).slice(0,50);
}
