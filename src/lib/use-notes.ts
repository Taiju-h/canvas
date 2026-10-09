import { useEffect, useRef, useState } from 'react';
import { getLocalDoc, listLocalDocs, putLocalDoc, deleteLocalDoc, getLocalImage, putLocalImage } from './local-docs';
import { api, blankNote, id32, indexOf, normalizeNote, type NoteRecord, type NoteIndex, type NoteDoc, type NoteMeta } from './notes';

export function useNotes(accountId: string) {
  const [record,setRecord] = useState<NoteRecord | null>(null);
  const [list,setList] = useState<NoteIndex[]>([]);
  const [status,setStatus] = useState('準備中');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [conflict,setConflict] = useState(false);
  const records = useRef(new Map<string,NoteRecord>());
  const active = useRef(''); const blocked = useRef(new Set<string>());
  const jobs = useRef(new Map<string,Promise<void>>()); const timers = useRef(new Map<string,ReturnType<typeof setTimeout>>());
  const localJobs = useRef(Promise.resolve()); const openSeq = useRef(0);
  const lastOpenKey = 'canvas-last-open:'+accountId;
  function rememberOpen(id:string) { try { localStorage.setItem(lastOpenKey,id); } catch {} }
  function rememberedOpen() { try { return localStorage.getItem(lastOpenKey)||''; } catch { return ''; } }
  function show(next: NoteRecord) { records.current.set(next.id,next); if (active.current === next.id) { setRecord(next); setConflict(blocked.current.has(next.id)); }
    setList(old => [indexOf(next), ...old.filter(n=>n.id!==next.id)].sort((a,b)=>b.updated_at-a.updated_at)); }
  function persist(next: NoteRecord) {
    localJobs.current = localJobs.current.catch(()=>{}).then(async()=> { await putLocalDoc({ ...next, base: next.content, dirty: !!next.dirty, owner: true, accountId }); });
    return localJobs.current;
  }
  function report(message: string, id: string) { if (active.current === id) setStatus(message); }
  async function refresh(strict=false) {
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
    for (const n of local) if (!merged.has(n.id) || n.dirty) merged.set(n.id,indexOf({ ...n,content:normalizeNote(n.content) }));
    for (const n of records.current.values()) if (n.dirty) merged.set(n.id,indexOf(n));
    const result=[...merged.values()].sort((a,b)=>b.updated_at-a.updated_at); setList(result); return result;
  }
  function save(id = active.current): Promise<void> {
    if (jobs.current.has(id)) return jobs.current.get(id)!;
    if (blocked.current.has(id)) return Promise.resolve();
    const job = (async()=> {
      let key=id;
      while (navigator.onLine) {
        let sent=records.current.get(key); if (!sent?.dirty) break;
        report('同期中…',key);
        try {
          const isNew=key.startsWith('local-');
          if (!isNew) {
            const ids=[...new Set([...sent.content.layers.map(l=>l.rasterImageId),...sent.content.items.map(i=>i.imageId)].filter((id):id is string=>!!id?.startsWith('local-')))];
            for (const imageId of ids) {
              const blob=await getLocalImage(imageId);if(!blob)throw new Error('端末の手書き画像を取得できません。元の端末から同期してください');
              const form=new FormData();form.set('file',blob,'drawing.png');
              const uploaded=await(await api('/api/documents/'+key+'/images',{method:'POST',body:form})).json() as {imageId:string};
              await putLocalImage(uploaded.imageId,blob);
              const latest=records.current.get(key)!;
              const content={...latest.content,layers:latest.content.layers.map(l=>l.rasterImageId===imageId?{...l,rasterImageId:uploaded.imageId}:l),items:latest.content.items.map(i=>i.imageId===imageId?{...i,imageId:uploaded.imageId}:i)};
              sent={...latest,content};show(sent);await persist(sent);
            }
          }
          const response=await api('/api/documents'+(isNew?'':'/'+key), { method:isNew?'POST':'PUT', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ title:sent.title,content:sent.content,revision:sent.revision }) });
          const result=await response.json() as {id:string;revision:number};
          const latest=records.current.get(key)!;
          const next={...latest,id:result.id,revision:result.revision,dirty:latest.content!==sent.content || latest.title!==sent.title || (isNew && [...latest.content.layers.map(l=>l.rasterImageId),...latest.content.items.map(i=>i.imageId)].some(id=>id?.startsWith('local-')))};
          if (isNew) {
            records.current.delete(key); setList(old=>old.filter(n=>n.id!==key));
            if (active.current===key) { active.current=result.id; setURL(result.id); }
            show(next); await persist(next); await deleteLocalDoc(key); key=result.id;
          }
          show(next); await persist(next); report(next.dirty?'同期待ち':'保存済み',key);
        } catch (err) {
          if ((err as {status?:number}).status===409) { blocked.current.add(key); if (active.current===key) setConflict(true); report('他端末と競合・この端末の内容は保持しています',key); }
          else { report('端末保存済み・同期待ち',key); setError(err instanceof Error?err.message:'同期できません'); }
          break;
        }
      }
    })().finally(()=>{ jobs.current.delete(id); });
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
  async function open(id:string) {
    if (id === active.current && records.current.get(id)?.dirty) return;
    const seq=++openSeq.current;setBusy(true);setError('');
    try {
      const cached=await getLocalDoc(id); let next=records.current.get(id);
      if (!next && cached?.accountId===accountId) next={...cached,content:normalizeNote(cached.content)};
      if (navigator.onLine && !id.startsWith('local-')) {
        try {
          const remote=await (await api('/api/documents/'+id)).json() as NoteRecord;
          if (next?.dirty) { if(next.revision!==remote.revision)blocked.current.add(id); }
          else next={...remote,content:normalizeNote(remote.content),accountId,dirty:false};
        } catch(err) { if(!next)throw err;setError('サーバーに接続できないため端末のメモを開きました'); }
      }
      if (!next)throw new Error('この端末にメモがありません');
      if(seq!==openSeq.current)return;
      active.current=id;show(next);setURL(id);await persist(next);setConflict(blocked.current.has(id));
      setStatus(blocked.current.has(id)?'他端末と競合':next.dirty?'同期待ち':'保存済み');if(next.dirty)void save(id);
    }catch(err){setError(err instanceof Error?err.message:'開けません');}finally{if(seq===openSeq.current)setBusy(false);}
  }
  async function create(content=blankNote(),title='新しいメモ') {
    ++openSeq.current;
    const next:NoteRecord={id:'local-'+id32(),title,revision:0,updated_at:Date.now(),content,accountId,dirty:true};
    active.current=next.id;show(next);setURL(next.id);setConflict(false);setBusy(false);
    await persist(next);setStatus('端末に保存済み');await save(next.id);
  }
  async function flushAll() {
    await localJobs.current;
    for(const [id,timer] of timers.current){clearTimeout(timer);timers.current.delete(id);}
    await Promise.all([...jobs.current.values()]);
    for(const n of records.current.values())if(n.dirty)await save(n.id);
    await localJobs.current;
    if((await listLocalDocs()).some(n=>n.accountId===accountId&&n.dirty))throw new Error('未同期または競合中のメモがあります。同期・復元してから一括操作してください');
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
      const wanted=new URLSearchParams(location.search).get('d')||rememberedOpen();
      // Fast path for APK/WebView startup: restore the last cached document first,
      // then refresh the remote index in the background.
      if(wanted){
        const cached=await getLocalDoc(wanted).catch(()=>undefined);
        if(live&&cached?.accountId===accountId){
          const next={...cached,content:normalizeNote(cached.content)} as NoteRecord;
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
    const online=()=>{for(const n of records.current.values())if(n.dirty)void save(n.id);};
    const before=(e:BeforeUnloadEvent)=>{if([...records.current.values()].some(n=>n.dirty)){e.preventDefault();e.returnValue='';}};
    addEventListener('online',online);addEventListener('beforeunload',before);
    return()=>{live=false;removeEventListener('online',online);removeEventListener('beforeunload',before);};
  },[]);
  return {record,list,status,error,setError,busy,conflict,change,save,open,create,refresh,flushAll,acceptMetadata,
    recover:()=>record && create(structuredClone(record.content),record.title+'（競合から復元）')};
}
