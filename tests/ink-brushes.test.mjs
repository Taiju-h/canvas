import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleInk,brushOutline,airbrushDabs,pressureWidth} from '../src/lib/ink-brushes.ts';

test('spray spacing is stable across event frequencies and bounded on very long strokes',()=>{
  const sparse=[{x:0,y:0,p:.2},{x:100,y:0,p:.8}],dense=Array.from({length:101},(_,i)=>({x:i,y:0,p:.2+i*.006}));
  const a=airbrushDabs(sparse,20,true),b=airbrushDabs(dense,20,true);assert.equal(a.length,b.length);
  a.forEach((point,i)=>{for(const key of ['x','y','r'])assert.ok(Math.abs(point[key]-b[i][key])<1e-9);});
  assert.ok(sampleInk([{x:0,y:0},{x:1e7,y:0}],1).length<=2048);
});
test('brush ink has narrow entry and exit, responds to pressure, and preserves the source points',()=>{
  const points=[{x:0,y:50,p:.2},{x:50,y:50,p:.5},{x:100,y:50,p:1}],before=JSON.stringify(points),path=brushOutline(points,30,true);
  assert.ok(path.startsWith('M')&&path.endsWith(' Z'));assert.ok(!/NaN|Infinity/.test(path));
  assert.ok(pressureWidth(30,1)>pressureWidth(30,.2));assert.equal(JSON.stringify(points),before);
  const coordinates=[...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}));
  assert.ok(Math.max(...coordinates.filter(p=>Math.abs(p.x-50)<4).map(p=>Math.abs(p.y-50)))>7);
  assert.ok(coordinates.filter(p=>p.x===0||p.x===100).every(p=>Math.abs(p.y-50)<3));
});
test('taps and duplicate events produce a finite soft dab and no invalid brush path',()=>{
  const points=[{x:20,y:30,p:.5},{x:20,y:30,p:.5},{x:20.2,y:30,p:.5}];
  assert.equal(brushOutline(points,24,true),'');const dabs=airbrushDabs(points,24,true);
  assert.equal(dabs.length,1);assert.ok(dabs.every(p=>Object.values(p).every(Number.isFinite)&&p.r>0));
  assert.deepEqual(airbrushDabs(points,24,true),dabs);
});
