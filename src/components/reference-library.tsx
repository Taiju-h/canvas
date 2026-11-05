import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Bookmark,Check,Download,ExternalLink,FileText,Folder,Image,Link,Plus,Search,Star,WifiOff,X,Play} from 'lucide-react';
import type {useNotes} from '@/lib/use-notes';
import type {useDeviceOffline} from '@/lib/use-device-offline';
import {getLocalImage,listLocalDocs,putLocalImage} from '@/lib/local-docs';
import {blankNote,escapeHTML,id32,normalizeNote,type Attachment,type NoteRecord} from '@/lib/notes';
import {noteReferenceEntries,safeReferenceURL,referenceKey,youtubeVideoId,type ReferenceEntry,type ReferenceKind} from '@/lib/reference-library';
import {readNoteAsset} from '@/lib/note-files';
import {networkAvailable} from '@/lib/network';
import {saveBlob} from '@/lib/file-download';
import {matchesSearch} from '@/lib/note-organization';
import {crmLinks,crmKinds} from '@/lib/crm-links';
import '../reference-library.css';

function referenceMarkupForMedia(kind:'image'|'video',id:string,name:string){return kind==='image'?`<p><img data-kn-local-image="${id}" alt="${escapeHTML(name)}"></p>`:`<p><video data-kn-local-file="${id}" title="${escapeHTML(name)}" controls preload="metadata" playsinline></video></p>`;}
const labels:Record<ReferenceKind,string>={note:'メモ',image:'画像',video:'動画',youtube:'YouTube',link:'リンク'};
function KindIcon({kind,size=22}:{kind:ReferenceKind;size?:number}){const Icon={note:FileText,image:Image,video:Play,youtube:Play,link:Link}[kind];return <Icon size={size}/>;}
function ReferenceImage({entry,large=false}:{entry:ReferenceEntry;large?:boolean}){
  const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(large),[url,setURL]=useState(''),[failed,setFailed]=useState(false);
  useEffect(()=>{if(visible||!ref.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'180px'});observer.observe(ref.current);return()=>observer.disconnect();},[visible]);
  useEffect(()=>{
    if(!visible)return;let live=true,objectURL='';setFailed(false);
    if(!entry.asset){setURL(entry.url||'');return;}
    void(async()=>{
      let blob=await getLocalImage(entry.asset!.id);
      if(!blob&&networkAvailable()){blob=await readNoteAsset(entry.documentId,entry.asset!);await putLocalImage(entry.asset!.id,blob);}
      if(!live)return;
      if(!blob){setFailed(true);return;}
      objectURL=URL.createObjectURL(blob);setURL(objectURL);
    })().catch(()=>{if(live)setFailed(true);});
    return()=>{live=false;if(objectURL)URL.revokeObjectURL(objectURL);};
  },[entry.id,visible]);
  return <div className={'kn-reference-image'+(large?' is-large':'')} ref={ref}>{url&&!failed?entry.kind==='video'?<video src={url} title={entry.title} controls={large} preload="metadata" playsInline onError={()=>setFailed(true)}/>:<img loading={large?'eager':'lazy'} src={url} alt={entry.title} onError={()=>setFailed(true)}/>:<span><KindIcon kind={entry.kind} size={32}/>{failed?'未取得または再生できない形式です':'読み込み中'}</span>}</div>;
}
type Props={accountId:string;store:ReturnType<typeof useNotes>;offline:ReturnType<typeof useDeviceOffline>;categories:string[];
  onClose:()=>void;onOpen:(id:string)=>Promise<void>;onInsert:(entry:ReferenceEntry)=>Promise<void>;initialDownloads?:boolean};
export default function ReferenceLibrary({accountId,store,offline,categories,onClose,onOpen,onInsert,initialDownloads=false}:Props){
  const dialog=useRef<HTMLDialogElement>(null),search=useRef<HTMLInputElement>(null),imageInput=useRef<HTMLInputElement>(null);
  const [entries,setEntries]=useState<ReferenceEntry[]>([]),[loaded,setLoaded]=useState(0),[loading,setLoading]=useState(true);
  const [tab,setTab]=useState<'all'|'favorites'|ReferenceKind>('all'),[query,setQuery]=useState(''),[folder,setFolder]=useState(''),[tag,setTag]=useState(''),[crm,setCRM]=useState('');
  const [downloads,setDownloads]=useState(initialDownloads),[adding,setAdding]=useState(false),[selected,setSelected]=useState<ReferenceEntry|null>(null);
  const [title,setTitle]=useState(''),[url,setURL]=useState(''),[newFolder,setNewFolder]=useState(''),[newTags,setNewTags]=useState(''),[pin,setPin]=useState(true);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const latest=useRef(store);latest.current=store;
  useEffect(()=>{dialog.current?.showModal();search.current?.focus();return()=>dialog.current?.close();},[]);
  useEffect(()=>{
    let live=true;setLoading(true);
    void(async()=>{
      await store.persistPending();
      const docs=new Map<string,NoteRecord>((await listLocalDocs()).filter(n=>n.accountId===accountId).map(n=>[n.id,{...n,content:normalizeNote(n.content)}]));
      if(store.record)docs.set(store.record.id,store.record);
      // Index metadata provides uncached memo titles too, while image/link
      // results only claim content that has actually been read onto this device.
      const result=[...docs.values()].flatMap(noteReferenceEntries);
      for(const n of store.list)if(!docs.has(n.id)&&!n.note?.trashedAt&&n.note?.importState!=='pending')result.push({id:n.id+':note',key:'note',kind:'note',documentId:n.id,title:n.title,parentTitle:n.title,category:n.note?.category||'',tags:n.note?.tags||[],pinned:!!n.note?.pinned,updatedAt:n.updated_at,excerpt:n.searchText||n.excerpt||'',crmLinks:crmLinks(n.note?.crmLinks)});
      if(live){setEntries(result);setLoaded(docs.size);}
    })().catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[accountId,store.list,store.record,offline.generation]);
  const folders=[...new Set(entries.map(e=>e.category).filter(Boolean))].sort();
  const tags=[...new Set(entries.flatMap(e=>e.tags))].sort();
  const crmOptions=[...new Map(entries.flatMap(e=>(e.crmLinks||[]).map(c=>[c.url,c] as const))).values()];
  const counts={all:entries.length,favorites:entries.filter(e=>e.pinned).length,note:entries.filter(e=>e.kind==='note').length,image:entries.filter(e=>e.kind==='image').length,video:entries.filter(e=>e.kind==='video').length,youtube:entries.filter(e=>e.kind==='youtube').length,link:entries.filter(e=>e.kind==='link').length};
  const filtered=useMemo(()=>entries.filter(e=>(tab==='all'||tab==='favorites'&&e.pinned||e.kind===tab)&&(!folder||e.category===folder||e.category.startsWith(folder+' / '))&&(!tag||e.tags.includes(tag))&&(!crm||e.crmLinks?.some(c=>c.url===crm))&&matchesSearch([e.title,e.parentTitle,e.searchText||e.excerpt,e.url,e.targetURL,e.category,...e.tags,...(e.crmLinks||[]).flatMap(c=>[c.label,c.url])].join(' '),query)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt),[entries,tab,query,folder,tag,crm]);
  const canInsert=!!store.record&&!store.record.content.note?.trashedAt&&!store.record.content.fixedNote?.locked&&store.record.content.note?.importState!=='pending';
  async function action(job:()=>Promise<void>,success=''){
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{await job();if(success)setMessage(success);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  async function open(entry:ReferenceEntry){await onOpen(entry.documentId);}
  async function copyLink(entry:ReferenceEntry){
    const href=entry.targetURL||entry.url||new URL('/canvas/?d='+entry.documentId,location.origin).href;
    await navigator.clipboard.writeText(href);
  }
  async function saveImage(entry:ReferenceEntry){
    if(!entry.asset)throw new Error('外部の画像・動画は元のメモから開いて保存してください');
    await saveBlob(entry.asset.name,await readNoteAsset(entry.documentId,entry.asset));
  }
  async function addLink(){
    const target=safeReferenceURL(url);if(!target)throw new Error('http:// または https:// のURLを入力してください');
    const name=title.trim()||new URL(target).hostname,kind=youtubeVideoId(target)?'youtube':'link';
    const doc=blankNote();doc.note={category:newFolder.trim(),tags:newTags.split(/[,、]/).map(t=>t.trim()).filter(Boolean),referencePins:pin?[referenceKey(kind,target)]:[]};
    doc.fixedNote!.html=`<p><a href="${escapeHTML(target)}" target="_blank" rel="noopener noreferrer">${escapeHTML(name)}</a></p>`;
    await latest.current.create(doc,name);setAdding(false);setTitle('');setURL('');setTab(kind);
  }
  async function addImages(files:File[]){
    for(const file of files){
      if(!/^(image|video)\//.test(file.type))throw new Error('画像・動画ファイルを選んでください');
      if(!file.size||file.size>512*1024*1024)throw new Error('画像・動画は1バイト～512MBです');
      const attachment:Attachment={id:id32(),name:file.name,mime:file.type,size:file.size,pending:true};
      await putLocalImage(attachment.id,file);
      const kind=file.type.startsWith('video/')?'video':'image';
      const doc=blankNote();doc.note={category:newFolder.trim(),tags:newTags.split(/[,、]/).map(t=>t.trim()).filter(Boolean),referencePins:pin?[referenceKey(kind,attachment.id)]:[]};
      doc.attachments=[attachment];doc.fixedNote!.html=referenceMarkupForMedia(kind,attachment.id,file.name);
      await latest.current.create(doc,file.name);
    }
    setAdding(false);setTab('image');
  }
  return <dialog ref={dialog} role="dialog" className="kn-reference-library" aria-labelledby="reference-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="kn-reference-header"><button onClick={onClose} aria-label="資料を閉じる"><ArrowLeft size={18}/><span>ノートに戻る</span></button><div><small>MY REFERENCES</small><h1 id="reference-title">画像・動画・メモ</h1></div><button className="kn-reference-add" onClick={()=>setAdding(v=>!v)} aria-expanded={adding}><Plus size={18}/><span>資料を追加</span></button></header>
    <div className="kn-reference-layout"><aside className="kn-reference-nav" aria-label="資料の種類">
      {(['all','favorites','image','video','youtube','link','note'] as const).map(kind=><button key={kind} className={tab===kind?'active':''} aria-pressed={tab===kind} onClick={()=>{setTab(kind);setSelected(null);}}>{kind==='all'?<Bookmark size={19}/>:kind==='favorites'?<Star size={19}/>:<KindIcon kind={kind} size={19}/>}<span>{kind==='all'?'すべて':kind==='favorites'?'よく使う':labels[kind]}</span><small>{counts[kind]}</small></button>)}
      <div className="kn-reference-device"><Download size={21}/><strong>{offline.working?'端末に保存中':offline.ready?'オフライン準備完了':offline.online?'端末の保存状況':'端末の保存分で利用中'}</strong><p>{offline.message}</p><button onClick={()=>setDownloads(v=>!v)} aria-expanded={downloads}>保存状況を見る</button></div>
      <p className="kn-reference-hint">Joplinから取り込んだメモの画像やリンクも、ここから探せます。</p>
    </aside><main className="kn-reference-main">
      <div className="kn-reference-search"><Search size={21}/><input ref={search} aria-label="資料を検索" placeholder="画像名・YouTube・本文・タグを検索" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="資料の検索を消す" onClick={()=>setQuery('')}><X size={17}/></button>}</div>
      <div className="kn-reference-filters"><label><Folder size={15}/><select aria-label="資料のフォルダ" value={folder} onChange={e=>setFolder(e.target.value)}><option value="">すべてのフォルダ</option>{folders.map(f=><option key={f}>{f}</option>)}</select></label><select aria-label="資料のタグ" value={tag} onChange={e=>setTag(e.target.value)}><option value="">すべてのタグ</option>{tags.map(t=><option key={t}>{t}</option>)}</select>{!!crmOptions.length&&<select aria-label="資料のCRM関連先" value={crm} onChange={e=>setCRM(e.target.value)}><option value="">すべてのCRM関連先</option>{crmOptions.map(c=><option key={c.url} value={c.url}>{crmKinds[c.kind]}：{c.label}</option>)}</select>}<span>{filtered.length} 件</span></div>
      {downloads&&<section className="kn-reference-downloads" aria-label="端末への保存状況"><div><Download size={20}/><strong>アプリを開いたら自動で端末に保存</strong><button aria-label="保存状況を閉じる" onClick={()=>setDownloads(false)}><X size={17}/></button></div><p role="status">{offline.message}</p>{offline.progress&&<><progress value={offline.progress.done} max={Math.max(1,offline.progress.total)}/><p>ノート {offline.progress.done} / {offline.progress.total} 件 · 今回取得した添付 {offline.progress.files} 件 · 未取得 {offline.progress.errors} 件</p></>}<p>この端末のノート {loaded} 件。保存したメモ・画像・リンク一覧は通信なしで利用できます。YouTubeの再生と外部サイトを開く操作には接続が必要です。</p><button disabled={offline.working} onClick={()=>void offline.prepare()}><Download size={16}/>{offline.working?'保存しています…':'保存を確認・再試行'}</button></section>}
      {adding&&<form className="kn-reference-add-form" onSubmit={e=>{e.preventDefault();void action(addLink,'リンクを保存しました');}}><div><h2>いつも使う資料を追加</h2><button type="button" aria-label="資料の追加を閉じる" onClick={()=>setAdding(false)}><X size={18}/></button></div><label>名前<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="例：Schem Videos 日本語" maxLength={80}/></label><label>YouTube・WebのURL<input value={url} onChange={e=>setURL(e.target.value)} placeholder="https://youtu.be/…" type="url"/></label><div className="kn-reference-add-meta"><label>フォルダ<input list="reference-folders" value={newFolder} onChange={e=>setNewFolder(e.target.value)} maxLength={200}/></label><label>タグ（カンマ区切り）<input value={newTags} onChange={e=>setNewTags(e.target.value)}/></label></div><datalist id="reference-folders">{categories.map(c=><option key={c}>{c}</option>)}</datalist><label className="kn-reference-pin-option"><input type="checkbox" checked={pin} onChange={e=>setPin(e.target.checked)}/>「よく使う」に固定</label><footer><button type="submit" disabled={busy||!url.trim()}><Link size={17}/>リンクを保存</button><button type="button" disabled={busy} onClick={()=>imageInput.current?.click()}><Image size={17}/>画像・動画を追加</button><button type="button" disabled={busy} onClick={()=>void action(async()=>{await latest.current.create();onClose();})}><FileText size={17}/>メモを書く</button></footer></form>}
      <input type="file" accept="image/*,video/*" multiple hidden ref={imageInput} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void action(()=>addImages(files),'画像・動画を端末に保存しました');}}/>
      {(message||error)&&<p className={'kn-reference-message'+(error?' is-error':'')} role={error?'alert':'status'}>{error||message}</p>}
      {store.list.length>loaded&&<p className="kn-reference-notice">未取得のメモがあります。端末への保存が進むと画像・リンクも一覧に加わります。</p>}
      {selected&&<section className="kn-reference-preview" aria-label="画像・動画のプレビュー"><header><strong>{selected.title}</strong><button aria-label="画像・動画のプレビューを閉じる" onClick={()=>setSelected(null)}><X size={19}/></button></header><ReferenceImage entry={selected} large/><footer>{selected.targetURL&&<a href={selected.targetURL} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>リンク先を開く</a>}<button disabled={busy||!selected.asset} onClick={()=>void action(()=>saveImage(selected),'原本の保存を開始しました')}><Download size={16}/>原本を保存</button><button disabled={busy||!canInsert} onClick={()=>void action(()=>onInsert(selected),'今のノートの末尾に資料を追加しました')}>今のノートへ追加</button></footer></section>}
      <div className="kn-reference-grid" aria-busy={loading}>
        {filtered.map(entry=>{
          const media=entry.kind==='image'||entry.kind==='video',href=media?entry.targetURL:entry.kind==='note'?undefined:entry.url;
          const content=<>{media?<ReferenceImage entry={entry}/>:<div className="kn-reference-card-symbol"><KindIcon kind={entry.kind} size={entry.kind==='youtube'?42:29}/><span>{labels[entry.kind]}</span></div>}<div className="kn-reference-card-body"><small>{entry.category||'未分類'}</small><h2>{entry.title||'新しいメモ'}</h2>{entry.kind==='note'?<p>{entry.excerpt||'本文のないメモ'}</p>:<><p className="kn-reference-parent">{entry.parentTitle}</p>{(entry.targetURL||entry.url)&&<p className="kn-reference-url">{entry.targetURL||entry.url}</p>}</>}{!!entry.tags.length&&<div className="kn-reference-tags">{entry.tags.slice(0,4).map(t=><span key={t}>#{t}</span>)}</div>}{!!entry.crmLinks?.length&&<div className="kn-reference-tags kn-reference-crm">{entry.crmLinks.map(c=><span key={c.id}>CRM · {c.label}</span>)}</div>}</div></>;
          return <article className={'kn-reference-card kind-'+entry.kind} key={entry.id}>
            {href?<a className="kn-reference-card-main" href={href} target="_blank" rel="noopener noreferrer" aria-label={entry.title+'のリンク先を開く'}>{content}</a>:<button className="kn-reference-card-main" disabled={busy} onClick={()=>media?setSelected(entry):void action(()=>open(entry))} aria-label={media?entry.title+'を表示':entry.title+'のメモを開く'}>{content}</button>}
            <button className={'kn-reference-star'+(entry.pinned?' active':'')} disabled={busy} aria-label={entry.title+(entry.pinned?'の固定を解除':'をよく使うに固定')} aria-pressed={entry.pinned} onClick={()=>void action(()=>store.pinReference(entry.documentId,entry.key))}><Star size={19} fill={entry.pinned?'currentColor':'none'}/></button>
            <footer><button disabled={busy} onClick={()=>void action(()=>open(entry))}><FileText size={14}/>メモを開く</button>{media&&<button disabled={busy} onClick={()=>setSelected(entry)}>プレビュー</button>}<button disabled={busy||!canInsert} onClick={()=>void action(()=>onInsert(entry),'今のノートの末尾に資料を追加しました')} title="編集中のノートの末尾に追加"><Plus size={15}/>挿入</button><button disabled={busy} onClick={()=>void action(()=>copyLink(entry),'リンクをコピーしました')} aria-label={entry.title+'のリンクをコピー'}><Link size={15}/></button></footer>
          </article>;
        })}
      </div>
      {!filtered.length&&<div className="kn-reference-empty">{loading?<Download size={36}/>:tab==='favorites'?<Star size={36}/>:<Bookmark size={36}/>}<h2>{loading?'資料を読み込んでいます':query?'見つかりませんでした':tab==='favorites'?'よく使う資料をここに':'資料をまとめて取り出す'}</h2><p>{tab==='favorites'?'画像・動画・メモの☆を押すと、ここからすぐ開けます。':'「資料を追加」で画像やリンクを保存できます。Joplinのメモは左メニューから取り込めます。'}</p></div>}
      <div className="kn-reference-footer-note"><WifiOff size={14}/><span>保存済みの添付動画・画像・メモはオフラインでも利用できます。外部動画・サイトには接続が必要です。</span>{offline.ready&&<Check size={15}/>}</div>
    </main></div>
  </dialog>;
}
