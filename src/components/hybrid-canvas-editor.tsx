"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import {
  Brush, Check, Circle, Cloud, CloudOff, Eraser, Eye, EyeOff, FolderOpen, Grid3X3,
  Hand, Layers3, Lock, Minus, MousePointer2, Pencil, Plus, Redo2, RectangleHorizontal,
  Save, Slash, SquarePen, Trash2, Type, Undo2, Unlock, ZoomIn, ZoomOut,
} from "lucide-react";
import type { CanvasDoc, Item, Layer, Point } from "@/lib/canvas";
import { uid } from "@/lib/canvas";
import { deleteLocalDoc, getLocalDoc, listLocalDocs, putLocalDoc, type LocalDoc } from "@/lib/local-docs";
import "../hybrid.css";

type LayerKind = "vector" | "paint";
type BlendMode = "normal" | "multiply";
type GridPreset = "fine" | "standard" | "large" | "diag" | "large-diag" | "iso" | "none";
type BrushId = "technical" | "gpen" | "pencil" | "brush-s" | "brush-m" | "brush-l" | "flat-xl" | "flat-xxl" | "marker";
type ToolId = "select" | "hand" | "pen" | "eraser" | "line" | "rect" | "ellipse" | "text";

type HybridLayer = Layer & { kind?: LayerKind };
type HybridItem = Item & { brush?: BrushId; blend?: BlendMode; pressure?: boolean };
type PaintStroke = {
  id: string;
  layerId: string;
  points: Point[];
  color: string;
  width: number;
  opacity: number;
  blend: BlendMode;
  brush: BrushId;
};
type HybridDoc = Omit<CanvasDoc, "layers" | "items"> & {
  layers: HybridLayer[];
  items: HybridItem[];
  gridPreset?: GridPreset;
  paintStrokes?: PaintStroke[];
};
type DocMeta = { id: string; title: string; revision: number; updated_at: number };
type View = { x: number; y: number; scale: number };
type BrushPreset = {
  id: BrushId; label: string; width: number; opacity: number; blend: BlendMode;
  pressureWidth: number; pressureOpacity: number; taper: number; lineCap: "round" | "butt";
  vectorPreferred: boolean;
};

type ActiveAction =
  | { type: "draw"; tool: ToolId; start: Point; points: Point[]; original: HybridDoc }
  | { type: "drag"; start: Point; itemId: string; original: HybridDoc }
  | { type: "pan"; sx: number; sy: number; view: View }
  | { type: "erase-paint"; original: HybridDoc; changed: boolean };

const API = "/canvas/api.php?path=";
const palette = ["#172436", "#2563eb", "#dc4c43", "#e59a24", "#158c79", "#7c4dcc", "#ffffff"];
const brushes: BrushPreset[] = [
  { id: "technical", label: "製図ペン", width: 2.5, opacity: 1, blend: "normal", pressureWidth: 0.08, pressureOpacity: 0, taper: 0, lineCap: "round", vectorPreferred: true },
  { id: "gpen", label: "Gペン", width: 4.5, opacity: 1, blend: "normal", pressureWidth: 0.95, pressureOpacity: 0, taper: 0.7, lineCap: "round", vectorPreferred: true },
  { id: "pencil", label: "鉛筆", width: 2.2, opacity: 0.48, blend: "multiply", pressureWidth: 0.08, pressureOpacity: 0.34, taper: 0.08, lineCap: "round", vectorPreferred: false },
  { id: "brush-s", label: "筆 小", width: 5, opacity: 0.9, blend: "normal", pressureWidth: 0.8, pressureOpacity: 0.1, taper: 0.48, lineCap: "round", vectorPreferred: false },
  { id: "brush-m", label: "筆 中", width: 9, opacity: 0.9, blend: "normal", pressureWidth: 0.85, pressureOpacity: 0.1, taper: 0.5, lineCap: "round", vectorPreferred: false },
  { id: "brush-l", label: "筆 大", width: 16, opacity: 0.9, blend: "normal", pressureWidth: 0.9, pressureOpacity: 0.1, taper: 0.52, lineCap: "round", vectorPreferred: false },
  { id: "flat-xl", label: "ハケ 極太", width: 30, opacity: 0.78, blend: "normal", pressureWidth: 0.38, pressureOpacity: 0.12, taper: 0.12, lineCap: "butt", vectorPreferred: false },
  { id: "flat-xxl", label: "ハケ 超極太", width: 52, opacity: 0.72, blend: "normal", pressureWidth: 0.28, pressureOpacity: 0.14, taper: 0.08, lineCap: "butt", vectorPreferred: false },
  { id: "marker", label: "マーカー", width: 15, opacity: 0.3, blend: "multiply", pressureWidth: 0.12, pressureOpacity: 0.08, taper: 0, lineCap: "round", vectorPreferred: false },
];
const gridOptions: { id: GridPreset; label: string }[] = [
  { id: "fine", label: "細" }, { id: "standard", label: "標準" }, { id: "large", label: "大" },
  { id: "diag", label: "斜線" }, { id: "large-diag", label: "大＋斜線" },
  { id: "iso", label: "等角" }, { id: "none", label: "なし" },
];

function normalizeDoc(value: CanvasDoc): HybridDoc {
  const source = value as HybridDoc;
  const gridPreset: GridPreset = source.gridPreset ?? (source.grid === "iso" ? "iso" : source.grid === "none" ? "none" : "standard");
  return {
    ...source,
    layers: source.layers.map(layer => ({ ...layer, kind: layer.kind ?? "vector" })),
    items: source.items as HybridItem[],
    gridPreset,
    paintStrokes: source.paintStrokes ?? [],
  };
}
function newDoc(): HybridDoc {
  return {
    version: 1,
    items: [],
    layers: [{ id: uid(), name: "ベクター 1", visible: true, locked: false, kind: "vector" }],
    grid: "square", snap: true, gridPreset: "standard", paintStrokes: [],
  };
}
function cloneDoc(doc: HybridDoc): HybridDoc { return structuredClone(doc); }
function brushOf(id: BrushId) { return brushes.find(entry => entry.id === id) ?? brushes[0]; }
function gridStep(preset: GridPreset) {
  if (preset === "fine") return 12;
  if (preset === "large" || preset === "large-diag") return 48;
  return 24;
}
function compatibleGrid(preset: GridPreset): CanvasDoc["grid"] {
  return preset === "none" ? "none" : preset === "iso" ? "iso" : "square";
}
function snapPointFor(doc: HybridDoc, point: Point): Point {
  const preset = doc.gridPreset ?? "standard";
  if (!doc.snap || preset === "none") return point;
  const step = gridStep(preset);
  if (preset === "iso") {
    const a = Math.round(point.x / (step * 2) + point.y / step);
    const b = Math.round(-point.x / (step * 2) + point.y / step);
    return { ...point, x: (a - b) * step, y: (a + b) * step / 2 };
  }
  return { ...point, x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step };
}
function titleFallback() {
  const key = "canvasHybridTitleCounter";
  let current = 0;
  try { current = Number(localStorage.getItem(key) || 0) || 0; localStorage.setItem(key, String(current + 1)); } catch {}
  return `新規キャンパス${current + 1}`;
}
async function jsonError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}
function screenToWorld(clientX: number, clientY: number, rect: DOMRect, view: View): Point {
  return { x: view.x + (clientX - rect.left) / view.scale, y: view.y + (clientY - rect.top) / view.scale };
}
function itemBounds(item: HybridItem) {
  if (item.points?.length) {
    const xs = item.points.map(p => p.x), ys = item.points.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const x = Math.min(item.x, item.x + item.w), y = Math.min(item.y, item.y + item.h);
  return { x, y, w: Math.abs(item.w), h: Math.abs(item.h) };
}
function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
function strokeNear(stroke: PaintStroke, point: Point, radius: number) {
  const pts = stroke.points;
  for (let i = 1; i < pts.length; i++) if (distToSegment(point, pts[i - 1], pts[i]) <= radius + stroke.width / 2) return true;
  return pts.length === 1 && Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= radius + stroke.width / 2;
}
function pressureValue(point: Point) { return point.p && point.p > 0 ? Math.max(0.05, Math.min(1, point.p)) : 0.5; }
function taperFactor(index: number, length: number, amount: number) {
  if (!amount || length < 3) return 1;
  const edge = Math.max(2, Math.min(9, Math.round(length * 0.12)));
  const enter = Math.min(1, (index + 1) / edge);
  const leave = Math.min(1, (length - index) / edge);
  return (1 - amount) + amount * Math.min(enter, leave);
}
function segmentStyle(preset: BrushPreset, point: Point, index: number, length: number, widthScale = 1, opacityScale = 1) {
  const pressure = pressureValue(point);
  const widthPressure = 1 - preset.pressureWidth + preset.pressureWidth * (0.28 + pressure * 1.12);
  const width = Math.max(0.45, preset.width * widthScale * widthPressure * taperFactor(index, length, preset.taper));
  const opacity = Math.max(0.04, Math.min(1, preset.opacity * opacityScale * (1 - preset.pressureOpacity + preset.pressureOpacity * (0.35 + pressure * 0.9))));
  return { width, opacity };
}

export default function HybridCanvasEditor({ accountId }: { accountId?: string }) {
  const initial = useMemo(() => newDoc(), []);
  const [doc, setDoc] = useState<HybridDoc>(initial);
  const docRef = useRef(doc);
  const [docId, setDocId] = useState<string | null>(null);
  const docIdRef = useRef<string | null>(null);
  const [title, setTitle] = useState("新規キャンパス");
  const titleRef = useRef(title);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const [activeLayer, setActiveLayer] = useState(initial.layers[0].id);
  const [tool, setTool] = useState<ToolId>("pen");
  const [brush, setBrush] = useState<BrushId>("technical");
  const [color, setColor] = useState("#172436");
  const [widthScale, setWidthScale] = useState(1);
  const [opacityScale, setOpacityScale] = useState(1);
  const [fill, setFill] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draftItem, setDraftItem] = useState<HybridItem | null>(null);
  const [draftStroke, setDraftStroke] = useState<PaintStroke | null>(null);
  const [view, setView] = useState<View>({ x: -450, y: -320, scale: 1 });
  const viewRef = useRef(view);
  const [status, setStatus] = useState("準備中");
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState("");
  const [docsOpen, setDocsOpen] = useState(false);
  const [docList, setDocList] = useState<DocMeta[]>([]);
  const [initializing, setInitializing] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const actionRef = useRef<ActiveAction | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const dirty = useRef(false);
  const undoRef = useRef<HybridDoc[]>([]);
  const redoRef = useRef<HybridDoc[]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });

  const layer = doc.layers.find(entry => entry.id === activeLayer) ?? doc.layers[0];
  const layerKind = layer?.kind ?? "vector";
  const preset = brushOf(brush);

  function setDocBoth(next: HybridDoc) { docRef.current = next; setDoc(next); }
  function setViewBoth(next: View) { viewRef.current = next; setView(next); }
  function setTitleBoth(next: string) { titleRef.current = next; setTitle(next); }
  function setRevisionBoth(next: number) { revisionRef.current = next; setRevision(next); }

  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const method = (init.method || "GET").toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
      if (!window.CanvasCsrf) {
        const session = await fetch(API + encodeURIComponent("/api/session"), { credentials: "same-origin", cache: "no-store" });
        if (session.ok) window.CanvasCsrf = (await session.json() as { csrfToken?: string }).csrfToken || "";
      }
      if (window.CanvasCsrf) headers.set("X-CSRF-Token", window.CanvasCsrf);
    }
    return fetch(API + encodeURIComponent(path), { ...init, headers, credentials: "same-origin", cache: "no-store" });
  }

  async function nextTitle() {
    try {
      const response = await api("/api/next-title");
      if (response.ok) return (await response.json() as { title: string }).title;
    } catch {}
    return titleFallback();
  }

  function localRecord(nextDoc = docRef.current): LocalDoc | null {
    const id = docIdRef.current;
    if (!id) return null;
    return {
      id, title: titleRef.current, content: nextDoc as CanvasDoc, base: nextDoc as CanvasDoc,
      revision: revisionRef.current, updated_at: Date.now(), dirty: dirty.current, owner: true,
      accountId,
    };
  }
  async function saveLocal(nextDoc = docRef.current) {
    const record = localRecord(nextDoc);
    if (!record) return;
    try { await putLocalDoc(record); } catch { setStatus("端末保存エラー"); }
  }
  function scheduleSave(delay = 700) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveRemote(), delay);
  }
  function markChanged(next: HybridDoc, pushHistory = true) {
    if (pushHistory) {
      undoRef.current = [...undoRef.current.slice(-39), cloneDoc(docRef.current)];
      redoRef.current = [];
      setHistory({ undo: undoRef.current.length, redo: 0 });
    }
    setDocBoth(next);
    dirty.current = true;
    setStatus("端末に保存中…");
    void saveLocal(next).then(() => setStatus(navigator.onLine ? "同期待ち" : "端末に保存済み"));
    if (navigator.onLine) scheduleSave();
  }

  async function saveRemote() {
    if (saving.current || !dirty.current) return;
    const id = docIdRef.current;
    if (!id || id.startsWith("local-")) return;
    saving.current = true;
    const sentDoc = cloneDoc(docRef.current);
    const sentTitle = titleRef.current;
    const sentRevision = revisionRef.current;
    setStatus("同期中…");
    try {
      const response = await api("/api/documents/" + id, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: sentRevision, title: sentTitle, content: sentDoc }),
      });
      if (response.status === 409) {
        setStatus("他端末の変更あり・再読込してください");
        return;
      }
      if (!response.ok) throw new Error(await jsonError(response, "保存できません"));
      const result = await response.json() as { revision: number };
      setRevisionBoth(result.revision);
      dirty.current = docRef.current !== sentDoc || titleRef.current !== sentTitle;
      setStatus(dirty.current ? "同期待ち" : "同期済み");
      await saveLocal();
    } catch (error) {
      setStatus("端末に保存済み・同期待ち");
      if (navigator.onLine) setMessage(error instanceof Error ? error.message : "保存できません");
    } finally {
      saving.current = false;
      if (dirty.current && navigator.onLine) scheduleSave(2400);
    }
  }

  async function createDocument() {
    const name = await nextTitle();
    const fresh = newDoc();
    try {
      const response = await api("/api/documents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, content: fresh }),
      });
      if (!response.ok) throw new Error(await jsonError(response, "新規作品を作れません"));
      const record = await response.json() as { id: string; title: string; revision: number; content: CanvasDoc };
      const normalized = normalizeDoc(record.content);
      docIdRef.current = record.id; setDocId(record.id);
      setTitleBoth(record.title); setRevisionBoth(record.revision); setDocBoth(normalized);
      setActiveLayer(normalized.layers[0]?.id || ""); selectedReset();
      dirty.current = false; await saveLocal(normalized); setStatus("同期済み"); setDocsOpen(false);
      const url = new URL(location.href); url.searchParams.set("d", record.id); history.replaceState(null, "", url);
      await refreshList();
    } catch (error) { setMessage(error instanceof Error ? error.message : "新規作品を作れません"); }
  }
  function selectedReset() { setSelected(null); setDraftItem(null); setDraftStroke(null); }

  async function openDocument(id: string) {
    try {
      const cached = await getLocalDoc(id).catch(() => undefined);
      if (cached) {
        const normalized = normalizeDoc(cached.content);
        docIdRef.current = id; setDocId(id); setTitleBoth(cached.title); setRevisionBoth(cached.revision);
        setDocBoth(normalized); setActiveLayer(normalized.layers[0]?.id || "");
      }
      if (navigator.onLine && !id.startsWith("local-")) {
        const response = await api("/api/documents/" + id);
        if (!response.ok) throw new Error(await jsonError(response, "作品を開けません"));
        const record = await response.json() as { id: string; title: string; revision: number; content: CanvasDoc };
        const normalized = normalizeDoc(record.content);
        docIdRef.current = id; setDocId(id); setTitleBoth(record.title); setRevisionBoth(record.revision);
        setDocBoth(normalized); setActiveLayer(normalized.layers[0]?.id || ""); dirty.current = false; await saveLocal(normalized);
      }
      selectedReset(); setDocsOpen(false); setStatus(navigator.onLine ? "同期済み" : "端末に保存済み");
      const url = new URL(location.href); url.searchParams.set("d", id); history.replaceState(null, "", url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "作品を開けません"); }
  }
  async function refreshList() {
    const local = await listLocalDocs().catch(() => [] as LocalDoc[]);
    let remote: DocMeta[] = [];
    if (navigator.onLine) {
      try {
        const response = await api("/api/documents");
        if (response.ok) remote = (await response.json() as { documents: DocMeta[] }).documents;
      } catch {}
    }
    const merged = new Map<string, DocMeta>();
    for (const record of remote) merged.set(record.id, record);
    for (const record of local) if (!merged.has(record.id) || record.dirty) {
      merged.set(record.id, { id: record.id, title: record.title, revision: record.revision, updated_at: record.updated_at });
    }
    const list = [...merged.values()].sort((a, b) => b.updated_at - a.updated_at);
    setDocList(list); return list;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await refreshList();
      if (cancelled) return;
      const requested = new URLSearchParams(location.search).get("d");
      if (requested && list.some(entry => entry.id === requested)) await openDocument(requested);
      else if (list.length) await openDocument(list[0].id);
      else await createDocument();
      if (!cancelled) setInitializing(false);
    })();
    const onOnline = () => { setOnline(true); void refreshList(); if (dirty.current) scheduleSave(100); };
    const onOffline = () => { setOnline(false); setStatus("端末に保存済み"); };
    addEventListener("online", onOnline); addEventListener("offline", onOffline);
    return () => { cancelled = true; removeEventListener("online", onOnline); removeEventListener("offline", onOffline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orderedLayers = doc.layers;
  const selectedItem = doc.items.find(item => item.id === selected);

  function pointerPoint(event: ReactPointerEvent<SVGSVGElement>): Point {
    return screenToWorld(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), viewRef.current);
  }
  function currentLayer() { return docRef.current.layers.find(entry => entry.id === activeLayer); }
  function ensureLayer(expected?: LayerKind) {
    const current = currentLayer();
    if (!current || current.locked || !current.visible) { setMessage("表示中でロックされていないレイヤーを選んでください"); return null; }
    if (expected && (current.kind ?? "vector") !== expected) {
      setMessage(expected === "vector" ? "このツールはベクターレイヤーで使います" : "このツールはペイントレイヤーで使います"); return null;
    }
    return current;
  }
  function makeItem(kind: ToolId, start: Point, end: Point, points: Point[]): HybridItem {
    const snapStart = snapPointFor(docRef.current, start), snapEnd = snapPointFor(docRef.current, end);
    const a = kind === "pen" ? start : snapStart, b = kind === "pen" ? end : snapEnd;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.max(1, Math.abs(b.x - a.x)), h = Math.max(1, Math.abs(b.y - a.y));
    const selectedBrush = brushOf(brush);
    return {
      id: uid(), kind: kind === "pen" ? "path" : kind as Item["kind"], layerId: activeLayer,
      x: kind === "line" ? a.x : x, y: kind === "line" ? a.y : y,
      w: kind === "line" ? b.x - a.x : w, h: kind === "line" ? b.y - a.y : h,
      points: kind === "pen" ? points : undefined,
      color, width: selectedBrush.width * widthScale,
      opacity: selectedBrush.opacity * opacityScale,
      fill: kind === "rect" || kind === "ellipse" ? (fill ? color : "none") : "none",
      brush, blend: selectedBrush.blend, pressure: true,
    };
  }
  function makePaintStroke(points: Point[]): PaintStroke {
    const selectedBrush = brushOf(brush);
    return { id: uid(), layerId: activeLayer, points, color, width: selectedBrush.width * widthScale,
      opacity: selectedBrush.opacity * opacityScale, blend: selectedBrush.blend, brush };
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const raw = pointerPoint(event);
    if (tool === "hand" || event.button === 1) {
      actionRef.current = { type: "pan", sx: event.clientX, sy: event.clientY, view: { ...viewRef.current } }; return;
    }
    if (tool === "select") {
      const target = event.target as Element;
      const id = target.closest("[data-item-id]")?.getAttribute("data-item-id");
      if (id) { setSelected(id); actionRef.current = { type: "drag", start: raw, itemId: id, original: cloneDoc(docRef.current) }; }
      else setSelected(null);
      return;
    }
    if (tool === "text") {
      if (!ensureLayer("vector")) return;
      const value = prompt("文字を入力", ""); if (!value?.trim()) return;
      const p = snapPointFor(docRef.current, raw);
      const item: HybridItem = { id: uid(), kind: "text", layerId: activeLayer, x: p.x, y: p.y,
        w: Math.max(100, value.length * 18), h: 30, color, width: 1, fill: "none", text: value.slice(0, 2000) };
      markChanged({ ...docRef.current, items: [...docRef.current.items, item] }); setSelected(item.id); return;
    }
    if (tool === "eraser") {
      const current = ensureLayer(); if (!current) return;
      if ((current.kind ?? "vector") === "paint") {
        const original = cloneDoc(docRef.current);
        const radius = 14 / viewRef.current.scale;
        const strokes = (docRef.current.paintStrokes ?? []).filter(stroke => stroke.layerId !== activeLayer || !strokeNear(stroke, raw, radius));
        const changed = strokes.length !== (docRef.current.paintStrokes ?? []).length;
        if (changed) setDocBoth({ ...docRef.current, paintStrokes: strokes });
        actionRef.current = { type: "erase-paint", original, changed };
      } else {
        const target = event.target as Element;
        const id = target.closest("[data-item-id]")?.getAttribute("data-item-id");
        if (id) markChanged({ ...docRef.current, items: docRef.current.items.filter(item => item.id !== id) });
      }
      return;
    }
    const current = ensureLayer(); if (!current) return;
    if (tool !== "pen" && (current.kind ?? "vector") !== "vector") { setMessage("直線・図形はベクターレイヤーで描きます"); return; }
    const start = tool === "pen" ? raw : snapPointFor(docRef.current, raw);
    const point = { ...start, p: event.pressure || 0.5 };
    actionRef.current = { type: "draw", tool, start, points: [point], original: cloneDoc(docRef.current) };
    if (tool === "pen" && (current.kind ?? "vector") === "paint") setDraftStroke(makePaintStroke([point]));
    else setDraftItem(makeItem(tool, start, start, [point]));
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const action = actionRef.current; if (!action) return;
    if (action.type === "pan") {
      setViewBoth({ ...action.view, x: action.view.x - (event.clientX - action.sx) / action.view.scale,
        y: action.view.y - (event.clientY - action.sy) / action.view.scale }); return;
    }
    const raw = pointerPoint(event);
    if (action.type === "drag") {
      const dx = raw.x - action.start.x, dy = raw.y - action.start.y;
      const next = cloneDoc(action.original);
      next.items = next.items.map(item => item.id === action.itemId ? {
        ...item, x: item.x + dx, y: item.y + dy, points: item.points?.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })),
      } : item);
      setDocBoth(next); return;
    }
    if (action.type === "erase-paint") {
      const radius = 14 / viewRef.current.scale;
      const strokes = (docRef.current.paintStrokes ?? []).filter(stroke => stroke.layerId !== activeLayer || !strokeNear(stroke, raw, radius));
      if (strokes.length !== (docRef.current.paintStrokes ?? []).length) { action.changed = true; setDocBoth({ ...docRef.current, paintStrokes: strokes }); }
      return;
    }
    const end = action.tool === "pen" ? raw : snapPointFor(docRef.current, raw);
    if (action.tool === "pen") {
      const last = action.points[action.points.length - 1];
      if (Math.hypot(end.x - last.x, end.y - last.y) < 0.55 / viewRef.current.scale) return;
      action.points.push({ ...end, p: event.pressure || 0.5 });
      const current = currentLayer();
      if ((current?.kind ?? "vector") === "paint") setDraftStroke(makePaintStroke([...action.points]));
      else setDraftItem(makeItem("pen", action.start, end, [...action.points]));
    } else setDraftItem(makeItem(action.tool, action.start, end, action.points));
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const action = actionRef.current; actionRef.current = null;
    if (!action) return;
    if (action.type === "pan") return;
    if (action.type === "drag") {
      if (JSON.stringify(action.original) !== JSON.stringify(docRef.current)) {
        undoRef.current = [...undoRef.current.slice(-39), action.original]; redoRef.current = [];
        setHistory({ undo: undoRef.current.length, redo: 0 }); dirty.current = true; void saveLocal(); scheduleSave();
      }
      return;
    }
    if (action.type === "erase-paint") {
      if (action.changed) {
        undoRef.current = [...undoRef.current.slice(-39), action.original]; redoRef.current = [];
        setHistory({ undo: undoRef.current.length, redo: 0 }); dirty.current = true; void saveLocal(); scheduleSave();
      }
      return;
    }
    const raw = pointerPoint(event);
    const current = currentLayer();
    if (!current) return;
    if (action.tool === "pen") {
      let points = action.points;
      if (points.length === 1) points = [points[0], { ...points[0], x: points[0].x + 0.2 }];
      if ((current.kind ?? "vector") === "paint") {
        const stroke = makePaintStroke(points);
        markChanged({ ...docRef.current, paintStrokes: [...(docRef.current.paintStrokes ?? []), stroke] });
      } else {
        const item = makeItem("pen", action.start, raw, points);
        markChanged({ ...docRef.current, items: [...docRef.current.items, item] }); setSelected(item.id);
      }
    } else {
      const end = snapPointFor(docRef.current, raw);
      if (Math.hypot(end.x - action.start.x, end.y - action.start.y) > 1.5) {
        const item = makeItem(action.tool, action.start, end, action.points);
        markChanged({ ...docRef.current, items: [...docRef.current.items, item] }); setSelected(item.id);
      }
    }
    setDraftItem(null); setDraftStroke(null);
  }

  function onWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const before = screenToWorld(event.clientX, event.clientY, rect, viewRef.current);
    const scale = Math.max(0.15, Math.min(8, viewRef.current.scale * Math.exp(-event.deltaY * 0.001)));
    const next = { scale, x: before.x - (event.clientX - rect.left) / scale, y: before.y - (event.clientY - rect.top) / scale };
    setViewBoth(next);
  }

  function undo() {
    const previous = undoRef.current.pop(); if (!previous) return;
    redoRef.current.push(cloneDoc(docRef.current)); setDocBoth(previous); dirty.current = true;
    setHistory({ undo: undoRef.current.length, redo: redoRef.current.length }); void saveLocal(previous); scheduleSave();
  }
  function redo() {
    const next = redoRef.current.pop(); if (!next) return;
    undoRef.current.push(cloneDoc(docRef.current)); setDocBoth(next); dirty.current = true;
    setHistory({ undo: undoRef.current.length, redo: redoRef.current.length }); void saveLocal(next); scheduleSave();
  }

  function addLayer(kind: LayerKind) {
    const count = docRef.current.layers.filter(entry => (entry.kind ?? "vector") === kind).length + 1;
    const next: HybridLayer = { id: uid(), name: `${kind === "vector" ? "ベクター" : "ペイント"} ${count}`,
      visible: true, locked: false, kind };
    markChanged({ ...docRef.current, layers: [...docRef.current.layers, next] }); setActiveLayer(next.id); setSelected(null);
    if (kind === "paint" && brushOf(brush).vectorPreferred) setBrush("pencil");
    if (kind === "vector" && !brushOf(brush).vectorPreferred) setBrush("technical");
  }
  function updateLayer(id: string, patch: Partial<HybridLayer>) {
    markChanged({ ...docRef.current, layers: docRef.current.layers.map(entry => entry.id === id ? { ...entry, ...patch } : entry) });
  }
  function deleteLayer(id: string) {
    if (docRef.current.layers.length <= 1) { setMessage("最後のレイヤーは削除できません"); return; }
    const nextLayers = docRef.current.layers.filter(entry => entry.id !== id);
    markChanged({ ...docRef.current, layers: nextLayers,
      items: docRef.current.items.filter(item => item.layerId !== id),
      paintStrokes: (docRef.current.paintStrokes ?? []).filter(stroke => stroke.layerId !== id) });
    setActiveLayer(nextLayers[nextLayers.length - 1].id); setSelected(null);
  }
  function setGridPreset(gridPreset: GridPreset) {
    markChanged({ ...docRef.current, gridPreset, grid: compatibleGrid(gridPreset) }, false);
  }

  function renderStroke(stroke: PaintStroke | HybridItem, key: string, interactive = false) {
    const points = stroke.points ?? []; if (points.length < 2) return null;
    const selectedBrush = brushOf(stroke.brush ?? "technical");
    const baseWidth = stroke.width / selectedBrush.width;
    const baseOpacity = (stroke.opacity ?? selectedBrush.opacity) / selectedBrush.opacity;
    return <g key={key} data-item-id={interactive ? (stroke as HybridItem).id : undefined}
      style={{ mixBlendMode: (stroke.blend ?? selectedBrush.blend) === "multiply" ? "multiply" : "normal" }}>
      {points.slice(1).map((point, index) => {
        const style = segmentStyle(selectedBrush, point, index + 1, points.length, baseWidth, baseOpacity);
        const before = points[index];
        return <line key={index} x1={before.x} y1={before.y} x2={point.x} y2={point.y}
          stroke={stroke.color} strokeWidth={style.width} strokeOpacity={style.opacity}
          strokeLinecap={selectedBrush.lineCap} strokeLinejoin="round" />;
      })}
    </g>;
  }
  function renderItem(item: HybridItem, preview = false) {
    if (item.kind === "path") return renderStroke(item, item.id + (preview ? "-preview" : ""), !preview);
    const common = { stroke: item.color, strokeWidth: item.width, opacity: item.opacity ?? 1, fill: "none" };
    let shape: React.ReactNode;
    if (item.kind === "line") shape = <line x1={item.x} y1={item.y} x2={item.x + item.w} y2={item.y + item.h} {...common} />;
    else if (item.kind === "rect") shape = <rect x={item.x} y={item.y} width={item.w} height={item.h} {...common} fill={item.fill === "none" ? "none" : item.fill} />;
    else if (item.kind === "ellipse") shape = <ellipse cx={item.x + item.w / 2} cy={item.y + item.h / 2} rx={item.w / 2} ry={item.h / 2} {...common} fill={item.fill === "none" ? "none" : item.fill} />;
    else if (item.kind === "text") shape = <text x={item.x} y={item.y + 22} fill={item.color} fontSize="20" stroke="none">{item.text}</text>;
    else return null;
    return <g key={item.id} data-item-id={preview ? undefined : item.id}>{shape}</g>;
  }

  const grid = doc.gridPreset ?? "standard";
  const step = gridStep(grid);
  const gridFill = grid === "iso" ? "url(#grid-iso)" : grid === "diag" || grid === "large-diag" ? "url(#grid-diag)" : "url(#grid-square)";
  const visibleLayers = orderedLayers.filter(entry => entry.visible);

  if (initializing) return <main className="hybrid-loading"><div className="hybrid-spinner" />キャンバスを準備しています…</main>;

  return <main className="hybrid-app">
    <header className="hybrid-header">
      <div className="hybrid-brand"><span>C</span><strong>キャンバス V2</strong></div>
      <input className="hybrid-title" value={title} maxLength={80} aria-label="作品名"
        onChange={event => { setTitleBoth(event.target.value); dirty.current = true; void saveLocal(); scheduleSave(); }} />
      <div className="hybrid-status">{online ? <Cloud size={16} /> : <CloudOff size={16} />} {status}</div>
      <div className="hybrid-header-actions">
        <button onClick={() => void createDocument()}><Plus size={17} />新規</button>
        <button onClick={() => { void refreshList(); setDocsOpen(true); }}><FolderOpen size={17} />作品</button>
        <button onClick={() => void saveRemote()}><Save size={17} />保存</button>
      </div>
    </header>

    <section className="hybrid-work">
      <nav className="hybrid-tools">
        {([
          ["select", MousePointer2, "選択"], ["hand", Hand, "移動"], ["pen", Pencil, "ペン"],
          ["eraser", Eraser, "消し"], ["line", Slash, "直線"], ["rect", RectangleHorizontal, "四角"],
          ["ellipse", Circle, "円"], ["text", Type, "文字"],
        ] as const).map(([id, Icon, label]) => <button key={id} className={tool === id ? "active" : ""}
          onClick={() => setTool(id)} title={label} aria-label={label}><Icon size={21} /></button>)}
        <div className="hybrid-tool-sep" />
        <button onClick={undo} disabled={!history.undo} title="元に戻す"><Undo2 size={20} /></button>
        <button onClick={redo} disabled={!history.redo} title="やり直す"><Redo2 size={20} /></button>
      </nav>

      <div className="hybrid-stage">
        <svg ref={svgRef} className="hybrid-surface"
          viewBox={`${view.x} ${view.y} ${1200 / view.scale} ${800 / view.scale}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onWheel={onWheel} style={{ cursor: tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair" }}>
          <defs>
            <pattern id="grid-square" width={step} height={step} patternUnits="userSpaceOnUse">
              <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke="#dce6f2" strokeWidth={0.8 / view.scale} />
            </pattern>
            <pattern id="grid-diag" width={step} height={step} patternUnits="userSpaceOnUse">
              <path d={`M ${step} 0 L 0 0 0 ${step} M 0 ${step} L ${step} 0`} fill="none" stroke="#dce6f2" strokeWidth={0.8 / view.scale} />
            </pattern>
            <pattern id="grid-iso" width={step * 2} height={step} patternUnits="userSpaceOnUse">
              <path d={`M 0 0 L ${step * 2} ${step} M ${step * 2} 0 L 0 ${step} M 0 0 L ${step * 2} 0`}
                fill="none" stroke="#dce6f2" strokeWidth={0.8 / view.scale} />
            </pattern>
          </defs>
          {grid !== "none" && <rect x={view.x - 1500 / view.scale} y={view.y - 1000 / view.scale}
            width={4200 / view.scale} height={2800 / view.scale} fill={gridFill} />}
          {visibleLayers.map(layerEntry => <g key={layerEntry.id} opacity={layerEntry.locked ? 0.78 : 1}>
            {(layerEntry.kind ?? "vector") === "paint" && (doc.paintStrokes ?? []).filter(stroke => stroke.layerId === layerEntry.id)
              .map(stroke => renderStroke(stroke, stroke.id))}
            {(layerEntry.kind ?? "vector") === "vector" && doc.items.filter(item => item.layerId === layerEntry.id).map(item => renderItem(item))}
          </g>)}
          {draftItem && <g pointerEvents="none" opacity={0.85}>{renderItem(draftItem, true)}</g>}
          {draftStroke && <g pointerEvents="none" opacity={0.85}>{renderStroke(draftStroke, "draft")}</g>}
          {selectedItem && (() => { const b = itemBounds(selectedItem); return <rect pointerEvents="none"
            x={b.x - 5 / view.scale} y={b.y - 5 / view.scale} width={b.w + 10 / view.scale} height={b.h + 10 / view.scale}
            fill="none" stroke="#2871e7" strokeWidth={1.5 / view.scale} strokeDasharray={`${5 / view.scale} ${4 / view.scale}`} />; })()}
        </svg>
        <div className="hybrid-zoom">
          <button onClick={() => setViewBoth({ ...viewRef.current, scale: Math.max(0.15, viewRef.current.scale / 1.2) })}><ZoomOut size={18} /></button>
          <span>{Math.round(view.scale * 100)}%</span>
          <button onClick={() => setViewBoth({ ...viewRef.current, scale: Math.min(8, viewRef.current.scale * 1.2) })}><ZoomIn size={18} /></button>
        </div>
      </div>

      <aside className="hybrid-inspector">
        <section>
          <h2>製図設定</h2>
          <h3>グリッド</h3>
          <div className="hybrid-grid-options">{gridOptions.map(option => <button key={option.id}
            className={grid === option.id ? "active" : ""} onClick={() => setGridPreset(option.id)}>{option.label}</button>)}</div>
          <label className="hybrid-check"><input type="checkbox" checked={doc.snap}
            onChange={() => markChanged({ ...docRef.current, snap: !docRef.current.snap }, false)} /><span><Check size={15} /></span>グリッドに吸着</label>
          <p className="hybrid-help">自由線は拘束しません。直線・図形・文字の基準点だけを交点へ吸着します。</p>
        </section>

        <section>
          <h2>描画</h2>
          <div className="hybrid-layer-badge">{layerKind === "vector" ? <SquarePen size={16} /> : <Brush size={16} />}
            {layerKind === "vector" ? "ベクターレイヤー" : "ペイントレイヤー"}</div>
          <h3>ペン</h3>
          <div className="hybrid-brushes">{brushes.map(entry => <button key={entry.id} className={brush === entry.id ? "active" : ""}
            onClick={() => { setBrush(entry.id); setWidthScale(1); setOpacityScale(1); }}>{entry.label}</button>)}</div>
          <div className="hybrid-colors">{palette.map(value => <button key={value} className={color === value ? "active" : ""}
            style={{ background: value }} onClick={() => setColor(value)} aria-label={value} />)}
            <input type="color" value={color} onChange={event => setColor(event.target.value)} /></div>
          <label className="hybrid-range"><span>太さ <b>{Math.round(preset.width * widthScale * 10) / 10}px</b></span>
            <input type="range" min="0.4" max="2.5" step="0.05" value={widthScale} onChange={event => setWidthScale(Number(event.target.value))} /></label>
          <label className="hybrid-range"><span>濃さ <b>{Math.round(preset.opacity * opacityScale * 100)}%</b></span>
            <input type="range" min="0.25" max="1" step="0.05" value={opacityScale} onChange={event => setOpacityScale(Number(event.target.value))} /></label>
          <div className="hybrid-blend">合成: <b>{preset.blend === "multiply" ? "乗算" : "通常"}</b>　筆圧: <b>{preset.pressureWidth > 0.2 ? "太さ" : preset.pressureOpacity > 0.2 ? "濃さ" : "弱"}</b></div>
          <label className="hybrid-check"><input type="checkbox" checked={fill} onChange={() => setFill(!fill)} /><span><Check size={15} /></span>図形を塗る</label>
        </section>

        <section className="hybrid-layer-section">
          <div className="hybrid-section-head"><h2>レイヤー</h2><div><button title="ベクターレイヤー追加" onClick={() => addLayer("vector")}><SquarePen size={17} /><Plus size={12} /></button>
            <button title="ペイントレイヤー追加" onClick={() => addLayer("paint")}><Brush size={17} /><Plus size={12} /></button></div></div>
          <div className="hybrid-layer-list">{[...doc.layers].reverse().map(entry => <div key={entry.id}
            className={`hybrid-layer-row ${entry.id === activeLayer ? "active" : ""}`} onClick={() => { setActiveLayer(entry.id); setSelected(null); }}>
            {(entry.kind ?? "vector") === "vector" ? <SquarePen size={16} /> : <Brush size={16} />}
            <span onDoubleClick={() => { const name = prompt("レイヤー名", entry.name); if (name?.trim()) updateLayer(entry.id, { name: name.trim().slice(0, 50) }); }}>{entry.name}</span>
            <button onClick={event => { event.stopPropagation(); updateLayer(entry.id, { visible: !entry.visible }); }}>{entry.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
            <button onClick={event => { event.stopPropagation(); updateLayer(entry.id, { locked: !entry.locked }); }}>{entry.locked ? <Lock size={15} /> : <Unlock size={15} />}</button>
            <button className="danger" onClick={event => { event.stopPropagation(); deleteLayer(entry.id); }}><Trash2 size={15} /></button>
          </div>)}</div>
        </section>
      </aside>
    </section>

    {docsOpen && <div className="hybrid-modal" onMouseDown={event => { if (event.target === event.currentTarget) setDocsOpen(false); }}>
      <section className="hybrid-dialog"><div className="hybrid-dialog-head"><h2>保存した作品</h2><button onClick={() => setDocsOpen(false)}>×</button></div>
        <button className="hybrid-new-doc" onClick={() => void createDocument()}><Plus size={17} />新しいキャンバス</button>
        <div className="hybrid-doc-list">{docList.map(record => <button key={record.id} onClick={() => void openDocument(record.id)}>
          <strong>{record.title}</strong><span>{new Date(record.updated_at).toLocaleString("ja-JP")}</span></button>)}</div>
      </section>
    </div>}
    {message && <div className="hybrid-toast" onClick={() => setMessage("")}>{message}</div>}
  </main>;
}
