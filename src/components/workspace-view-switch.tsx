export type WorkspaceView='memo'|'drawing'|'focus';
export default function WorkspaceViewSwitch({value,onChange}:{value:WorkspaceView;onChange:(value:WorkspaceView)=>void}){
  return <div className="notes-mode-switch" role="group" aria-label="作業モード">
    {([['memo','メモ帳'],['drawing','お絵かき'],['focus','完全作業領域']] as const).map(([mode,label])=><button key={mode} type="button" aria-pressed={value===mode} className={value===mode?'active':''} onClick={()=>onChange(mode)}>{label}</button>)}
  </div>;
}
