package work.heartful.canvas;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.Iterator;
import java.util.List;

/**
 * Small native drawing core built for low-latency pen input.
 *
 * Design rules:
 * - drawing never waits for network / WebView / JavaScript
 * - MotionEvent history is consumed so fast stylus movement does not become dotted
 * - completed strokes are vectors in world coordinates
 * - two fingers pan/zoom an effectively infinite canvas
 * - redraws are scheduled on the display frame clock (60/90/120Hz depending on device)
 */
public final class NativeCanvasView extends View {
    public enum Tool { PEN, ERASER }

    private static final int FILE_MAGIC = 0x434E5631; // CNV1
    private static final int MAX_STROKES = 20000;
    private static final int MAX_POINTS_PER_STROKE = 200000;
    private static final float MIN_SCALE = 0.08f;
    private static final float MAX_SCALE = 16f;
    private static final float GRID_STEP = 40f;

    private static final class Point {
        final float x;
        final float y;
        final float pressure;

        Point(float x, float y, float pressure) {
            this.x = x;
            this.y = y;
            this.pressure = pressure;
        }
    }

    private static final class Stroke {
        final ArrayList<Point> points = new ArrayList<>();
        final RectF bounds = new RectF();
        int color = Color.rgb(28, 32, 38);
        float baseWidth = 3.2f;

        void add(Point point) {
            points.add(point);
            float radius = baseWidth * 0.75f + 1f;
            if (points.size() == 1) {
                bounds.set(point.x - radius, point.y - radius, point.x + radius, point.y + radius);
            } else {
                bounds.union(point.x - radius, point.y - radius);
                bounds.union(point.x + radius, point.y + radius);
            }
        }
    }

    private static final class RemovedStroke {
        final Stroke stroke;
        final int index;

        RemovedStroke(Stroke stroke, int index) {
            this.stroke = stroke;
            this.index = index;
        }
    }

    private interface EditAction {
        void undo(ArrayList<Stroke> strokes);
        void redo(ArrayList<Stroke> strokes);
    }

    private static final class AddAction implements EditAction {
        final Stroke stroke;

        AddAction(Stroke stroke) { this.stroke = stroke; }

        @Override public void undo(ArrayList<Stroke> strokes) { strokes.remove(stroke); }
        @Override public void redo(ArrayList<Stroke> strokes) { strokes.add(stroke); }
    }

    private static final class EraseAction implements EditAction {
        final ArrayList<RemovedStroke> removed;

        EraseAction(ArrayList<RemovedStroke> removed) {
            this.removed = new ArrayList<>(removed);
            this.removed.sort(Comparator.comparingInt(item -> item.index));
        }

        @Override public void undo(ArrayList<Stroke> strokes) {
            for (RemovedStroke item : removed) {
                int at = Math.max(0, Math.min(item.index, strokes.size()));
                if (!strokes.contains(item.stroke)) strokes.add(at, item.stroke);
            }
        }

        @Override public void redo(ArrayList<Stroke> strokes) {
            for (RemovedStroke item : removed) strokes.remove(item.stroke);
        }
    }

    private final ArrayList<Stroke> strokes = new ArrayList<>();
    private final Deque<EditAction> undo = new ArrayDeque<>();
    private final Deque<EditAction> redo = new ArrayDeque<>();
    private final ArrayList<RemovedStroke> eraseGesture = new ArrayList<>();
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
    private final Paint gridPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint originPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF visibleWorld = new RectF();

    private Tool tool = Tool.PEN;
    private Stroke currentStroke;
    private boolean gridEnabled = true;
    private boolean navigationGesture = false;
    private boolean blockDrawUntilAllUp = false;
    private float scale = 1f;
    private float offsetX = 0f;
    private float offsetY = 0f;
    private float gestureStartScale;
    private float gestureStartDistance;
    private float gestureAnchorWorldX;
    private float gestureAnchorWorldY;

    public NativeCanvasView(Context context) { this(context, null); }

    public NativeCanvasView(Context context, AttributeSet attrs) {
        super(context, attrs);
        setBackgroundColor(Color.rgb(250, 250, 248));
        setFocusable(true);
        setFocusableInTouchMode(true);
        setLayerType(View.LAYER_TYPE_HARDWARE, null);

        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setStrokeCap(Paint.Cap.ROUND);
        strokePaint.setStrokeJoin(Paint.Join.ROUND);
        gridPaint.setColor(Color.rgb(224, 227, 230));
        gridPaint.setStyle(Paint.Style.STROKE);
        originPaint.setColor(Color.rgb(190, 196, 202));
        originPaint.setStyle(Paint.Style.STROKE);
    }

    public void setTool(Tool next) {
        tool = next == null ? Tool.PEN : next;
        invalidate();
    }

    public Tool getTool() { return tool; }

    public void setGridEnabled(boolean enabled) {
        gridEnabled = enabled;
        postInvalidateOnAnimation();
    }

    public boolean isGridEnabled() { return gridEnabled; }

    public void undo() {
        EditAction action = undo.pollLast();
        if (action == null) return;
        action.undo(strokes);
        redo.addLast(action);
        postInvalidateOnAnimation();
    }

    public void redo() {
        EditAction action = redo.pollLast();
        if (action == null) return;
        action.redo(strokes);
        undo.addLast(action);
        postInvalidateOnAnimation();
    }

    public void resetView() {
        scale = 1f;
        offsetX = getWidth() * 0.5f;
        offsetY = getHeight() * 0.5f;
        postInvalidateOnAnimation();
    }

    private void pushAction(EditAction action) {
        undo.addLast(action);
        while (undo.size() > 100) undo.removeFirst();
        redo.clear();
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (oldw == 0 && oldh == 0 && offsetX == 0f && offsetY == 0f) {
            offsetX = w * 0.5f;
            offsetY = h * 0.5f;
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        updateVisibleWorld();

        canvas.save();
        canvas.translate(offsetX, offsetY);
        canvas.scale(scale, scale);
        if (gridEnabled) drawGrid(canvas);
        drawStrokes(canvas);
        if (currentStroke != null && currentStroke.points.size() > 0) drawStroke(canvas, currentStroke);
        canvas.restore();
    }

    private void updateVisibleWorld() {
        float left = -offsetX / scale;
        float top = -offsetY / scale;
        float right = (getWidth() - offsetX) / scale;
        float bottom = (getHeight() - offsetY) / scale;
        visibleWorld.set(Math.min(left, right), Math.min(top, bottom), Math.max(left, right), Math.max(top, bottom));
    }

    private void drawGrid(Canvas canvas) {
        float minor = GRID_STEP;
        float major = GRID_STEP * 5f;
        float startX = (float)Math.floor(visibleWorld.left / minor) * minor;
        float endX = (float)Math.ceil(visibleWorld.right / minor) * minor;
        float startY = (float)Math.floor(visibleWorld.top / minor) * minor;
        float endY = (float)Math.ceil(visibleWorld.bottom / minor) * minor;

        gridPaint.setStrokeWidth(1f / scale);
        for (float x = startX; x <= endX; x += minor) {
            boolean isMajor = Math.abs(x / major - Math.round(x / major)) < 0.001f;
            gridPaint.setAlpha(isMajor ? 120 : 52);
            canvas.drawLine(x, visibleWorld.top, x, visibleWorld.bottom, gridPaint);
        }
        for (float y = startY; y <= endY; y += minor) {
            boolean isMajor = Math.abs(y / major - Math.round(y / major)) < 0.001f;
            gridPaint.setAlpha(isMajor ? 120 : 52);
            canvas.drawLine(visibleWorld.left, y, visibleWorld.right, y, gridPaint);
        }

        originPaint.setStrokeWidth(1.25f / scale);
        originPaint.setAlpha(115);
        if (visibleWorld.left <= 0 && visibleWorld.right >= 0) {
            canvas.drawLine(0, visibleWorld.top, 0, visibleWorld.bottom, originPaint);
        }
        if (visibleWorld.top <= 0 && visibleWorld.bottom >= 0) {
            canvas.drawLine(visibleWorld.left, 0, visibleWorld.right, 0, originPaint);
        }
    }

    private void drawStrokes(Canvas canvas) {
        for (Stroke stroke : strokes) {
            if (RectF.intersects(stroke.bounds, visibleWorld)) drawStroke(canvas, stroke);
        }
    }

    private void drawStroke(Canvas canvas, Stroke stroke) {
        List<Point> points = stroke.points;
        if (points.isEmpty()) return;
        strokePaint.setColor(stroke.color);
        strokePaint.setAlpha(255);

        if (points.size() == 1) {
            Point p = points.get(0);
            float width = pressureWidth(stroke.baseWidth, p.pressure);
            strokePaint.setStyle(Paint.Style.FILL);
            canvas.drawCircle(p.x, p.y, width * 0.5f, strokePaint);
            strokePaint.setStyle(Paint.Style.STROKE);
            return;
        }

        Point previous = points.get(0);
        for (int i = 1; i < points.size(); i++) {
            Point next = points.get(i);
            float width = (pressureWidth(stroke.baseWidth, previous.pressure)
                + pressureWidth(stroke.baseWidth, next.pressure)) * 0.5f;
            strokePaint.setStrokeWidth(width);
            canvas.drawLine(previous.x, previous.y, next.x, next.y, strokePaint);
            previous = next;
        }
    }

    private static float pressureWidth(float base, float pressure) {
        float p = Math.max(0.05f, Math.min(1f, pressure));
        return base * (0.32f + 0.68f * p);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        getParent().requestDisallowInterceptTouchEvent(true);
        int action = event.getActionMasked();

        if (action == MotionEvent.ACTION_POINTER_DOWN && event.getPointerCount() >= 2) {
            finishStroke();
            finishEraseGesture();
            beginNavigation(event);
            navigationGesture = true;
            blockDrawUntilAllUp = true;
            return true;
        }

        if (navigationGesture) {
            if (action == MotionEvent.ACTION_MOVE && event.getPointerCount() >= 2) {
                updateNavigation(event);
                return true;
            }
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                navigationGesture = false;
                blockDrawUntilAllUp = false;
                return true;
            }
            if (action == MotionEvent.ACTION_POINTER_UP && event.getPointerCount() <= 2) {
                navigationGesture = false;
                return true;
            }
            return true;
        }

        if (blockDrawUntilAllUp) {
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) blockDrawUntilAllUp = false;
            return true;
        }

        switch (action) {
            case MotionEvent.ACTION_DOWN:
                if (tool == Tool.PEN) {
                    currentStroke = new Stroke();
                    addEventPoints(event, currentStroke);
                } else {
                    eraseGesture.clear();
                    eraseAt(event.getX(), event.getY());
                }
                postInvalidateOnAnimation();
                return true;

            case MotionEvent.ACTION_MOVE:
                if (tool == Tool.PEN && currentStroke != null) {
                    addEventPoints(event, currentStroke);
                } else if (tool == Tool.ERASER) {
                    for (int h = 0; h < event.getHistorySize(); h++) {
                        eraseAt(event.getHistoricalX(0, h), event.getHistoricalY(0, h));
                    }
                    eraseAt(event.getX(), event.getY());
                }
                postInvalidateOnAnimation();
                return true;

            case MotionEvent.ACTION_UP:
                if (tool == Tool.PEN && currentStroke != null) {
                    addEventPoints(event, currentStroke);
                    finishStroke();
                } else {
                    eraseAt(event.getX(), event.getY());
                    finishEraseGesture();
                }
                postInvalidateOnAnimation();
                performClick();
                return true;

            case MotionEvent.ACTION_CANCEL:
                finishStroke();
                finishEraseGesture();
                return true;

            default:
                return true;
        }
    }

    @Override
    public boolean performClick() {
        super.performClick();
        return true;
    }

    private void addEventPoints(MotionEvent event, Stroke stroke) {
        int pointer = 0;
        for (int h = 0; h < event.getHistorySize(); h++) {
            addScreenPoint(stroke,
                event.getHistoricalX(pointer, h),
                event.getHistoricalY(pointer, h),
                normalizedPressure(event.getHistoricalPressure(pointer, h), event.getToolType(pointer)));
        }
        addScreenPoint(stroke, event.getX(pointer), event.getY(pointer),
            normalizedPressure(event.getPressure(pointer), event.getToolType(pointer)));
    }

    private static float normalizedPressure(float raw, int toolType) {
        if (toolType != MotionEvent.TOOL_TYPE_STYLUS && toolType != MotionEvent.TOOL_TYPE_ERASER) return 1f;
        if (!Float.isFinite(raw) || raw <= 0f) return 0.55f;
        return Math.max(0.05f, Math.min(1f, raw));
    }

    private void addScreenPoint(Stroke stroke, float screenX, float screenY, float pressure) {
        float x = (screenX - offsetX) / scale;
        float y = (screenY - offsetY) / scale;
        List<Point> points = stroke.points;
        if (!points.isEmpty()) {
            Point last = points.get(points.size() - 1);
            float dx = x - last.x;
            float dy = y - last.y;
            float minWorldDistance = 0.35f / scale;
            if (dx * dx + dy * dy < minWorldDistance * minWorldDistance) return;

            // Very light adaptive filtering: enough to remove sensor chatter without adding pen lag.
            float distanceScreen = (float)Math.sqrt(dx * dx + dy * dy) * scale;
            float alpha = Math.max(0.72f, Math.min(0.94f, distanceScreen / 18f));
            x = last.x + (x - last.x) * alpha;
            y = last.y + (y - last.y) * alpha;
            pressure = last.pressure + (pressure - last.pressure) * 0.72f;
        }
        stroke.add(new Point(x, y, pressure));
    }

    private void finishStroke() {
        if (currentStroke == null) return;
        if (!currentStroke.points.isEmpty()) {
            strokes.add(currentStroke);
            pushAction(new AddAction(currentStroke));
        }
        currentStroke = null;
    }

    private void eraseAt(float screenX, float screenY) {
        float x = (screenX - offsetX) / scale;
        float y = (screenY - offsetY) / scale;
        float radius = 22f / scale;
        float radius2 = radius * radius;

        for (int i = strokes.size() - 1; i >= 0; i--) {
            Stroke stroke = strokes.get(i);
            RectF hitBounds = new RectF(stroke.bounds);
            hitBounds.inset(-radius, -radius);
            if (!hitBounds.contains(x, y)) continue;
            boolean hit = false;
            for (Point point : stroke.points) {
                float dx = point.x - x;
                float dy = point.y - y;
                if (dx * dx + dy * dy <= radius2) {
                    hit = true;
                    break;
                }
            }
            if (hit) {
                strokes.remove(i);
                boolean already = false;
                for (RemovedStroke item : eraseGesture) {
                    if (item.stroke == stroke) { already = true; break; }
                }
                if (!already) eraseGesture.add(new RemovedStroke(stroke, i));
            }
        }
    }

    private void finishEraseGesture() {
        if (!eraseGesture.isEmpty()) {
            pushAction(new EraseAction(eraseGesture));
            eraseGesture.clear();
        }
    }

    private void beginNavigation(MotionEvent event) {
        float midX = (event.getX(0) + event.getX(1)) * 0.5f;
        float midY = (event.getY(0) + event.getY(1)) * 0.5f;
        gestureStartScale = scale;
        gestureStartDistance = Math.max(1f, pointerDistance(event));
        gestureAnchorWorldX = (midX - offsetX) / scale;
        gestureAnchorWorldY = (midY - offsetY) / scale;
    }

    private void updateNavigation(MotionEvent event) {
        float midX = (event.getX(0) + event.getX(1)) * 0.5f;
        float midY = (event.getY(0) + event.getY(1)) * 0.5f;
        float ratio = pointerDistance(event) / gestureStartDistance;
        float nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, gestureStartScale * ratio));
        scale = nextScale;
        offsetX = midX - gestureAnchorWorldX * scale;
        offsetY = midY - gestureAnchorWorldY * scale;
        postInvalidateOnAnimation();
    }

    private static float pointerDistance(MotionEvent event) {
        if (event.getPointerCount() < 2) return 1f;
        float dx = event.getX(0) - event.getX(1);
        float dy = event.getY(0) - event.getY(1);
        return (float)Math.sqrt(dx * dx + dy * dy);
    }

    public synchronized void save(File file) {
        File temp = new File(file.getParentFile(), file.getName() + ".tmp");
        try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(temp)))) {
            out.writeInt(FILE_MAGIC);
            out.writeFloat(scale);
            out.writeFloat(offsetX);
            out.writeFloat(offsetY);
            out.writeBoolean(gridEnabled);
            out.writeInt(strokes.size());
            for (Stroke stroke : strokes) {
                out.writeInt(stroke.color);
                out.writeFloat(stroke.baseWidth);
                out.writeInt(stroke.points.size());
                for (Point point : stroke.points) {
                    out.writeFloat(point.x);
                    out.writeFloat(point.y);
                    out.writeFloat(point.pressure);
                }
            }
            out.flush();
        } catch (Exception ignored) {
            // Keep the previous autosave intact if a write is interrupted.
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
            return;
        }
        if (!temp.renameTo(file)) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            //noinspection ResultOfMethodCallIgnored
            temp.renameTo(file);
        }
    }

    public synchronized void load(File file) {
        if (!file.isFile()) return;
        ArrayList<Stroke> loaded = new ArrayList<>();
        try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(file)))) {
            if (in.readInt() != FILE_MAGIC) return;
            float loadedScale = in.readFloat();
            float loadedOffsetX = in.readFloat();
            float loadedOffsetY = in.readFloat();
            boolean loadedGrid = in.readBoolean();
            int strokeCount = in.readInt();
            if (strokeCount < 0 || strokeCount > MAX_STROKES) return;
            for (int s = 0; s < strokeCount; s++) {
                Stroke stroke = new Stroke();
                stroke.color = in.readInt();
                stroke.baseWidth = in.readFloat();
                int pointCount = in.readInt();
                if (pointCount < 0 || pointCount > MAX_POINTS_PER_STROKE) return;
                for (int p = 0; p < pointCount; p++) {
                    stroke.add(new Point(in.readFloat(), in.readFloat(), in.readFloat()));
                }
                loaded.add(stroke);
            }
            if (!Float.isFinite(loadedScale) || loadedScale < MIN_SCALE || loadedScale > MAX_SCALE) return;
            if (!Float.isFinite(loadedOffsetX) || !Float.isFinite(loadedOffsetY)) return;
            strokes.clear();
            strokes.addAll(loaded);
            scale = loadedScale;
            offsetX = loadedOffsetX;
            offsetY = loadedOffsetY;
            gridEnabled = loadedGrid;
            undo.clear();
            redo.clear();
            postInvalidateOnAnimation();
        } catch (Exception ignored) {
            // Corrupt/incomplete autosave is ignored rather than blocking app startup.
        }
    }
}
