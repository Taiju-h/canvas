import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/jex.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {readJex,notebookPath}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const note='a'.repeat(32),book='b'.repeat(32),resource='c'.repeat(32);
function tar(entries){const parts=[];for(const [name,data] of entries){const body=Buffer.from(data);const header=Buffer.alloc(512);header.write(name);header.write(body.length.toString(8).padStart(11,'0')+'\0',124);header.fill(32,148,156);header[156]=48;const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);parts.push(header,body,Buffer.alloc((512-body.length%512)%512));}parts.push(Buffer.alloc(1024));return new Blob(parts);}
const entries=[[note+'.md',`テスト\n\n日本語本文\n\n![画像](:/${resource})\n\nid: ${note}\nparent_id: ${book}\ntype_: 1\n`],[book+'.md',`分類\n\nid: ${book}\nparent_id: \ntype_: 2\n`],[resource+'.md',`添付.png\n\nid: ${resource}\nmime: image/png\ntype_: 4\n`],['resources/'+resource+'.png','fake fixture bytes']];
test('reads Japanese body, notebook hierarchy and attachment slices',async()=>{const a=await readJex(tar(entries));assert.equal(a.notes.length,1);assert.equal(notebookPath(a,book),'分類');assert.match(a.notes[0].body,/日本語本文/);assert.equal(await a.files.get(resource).text(),'fake fixture bytes');});
test('rejects missing attachments before mutation',async()=>{await assert.rejects(readJex(tar(entries.slice(0,-1))),/添付ファイルが不足/);});
test('rejects path traversal',async()=>{await assert.rejects(readJex(tar([['../private','bad']])),/不正なパス/);});
test('rejects truncated archives',async()=>{const archive=tar(entries);await assert.rejects(readJex(archive.slice(0,550)),/途中で切れ/);});
test('rejects corrupted TAR checksum',async()=>{const bytes=new Uint8Array(await tar(entries).arrayBuffer());bytes[0]=120;await assert.rejects(readJex(new Blob([bytes])),/チェックサム/);});
test('rejects encrypted content',async()=>{const encrypted=entries.map(([name,text])=>[name,name===note+'.md'?text.replace('type_: 1','encryption_applied: 1\ntype_: 1'):text]);await assert.rejects(readJex(tar(encrypted)),/復号/);});
if(process.env.JEX_TEST_FILE)test('optional private archive inventory',async()=>{const a=await readJex(new Blob([await readFile(process.env.JEX_TEST_FILE)]));assert.equal(a.notes.length,237);assert.equal(a.resources.length,44);});
