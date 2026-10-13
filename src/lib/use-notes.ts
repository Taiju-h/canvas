import {materializeSheetReferences,referenceSourceFromNote,referencedAliases} from './sheet-references';
import type {StudioNoteDoc} from '../components/note-studio-layers';
import { useEffect, useRef, useState } from 'react';
import { getLocalDoc, listLocalDocs, putLocalDoc, putLocalDocs, deleteLocalDoc, getLocalImage, putLocalImage, saveLocalRevision, moveLocalRevisions } from './local-docs';
import { api, blankNote, id32, indexOf, normalizeNote, uploadAttachment, fileURL, type NoteRecord, type NoteIndex, type NoteDoc, type NoteMeta } from './notes';
import { mergeSharedNotes, mergeSharedTitle } from './shared-merge';
import {inCategory,movedCategory} from './note-organization';
import {loadOfflineWorkspace} from './offline-workspace';
import type {CategoryOperation} from '../components/note-categories';

export type SharedAccess={id:string;token:string};
export function useNotes(accountId: string, sharedAccess?:SharedAccess) {
  const shared=!!sharedAccess;
  const synced=useRef(new Map<string,{title:string;content:NoteDoc;revision:number}>());
  const documentApi=(path:string,init:RequestInit={})=>{
    if(!sharedAccess)return api(path,init);
    const headers=new Headers(init.headers);headers.set('X-Share-Token',sharedAccess.token);
    return api(path,{...init,headers});
  };
  const [record,setRecord] = useState<NoteRecord | null>(null);
  const [list,setList] = useState<NoteIndex[]>([]);
  const [status,setStatus] = useState('準備中');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [conflict,setConflict] = useState(false);
  const records = useRef(new Map<string,NoteRecord>());
  const promoted=useRef(new Map<string,string>());
  const active = useRef(''); const blocked = useRef(new Set<string>());
  const jobs = useRef(new Map<string,Promise<void>>()); const timers = useRef(new Map<string,ReturnType<typeof setTimeout>>());
  const localJobs = useRef(Promise.resolve()); const openSeq = useRef(0);
  const lastOpenKey = 'canvas-last-open:'+accountId;
  function rememberOpen(id:string) { try { localStorage.setItem(lastOpenKey,id); } catch {} }
  function rememberedOpen() { try { return localStorage.getItem(lastOpenKey)||''; } catch { return ''; } }
  function show(next: NoteRecord) { records.current.set(next.id,next); if (active.current === next.id) { setRecord(next); setConflict(blocked.current.has(next.id)); }
    setList(old => [indexOf(next), ...old.filter(n=>n.id!==next.id)].sort((a,b)=>b.updated_at-a.updated_at)); }
  function persist(next: NoteRecord) {
    if(shared)return Promise.resolve(); // Do not cache invited collaborators' private data in the document library.
    const baseline=synced.current.get(next.id);
    localJobs.current = localJobs.current.catch(()=>{}).then(async()=> { try{await putLocalDoc({ ...next, base: baseline?.content||next.content, baseTitle:baseline?.title||next.title, baseRevision:baseline?.revision??next.revision, dirty: !!next.dirty, owner: true, accountId });}catch(error){throw Object.assign(new Error('端末に保存できません：'+String(error)),{localStorageFailure:true});} });
    return localJobs.current;
  }
  function report(message: string, id: string) { if (active.current === id) setStatus(message); }
  async function refresh(strict=false) {
    if(shared)return [...records.current.values()].map(indexOf);
    await localJobs.current;
    const local = (await listLocalDocs()).filter(n=>n.accountId===accountId);
    const merged = new Map<string,NoteIndex>();
    if (navigator.onLine) {
      try {
      let offset = 0;
      while (true) {
        const response = await fetch('/canvas/api.php?path=%2Fapi%2Fnotes-index&offset='+offset, { credentials:'same-origin',cache:'no-store' });
        if (!response.ok) throw new Error('メモ一覧を取得できません');
        const page = await response.json();
        for (const n of page.documents as NoteIndex[]) merged.set(n.id,n);
        if (!page.hasMore) break;
        offset=page.nextOffset;
      }
      } catch (err) { if (strict || (!local.length && !records.current.size)) throw err; setError('一覧を同期できないため端末のメモを表示しています'); }
    }
    for(const n of local){
      const previous=records.current.get(n.id);
      if(n.dirty&&(!previous||previous.content.note?.importState==='pending'&&(n.content as NoteDoc).note?.importState==='complete')){
        restoreBase(n);const loaded={...n,content:normalizeNote(n.content)};records.current.set(n.id,loaded);if(active.current===n.id)setRecord(loaded);
      }
    }
    for (const n of local) if (!merged.has(n.id) || n.dirty) merged.set(n.id,indexOf({ ...n,content:normalizeNote(n.content) }));
    for (const n of records.current.values()) if (n.dirty) merged.set(n.id,indexOf(n));
    const result=[...merged.values()].sort((a,b)=>b.updated_at-a.updated_at); setList(result); return result;
  }
  async function prepareOffline(includeFiles:boolean,onProgress?:(progress:{done:number;total:number;files:number;errors:number})=>void){
    if(shared)throw new Error('共有リンクでは所有者の全ノートを一括取得できません');
    if(!navigator.onLine)throw new Error('初回のオフライン準備には接続が必要です。準備済みのノートは接続不要で使用できます');
    try{await navigator.storage?.persist?.();}catch{/* Browser may not support persistent storage. */}
    const rows=await refresh();
    let done=0,files=0,errors=0;
    const progress=()=>onProgress?.({done,total:rows.length,files,errors});
    progress();
    for(const index of rows){
      try{
        const old=await getLocalDoc(index.id);
        const remote=old?.accountId===accountId&&(old.dirty||old.revision>=index.revision)
          ?({...old,content:normalizeNote(old.content)} as NoteRecord)
          :await(await documentApi('/api/documents/'+index.id)).json() as NoteRecord;
        // Recheck after the network wait; an edit may have occurred meanwhile.
        localJobs.current=localJobs.current.catch(()=>{}).then(async()=>{
          const latest=records.current.get(index.id)||await getLocalDoc(index.id);
          if(!latest||!latest.dirty&&latest.revision<remote.revision)
            await putLocalDoc({...remote,base:remote.content,dirty:false,owner:true,accountId});
        });
        await localJobs.current;
        if(includeFiles){
          const refs=new Map<string,string>();
          for(const a of remote.content.attachments||[])refs.set(a.id,fileURL(index.id,a.id));
          for(const image of [...(remote.content.items||[]).map(x=>x.imageId),...(remote.content.layers||[]).map(x=>x.rasterImageId)]){
            if(!image||image.startsWith('local-'))continue;
            if(image.startsWith('file:'))refs.set(image.slice(5),fileURL(index.id,image.slice(5)));
            else refs.set(image,'/canvas/api.php?path='+encodeURIComponent('/api/documents/'+index.id+'/images/'+image));
          }
          for(const [assetId,url] of refs){
            try{
              if(await getLocalImage(assetId))continue;
              const response=await fetch(url,{credentials:'same-origin'});
              if(!response.ok)throw new Error('添付 '+assetId+' を読み込めません');
              const length=Number(response.headers.get('content-length')||0);
              const estimate=await navigator.storage?.estimate?.();
              if(estimate?.quota&&estimate?.usage&&length>estimate.quota-estimate.usage)
                throw new Error('端末の空き容量が足りません');
              await putLocalImage(assetId,await response.blob());files++;
            }catch{errors++;}
          }
        }
      }catch{errors++;}
      done++;progress();
    }
    return{done,total:rows.length,files,errors};
  }
  async function remapLocalLinks(from:string,to:string){
    const cached=shared?[]:(await listLocalDocs()).filter(row=>row.accountId===accountId);
    const all=new Map<string,NoteRecord>(cached.map(row=>[row.id,{...row,content:row.content as NoteDoc}]));
    for(const row of records.current.values())all.set(row.id,row);
    for(const row of all.values()){
      if(row.id===from)continue;
      const latest=records.current.get(row.id)||row,d=latest.content as StudioNoteDoc;
      const replace=(html:string)=>html.split('d='+from).join('d='+to).split('{{'+from+':').join('{{'+to+':').split('data-kn-ref="'+from+':').join('data-kn-ref="'+to+':');
      const fixed=d.fixedNote?{...d.fixedNote,html:replace(d.fixedNote.html)}:undefined;
      const blocks=d.blocks?.map(b=>({...b,html:replace(b.html)}));
      if(fixed?.html===d.fixedNote?.html&&!blocks?.some((b,i)=>b.html!==d.blocks?.[i].html))continue;
      const next={...latest,content:{...d,fixedNote:fixed,blocks},dirty:true};show(next);await persist(next);
    }
  }
  async function refreshReferences(id=active.current){
    await localJobs.current;
    const cached=shared?[]:(await listLocalDocs()).filter(row=>row.accountId===accountId);
    const all=new Map<string,NoteRecord>(cached.map(row=>[row.id,{...row,content:row.content as NoteDoc}]));
    for(const row of records.current.values())all.set(row.id,row);
    const owner=all.get(id);if(!owner)return;
    const sources=[...all.values()].map(row=>referenceSourceFromNote(row.id,row.content));
    const changed:string[]=[];
    for(const row of all.values()){
      const latest=records.current.get(row.id)||row,d=latest.content as StudioNoteDoc;
      if(d.note?.trashedAt||d.note?.importState==='pending')continue;
      const htmls=[d.fixedNote?.html||'',...(d.blocks||[]).map(b=>b.html)];
      const refs=referencedAliases(htmls.join(' '));
      if(row.id!==id&&!refs.includes(id)&&!(owner.content.note?.alias&&refs.includes(owner.content.note.alias)))continue;
      const self=referenceSourceFromNote(row.id,d);
      const converted=htmls.map(html=>materializeSheetReferences(html,self,sources));
      if(converted.every((html,i)=>html===htmls[i]))continue;
      const content={...d,fixedNote:{visible:true,locked:false,...d.fixedNote,html:converted[0]},blocks:d.blocks?.map((b,i)=>({...b,html:converted[i+1]}))};
      const next={...latest,content,dirty:true,updated_at:Date.now()};show(next);await persist(next);changed.push(row.id);
    }
    for(const key of changed)if(key!==id){clearTimeout(timers.current.get(key));timers.current.set(key,setTimeout(()=>void save(key),700));}
  }
  function save(id = active.current): Promise<void> {
    if (jobs.current.has(id)) return jobs.current.get(id)!;
    const jobKeys=new Set([id]);
    let job!:Promise<void>;
    job = (async()=> {
      await refreshReferences(id);
      await localJobs.current;
      if(!shared){
        const local=records.current.get(id);
        if(local)await saveLocalRevision({...local,base:local.content,dirty:!!local.dirty,owner:true,accountId});
      }
      if(blocked.current.has(id))return;
      if(!shared&&loadOfflineWorkspace(accountId).pending.length){report('端末に保存済み（分類の同期待ち）',id);return;}
      if(!navigator.onLine&&!shared){
        report('端末に保存・履歴作成済み（同期待ち）',id);
        return;
      }
      let attempts=0;
      let key=id;
      while (navigator.onLine) {
        if(!shared&&loadOfflineWorkspace(accountId).pending.length)break;
        let sent=records.current.get(key); if (!sent?.dirty||sent.content.note?.importState==='pending') break;
        report('同期中…',key);
        try {
          const isNew=key.startsWith('local-');
          if (!isNew) {
            const ids=[...new Set([...sent.content.layers.map(l=>l.rasterImageId),...sent.content.items.map(i=>i.imageId)].filter((id):id is string=>!!id?.startsWith('local-')))];
            for (const imageId of ids) {
              const blob=await getLocalImage(imageId);if(!blob)throw new Error('端末の手書き画像を取得できません。元の端末から同期してください');
              const form=new FormData();form.set('file',blob,'drawing.png');
              const uploaded=await(await documentApi('/api/documents/'+key+'/images',{method:'POST',body:form})).json() as {imageId:string};
              await putLocalImage(uploaded.imageId,blob);
              const latest=records.current.get(key)!;
              const content={...latest.content,layers:latest.content.layers.map(l=>l.rasterImageId===imageId?{...l,rasterImageId:uploaded.imageId}:l),items:latest.content.items.map(i=>i.imageId===imageId?{...i,imageId:uploaded.imageId}:i)};
              sent={...latest,content};show(sent);await persist(sent);
            }
          }
          const response=await documentApi('/api/documents'+(isNew?'':'/'+key), { method:isNew?'POST':'PUT', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ title:sent.title,content:sent.content,revision:sent.revision }) });
          const result=await response.json() as {id:string;revision:number};
          synced.current.set(result.id,{revision:result.revision,content:sent.content,title:sent.title});
          const latest=records.current.get(key)!;
          const next={...latest,id:result.id,revision:result.revision,dirty:latest.content!==sent.content || latest.title!==sent.title || (isNew && [...latest.content.layers.map(l=>l.rasterImageId),...latest.content.items.map(i=>i.imageId)].some(id=>id?.startsWith('local-')))};
          next.dirty=!!next.dirty||!!next.content.attachments?.some(a=>a.pending);
          const oldKey=key;
          if (isNew) {
            promoted.current.set(oldKey,result.id);records.current.delete(oldKey); setList(old=>old.filter(n=>n.id!==oldKey));
            clearTimeout(timers.current.get(oldKey));timers.current.delete(oldKey);
            if (active.current===oldKey) { active.current=result.id; setURL(result.id); }
            key=result.id;jobKeys.add(key);jobs.current.set(key,job);
          }
          // Publish once, before awaiting storage. Never replay a stale snapshot.
          show(next);await persist(next);
          if(isNew){await moveLocalRevisions(oldKey,key);await deleteLocalDoc(oldKey);await remapLocalLinks(oldKey,key);}
          const waiting=records.current.get(key)!;
          const pending=waiting.content.attachments?.filter(a=>a.pending)||[];
          if(pending.length){
            for(const attachment of pending){
              const blob=await getLocalImage(attachment.id);
              if(!blob)throw new Error('添付ファイルの元データが端末にありません：'+attachment.name);
              await uploadAttachment(key,attachment,blob,undefined,sharedAccess?.token);
            }
            const latest=records.current.get(key)||waiting;
            const updated={...latest,content:{...latest.content,attachments:latest.content.attachments?.map(a=>
              pending.some(p=>p.id===a.id)?{...a,pending:false}:a)},dirty:true};
            show(updated);await persist(updated);
            report('添付ファイルの送信が完了・メモを更新中',key);
            continue;
          }
          const saved=records.current.get(key)!;
          if(!saved.dirty&&!shared)await saveLocalRevision({...saved,base:saved.content,dirty:false,owner:true,accountId});
          report(records.current.get(key)?.dirty?'同期待ち':'保存済み',key);
        } catch (err) {
          if ((err as {status?:number}).status===409&&attempts<2){
            try{
              const base=synced.current.get(key);
              const remote=await(await documentApi('/api/documents/'+key)).json() as NoteRecord;
              const draft=records.current.get(key);
              if(base&&draft&&base.revision<remote.revision){
                const merged=mergeSharedNotes(base.content,draft.content,normalizeNote(remote.content));
                const title=mergeSharedTitle(base.title,draft.title,remote.title);
                if(merged&&title!==null){
                  const next={...draft,content:merged,title,revision:remote.revision,dirty:true};
                  synced.current.set(key,{revision:remote.revision,content:normalizeNote(remote.content),title:remote.title});
                  show(next);await persist(next);attempts++;report('別の編集を統合して保存中…',key);continue;
                }
              }
            }catch{/* When a merge fails, preserve the unsaved draft below. */}
          }
          if ((err as {status?:number}).status===409) { blocked.current.add(key); if (active.current===key) setConflict(true); report(shared?'同じ箇所が競合しました。画面の内容はまだ残っています':'他端末と競合・この端末の内容は保持しています',key); }
          else if((err as {localStorageFailure?:boolean}).localStorageFailure){report('端末保存エラー',key);setError(String(err));}
          else {
            report(shared?'共有先に保存できません（この画面に編集内容が残っています）':'端末保存済み・同期待ち',key);
            setError(shared?'共同編集の保存に失敗しました。接続・共有権限を確認し、必要なら編集内容を退避してください。':err instanceof Error?err.message:'同期できません');
          }
          break;
        }
      }
    })().catch(err=>{setError('端末に保存できません：'+String(err));report('端末保存エラー',active.current);}).finally(()=>{ for(const key of jobKeys)jobs.current.delete(key); });
    jobs.current.set(id,job); return job;
  }
  function setURL(id:string) { rememberOpen(id); const url=new URL(location.href);url.searchParams.set('d',id);history.replaceState(null,'',url); }
  function change(content:NoteDoc, title?:string) {
    const previous=records.current.get(active.current); if(!previous)return;
    const next={...previous,content,title:title??previous.title,updated_at:Date.now(),dirty:true};show(next);
    report('保存中…',next.id);
    void persist(next).then(()=>{ if(records.current.get(next.id)===next)report(navigator.onLine?'同期待ち':'端末に保存済み',next.id); }).catch(()=>{setError('端末に保存できません。MDを書き出して内容を保存してください');setStatus('端末保存エラー');});
    clearTimeout(timers.current.get(next.id));timers.current.set(next.id,setTimeout(()=>void save(next.id),700));
  }
  function restoreBase(cached:import('./local-docs').LocalDoc){
    if(!synced.current.has(cached.id)&&cached.baseRevision!==undefined) synced.current.set(cached.id,{content:normalizeNote(cached.base as NoteDoc),title:cached.baseTitle??cached.title,revision:cached.baseRevision});
  }
  async function persistPending(){await localJobs.current;}
  async function readForExport(requestedId:string,knownRevision?:number):Promise<NoteRecord>{
    if(shared)throw new Error('共有リンクでは所有者の全データを取り出せません');
    const id=promoted.current.get(requestedId)||requestedId;
    await persistPending();
    const cached=await getLocalDoc(id);let latest=records.current.get(id);
    if(cached?.accountId===accountId){restoreBase(cached);if(!latest||!latest.dirty&&(cached.dirty||cached.revision>latest.revision))latest={...cached,content:normalizeNote(cached.content)};}
    if(latest&&(latest.dirty||id.startsWith('local-')||!navigator.onLine||latest.revision>=(knownRevision??list.find(n=>n.id===id)?.revision??Infinity)))return latest;
    if(!navigator.onLine||id.startsWith('local-'))throw new Error('この端末に未取得のページがあります。接続中に取り出すか、取得済みのページを選んでください');
    const remote=await(await documentApi('/api/documents/'+id)).json() as NoteRecord;
    const current=records.current.get(id)||latest;
    if(current&&(current.dirty||current.revision>remote.revision))return current;
    const next={...remote,content:normalizeNote(remote.content),accountId,dirty:false};
    synced.current.set(id,{revision:next.revision,content:next.content,title:next.title});return next;
  }
  async function settleSaves(){await Promise.all([...jobs.current.values()]);await persistPending();}
  function hasUnsynced(){return [...records.current.values()].some(n=>n.dirty);}
  async function open(id:string) {
    await persistPending();
    if (id === active.current && records.current.get(id)?.dirty) return true;
    const seq=++openSeq.current;setBusy(true);setError('');
    try {
      const cached=shared?undefined:await getLocalDoc(id); let next=records.current.get(id);
      if(cached?.accountId===accountId){restoreBase(cached);if(!next)next={...cached,content:normalizeNote(cached.content)};}
      if (navigator.onLine && !id.startsWith('local-')) {
        try {
          const remote=await (await documentApi('/api/documents/'+id)).json() as NoteRecord;
          if (next?.dirty) { /* save() uses the retained common base; never replace a draft here. */ }
          else {
            next={...remote,content:normalizeNote(remote.content),accountId,dirty:false};
            synced.current.set(id,{revision:remote.revision,content:next.content,title:remote.title});
          }
        } catch(err) { if(!next)throw err;setError('サーバーに接続できないため端末のメモを開きました'); }
      }
      if (!next)throw new Error('この端末にメモがありません');
      if(seq!==openSeq.current)return false;
      active.current=id;show(next);setURL(id);await persist(next);setConflict(blocked.current.has(id));
      setStatus(blocked.current.has(id)?'他端末と競合':next.dirty?'同期待ち':'保存済み');if(next.dirty)void save(id);return true;
    }catch(err){setError(err instanceof Error?err.message:'開けません');return false;}finally{if(seq===openSeq.current)setBusy(false);}
  }
  async function create(content=blankNote(),title='新しいメモ') {
    if(shared)throw new Error('共有画面では新しいメモは作成できません');
    await persistPending();
    ++openSeq.current;
    const next:NoteRecord={id:'local-'+id32(),title,revision:0,updated_at:Date.now(),content,accountId,dirty:true};
    active.current=next.id;show(next);setURL(next.id);setConflict(false);setBusy(false);
    await persist(next);setStatus('端末に保存済み');void save(next.id);return next.id;
  }
  async function flushAll() {
    if(shared)return;
    await localJobs.current;
    for(const [id,timer] of timers.current){clearTimeout(timer);timers.current.delete(id);}
    await Promise.all([...jobs.current.values()]);
    for(const n of records.current.values())if(n.dirty)await save(n.id);
    await localJobs.current;
    if((await listLocalDocs()).some(n=>n.accountId===accountId&&n.dirty))throw new Error('未同期または競合中のメモがあります。同期・復元してから一括操作してください');
  }
  async function applyOfflineCategory(op:CategoryOperation){
    if(shared)throw new Error('共有リンクからカテゴリ全体は変更できません');
    const cache=(await listLocalDocs()).filter(doc=>doc.accountId===accountId);
    const keys=[...new Set([...cache.map(x=>x.id),...records.current.keys()])];
    let changed=0;
    for(const id of keys){
      const cached=cache.find(x=>x.id===id);
      const latest=records.current.get(id);
      if(cached)restoreBase(cached);
      const record=latest||(cached?{...cached,content:normalizeNote(cached.content)} as NoteRecord:undefined);
      if(!record)continue;
      const old=record.content.note||{category:'',tags:[]};
      const path=old.category||'';
      if(op.kind==='create'||!inCategory(path,op.source))continue;
      const category=op.kind==='move'?movedCategory(path,op.source,op.target):op.kind==='delete'?op.target:op.remove?'':path;
      const tags=op.kind==='tag'?[...new Set([...(old.tags||[]),op.target])]:old.tags||[];
      const updated={...record,content:{...record.content,note:{...old,category,tags}},updated_at:Date.now(),dirty:true};
      show(updated);await persist(updated);changed++;
      // Upload the modified local record after reconnect; never require a network
      // connection at the time the user organizes notes.
      // Classification synchronization acknowledges this metadata before body uploads.
    }
    return changed;
  }
  async function applyLocalMetadata(entries:{id:string;revision:number;category:string;tags:string[]}[],options:{sync?:boolean;strictRevision?:boolean}={}){
    if(shared)throw new Error('共有リンクでは分類を一括変更できません');
    await localJobs.current;
    const prepared:NoteRecord[]=[];
    for(const entry of entries){
      const latest=await readForExport(entry.id,entry.revision);
      if(options.strictRevision!==false&&latest.revision!==entry.revision)throw new Error('書き出し後に更新されたノートがあります。もう一度書き出してください');
      prepared.push(latest);
    }
    const job=localJobs.current.then(async()=>{
      const next=entries.map((entry,i)=>{
        const current=records.current.get(entry.id),latest=current&&(current.dirty||current.revision>=prepared[i].revision)?current:prepared[i],old=latest.content.note||{category:'',tags:[]};
        const note={...old,category:entry.category,tags:[...new Set(entry.tags)],...(options.sync===false?{}:{organizationLog:[...(old.organizationLog||[]).slice(-99),{at:new Date().toISOString(),category:entry.category,tags:entry.tags}]})};
        const baseline=synced.current.get(entry.id);
        return{...latest,content:{...latest.content,note},dirty:true,updated_at:Date.now(),accountId,owner:true,base:baseline?.content||latest.content,baseTitle:baseline?.title||latest.title,baseRevision:baseline?.revision??latest.revision};
      });
      try{
        for(let i=0;i<entries.length;i++){
          const current=records.current.get(entries[i].id),old=current&&(current.dirty||current.revision>=prepared[i].revision)?current:prepared[i];
          await saveLocalRevision({...old,accountId,owner:true,base:old.content,dirty:!!old.dirty});
        }
        await putLocalDocs(next);
      }catch(error){throw new Error('端末へ一括保存できません。整理を中止しました：'+String(error));}
      for(const n of next)show(n);
    });
    localJobs.current=job;
    try{await job;}catch(error){if(localJobs.current===job)localJobs.current=Promise.resolve();throw error;}
    if(options.sync!==false)for(const entry of entries)void save(entry.id);
    return entries.length;
  }
  async function acceptMetadata(changed:{id:string;revision:number;updated_at:number;note:NoteMeta}[]) {
    for(const update of changed){
      const cached=records.current.get(update.id)||await getLocalDoc(update.id);
      if(cached&&cached.accountId===accountId&&!cached.dirty){
        const next:NoteRecord=cached.revision===update.revision-1?{...cached,content:{...cached.content,note:update.note},revision:update.revision,updated_at:update.updated_at,dirty:false}:{...await(await api('/api/documents/'+update.id)).json(),accountId,dirty:false};
        show(next);await persist(next);
      }
    }
    await refresh();
  }
  useEffect(()=>{
    let live=true;
    void (async()=>{
      const wanted=sharedAccess?.id||new URLSearchParams(location.search).get('d')||rememberedOpen();
      if(sharedAccess){await open(sharedAccess.id);return;}
      // Fast path for APK/WebView startup: restore the last cached document first,
      // then refresh the remote index in the background.
      if(wanted){
        const cached=await getLocalDoc(wanted).catch(()=>undefined);
        if(live&&cached?.accountId===accountId){
          restoreBase(cached);const next={...cached,content:normalizeNote(cached.content)} as NoteRecord;
          active.current=wanted;show(next);setURL(wanted);setBusy(false);
          setStatus(next.dirty?'同期待ち':'端末から復元');
        }
      }
      const rows=await refresh();if(!live)return;
      const target=rows.find(n=>n.id===wanted)||rows.find(n=>!n.note?.trashedAt);
      if(target){
        if(active.current!==target.id || !records.current.get(target.id)) await open(target.id);
        else if(navigator.onLine&&!target.id.startsWith('local-')) void open(target.id);
      } else if(!active.current) await create();
    })().catch(err=>setError(String(err)));
    const online=()=>{
      void listLocalDocs().then(rows=>{
        if(!navigator.onLine||shared)return;
        for(const doc of rows.filter(row=>row.accountId===accountId&&row.dirty)){
          restoreBase(doc);if(!records.current.has(doc.id))records.current.set(doc.id,{...doc,content:normalizeNote(doc.content)});
          void save(doc.id);
        }
      }).catch(()=>{});
      for(const n of records.current.values())if(n.dirty)void save(n.id);
    };
    const before=(e:BeforeUnloadEvent)=>{if([...records.current.values()].some(n=>n.dirty)){e.preventDefault();e.returnValue='';}};
    addEventListener('online',online);addEventListener('beforeunload',before);
    // Near-live changes are pulled without ever replacing a dirty local draft.
    // A concurrent write is merged only if the affected objects do not overlap.
    let refreshing=false;
    const poll=window.setInterval(async()=>{
      if(!live||refreshing||!navigator.onLine)return;
      const id=active.current,local=records.current.get(id);
      if(!id||id.startsWith('local-')||!local||local.dirty||blocked.current.has(id)||jobs.current.has(id))return;
      if((document.activeElement as HTMLElement|null)?.closest?.('[contenteditable=true]'))return;
      refreshing=true;
      try{
        const remote=await(await documentApi('/api/documents/'+id)).json() as NoteRecord;
        const current=records.current.get(id);
        if(!live||active.current!==id||!current||current.dirty||remote.revision<=current.revision)return;
        const updated={...remote,content:normalizeNote(remote.content),accountId,dirty:false};
        synced.current.set(id,{revision:updated.revision,content:updated.content,title:updated.title});
        show(updated);await persist(updated);report('最新の変更を反映しました',id);
      }catch(err){
        if(shared&&(err as {status?:number}).status===403)setError('共有リンクが無効になった可能性があります。所有者に再共有を依頼してください。');
      }
      finally{refreshing=false;}
    },2500);
    return()=>{live=false;clearInterval(poll);removeEventListener('online',online);removeEventListener('beforeunload',before);};
  },[]);
  async function reconcileClassification(entries:{id:string;category:string;tags:string[]}[]){
    await persistPending();
    for(const entry of entries){
      const cached=await getLocalDoc(entry.id);if(cached?.accountId===accountId)restoreBase(cached);
      const latest=records.current.get(entry.id)||(cached?.accountId===accountId?{...cached,content:normalizeNote(cached.content)}:undefined);
      if(!latest)continue;
      if(latest.content.note?.category===entry.category&&JSON.stringify(latest.content.note?.tags||[])===JSON.stringify(entry.tags))continue;
      const next={...latest,content:{...latest.content,note:{...latest.content.note,category:entry.category,tags:entry.tags}},dirty:true};
      show(next);await persist(next);
    }
  }
  async function resumeSync(){await refresh();for(const row of records.current.values())if(row.dirty)void save(row.id);}
  return {resolveId:(id:string)=>promoted.current.get(id)||id,readForExport,persistPending,settleSaves,hasUnsynced,reconcileClassification,resumeSync,record,list,status,error,setError,busy,conflict,change,save,open,create,refresh,flushAll,applyOfflineCategory,prepareOffline,refreshReferences,applyLocalMetadata,acceptMetadata,
    recover:()=>record && create(structuredClone(record.content),record.title+'（競合から復元）')};
}
