type ScreenBridge={isFullscreen?:()=>boolean;setFullscreen?:(enabled:boolean)=>void};
const bridge=()=> (window as Window&{CanvasApp?:ScreenBridge}).CanvasApp;
export function isScreenFullscreen(){return bridge()?.isFullscreen?.()??!!document.fullscreenElement;}
export async function setScreenFullscreen(enabled:boolean){
  const native=bridge();
  if(native?.setFullscreen){native.setFullscreen(enabled);return;}
  if(enabled){
    if(!document.documentElement.requestFullscreen)throw new Error('このブラウザでは全画面表示に対応していません');
    await document.documentElement.requestFullscreen();
  }else if(document.fullscreenElement)await document.exitFullscreen();
}
