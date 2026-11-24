import {api,blankNote,cleanHTML,fileURL,id32,uploadAttachment,type Attachment,type NoteDoc,type NoteIndex,type NoteRecord} from './notes';
import {getLocalDoc,listLocalDocs,putLocalDoc,putLocalImage,type LocalDoc} from './local-docs';
import {noteAssets,readNoteAsset,type NoteAsset} from './note-files';
import {readSession} from './offline-session';
import {loadOfflineWorkspace} from './offline-workspace';
import {fetchWithTimeout,networkAvailable} from './network';

export type RecoveryProgress={phase:string;done:number;total:number;page:string};
type RecoveryLocal=LocalDoc&{content:NoteDoc};
type Source={record:RecoveryLocal;assets:NoteAsset[];fingerprint:string;existing?:NoteIndex};
export type RecoveryPlan={accountId:string;destinationName:string;sources:Source[];localCount:number;serverCount:number;alreadySaved:number;categories:string[];folderAdditions:number};
type Marker={sourceId:string;snapshot:string;stage:'pending'|'complete';originalId?:string};
type Entry={targetId:string;assets:Record<string,{id:string;kind:'file'|'image'}>};
type Journal={version:1;entries:Record<string,Entry>;categories?:string[]};
const marker=(note:NoteIndex)=>note.note?.deviceRecovery;
const hash=async(value:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');
const textHash=(value:string)=>hash(new TextEncoder().encode(value));
const sourceKey=(source:Source)=>source.record.id+':'+source.fingerprint;
function checkpointKey(account:string){return'kn-device-recovery:'+account;}
function journal(account:string):Journal{try{const value=JSON.parse(localStorage.getItem(checkpointKey(account))||'null');if(value?.version===1&&value.entries&&typeof value.entries==='object')return value;}catch{}return{version:1,entries:{}};}
function checkpoint(account:string,value:Journal){localStorage.setItem(checkpointKey(account),JSON.stringify(value));}

export async function recoveryIndex():Promise<NoteIndex[]>{
  const result:NoteIndex[]=[];let offset=0;
  while(true){const response=await fetchWithTimeout('/canvas/api.php?path=%2Fapi%2Fnotes-index&offset='+offset,{credentials:'same-origin',cache:'no-store'},30000);
    if(!response.ok)throw new Error('DBのメモ一覧を取得できません。接続を確認してください');
    const page=await response.json();if(!Array.isArray(page.documents))throw new Error('DBのメモ一覧を確認できません');result.push(...page.documents);
    if(!page.hasMore)return result;if(!Number.isInteger(page.nextOffset)||page.nextOffset<=offset)throw new Error('DBの一覧を全件確認できません');offset=page.nextOffset;
  }
}
async function destination(account:string){
  const session=await readSession(true);
  if(!session.authenticated||!session.accountId||session.localOnly||session.deviceOnly)throw new Error('オンラインの保存先に接続してください');
  if(session.accountId!==account)throw Object.assign(new Error('別の利用者への接続に切り替わっています。「保存先を再確認」で接続を揃えてください。端末のメモは保持しています'),{reconnect:true});
  if(!networkAvailable())throw Object.assign(new Error('オンラインの保存先を再確認してください。端末のメモは保持しています'),{reconnect:true});
  window.CanvasCsrf=session.csrfToken||'';return session;
}
/** Read every local original before any remote writes; a missing file stops the operation. */
export async function prepareDeviceRecovery(accountId:string,progress:(value:RecoveryProgress)=>void,cancelled=()=>false):Promise<RecoveryPlan>{
  const connected=await destination(accountId);const server=await recoveryIndex(),owned=new Map(server.map(n=>[n.id,n]));
  const local=(await listLocalDocs()).filter(n=>n.owner&&!n.shareToken&&n.content?.version===1&&!(n.accountId===accountId&&(n.content as NoteDoc).note?.deviceRecovery?.stage==='complete'&&owned.has(n.id)&&!n.dirty)) as RecoveryLocal[];
  const sources:Source[]=[],digests=new Map<string,Promise<string>>(),categories=new Set<string>();let alreadySaved=0,done=0;
  for(const category of journal(accountId).categories||[])categories.add(category);
  for(const cached of local){
    if(cancelled())throw new Error('確認を中断しました。端末の原本は保持しています');
    const record=structuredClone(cached),remote=owned.get(record.id);
    for(const category of loadOfflineWorkspace((record.accountId||'').replace(/^recovery-backup:/,'')).categories)categories.add(category);
    if(record.content.note?.category)categories.add(record.content.note.category);
    progress({phase:'原本を確認',done,total:local.length,page:record.title});
    if(remote&&record.accountId===accountId&&!record.dirty&&record.revision<=remote.revision){alreadySaved++;done++;continue;}
    if(remote){const saved=await(await api('/api/documents/'+record.id)).json() as NoteRecord;if(saved.title===record.title&&JSON.stringify(saved.content)===JSON.stringify(record.content)){alreadySaved++;done++;continue;}}
    const assets=noteAssets({...record,content:record.content as NoteDoc}),fingerprints:string[]=[];
    for(const asset of assets){
      const key=(asset.documentId||record.id)+':'+asset.id;
      if(!digests.has(key))digests.set(key,readNoteAsset(record.recoverySourceId||record.id,asset).then(async blob=>hash(await blob.arrayBuffer())));
      fingerprints.push(asset.id+':'+await digests.get(key));
    }
    const fingerprint=await textHash(JSON.stringify({title:record.title,content:record.content,assets:fingerprints.sort()}));
    const existing=server.find(n=>marker(n)?.sourceId===record.id&&marker(n)?.snapshot===fingerprint);
    if(existing&&marker(existing)?.stage==='complete'){alreadySaved++;done++;continue;}
    sources.push({record,assets,fingerprint,existing});done++;
  }
  progress({phase:'確認完了',done,total:local.length,page:''});
  const folders=await(await api('/api/note-workspace')).json();
  return{accountId,destinationName:connected.nickname||connected.deviceName||'接続中の保存先',sources,localCount:local.length,serverCount:server.length,alreadySaved,categories:[...categories],folderAdditions:[...categories].filter(c=>!folders.categories.includes(c)).length};
}

/** Stable URLs, geometry, metadata and old local originals are all retained. */
export function recoveryContent(source:NoteDoc,targetId:string,assets:Map<string,{id:string;kind:'file'|'image'}>,notes:Map<string,string>,stamp:Marker):NoteDoc{
  const copy=structuredClone(source);
  const assetURL=(id:string)=>{const mapped=assets.get(id);return mapped?mapped.kind==='file'?fileURL(targetId,mapped.id):'/canvas/api.php?path='+encodeURIComponent(`/api/documents/${targetId}/images/${mapped.id}`):undefined;};
  const html=(value:string)=>{
    const template=document.createElement('template');template.innerHTML=cleanHTML(value);
    for(const el of template.content.querySelectorAll('img,video,source,a[href],[data-kn-local-image],[data-kn-local-file]')){
      const attribute=el.tagName==='A'?'href':'src',old=el.getAttribute(attribute)||'';
      let id=el.getAttribute('data-kn-local-image')||el.getAttribute('data-kn-local-file')||'';
      let url:URL|undefined;try{url=new URL(old,location.href);if(url.origin===location.origin&&url.pathname==='/canvas/api.php')id=id||/\/(?:files|images)\/([^/]+)$/.exec(url.searchParams.get('path')||'')?.[1]||'';}catch{}
      const mapped=assets.get(id.replace(/^file:/,''));
      if(mapped){el.setAttribute(attribute,assetURL(id.replace(/^file:/,''))!);el.removeAttribute('data-kn-local-image');el.removeAttribute('data-kn-local-file');el.setAttribute(mapped.kind==='file'?'data-kn-local-file':'data-kn-local-image',mapped.id);}
      else if(el.tagName==='A'&&url?.origin===location.origin){const target=notes.get(url.searchParams.get('d')||'');if(target){url.searchParams.set('d',target);el.setAttribute('href',url.pathname+url.search+url.hash);}}
    }
    let result=template.innerHTML;
    for(const [from,to] of notes)result=result.split('{{'+from+':').join('{{'+to+':').split('data-kn-ref="'+from+':').join('data-kn-ref="'+to+':');
    return cleanHTML(result);
  };
  const image=(id:string|undefined)=>{if(!id)return id;const file=id.startsWith('file:'),next=assets.get(file?id.slice(5):id);return next?(next.kind==='file'?'file:':'')+next.id:id;};
  copy.items=copy.items.map(i=>({...i,imageId:image(i.imageId)}));copy.layers=copy.layers.map(l=>({...l,rasterImageId:image(l.rasterImageId)}));
  if(copy.fixedNote)copy.fixedNote={...copy.fixedNote,html:html(copy.fixedNote.html)};
  copy.blocks=copy.blocks?.map(b=>({...b,html:html(b.html)}));if(copy.legacyNoteBody)copy.legacyNoteBody={...copy.legacyNoteBody,block:{...copy.legacyNoteBody.block,html:html(copy.legacyNoteBody.block.html)}};
  copy.attachments=(copy.attachments||[]).map(a=>({...a,id:assets.get(a.id)?.id||a.id,pending:false}));
  copy.note={category:'',tags:[],...copy.note,deviceRecovery:stamp};
  copy.note.relatedNotes=copy.note.relatedNotes?.map(n=>({...n,id:notes.get(n.id)||n.id}));
  const sheet=(copy as NoteDoc&{sheet?:{cells:Record<string,string>}}).sheet;
  if(sheet?.cells){sheet.cells=Object.fromEntries(Object.entries(sheet.cells).map(([cell,value])=>{if(typeof value==='string')for(const [from,to] of notes)value=value.split('{{'+from+':').join('{{'+to+':');return[cell,value];}));}
  return copy;
}

export async function copyDeviceRecovery(plan:RecoveryPlan,progress:(value:RecoveryProgress)=>void,cancelled=()=>false,onArchived:(id:string)=>void=()=>{}){
  const check=()=>{if(cancelled())throw new Error('保存を中断しました。元のデータは保持しています。再確認すると続きから再開できます');};
  check();
  await destination(plan.accountId);
  if(loadOfflineWorkspace(plan.accountId).pending.length)throw new Error('保存先の未同期分類を解決してから集約してください');
  const state=journal(plan.accountId),mapping=new Map<string,string>(),current=await recoveryIndex(),finished=new Set<string>();
  state.categories=[...new Set([...(state.categories||[]),...plan.categories])];checkpoint(plan.accountId,state);
  for(const n of current)mapping.set(n.id,n.id);
  // Reserve all IDs first so links and spreadsheet references remain valid in any order.
  for(const source of plan.sources){
    check();const latest=await getLocalDoc(source.record.id);
    if(!latest||latest.title!==source.record.title||JSON.stringify(latest.content)!==JSON.stringify(source.record.content))throw new Error('確認後に端末のメモが変更されました。もう一度保存状況を確認してください');
    const key=sourceKey(source),known=current.find(n=>marker(n)?.sourceId===source.record.id&&marker(n)?.snapshot===source.fingerprint);
    if(current.some(n=>n.id===source.record.id)){
      const remote=await(await api('/api/documents/'+source.record.id)).json() as NoteRecord;
      if(remote.title===source.record.title&&JSON.stringify(remote.content)===JSON.stringify(source.record.content)){finished.add(key);mapping.set(source.record.id,source.record.id);continue;}
    }
    let entry=state.entries[key];
    if(known)entry=state.entries[key]={targetId:known.id,assets:entry?.targetId===known.id?entry.assets:{}};
    if(!entry||!current.some(n=>n.id===entry.targetId)){
      const content=blankNote();content.note={category:'',tags:[],...source.record.content.note,importState:'pending',deviceRecovery:{sourceId:source.record.id,snapshot:source.fingerprint,stage:'pending',originalId:source.record.recoverySourceId}};
      const created=await(await api('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:source.record.title,content})})).json() as NoteRecord;
      entry=state.entries[key]={targetId:created.id,assets:{}};current.push(created);
    }
    mapping.set(source.record.id,entry.targetId);if(source.record.recoverySourceId)mapping.set(source.record.recoverySourceId,entry.targetId);checkpoint(plan.accountId,state);
  }
  for(const n of current){const stamp=marker(n);if(stamp&&!mapping.has(stamp.sourceId))mapping.set(stamp.sourceId,n.id);if(stamp?.originalId&&(!mapping.has(stamp.originalId)||mapping.get(stamp.originalId)===stamp.originalId))mapping.set(stamp.originalId,n.id);}
  let done=0;
  for(const source of plan.sources){
    check();if(finished.has(sourceKey(source))){done++;continue;}
    const entry=state.entries[sourceKey(source)],stamp:Marker={sourceId:source.record.id,snapshot:source.fingerprint,stage:'complete',originalId:source.record.recoverySourceId};
    const present=await(await api('/api/documents/'+entry.targetId)).json() as NoteRecord;
    if(marker({...present,note:present.content.note})?.stage==='complete'){done++;continue;}
    progress({phase:'原本をDBへ送信',done,total:plan.sources.length,page:source.record.title});
    for(const asset of source.assets){
      check();
      const blob=await readNoteAsset(source.record.recoverySourceId||source.record.id,asset);let mapped=entry.assets[asset.id];
      if(asset.kind==='file'){
        if(!mapped){mapped=entry.assets[asset.id]={id:id32(),kind:'file'};checkpoint(plan.accountId,state);}
        const attachment:Attachment={id:mapped.id,name:asset.name,mime:blob.type||asset.mime||'application/octet-stream',size:blob.size};
        await uploadAttachment(entry.targetId,attachment,blob,bytes=>{check();progress({phase:'原本をDBへ送信 '+Math.floor(bytes/blob.size*100)+'%',done,total:plan.sources.length,page:source.record.title});});
      }else if(!mapped){
        const form=new FormData();form.set('file',blob,asset.name);const saved=await(await api(`/api/documents/${entry.targetId}/images`,{method:'POST',body:form})).json();
        entry.assets[asset.id]={id:saved.imageId,kind:'image'};checkpoint(plan.accountId,state);
      }
      await putLocalImage(entry.assets[asset.id].id,blob);
    }
    const content=recoveryContent(source.record.content as NoteDoc,entry.targetId,new Map(Object.entries(entry.assets)),mapping,stamp);
    for(const asset of source.assets)if(asset.kind==='file'&&!content.attachments?.some(a=>a.id===entry.assets[asset.id].id))content.attachments=[...(content.attachments||[]),{id:entry.assets[asset.id].id,name:asset.name,mime:asset.mime||'application/octet-stream',size:(await readNoteAsset(source.record.recoverySourceId||source.record.id,asset)).size}];
    const before=await(await api('/api/documents/'+entry.targetId)).json() as NoteRecord;
    const previous=before.content.note?.deviceRecovery;
    if(previous?.snapshot!==source.fingerprint||previous?.sourceId!==source.record.id)throw new Error('保存先が変更されました。元のPCデータは保持しています');
    if(previous.stage==='complete'){done++;continue;}
    const saved=await(await api('/api/documents/'+entry.targetId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:source.record.title,content,revision:before.revision})})).json();
    await putLocalDoc({id:entry.targetId,title:source.record.title,content,base:content,baseTitle:source.record.title,baseRevision:saved.revision,revision:saved.revision,updated_at:Date.now(),accountId:plan.accountId,dirty:false,owner:true});
    const original=await getLocalDoc(source.record.id);
    if(original?.accountId===plan.accountId&&original.title===source.record.title&&JSON.stringify(original.content)===JSON.stringify(source.record.content)){
      await putLocalDoc({...original,accountId:'recovery-backup:'+plan.accountId});onArchived(original.id);
    }
    done++;progress({phase:'メモをDBへ保存',done,total:plan.sources.length,page:source.record.title});
  }
  for(let attempt=0;attempt<2;attempt++){
    check();
    const workspace=await(await api('/api/note-workspace')).json(),categories=[...new Set([...(workspace.categories||[]),...plan.categories])];
    if(JSON.stringify(categories)===JSON.stringify(workspace.categories))break;
    try{await api('/api/note-workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({categories,updates:[],revision:workspace.revision})});break;}
    catch(error){if((error as {status?:number}).status!==409||attempt===1)throw error;}
  }
  const serverCount=(await recoveryIndex()).length;
  progress({phase:'保存完了',done,total:plan.sources.length,page:''});return{count:done,serverCount,firstId:mapping.get(plan.sources[0]?.record.id||'')};
}
