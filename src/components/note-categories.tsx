import {useState} from 'react';
import {ChevronDown,ChevronRight,Folder,Plus,Settings2,Tag,X} from 'lucide-react';
import {categoryParts,categoryPath,categoryTree,inCategory,type CategoryNode} from '@/lib/note-organization';
import type {NoteIndex} from '@/lib/notes';
export type CategoryOperation={kind:'create'|'move'|'tag';source:string;target:string;remove?:boolean};
export function CategoryTree({paths,notes,selected,onSelect,onManage,disabled}:{paths:string[];notes:NoteIndex[];selected:string;onSelect:(path:string)=>void;onManage:()=>void;disabled:boolean}){
  const [collapsed,setCollapsed]=useState(new Set<string>());
  function render(nodes:CategoryNode[],depth=0):React.ReactNode{return nodes.map(node=><div key={node.path}>
    <div className={`notes-category-row ${selected===node.path?'active':''}`} style={{paddingLeft:depth*14}}>
      <button aria-label={`${node.path}を${collapsed.has(node.path)?'展開':'折りたたむ'}`} aria-expanded={!collapsed.has(node.path)} disabled={!node.children.length} onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(node.path))next.delete(node.path);else next.add(node.path);return next;})}>{node.children.length?(collapsed.has(node.path)?<ChevronRight size={14}/>:<ChevronDown size={14}/>):<span/>}</button>
      <button disabled={disabled} aria-label={`カテゴリ ${node.path}`} title={node.path} onClick={()=>onSelect(node.path)}><Folder size={14}/><span>{node.label}</span><small>{notes.filter(n=>!n.note?.trashedAt&&inCategory(n.note?.category||'',node.path)).length}</small></button>
    </div>{!collapsed.has(node.path)&&render(node.children,depth+1)}
  </div>);}
  return <div className="notes-category-tree"><div className="notes-category-heading"><strong>カテゴリ</strong><button disabled={disabled} onClick={onManage} aria-label="カテゴリを管理"><Settings2 size={15}/></button></div>{render(categoryTree(paths))}{!paths.length&&<button disabled={disabled} onClick={onManage}><Plus size={14}/>カテゴリを作成</button>}</div>;
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
