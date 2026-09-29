/** TAR/JEX reader. Reads metadata and retains Blob slices; never expands attachments into RAM. */
export type JexEntry = { id: string; type: number; title: string; body: string; meta: Record<string,string> };
export type JexArchive = { notes: JexEntry[]; notebooks: JexEntry[]; tags: JexEntry[]; links: JexEntry[]; resources: JexEntry[]; files: Map<string,Blob> };
const utf8 = new TextDecoder('utf-8', { fatal: true });
function field(bytes: Uint8Array) { return utf8.decode(bytes).replace(/\0.*$/s,'').trim(); }
export function parseJexRecord(text: string): JexEntry {
  // Joplin's metadata is the final paragraph; note-tag records have no title/body.
  const split = text.lastIndexOf('\n\n');
  const content = split < 0 ? '' : text.slice(0,split);
  const tail = split < 0 ? text : text.slice(split+2);
  const meta: Record<string,string> = {};
  for (const line of tail.split('\n')) { const sep = line.indexOf(': '); if (sep >= 0) meta[line.slice(0,sep)] = line.slice(sep+2); }
  if (!/^[a-f0-9]{32}$/.test(meta.id || '') || !/^\d+$/.test(meta.type_ || '')) throw new Error('JEXのメタデータが不正です');
  const first = content.indexOf('\n\n');
  return { id: meta.id, type: Number(meta.type_), title: first < 0 ? content : content.slice(0,first), body: first < 0 ? '' : content.slice(first+2), meta };
}
export async function readJex(file: Blob): Promise<JexArchive> {
  const records: JexEntry[] = []; const files = new Map<string,Blob>(); const paths = new Set<string>();
  let offset = 0;
  while (offset + 512 <= file.size) {
    const h = new Uint8Array(await file.slice(offset,offset+512).arrayBuffer());
    if (h.every(b => b === 0)) break;
    const expected = parseInt(field(h.slice(148,156)),8);
    const sum = h.reduce((v,b,i) => v + (i >=148 && i<156 ? 32 : b),0);
    if (expected !== sum) throw new Error('JEXが破損しています（TARチェックサム）');
    const sizeText = field(h.slice(124,136));
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('対応していないTAR形式です');
    const size = parseInt(sizeText,8);
    let name = field(h.slice(0,100)); const prefix = field(h.slice(345,500)); if (prefix) name = prefix+'/'+name;
    name = name.replace(/^\.\//,'');
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\') || paths.has(name)) throw new Error('JEXに不正なパスまたは重複があります');
    paths.add(name);
    if (!Number.isSafeInteger(size) || offset+512+size>file.size) throw new Error('JEXのデータが途中で切れています');
    const kind = h[156];
    if (kind === 0 || kind === 48) {
      const data = file.slice(offset+512,offset+512+size);
      if (/^[a-f0-9]{32}\.md$/.test(name)) {
        if (size > 8_000_000) throw new Error('8MBを超えるメモは取り込めません');
        const record = parseJexRecord(utf8.decode(await data.arrayBuffer()));
        if (record.id !== name.slice(0,32)) throw new Error('JEXのIDが一致しません');
        if (record.meta.encryption_applied === '1' || record.meta.encryption_blob_encrypted === '1') throw new Error('Joplinで復号してからJEXを書き出してください');
        records.push(record);
      } else if (/^resources\/[a-f0-9]{32}(\.[^/]+)?$/.test(name)) {
        const id = name.slice(10,42); if (files.has(id)) throw new Error('添付IDが重複しています'); files.set(id,data);
      } else throw new Error('対応していないJEXファイルです: '+name);
    } else if (kind !== 53) throw new Error('対応していないTARエントリーです');
    offset += 512+Math.ceil(size/512)*512;
  }
  const ofType = (type: number) => records.filter(r => r.type === type);
  const result = { notes: ofType(1), notebooks: ofType(2), resources: ofType(4), tags: ofType(5), links: ofType(6), files };
  if (!result.notes.length) throw new Error('JEXにメモがありません');
  for (const r of result.resources) if (!files.has(r.id)) throw new Error('添付ファイルが不足しています: '+r.title);
  return result;
}
export function notebookPath(archive: JexArchive, id: string): string {
  const parts: string[] = []; const seen = new Set<string>();
  while (id) { if (seen.has(id)) throw new Error('ノートブックの階層が循環しています'); seen.add(id);
    const notebook = archive.notebooks.find(n => n.id === id); if (!notebook) break; parts.unshift(notebook.title); id = notebook.meta.parent_id; }
  return parts.join(' / ');
}
