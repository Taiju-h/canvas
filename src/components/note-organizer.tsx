import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Download,FileText,Folder,FolderPlus,Search,Tag,X} from 'lucide-react';
import {categoryParts,categoryPath,inCategory,matchesSearch} from '@/lib/note-organization';
import {listLocalDocs} from '@/lib/local-docs';
import {readNoteAsset} from '@/lib/note-files';
import {buildNoteBackup,type BackupProgress} from '@/lib/note-backup';
import {saveBlob} from '@/lib/file-download';
import type {useNotes} from '@/lib/use-notes';
import type {OfflineWorkspace} from '@/lib/offline-workspace';
import type {Classification} from '@/lib/category-sync';
import type {CategoryOperation} from './note-categories';
import '../note-organizer.css';

type Props={accountId:string;store:ReturnType<typeof useNotes>;categories:string[];workspace:OfflineWorkspace;status:string;busy:boolean;
  onClose:()=>void;onOpen:(id:string)=>Promise<void>;onFolder:(kind:CategoryOperation['kind'],source:string)=>void;
  onAssign:(changes:Classification[])=>Promise<number>;onResolve:(choice:'local'|'remote')=>void;onExportForAI:()=>Promise<void>;onImport:(file:File)=>Promise<void>};

export default function NoteOrganizer({accountId,store,categories,workspace,status,busy,onClose,onOpen,onFolder,onAssign,onResolve,onExportForAI,onImport}:Props){
  const [folder,setFolder]=useState<string|null>(null),[query,setQuery]=useState(''),[descendants,setDescendants]=useState(true),[trash,setTrash]=useState(false);
  const [selected,setSelected]=useState<Set<string>>(()=>new Set()),[destination,setDestination]=useState<string|undefined>(),[tag,setTag]=useState('');
  const [working,setWorking]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[dataOpen,setDataOpen]=useState(false);
  const [exporting,setExporting]=useState(false),[progress,setProgress]=useState<BackupProgress>(),[storage,setStorage]=useState({cached:0,pending:0});
  const controller=useRef<AbortController|undefined>(undefined),importInput=useRef<HTMLInputElement>(null);
  const rows=store.list.filter(n=>!!n.note?.trashedAt===trash),filtered=rows.filter(n=>(folder===null||(folder===''?!n.note?.category:descendants?inCategory(n.note?.category||'',folder):categoryPath(n.note?.category||'')===folder))&&matchesSearch(n.title+' '+(n.searchText||n.excerpt||'')+' '+(n.note?.category||'')+' '+(n.note?.tags||[]).join(' '),query));
  const chosen=store.list.filter(n=>selected.has(n.id)),blocked=busy||working||exporting;
  const folderCount=(path:string)=>rows.filter(n=>inCategory(n.note?.category||'',path)).length;
  useEffect(()=>{setSelected(old=>new Set([...old].map(store.resolveId).filter(id=>store.list.some(n=>n.id===id))));},[store.list]);
  useEffect(()=>{if(folder&&!categories.includes(folder))setFolder(null);},[categories.join('\u001f')]);
  useEffect(()=>{let live=true;void listLocalDocs().then(all=>{const own=all.filter(n=>n.accountId===accountId);if(live)setStorage({cached:own.length,pending:own.filter(n=>n.dirty).length});}).catch(()=>{});return()=>{live=false;};},[dataOpen,store.list,accountId]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  function toggle(id:string){setSelected(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;});}
  async function assign(action:'move'|'tag-add'|'tag-remove'){
    setWorking(true);setMessage('');setError('');
    try{
      if(!chosen.length)throw new Error('ページを選択してください');
      if(action==='move'&&destination===undefined)throw new Error('移動先のフォルダを選択してください');
      if(action!=='move'&&(!tag.trim()||tag.trim().length>80))throw new Error('タグは1～80文字です');
      const changes=chosen.map(n=>({id:n.id,title:n.title,revision:n.revision,category:action==='move'?destination!:n.note?.category||'',tags:action==='tag-add'?[...new Set([...(n.note?.tags||[]),tag.trim()])]:action==='tag-remove'?(n.note?.tags||[]).filter(t=>t!==tag.trim()):n.note?.tags||[]}));
      const changed=changes.filter((n,i)=>n.category!==(chosen[i].note?.category||'')||JSON.stringify(n.tags)!==JSON.stringify(chosen[i].note?.tags||[]));
      const count=changed.length?await onAssign(changed):0;setSelected(new Set());setMessage(count?`${count}ページの${action==='move'?'フォルダ':action==='tag-add'?'タグ追加':'タグ解除'}を端末に保存しました。`:'選択したページはすでに指定の分類です。');
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}
  }
  async function backup(selection:boolean){
    setExporting(true);setError('');setMessage('');setProgress(undefined);controller.current=new AbortController();
    try{
      await store.persistPending();
      const rows=selection?chosen:navigator.onLine?await store.refresh(true):store.list;
      if(!rows.length)throw new Error('取り出すページがありません');
      const signal=controller.current.signal;
      const blob=await buildNoteBackup(rows,store.readForExport,(id,a)=>readNoteAsset(id,a,undefined,signal),workspace,setProgress,signal);
      const date=new Date(),stamp=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      await saveBlob('KaeruNote-'+(selection?'選択ページ':'全ページ')+'-'+stamp+'.zip',blob);
      setMessage('ZIPを作成し、ファイルの保存操作を開始しました。展開してindex.htmlを開くとページと原本を確認できます。');
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setExporting(false);controller.current=undefined;}
  }
  async function exportAI(){setWorking(true);setError('');try{await onExportForAI();setMessage('整理用のMDと分類JSONを作成しました。画像・添付の原本も必要な場合はZIPを保存してください。');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}}
  async function importAI(file:File){setWorking(true);setError('');try{await onImport(file);setMessage('整理ファイルの分類を端末に反映しました。');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}}
  async function openPage(id:string){setError('');try{await onOpen(id);}catch(e){setError(e instanceof Error?e.message:String(e));}}
  return <section className="notes-organizer" role="dialog" aria-modal="true" aria-labelledby="note-organizer-title">
    <header className="notes-organizer-header"><button disabled={exporting||working} onClick={onClose}><ArrowLeft size={18}/>ノートに戻る</button><div><h1 id="note-organizer-title">ページ・フォルダ整理</h1><p>{store.list.filter(n=>!n.note?.trashedAt).length}ページ · {categories.length}フォルダ</p></div><button className="notes-organizer-primary" disabled={working} onClick={()=>setDataOpen(true)}><Download size={17}/>データを取り出す</button></header>
    <div className="notes-organizer-layout">
      <aside className="notes-organizer-folders" aria-label="整理するフォルダ"><div className="notes-organizer-folder-heading"><strong>フォルダ</strong><button disabled={blocked} title="フォルダを追加" aria-label="整理画面でフォルダを追加" onClick={()=>onFolder('create',folder||'')}><FolderPlus size={19}/></button></div>
        <button className={folder===null?'active':''} onClick={()=>setFolder(null)}>すべてのページ <small>{rows.length}</small></button>
        <button className={folder===''?'active':''} onClick={()=>setFolder('')}>未分類 <small>{rows.filter(n=>!n.note?.category).length}</small></button>
        <div className="notes-organizer-folder-list">{categories.map(path=><button key={path} title={path} className={folder===path?'active':''} style={{paddingLeft:12+(categoryParts(path).length-1)*14}} onClick={()=>setFolder(path)}><Folder size={16}/><span>{categoryParts(path).at(-1)}</span><small>{folderCount(path)}</small></button>)}</div>
        <div className="notes-organizer-folder-actions"><strong>{folder||'フォルダを選ぶと管理できます'}</strong><button disabled={blocked||!folder} onClick={()=>onFolder('move',folder!)}>名前変更・移動</button><button disabled={blocked||!folder} onClick={()=>onFolder('delete',folder!)}>フォルダを削除</button><small>フォルダ削除ではページと添付を保持します。</small></div>
      </aside>
      <main className="notes-organizer-pages"><div className="notes-organizer-search"><Search size={17}/><input aria-label="整理するページを検索" placeholder="タイトル・本文・フォルダ・タグで検索" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <div className="notes-organizer-filter"><strong>{folder===null?'すべてのページ':folder||'未分類'} · {filtered.length}件</strong><label><input type="checkbox" checked={descendants} onChange={e=>setDescendants(e.target.checked)}/>子フォルダを含める</label><label><input type="checkbox" checked={trash} onChange={e=>{setTrash(e.target.checked);setSelected(new Set());}}/>ゴミ箱のページ</label></div>
        <div className="notes-organizer-bulk" role="group" aria-label="選択ページの整理"><div className="notes-organizer-selection"><strong>{selected.size}件選択</strong><button disabled={blocked||!filtered.length} onClick={()=>setSelected(old=>new Set([...old,...filtered.map(n=>n.id)]))}>表示中をすべて選択</button><button disabled={blocked||!selected.size} onClick={()=>setSelected(new Set())}>選択解除</button></div>
          <div className="notes-organizer-bulk-line"><label>移動先<select aria-label="選択ページの移動先" value={destination??'__choose__'} onChange={e=>setDestination(e.target.value==='__choose__'?undefined:e.target.value)}><option value="__choose__">フォルダを選択</option><option value="">未分類</option>{categories.map(p=><option key={p}>{p}</option>)}</select></label><button disabled={blocked||!selected.size||destination===undefined} onClick={()=>void assign('move')}>選択ページを移動</button></div>
          <div className="notes-organizer-bulk-line"><label><Tag size={15}/>タグ<input aria-label="選択ページのタグ" value={tag} maxLength={80} placeholder="タグ名" onChange={e=>setTag(e.target.value)}/></label><button disabled={blocked||!selected.size||!tag.trim()} onClick={()=>void assign('tag-add')}>タグを追加</button><button disabled={blocked||!selected.size||!tag.trim()} onClick={()=>void assign('tag-remove')}>タグを解除</button></div><small>本文・画像・添付を保持して分類を変更します。分類：{status}</small>
        </div>
        {message&&<p className="notes-organizer-message" role="status">{message}</p>}{error&&<p className="notes-organizer-error" role="alert">{error}</p>}
        {!!workspace.conflicts?.length&&<section className="notes-organizer-conflict" role="alert"><strong>他の端末の分類変更と競合しています。</strong><p>本文・添付と、この端末の整理は保持しています。選択は未同期の分類操作全体に適用します。</p>{workspace.conflicts.map((c,i)=><details key={i} open><summary>{c.name}</summary><dl><dt>変更前</dt><dd>{c.base}</dd><dt>この端末</dt><dd>{c.local}</dd><dt>サーバー</dt><dd>{c.remote}</dd></dl></details>)}<button disabled={blocked} onClick={()=>onResolve('local')}>この端末の整理を採用</button><button disabled={blocked} onClick={()=>onResolve('remote')}>サーバーの分類を採用</button></section>}
        <div className="notes-organizer-table-wrap"><table className="notes-organizer-table"><thead><tr><th>選択</th><th>ページ</th><th>フォルダ・タグ</th><th>更新日</th></tr></thead><tbody>{filtered.map(n=><tr key={n.id} className={selected.has(n.id)?'selected':''}><td><label className="notes-organizer-check"><input type="checkbox" disabled={blocked} aria-label={n.title+'を選択'} checked={selected.has(n.id)} onChange={()=>toggle(n.id)}/></label></td><td><button disabled={blocked} onClick={()=>void openPage(n.id)}><FileText size={16}/><strong>{n.title||'新しいメモ'}</strong></button><p>{n.excerpt||'本文なし'}</p></td><td><span>{n.note?.category||'未分類'}</span><small>{(n.note?.tags||[]).join(' · ')||'タグなし'}</small></td><td>{new Date(n.updated_at).toLocaleDateString('ja-JP')}</td></tr>)}</tbody></table>{!filtered.length&&<p className="notes-organizer-empty">該当するページはありません。</p>}</div>
      </main>
    </div>
    {dataOpen&&<div className="notes-organizer-data-backdrop"><section className="notes-organizer-data" role="dialog" aria-modal="true" aria-labelledby="note-data-title"><header><h2 id="note-data-title">自分のデータを取り出す</h2><button disabled={exporting||working} aria-label="データの取り出しを閉じる" onClick={()=>setDataOpen(false)}><X size={20}/></button></header>
      <div className="notes-organizer-storage"><strong>保存場所</strong><p>ノート・フォルダはこのサイトのサーバーへ保存します。画像・添付も自分の利用者情報で取得する非公開データです。開いたデータと未同期の編集は、このブラウザ／アプリの内部にも保持します。</p><p>一覧 {store.list.length}ページ · この端末に取得済み {storage.cached}ページ · 同期待ち {storage.pending}ページ</p><p>オフライン用の端末保存は、ダウンロードフォルダへの書き出しではありません。下のZIPで自分のファイルとして取り出せます。</p></div>
      <button className="notes-organizer-export" disabled={blocked||!store.list.length} onClick={()=>void backup(false)}><Download size={19}/><span><strong>全{store.list.length}ページ・画像・添付をZIPで保存</strong><small>ゴミ箱のページ、空フォルダの定義、元のIDと分類、編集データも含めます。</small></span></button>
      <button disabled={blocked||!selected.size} onClick={()=>void backup(true)}>選択した{selected.size}ページだけZIPで保存</button>
      {progress&&<p role="status">ページ {progress.done}/{progress.total} · 原本 {progress.files}ファイル{exporting&&progress.page?' · '+progress.page:''}</p>}{exporting&&<button onClick={()=>controller.current?.abort()}>取り出しを中止</button>}
      {message&&<p className="notes-organizer-message" role="status">{message}</p>}{error&&<p className="notes-organizer-error" role="alert">{error}</p>}
      <div className="notes-organizer-ai-files"><h3>ChatGPTへ渡して整理する</h3><p>本文と分類を渡して整理案を作り、分類JSONを読み込んで反映できます。画像・添付の原本はZIPに含めます。</p><button disabled={blocked} onClick={()=>void exportAI()}>整理用MD・分類JSONを書き出す</button><button disabled={blocked} onClick={()=>importInput.current?.click()}>整理した分類JSONを読み込む</button><input ref={importInput} hidden type="file" accept="application/json,.json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void importAI(f);}}/></div>
    </section></div>}
  </section>;
}
