import DOMPurify from 'dompurify';
import { marked } from 'marked';
import TurndownService from 'turndown';
import type { CanvasDoc, Point, Layer } from './canvas';

export type NoteBlock = { id: string; x: number; y: number; w: number; h: number; html: string; background?: string };
export type Attachment = { id: string; name: string; mime: string; size: number; sourceId?: string };
export type NoteMeta = { category: string; tags: string[]; pinned?: boolean; sourceId?: string; sourceNotebook?: string;
  sourceCreated?: string; sourceUpdated?: string; sourceMarkdown?: string; sourceFormat?: string; sourceTitle?: string;
  trashedAt?: string; importState?: 'pending' | 'complete'; isTodo?: boolean; completed?: boolean; due?: string;
  organizationLog?: { at: string; category: string; tags: string[] }[] };
export type NoteDoc = Omit<CanvasDoc, 'layers'> & { layers: (Layer & { rasterImageId?: string; rasterBounds?: {x:number;y:number;w:number;h:number} })[]; blocks?: NoteBlock[]; note?: NoteMeta; attachments?: Attachment[];
  paintStrokes?: { id: string; layerId: string; points: Point[]; color: string; width: number; opacity: number; blockId?: string }[] };
export type NoteIndex = { id: string; title: string; revision: number; updated_at: number; excerpt?: string; searchText?: string; note?: NoteMeta };
export type NoteRecord = NoteIndex & { content: NoteDoc; accountId?: string; dirty?: boolean };
export const id32 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
export const API = '/canvas/api.php?path=';
export const fileURL = (docId: string, id: string) => API + encodeURIComponent(`/api/documents/${docId}/files/${id}`);
export function cleanHTML(value: string): string {
  const sanitized = DOMPurify.sanitize(value, { ALLOWED_TAGS: ['p','div','br','strong','b','em','i','u','s','strike','h1','h2','h3','h4','ul','ol','li','blockquote','pre','code','a','img','table','thead','tbody','tr','th','td','span','font','input'],
    ALLOWED_ATTR: ['href','src','alt','title','color','size','type','checked','disabled'], ALLOW_DATA_ATTR: false });
  const el = document.createElement('div'); el.innerHTML = sanitized;
  el.querySelectorAll('input').forEach(input => { if (input.type !== 'checkbox') input.remove(); else input.removeAttribute('disabled'); });
  return el.innerHTML;
}
export const markdownHTML = (text: string) => cleanHTML(marked.parse(text, { async: false }) as string);
export function plainText(html: string) { const el = document.createElement('div'); el.innerHTML = cleanHTML(html); return el.textContent || ''; }
export function block(x = 80, y = 80, html = ''): NoteBlock { return { id: id32(), x, y, w: 660, h: 240, html }; }
export function blankNote(): NoteDoc { return { version: 1, items: [], layers: [{ id: id32(), name: 'メモ', visible: true, locked: false }], grid: 'none', snap: false,
  blocks: [{...block(innerWidth <= 760 ? 28 : 80, 60), w: innerWidth <= 760 ? Math.max(260, innerWidth - 56) : 660}], note: { category: '', tags: [] }, attachments: [] }; }
export function normalizeNote(input: NoteDoc): NoteDoc {
  // Shift old negative-coordinate canvases into the scrollable workspace once.
  const legacy = input.items.filter(item => item.kind === 'text');
  const boxes = [...input.items, ...input.layers.flatMap(l => l.rasterBounds ? [l.rasterBounds] : [])];
  const points = [...boxes.map(b => ({x:Math.min(b.x,b.x+b.w),y:Math.min(b.y,b.y+b.h)})), ...(input.paintStrokes || []).flatMap(s => s.points), ...input.items.flatMap(i=>i.points||[])];
  const minX = Math.min(0,...points.map(p=>p.x)), minY = Math.min(0,...points.map(p=>p.y));
  const dx = !input.blocks && minX < 0 ? 80-minX : 0, dy = !input.blocks && minY < 0 ? 80-minY : 0;
  return { ...input,
    items: input.items.filter(item => item.kind !== 'text').map(i=>({...i,x:i.x+dx,y:i.y+dy,points:i.points?.map(p=>({...p,x:p.x+dx,y:p.y+dy}))})),
    layers: input.layers.map(l=>({...l,rasterBounds:l.rasterBounds?{...l.rasterBounds,x:l.rasterBounds.x+dx,y:l.rasterBounds.y+dy}:undefined})),
    paintStrokes: input.paintStrokes?.map(s=>({...s,points:s.points.map(p=>({...p,x:p.x+dx,y:p.y+dy}))})),
    blocks: [...(input.blocks || []), ...legacy.map(item => ({ ...block(item.x+dx, item.y+dy), w: Math.max(220, Math.min(item.w, 1200)), html: escapeHTML(item.text || '').replaceAll('\n','<br>') }))],
    note: { category: '', tags: [], ...input.note }, attachments: input.attachments || [] };

}
export function escapeHTML(value: string) { return value.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!)); }
export function indexOf(record: NoteRecord): NoteIndex {
  const text = (record.content.blocks || []).map(b => plainText(b.html)).join('\n') + '\n' + (record.content.attachments || []).map(a=>a.name).join(' ');
  const { sourceMarkdown: _, organizationLog: __, ...note } = record.content.note || { category: '', tags: [] };
  return { id: record.id, title: record.title, revision: record.revision, updated_at: record.updated_at, note, excerpt: text.slice(0,160), searchText: text };
}
export async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.method && !['GET','HEAD'].includes(init.method)) headers.set('X-CSRF-Token', window.CanvasCsrf || '');
  const response = await fetch(API + encodeURIComponent(path), { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const error = new Error(result.error || `通信エラー (${response.status})`) as Error & { status: number };
    error.status = response.status; throw error;
  }
  return response;
}
export async function uploadAttachment(docId: string, attachment: Attachment, blob: Blob, progress?: (done: number) => void) {
  let offset = 0;
  while (offset < blob.size) {
    const form = new FormData();
    form.set('file', blob.slice(offset, offset + 1024 * 1024), attachment.name);
    form.set('offset', String(offset)); form.set('total', String(blob.size)); form.set('name', attachment.name);
    const response = await api(`/api/documents/${docId}/files/${attachment.id}`, { method: 'POST', body: form });
    const next = (await response.json() as { nextOffset: number }).nextOffset;
    if (next <= offset || next > blob.size) throw new Error('添付の送信位置が不正です');
    offset = next; progress?.(offset);
  }
}
const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
markdown.addRule('tasks', { filter: 'input', replacement: (_content, node) => (node as HTMLInputElement).checked ? '[x] ' : '[ ] ' });
export function exportMarkdown(record: NoteRecord) {
  const meta = record.content.note || { category: '', tags: [] };
  const header = { canvas_id: record.id, title: record.title, category: meta.category, tags: meta.tags,
    source_id: meta.sourceId || null, source_notebook: meta.sourceNotebook || null, updated_at: new Date(record.updated_at).toISOString() };
  const body = (record.content.blocks || []).map(b => markdown.turndown(cleanHTML(b.html))).join('\n\n');
  return '---\n' + Object.entries(header).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n\n# ' + record.title + '\n\n' + body + '\n\n' +
    (record.content.attachments || []).map(a => `- [${a.name}](${new URL(fileURL(record.id, a.id), location.origin).href})`).join('\n');
}
export function download(name: string, data: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([data], { type: `${type};charset=utf-8` })); const a = document.createElement('a');
  a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g,'_'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
