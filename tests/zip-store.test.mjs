import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ZipStore} from '../src/lib/zip-store.ts';

test('a standard ZIP reader validates Japanese paths, original bytes and CRC across chunks',async()=>{
  const zip=new ZipStore(),binary=Uint8Array.from({length:2*1024*1024+17},(_,n)=>n%251);
  await zip.add('フォルダ/本文.txt','本文・ルビと画像を保持');await zip.add('原本/画像.png',new Blob([binary]));await zip.add('空.txt','');
  const dir=mkdtempSync(join(tmpdir(),'kaeru-zip-'));
  try{
    const path=join(dir,'data.zip');writeFileSync(path,new Uint8Array(await zip.finish().arrayBuffer()));
    execFileSync('python3',['-c',"import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n assert z.read('フォルダ/本文.txt').decode() == '本文・ルビと画像を保持'\n assert z.read('原本/画像.png') == bytes(n%251 for n in range(2*1024*1024+17))\n assert z.read('空.txt') == b''\n assert all(i.flag_bits & 0x800 for i in z.infolist())",path]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('unsafe or duplicate archive paths are rejected instead of overwriting originals',async()=>{
  const zip=new ZipStore();for(const path of ['../原本','/原本','a/../原本','a\\b','a\0b'])await assert.rejects(zip.add(path,'data'),/不正/);
  await zip.add('original.png','bytes');await assert.rejects(zip.add('original.png','other'),/重複/);
});
test('an archive exceeding the save limit fails before returning a partial archive',async()=>{
  await assert.rejects(new ZipStore(100).add('原本.bin',new Blob([new Uint8Array(100)])),/分けて保存/);
});
