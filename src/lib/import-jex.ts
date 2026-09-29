import { api, blankNote, block, escapeHTML, fileURL, markdownHTML, uploadAttachment, type NoteRecord, type NoteIndex, type Attachment, type NoteMeta } from './notes';
import { notebookPath, type JexArchive } from './jex';

export async function importJex(archive:JexArchive, existing:NoteIndex[], progress:(message:string)=>void, cancelled:()=>boolean) {
  const map=new Map<string,string>();const records=new Map<string,NoteRecord>();let completed=0;let skipped=0;
  // Phase one establishes all note IDs so links can be resolved regardless of export order.
  for(const source of archive.notes){
    if(cancelled())throw new Error('取り込みを中断しました。同じJEXで続きから再開できます');
    const previous=existing.find(n=>n.note?.sourceId===source.id);
    if(previous){map.set(source.id,previous.id);if(previous.note?.importState==='complete'){skipped++;continue;}
      const record=await(await api('/api/documents/'+previous.id)).json() as NoteRecord;records.set(source.id,record);continue;}
    const content=blankNote();
    const tags=archive.links.filter(l=>l.meta.note_id===source.id).map(l=>archive.tags.find(t=>t.id===l.meta.tag_id)?.title).filter((t):t is string=>!!t);
    const path=notebookPath(archive,source.meta.parent_id);
    content.note={category:path,tags,sourceId:source.id,sourceTitle:source.title,sourceNotebook:path,
      sourceCreated:source.meta.user_created_time,sourceUpdated:source.meta.user_updated_time,sourceMarkdown:source.body,
      sourceFormat:source.meta.markup_language==='2'?'html':'markdown',importState:'pending',isTodo:source.meta.is_todo==='1',completed:source.meta.todo_completed!=='0',due:source.meta.todo_due};
    content.blocks=[block(80,80,source.meta.markup_language==='2'?escapeHTML(source.body):markdownHTML(source.body))];
    const record=await(await api('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:source.title,content})})).json() as NoteRecord;
    records.set(source.id,record);map.set(source.id,record.id);progress(`メモを準備 ${map.size} / ${archive.notes.length}`);
  }
  // Preserve even resources which are not referenced by any note in a separate attachment memo.
  const referenced=new Set(archive.notes.flatMap(n=>Array.from(n.body.matchAll(/:\/([a-f0-9]{32})/g),m=>m[1])));
  const orphan=archive.resources.filter(r=>!referenced.has(r.id));
  if(orphan.length) {
    const orphanKey='jex-unlinked-'+orphan.map(r=>r.id).sort().join('-');
    let owner=existing.find(n=>n.note?.sourceId===orphanKey);
    if(!owner){const content=blankNote();content.note={category:'Joplin / 未参照の添付',tags:[],sourceId:orphanKey,importState:'pending'};
      owner=await(await api('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Joplinの未参照添付',content})})).json() as NoteIndex;}
    if(owner.note?.importState!=='complete'){
      const record=await(await api('/api/documents/'+owner.id)).json() as NoteRecord;
      const attachments:Attachment[]=[];
      for(const resource of orphan){if(cancelled())throw new Error('中断しました。再取り込みで再開できます');
        const blob=archive.files.get(resource.id)!;const a={id:resource.id,name:resource.title||resource.meta.filename||resource.id,mime:resource.meta.mime,size:blob.size};
        await uploadAttachment(record.id,a,blob);attachments.push(a);}
      record.content.attachments=attachments;record.content.note!.importState='complete';
      await api('/api/documents/'+record.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:record.title,revision:record.revision,content:record.content})});
    }
  }
  for(const source of archive.notes){
    const record=records.get(source.id);if(!record)continue;
    if(cancelled())throw new Error('取り込みを中断しました。同じJEXで続きから再開できます');
    const refs=new Set(Array.from(source.body.matchAll(/:\/([a-f0-9]{32})/g),m=>m[1]));
    const attachments:Attachment[]=[];
    for(const resource of archive.resources.filter(r=>refs.has(r.id))){
      const blob=archive.files.get(resource.id)!;
      const a:Attachment={id:resource.id,name:resource.title||resource.meta.filename||resource.id,mime:resource.meta.mime||'application/octet-stream',size:blob.size,sourceId:resource.id};
      await uploadAttachment(record.id,a,blob,done=>{progress(`添付を転送 ${Math.round(done/blob.size*100)}% ・メモ ${completed+skipped+1} / ${archive.notes.length}`);});attachments.push(a);
      if(cancelled())throw new Error('取り込みを中断しました。同じJEXで続きから再開できます');
    }
    const converted=source.body.replace(/:\/([a-f0-9]{32})/g,(original,id:string)=>
      attachments.some(a=>a.id===id)?fileURL(record.id,id):map.has(id)?`?d=${map.get(id)}`:original);
    const html=source.meta.markup_language==='2'?converted:markdownHTML(converted);
    record.content.blocks=[block(80,80,html)];record.content.attachments=attachments;
    record.content.note={...record.content.note,importState:'complete'} as NoteMeta;
    await api('/api/documents/'+record.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:record.title,revision:record.revision,content:record.content})});
    completed++;progress(`取り込み ${completed+skipped} / ${archive.notes.length}`);
  }
  return {completed,skipped};
}
