import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Folder,Plus,Settings2,Tag,X} from 'lucide-react';
import {categoryParts,categoryPath,categoryTree,inCategory,type CategoryNode} from '@/lib/note-organization';
import type {NoteIndex} from '@/lib/notes';
export type CategoryOperation={kind:'create'|'move'|'tag';source:string;target:string;remove?:boolean};

function directCount(notes:NoteIndex[],path:string){
  return notes.filter(n=>!n.note?.trashedAt&&inCategory(n.note?.category||'',path)).length;
}

export function CategoryTree({paths,notes,selected,onSelect,onManage,disabled}:{paths:string[];notes:NoteIndex[];selected:string;onSelect:(path:string)=>void;onManage:()=>void;disabled:boolean}){
  const tree=useMemo(()=>categoryTree(paths),[paths]);
  const nodesByPath=useMemo(()=>{
    const nodes=new Map<string,CategoryNode>();
    const visit=(entries:CategoryNode[])=>{for(const n of entries){nodes.set(n.path,n);visit(n.children);}};
    visit(tree);
    return nodes;
  },[tree]);

  // Each expanded parent gets its own overlay pane; leaf nodes retain their parent pane.
  const [openedPath,setOpenedPath]=useState('');
  const [peekDepth,setPeekDepth]=useState<number|null>(null);
  const panelRefs=useRef<Record<string,HTMLElement|null>>({});

  useEffect(()=>{
    if(!selected){setOpenedPath('');setPeekDepth(null);return;}
    const parts=categoryParts(selected);
    const target=nodesByPath.get(selected)?.children.length
      ? selected : parts.slice(0,-1).join(' / ');
    setOpenedPath(target);
    setPeekDepth(null);
  },[selected,nodesByPath]);

  const panes=useMemo(()=>{
    const result:{parent:string;title:string;nodes:CategoryNode[]}[]=[{parent:'',title:'大カテゴリ',nodes:tree}];
    let current=tree;
    for(const part of categoryParts(openedPath)){
      const node=current.find(item=>item.label===part);
      if(!node||!node.children.length)break;
      result.push({parent:node.path,title:node.label+' の小カテゴリ',nodes:node.children});
      current=node.children;
    }
    return result;
  },[openedPath,tree]);

  // At most three side-by-side panes remain visible; the full ancestry is always
  // accessible from the breadcrumb row, even for four or more nesting levels.
  const visible=panes.slice(-3),visibleOffset=panes.length-visible.length;
  const trail=categoryParts(selected||openedPath).map((_,index,all)=>all.slice(0,index+1).join(' / '));

  useEffect(()=>{
    const raf=requestAnimationFrame(()=>{
      for(const [parent,element] of Object.entries(panelRefs.current)){
        if(!element)continue;
        const active=Array.from(element.querySelectorAll<HTMLElement>('[data-category-path]'))
          .find(button=>button.dataset.categoryPath===selected);
        if(active){
          const top=active.offsetTop,lower=element.scrollTop,upper=lower+element.clientHeight;
          if(top<lower+8)element.scrollTop=Math.max(0,top-8);
          else if(top+active.offsetHeight>upper-8)element.scrollTop=top+active.offsetHeight-element.clientHeight+8;
        }
      }
    });
    return()=>cancelAnimationFrame(raf);
  },[selected,openedPath,paths]);

  function choose(node:CategoryNode){
    setPeekDepth(null);
    setOpenedPath(node.children.length?node.path:categoryParts(node.path).slice(0,-1).join(' / '));
    onSelect(node.path);
  }
  function reveal(path:string){
    const node=nodesByPath.get(path);
    setPeekDepth(null);
    setOpenedPath(node?.children.length?path:categoryParts(path).slice(0,-1).join(' / '));
    onSelect(path);
  }

  return <div className="notes-category-tree notes-category-cascade is-multilevel">
    <div className="notes-category-heading">
      <strong>カテゴリ</strong>
      <button disabled={disabled} onClick={onManage} aria-label="カテゴリを管理"><Settings2 size={15}/></button>
    </div>
    {!paths.length&&<button disabled={disabled} onClick={onManage}><Plus size={14}/>カテゴリを作成</button>}
    {!!paths.length&&<>
      <nav className="notes-category-breadcrumb" aria-label="カテゴリの階層">
        <button className={!selected?'active':''} onClick={()=>{setPeekDepth(null);setOpenedPath('');onSelect('');}} disabled={disabled} title="最上位のカテゴリを表示">全体</button>
        {trail.map((path,index)=><button key={path} disabled={disabled} title={path} className={selected===path?'active':''}
          onClick={()=>reveal(path)}><ChevronRight size={12}/><span>{categoryParts(path).at(-1)}</span></button>)}
      </nav>
      <div className={'notes-category-cascade-stage multilevel '+(peekDepth!==null?'parent-peek':'')} role="group" aria-label="カテゴリの選択"
        onMouseLeave={()=>setPeekDepth(null)}>
        {visible.map((pane,i)=>{
          const depth=i+visibleOffset,isLast=i===visible.length-1;
          const left=i===0?0:visible.length===2?20: i===1?12:24;
          const isPeeking=peekDepth!==null&&i>peekDepth;
          const zIndex=peekDepth===null?10+i: i===peekDepth?30:i>peekDepth?20+i:10+i;
          const isFocused=peekDepth===null?isLast:peekDepth===i;
          return <section key={pane.parent||'root'} className={'notes-category-pane notes-category-multi-pane '+(isFocused?'is-focused ':'')+(isPeeking?'is-muted':'')}
            aria-label={pane.title} aria-hidden={isPeeking}
            style={{left:left+'%',width:(100-left)+'%',zIndex,transform:isPeeking?'translateX(70%)':'translateX(0)',opacity:isPeeking?.55:1}}
            onMouseEnter={()=>setPeekDepth(isLast?null:i)}>
            {pane.parent&&<button type="button" className="notes-category-level-label" disabled={disabled}
              title={pane.parent} onClick={()=>reveal(pane.parent)}>
              <ChevronLeft size={14}/><span>{categoryParts(pane.parent).at(-1)}</span><small>このカテゴリ</small>
            </button>}
            <div className="notes-category-scroll" ref={el=>{panelRefs.current[pane.parent||'root']=el;}}>
              {pane.nodes.map(node=><button key={node.path} type="button" disabled={disabled} data-category-path={node.path}
                className={'notes-category-choice '+(selected===node.path?'active ':'')+(inCategory(selected,node.path)&&selected!==node.path?'ancestor':'')}
                title={node.path} aria-current={selected===node.path?'true':undefined}
                onClick={()=>choose(node)}>
                <Folder size={15}/><span>{node.label}</span><small>{directCount(notes,node.path)}</small>
                {node.children.length>0&&<ChevronRight size={15}/>}
              </button>)}
              {!pane.nodes.length&&<p className="notes-category-empty">子カテゴリはありません</p>}
            </div>
          </section>;
        })}
      </div>
      <p className="notes-category-help">左側の階層にマウスを乗せる／タップすると前面に表示します。子カテゴリは右側に重なります。</p>
    </>}
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
