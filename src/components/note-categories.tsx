import {useEffect,useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,Folder,Plus,Settings2,Tag,X} from 'lucide-react';
import {categoryParts,categoryPath,categoryTree,inCategory,type CategoryNode} from '@/lib/note-organization';
import type {NoteIndex} from '@/lib/notes';
export type CategoryOperation={kind:'create'|'move'|'tag';source:string;target:string;remove?:boolean};

function directCount(notes:NoteIndex[],path:string){
  return notes.filter(n=>!n.note?.trashedAt&&inCategory(n.note?.category||'',path)).length;
}

export function CategoryTree({paths,notes,selected,onSelect,onManage,disabled}:{paths:string[];notes:NoteIndex[];selected:string;onSelect:(path:string)=>void;onManage:()=>void;disabled:boolean}){
  const tree=useMemo(()=>categoryTree(paths),[paths]);
  const parts=categoryParts(selected);
  const selectedRoot=parts[0]||'';
  const root=tree.find(node=>node.label===selectedRoot)||null;
  const [openRoot,setOpenRoot]=useState<string>(selectedRoot);
  const [peekRoot,setPeekRoot]=useState(false);

  useEffect(()=>{if(selectedRoot)setOpenRoot(selectedRoot);},[selectedRoot]);
  const activeRoot=tree.find(node=>node.label===openRoot)||root;
  const children=activeRoot?.children||[];
  const hasCascade=!!activeRoot&&children.length>0;

  function chooseRoot(node:CategoryNode){
    setOpenRoot(node.label);setPeekRoot(false);onSelect(node.path);
  }
  function chooseChild(node:CategoryNode){
    setPeekRoot(false);onSelect(node.path);
    if(node.children.length)setOpenRoot(node.label);
  }

  return <div className={'notes-category-tree notes-category-cascade '+(hasCascade?'has-child ':'')+(peekRoot?'peek-root':'')}>
    <div className="notes-category-heading"><strong>カテゴリ</strong><button disabled={disabled} onClick={onManage} aria-label="カテゴリを管理"><Settings2 size={15}/></button></div>
    {!paths.length&&<button disabled={disabled} onClick={onManage}><Plus size={14}/>カテゴリを作成</button>}
    {!!paths.length&&<div className="notes-category-cascade-stage">
      <section className="notes-category-pane notes-category-root-pane" aria-label="大カテゴリ"
        onMouseEnter={()=>hasCascade&&setPeekRoot(true)} onMouseLeave={()=>setPeekRoot(false)}>
        {tree.map(node=><button key={node.path} disabled={disabled} className={selectedRoot===node.label?'active':''}
          title={node.path} onClick={()=>chooseRoot(node)}>
          <Folder size={14}/><span>{node.label}</span><small>{directCount(notes,node.path)}</small>{node.children.length>0&&<ChevronRight size={14}/>}
        </button>)}
      </section>
      {hasCascade&&<section className="notes-category-pane notes-category-child-pane" aria-label={activeRoot!.label+' の小カテゴリ'}>
        <button className="notes-category-parent-peek" onMouseEnter={()=>setPeekRoot(true)} onFocus={()=>setPeekRoot(true)}
          onClick={()=>setPeekRoot(value=>!value)} aria-label="大カテゴリを表示"><ChevronLeft size={14}/><span>{activeRoot!.label}</span></button>
        <button className={selected===activeRoot!.path?'active':''} disabled={disabled} onClick={()=>{setPeekRoot(false);onSelect(activeRoot!.path);}}>
          <Folder size={14}/><span>このカテゴリすべて</span><small>{directCount(notes,activeRoot!.path)}</small>
        </button>
        {children.map(node=><button key={node.path} disabled={disabled} className={selected===node.path?'active':''} title={node.path}
          onClick={()=>chooseChild(node)}><Folder size={14}/><span>{node.label}</span><small>{directCount(notes,node.path)}</small>{node.children.length>0&&<ChevronRight size={14}/>}</button>)}
      </section>}
    </div>}
  </div>;
}

export function CategoryManager({paths,initial,busy,onClose,onApply}:{paths:string[];initial:string;busy:boolean;onClose:()=>void;onApply:(op:CategoryOperation)=>Promise<void>}){
  const [kind,setKind]=useState<CategoryOperation['kind']>('create');const [source,setSource]=useState(initial||paths[0]||'');
  const [name,setName]=useState('');const [parent,setParent]=useState(initial);const [tag,setTag]=useState('');const [remove,setRemove]=useState(true);const [error,setError]=useState('');
  async function submit(e:React.FormEvent){e.preventDefault();setError('');try{
    if(kind!=='create'&&!source)throw new Error('対象カテゴリを選んでください');
    let target=tag.trim();if(kind==='tag'){if(!target||target.length>80)throw new Error('タグ名は1〜80文字です');}
    else {if(!name.trim()||name.includes('/'))throw new Error('カテゴリ名を入力してください（ / は区切りに使用します）');target=categoryPath(parent+'/'+name);if(target.length>200)throw new Error('カテゴリの階層全体を200文字以内にしてください');if(paths.includes(target))throw new Error('同じカテゴリが存在します');if(kind==='move'&&inCategory(parent,source))throw new Error('自分自身や子カテゴリの下へは移動できません');}
    await onApply({kind,source,target,remove});onClose();
  }catch(err){setError(err instanceof Error?err.message:String(err));}}
  return <div className="notes-modal"><section role="dialog" aria-modal="true" aria-labelledby="category-title"><div className="notes-settings-title"><h2 id="category-title">カテゴリの管理</h2><button disabled={busy} onClick={onClose} aria-label="カテゴリ管理を閉じる"><X size={20}/></button></div>
    <form className="notes-category-form" onSubmit={e=>void submit(e)}><fieldset disabled={busy}>
      <label>操作<select aria-label="カテゴリの操作" value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setError('');setName(categoryParts(source).at(-1)||'');setParent('');setTag(categoryParts(source).at(-1)||'');}}><option value="create">カテゴリ・子カテゴリを追加</option><option value="move">カテゴリの移動・名前変更</option><option value="tag">カテゴリをタグに変換</option></select></label>
      {kind!=='create'&&<label>対象カテゴリ<select aria-label="対象カテゴリ" value={source} onChange={e=>{setSource(e.target.value);setName(categoryParts(e.target.value).at(-1)||'');setTag(categoryParts(e.target.value).at(-1)||'');}}><option value="">選択してください</option>{paths.map(p=><option key={p}>{p}</option>)}</select></label>}
      {kind==='tag'?<><label>付けるタグ<input aria-label="変換先のタグ" value={tag} maxLength={80} onChange={e=>setTag(e.target.value)}/></label><label className="notes-check"><input type="checkbox" checked={remove} onChange={e=>setRemove(e.target.checked)}/>変換後に対象カテゴリを外す</label><p>子カテゴリ・ゴミ箱も含むメモにタグを付けます。既存のタグ・本文・添付・元のノートブック情報は保持します。</p></>:<><label>親カテゴリ<select aria-label="親カテゴリ" value={parent} onChange={e=>setParent(e.target.value)}><option value="">最上位</option>{paths.filter(p=>kind!=='move'||!inCategory(p,source)).map(p=><option key={p}>{p}</option>)}</select></label><label>カテゴリ名<input aria-label="新しいカテゴリ名" value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label>{kind==='move'&&<p>子カテゴリと所属メモをまとめて移動します。</p>}</>}
      {error&&<p role="alert">{error}</p>}<button className="notes-primary" type="submit">{busy?'保存中…':kind==='tag'?<><Tag size={16}/>タグへ変換</>:'カテゴリを保存'}</button>
    </fieldset></form>
  </section></div>;
}
