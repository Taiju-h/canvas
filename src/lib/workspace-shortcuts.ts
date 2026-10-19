export type WorkspaceCommand='undo'|'redo'|'save'|'all'|'deselect'|'delete'|'duplicate'|'copy'|'cut'|'paste'|'left'|'right'|'up'|'down'|'brush'|'eraser'|'lasso'|'move'|'hand'|'pan'|'smaller'|'larger'|'zoomIn'|'zoomOut'|'fit'|'actual'|'help';
type Key={key:string;code?:string;ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;shiftKey?:boolean;isComposing?:boolean;keyCode?:number};
/** Keep document commands out of native text editing and Japanese IME composition. */
export function workspaceCommand(event:Key,context:{editable:boolean;mode:string}):WorkspaceCommand|null{
  if(event.isComposing||event.keyCode===229||event.altKey)return null;
  const key=event.key.toLowerCase(),command=event.ctrlKey||event.metaKey,drawing=context.mode==='canvas'||context.mode==='layout';
  if(command&&key==='s')return 'save';
  if(context.editable)return null;
  if(command){
    if(key==='z')return event.shiftKey?'redo':'undo';
    if(key==='y')return 'redo';
    if(!drawing)return null;
    return ({a:'all',d:'deselect',j:'duplicate',c:'copy',x:'cut',v:'paste','+':'zoomIn','=':'zoomIn','-':'zoomOut','0':'fit','1':'actual'} as Record<string,WorkspaceCommand>)[key]||null;
  }
  if(key==='?')return 'help';
  if(!drawing)return null;
  return ({escape:'deselect',delete:'delete',backspace:'delete',arrowleft:'left',arrowright:'right',arrowup:'up',arrowdown:'down',b:'brush',e:'eraser',l:'lasso',v:'move',h:'hand',' ':'pan','[':'smaller',']':'larger'} as Record<string,WorkspaceCommand>)[key]||null;
}
export const workspaceShortcutRows=[
  ['Ctrl / ⌘ + Z','元に戻す'],['Ctrl / ⌘ + Shift + Z、Ctrl + Y','やり直す'],['Ctrl / ⌘ + S','保存'],
  ['Ctrl / ⌘ + A','全選択（Canvasは編集中のレイヤー、レイアウトは表示・編集できる図形）'],['Ctrl / ⌘ + D、Esc','選択解除'],['Delete、Backspace','選択した部分・図形を削除'],
  ['Ctrl / ⌘ + C / X / V','選択した部分・図形をコピー／切り取り／貼り付け'],['Ctrl / ⌘ + Shift + V','同じ位置に貼り付け'],['Ctrl / ⌘ + J','選択を複製'],
  ['Shift + クリック','レイアウトの複数選択に追加・解除'],['矢印キー、Shift + 矢印キー','選択を1px、10px移動'],['Shift + ドラッグ','選択の移動を縦または横に制限'],
  ['B、E、L、V、H','ブラシ／消しゴム／投げ縄／移動・選択／手のひら'],['Space（押している間）','一時的に手のひらで画面移動'],['[、]','ペン・消しゴム・線の大きさを変更'],
  ['Ctrl / ⌘ + ＋ / −、0、1','拡大・縮小／画面に合わせる／100%'],['?','ショートカット一覧'],
];
