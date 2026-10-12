import type * as React from 'react';
/** Shared contenteditable behaviour used by both fixed notes and layout text boxes. */
export function noteEditorKeyDown(event:React.KeyboardEvent<HTMLElement>,emit:()=>void){
  if(event.key!=='Tab')return;
  event.preventDefault();
  const element=event.target as HTMLElement;
  const withinList=!!element.closest('li');
  if(withinList){
    document.execCommand(event.shiftKey?'outdent':'indent',false);
  }else if(!event.shiftKey){
    document.execCommand('insertHTML',false,'&nbsp;&nbsp;&nbsp;&nbsp;');
  }else{
    document.execCommand('outdent',false);
  }
  emit();
}
export function noteCheckboxClick(event:React.MouseEvent<HTMLElement>,emit:()=>void){
  const input=(event.target as Element).closest('input[type="checkbox"]') as HTMLInputElement|null;
  if(!input)return;
  // Browser checkbox state toggles independently of HTML serialization.
  if(input.checked)input.setAttribute('checked','checked');
  else input.removeAttribute('checked');
  emit();
}
