import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const file = join(process.cwd(), "src", "components", "hybrid-canvas-editor.tsx");
let source = await readFile(file, "utf8");

function replaceOnce(label, before, after) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Raster layer patch failed (${label}): target not found`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Raster layer patch failed (${label}): target is not unique`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce("local image imports",
  'import { deleteLocalDoc, getLocalDoc, listLocalDocs, putLocalDoc, type LocalDoc } from "@/lib/local-docs";',
  'import { deleteLocalDoc, getLocalDoc, getLocalImage, listLocalDocs, putLocalDoc, putLocalImage, type LocalDoc } from "@/lib/local-docs";');

replaceOnce("layer raster fields",
  'type HybridLayer = Layer & { kind?: LayerKind };',
  'type RasterBounds = { x: number; y: number; w: number; h: number };\n' +
  'type HybridLayer = Layer & { kind?: LayerKind; rasterImageId?: string; rasterBounds?: RasterBounds };');

replaceOnce("paint eraser action",
  '| { type: "erase-paint"; original: HybridDoc; changed: boolean };',
  '| { type: "erase-paint"; original: HybridDoc; changed: boolean; points: Point[]; layerId: string };');

replaceOnce("raster state",
  '  const [initializing, setInitializing] = useState(true);\n  const svgRef = useRef<SVGSVGElement>(null);',
  '  const [initializing, setInitializing] = useState(true);\n' +
  '  const [rasterUrls, setRasterUrls] = useState<Record<string, string>>({});\n' +
  '  const rasterUrlsRef = useRef<Record<string, string>>({});\n' +
  '  const svgRef = useRef<SVGSVGElement>(null);');

replaceOnce("raster helpers before title",
  '  async function nextTitle() {',
`  function rememberRaster(imageId: string, blob: Blob) {
    if (rasterUrlsRef.current[imageId]) return rasterUrlsRef.current[imageId];
    const url = URL.createObjectURL(blob);
    rasterUrlsRef.current[imageId] = url;
    setRasterUrls(previous => ({ ...previous, [imageId]: url }));
    return url;
  }
  async function rasterBlob(imageId: string): Promise<Blob | null> {
    const cached = await getLocalImage(imageId).catch(() => undefined);
    if (cached) return cached;
    const id = docIdRef.current;
    if (!id || id.startsWith("local-") || imageId.startsWith("local-")) return null;
    const response = await api("/api/documents/" + id + "/images/" + imageId);
    if (!response.ok) return null;
    const blob = await response.blob();
    await putLocalImage(imageId, blob).catch(() => {});
    return blob;
  }
  async function uploadRasterImages(input: HybridDoc, documentId: string): Promise<HybridDoc> {
    const replacements = new Map<string, string>();
    for (const entry of input.layers) {
      const imageId = entry.rasterImageId;
      if (!imageId?.startsWith("local-raster-")) continue;
      const blob = await getLocalImage(imageId);
      if (!blob) throw new Error("ラスターレイヤーの画像が端末内に見つかりません");
      const data = new FormData();
      data.append("file", blob, "canvas-raster." + (blob.type === "image/webp" ? "webp" : "png"));
      const response = await api("/api/documents/" + documentId + "/images", { method: "POST", body: data });
      if (!response.ok) throw new Error(await jsonError(response, "ラスターレイヤーを同期できません"));
      const remoteId = (await response.json() as { imageId: string }).imageId;
      await putLocalImage(remoteId, blob).catch(() => {});
      if (rasterUrlsRef.current[imageId]) {
        rasterUrlsRef.current[remoteId] = rasterUrlsRef.current[imageId];
        setRasterUrls(previous => ({ ...previous, [remoteId]: previous[imageId] }));
      } else rememberRaster(remoteId, blob);
      replacements.set(imageId, remoteId);
    }
    if (!replacements.size) return input;
    const updated: HybridDoc = { ...input, layers: input.layers.map(entry =>
      entry.rasterImageId && replacements.has(entry.rasterImageId)
        ? { ...entry, rasterImageId: replacements.get(entry.rasterImageId) }
        : entry) };
    if (docIdRef.current === documentId) {
      setDocBoth(updated);
      dirty.current = true;
      await saveLocal(updated);
    }
    return updated;
  }

  async function nextTitle() {`);

replaceOnce("saveRemote raster upload",
  '    const sentDoc = cloneDoc(docRef.current);',
  '    let sentDoc = cloneDoc(docRef.current);');
replaceOnce("saveRemote prepare rasters",
  '    try {\n      const response = await api("/api/documents/" + id, {',
  '    try {\n      sentDoc = await uploadRasterImages(sentDoc, id);\n      const response = await api("/api/documents/" + id, {');
replaceOnce("saveRemote dirty comparison",
  '      dirty.current = docRef.current !== sentDoc || titleRef.current !== sentTitle;',
  '      dirty.current = JSON.stringify(docRef.current) !== JSON.stringify(sentDoc) || titleRef.current !== sentTitle;');

replaceOnce("load raster images",
  '  const orderedLayers = doc.layers;',
`  useEffect(() => {
    let cancelled = false;
    for (const entry of doc.layers) {
      const imageId = entry.rasterImageId;
      if (!imageId || rasterUrlsRef.current[imageId]) continue;
      void rasterBlob(imageId).then(blob => {
        if (!cancelled && blob) rememberRaster(imageId, blob);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
    // rasterBlob uses the current document id to fetch uncached layer images.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.layers, docId]);

  const orderedLayers = doc.layers;`);

replaceOnce("paint eraser begin",
  '        actionRef.current = { type: "erase-paint", original, changed };',
  '        actionRef.current = { type: "erase-paint", original, changed, points: [raw], layerId: activeLayer };');
replaceOnce("paint eraser move",
`    if (action.type === "erase-paint") {
      const radius = 14 / viewRef.current.scale;
      const strokes = (docRef.current.paintStrokes ?? []).filter(stroke => stroke.layerId !== activeLayer || !strokeNear(stroke, raw, radius));
      if (strokes.length !== (docRef.current.paintStrokes ?? []).length) { action.changed = true; setDocBoth({ ...docRef.current, paintStrokes: strokes }); }
      return;
    }`,
`    if (action.type === "erase-paint") {
      action.points.push(raw);
      const radius = 14 / viewRef.current.scale;
      const strokes = (docRef.current.paintStrokes ?? []).filter(stroke => stroke.layerId !== action.layerId || !strokeNear(stroke, raw, radius));
      if (strokes.length !== (docRef.current.paintStrokes ?? []).length) { action.changed = true; setDocBoth({ ...docRef.current, paintStrokes: strokes }); }
      return;
    }`);
replaceOnce("async pointer up",
  '  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {',
  '  async function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {');
replaceOnce("paint eraser finish",
`    if (action.type === "erase-paint") {
      if (action.changed) {
        undoRef.current = [...undoRef.current.slice(-39), action.original]; redoRef.current = [];
        setHistory({ undo: undoRef.current.length, redo: 0 }); dirty.current = true; void saveLocal(); scheduleSave();
      }
      return;
    }`,
`    if (action.type === "erase-paint") {
      if (await eraseRasterPixels(action.layerId, action.points)) action.changed = true;
      if (action.changed) {
        undoRef.current = [...undoRef.current.slice(-39), action.original]; redoRef.current = [];
        setHistory({ undo: undoRef.current.length, redo: 0 }); dirty.current = true; void saveLocal(); scheduleSave();
      }
      return;
    }`);

replaceOnce("rasterize and merge functions",
  '  function renderStroke(stroke: PaintStroke | HybridItem, key: string, interactive = false) {',
`  function contentBounds(snapshot: HybridDoc, layerIds: string[]): RasterBounds | null {
    const wanted = new Set(layerIds);
    const boxes: RasterBounds[] = [];
    for (const item of snapshot.items) {
      if (!wanted.has(item.layerId)) continue;
      const box = itemBounds(item);
      const pad = Math.max(2, (item.width || 1) * 1.5);
      boxes.push({ x: box.x - pad, y: box.y - pad, w: Math.max(1, box.w + pad * 2), h: Math.max(1, box.h + pad * 2) });
    }
    for (const stroke of snapshot.paintStrokes ?? []) {
      if (!wanted.has(stroke.layerId) || !stroke.points.length) continue;
      const xs = stroke.points.map(point => point.x), ys = stroke.points.map(point => point.y);
      const pad = Math.max(3, stroke.width * 1.4);
      boxes.push({ x: Math.min(...xs) - pad, y: Math.min(...ys) - pad,
        w: Math.max(1, Math.max(...xs) - Math.min(...xs) + pad * 2),
        h: Math.max(1, Math.max(...ys) - Math.min(...ys) + pad * 2) });
    }
    for (const entry of snapshot.layers) if (wanted.has(entry.id) && entry.rasterBounds) boxes.push(entry.rasterBounds);
    if (!boxes.length) return null;
    const minX = Math.min(...boxes.map(box => box.x)), minY = Math.min(...boxes.map(box => box.y));
    const maxX = Math.max(...boxes.map(box => box.x + box.w)), maxY = Math.max(...boxes.map(box => box.y + box.h));
    const margin = 4;
    return { x: minX - margin, y: minY - margin, w: Math.max(1, maxX - minX + margin * 2), h: Math.max(1, maxY - minY + margin * 2) };
  }
  function drawStrokeContext(ctx: CanvasRenderingContext2D, stroke: PaintStroke | HybridItem) {
    const points = stroke.points ?? []; if (points.length < 2) return;
    const selectedBrush = brushOf(stroke.brush ?? "technical");
    const baseWidth = stroke.width / selectedBrush.width;
    const baseOpacity = (stroke.opacity ?? selectedBrush.opacity) / selectedBrush.opacity;
    ctx.lineCap = selectedBrush.lineCap;
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color;
    ctx.globalCompositeOperation = (stroke.blend ?? selectedBrush.blend) === "multiply" ? "multiply" : "source-over";
    for (let index = 1; index < points.length; index++) {
      const style = segmentStyle(selectedBrush, points[index], index, points.length, baseWidth, baseOpacity);
      ctx.globalAlpha = style.opacity;
      ctx.lineWidth = style.width;
      ctx.beginPath(); ctx.moveTo(points[index - 1].x, points[index - 1].y); ctx.lineTo(points[index].x, points[index].y); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  function drawItemContext(ctx: CanvasRenderingContext2D, item: HybridItem) {
    if (item.kind === "path") { drawStrokeContext(ctx, item); return; }
    ctx.globalCompositeOperation = item.blend === "multiply" ? "multiply" : "source-over";
    ctx.globalAlpha = item.opacity ?? 1;
    ctx.strokeStyle = item.color; ctx.fillStyle = item.fill && item.fill !== "none" ? item.fill : "transparent";
    ctx.lineWidth = item.width || 1; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    if (item.kind === "line") { ctx.moveTo(item.x, item.y); ctx.lineTo(item.x + item.w, item.y + item.h); ctx.stroke(); }
    else if (item.kind === "rect") { if (item.fill && item.fill !== "none") ctx.fillRect(item.x, item.y, item.w, item.h); ctx.strokeRect(item.x, item.y, item.w, item.h); }
    else if (item.kind === "ellipse") {
      ctx.ellipse(item.x + item.w / 2, item.y + item.h / 2, Math.abs(item.w) / 2, Math.abs(item.h) / 2, 0, 0, Math.PI * 2);
      if (item.fill && item.fill !== "none") ctx.fill(); ctx.stroke();
    } else if (item.kind === "text") {
      ctx.fillStyle = item.color; ctx.font = "20px system-ui, sans-serif"; ctx.textBaseline = "alphabetic";
      for (const [index, line] of String(item.text || "").split("\\n").entries()) ctx.fillText(line || " ", item.x, item.y + 22 + index * 26);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (png && png.size <= 9_500_000) return png;
    const webp = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.96));
    if (webp && webp.size <= 9_500_000) return webp;
    throw new Error("ラスタライズ画像が大きすぎます。範囲を分けてください");
  }
  async function renderLayersToRaster(snapshot: HybridDoc, layerIds: string[]) {
    const bounds = contentBounds(snapshot, layerIds);
    if (!bounds) throw new Error("このレイヤーにはラスタライズする内容がありません");
    const maxDimension = Math.max(bounds.w, bounds.h);
    const density = Math.max(0.25, Math.min(2, 4096 / Math.max(1, maxDimension)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(bounds.w * density));
    canvas.height = Math.max(1, Math.ceil(bounds.h * density));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ラスタライズ用Canvasを作成できません");
    ctx.setTransform(density, 0, 0, density, -bounds.x * density, -bounds.y * density);
    const wanted = new Set(layerIds);
    for (const entry of snapshot.layers) {
      if (!wanted.has(entry.id)) continue;
      if (entry.rasterImageId && entry.rasterBounds) {
        const blob = await rasterBlob(entry.rasterImageId);
        if (blob) {
          const bitmap = await createImageBitmap(blob);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
          ctx.drawImage(bitmap, entry.rasterBounds.x, entry.rasterBounds.y, entry.rasterBounds.w, entry.rasterBounds.h);
          bitmap.close();
        }
      }
      if ((entry.kind ?? "vector") === "paint") {
        for (const stroke of snapshot.paintStrokes ?? []) if (stroke.layerId === entry.id) drawStrokeContext(ctx, stroke);
      } else {
        for (const item of snapshot.items) if (item.layerId === entry.id) drawItemContext(ctx, item);
      }
    }
    const blob = await canvasBlob(canvas);
    const imageId = "local-raster-" + uid();
    await putLocalImage(imageId, blob);
    rememberRaster(imageId, blob);
    return { imageId, bounds };
  }
  async function eraseRasterPixels(layerId: string, points: Point[]): Promise<boolean> {
    const entry = docRef.current.layers.find(layer => layer.id === layerId);
    if (!entry?.rasterImageId || !entry.rasterBounds || !points.length) return false;
    const blob = await rasterBlob(entry.rasterImageId);
    if (!blob) return false;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d"); if (!ctx) { bitmap.close(); return false; }
    ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const bounds = entry.rasterBounds;
    const sx = canvas.width / bounds.w, sy = canvas.height / bounds.h;
    const convert = (point: Point) => ({ x: (point.x - bounds.x) * sx, y: (point.y - bounds.y) * sy });
    ctx.globalCompositeOperation = "destination-out"; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 28 / viewRef.current.scale * (sx + sy) / 2);
    ctx.beginPath();
    const first = convert(points[0]); ctx.moveTo(first.x, first.y);
    if (points.length === 1) { ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
    else { for (const point of points.slice(1)) { const p = convert(point); ctx.lineTo(p.x, p.y); } ctx.stroke(); }
    const nextBlob = await canvasBlob(canvas);
    const nextId = "local-raster-" + uid(); await putLocalImage(nextId, nextBlob); rememberRaster(nextId, nextBlob);
    setDocBoth({ ...docRef.current, layers: docRef.current.layers.map(layer => layer.id === layerId ? { ...layer, rasterImageId: nextId } : layer) });
    return true;
  }
  async function rasterizeLayer(layerId: string) {
    const snapshot = cloneDoc(docRef.current);
    const entry = snapshot.layers.find(layer => layer.id === layerId);
    if (!entry) return;
    if (entry.locked) { setMessage("ロックを解除してからラスタライズしてください"); return; }
    setStatus("ラスタライズ中…");
    try {
      const raster = await renderLayersToRaster(snapshot, [layerId]);
      const next: HybridDoc = { ...snapshot,
        layers: snapshot.layers.map(layer => layer.id === layerId ? { ...layer, kind: "paint", rasterImageId: raster.imageId, rasterBounds: raster.bounds } : layer),
        items: snapshot.items.filter(item => item.layerId !== layerId),
        paintStrokes: (snapshot.paintStrokes ?? []).filter(stroke => stroke.layerId !== layerId),
      };
      markChanged(next); setActiveLayer(layerId); setSelected(null); setBrush("pencil");
    } catch (error) { setMessage(error instanceof Error ? error.message : "ラスタライズできません"); setStatus("同期待ち"); }
  }
  function vectorMergePossible(snapshot: HybridDoc, ids: string[]) {
    const wanted = new Set(ids);
    return snapshot.layers.filter(layer => wanted.has(layer.id)).every(layer => (layer.kind ?? "vector") === "vector" && !layer.rasterImageId)
      && !(snapshot.paintStrokes ?? []).some(stroke => wanted.has(stroke.layerId));
  }
  async function mergeLayerIds(ids: string[], targetId: string, name?: string) {
    if (ids.length < 2) { setMessage("結合するレイヤーがありません"); return; }
    const snapshot = cloneDoc(docRef.current); const wanted = new Set(ids);
    if (snapshot.layers.filter(layer => wanted.has(layer.id)).some(layer => layer.locked)) { setMessage("結合するレイヤーのロックを解除してください"); return; }
    if (vectorMergePossible(snapshot, ids)) {
      const next: HybridDoc = { ...snapshot,
        layers: snapshot.layers.filter(layer => !wanted.has(layer.id) || layer.id === targetId).map(layer => layer.id === targetId ? { ...layer, name: name || layer.name, kind: "vector" } : layer),
        items: snapshot.items.map(item => wanted.has(item.layerId) ? { ...item, layerId: targetId } : item),
      };
      markChanged(next); setActiveLayer(targetId); setSelected(null); return;
    }
    setStatus("レイヤーを結合中…");
    try {
      const raster = await renderLayersToRaster(snapshot, ids);
      const next: HybridDoc = { ...snapshot,
        layers: snapshot.layers.filter(layer => !wanted.has(layer.id) || layer.id === targetId)
          .map(layer => layer.id === targetId ? { ...layer, name: name || layer.name, kind: "paint", rasterImageId: raster.imageId, rasterBounds: raster.bounds } : layer),
        items: snapshot.items.filter(item => !wanted.has(item.layerId)),
        paintStrokes: (snapshot.paintStrokes ?? []).filter(stroke => !wanted.has(stroke.layerId)),
      };
      markChanged(next); setActiveLayer(targetId); setSelected(null); setBrush("pencil");
    } catch (error) { setMessage(error instanceof Error ? error.message : "レイヤーを結合できません"); setStatus("同期待ち"); }
  }
  async function mergeDown() {
    const index = docRef.current.layers.findIndex(layer => layer.id === activeLayer);
    if (index <= 0) { setMessage("このレイヤーの下には結合先がありません"); return; }
    const below = docRef.current.layers[index - 1], current = docRef.current.layers[index];
    await mergeLayerIds([below.id, current.id], below.id, below.name);
  }
  async function mergeVisible() {
    const visible = docRef.current.layers.filter(layer => layer.visible);
    if (visible.length < 2) { setMessage("表示レイヤーが1枚しかありません"); return; }
    await mergeLayerIds(visible.map(layer => layer.id), visible[0].id, "表示レイヤー結合");
  }
  async function flattenAll() {
    const snapshot = cloneDoc(docRef.current);
    const visible = snapshot.layers.filter(layer => layer.visible);
    if (!visible.length) { setMessage("表示レイヤーがありません"); return; }
    if (snapshot.layers.some(layer => !layer.visible) && !confirm("非表示レイヤーは統合結果に含めず破棄します。続けますか？")) return;
    if (visible.some(layer => layer.locked)) { setMessage("表示レイヤーのロックを解除してください"); return; }
    setStatus("全レイヤーを統合中…");
    try {
      const raster = await renderLayersToRaster(snapshot, visible.map(layer => layer.id));
      const target: HybridLayer = { id: visible[0].id, name: "統合レイヤー", visible: true, locked: false,
        kind: "paint", rasterImageId: raster.imageId, rasterBounds: raster.bounds };
      markChanged({ ...snapshot, layers: [target], items: [], paintStrokes: [] });
      setActiveLayer(target.id); setSelected(null); setBrush("pencil");
    } catch (error) { setMessage(error instanceof Error ? error.message : "全レイヤーを統合できません"); setStatus("同期待ち"); }
  }

  function renderStroke(stroke: PaintStroke | HybridItem, key: string, interactive = false) {`);

replaceOnce("render raster layer",
`          {visibleLayers.map(layerEntry => <g key={layerEntry.id} opacity={layerEntry.locked ? 0.78 : 1}>
            {(layerEntry.kind ?? "vector") === "paint" && (doc.paintStrokes ?? []).filter(stroke => stroke.layerId === layerEntry.id)
              .map(stroke => renderStroke(stroke, stroke.id))}
            {(layerEntry.kind ?? "vector") === "vector" && doc.items.filter(item => item.layerId === layerEntry.id).map(item => renderItem(item))}
          </g>)}`,
`          {visibleLayers.map(layerEntry => <g key={layerEntry.id} opacity={layerEntry.locked ? 0.78 : 1}>
            {layerEntry.rasterImageId && layerEntry.rasterBounds && rasterUrls[layerEntry.rasterImageId] && <image
              href={rasterUrls[layerEntry.rasterImageId]} x={layerEntry.rasterBounds.x} y={layerEntry.rasterBounds.y}
              width={layerEntry.rasterBounds.w} height={layerEntry.rasterBounds.h} preserveAspectRatio="none" />}
            {(layerEntry.kind ?? "vector") === "paint" && (doc.paintStrokes ?? []).filter(stroke => stroke.layerId === layerEntry.id)
              .map(stroke => renderStroke(stroke, stroke.id))}
            {(layerEntry.kind ?? "vector") === "vector" && doc.items.filter(item => item.layerId === layerEntry.id).map(item => renderItem(item))}
          </g>)}`);

replaceOnce("layer operation controls",
`          <div className="hybrid-layer-list">{[...doc.layers].reverse().map(entry => <div key={entry.id}
            className={\`hybrid-layer-row \${entry.id === activeLayer ? "active" : ""}\`} onClick={() => { setActiveLayer(entry.id); setSelected(null); }}>
            {(entry.kind ?? "vector") === "vector" ? <SquarePen size={16} /> : <Brush size={16} />}
            <span onDoubleClick={() => { const name = prompt("レイヤー名", entry.name); if (name?.trim()) updateLayer(entry.id, { name: name.trim().slice(0, 50) }); }}>{entry.name}</span>
            <button onClick={event => { event.stopPropagation(); updateLayer(entry.id, { visible: !entry.visible }); }}>{entry.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
            <button onClick={event => { event.stopPropagation(); updateLayer(entry.id, { locked: !entry.locked }); }}>{entry.locked ? <Lock size={15} /> : <Unlock size={15} />}</button>
            <button className="danger" onClick={event => { event.stopPropagation(); deleteLayer(entry.id); }}><Trash2 size={15} /></button>
          </div>)}</div>`,
`          <div className="hybrid-layer-list">{[...doc.layers].reverse().map(entry => <div key={entry.id}
            className={\`hybrid-layer-row \${entry.id === activeLayer ? "active" : ""}\`} onClick={() => { setActiveLayer(entry.id); setSelected(null); }}>
            {(entry.kind ?? "vector") === "vector" && !entry.rasterImageId ? <SquarePen size={16} /> : <Brush size={16} />}
            <span onDoubleClick={() => { const name = prompt("レイヤー名", entry.name); if (name?.trim()) updateLayer(entry.id, { name: name.trim().slice(0, 50) }); }}>{entry.name}{entry.rasterImageId ? " [R]" : ""}</span>
            <button onClick={event => { event.stopPropagation(); updateLayer(entry.id, { visible: !entry.visible }); }}>{entry.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
            <button onClick={event => { event.stopPropagation(); updateLayer(entry.id, { locked: !entry.locked }); }}>{entry.locked ? <Lock size={15} /> : <Unlock size={15} />}</button>
            <button className="danger" onClick={event => { event.stopPropagation(); deleteLayer(entry.id); }}><Trash2 size={15} /></button>
          </div>)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
            <button style={{ minHeight: 34 }} onClick={() => void rasterizeLayer(activeLayer)}>ラスタライズ</button>
            <button style={{ minHeight: 34 }} onClick={() => void mergeDown()}>下と結合</button>
            <button style={{ minHeight: 34 }} onClick={() => void mergeVisible()}>表示を結合</button>
            <button style={{ minHeight: 34 }} onClick={() => void flattenAll()}>全て統合</button>
          </div>
          <p className="hybrid-help">[R] はラスターレイヤー。ベクター同士の結合はベクターを維持し、ペイントを含む結合は透明PNG/WebPへ統合します。Undoで戻せます。</p>`);

await writeFile(file, source);
console.log("Rasterize / layer merge patch applied.");
