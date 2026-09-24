import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const file = join(process.cwd(), "src", "components", "hybrid-canvas-editor.tsx");
let source = await readFile(file, "utf8");

function replaceOnce(label, before, after) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Smooth brush patch failed (${label}): target not found`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Smooth brush patch failed (${label}): target is not unique`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce("round flat brush caps",
  '{ id: "flat-xl", label: "ハケ 極太", width: 30, opacity: 0.78, blend: "normal", pressureWidth: 0.38, pressureOpacity: 0.12, taper: 0.12, lineCap: "butt", vectorPreferred: false },\n  { id: "flat-xxl", label: "ハケ 超極太", width: 52, opacity: 0.72, blend: "normal", pressureWidth: 0.28, pressureOpacity: 0.14, taper: 0.08, lineCap: "butt", vectorPreferred: false },',
  '{ id: "flat-xl", label: "ハケ 極太", width: 30, opacity: 0.78, blend: "normal", pressureWidth: 0.30, pressureOpacity: 0.08, taper: 0.10, lineCap: "round", vectorPreferred: false },\n  { id: "flat-xxl", label: "ハケ 超極太", width: 52, opacity: 0.72, blend: "normal", pressureWidth: 0.22, pressureOpacity: 0.08, taper: 0.06, lineCap: "round", vectorPreferred: false },');

replaceOnce("stroke smoothing helpers",
  'function pressureValue(point: Point) { return point.p && point.p > 0 ? Math.max(0.05, Math.min(1, point.p)) : 0.5; }',
`function smoothStrokePoints(input: Point[], nominalWidth: number): Point[] {
  if (input.length < 3) return input.map(point => ({ ...point }));
  const output: Point[] = [{ ...input[0] }];
  const spacing = Math.max(0.75, Math.min(3, nominalWidth * 0.1));
  for (let index = 0; index < input.length - 1; index++) {
    const p0 = input[Math.max(0, index - 1)];
    const p1 = input[index];
    const p2 = input[index + 1];
    const p3 = input[Math.min(input.length - 1, index + 2)];
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const samples = Math.max(2, Math.min(14, Math.ceil(distance / spacing)));
    for (let sample = 1; sample <= samples; sample++) {
      const t = sample / samples, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      const pressure = pressureValue(p1) + (pressureValue(p2) - pressureValue(p1)) * t;
      output.push({ x, y, p: pressure });
    }
  }
  return output;
}
function strokeOutlinePoints(points: Point[], widths: number[]) {
  const left: Point[] = [], right: Point[] = [];
  for (let index = 0; index < points.length; index++) {
    const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x, dy = after.y - before.y;
    const length = Math.max(0.0001, Math.hypot(dx, dy));
    const nx = -dy / length, ny = dx / length, radius = Math.max(0.25, widths[index] / 2);
    left.push({ x: points[index].x + nx * radius, y: points[index].y + ny * radius });
    right.push({ x: points[index].x - nx * radius, y: points[index].y - ny * radius });
  }
  return { left, right };
}
function strokeOutlinePath(points: Point[], widths: number[]) {
  const { left, right } = strokeOutlinePoints(points, widths);
  if (!left.length) return "";
  const endRadius = Math.max(0.25, widths[widths.length - 1] / 2);
  const startRadius = Math.max(0.25, widths[0] / 2);
  return [
    "M " + left[0].x.toFixed(2) + " " + left[0].y.toFixed(2),
    ...left.slice(1).map(point => "L " + point.x.toFixed(2) + " " + point.y.toFixed(2)),
    "A " + endRadius.toFixed(2) + " " + endRadius.toFixed(2) + " 0 0 1 " + right[right.length - 1].x.toFixed(2) + " " + right[right.length - 1].y.toFixed(2),
    ...right.slice(0, -1).reverse().map(point => "L " + point.x.toFixed(2) + " " + point.y.toFixed(2)),
    "A " + startRadius.toFixed(2) + " " + startRadius.toFixed(2) + " 0 0 1 " + left[0].x.toFixed(2) + " " + left[0].y.toFixed(2),
    "Z",
  ].join(" ");
}
function smoothCenterPath(points: Point[]) {
  if (points.length < 2) return "";
  return "M " + points.map(point => point.x.toFixed(2) + " " + point.y.toFixed(2)).join(" L ");
}
function pressureValue(point: Point) { return point.p && point.p > 0 ? Math.max(0.05, Math.min(1, point.p)) : 0.5; }`);

replaceOnce("smooth svg brush rendering",
`  function renderStroke(stroke: PaintStroke | HybridItem, key: string, interactive = false) {
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
  }`,
`  function renderStroke(stroke: PaintStroke | HybridItem, key: string, interactive = false) {
    const rawPoints = stroke.points ?? []; if (rawPoints.length < 2) return null;
    const selectedBrush = brushOf(stroke.brush ?? "technical");
    const points = smoothStrokePoints(rawPoints, stroke.width || selectedBrush.width);
    const baseWidth = stroke.width / selectedBrush.width;
    const baseOpacity = (stroke.opacity ?? selectedBrush.opacity) / selectedBrush.opacity;
    const styles = points.map((point, index) => segmentStyle(selectedBrush, point, index, points.length, baseWidth, baseOpacity));
    const opacity = styles.reduce((total, style) => total + style.opacity, 0) / Math.max(1, styles.length);
    const variableWidth = selectedBrush.pressureWidth > 0.2 || selectedBrush.taper > 0.2;
    const averageWidth = styles.reduce((total, style) => total + style.width, 0) / Math.max(1, styles.length);
    return <g key={key} data-item-id={interactive ? (stroke as HybridItem).id : undefined}
      opacity={opacity}
      style={{ mixBlendMode: (stroke.blend ?? selectedBrush.blend) === "multiply" ? "multiply" : "normal" }}>
      {variableWidth ? <path d={strokeOutlinePath(points, styles.map(style => style.width))}
        fill={stroke.color} stroke="none" /> : <path d={smoothCenterPath(points)} fill="none" stroke={stroke.color}
        strokeWidth={averageWidth} strokeLinecap="round" strokeLinejoin="round" />}
    </g>;
  }`);

replaceOnce("smooth raster brush rendering",
`  function drawStrokeContext(ctx: CanvasRenderingContext2D, stroke: PaintStroke | HybridItem) {
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
  }`,
`  function drawStrokeContext(ctx: CanvasRenderingContext2D, stroke: PaintStroke | HybridItem) {
    const rawPoints = stroke.points ?? []; if (rawPoints.length < 2) return;
    const selectedBrush = brushOf(stroke.brush ?? "technical");
    const points = smoothStrokePoints(rawPoints, stroke.width || selectedBrush.width);
    const baseWidth = stroke.width / selectedBrush.width;
    const baseOpacity = (stroke.opacity ?? selectedBrush.opacity) / selectedBrush.opacity;
    const styles = points.map((point, index) => segmentStyle(selectedBrush, point, index, points.length, baseWidth, baseOpacity));
    const opacity = styles.reduce((total, style) => total + style.opacity, 0) / Math.max(1, styles.length);
    const variableWidth = selectedBrush.pressureWidth > 0.2 || selectedBrush.taper > 0.2;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = (stroke.blend ?? selectedBrush.blend) === "multiply" ? "multiply" : "source-over";
    ctx.fillStyle = stroke.color; ctx.strokeStyle = stroke.color; ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (variableWidth) {
      const outline = strokeOutlinePoints(points, styles.map(style => style.width));
      ctx.beginPath(); ctx.moveTo(outline.left[0].x, outline.left[0].y);
      for (const point of outline.left.slice(1)) ctx.lineTo(point.x, point.y);
      for (const point of [...outline.right].reverse()) ctx.lineTo(point.x, point.y);
      ctx.closePath(); ctx.fill();
      const firstRadius = Math.max(0.25, styles[0].width / 2), lastRadius = Math.max(0.25, styles[styles.length - 1].width / 2);
      ctx.beginPath(); ctx.arc(points[0].x, points[0].y, firstRadius, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(points[points.length - 1].x, points[points.length - 1].y, lastRadius, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.lineWidth = styles.reduce((total, style) => total + style.width, 0) / Math.max(1, styles.length);
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.restore();
  }`);

await writeFile(file, source);
console.log("Smooth continuous brush patch applied.");
