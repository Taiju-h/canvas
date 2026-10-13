import {cleanHTML,escapeHTML,exportMarkdown,type NoteRecord,type NoteIndex} from './notes';
import {noteAssets,type NoteAsset} from './note-files';
import {ZipStore} from './zip-store';
import type {OfflineWorkspace} from './offline-workspace';

export type BackupProgress={done:number;total:number;files:number;page:string};
export function safeFileName(value:string,limit=60){
  const name=Array.from(value.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'_').replace(/[. ]+$/,'')).slice(0,limit).join('')||'名称なし';
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)?'_'+name:name;
}
const pathURL=(path:string)=>path.split('/').map(encodeURIComponent).join('/');
const style='body{max-width:960px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui,sans-serif;color:#292c31;background:#fff}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}pre{white-space:pre-wrap}a{color:#765a2a}small{color:#786e60}';
function htmlDocument(title:string,body:string){
  return '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' file: data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>'+escapeHTML(title)+'</title><style>'+style+'</style><body>'+body+'</body></html>';
}
function portableHTML(html:string,paths:Map<string,string>){
  const template=document.createElement('template');template.innerHTML=html;
  for(const node of template.content.querySelectorAll('img,a')){
    let id=node.getAttribute('data-kn-local-file')||node.getAttribute('data-kn-local-image')||'';
    const attribute=node.tagName==='IMG'?'src':'href';
    if(!id){try{const u=new URL(node.getAttribute(attribute)||'',location.href);if(u.origin===location.origin&&u.pathname==='/canvas/api.php')id=/\/api\/documents\/[a-f0-9]{32}\/(?:files|images)\/([^/]+)$/.exec(u.searchParams.get('path')||'')?.[1]||'';}catch{}}
    const path=paths.get(id.replace(/^file:/,''));if(path)node.setAttribute(attribute,pathURL(path));
    else if(node.tagName==='IMG'&&!(node.getAttribute('src')||'').startsWith('data:')){node.removeAttribute('src');node.setAttribute('alt',(node.getAttribute('alt')||'外部画像')+'（元の参照はnote.jsonに保存）');}
    node.removeAttribute('data-kn-local-file');node.removeAttribute('data-kn-local-image');
  }
  return cleanHTML(template.innerHTML);
}

export async function buildNoteBackup(rows:NoteIndex[],read:(id:string,revision?:number)=>Promise<NoteRecord>,assetBytes:(docId:string,asset:NoteAsset)=>Promise<Blob>,workspace:OfflineWorkspace,progress:(p:BackupProgress)=>void,signal?:AbortSignal){
  const zip=new ZipStore(),pages:{id:string;title:string;category:string;path:string;trashed:boolean;dirty:boolean;assets:{id:string;name:string;path:string;size:number;mime:string}[]}[]=[];
  let files=0,done=0;
  const check=()=>{if(signal?.aborted)throw new DOMException('データの取り出しを中止しました','AbortError');};
  await zip.add('README.txt','KaeruNoteのデータ書き出し\n\nZIPを展開し、index.htmlを開くとページ一覧を確認できます。各ページのindex.htmlとnote.mdは通信なしで読めます。filesには取得した画像・添付の原本が入っています。\n\nnote.jsonには本文、元の分類・ID、添付情報、Canvas・レイヤー等の編集データを保持しています。Canvasの全オブジェクトをHTMLの見た目へ再現するものではありません。inlineの画像データは本文・JSONにも保持しています。\n\nfolders.jsonはフォルダの階層、workspace.jsonはこの端末の未同期分類です。manifest.jsonで保存したページ・原本の件数を確認できます。自動復元用の読み込み機能は含みません。\n');
  await zip.add('folders.json',JSON.stringify({version:1,categories:workspace.categories},null,2));
  await zip.add('workspace.json',JSON.stringify(workspace,null,2));
  progress({done,total:rows.length,files,page:''});
  for(const row of rows){
    check();progress({done,total:rows.length,files,page:row.title});
    const record=await read(row.id,row.revision);check();
    const category=record.content.note?.category||'',trashed=!!record.content.note?.trashedAt;
    // Short paths also extract on Windows without losing the full names/IDs in JSON.
    const base='pages/'+(trashed?'ゴミ箱/':'')+String(done+1).padStart(4,'0')+'-'+safeFileName(record.title,40);
    const paths=new Map<string,string>(),assets:{id:string;name:string;path:string;size:number;mime:string}[]=[];
    for(const asset of noteAssets(record)){
      check();const bytes=await assetBytes(record.id,asset);check();
      const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[bytes.type];
      const name=asset.kind==='image'&&extension?asset.id+'.'+extension:asset.name;
      const path='files/'+asset.id+'-'+safeFileName(name);
      await zip.add(base+'/'+path,bytes);paths.set(asset.id,path);assets.push({id:asset.id,name:asset.name,path,size:bytes.size,mime:bytes.type});files++;
      progress({done,total:rows.length,files,page:record.title});
    }
    const raw={id:record.id,title:record.title,revision:record.revision,updated_at:record.updated_at,dirty:!!record.dirty,content:record.content};
    await zip.add(base+'/note.json',JSON.stringify(raw,null,2));
    const fixed=portableHTML(record.content.fixedNote?.html||'',paths),blocks=(record.content.blocks||[]).map(b=>portableHTML(b.html,paths));
    const links=assets.map(a=>'<li><a href="'+pathURL(a.path)+'" download>'+escapeHTML(a.name)+'</a> ('+a.size+'バイト)</li>').join('');
    await zip.add(base+'/index.html',htmlDocument(record.title,'<h1>'+escapeHTML(record.title)+'</h1><small>'+escapeHTML(category||'未分類')+(trashed?' · ゴミ箱':'')+'</small>'+fixed+blocks.join('\n')+(links?'<h2>画像・添付の原本</h2><ul>'+links+'</ul>':'')));
    const portable={...record,content:{...record.content,fixedNote:record.content.fixedNote?{...record.content.fixedNote,html:fixed}:undefined,blocks:record.content.blocks?.map((b,i)=>({...b,html:blocks[i]})),attachments:[]}};
    await zip.add(base+'/note.md',exportMarkdown(portable)+(assets.length?'\n\n## 原本\n'+assets.map(a=>`- [${a.name.replace(/[\[\]]/g,'_')}](${pathURL(a.path)})`).join('\n'):''));
    pages.push({id:record.id,title:record.title,category,path:base,trashed,dirty:!!record.dirty,assets});done++;progress({done,total:rows.length,files,page:record.title});
  }
  check();await zip.add('manifest.json',JSON.stringify({format:'kaerunote-data',version:1,exportedAt:new Date().toISOString(),pageCount:pages.length,fileCount:files,pages},null,2));
  await zip.add('index.html',htmlDocument('KaeruNoteのデータ','<h1>KaeruNoteのデータ</h1><p>'+pages.length+'ページ · 画像／添付の原本 '+files+'ファイル</p><ul>'+pages.map(p=>'<li><a href="'+pathURL(p.path+'/index.html')+'">'+escapeHTML(p.title)+'</a> <small>'+escapeHTML(p.category||'未分類')+(p.trashed?' · ゴミ箱':'')+'</small></li>').join('')+'</ul>'));
  check();return zip.finish();
}
