"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent, WheelEvent } from "react";
import {
  Box, Check, ChevronDown, Circle, Cloud, CloudOff, Copy, Download, Eraser,
  Eye, EyeOff, FolderOpen, Grid3X3, Hand, Highlighter, ImagePlus, Layers3,
  Link2, Lock, Menu, MousePointer2, Pencil, Plus, Redo2, RectangleHorizontal,
  RotateCcw, RotateCw, Scissors, Share2, Slash, Trash2, Type, Undo2, Ungroup, Unlock, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import {
  blankDoc, bounds, breakApart, eraseStroke, gridStep, inverseTransformPoint, mergeDocs,
  moved, pathData, snapInkPoint, snapPoint, transformCenter, transformPoint, uid,
  type CanvasDoc, type Item, type Point, type Tool,
} from "@/lib/canvas";
import {
  deleteLocalDoc, getLocalDoc, getLocalImage, listLocalDocs, putLocalDoc, putLocalImage,
  type LocalDoc,
} from "@/lib/local-docs";

const starter: CanvasDoc = {
  version: 1, items: [],
  layers: [{ id: "start-layer", name: "レイヤー 1", visible: true, locked: false }],
  grid: "square", snap: true,
};
const palette = ["#172436", "#2264df", "#e05047", "#df9725", "#158c79", "#824fc9", "#ffffff"];
const tools: { id: Tool; label: string; icon: typeof Pencil; hint: string }[] = [
  { id: "select", label: "選択", icon: MousePointer2, hint: "V" },
  { id: "hand", label: "移動", icon: Hand, hint: "H" },
  { id: "pen", label: "ペン", icon: Pencil, hint: "P" },
  { id: "marker", label: "マーカー", icon: Highlighter, hint: "M" },
  { id: "eraser", label: "部分消し", icon: Eraser, hint: "E" },
  { id: "delete", label: "全体消去", icon: X, hint: "D" },
  { id: "line", label: "線", icon: Slash, hint: "L" },
  { id: "rect", label: "四角", icon: RectangleHorizontal, hint: "R" },
  { id: "ellipse", label: "円", icon: Circle, hint: "O" },
  { id: "box", label: "立体", icon: Box, hint: "B" },
  { id: "text", label: "メモ", icon: Type, hint: "T" },
];
type View = { x: number; y: number; scale: number; rotation: number };
type DocMeta = { id: string; title: string; revision: number; updated_at: number };
type ModelTool = {
  name: string; title: string; description: string; inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};
declare global {
  interface Window {
    CanvasNative?: { saveFile: (base64: string, filename: string, mime: string) => void };
    CanvasCsrf?: string;
  }
  interface Document {
    modelContext?: { registerTool: (tool: ModelTool, options?: { signal: AbortSignal }) => void | Promise<void> };
  }
}
type Activity =
  | { type: "draw"; start: Point; points: Point[]; tool: Tool }
  | { type: "drag"; start: Point; original: CanvasDoc; itemId: string; node?: number; moved: boolean }
  | { type: "transform"; mode: "scale" | "rotate"; start: Point; center: Point; original: CanvasDoc; itemId: string; moved: boolean }
  | { type: "erase"; last: Point; original: CanvasDoc; changed: boolean }
  | { type: "pan"; startX: number; startY: number; view: View }
  | { type: "mask"; start: Point };

function rotateVector(point: Point, degrees: number): Point {
  const angle = degrees * Math.PI / 180;
  return { x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle) };
}
function viewCenter(view: View, size: { w: number; h: number }): Point {
  return { x: view.x + size.w / (2 * view.scale), y: view.y + size.h / (2 * view.scale) };
}
function screenToWorld(screen: Point, view: View, size: { w: number; h: number }): Point {
  const center = viewCenter(view, size);
  const vector = rotateVector({ x: (screen.x - size.w / 2) / view.scale,
    y: (screen.y - size.h / 2) / view.scale }, -view.rotation);
  return { x: center.x + vector.x, y: center.y + vector.y };
}
function viewWithAnchor(anchor: Point, screen: Point, size: { w: number; h: number },
  scale: number, rotation: number): View {
  const vector = rotateVector({ x: (screen.x - size.w / 2) / scale,
    y: (screen.y - size.h / 2) / scale }, -rotation);
  const center = { x: anchor.x - vector.x, y: anchor.y - vector.y };
  return { x: center.x - size.w / (2 * scale), y: center.y - size.h / (2 * scale), scale, rotation };
}

function fileDownload(blob: Blob, filename: string) {
  if (window.CanvasNative) {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1];
      if (base64) window.CanvasNative?.saveFile(base64, filename, blob.type || "application/octet-stream");
    };
    reader.readAsDataURL(blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function titleFile(title: string) {
  return (title.trim() || "キャンバス").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}
function parseSaved(value: string | null): { content: CanvasDoc; title: string } | null {
  try {
    const parsed = JSON.parse(value || "");
    if (parsed?.content?.version === 1 && Array.isArray(parsed.content.items) &&
      Array.isArray(parsed.content.layers)) return parsed;
  } catch {}
  return null;
}
function readableError(error: unknown) {
  return error instanceof Error ? error.message : "操作に失敗しました";
}
async function responseError(response: Response, fallback: string) {
  const result = await response.json().catch(() => null) as { error?: string } | null;
  return result?.error || fallback;
}

export default function CanvasEditor({ signedIn, signInPath, accountId }: {
  signedIn: boolean; signInPath: string; accountId?: string;
}) {
  const [content, setContent] = useState<CanvasDoc>(starter);
  const contentRef = useRef<CanvasDoc>(starter);
  const [title, setTitle] = useState("無題のキャンバス");
  const titleRef = useRef("無題のキャンバス");
  const [docId, setDocId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [docList, setDocList] = useState<DocMeta[]>([]);
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#172436");
  const [width, setWidth] = useState(3);
  const [eraserSize, setEraserSize] = useState(24);
  const [eraserCursor, setEraserCursor] = useState<Point | null>(null);
  const [fill, setFill] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [nodeEdit, setNodeEdit] = useState(false);
  const [maskMode, setMaskMode] = useState(false);
  const [draft, setDraft] = useState<Item | null>(null);
  const [maskDraft, setMaskDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [status, setStatus] = useState("準備中");
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const [docsOpen, setDocsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const imageUrlsRef = useRef<Record<string, string>>({});
  const [size, setSize] = useState({ w: 900, h: 650 });
  const [view, setView] = useState<View>({ x: -450, y: -325, scale: 1, rotation: 0 });
  const viewRef = useRef<View>(view);
  const [activeLayer, setActiveLayer] = useState("start-layer");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<Activity | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; angle: number; view: View; anchor: Point } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const baseRef = useRef<CanvasDoc>(starter);
  const shareTokenRef = useRef("");
  const ownerRef = useRef(false);
  const canSyncRef = useRef(signedIn);
  const accountIdRef = useRef(accountId || "");
  const currentAccountRef = useRef(accountId || "");
  const localWrites = useRef<Promise<unknown>>(Promise.resolve());
  const remoteListRef = useRef<DocMeta[]>([]);
  const undoRef = useRef<CanvasDoc[]>([]);
  const redoRef = useRef<CanvasDoc[]>([]);
  const [historyCount, setHistoryCount] = useState({ undo: 0, redo: 0 });
  const [initializing, setInitializing] = useState(true);
  const toolActions = useRef({
    status: () => ({ title: titleRef.current, itemCount: contentRef.current.items.length,
      layerCount: contentRef.current.layers.length, grid: contentRef.current.grid,
      sync: idRef.current ? "cloud" : "device" }),
    addNote: (_text: string): string => "",
  });

  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (shareTokenRef.current) headers.set("X-Share-Token", shareTokenRef.current);
    const endpoint = "/canvas/api.php?path=" + encodeURIComponent(path);
    const method = (init.method || "GET").toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
      if (!window.CanvasCsrf) {
        const response = await fetch("/canvas/api.php?path=%2Fapi%2Fsession", {
          credentials: "same-origin", cache: "no-store",
        });
        if (response.ok) window.CanvasCsrf = (await response.json() as { csrfToken: string }).csrfToken;
      }
      if (window.CanvasCsrf) headers.set("X-CSRF-Token", window.CanvasCsrf);
    }
    return fetch(endpoint, { ...init, headers, cache: "no-store", credentials: "same-origin" });
  }
  function setBoth(next: CanvasDoc) {
    contentRef.current = next; setContent(next);
  }
  function setViewBoth(next: View) {
    viewRef.current = next; setView(next);
  }
  function pushUndo(previous: CanvasDoc) {
    undoRef.current = [...undoRef.current.slice(-39), previous];
    redoRef.current = [];
    setHistoryCount({ undo: undoRef.current.length, redo: 0 });
  }
  function localBackup() {
    try {
      localStorage.setItem(idRef.current ? "canvas-recovery-" + idRef.current : "canvas-local-draft",
        JSON.stringify({ title: titleRef.current, content: contentRef.current }));
    } catch {
      setStatus("端末の保存領域が足りません");
    }
  }
  function localSnapshot(): LocalDoc | null {
    if (!idRef.current) return null;
    return { id: idRef.current, title: titleRef.current, content: contentRef.current,
      base: baseRef.current, revision: revisionRef.current, updated_at: Date.now(),
      dirty: dirtyRef.current, owner: ownerRef.current, accountId: accountIdRef.current || undefined,
      shareToken: shareTokenRef.current || undefined };
  }
  function refreshLocalList() {
    void listLocalDocs().then(locals => {
      setCachedIds(new Set(locals.map(doc => doc.id)));
      const merged = new Map((navigator.onLine ? remoteListRef.current : []).map(doc => [doc.id, doc]));
      for (const doc of locals) if (doc.dirty || !merged.has(doc.id)) {
        merged.set(doc.id, { id: doc.id, title: doc.title, revision: doc.revision, updated_at: doc.updated_at });
      }
      setDocList([...merged.values()].sort((a, b) => b.updated_at - a.updated_at));
    }).catch(() => {});
  }
  function persistLocal() {
    const snapshot = localSnapshot();
    if (!snapshot) return localWrites.current;
    localWrites.current = localWrites.current.catch(() => {}).then(() => putLocalDoc(snapshot)).then(() => {
      refreshLocalList();
      if (idRef.current === snapshot.id && dirtyRef.current && !savingRef.current) {
        setStatus(canSyncRef.current ? "端末に保存済み・同期待ち" : "端末に保存済み");
      }
    }).catch(() => {
      localBackup();
      if (idRef.current === snapshot.id) setStatus("端末の保存領域を確認してください");
    });
    return localWrites.current;
  }
  function scheduleSave(delay = 900) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveNow(); }, delay);
  }
  function markDirty() {
    dirtyRef.current = true;
    setStatus("端末に保存中…");
    void persistLocal();
    if (canSyncRef.current) scheduleSave();
  }
  function edit(next: CanvasDoc, history = true) {
    if (history) pushUndo(contentRef.current);
    setBoth(next); markDirty();
  }

  async function readDoc(id: string, conditional = false) {
    const headers: HeadersInit = conditional ? { "If-None-Match": String(revisionRef.current) } : {};
    const response = await api("/api/documents/" + id, { headers });
    if (response.status === 304) return null;
    if (!response.ok) throw new Error(await responseError(response, "作品を開けません"));
    return response.json() as Promise<{
      id: string; title: string; revision: number; content: CanvasDoc; owner: boolean; updated_at: number;
    }>;
  }
  async function uploadLocalImages(contentToSave: CanvasDoc, id: string): Promise<CanvasDoc> {
    const replacements = new Map<string, string>();
    for (const imageId of new Set(contentToSave.items.filter(item => item.kind === "image" &&
      item.imageId?.startsWith("local-")).map(item => item.imageId!))) {
      const blob = await getLocalImage(imageId);
      if (!blob) throw new Error("端末内の画像が見つかりません");
      const data = new FormData();
      data.append("file", blob, "canvas-image");
      const response = await api("/api/documents/" + id + "/images", { method: "POST", body: data });
      if (!response.ok) throw new Error(await responseError(response, "画像を同期できません"));
      const newId = (await response.json() as { imageId: string }).imageId;
      await putLocalImage(newId, blob);
      const url = imageUrlsRef.current[imageId];
      if (url) {
        imageUrlsRef.current[newId] = url;
        setImageUrls(previous => ({ ...previous, [newId]: url }));
      }
      replacements.set(imageId, newId);
    }
    if (!replacements.size) return contentToSave;
    const replace = (doc: CanvasDoc): CanvasDoc => ({ ...doc, items: doc.items.map(item =>
      item.imageId && replacements.has(item.imageId) ?
        { ...item, imageId: replacements.get(item.imageId) } : item) });
    const result = replace(contentToSave);
    if (idRef.current === id) {
      if (contentRef.current === contentToSave) setBoth(result);
      else { setBoth(replace(contentRef.current)); dirtyRef.current = true; }
      void persistLocal();
    }
    return result;
  }
  async function saveNow() {
    if (!dirtyRef.current) return;
    if (savingRef.current) return;
    if (!canSyncRef.current) { await persistLocal(); return; }
    if (accountIdRef.current && accountIdRef.current !== currentAccountRef.current) {
      setStatus("別のアカウントの作品・端末に保存済み");
      return;
    }
    savingRef.current = true;
    let id = idRef.current;
    if (!id) { savingRef.current = false; return; }
    const original = contentRef.current;
    const sentTitle = titleRef.current;
    setStatus("同期中…");
    try {
      if (id.startsWith("local-")) {
        const response = await api("/api/documents", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: original, title: sentTitle }),
        });
        if (!response.ok) throw new Error(await responseError(response, "同期を開始できません"));
        const created = await response.json() as { id: string; revision: number };
        if (idRef.current !== id) return;
        const oldId = id;
        id = created.id;
        idRef.current = id; setDocId(id); setOwner(true); ownerRef.current = true;
        accountIdRef.current = currentAccountRef.current;
        revisionRef.current = created.revision; baseRef.current = original;
        const url = new URL(location.href); url.searchParams.set("d", id);
        history.replaceState(null, "", url);
        await persistLocal();
        await localWrites.current;
        await deleteLocalDoc(oldId);
        refreshLocalList();
      }
      const sentRevision = revisionRef.current;
      const sent = await uploadLocalImages(original, id);
      if (idRef.current !== id) return;
      dirtyRef.current = false;
      const response = await api("/api/documents/" + id, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: sentRevision, title: sentTitle, content: sent }),
      });
      if (idRef.current !== id) return;
      if (response.status === 409) {
        const remote = await readDoc(id);
        if (!remote) throw new Error("同期に失敗しました");
        const merged = mergeDocs(baseRef.current, contentRef.current, remote.content);
        baseRef.current = remote.content;
        revisionRef.current = remote.revision;
        setBoth(merged);
        dirtyRef.current = true;
        setStatus("変更を統合中…");
        void persistLocal();
      } else if (!response.ok) {
        throw new Error(await responseError(response, "保存に失敗しました"));
      } else {
        const saved = await response.json() as { revision: number };
        revisionRef.current = saved.revision;
        baseRef.current = sent;
        if (sent !== contentRef.current || sentTitle !== titleRef.current) dirtyRef.current = true;
        else { setStatus("同期済み・端末に保存済み"); localStorage.removeItem("canvas-recovery-" + id); }
        void persistLocal();
      }
    } catch (error) {
      dirtyRef.current = true;
      void persistLocal();
      setStatus("端末に保存済み・同期待ち");
      if (navigator.onLine) setMessage(readableError(error));
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && idRef.current === id && navigator.onLine) scheduleSave(3500);
    }
  }
  function acceptDoc(record: { id: string; title: string; revision: number; content: CanvasDoc;
    owner?: boolean; base?: CanvasDoc; dirty?: boolean; shareToken?: string; accountId?: string }) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const inviteToken = record.owner ? "" : record.shareToken ||
      (new URLSearchParams(location.search).get("d") === record.id ? shareTokenRef.current : "");
    idRef.current = record.id; setDocId(record.id);
    setTitle(record.title); titleRef.current = record.title;
    revisionRef.current = record.revision;
    baseRef.current = record.base || record.content;
    setBoth(record.content);
    dirtyRef.current = !!record.dirty; undoRef.current = []; redoRef.current = [];
    shareTokenRef.current = inviteToken;
    accountIdRef.current = record.accountId || (record.owner ? currentAccountRef.current : "");
    canSyncRef.current = !!(signedIn || currentAccountRef.current || inviteToken);
    setHistoryCount({ undo: 0, redo: 0 });
    setActiveLayer(record.content.layers[record.content.layers.length - 1]?.id || "start-layer");
    setSelected(null); setStatus(record.dirty ?
      canSyncRef.current && navigator.onLine ? "端末に保存済み・同期待ち" : "端末に保存済み" :
      !navigator.onLine || record.id.startsWith("local-") ? "端末に保存済み" : "同期済み・端末に保存済み");
    setOwner(!!record.owner); ownerRef.current = !!record.owner;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("d", record.id);
    history.replaceState(null, "", nextUrl);
    void persistLocal();
    if (record.dirty && canSyncRef.current) scheduleSave(350);
  }
  async function refreshList() {
    try {
      const response = await api("/api/documents");
      if (response.ok) {
        const result = await response.json() as { documents: DocMeta[]; accountId?: string };
        remoteListRef.current = result.documents;
        currentAccountRef.current = result.accountId || "";
        canSyncRef.current = true;
      } else if (response.status === 401) {
        currentAccountRef.current = "";
        canSyncRef.current = !!shareTokenRef.current;
      }
    } catch { /* Show the documents cached on this device. */ }
    refreshLocalList();
    const locals = await listLocalDocs().catch(() => [] as LocalDoc[]);
    return [...locals, ...(navigator.onLine ? remoteListRef.current : [])
      .filter(remote => !locals.some(local => local.id === remote.id))]
      .sort((a, b) => b.updated_at - a.updated_at);
  }
  async function openDocument(id: string) {
    await localWrites.current;
    const previousId = idRef.current;
    const cached = await getLocalDoc(id).catch(() => undefined);
    if (cached) { acceptDoc(cached); setDocsOpen(false); }
    try {
      const record = await readDoc(id);
      if (record && (cached ? idRef.current === id && !dirtyRef.current : idRef.current === previousId)) {
        acceptDoc(record);
      }
      setDocsOpen(false);
    } catch (error) { if (!cached) setMessage(readableError(error)); }
  }
  async function createDocument(data: CanvasDoc = blankDoc(), name = "無題のキャンバス") {
    await localWrites.current;
    const record: LocalDoc = { id: "local-" + uid(), title: name, content: data, base: data,
      revision: 0, updated_at: Date.now(), dirty: true, owner: true,
      accountId: currentAccountRef.current || undefined };
    await putLocalDoc(record);
    acceptDoc(record); setDocsOpen(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function start() {
      const query = new URLSearchParams(location.search);
      const target = query.get("d");
      const match = /^#s=([0-9a-f]{64})$/.exec(location.hash);
      if (match) shareTokenRef.current = match[1];
      try {
        // Import drafts from releases that saved only a single localStorage entry.
        const oldDraft = parseSaved(localStorage.getItem("canvas-local-draft"));
        if (oldDraft) {
          await putLocalDoc({ id: "local-" + uid(), title: oldDraft.title, content: oldDraft.content,
            base: oldDraft.content, revision: 0, updated_at: Date.now(), dirty: true, owner: true });
          localStorage.removeItem("canvas-local-draft");
        }
        const keys = Object.keys(localStorage).filter(key => key.startsWith("canvas-recovery-"));
        for (const key of keys) {
          const recovery = parseSaved(localStorage.getItem(key));
          if (!recovery) continue;
          const id = key.slice("canvas-recovery-".length);
          const existing = await getLocalDoc(id);
          await putLocalDoc({ id, title: recovery.title, content: recovery.content,
            base: existing?.base || recovery.content, revision: existing?.revision || 0,
            updated_at: Date.now(), dirty: true, owner: existing?.owner ?? true,
            accountId: existing?.accountId, shareToken: existing?.shareToken });
          localStorage.removeItem(key);
        }
        const locals = await listLocalDocs();
        const cached = target ? locals.find(doc => doc.id === target) :
          [...locals].sort((a, b) => b.updated_at - a.updated_at)[0];
        if (cached && !cancelled) {
          acceptDoc(cached);
          setInitializing(false);
        }
        refreshLocalList();
        if (target) {
          const record = await readDoc(target).catch(() => null);
          if (cancelled) return;
          if (record && (!cached || !dirtyRef.current) && idRef.current === (cached?.id || null) &&
            record.revision >= revisionRef.current) {
            acceptDoc(record);
          }
          if (record || cached) { setInitializing(false); return; }
        }
        if (signedIn && !cached) {
          const list = await refreshList();
          if (cancelled) return;
          if (list.length) await openDocument(list[0].id);
          else await createDocument();
        } else if (!cached) {
          await createDocument();
        } else if (signedIn) {
          void refreshList();
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(readableError(error));
          if (!idRef.current) setStatus("端末の保存領域を確認してください");
        }
      }
      if (!cancelled) setInitializing(false);
    }
    void start();
    return () => { cancelled = true; };
    // Initial authentication and invite URL determine the first document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    if (!docId || docId.startsWith("local-")) return;
    const timer = setInterval(async () => {
      if (dirtyRef.current || savingRef.current || activeRef.current || idRef.current !== docId) return;
      try {
        const remote = await readDoc(docId, true);
        if (!remote || idRef.current !== docId) return;
        revisionRef.current = remote.revision; baseRef.current = remote.content;
        setBoth(remote.content); setTitle(remote.title); titleRef.current = remote.title;
        setStatus("同期済み・端末に保存済み");
        void persistLocal();
      } catch { /* The next poll retries. */ }
    }, 2400);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      const w = Math.max(rect.width, 1), h = Math.max(rect.height, 1);
      setSize({ w, h });
      const previous = viewRef.current;
      setViewBoth({
        ...previous, x: previous.x - (w - (canvasRef.current?.dataset.lastW ? Number(canvasRef.current.dataset.lastW) : 900)) / (2 * previous.scale),
        y: previous.y - (h - (canvasRef.current?.dataset.lastH ? Number(canvasRef.current.dataset.lastH) : 650)) / (2 * previous.scale),
      });
      if (canvasRef.current) { canvasRef.current.dataset.lastW = String(w); canvasRef.current.dataset.lastH = String(h); }
    });
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/canvas/sw.js", { scope: "/canvas/" }).catch(() => {});
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);
  useEffect(() => {
    const reconnect = () => {
      setOnline(true);
      void refreshList().then(() => { if (canSyncRef.current && dirtyRef.current) scheduleSave(100); });
    };
    const disconnected = () => {
      setOnline(false);
      if (idRef.current && !dirtyRef.current) setStatus("端末に保存済み");
      refreshLocalList();
    };
    setOnline(navigator.onLine);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", disconnected);
    const timer = setInterval(() => {
      if (navigator.onLine && (!canSyncRef.current || dirtyRef.current)) reconnect();
    }, 15000);
    return () => {
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", disconnected);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!document.modelContext?.registerTool) return;
    const controller = new AbortController();
    const register = (tool: ModelTool) => {
      try { void Promise.resolve(document.modelContext!.registerTool(tool, { signal: controller.signal })).catch(() => {}); }
      catch { /* The editor works in browsers without WebMCP. */ }
    };
    register({
      name: "read_canvas_status", title: "キャンバスの状態を見る",
      description: "現在開いているキャンバスの名前、要素数、レイヤー数、グリッドと保存先を読む。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => toolActions.current.status(),
    });
    register({
      name: "add_canvas_note", title: "キャンバスにメモを追加",
      description: "表示中のキャンバスの中央に編集可能なベクターメモを一つ追加する。",
      inputSchema: {
        type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 2000 } },
        required: ["text"], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: input => {
        if (!input || typeof input !== "object" || !("text" in input) ||
            typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000) {
          throw new Error("メモは1～2000文字で入力してください");
        }
        return { itemId: toolActions.current.addNote(input.text) };
      },
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const missing = [...new Set(content.items.filter(item => item.kind === "image" && item.imageId).map(item => item.imageId!))]
      .filter(id => !imageUrlsRef.current[id]);
    let cancelled = false;
    for (const imageId of missing) {
      if (imageId.startsWith("data:")) {
        imageUrlsRef.current[imageId] = imageId;
        setImageUrls(previous => ({ ...previous, [imageId]: imageId }));
      } else {
        void getLocalImage(imageId).then(async cached => {
          if (cached) return cached;
          if (!idRef.current || idRef.current.startsWith("local-")) return null;
          const response = await api("/api/documents/" + idRef.current + "/images/" + imageId);
          if (!response.ok) return null;
          const blob = await response.blob();
          await putLocalImage(imageId, blob).catch(() => {});
          return blob;
        })
          .then(blob => {
            if (cancelled || !blob) return;
            const url = URL.createObjectURL(blob);
            imageUrlsRef.current[imageId] = url;
            setImageUrls(previous => ({ ...previous, [imageId]: url }));
          }).catch(() => {});
      }
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.items, docId]);

  const chosen = content.items.find(item => item.id === selected);
  const chosenLayer = content.layers.find(layer => layer.id === activeLayer);
  const drawable = !!chosenLayer && chosenLayer.visible && !chosenLayer.locked;
  const ordered = useMemo(() => content.layers.filter(layer => layer.visible)
    .flatMap(layer => content.items.filter(item => item.layerId === layer.id)), [content]);
  const selectedEditable = !!chosen && !!content.layers.find(layer =>
    layer.id === chosen.layerId && layer.visible && !layer.locked);

  function pointAt(event: PointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewRef.current, size);
  }
  function maybeSnap(point: Point) {
    return contentRef.current.snap && contentRef.current.grid !== "none"
      ? snapPoint(point, contentRef.current.grid) : point;
  }
  function maybeSnapInk(point: Point) {
    return contentRef.current.snap && contentRef.current.grid !== "none"
      ? snapInkPoint(point, contentRef.current.grid) : point;
  }
  function makeShape(kind: Tool, start: Point, end: Point, points?: Point[]): Item {
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.max(1, Math.abs(end.x - start.x)), h = Math.max(1, Math.abs(end.y - start.y));
    return {
      id: uid(),
      kind: kind === "pen" || kind === "marker" ? "path" : kind as Item["kind"],
      layerId: activeLayer, x: kind === "line" ? start.x : x,
      y: kind === "line" ? start.y : y,
      w: kind === "line" ? end.x - start.x : w,
      h: kind === "line" ? end.y - start.y : h,
      points: kind === "pen" || kind === "marker" ? points : undefined,
      color, width: kind === "marker" ? Math.max(width * 4, 12) : width,
      opacity: kind === "marker" ? 0.35 : 1,
      fill: kind === "box" ? "#f7f9fc" : fill ? color : "none",
      depth: kind === "box" ? 36 : undefined,
    };
  }
  function addNote(value: string, position?: Point) {
    const layer = contentRef.current.layers.find(entry => entry.id === activeLayer);
    if (!layer?.visible || layer.locked) throw new Error("描画できるレイヤーを選んでください");
    const point = position ?? {
      x: viewRef.current.x + size.w / viewRef.current.scale / 2,
      y: viewRef.current.y + size.h / viewRef.current.scale / 2,
    };
    const p = maybeSnap(point);
    const valueText = value.slice(0, 2000);
    const item: Item = {
      id: uid(), kind: "text", layerId: activeLayer,
      x: p.x, y: p.y, w: Math.max(120, Math.max(...valueText.split("\n").map(line => line.length)) * 18),
      h: Math.max(28, valueText.split("\n").length * 26),
      color, fill: "none", width: 1, text: valueText,
    };
    edit({ ...contentRef.current, items: [...contentRef.current.items, item] });
    setSelected(item.id); setTool("select");
    return item.id;
  }
  toolActions.current.addNote = value => addNote(value);
  function replaceSelected(next: Item) {
    edit({ ...contentRef.current, items: contentRef.current.items.map(item => item.id === next.id ? next : item) });
  }
  function changeTransform(scaleMultiplier = 1, degrees = 0) {
    if (!chosen || !selectedEditable) return;
    replaceSelected({ ...chosen, origin: transformCenter(chosen),
      scale: Math.max(0.1, Math.min(10, (chosen.scale ?? 1) * scaleMultiplier)),
      rotation: (chosen.rotation ?? 0) + degrees });
  }
  function eraseAlong(from: Point, to: Point): boolean {
    const visible = new Set(contentRef.current.layers.filter(layer => layer.visible && !layer.locked).map(layer => layer.id));
    let changed = false;
    const items = contentRef.current.items.flatMap(item => {
      if (!visible.has(item.layerId)) return [item];
      const fragments = eraseStroke(item, from, to, eraserSize / (2 * viewRef.current.scale));
      if (fragments.length !== 1 || fragments[0] !== item) changed = true;
      return fragments;
    });
    if (changed) {
      setBoth({ ...contentRef.current, items });
      if (selected && !items.some(item => item.id === selected)) setSelected(null);
    }
    return changed;
  }
  function removeSelected() {
    if (!chosen) return;
    edit({ ...contentRef.current, items: contentRef.current.items.filter(item => item.id !== chosen.id) });
    setSelected(null); setNodeEdit(false);
  }
  function undo() {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(contentRef.current);
    setBoth(previous); setHistoryCount({ undo: undoRef.current.length, redo: redoRef.current.length });
    markDirty();
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(contentRef.current);
    setBoth(next); setHistoryCount({ undo: undoRef.current.length, redo: redoRef.current.length });
    markDirty();
  }
  function zoom(factor: number, screen = { x: size.w / 2, y: size.h / 2 }) {
    const current = viewRef.current;
    const nextScale = Math.max(0.12, Math.min(8, current.scale * factor));
    setViewBoth(viewWithAnchor(screenToWorld(screen, current, size), screen,
      size, nextScale, current.rotation));
  }
  function rotateCanvas(degrees: number) {
    const current = viewRef.current;
    setViewBoth(viewWithAnchor(viewCenter(current, size), { x: size.w / 2, y: size.h / 2 },
      size, current.scale, current.rotation + degrees));
  }
  function onWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoom(Math.exp(-event.deltaY * 0.001), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }
  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    (event.currentTarget.closest(".studio") as HTMLElement | null)?.focus();
    if (event.pointerType === "touch" && [...pointersRef.current.keys()].some(id => id !== event.pointerId && activeRef.current?.type === "draw")) {
      activeRef.current = null; setDraft(null);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    pointersRef.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (pointersRef.current.size === 2) {
      const pending = activeRef.current;
      if (pending?.type === "erase" && pending.changed) { pushUndo(pending.original); markDirty(); }
      if ((pending?.type === "drag" || pending?.type === "transform") && pending.moved) {
        pushUndo(pending.original); markDirty();
      }
      activeRef.current = null; setDraft(null);
      setEraserCursor(null);
      const [a, b] = [...pointersRef.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const current = viewRef.current;
      pinchRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        view: { ...current },
        anchor: screenToWorld(mid, current, size),
      };
      return;
    }
    if (event.pointerType === "touch" && [...pointersRef.current.keys()].length > 2) return;
    const raw = pointAt(event);
    const target = event.target as Element;
    const itemId = target.closest("[data-item-id]")?.getAttribute("data-item-id");
    const transformHandle = target.getAttribute("data-transform-handle");
    const nodeAttribute = target.getAttribute("data-node-index");
    const node = nodeAttribute == null ? undefined : Number(nodeAttribute);
    if (spaceHeld || tool === "hand" || event.button === 1) {
      activeRef.current = { type: "pan", startX: event.clientX, startY: event.clientY, view: { ...viewRef.current } };
      return;
    }
    if (maskMode && selected) { activeRef.current = { type: "mask", start: maybeSnap(raw) }; return; }
    if (tool === "select") {
      if (selectedEditable && chosen && itemId === selected &&
          (transformHandle === "scale" || transformHandle === "rotate")) {
        activeRef.current = { type: "transform", mode: transformHandle, start: raw,
          center: transformCenter(chosen), original: contentRef.current, itemId: chosen.id, moved: false };
        return;
      }
      if (itemId) {
        const item = contentRef.current.items.find(entry => entry.id === itemId);
        const layer = contentRef.current.layers.find(entry => entry.id === item?.layerId);
        if (item && layer?.visible && !layer.locked) {
          setSelected(itemId); setActiveLayer(item.layerId);
          activeRef.current = { type: "drag", start: raw, original: contentRef.current, itemId, node, moved: false };
          return;
        }
      }
      setSelected(null); setNodeEdit(false); return;
    }
    if (tool === "eraser") {
      setEraserCursor(raw);
      const original = contentRef.current;
      const changed = eraseAlong(raw, raw);
      activeRef.current = { type: "erase", last: raw, original, changed };
      return;
    }
    if (tool === "delete") {
      const item = contentRef.current.items.find(entry => entry.id === itemId);
      const layer = contentRef.current.layers.find(entry => entry.id === item?.layerId);
      if (item && layer?.visible && !layer.locked) {
        edit({ ...contentRef.current, items: contentRef.current.items.filter(entry => entry.id !== itemId) });
        if (selected === itemId) setSelected(null);
      }
      return;
    }
    if (!drawable) { setMessage("表示中でロックされていないレイヤーを選択してください"); return; }
    if (tool === "text") {
      const value = window.prompt("メモを入力", "");
      if (value?.trim()) {
        try { addNote(value, raw); } catch (error) { setMessage(readableError(error)); }
      }
      return;
    }
    const start = tool === "pen" || tool === "marker" ? maybeSnapInk(raw) : maybeSnap(raw);
    activeRef.current = { type: "draw", tool, start, points: [{ ...start, p: event.pressure || 0.5 }] };
    setDraft(makeShape(tool, start, start, [{ ...start, p: event.pressure || 0.5 }]));
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointersRef.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const pinch = pinchRef.current;
      const scale = Math.max(0.12, Math.min(8,
        pinch.view.scale * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.distance)));
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      let delta = angle - pinch.angle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      setViewBoth(viewWithAnchor(pinch.anchor, mid, size, scale,
        pinch.view.rotation + delta * 180 / Math.PI));
      return;
    }
    const activity = activeRef.current;
    if (tool === "eraser" && pointersRef.current.size === 1) setEraserCursor(pointAt(event));
    if (!activity) return;
    if (activity.type === "pan") {
      const offset = rotateVector({ x: (event.clientX - activity.startX) / activity.view.scale,
        y: (event.clientY - activity.startY) / activity.view.scale }, -activity.view.rotation);
      setViewBoth({
        ...activity.view,
        x: activity.view.x - offset.x,
        y: activity.view.y - offset.y,
      });
      return;
    }
    const raw = pointAt(event);
    if (activity.type === "erase") {
      if (eraseAlong(activity.last, raw)) activity.changed = true;
      activity.last = raw;
      return;
    }
    if (activity.type === "transform") {
      const item = activity.original.items.find(entry => entry.id === activity.itemId);
      if (!item) return;
      const center = activity.center;
      let transformed: Item;
      if (activity.mode === "scale") {
        const startDistance = Math.max(1, Math.hypot(activity.start.x - center.x, activity.start.y - center.y));
        const currentDistance = Math.hypot(raw.x - center.x, raw.y - center.y);
        transformed = { ...item, origin: center,
          scale: Math.max(0.1, Math.min(10, (item.scale ?? 1) * currentDistance / startDistance)) };
      } else {
        const before = Math.atan2(activity.start.y - center.y, activity.start.x - center.x);
        const after = Math.atan2(raw.y - center.y, raw.x - center.x);
        transformed = { ...item, origin: center, rotation: (item.rotation ?? 0) + (after - before) * 180 / Math.PI };
      }
      activity.moved = true;
      setBoth({ ...activity.original, items: activity.original.items.map(entry =>
        entry.id === item.id ? transformed : entry) });
      return;
    }
    if (activity.type === "mask") {
      const end = maybeSnap(raw);
      setMaskDraft({ x: Math.min(end.x, activity.start.x), y: Math.min(end.y, activity.start.y),
        w: Math.abs(end.x - activity.start.x), h: Math.abs(end.y - activity.start.y) });
      return;
    }
    if (activity.type === "drag") {
      const dx = raw.x - activity.start.x, dy = raw.y - activity.start.y;
      if (Math.hypot(dx, dy) < 0.4 / viewRef.current.scale) return;
      activity.moved = true;
      const items = activity.original.items.map(item => {
        if (item.id !== activity.itemId) return item;
        if (activity.node != null && item.points?.[activity.node]) {
          const points = item.points.map((p, index) => index === activity.node ?
            inverseTransformPoint(item, maybeSnap(raw)) : p);
          return { ...item, points };
        }
        return moved(item, dx, dy);
      });
      setBoth({ ...activity.original, items });
      return;
    }
    const end = activity.tool === "pen" || activity.tool === "marker" ? maybeSnapInk(raw) : maybeSnap(raw);
    if (activity.tool === "pen" || activity.tool === "marker") {
      const last = activity.points[activity.points.length - 1];
      if (Math.hypot(last.x - end.x, last.y - end.y) < 0.65 / viewRef.current.scale) return;
      activity.points.push({ ...end, p: event.pressure || 0.5 });
    }
    setDraft(makeShape(activity.tool, activity.start, end, activity.points));
  }
  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId);
    if (tool === "eraser") setEraserCursor(null);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const activity = activeRef.current;
    if (!activity || pointersRef.current.size > 0) return;
    activeRef.current = null;
    if (activity.type === "erase") {
      if (eraseAlong(activity.last, pointAt(event))) activity.changed = true;
      if (activity.changed) { pushUndo(activity.original); markDirty(); }
      return;
    }
    if (activity.type === "drag" || activity.type === "transform") {
      if (activity.moved) { pushUndo(activity.original); markDirty(); }
      return;
    }
    if (activity.type === "mask") {
      if (selected && maskDraft && maskDraft.w > 2 && maskDraft.h > 2) {
        const item = contentRef.current.items.find(entry => entry.id === selected);
        if (item) replaceSelected({ ...item, clip: maskDraft });
      }
      setMaskDraft(null); setMaskMode(false); return;
    }
    if (activity.type !== "draw") return;
    const raw = pointAt(event);
    const end = activity.tool === "pen" || activity.tool === "marker" ? maybeSnapInk(raw) : maybeSnap(raw);
    let points = activity.points;
    if (activity.tool === "pen" || activity.tool === "marker") {
      if (points.length === 1) points = [points[0], { x: points[0].x + 0.2, y: points[0].y + 0.2 }];
    } else if (Math.hypot(end.x - activity.start.x, end.y - activity.start.y) < 2) {
      setDraft(null); return;
    }
    const item = makeShape(activity.tool, activity.start, end, points);
    edit({ ...contentRef.current, items: [...contentRef.current.items, item] });
    setDraft(null);
  }

  async function addImage(file: File) {
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setMessage("PNG・JPEG・WebP・GIFを選んでください"); return;
    }
    if (file.size > 10_000_000) { setMessage("画像は10MB以下にしてください"); return; }
    const temp = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = temp;
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("画像を読めません")); });
      const imageId = "local-" + uid();
      await putLocalImage(imageId, file);
      const url = URL.createObjectURL(file);
      imageUrlsRef.current[imageId] = url;
      setImageUrls(previous => ({ ...previous, [imageId]: url }));
      const scale = Math.min(1, 480 / img.width, 360 / img.height);
      const w = img.width * scale, h = img.height * scale;
      const center = viewRef.current;
      const item: Item = {
        id: uid(), kind: "image", layerId: activeLayer,
        x: center.x + size.w / center.scale / 2 - w / 2,
        y: center.y + size.h / center.scale / 2 - h / 2,
        w, h, imageId, color: "#172436", width: 1,
      };
      edit({ ...contentRef.current, items: [...contentRef.current.items, item] });
      setSelected(item.id); setTool("select");
    } catch (error) { setMessage(readableError(error)); }
    finally { URL.revokeObjectURL(temp); }
  }
  function onImageInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void addImage(file);
    event.target.value = "";
  }
  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find(item => item.type.startsWith("image/"));
    if (file) void addImage(file);
  }
  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const file = [...event.clipboardData.items].find(item => item.type.startsWith("image/"))?.getAsFile();
    if (file) { event.preventDefault(); void addImage(file); return; }
    const text = event.clipboardData.getData("text/plain");
    if (text.startsWith("CANVAS_VECTOR:")) {
      try {
        const copied = JSON.parse(text.slice(14)) as Item[];
        const items = copied.map(item => ({ ...moved(item, 24, 24), id: uid(), layerId: activeLayer }));
        edit({ ...contentRef.current, items: [...contentRef.current.items, ...items] });
        setSelected(items[0]?.id ?? null);
        event.preventDefault();
      } catch {}
    }
  }
  function onCopy(event: React.ClipboardEvent<HTMLDivElement>) {
    if (!chosen) return;
    event.clipboardData.setData("text/plain", "CANVAS_VECTOR:" + JSON.stringify([chosen]));
    event.preventDefault();
  }
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable]")) return;
      if (event.code === "Space") { event.preventDefault(); setSpaceHeld(true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); if (event.shiftKey) redo(); else undo(); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); redo(); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); void persistLocal().then(() => saveNow()); return;
      }
      if (event.key === "Delete" || event.key === "Backspace") { if (selected) { event.preventDefault(); removeSelected(); } return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const shortcuts: Record<string, Tool> = {
        v: "select", h: "hand", p: "pen", m: "marker", e: "eraser", d: "delete",
        l: "line", r: "rect", o: "ellipse", b: "box", t: "text",
      };
      if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") setSpaceHeld(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, content]);

  function updateLayer(id: string, changes: Partial<CanvasDoc["layers"][number]>) {
    edit({ ...contentRef.current, layers: contentRef.current.layers.map(layer => layer.id === id ? { ...layer, ...changes } : layer) });
  }
  function addLayer() {
    const next = { id: uid(), name: "レイヤー " + (content.layers.length + 1), visible: true, locked: false };
    edit({ ...contentRef.current, layers: [...contentRef.current.layers, next] });
    setActiveLayer(next.id);
  }
  function reorderLayer(id: string, direction: number) {
    const layers = [...contentRef.current.layers];
    const index = layers.findIndex(layer => layer.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= layers.length) return;
    [layers[index], layers[next]] = [layers[next], layers[index]];
    edit({ ...contentRef.current, layers });
  }
  function moveSelectedToLayer(layerId: string) {
    if (!chosen || chosen.layerId === layerId) return;
    const layer = contentRef.current.layers.find(entry => entry.id === layerId);
    if (!layer || layer.locked || !layer.visible) return;
    replaceSelected({ ...chosen, layerId });
    setActiveLayer(layerId);
  }
  function splitSelected() {
    if (!chosen || !["rect", "ellipse", "box"].includes(chosen.kind)) return;
    const pieces = breakApart(chosen);
    edit({ ...contentRef.current, items: contentRef.current.items.flatMap(item => item.id === chosen.id ? pieces : [item]) });
    setSelected(pieces[0].id); setNodeEdit(true);
  }
  async function generateShare() {
    if (!docId || !owner) return;
    try {
      const response = await api("/api/documents/" + docId + "/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      if (!response.ok) throw new Error("共有リンクを作れません");
      const token = (await response.json() as { token: string }).token;
      const link = location.origin + "/canvas/?d=" + docId + "#s=" + token;
      setShareLink(link); setShareOpen(true);
      try { await navigator.clipboard.writeText(link); setMessage("共同編集リンクをコピーしました"); }
      catch { setMessage("リンクを選択してコピーしてください"); }
    } catch (error) { setMessage(readableError(error)); }
  }
  async function revokeShare() {
    if (!docId || !owner) return;
    await api("/api/documents/" + docId + "/share", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke" }),
    });
    setShareLink(""); setShareOpen(false); setMessage("共有を停止しました");
  }
  async function deleteDocument() {
    if (!docId || !owner || !window.confirm("この作品を削除しますか？ 元に戻せません。")) return;
    if (!docId.startsWith("local-")) {
      try {
        const response = await api("/api/documents/" + docId, { method: "DELETE" });
        if (!response.ok) throw new Error("削除できませんでした");
      } catch (error) { setMessage(readableError(error)); return; }
    }
    await localWrites.current;
    await deleteLocalDoc(docId);
    remoteListRef.current = remoteListRef.current.filter(doc => doc.id !== docId);
    dirtyRef.current = false; idRef.current = null; setDocId(null);
    const list = await refreshList();
    if (list.length) await openDocument(list[0].id);
    else await createDocument();
  }
  async function importDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      let next = parsed.content ?? parsed;
      if (next.version !== 1 || !Array.isArray(next.items) || !Array.isArray(next.layers) || next.items.length > 20000) {
        throw new Error("対応していない作品形式です");
      }
      // Portable JSON embeds images. Move them into the local image store so
      // the document stays small enough to sync and can be edited offline.
      const images = new Map<string, string>();
      for (const item of next.items as Item[]) {
        if (!item.imageId?.startsWith("data:") || images.has(item.imageId)) continue;
        const blob = await fetch(item.imageId).then(response => response.blob());
        if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(blob.type) ||
          blob.size > 10_000_000) throw new Error("画像は10MB以下のPNG・JPEG・WebP・GIFにしてください");
        const id = "local-" + uid();
        await putLocalImage(id, blob);
        images.set(item.imageId, id);
      }
      if (images.size) next = { ...next, items: (next.items as Item[]).map(item =>
        item.imageId && images.has(item.imageId) ? { ...item, imageId: images.get(item.imageId) } : item) };
      await createDocument(next, parsed.title || file.name.replace(/\.json$/, ""));
    } catch (error) { setMessage(readableError(error)); }
  }
  async function exportJson() {
    try {
      const snapshot = contentRef.current;
      const imageData = new Map<string, string>();
      for (const imageId of new Set(snapshot.items.filter(item => item.kind === "image" && item.imageId)
        .map(item => item.imageId!))) {
        if (imageId.startsWith("data:")) continue;
        let blob = await getLocalImage(imageId);
        if (!blob && idRef.current && !idRef.current.startsWith("local-")) {
          const response = await api("/api/documents/" + idRef.current + "/images/" + imageId);
          if (response.ok) blob = await response.blob();
        }
        if (!blob) throw new Error("画像が端末にありません。接続後にもう一度保存してください");
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        imageData.set(imageId, encoded);
      }
      const portable: CanvasDoc = { ...snapshot, items: snapshot.items.map(item =>
        item.imageId && imageData.has(item.imageId) ? { ...item, imageId: imageData.get(item.imageId) } : item) };
      fileDownload(new Blob([JSON.stringify({ title: titleRef.current, content: portable }, null, 2)],
        { type: "application/json" }), titleFile(title) + ".json");
    } catch (error) { setMessage(readableError(error)); }
  }
  async function serializedSvg() {
    if (!svgRef.current) throw new Error("書き出せません");
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll("[data-export-ignore]").forEach(node => node.remove());
    clone.querySelector("[data-scene]")?.removeAttribute("transform");
    const visible = ordered;
    const rectangles = visible.map(bounds);
    const minX = rectangles.length ? Math.min(...rectangles.map(b => b.x)) - 32 : -320;
    const minY = rectangles.length ? Math.min(...rectangles.map(b => b.y)) - 32 : -200;
    const maxX = rectangles.length ? Math.max(...rectangles.map(b => b.x + b.w)) + 32 : 320;
    const maxY = rectangles.length ? Math.max(...rectangles.map(b => b.y + b.h)) + 32 : 200;
    const w = Math.max(640, maxX - minX), h = Math.max(400, maxY - minY);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", minX + " " + minY + " " + w + " " + h);
    clone.setAttribute("width", String(w)); clone.setAttribute("height", String(h));
    for (const img of clone.querySelectorAll("image[data-image-id]")) {
      const imageId = img.getAttribute("data-image-id") || "";
      const url = imageUrlsRef.current[imageId];
      if (!url) continue;
      const blob = await fetch(url).then(response => response.blob());
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      img.setAttribute("href", encoded);
    }
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", String(minX)); bg.setAttribute("y", String(minY));
    bg.setAttribute("width", String(w)); bg.setAttribute("height", String(h)); bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);
    return { svg: new XMLSerializer().serializeToString(clone), w, h };
  }
  async function exportVector() {
    try {
      const { svg } = await serializedSvg();
      fileDownload(new Blob([svg], { type: "image/svg+xml" }), titleFile(title) + ".svg");
    } catch (error) { setMessage(readableError(error)); }
  }
  async function exportPng() {
    try {
      const { svg, w, h } = await serializedSvg();
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = new Image();
      img.src = url;
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("画像に変換できません")); });
      const canvas = document.createElement("canvas");
      const scale = Math.min(2, 8000 / Math.max(w, h));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("画像に変換できません");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("画像に変換できません");
      fileDownload(blob, titleFile(title) + ".png");
    } catch (error) { setMessage(readableError(error)); }
  }

  function renderItem(item: Item, preview = false) {
    const stroke = item.color;
    const common = { stroke, strokeWidth: item.width, opacity: item.opacity ?? 1,
      strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    const x = item.x, y = item.y, w = item.w, h = item.h;
    const shape = (() => {
      switch (item.kind) {
        case "path": return <path d={pathData(item.points || [])} fill="none" {...common} />;
        case "line": return <line x1={x} y1={y} x2={x + w} y2={y + h} {...common} />;
        case "rect": return <rect x={x} y={y} width={w} height={h} fill={item.fill && item.fill !== "none" ? item.fill : "transparent"} {...common} />;
        case "ellipse": return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={item.fill && item.fill !== "none" ? item.fill : "transparent"} {...common} />;
        case "polygon": return <polygon points={(item.points || []).map(p => p.x + "," + p.y).join(" ")} fill={item.fill && item.fill !== "none" ? item.fill : "transparent"} {...common} />;
        case "box": {
          const d = item.depth ?? 36;
          return <g {...common}>
            <polygon points={[[x,y],[x+d,y-d],[x+w+d,y-d],[x+w,y]].map(p=>p.join(",")).join(" ")} fill="#e4eaf4" />
            <polygon points={[[x+w,y],[x+w+d,y-d],[x+w+d,y+h-d],[x+w,y+h]].map(p=>p.join(",")).join(" ")} fill="#c1cee2" />
            <polygon points={[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>p.join(",")).join(" ")} fill={item.fill || "#f7f9fc"} />
          </g>;
        }
        case "text": return <text x={x} y={y + 21} fill={stroke} fontSize="20" fontFamily="system-ui, sans-serif"
          stroke="none" opacity={item.opacity ?? 1} style={{ whiteSpace: "pre" }}>{(item.text || "").split("\n").map((line, i) =>
            <tspan key={i} x={x} dy={i ? 26 : 0}>{line || " "}</tspan>)}</text>;
        case "image": return imageUrls[item.imageId || ""] ?
          <image href={imageUrls[item.imageId || ""]} data-image-id={item.imageId} x={x} y={y} width={w} height={h} preserveAspectRatio="none" /> :
          <g><rect x={x} y={y} width={w} height={h} fill="#e5ebf3" stroke="#abb8cd" /><text x={x + 12} y={y + 26} fontSize="14" fill="#55657a">画像を読み込み中…</text></g>;
      }
    })();
    const center = transformCenter(item);
    const transform = item.rotation || (item.scale && item.scale !== 1) ?
      `translate(${center.x} ${center.y}) rotate(${item.rotation ?? 0}) scale(${item.scale ?? 1}) translate(${-center.x} ${-center.y})` : undefined;
    return <g key={item.id} data-item-id={preview ? undefined : item.id}
      transform={transform}
      clipPath={item.clip ? "url(#clip-" + item.id + ")" : undefined}
      style={{ cursor: tool === "eraser" || tool === "delete" ? "crosshair" : tool === "select" ? "move" : undefined }}
      onDoubleClick={item.kind === "text" && !preview ? (event) => {
        event.stopPropagation();
        const value = window.prompt("メモを編集", item.text || "");
        if (value !== null) replaceSelected({ ...item, text: value.slice(0, 2000) });
      } : undefined}>{shape}</g>;
  }

  const layersPanel = <div className="layers-body">
    <div className="panel-heading"><span>レイヤー</span><button className="icon-btn" onClick={addLayer} aria-label="レイヤーを追加" title="レイヤーを追加"><Plus size={19} /></button></div>
    <div className="layer-list">
      {[...content.layers].reverse().map(layer => <div key={layer.id}
        className={"layer-row " + (activeLayer === layer.id ? "active" : "")}
        onClick={() => setActiveLayer(layer.id)}>
        <span className="layer-dot" style={{ background: activeLayer === layer.id ? "#2467df" : "#bcc6d3" }} />
        <span className="layer-name">{layer.name}</span>
        <span className="layer-count">{content.items.filter(item => item.layerId === layer.id).length}</span>
        {chosen && chosen.layerId !== layer.id && !layer.locked && layer.visible &&
          <button className="mini-btn" title="選択中の要素をこのレイヤーへ移す" aria-label={layer.name + "へ移す"}
            onClick={event => { event.stopPropagation(); moveSelectedToLayer(layer.id); }}><Layers3 size={16} /></button>}
        <button className="mini-btn" title={layer.visible ? "非表示" : "表示"} aria-label={layer.visible ? "非表示" : "表示"}
          onClick={event => { event.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}>
          {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button className="mini-btn" title={layer.locked ? "ロック解除" : "ロック"} aria-label={layer.locked ? "ロック解除" : "ロック"}
          onClick={event => { event.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }}>
          {layer.locked ? <Lock size={15} /> : <Unlock size={15} />}
        </button>
      </div>)}
    </div>
    <p className="panel-help">レイヤーを選んで描画。表示・ロックを切り替えられます。</p>
    <div className="layer-actions">
      <button onClick={() => {
        const layer = content.layers.find(entry => entry.id === activeLayer);
        if (!layer) return;
        const name = window.prompt("レイヤー名", layer.name);
        if (name?.trim()) updateLayer(layer.id, { name: name.trim().slice(0, 50) });
      }}>名前変更</button>
      <button onClick={() => reorderLayer(activeLayer, 1)}>前面へ</button>
      <button onClick={() => reorderLayer(activeLayer, -1)}>背面へ</button>
    </div>
    {chosen && <div className="selection-panel">
      <div className="panel-heading"><span>選択中の要素</span><span className="kind-label">{chosen.kind}</span></div>
      <div className="selection-transform">
        <span>拡大・縮小・回転</span>
        <div className="selection-actions">
          <button onClick={() => changeTransform(0.8)} disabled={!selectedEditable} aria-label="要素を縮小"><ZoomOut size={16} /> 縮小</button>
          <button onClick={() => changeTransform(1.25)} disabled={!selectedEditable} aria-label="要素を拡大"><ZoomIn size={16} /> 拡大</button>
          <button onClick={() => changeTransform(1, -15)} disabled={!selectedEditable} aria-label="要素を左回転"><RotateCcw size={16} /> 左へ</button>
          <button onClick={() => changeTransform(1, 15)} disabled={!selectedEditable} aria-label="要素を右回転"><RotateCw size={16} /> 右へ</button>
        </div>
        <small>{Math.round((chosen.scale ?? 1) * 100)}% · {Math.round(chosen.rotation ?? 0)}°</small>
      </div>
      <div className="selection-actions">
        {["rect", "ellipse", "box"].includes(chosen.kind) && <button onClick={splitSelected}><Ungroup size={16} /> 分解</button>}
        {(chosen.kind === "polygon" || chosen.kind === "path") &&
          <button className={nodeEdit ? "is-on" : ""} onClick={() => { setNodeEdit(!nodeEdit); setTool("select"); }}>
            <MousePointer2 size={16} /> 点編集
          </button>}
        <button className={maskMode ? "is-on" : ""} onClick={() => { setMaskMode(!maskMode); setTool("select"); }}>
          <Scissors size={16} /> トリム
        </button>
        {chosen.clip && <button onClick={() => replaceSelected({ ...chosen, clip: undefined })}>トリム解除</button>}
        <button className="danger" onClick={removeSelected}><X size={16} /> 全体消去</button>
      </div>
      {chosen.kind === "box" && <div className="depth-setting">
        <div className="width-label"><span>立体の奥行き</span><strong>{chosen.depth ?? 36}</strong></div>
        <Slider value={[chosen.depth ?? 36]} min={12} max={150} step={2}
          onValueChange={value => replaceSelected({ ...chosen, depth: value[0] })}
          aria-label="立体の奥行き" />
      </div>}
      {maskMode && <p className="panel-help">キャンバス上で残す範囲を囲んでください。</p>}
    </div>}
  </div>;

  return <main className="studio" onPaste={onPaste} onCopy={onCopy} tabIndex={-1}
    onDragOver={event => event.preventDefault()} onDrop={onDrop}>
    <header className="studio-header">
      <div className="brand"><span className="brand-mark">C</span><span className="brand-name">キャンバス</span></div>
      <div className="title-wrap">
        <input aria-label="作品名" value={title} maxLength={80}
          onChange={event => { setTitle(event.target.value); titleRef.current = event.target.value; markDirty(); }} />
        <span className={"sync-status " + (status.includes("保存領域") ? "error" : "")}>
          {docId && !docId.startsWith("local-") && online ? <Cloud size={15} /> : <CloudOff size={15} />} {status}
        </span>
      </div>
      <div className="header-actions">
        <button className="header-btn" title="作品一覧" onClick={() => { void refreshList(); setDocsOpen(true); }}><FolderOpen size={19} /><span>作品</span></button>
        <button className="header-btn" title="レイヤー" onClick={() => setLayersOpen(true)}><Layers3 size={19} /><span className="wide-label">レイヤー</span></button>
        {owner && docId && !docId.startsWith("local-") && <button className="header-btn share-btn" onClick={() => void generateShare()} title="共同編集リンク"><Share2 size={18} /><span>共有</span></button>}
        {!signedIn && !shareTokenRef.current &&
          <a className="header-btn signin" href={signInPath} target="_top">ログインして同期</a>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="header-btn" aria-label="ファイルと書き出し"><Menu size={20} /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => imageRef.current?.click()}><ImagePlus size={16} />画像を配置</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => importRef.current?.click()}><FolderOpen size={16} />作品を読み込む</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportVector()}><Download size={16} />SVGを書き出す</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportPng()}><Download size={16} />PNGを書き出す</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportJson()}><Download size={16} />作品をファイルに保存（JSON）</DropdownMenuItem>
            {signedIn && <DropdownMenuItem onSelect={() => {
              void api("/api/session", { method: "DELETE" }).then(response => {
                if (response.ok) location.assign("/canvas/");
                else setMessage("ログアウトできませんでした");
              }).catch(() => setMessage("接続を確認してください"));
            }}><Lock size={16} />ログアウト</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => {
              if (installPrompt) void installPrompt.prompt();
              else setMessage("ブラウザの「アプリをインストール」または「ホーム画面に追加」を選んでください");
            }}><Plus size={16} />端末に追加</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

    <section className="work-area">
      <nav className="tool-rail" aria-label="描画ツール">
        <div className="tool-group">{tools.map(entry => <button key={entry.id}
          className={"tool-button " + (tool === entry.id ? "chosen" : "")}
          onClick={() => { setTool(entry.id); setMaskMode(false); }} title={entry.label + " (" + entry.hint + ")"}
          aria-label={entry.label} aria-pressed={tool === entry.id}><entry.icon size={21} strokeWidth={1.8} /></button>)}</div>
        <div className="tool-divider" />
        <button className="tool-button" onClick={() => imageRef.current?.click()} title="画像を配置" aria-label="画像を配置"><ImagePlus size={20} /></button>
      </nav>

      <div className="canvas-stage" ref={canvasRef}>
        <svg ref={svgRef} className="drawing-surface"
          aria-label="無限キャンバス" role="img"
          viewBox={view.x + " " + view.y + " " + size.w / view.scale + " " + size.h / view.scale}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}
          style={{ cursor: spaceHeld || tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair" }}>
          <defs>
            <pattern id="square-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
              <path d={"M " + gridStep + " 0 L 0 0 0 " + gridStep} fill="none" stroke="#dce6f2" strokeWidth="0.85" />
            </pattern>
            <pattern id="iso-grid" width="48" height="24" patternUnits="userSpaceOnUse">
              <path d="M 0 0 L 48 24 M 48 0 L 0 24 M 0 0 L 48 0"
                fill="none" stroke="#dae5f3" strokeWidth="0.85" />
            </pattern>
            {ordered.filter(item => item.clip).map(item => <clipPath key={item.id} id={"clip-" + item.id}>
              <rect x={item.clip!.x} y={item.clip!.y} width={item.clip!.w} height={item.clip!.h} />
            </clipPath>)}
          </defs>
          <g data-scene transform={view.rotation ?
            `rotate(${view.rotation} ${viewCenter(view, size).x} ${viewCenter(view, size).y})` : undefined}>
          {content.grid !== "none" && <rect data-export-ignore
            x={viewCenter(view, size).x - Math.hypot(size.w, size.h) / view.scale}
            y={viewCenter(view, size).y - Math.hypot(size.w, size.h) / view.scale}
            width={2 * Math.hypot(size.w, size.h) / view.scale}
            height={2 * Math.hypot(size.w, size.h) / view.scale}
            fill={content.grid === "iso" ? "url(#iso-grid)" : "url(#square-grid)"} />}
          {ordered.map(item => renderItem(item))}
          {draft && <g data-export-ignore pointerEvents="none">{renderItem(draft, true)}</g>}
          {chosen && <g data-export-ignore pointerEvents="none">
            {(() => { const b = bounds(chosen); return <rect x={b.x - 5 / view.scale} y={b.y - 5 / view.scale}
              width={b.w + 10 / view.scale} height={b.h + 10 / view.scale}
              fill="none" stroke="#2467df" strokeDasharray={(5 / view.scale) + " " + (4 / view.scale)}
              strokeWidth={1.3 / view.scale} />; })()}
          </g>}
          {chosen && selectedEditable && tool === "select" && !nodeEdit && <g data-export-ignore>
            {(() => { const b = bounds(chosen); const size = 8 / view.scale;
              return <>
                <line x1={b.x + b.w / 2} y1={b.y - 5 / view.scale}
                  x2={b.x + b.w / 2} y2={b.y - 30 / view.scale} stroke="#2467df" strokeWidth={1.5 / view.scale} pointerEvents="none" />
                <circle data-transform-handle="rotate" data-item-id={chosen.id}
                  cx={b.x + b.w / 2} cy={b.y - 30 / view.scale} r={18 / view.scale}
                  fill="transparent" style={{ cursor: "grab" }} />
                <circle cx={b.x + b.w / 2} cy={b.y - 30 / view.scale} r={size}
                  fill="#fff" stroke="#2467df" strokeWidth={2 / view.scale} pointerEvents="none" />
                <circle data-transform-handle="scale" data-item-id={chosen.id}
                  cx={b.x + b.w + 6 / view.scale} cy={b.y + b.h + 6 / view.scale} r={18 / view.scale}
                  fill="transparent" style={{ cursor: "nwse-resize" }} />
                <circle cx={b.x + b.w + 6 / view.scale} cy={b.y + b.h + 6 / view.scale} r={size}
                  fill="#2467df" stroke="#fff" strokeWidth={2 / view.scale} pointerEvents="none" />
              </>; })()}
          </g>}
          {chosen && nodeEdit && <g data-export-ignore>{chosen.points?.map((point, index) => <circle key={index}
            data-node-index={index} data-item-id={chosen.id} cx={transformPoint(chosen, point).x} cy={transformPoint(chosen, point).y}
            r={5 / view.scale} fill="#fff" stroke="#2467df" strokeWidth={2 / view.scale} />)}</g>}
          {eraserCursor && tool === "eraser" && <circle data-export-ignore pointerEvents="none"
            cx={eraserCursor.x} cy={eraserCursor.y} r={eraserSize / (2 * view.scale)}
            fill="#2467df25" stroke="#2467df" strokeWidth={1 / view.scale} />}
          {maskDraft && <rect data-export-ignore x={maskDraft.x} y={maskDraft.y} width={maskDraft.w} height={maskDraft.h}
            fill="#2467df22" stroke="#2467df" strokeDasharray="5 4" />}
          </g>
        </svg>
        <button className="canvas-layer-chip" onClick={() => setLayersOpen(true)}
          aria-label="レイヤーを開く"><Layers3 size={17} /> {chosenLayer?.name || "レイヤー"} <span>{content.layers.length}</span></button>
        {chosen && selectedEditable && <div className="transform-toolbar" aria-label="要素の変形">
          <button onClick={() => changeTransform(0.8)} title="縮小" aria-label="要素を縮小"><ZoomOut size={18} /></button>
          <button onClick={() => changeTransform(1.25)} title="拡大" aria-label="要素を拡大"><ZoomIn size={18} /></button>
          <button onClick={() => changeTransform(1, -15)} title="左に15度回転" aria-label="要素を左回転"><RotateCcw size={18} /></button>
          <button onClick={() => changeTransform(1, 15)} title="右に15度回転" aria-label="要素を右回転"><RotateCw size={18} /></button>
          <button onClick={removeSelected} title="全体消去" aria-label="選択要素を全体消去"><X size={18} /></button>
        </div>}
        <div className="canvas-hint" data-export-ignore>{initializing ? "作品を開いています…" : content.items.length === 0 ? "指やペンで描いてください · 2本指で移動・拡大・回転" : ""}</div>
        <div className="canvas-controls" data-export-ignore>
          <button onClick={() => zoom(0.8)} aria-label="縮小"><ZoomOut size={18} /></button>
          <span>{Math.round(view.scale * 100)}%</span>
          <button onClick={() => zoom(1.25)} aria-label="拡大"><ZoomIn size={18} /></button>
          <span className="control-divider" />
          <button onClick={() => rotateCanvas(-15)} aria-label="キャンバスを左回転"><RotateCcw size={18} /></button>
          <span>{Math.round(view.rotation)}°</span>
          <button onClick={() => rotateCanvas(15)} aria-label="キャンバスを右回転"><RotateCw size={18} /></button>
        </div>
      </div>

      <aside className="inspector">
        <div className="section-title">製図設定</div>
        <div className="setting-label">グリッド</div>
        <div className="segmented">
          {(["square", "iso", "none"] as const).map((grid, i) =>
            <button key={grid} className={content.grid === grid ? "current" : ""}
              onClick={() => edit({ ...contentRef.current, grid })}>
              {["方眼", "等角", "なし"][i]}
            </button>)}
        </div>
        <button className={"setting-toggle " + (content.snap ? "on" : "")}
          onClick={() => edit({ ...contentRef.current, snap: !content.snap })}>
          <Grid3X3 size={17} /> グリッドに吸着 <span>{content.snap ? "ON" : "OFF"}</span>
        </button>
        <p className="panel-help">ペン・マーカーも近くの線と交点に吸着します。</p>
        <div className="inspector-divider" />
        <div className="section-title">描画</div>
        <div className="setting-label">線の色</div>
        <div className="swatches">{palette.map(value => <button key={value} className={"swatch " + (color === value ? "current" : "")}
          style={{ background: value }} onClick={() => { setColor(value); if (chosen) replaceSelected({ ...chosen, color: value }); }}
          aria-label={"色 " + value} />)}
          <label className="custom-color" title="自由な色"><input aria-label="自由な色" type="color" value={color}
            onChange={event => { setColor(event.target.value); if (chosen) replaceSelected({ ...chosen, color: event.target.value }); }} /></label>
        </div>
        <div className="width-label"><span>線の太さ</span><strong>{width}px</strong></div>
        <Slider value={[width]} min={1} max={24} step={1} onValueChange={value => setWidth(value[0])} aria-label="線の太さ" />
        <div className="width-label"><span>部分消しの太さ</span><strong>{eraserSize}px</strong></div>
        <Slider value={[eraserSize]} min={8} max={80} step={2} onValueChange={value => setEraserSize(value[0])} aria-label="部分消しの太さ" />
        <button className={"setting-toggle " + (fill ? "on" : "")} onClick={() => setFill(!fill)}>
          <span className="fill-icon" /> 図形を塗る <span>{fill ? "ON" : "OFF"}</span>
        </button>
        <div className="inspector-divider" />
        {layersPanel}
      </aside>
    </section>

    <footer className="bottom-strip">
      <div className="history-actions">
        <button onClick={undo} disabled={!historyCount.undo} title="元に戻す" aria-label="元に戻す"><Undo2 size={18} /></button>
        <button onClick={redo} disabled={!historyCount.redo} title="やり直す" aria-label="やり直す"><Redo2 size={18} /></button>
      </div>
      <span className="strip-tip"><Check size={14} /> {content.items.length}個の要素 · {content.layers.length}レイヤー</span>
      <span className="strip-tip desktop-tip">ホイールで拡大 · スペースキーで移動 · Ctrl+Z で戻す</span>
      <div className="mobile-tools">{tools.map(entry => <button key={entry.id}
        aria-label={entry.label} aria-pressed={tool === entry.id}
        className={tool === entry.id ? "chosen" : ""} onClick={() => { setTool(entry.id); setMaskMode(false); }}>
        <entry.icon size={22} /><span>{entry.label}</span></button>)}
        <button aria-label="レイヤーを開く" onClick={() => setLayersOpen(true)}><Layers3 size={22} /><span>レイヤー</span></button>
        <button aria-label="画像を配置" onClick={() => imageRef.current?.click()}><ImagePlus size={22} /><span>画像</span></button>
      </div>
    </footer>
    {message && <div className="toast" role="status" onClick={() => setMessage("")}>{message}<button aria-label="閉じる">×</button></div>}
    <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onImageInput} />
    <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={event => void importDocument(event)} />

    <Dialog open={docsOpen} onOpenChange={setDocsOpen}>
      <DialogContent className="docs-dialog">
        <DialogHeader><DialogTitle>作品</DialogTitle><DialogDescription>端末に自動保存した作品を開きます。ログイン中は接続が戻ると同期します。</DialogDescription></DialogHeader>
        <div className="docs-list">
          {docList.map(doc => <button key={doc.id} className={"doc-card " + (docId === doc.id ? "open" : "")}
            onClick={() => void openDocument(doc.id)}>
            <span className="doc-preview"><Pencil size={28} strokeWidth={1.3} /></span>
            <span className="doc-details"><strong>{doc.title}</strong><small>{new Date(doc.updated_at).toLocaleString("ja-JP")} · {cachedIds.has(doc.id) ? "端末に保存済み" : "接続時に開けます"}</small></span>
            {docId === doc.id && <Check size={18} />}
          </button>)}
          {!docList.length && <div className="docs-empty">保存された作品はまだありません。</div>}
        </div>
        <div className="docs-footer">
          <button className="primary-action" onClick={() => void createDocument()}><Plus size={17} /> 新しい作品</button>
          {owner && <button className="delete-action" onClick={() => void deleteDocument()}><Trash2 size={16} /> 開いている作品を削除</button>}
        </div>
      </DialogContent>
    </Dialog>
    <Sheet open={layersOpen} onOpenChange={setLayersOpen}>
      <SheetContent className="layers-sheet">
        <SheetHeader><SheetTitle>製図とレイヤー</SheetTitle><SheetDescription>描画設定と重なりを調整します。</SheetDescription></SheetHeader>
        <div className="sheet-inner">
          <div className="setting-label">グリッド</div>
          <div className="segmented">{(["square", "iso", "none"] as const).map((grid, i) =>
            <button key={grid} className={content.grid === grid ? "current" : ""}
              onClick={() => edit({ ...contentRef.current, grid })}>{["方眼", "等角", "なし"][i]}</button>)}</div>
          <button className={"setting-toggle " + (content.snap ? "on" : "")}
            onClick={() => edit({ ...contentRef.current, snap: !content.snap })}>
            <Grid3X3 size={17} /> グリッドに吸着 <span>{content.snap ? "ON" : "OFF"}</span>
          </button>
          <p className="panel-help">ペン・マーカーも近くの線と交点に吸着します。</p>
          <div className="setting-label">線の色と太さ</div>
          <div className="swatches">{palette.map(value => <button key={value}
            className={"swatch " + (color === value ? "current" : "")} style={{ background: value }}
            onClick={() => setColor(value)} aria-label={"色 " + value} />)}</div>
          <Slider value={[width]} min={1} max={24} step={1} onValueChange={value => setWidth(value[0])} aria-label="線の太さ" />
          <div className="width-label"><span>部分消しの太さ</span><strong>{eraserSize}px</strong></div>
          <Slider value={[eraserSize]} min={8} max={80} step={2} onValueChange={value => setEraserSize(value[0])} aria-label="部分消しの太さ" />
          {layersPanel}
        </div>
      </SheetContent>
    </Sheet>
    <Dialog open={shareOpen} onOpenChange={setShareOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>ライブキャンバスを共有</DialogTitle>
          <DialogDescription>リンクを開いた人がこの作品を編集できます。変更は数秒ごとに同期します。</DialogDescription></DialogHeader>
        <input className="share-input" value={shareLink} readOnly onFocus={event => event.target.select()} aria-label="共同編集リンク" />
        <div className="share-actions">
          <button className="primary-action" onClick={() => {
            void navigator.clipboard.writeText(shareLink).then(() => setMessage("リンクをコピーしました"))
              .catch(() => setMessage("リンクを選択してコピーしてください"));
          }}><Copy size={16} /> コピー</button>
          <button onClick={() => void revokeShare()}><Link2 size={16} /> 共有を停止</button>
        </div>
      </DialogContent>
    </Dialog>
  </main>;
}
