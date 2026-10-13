import {flowNoteColumns} from '@/lib/rich-note-commands';
import {noteEditorKeyDown,noteCheckboxClick} from '@/lib/rich-editor-dom';
import {getLocalImage} from '@/lib/local-docs';
import {fileURL} from '@/lib/notes';
import { useEffect, useRef, useState } from 'react';
import { cleanHTML, type NoteDoc } from '@/lib/notes';

export type SheetData={visible:boolean;locked:boolean;rows:number;cols:number;cells:Record<string,string>};
export type ChartItem={id:string;layerId:string;x:number;y:number;w:number;h:number;type:'bar'|'line'|'pie';range:string;title?:string;visible?:boolean;locked?:boolean;name?:string};
export type StudioLayer=NoteDoc['layers'][number] & {studioKind?:'canvas'|'layout'};
export type StudioNoteDoc=Omit<NoteDoc,'layers'> & {layers:StudioLayer[];fixedNote?:{html:string;visible:boolean;locked:boolean;opacity?:number};sheet?:SheetData;charts?:ChartItem[];studioOrder?:('note'|'canvas'|'layout'|'graph')[];studioNames?:{note?:string;canvas?:string;layout?:string;excel?:string}};

export type CellRange={start:string;end:string};

function colName(index:number){let n=index+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
function cellKey(row:number,col:number){return colName(col)+(row+1);}
function cellCoords(key:string){const match=/^([A-Z]+)(\d+)$/.exec(key.toUpperCase());if(!match)return null;let col=0;for(const c of match[1])col=col*26+c.charCodeAt(0)-64;return{row:Number(match[2])-1,col:col-1};}
export function rangeKeys(range:string){const [a,b=a]=range.split(':');const aa=cellCoords(a),bb=cellCoords(b);if(!aa||!bb)return[];const out:string[]=[];for(let r=Math.min(aa.row,bb.row);r<=Math.max(aa.row,bb.row);r++)for(let c=Math.min(aa.col,bb.col);c<=Math.max(aa.col,bb.col);c++)out.push(cellKey(r,c));return out;}
export function displayCell(sheet:SheetData,key:string,seen=new Set<string>()):string{
  const raw=sheet.cells[key]||'';if(!raw.startsWith('='))return raw;if(seen.has(key))return '#REF!';seen.add(key);
  const number=(k:string)=>{const value=displayCell(sheet,k,new Set(seen));const n=Number(value.replace(/,/g,''));return Number.isFinite(n)?n:0;};
  let expr=raw.slice(1).toUpperCase().replace(/(SUM|AVERAGE)\(([A-Z]+\d+):([A-Z]+\d+)\)/g,(_all,fn,a,b)=>{
    const nums=rangeKeys(a+':'+b).map(number);const total=nums.reduce((x,y)=>x+y,0);return String(fn==='AVERAGE'?(nums.length?total/nums.length:0):total);
  });
  expr=expr.replace(/[A-Z]+\d+/g,k=>String(number(k)));
  if(!/^[0-9+\-*/().\s]+$/.test(expr))return '#ERR!';
  try{const value=Function('"use strict";return ('+expr+')')();return Number.isFinite(value)?String(Math.round(value*1e8)/1e8):'#ERR!';}catch{return '#ERR!';}
}

export function FixedNoteLayer({docId,html,visible,locked,active,onChange,onPaste,onDownloadFile,opacity=1,width,viewportHeight,onHeight}:{docId:string;html:string;visible:boolean;locked:boolean;active:boolean;onPaste:(files:File[])=>void;onChange:(html:string)=>void;onDownloadFile:(id:string,name:string)=>void;opacity?:number;width?:number;viewportHeight?:number;onHeight?:(height:number)=>void}){
  const ref=useRef<HTMLDivElement>(null);const composing=useRef(false);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    const safe=cleanHTML(html);
    if(!composing.current&&cleanHTML(el.innerHTML)!==safe)el.innerHTML=safe;
  },[html,visible,docId]);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    let live=true;const urls:string[]=[];
    const hydrate=async()=>{
      for(const image of Array.from(el.querySelectorAll<HTMLImageElement>('img[data-kn-local-image]'))){
        const imageId=image.dataset.knLocalImage||'';if(!imageId)continue;
        const blob=await getLocalImage(imageId).catch(()=>undefined);
        if(!live)return;
        if(blob){const url=URL.createObjectURL(blob);urls.push(url);image.src=url;}
        else if(docId&&!docId.startsWith('local-'))image.src=fileURL(docId,imageId);
      }
    };
    void hydrate();
    return()=>{live=false;urls.forEach(URL.revokeObjectURL);};
  },[html,docId,visible]);
  useEffect(()=>{const el=ref.current;if(!el||!onHeight)return;const measure=()=>onHeight(el.scrollHeight);const observer=new ResizeObserver(measure);observer.observe(el);measure();return()=>observer.disconnect();},[docId,visible,onHeight]);
  if(!visible)return null;
  const emit=()=>{if(locked)return;const el=ref.current;if(el){flowNoteColumns(el);onChange(cleanHTML(el.innerHTML));}};
  return <div className={'notes-fixed-layer '+(active?'active':'')+(locked?' locked':'')} aria-label="固定ノートレイヤー" style={{opacity,width}}>
    <div ref={ref} className="notes-fixed-editor" style={{minHeight:viewportHeight||400}} role="textbox" aria-label="固定ノート本文" aria-multiline="true" contentEditable={active&&!locked} suppressContentEditableWarning spellCheck
      onPaste={e=>{e.preventDefault();if(e.clipboardData.files.length){onPaste(Array.from(e.clipboardData.files));return;}
        const html=e.clipboardData.getData('text/html');document.execCommand(html?'insertHTML':'insertText',false,html?cleanHTML(html):e.clipboardData.getData('text/plain'));emit();}}
      data-placeholder="ここに本文を入力します。文字サイズはズームから独立し、上下スクロールはCanvasと連動します。"
      onInput={()=>{if(!composing.current)emit();}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;emit();}} onKeyDown={e=>noteEditorKeyDown(e,emit)} onClick={e=>{
        noteCheckboxClick(e,emit);
        const link=(e.target as Element).closest<HTMLAnchorElement>('a[data-kn-local-file]');
        const fileId=link?.dataset.knLocalFile;
        if(!link||!fileId)return;
        e.preventDefault();
        onDownloadFile(fileId,link.textContent||'attachment');
      }} onBlur={emit}/>
  </div>;
}

export function SpreadsheetLayer({sheet,active,selection,onChange,onSelect,onInteract}:{sheet:SheetData;active:boolean;selection?:CellRange;onChange:(next:SheetData)=>void;onSelect:(range:CellRange)=>void;onInteract?:()=>void}){
  const [anchor,setAnchor]=useState('');
  if(!sheet.visible)return null;
  const selected=new Set(selection?rangeKeys(selection.start+':'+selection.end):[]);
  return <div className={'notes-sheet-layer '+(active?'active':'')+(sheet.locked?' locked':'')} style={{width:62+sheet.cols*112,height:34+sheet.rows*32}} onPointerDown={onInteract} onKeyDown={onInteract} onFocusCapture={onInteract}>
    <div className="sheet-corner">fx</div>{Array.from({length:sheet.cols},(_,c)=><div key={'h'+c} className="sheet-col" style={{left:62+c*112}}>{colName(c)}</div>)}
    {Array.from({length:sheet.rows},(_,r)=><div key={'r'+r} className="sheet-row" style={{top:34+r*32}}>{r+1}</div>)}
    {Array.from({length:sheet.rows},(_,r)=>Array.from({length:sheet.cols},(_,c)=>{const key=cellKey(r,c);const raw=sheet.cells[key]||'';return <input key={key} data-cell={key} className={selected.has(key)?'selected':''}
      style={{left:62+c*112,top:34+r*32}} value={raw} readOnly={!active||sheet.locked} title={raw.startsWith('=')?'計算結果: '+displayCell(sheet,key):key}
      onPointerDown={e=>e.stopPropagation()} onFocus={()=>{if(!anchor)setAnchor(key);onSelect({start:key,end:key});}}
      onClick={e=>{const start=e.shiftKey&&anchor?anchor:key;if(!e.shiftKey)setAnchor(key);onSelect({start,end:key});}}
      onChange={e=>onChange({...sheet,cells:{...sheet.cells,[key]:e.target.value}})} />;}))}
  </div>;
}

function chartSeries(sheet:SheetData,range:string){
  const keys=rangeKeys(range), coords=keys.map(k=>({key:k,...cellCoords(k)!}));if(!coords.length)return{labels:[] as string[],values:[] as number[]};
  const minRow=Math.min(...coords.map(x=>x.row)),maxRow=Math.max(...coords.map(x=>x.row)),minCol=Math.min(...coords.map(x=>x.col)),maxCol=Math.max(...coords.map(x=>x.col));
  const labels:string[]=[],values:number[]=[];
  for(let r=minRow;r<=maxRow;r++){
    const label=displayCell(sheet,cellKey(r,minCol))||String(r+1);const valueKey=cellKey(r,Math.min(maxCol,minCol+1));const value=Number(displayCell(sheet,valueKey).replace(/,/g,''));
    if(Number.isFinite(value)){labels.push(label);values.push(value);}
  }
  if(!values.length)for(const item of coords){const value=Number(displayCell(sheet,item.key).replace(/,/g,''));if(Number.isFinite(value)){labels.push(item.key);values.push(value);}}
  return{labels,values};
}

export function ChartsLayer({sheet,charts,visibleLayers}:{sheet:SheetData;charts:ChartItem[];visibleLayers:Set<string>}){
  return <>{charts.filter(chart=>chart.visible!==false).map(chart=>{const data=chartSeries(sheet,chart.range),max=Math.max(1,...data.values.map(v=>Math.abs(v)));return <div key={chart.id} className={'notes-chart '+(chart.locked?'locked':'')} data-stroke={chart.id} style={{left:chart.x,top:chart.y,width:chart.w,height:chart.h}}>
    <strong>{chart.title||(chart.type==='bar'?'棒グラフ':chart.type==='line'?'折れ線グラフ':'円グラフ')}</strong>
    <svg viewBox="0 0 360 200" preserveAspectRatio="none">
      {chart.type==='bar'&&data.values.map((v,i)=>{const h=Math.abs(v)/max*145;return <g key={i}><rect x={28+i*(310/Math.max(1,data.values.length))} y={175-h} width={Math.max(8,250/Math.max(1,data.values.length))} height={h}/><text x={32+i*(310/Math.max(1,data.values.length))} y="194">{data.labels[i]?.slice(0,8)}</text></g>;})}
      {chart.type==='line'&&data.values.length>0&&<><polyline points={data.values.map((v,i)=>`${28+i*(310/Math.max(1,data.values.length-1))},${175-Math.abs(v)/max*145}`).join(' ')} fill="none"/>{data.values.map((v,i)=><circle key={i} cx={28+i*(310/Math.max(1,data.values.length-1))} cy={175-Math.abs(v)/max*145} r="4"/>)}</>}
      {chart.type==='pie'&&(()=>{const total=data.values.reduce((a,b)=>a+Math.abs(b),0)||1;let angle=-Math.PI/2;return data.values.map((v,i)=>{const next=angle+Math.abs(v)/total*Math.PI*2;const large=next-angle>Math.PI?1:0;const x1=180+70*Math.cos(angle),y1=105+70*Math.sin(angle),x2=180+70*Math.cos(next),y2=105+70*Math.sin(next);const d=`M180,105 L${x1},${y1} A70,70 0 ${large},1 ${x2},${y2} Z`;angle=next;return <path key={i} d={d} opacity={.35+(i%5)*.12}/>;});})()}
    </svg>
  </div>;})}</>;
}

export function LayerPanel({doc,activeLayer,onActive,onSelectObject,onChange,onNoteTool,onSheetTool,onProperties}:{doc:StudioNoteDoc;activeLayer:string;onActive:(id:string)=>void;onSelectObject:(id:string,kind:'text'|'chart')=>void;onChange:(next:StudioNoteDoc)=>void;onNoteTool:()=>void;onSheetTool:()=>void;onProperties?:(id:string)=>void}){
  const note=doc.fixedNote||{html:'',visible:true,locked:false};
  const sheet=doc.sheet||{visible:false,locked:false,rows:20,cols:10,cells:{}};
  const charts=doc.charts||[];
  const order:('note'|'canvas'|'layout'|'graph')[]=doc.studioOrder?.length?[...doc.studioOrder]:['note','canvas','layout','graph'];
  const canvasLayers=doc.layers.filter(l=>(l.studioKind||'canvas')==='canvas');
  const layoutLayers=doc.layers.filter(l=>l.studioKind==='layout');
  const displayName=(kind:'note'|'canvas'|'layout'|'excel',fallback:string)=>doc.studioNames?.[kind]||fallback;
  const renameGroup=(kind:'note'|'canvas'|'layout'|'excel',value:string)=>{
    onChange({...doc,studioNames:{...doc.studioNames,[kind]:value}});
  };
  const renameLayer=(id:string)=>{
    const layer=doc.layers.find(l=>l.id===id);if(!layer)return;
    const next=window.prompt('レイヤー名を変更',layer.name)?.trim();
    if(next&&next!==layer.name&&next.length<=60)patchLayer(id,{name:next});
  };
  const removeLayer=(id:string)=>{
    const layer=doc.layers.find(l=>l.id===id);if(!layer)return;
    const kind=(layer.studioKind||'canvas') as 'canvas'|'layout';
    const peers=doc.layers.filter(l=>l.id!==id&&(l.studioKind||'canvas')===kind);
    const destination=peers[0];
    const itemCount=(doc.blocks||[]).filter(i=>i.layerId===id).length+(doc.charts||[]).filter(i=>i.layerId===id).length+doc.items.filter(i=>i.layerId===id).length+(doc.paintStrokes||[]).filter(i=>i.layerId===id).length;
    const message=destination
      ?'「'+layer.name+'」を削除し、'+itemCount+'個の内容を「'+destination.name+'」へ移動しますか？'
      :'「'+layer.name+'」を削除し、'+itemCount+'個の内容を新しいレイヤーへ移動しますか？';
    if(!window.confirm(message))return;
    const replacement=destination||{id:crypto.randomUUID().replace(/-/g,''),name:kind==='layout'?'レイアウト 1':'キャンバス 1',studioKind:kind,visible:true,locked:false};
    onChange({...doc,layers:[...doc.layers.filter(l=>l.id!==id),...(destination?[]:[replacement])],
      blocks:doc.blocks?.map(i=>i.layerId===id?{...i,layerId:replacement.id}:i),
      items:doc.items.map(i=>i.layerId===id?{...i,layerId:replacement.id}:i),
      paintStrokes:doc.paintStrokes?.map(i=>i.layerId===id?{...i,layerId:replacement.id}:i),
      charts:doc.charts?.map(i=>i.layerId===id?{...i,layerId:replacement.id}:i)});
    if(activeLayer===id)onActive(replacement.id);
  };
  const namePicker=(kind:'note'|'canvas'|'layout'|'excel',options:string[])=><select
    className="notes-layer-group-name" value={displayName(kind,options[0])} aria-label="レイヤー種別の表示名"
    title="表示名を変更します。既存データの種類は変わりません"
    onClick={e=>e.stopPropagation()} onChange={e=>renameGroup(kind,e.target.value)}>
    {[...new Set([displayName(kind,options[0]),...options])].map(name=><option key={name} value={name}>{name}</option>)}
  </select>;

  const patchLayer=(id:string,patch:Record<string,unknown>)=>onChange({...doc,layers:doc.layers.map(l=>l.id===id?{...l,...patch}:l)});
  const patchChart=(id:string,patch:Partial<ChartItem>)=>onChange({...doc,charts:charts.map(c=>c.id===id?{...c,...patch}:c)});
  const moveChild=(id:string,dir:-1|1)=>{
    const kind=doc.layers.find(l=>l.id===id)?.studioKind||'canvas';
    const ids=doc.layers.filter(l=>(l.studioKind||'canvas')===kind).map(l=>l.id);
    const i=ids.indexOf(id),j=i+dir;if(i<0||j<0||j>=ids.length)return;
    const target=ids[j],a=doc.layers.findIndex(l=>l.id===id),b=doc.layers.findIndex(l=>l.id===target);
    const layers=[...doc.layers];[layers[a],layers[b]]=[layers[b],layers[a]];onChange({...doc,layers});
  };
  const moveGroup=(kind:'note'|'canvas'|'layout'|'graph',dir:-1|1)=>{
    const list=[...order],i=list.indexOf(kind),j=i+dir;if(i<0||j<0||j>=list.length)return;
    [list[i],list[j]]=[list[j],list[i]];onChange({...doc,studioOrder:list});
  };
  const addLayer=(kind:'canvas'|'layout')=>{
    const id=crypto.randomUUID(), count=doc.layers.filter(l=>(l.studioKind||'canvas')===kind).length+1;
    onChange({...doc,layers:[...doc.layers,{id,name:(kind==='canvas'?'キャンバス ':'レイアウト ')+count,visible:true,locked:false,studioKind:kind}]});onActive(id);
  };
  const groupButtons=(kind:'note'|'canvas'|'layout'|'graph')=><span className="notes-layer-order">
    <button title="この親レイヤーを上へ" disabled={order.indexOf(kind)===0} onClick={e=>{e.stopPropagation();moveGroup(kind,-1);}}>↑</button>
    <button title="この親レイヤーを下へ" disabled={order.indexOf(kind)===order.length-1} onClick={e=>{e.stopPropagation();moveGroup(kind,1);}}>↓</button>
  </span>;

  const renderGroup=(kind:'note'|'canvas'|'layout'|'graph')=>{
    if(kind==='note')return <div className="notes-layer-group" key="note">
      <div className="notes-layer-parent-label active-family" onClick={onNoteTool}><strong>▤</strong>{namePicker('note',['ノート','テキスト','ワード'])}<small>文字・文章</small>{groupButtons('note')}</div>
      <div className="notes-layer-children">
        <div className="notes-layer-child-row"><button className="notes-layer-child" onClick={onNoteTool}><span>{doc.studioNames?.note||'固定ノート'}</span><small>ワープロ</small></button><button onClick={()=>onChange({...doc,fixedNote:{...note,visible:!note.visible}})}>{note.visible?'◉':'○'}</button><button onClick={()=>onChange({...doc,fixedNote:{...note,locked:!note.locked}})}>{note.locked?'🔒':'🔓'}</button>{onProperties&&<button aria-label="ノートレイヤーのプロパティ" onClick={()=>onProperties('note')}>プロパティ</button>}</div>

      </div>
    </div>;

    if(kind==='canvas')return <div className="notes-layer-group" key="canvas">
      <div className="notes-layer-parent-label"><strong>✎ キャンバス</strong><small>手書き・ペン</small>{groupButtons('canvas')}<button className="notes-layer-add" title="キャンバスレイヤーを追加" onClick={()=>addLayer('canvas')}>＋</button></div>
      <div className="notes-layer-list">{canvasLayers.map(layer=><div key={layer.id} className={'notes-layer-row '+(activeLayer===layer.id?'active':'')} onClick={()=>onActive(layer.id)}>
        <button title="表示" onClick={e=>{e.stopPropagation();patchLayer(layer.id,{visible:!layer.visible});}}>{layer.visible?'◉':'○'}</button><button className="kn-layer-properties-link" aria-label={layer.name+'のプロパティ'} onClick={e=>{e.stopPropagation();onProperties?.(layer.id);}}>{layer.name}<small>{Math.round((layer.opacity??1)*100)}% · プロパティ</small></button>
        <button onClick={e=>{e.stopPropagation();moveChild(layer.id,-1);}}>↑</button><button onClick={e=>{e.stopPropagation();moveChild(layer.id,1);}}>↓</button><button onClick={e=>{e.stopPropagation();patchLayer(layer.id,{locked:!layer.locked});}} title={layer.locked?'ロックを解除':'レイヤーをロック'}>{layer.locked?'🔒':'🔓'}</button><button title="名前変更" onClick={e=>{e.stopPropagation();renameLayer(layer.id);}}>✎</button><button title="レイヤーを削除（内容は別レイヤーに移動）" onClick={e=>{e.stopPropagation();removeLayer(layer.id);}}>✕</button>
      </div>)}{!canvasLayers.length&&<button className="notes-layer-empty-button" onClick={()=>addLayer('canvas')}>＋ キャンバスレイヤー</button>}</div>
    </div>;

    if(kind==='layout')return <div className="notes-layer-group" key="layout">
      <div className="notes-layer-parent-label"><strong>◇</strong>{namePicker('layout',['レイアウト','オブジェクト'])}<small>図形・画像・文章ブロック</small>{groupButtons('layout')}<button className="notes-layer-add" title="レイアウトレイヤーを追加" onClick={()=>addLayer('layout')}>＋</button></div>
      <div className="notes-layer-list">{layoutLayers.map(layer=><div key={layer.id} className={'notes-layer-row '+(activeLayer===layer.id?'active':'')} onClick={()=>onActive(layer.id)}>
        <button onClick={e=>{e.stopPropagation();patchLayer(layer.id,{visible:!layer.visible});}}>{layer.visible?'◉':'○'}</button><button className="kn-layer-properties-link" aria-label={layer.name+'のプロパティ'} onClick={e=>{e.stopPropagation();onProperties?.(layer.id);}}>{layer.name}<small>{Math.round((layer.opacity??1)*100)}% · プロパティ</small></button>
        <button onClick={e=>{e.stopPropagation();moveChild(layer.id,-1);}}>↑</button><button onClick={e=>{e.stopPropagation();moveChild(layer.id,1);}}>↓</button><button onClick={e=>{e.stopPropagation();patchLayer(layer.id,{locked:!layer.locked});}} title={layer.locked?'ロックを解除':'レイヤーをロック'}>{layer.locked?'🔒':'🔓'}</button>
      </div>)}{(doc.blocks||[]).map((block,index)=><button key={block.id} className="notes-layer-child" onClick={()=>onSelectObject(block.id,'text')}><span>テキスト {index+1}</span><small>{cleanHTML(block.html).replace(/<[^>]+>/g,' ').trim().slice(0,22)||'空のテキスト'}</small></button>)}{!layoutLayers.length&&<button className="notes-layer-empty-button" onClick={()=>addLayer('layout')}>＋ レイアウトレイヤー</button>}</div>
    </div>;

    return <div className="notes-layer-group" key="graph">
      <div className="notes-layer-parent-label"><strong>▥ グラフ</strong><small>Excel参照</small>{groupButtons('graph')}</div>
      <div className="notes-layer-children">{!charts.length&&<div className="notes-layer-empty">グラフなし</div>}
        {charts.map((chart,index)=><div key={chart.id} className="notes-layer-chart-row">
          <button onClick={()=>onSelectObject(chart.id,'chart')}><span>{chart.name||chart.title||('グラフ '+(index+1))}</span><small>{chart.range}</small></button>
          <button onClick={()=>patchChart(chart.id,{visible:chart.visible===false})}>{chart.visible===false?'○':'◉'}</button>
          <button onClick={()=>patchChart(chart.id,{locked:!chart.locked})}>{chart.locked?'🔒':'🔓'}</button>
        </div>)}
      </div>
    </div>;
  };

  const sheetHasData=Object.values(sheet.cells||{}).some(value=>String(value).trim()!=='');
  const excelGroup=sheetHasData?<div className="notes-layer-group excel-group" key="excel">
    <div className="special bottom excel-special">
      <button className="excel-open" onClick={onSheetTool}><span>▦ {displayName('excel','Excel')}</span><em>{sheet.visible?'表示中・最下層':'データあり・非表示'}</em></button>
      <button title={sheet.visible?'Excelを隠す':'Excelを表示'} onClick={()=>onChange({...doc,sheet:{...sheet,visible:!sheet.visible}})}>{sheet.visible?'◉':'○'}</button>
      <button title="ロック" onClick={()=>onChange({...doc,sheet:{...sheet,locked:!sheet.locked}})}>{sheet.locked?'🔒':'🔓'}</button>
      <button title="Excelを隠す" disabled={!sheet.visible} onClick={()=>onChange({...doc,sheet:{...sheet,visible:false}})}>×</button>
    </div>
  </div>:null;

  return <aside className="notes-layer-panel" aria-label="レイヤー">
    <div className="notes-layer-title"><strong>レイヤー</strong><small>親レイヤーごとに順序変更</small></div>
    {order.map(kind=><div key={kind} className="notes-layer-family-wrap">{renderGroup(kind)}{kind==='graph'&&excelGroup}</div>)}
  </aside>;
}
