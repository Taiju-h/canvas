import type {Item,Point} from './canvas';

export type ShapePreset={id:string;name:string;w:number;h:number;items:Item[];custom?:boolean};
export type ShapeBounds={x:number;y:number;w:number;h:number};
const polygon=(points:Point[]):Item=>({id:'shape',layerId:'',kind:'polygon',x:0,y:0,w:100,h:100,points,color:'#263443',width:3,fill:'none',opacity:1});
const coords=(pairs:number[][])=>pairs.map(([x,y])=>({x,y}));
const regular=(count:number,inner=1)=>Array.from({length:count},(_,i)=>{const a=-Math.PI/2+i*Math.PI*2/count,r=i%2?inner:1;return{x:50+48*r*Math.cos(a),y:50+48*r*Math.sin(a)};});
const preset=(id:string,name:string,points:Point[]):ShapePreset=>({id,name,w:100,h:100,items:[polygon(points)]});
export const builtInShapePresets:ShapePreset[]=[
  preset('triangle','三角形',coords([[50,0],[100,100],[0,100]])),
  preset('arrow','右矢印',coords([[0,30],[60,30],[60,0],[100,50],[60,100],[60,70],[0,70]])),
  preset('diamond','ひし形',coords([[50,0],[100,50],[50,100],[0,50]])),
  preset('pentagon','五角形',regular(5)),preset('hexagon','六角形',regular(6)),preset('octagon','八角形',regular(8)),
  preset('star','星（5角）',regular(10,.42)),preset('star-six','星（6角）',regular(12,.5)),
  preset('starburst','ギザギザ',regular(24,.72)),
  preset('trapezoid','台形',coords([[20,0],[80,0],[100,100],[0,100]])),
  preset('parallelogram','平行四辺形',coords([[25,0],[100,0],[75,100],[0,100]])),
  preset('right-triangle','直角三角形',coords([[0,0],[100,100],[0,100]])),
  preset('arrow-left','左矢印',coords([[100,30],[40,30],[40,0],[0,50],[40,100],[40,70],[100,70]])),
  preset('arrow-up','上矢印',coords([[30,100],[30,40],[0,40],[50,0],[100,40],[70,40],[70,100]])),
  preset('arrow-down','下矢印',coords([[30,0],[30,60],[0,60],[50,100],[100,60],[70,60],[70,0]])),
  preset('arrow-double','左右矢印',coords([[0,50],[30,0],[30,30],[70,30],[70,0],[100,50],[70,100],[70,70],[30,70],[30,100]])),
  preset('chevron','山形矢印',coords([[0,0],[50,0],[100,50],[50,100],[0,100],[50,50]])),
  preset('cross','十字',coords([[35,0],[65,0],[65,35],[100,35],[100,65],[65,65],[65,100],[35,100],[35,65],[0,65],[0,35],[35,35]])),
  preset('speech','吹き出し',coords([[0,0],[100,0],[100,75],[45,75],[20,100],[25,75],[0,75]])),
  preset('heart','ハート',Array.from({length:80},(_,i)=>{const t=i*Math.PI*2/80;return{x:50+3*Math.sin(t)**3*16,y:44-3*(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))};})),
  preset('flag','旗',coords([[0,0],[100,0],[75,40],[100,80],[0,80]])),
  {id:'line',name:'直線',w:100,h:100,items:[{...polygon([]),kind:'line',points:undefined,x:0,y:0,w:100,h:100}]},
];
const vectorKinds=new Set(['rect','ellipse','polygon','path','line']);
function itemBounds(i:Item){const points=i.points?.length?i.points:[{x:i.x,y:i.y},{x:i.x+i.w,y:i.y+i.h}];return{x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),w:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),h:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))};}
export function createShapePreset(id:string,name:string,items:Item[]):ShapePreset{
  if(!name.trim()||!items.length||items.length>32||items.some(i=>!vectorKinds.has(i.kind)))throw new Error('図形を32個以内で選択してください（画像・文章は登録できません）');
  const boxes=items.map(itemBounds),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h));
  const clean=items.map((i,index):Item=>({id:'shape-'+index,layerId:'',kind:i.kind,x:i.x-x,y:i.y-y,w:i.w,h:i.h,points:i.points?.map(p=>({x:p.x-x,y:p.y-y})),color:i.color,fill:i.fill,width:i.width,opacity:i.opacity,rotation:i.rotation,inkMasks:i.inkMasks}));
  return{id,name:name.trim().slice(0,60),w:Math.max(1,right-x),h:Math.max(1,bottom-y),items:clean,custom:true};
}
export function instantiateShapePreset(preset:ShapePreset,box:ShapeBounds,layerId:string,newId:()=>string,color:string,width:number):Item[]{
  const sx=Math.max(1,box.w)/preset.w,sy=Math.max(1,box.h)/preset.h,point=(p:Point)=>({...p,x:box.x+p.x*sx,y:box.y+p.y*sy});
  return preset.items.map(i=>({...i,id:newId(),layerId,x:box.x+i.x*sx,y:box.y+i.y*sy,w:i.w*sx,h:i.h*sy,points:i.points?.map(point),color:preset.custom?i.color:color,width:preset.custom?Math.max(.5,i.width*Math.sqrt(sx*sy)):width}));
}
export function readShapePresets(value:string|null):ShapePreset[]{
  try{const parsed=JSON.parse(value||'[]');if(!Array.isArray(parsed))return[];
    return parsed.slice(0,100).filter((p:ShapePreset)=>p&&typeof p.id==='string'&&typeof p.name==='string'&&p.name.length<=60&&p.custom===true&&Number.isFinite(p.w)&&p.w>0&&Number.isFinite(p.h)&&p.h>0&&Array.isArray(p.items)&&p.items.length>0&&p.items.length<=32&&p.items.every(i=>vectorKinds.has(i.kind)&&[i.x,i.y,i.w,i.h,i.width].every(Number.isFinite)&&(!i.points||(i.points.length<=10000&&i.points.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y))))));
  }catch{return[];}
}
