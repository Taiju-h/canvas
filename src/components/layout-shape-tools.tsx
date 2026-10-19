import {useState} from 'react';
import {ArrowRight,Circle,Square,Triangle,Plus} from 'lucide-react';
import type {ShapePreset} from '@/lib/shape-presets';

export default function LayoutShapeTools({tool,preset,presets,onTool,onPreset,onSave,canSave}:{tool:string;preset:string;presets:ShapePreset[];onTool:(tool:'rect'|'ellipse')=>void;onPreset:(id:string)=>void;onSave:(name:string)=>void;canSave:boolean}){
  const [saving,setSaving]=useState(false),[name,setName]=useState('');
  return <div className="notes-layout-shapes" role="group" aria-label="枠と図形">
    <button aria-label="丸（楕円）" aria-pressed={tool==='ellipse'} className={tool==='ellipse'?'active':''} onClick={()=>onTool('ellipse')}><Circle size={17}/>丸</button>
    <button aria-label="三角形" aria-pressed={tool==='preset'&&preset==='triangle'} className={tool==='preset'&&preset==='triangle'?'active':''} onClick={()=>onPreset('triangle')}><Triangle size={17}/>三角</button>
    <button aria-label="枠（四角形）" aria-pressed={tool==='rect'} className={tool==='rect'?'active':''} onClick={()=>onTool('rect')}><Square size={17}/>四角</button>
    <button aria-label="矢印" aria-pressed={tool==='preset'&&preset==='arrow'} className={tool==='preset'&&preset==='arrow'?'active':''} onClick={()=>onPreset('arrow')}><ArrowRight size={17}/>矢印</button>
    <select aria-label="図形プリセット" value={tool==='preset'?preset:''} onChange={e=>{if(e.target.value)onPreset(e.target.value);}}>
      <option value="">図形プリセット…</option><optgroup label="基本図形">{presets.filter(p=>!p.custom).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
      {!!presets.some(p=>p.custom)&&<optgroup label="登録した図形（この端末）">{presets.filter(p=>p.custom).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
    </select>
    <button aria-label="選択図形をプリセットに追加" disabled={!canSave} onClick={()=>{setSaving(true);setName('');}}><Plus size={16}/>プリセットに追加</button>
    {saving&&<div className="notes-modal"><form className="notes-preset-dialog" role="dialog" aria-modal="true" aria-label="図形プリセットを登録" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setSaving(false);}}} onSubmit={e=>{e.preventDefault();if(name.trim()){onSave(name);setSaving(false);}}}>
      <h2>選択した図形を登録</h2><label>プリセット名<input aria-label="プリセット名" value={name} onChange={e=>setName(e.target.value)} maxLength={60} autoFocus required/></label><p>この端末の図形プリセットに保存します。</p><div className="notes-dialog-actions"><button type="button" onClick={()=>setSaving(false)}>キャンセル</button><button className="notes-primary" type="submit" disabled={!name.trim()}>登録</button></div>
    </form></div>}
  </div>;
}
