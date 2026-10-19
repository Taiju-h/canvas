import {useRef} from 'react';
import {Brush,Eraser,Lasso,PenTool,Pencil,SprayCan,X} from 'lucide-react';
import type {InkBrush} from '@/lib/ink-brushes';
import type {EraserMode} from '@/lib/canvas-ink';

const brushes=[['pencil','鉛筆',Pencil],['gpen','Gペン',PenTool],['brush','筆',Brush],['airbrush','エアブラシ',SprayCan],['marker','マーカー',Pencil]] as const;
export function CanvasBrushes({brush,active,onSelect,vertical=false}:{brush:InkBrush;active:boolean;onSelect:(brush:InkBrush)=>void;vertical?:boolean}){
  return <div className={'notes-canvas-brushes'+(vertical?' is-vertical':'')} role="group" aria-label="Canvasブラシ">{brushes.map(([value,label,Icon])=><button key={value} aria-pressed={active&&brush===value} className={active&&brush===value?'active':''} onClick={()=>onSelect(value)} title={label}><Icon size={18}/>{vertical?<small>{label}</small>:label}</button>)}</div>;
}
export function CanvasEraser({active,mode,size,onChoose,onMode,onSize,compact=false}:{active:boolean;mode:EraserMode;size:number;onChoose:(alternate:boolean)=>void;onMode:(mode:EraserMode)=>void;onSize:(size:number)=>void;compact?:boolean}){
  const shifted=useRef(false);
  return <div className={'notes-eraser-controls'+(compact?' is-compact':'')}>
    <div className="notes-eraser-split"><button className={active?'active':''} aria-label={compact?"Canvasの消しゴム":"消しゴム"} aria-pressed={active} title={(mode==='circle'?'円形：触れた部分だけ消す':'線消し：触れた線全体を消す')+'（Shift＋クリックで切替）'} onPointerDown={e=>{shifted.current=e.shiftKey;}} onPointerCancel={()=>{shifted.current=false;}} onClick={e=>{onChoose(e.shiftKey||shifted.current);shifted.current=false;}}><span className="notes-eraser-icon"><Eraser size={19}/>{mode==='stroke'&&<X size={10}/>}</span>{!compact&&'消しゴム'}</button>
      <select aria-label="消しゴムの種類" title="消しゴムの種類" value={mode} onChange={e=>onMode(e.target.value as EraserMode)}><option value="circle">○ 円形消しゴム</option><option value="stroke">× 線全体を消す</option></select>
    </div>
    {active&&!compact&&<label className="notes-eraser-size">直径<input aria-label="消しゴムの大きさ" type="range" min="2" max="240" value={size} onChange={e=>onSize(Number(e.target.value))}/><b>{size}px</b></label>}
  </div>;
}
export function CanvasLasso({active,onChoose}:{active:boolean;onChoose:()=>void}){return <button className={active?'active':''} aria-label="投げ縄選択" aria-pressed={active} title="自由に囲んだ範囲を選択・移動" onClick={onChoose}><Lasso size={18}/>投げ縄</button>;}
