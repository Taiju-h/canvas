export type Point = { x: number; y: number; p?: number };
export type Tool = "select" | "hand" | "pen" | "marker" | "line" | "rect" | "ellipse" | "box" | "text" | "eraser" | "delete";
export type ItemKind = "path" | "line" | "rect" | "ellipse" | "box" | "text" | "image" | "polygon";
export type Item = {
  id: string;
  kind: ItemKind;
  layerId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  points?: Point[];
  color: string;
  fill?: string;
  width: number;
  opacity?: number;
  text?: string;
  imageId?: string;
  depth?: number;
  clip?: { x: number; y: number; w: number; h: number };
  rotation?: number;
  scale?: number;
  origin?: Point;
};
export type Layer = { id: string; name: string; visible: boolean; locked: boolean };
export type CanvasDoc = {
  version: 1;
  items: Item[];
  layers: Layer[];
  grid: "square" | "iso" | "none";
  snap: boolean;
};

export function uid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
    hex.slice(16, 20) + "-" + hex.slice(20);
}

export function blankDoc(): CanvasDoc {
  return {
    version: 1, items: [],
    layers: [{ id: uid(), name: "レイヤー 1", visible: true, locked: false }],
    grid: "square", snap: true,
  };
}

export const gridStep = 24;
export function snapPoint(p: Point, grid: CanvasDoc["grid"]): Point {
  if (grid === "iso") {
    const a = Math.round(p.x / 48 + p.y / 24);
    const b = Math.round(-p.x / 48 + p.y / 24);
    return { x: (a - b) * 24, y: (a + b) * 12 };
  }
  return { x: Math.round(p.x / gridStep) * gridStep, y: Math.round(p.y / gridStep) * gridStep };
}

// Ink follows nearby grid lines and intersections without forcing the entire stroke into cells.
export function snapInkPoint(p: Point, grid: CanvasDoc["grid"]): Point {
  if (grid === "none") return p;
  const intersection = snapPoint(p, grid);
  if (Math.hypot(p.x - intersection.x, p.y - intersection.y) <= 8) return { ...p, ...intersection };
  if (grid === "square") {
    const x = Math.round(p.x / gridStep) * gridStep;
    const y = Math.round(p.y / gridStep) * gridStep;
    return { ...p, x: Math.abs(p.x - x) <= 8 ? x : p.x,
      y: Math.abs(p.y - y) <= 8 ? y : p.y };
  }
  const nearestY = Math.round(p.y / 24) * 24;
  const options: { point: Point; distance: number }[] = [
    { point: { x: p.x, y: nearestY }, distance: Math.abs(p.y - nearestY) },
  ];
  for (const slope of [-0.5, 0.5]) {
    const c = p.y - slope * p.x;
    const line = Math.round(c / 24) * 24;
    const delta = (c - line) / (1 + slope * slope);
    options.push({ point: { x: p.x + slope * delta, y: p.y - delta },
      distance: Math.abs(c - line) / Math.sqrt(1 + slope * slope) });
  }
  const closest = options.reduce((a, b) => a.distance <= b.distance ? a : b);
  return closest.distance <= 8 ? { ...p, ...closest.point } : p;
}

export function moved(item: Item, dx: number, dy: number): Item {
  return {
    ...item, x: item.x + dx, y: item.y + dy,
    points: item.points?.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })),
    clip: item.clip ? { ...item.clip, x: item.clip.x + dx, y: item.clip.y + dy } : undefined,
    origin: item.origin ? { x: item.origin.x + dx, y: item.origin.y + dy } : undefined,
  };
}

function rawBounds(item: Item) {
  if (item.points?.length) {
    const xs = item.points.map(p => p.x);
    const ys = item.points.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const x = Math.min(item.x, item.x + item.w);
  const y = Math.min(item.y, item.y + item.h);
  if (item.kind === "box") {
    const d = item.depth ?? 36;
    return { x, y: y - d, w: Math.abs(item.w) + d, h: Math.abs(item.h) + d };
  }
  return { x, y, w: Math.abs(item.w), h: Math.abs(item.h) };
}

export function transformCenter(item: Item): Point {
  if (item.origin) return item.origin;
  const b = rawBounds(item);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function transformPoint(item: Item, point: Point): Point {
  const center = transformCenter(item);
  const angle = (item.rotation ?? 0) * Math.PI / 180;
  const scale = item.scale ?? 1;
  const x = (point.x - center.x) * scale, y = (point.y - center.y) * scale;
  return { ...point, x: center.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: center.y + x * Math.sin(angle) + y * Math.cos(angle) };
}

export function inverseTransformPoint(item: Item, point: Point): Point {
  const center = transformCenter(item);
  const angle = -(item.rotation ?? 0) * Math.PI / 180;
  const x = point.x - center.x, y = point.y - center.y;
  const scale = item.scale ?? 1;
  return { ...point, x: center.x + (x * Math.cos(angle) - y * Math.sin(angle)) / scale,
    y: center.y + (x * Math.sin(angle) + y * Math.cos(angle)) / scale };
}

export function bounds(item: Item) {
  const b = rawBounds(item);
  if (!item.rotation && (!item.scale || item.scale === 1)) return b;
  const corners = [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
  ].map(point => transformPoint(item, point));
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/** Removes the part of a pen or line stroke touched by a round brush sweep. */
export function eraseStroke(item: Item, from: Point, to: Point, brushRadius: number): Item[] {
  if (item.kind !== "path" && item.kind !== "line") return [item];
  const r = brushRadius + item.width * (item.scale ?? 1) / 2;
  const b = bounds(item);
  if (Math.max(from.x, to.x) + r < b.x || Math.min(from.x, to.x) - r > b.x + b.w ||
      Math.max(from.y, to.y) + r < b.y || Math.min(from.y, to.y) - r > b.y + b.h) return [item];
  const a = inverseTransformPoint(item, from), end = inverseTransformPoint(item, to);
  const radius = r / (item.scale ?? 1);
  const points = item.kind === "line" ? [
    { x: item.x, y: item.y }, { x: item.x + item.w, y: item.y + item.h },
  ] : item.points ?? [];
  if (points.length < 2) return [item];
  const pieces: Point[][] = [];
  let current: Point[] = [];
  let last = points[0];
  let lastKept = distanceToSegment(last, a, end) > radius;
  let erased = !lastKept;
  if (lastKept) current.push(last);
  const interpolate = (p: Point, q: Point, t: number): Point => ({
    x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t,
    p: p.p == null || q.p == null ? undefined : p.p + (q.p - p.p) * t,
  });
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1], finish = points[i];
    const length = Math.hypot(finish.x - start.x, finish.y - start.y);
    // Fine samples catch a brush crossing between two original stroke points.
    const steps = Math.max(1, Math.ceil(length / Math.max(0.75, radius / 3)));
    for (let step = 1; step <= steps; step++) {
      const point = interpolate(start, finish, step / steps);
      const kept = distanceToSegment(point, a, end) > radius;
      if (!kept) erased = true;
      if (kept !== lastKept) {
        let low = last, high = point;
        for (let n = 0; n < 9; n++) {
          const middle = interpolate(low, high, 0.5);
          if ((distanceToSegment(middle, a, end) > radius) === lastKept) low = middle;
          else high = middle;
        }
        const boundary = interpolate(low, high, 0.5);
        if (lastKept) {
          current.push(boundary);
          if (current.length >= 2) pieces.push(current);
          current = [];
        } else current = [boundary];
      }
      if (kept) current.push(point);
      last = point;
      lastKept = kept;
    }
  }
  if (!erased) return [item];
  if (current.length >= 2) pieces.push(current);
  const origin = item.rotation || (item.scale && item.scale !== 1) ? transformCenter(item) : undefined;
  return pieces.map((fragment, index) => {
    const xs = fragment.map(p => p.x), ys = fragment.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { ...item, id: index === 0 ? item.id : uid(), kind: "path", points: fragment,
      x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, origin };
  });
}

export function pathData(points: Point[]) {
  return points.map((p, i) => (i ? "L" : "M") + p.x.toFixed(2) + "," + p.y.toFixed(2)).join(" ");
}

export function polygonPoints(item: Item): Point[] {
  if (item.kind === "rect") {
    return [
      { x: item.x, y: item.y },
      { x: item.x + item.w, y: item.y },
      { x: item.x + item.w, y: item.y + item.h },
      { x: item.x, y: item.y + item.h },
    ];
  }
  if (item.kind === "ellipse") {
    const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
    return Array.from({ length: 32 }, (_, i) => ({
      x: cx + Math.cos(i * Math.PI / 16) * item.w / 2,
      y: cy + Math.sin(i * Math.PI / 16) * item.h / 2,
    }));
  }
  return item.points ?? [];
}

export function breakApart(item: Item): Item[] {
  if (item.kind === "rect" || item.kind === "ellipse") {
    return [{ ...item, kind: "polygon", points: polygonPoints(item) }];
  }
  if (item.kind === "box") {
    const { x, y, w, h } = item;
    const d = item.depth ?? 36;
    const faces: Point[][] = [
      [{ x, y }, { x: x + d, y: y - d }, { x: x + w + d, y: y - d }, { x: x + w, y }],
      [{ x: x + w, y }, { x: x + w + d, y: y - d }, { x: x + w + d, y: y + h - d }, { x: x + w, y: y + h }],
      [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
    ];
    return faces.map((points, index) => ({
      ...item, id: uid(), kind: "polygon", points,
      fill: index === 0 ? "#e4eaf4" : index === 1 ? "#c1cee2" : (item.fill || "#f7f9fc"),
    }));
  }
  return [item];
}

export function mergeDocs(base: CanvasDoc, local: CanvasDoc, remote: CanvasDoc): CanvasDoc {
  const baseline = new Map(base.items.map(item => [item.id, item]));
  const localIds = new Set(local.items.map(item => item.id));
  const changed = new Map(local.items.filter(item =>
    !baseline.has(item.id) || JSON.stringify(item) !== JSON.stringify(baseline.get(item.id))
  ).map(item => [item.id, item]));
  const items = remote.items.filter(item => !baseline.has(item.id) || localIds.has(item.id))
    .map(item => changed.get(item.id) ?? item);
  for (const item of changed.values()) if (!items.some(existing => existing.id === item.id)) items.push(item);
  const baseLayers = new Map(base.layers.map(layer => [layer.id, layer]));
  const localLayers = new Map(local.layers.map(layer => [layer.id, layer]));
  const layers = remote.layers.filter(layer => !baseLayers.has(layer.id) || localLayers.has(layer.id))
    .map(layer => {
      const own = localLayers.get(layer.id);
      return own && JSON.stringify(own) !== JSON.stringify(baseLayers.get(layer.id)) ? own : layer;
    });
  for (const layer of local.layers) if (!layers.some(existing => existing.id === layer.id)) layers.push(layer);
  return {
    version: 1, items, layers,
    grid: local.grid !== base.grid ? local.grid : remote.grid,
    snap: local.snap !== base.snap ? local.snap : remote.snap,
  };
}
