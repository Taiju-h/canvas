import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import {workspaceShortcutRows} from '@/lib/workspace-shortcuts';
export default function WorkspaceShortcutHelp({onClose}:{onClose:()=>void}){
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement;close.current?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
  return <div className="notes-modal" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="notes-shortcut-help" role="dialog" aria-modal="true" aria-label="キーボードショートカット" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}if(e.key==='Tab'){e.preventDefault();close.current?.focus();}}}>
    <div className="notes-settings-title"><h2>キーボードショートカット</h2><button ref={close} aria-label="ショートカット一覧を閉じる" onClick={onClose}><X size={20}/></button></div>
    <p>Canvas・レイアウトで使えます。文字入力中は本文や入力欄の通常操作になります。</p>
    <table><tbody>{workspaceShortcutRows.map(([key,label])=><tr key={key}><th scope="row">{key}</th><td>{label}</td></tr>)}</tbody></table>
  </section></div>;
}
