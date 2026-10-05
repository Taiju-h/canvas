package work.heartful.canvas;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
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
import java.util.Deque;
import java.util.List;

/**
 * Native low-latency Canvas core for Android.
 *
 * The app intentionally keeps pen input local/native. Keyboard shortcuts mirror
 * Photoshop where possible, while S Pen side-button input is treated as a
 * momentary eraser. Ctrl + side-button removes whole strokes/objects.
 */
public final class NativeCanvasView extends View {
    public enum Tool {
        PEN,
        ERASER,
        RECT_SELECT,
        ELLIPSE_SELECT,
        LASSO_SELECT,
        QUICK_SELECT,
        FILL,
        MOVE,
        VECTOR_PEN,
        HAND,
        ZOOM,
        EYEDROPPER
    }

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
            include(point);
        }

        void include(Point point) {
            float radius = baseWidth * 0.75f + 1f;
            if (points.size() == 1) {
                bounds.set(point.x - radius, point.y - radius, point.x + radius, point.y + radius);
            } else {
                bounds.union(point.x - radius, point.y - radius);
                bounds.union(point.x + radius, point.y + radius);
            }
        }

        Stroke copy() {
            Stroke out = new Stroke();
            out.color = color;
            out.baseWidth = baseWidth;
            for (Point point : points) out.add(new Point(point.x, point.y, point.pressure));
            return out;
        }

        void translate(float dx, float dy) {
            if (dx == 0f && dy == 0f) return;
            ArrayList<Point> moved = new ArrayList<>(points.size());
            for (Point point : points) moved.add(new Point(point.x + dx, point.y + dy, point.pressure));
            points.clear();
            bounds.setEmpty();
            for (Point point : moved) add(point);
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

    private static final class SnapshotAction implements EditAction {
        final ArrayList<Stroke> before;
        final ArrayList<Stroke> after;

        SnapshotAction(List<Stroke> before, List<Stroke> after) {
            this.before = deepCopy(before);
            this.after = deepCopy(after);
        }

        @Override public void undo(ArrayList<Stroke> strokes) {
            replace(strokes, before);
        }

        @Override public void redo(ArrayList<Stroke> strokes) {
            replace(strokes, after);
        }
    }

    private final ArrayList<Stroke> strokes = new ArrayList<>();
    private final ArrayList<Stroke> selection = new ArrayList<>();
    private final ArrayList<Stroke> clipboard = new ArrayList<>();
    private final Deque<EditAction> undo = new ArrayDeque<>();
    private final Deque<EditAction> redo = new ArrayDeque<>();
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
    private final Paint gridPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint originPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint selectionPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF visibleWorld = new RectF();
    private final RectF selectionRect = new RectF();
    private final ArrayList<Point> lasso = new ArrayList<>();

    private Tool tool = Tool.PEN;
    private Stroke currentStroke;
    private boolean gridEnabled = true;
    private boolean navigationGesture = false;
    private boolean blockDrawUntilAllUp = false;
    private boolean ctrlPressed = false;
    private boolean selecting = false;
    private boolean movingSelection = false;
    private boolean oneFingerPanning = false;
    private boolean zoomDragging = false;
    private ArrayList<Stroke> gestureBefore;
    private float scale = 1f;
    private float offsetX = 0f;
    private float offsetY = 0f;
    private float gestureStartScale;
    private float gestureStartDistance;
    private float gestureAnchorWorldX;
    private float gestureAnchorWorldY;
    private float lastWorldX;
    private float lastWorldY;
    private float lastScreenX;
    private float lastScreenY;
    private float zoomStartY;
    private float zoomStartScale;
    private float currentBrushWidth = 3.2f;
    private int currentColor = Color.rgb(28, 32, 38);

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
        selectionPaint.setColor(Color.rgb(32, 95, 232));
        selectionPaint.setStyle(Paint.Style.STROKE);
    }

    public void setTool(Tool next) {
        finishTransientGesture();
        tool = next == null ? Tool.PEN : next;
        postInvalidateOnAnimation();
    }

    public Tool getTool() { return tool; }

    public String getToolDisplayName() {
        switch (tool) {
            case PEN: return "B ブラシ";
            case ERASER: return "E 消しゴム";
            case RECT_SELECT: return "M 四角選択";
            case ELLIPSE_SELECT: return "M 丸選択";
            case LASSO_SELECT: return "L 投げ縄";
            case QUICK_SELECT: return "W クイック選択";
            case FILL: return "G 塗りつぶし";
            case MOVE: return "V 移動";
            case VECTOR_PEN: return "P ベクターペン";
            case HAND: return "H 手のひら";
            case ZOOM: return "Z ズーム";
            case EYEDROPPER: return "I スポイト";
            default: return tool.name();
        }
    }

    public void setCtrlPressed(boolean pressed) {
        ctrlPressed = pressed;
    }

    public void setGridEnabled(boolean enabled) {
        gridEnabled = enabled;
        postInvalidateOnAnimation();
    }

    public boolean isGridEnabled() { return gridEnabled; }

    public void adjustBrushSize(int direction) {
        float step = currentBrushWidth < 6f ? 0.5f : 1f;
        currentBrushWidth = clamp(currentBrushWidth + Math.signum(direction) * step, 0.5f, 80f);
    }

    public void selectAll() {
        selection.clear();
        selection.addAll(strokes);
        postInvalidateOnAnimation();
    }

    public void clearSelection() {
        selection.clear();
        postInvalidateOnAnimation();
    }

    public void copySelection() {
        clipboard.clear();
        for (Stroke stroke : selection) clipboard.add(stroke.copy());
    }

    public void cutSelection() {
        if (selection.isEmpty()) return;
        copySelection();
        deleteSelection();
    }

    public void pasteSelection() {
        if (clipboard.isEmpty()) return;
        ArrayList<Stroke> before = deepCopy(strokes);
        selection.clear();
        float delta = 24f / scale;
        for (Stroke source : clipboard) {
            Stroke copy = source.copy();
            copy.translate(delta, delta);
            strokes.add(copy);
            selection.add(copy);
        }
        pushAction(new SnapshotAction(before, strokes));
        postInvalidateOnAnimation();
    }

    public void deleteSelection() {
        if (selection.isEmpty()) return;
        ArrayList<Stroke> before = deepCopy(strokes);
        strokes.removeAll(selection);
        selection.clear();
        pushAction(new SnapshotAction(before, strokes));
        postInvalidateOnAnimation();
    }

    public void undo() {
        EditAction action = undo.pollLast();
        if (action == null) return;
        action.undo(strokes);
        selection.clear();
        redo.addLast(action);
        postInvalidateOnAnimation();
    }

    public void redo() {
        EditAction action = redo.pollLast();
        if (action == null) return;
        action.redo(strokes);
        selection.clear();
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
        if (currentStroke != null && !currentStroke.points.isEmpty()) drawStroke(canvas, currentStroke);
        drawSelection(canvas);
        drawSelectionGesture(canvas);
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

    private void drawSelection(Canvas canvas) {
        if (selection.isEmpty()) return;
        selectionPaint.setStrokeWidth(1.5f / scale);
        selectionPaint.setAlpha(210);
        for (Stroke stroke : selection) {
            RectF b = new RectF(stroke.bounds);
            b.inset(-4f / scale, -4f / scale);
            canvas.drawRect(b, selectionPaint);
        }
    }

    private void drawSelectionGesture(Canvas canvas) {
        if (!selecting) return;
        selectionPaint.setStrokeWidth(1.5f / scale);
        selectionPaint.setAlpha(180);
        if (tool == Tool.RECT_SELECT) {
            canvas.drawRect(selectionRect, selectionPaint);
        } else if (tool == Tool.ELLIPSE_SELECT) {
            canvas.drawOval(selectionRect, selectionPaint);
        } else if (tool == Tool.LASSO_SELECT && lasso.size() > 1) {
            Path path = new Path();
            path.moveTo(lasso.get(0).x, lasso.get(0).y);
            for (int i = 1; i < lasso.size(); i++) path.lineTo(lasso.get(i).x, lasso.get(i).y);
            canvas.drawPath(path, selectionPaint);
        }
    }

    private static float pressureWidth(float base, float pressure) {
        float p = clamp(pressure, 0.05f, 1f);
        return base * (0.32f + 0.68f * p);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        requestFocus();
        getParent().requestDisallowInterceptTouchEvent(true);
        int action = event.getActionMasked();

        if (action == MotionEvent.ACTION_POINTER_DOWN && event.getPointerCount() >= 2) {
            finishStroke();
            finishComplexEdit();
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

        boolean sideButton = isStylusSideButton(event);
        boolean effectiveCtrl = ctrlPressed || (event.getMetaState() & android.view.KeyEvent.META_CTRL_ON) != 0;
        Tool effectiveTool = sideButton ? Tool.ERASER : tool;
        boolean wholeObjectErase = effectiveTool == Tool.ERASER && effectiveCtrl;

        switch (action) {
            case MotionEvent.ACTION_DOWN:
                return onPrimaryDown(event, effectiveTool, wholeObjectErase);
            case MotionEvent.ACTION_MOVE:
                return onPrimaryMove(event, effectiveTool, wholeObjectErase);
            case MotionEvent.ACTION_UP:
                return onPrimaryUp(event, effectiveTool, wholeObjectErase);
            case MotionEvent.ACTION_CANCEL:
                finishStroke();
                finishComplexEdit();
                selecting = false;
                lasso.clear();
                postInvalidateOnAnimation();
                return true;
            default:
                return true;
        }
    }

    private boolean onPrimaryDown(MotionEvent event, Tool effectiveTool, boolean wholeObjectErase) {
        float sx = event.getX();
        float sy = event.getY();
        float wx = screenToWorldX(sx);
        float wy = screenToWorldY(sy);

        switch (effectiveTool) {
            case PEN:
            case VECTOR_PEN:
                currentStroke = new Stroke();
                currentStroke.color = currentColor;
                currentStroke.baseWidth = currentBrushWidth;
                addEventPoints(event, currentStroke, effectiveTool == Tool.VECTOR_PEN);
                break;
            case ERASER:
                gestureBefore = deepCopy(strokes);
                if (wholeObjectErase) eraseWholeAt(sx, sy); else erasePartialAt(sx, sy);
                break;
            case RECT_SELECT:
            case ELLIPSE_SELECT:
                selecting = true;
                selectionRect.set(wx, wy, wx, wy);
                break;
            case LASSO_SELECT:
                selecting = true;
                lasso.clear();
                lasso.add(new Point(wx, wy, 1f));
                break;
            case QUICK_SELECT:
                quickSelect(sx, sy);
                break;
            case FILL:
                fillAt(sx, sy);
                break;
            case MOVE:
                if (selection.isEmpty()) quickSelect(sx, sy);
                if (!selection.isEmpty()) {
                    gestureBefore = deepCopy(strokes);
                    movingSelection = true;
                    lastWorldX = wx;
                    lastWorldY = wy;
                }
                break;
            case HAND:
                oneFingerPanning = true;
                lastScreenX = sx;
                lastScreenY = sy;
                break;
            case ZOOM:
                zoomDragging = true;
                zoomStartY = sy;
                zoomStartScale = scale;
                break;
            case EYEDROPPER:
                pickColorAt(sx, sy);
                break;
            default:
                break;
        }
        postInvalidateOnAnimation();
        return true;
    }

    private boolean onPrimaryMove(MotionEvent event, Tool effectiveTool, boolean wholeObjectErase) {
        float sx = event.getX();
        float sy = event.getY();
        float wx = screenToWorldX(sx);
        float wy = screenToWorldY(sy);

        if ((effectiveTool == Tool.PEN || effectiveTool == Tool.VECTOR_PEN) && currentStroke != null) {
            addEventPoints(event, currentStroke, effectiveTool == Tool.VECTOR_PEN);
        } else if (effectiveTool == Tool.ERASER) {
            for (int h = 0; h < event.getHistorySize(); h++) {
                float hx = event.getHistoricalX(0, h);
                float hy = event.getHistoricalY(0, h);
                if (wholeObjectErase) eraseWholeAt(hx, hy); else erasePartialAt(hx, hy);
            }
            if (wholeObjectErase) eraseWholeAt(sx, sy); else erasePartialAt(sx, sy);
        } else if ((tool == Tool.RECT_SELECT || tool == Tool.ELLIPSE_SELECT) && selecting) {
            selectionRect.right = wx;
            selectionRect.bottom = wy;
            normalize(selectionRect);
        } else if (tool == Tool.LASSO_SELECT && selecting) {
            if (lasso.isEmpty() || distance2(lasso.get(lasso.size() - 1), wx, wy) > (2f / scale) * (2f / scale)) {
                lasso.add(new Point(wx, wy, 1f));
            }
        } else if (tool == Tool.MOVE && movingSelection) {
            float dx = wx - lastWorldX;
            float dy = wy - lastWorldY;
            for (Stroke stroke : selection) stroke.translate(dx, dy);
            lastWorldX = wx;
            lastWorldY = wy;
        } else if (tool == Tool.HAND && oneFingerPanning) {
            offsetX += sx - lastScreenX;
            offsetY += sy - lastScreenY;
            lastScreenX = sx;
            lastScreenY = sy;
        } else if (tool == Tool.ZOOM && zoomDragging) {
            float factor = (float)Math.exp((zoomStartY - sy) / 240f);
            scaleAround(sx, sy, clamp(zoomStartScale * factor, MIN_SCALE, MAX_SCALE));
        }
        postInvalidateOnAnimation();
        return true;
    }

    private boolean onPrimaryUp(MotionEvent event, Tool effectiveTool, boolean wholeObjectErase) {
        float sx = event.getX();
        float sy = event.getY();
        float wx = screenToWorldX(sx);
        float wy = screenToWorldY(sy);

        if ((effectiveTool == Tool.PEN || effectiveTool == Tool.VECTOR_PEN) && currentStroke != null) {
            addEventPoints(event, currentStroke, effectiveTool == Tool.VECTOR_PEN);
            finishStroke();
        } else if (effectiveTool == Tool.ERASER) {
            if (wholeObjectErase) eraseWholeAt(sx, sy); else erasePartialAt(sx, sy);
            finishComplexEdit();
        } else if ((tool == Tool.RECT_SELECT || tool == Tool.ELLIPSE_SELECT) && selecting) {
            selectionRect.right = wx;
            selectionRect.bottom = wy;
            normalize(selectionRect);
            finishBoxSelection(tool == Tool.ELLIPSE_SELECT);
        } else if (tool == Tool.LASSO_SELECT && selecting) {
            lasso.add(new Point(wx, wy, 1f));
            finishLassoSelection();
        } else if (tool == Tool.MOVE && movingSelection) {
            movingSelection = false;
            finishComplexEdit();
        } else if (tool == Tool.HAND) {
            oneFingerPanning = false;
        } else if (tool == Tool.ZOOM) {
            zoomDragging = false;
        }

        selecting = false;
        postInvalidateOnAnimation();
        performClick();
        return true;
    }

    private boolean isStylusSideButton(MotionEvent event) {
        int buttonState = event.getButtonState();
        int stylusButtons = MotionEvent.BUTTON_STYLUS_PRIMARY | MotionEvent.BUTTON_STYLUS_SECONDARY;
        return (buttonState & stylusButtons) != 0;
    }

    @Override
    public boolean performClick() {
        super.performClick();
        return true;
    }

    private void addEventPoints(MotionEvent event, Stroke stroke, boolean fixedPressure) {
        int pointer = 0;
        for (int h = 0; h < event.getHistorySize(); h++) {
            float pressure = fixedPressure ? 1f
                : normalizedPressure(event.getHistoricalPressure(pointer, h), event.getToolType(pointer));
            addScreenPoint(stroke, event.getHistoricalX(pointer, h), event.getHistoricalY(pointer, h), pressure);
        }
        float pressure = fixedPressure ? 1f : normalizedPressure(event.getPressure(pointer), event.getToolType(pointer));
        addScreenPoint(stroke, event.getX(pointer), event.getY(pointer), pressure);
    }

    private static float normalizedPressure(float raw, int toolType) {
        if (toolType != MotionEvent.TOOL_TYPE_STYLUS && toolType != MotionEvent.TOOL_TYPE_ERASER) return 1f;
        if (!Float.isFinite(raw) || raw <= 0f) return 0.55f;
        return clamp(raw, 0.05f, 1f);
    }

    private void addScreenPoint(Stroke stroke, float screenX, float screenY, float pressure) {
        float x = screenToWorldX(screenX);
        float y = screenToWorldY(screenY);
        List<Point> points = stroke.points;
        if (!points.isEmpty()) {
            Point last = points.get(points.size() - 1);
            float dx = x - last.x;
            float dy = y - last.y;
            float minWorldDistance = 0.35f / scale;
            if (dx * dx + dy * dy < minWorldDistance * minWorldDistance) return;

            float distanceScreen = (float)Math.sqrt(dx * dx + dy * dy) * scale;
            float alpha = clamp(distanceScreen / 18f, 0.72f, 0.94f);
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

    private void eraseWholeAt(float screenX, float screenY) {
        Stroke hit = findTopmostStroke(screenX, screenY, 22f);
        if (hit != null) {
            selection.remove(hit);
            strokes.remove(hit);
        }
    }

    private void erasePartialAt(float screenX, float screenY) {
        float x = screenToWorldX(screenX);
        float y = screenToWorldY(screenY);
        float radius = 22f / scale;
        float radius2 = radius * radius;

        for (int i = strokes.size() - 1; i >= 0; i--) {
            Stroke stroke = strokes.get(i);
            RectF hitBounds = new RectF(stroke.bounds);
            hitBounds.inset(-radius, -radius);
            if (!hitBounds.contains(x, y)) continue;

            boolean hasHit = false;
            for (Point point : stroke.points) {
                float dx = point.x - x;
                float dy = point.y - y;
                if (dx * dx + dy * dy <= radius2) {
                    hasHit = true;
                    break;
                }
            }
            if (!hasHit) continue;

            boolean wasSelected = selection.remove(stroke);
            ArrayList<Stroke> pieces = splitStrokeOutsideCircle(stroke, x, y, radius2);
            strokes.remove(i);
            if (!pieces.isEmpty()) {
                strokes.addAll(i, pieces);
                if (wasSelected) selection.addAll(pieces);
            }
        }
    }

    private static ArrayList<Stroke> splitStrokeOutsideCircle(Stroke source, float x, float y, float radius2) {
        ArrayList<Stroke> pieces = new ArrayList<>();
        Stroke current = null;
        for (Point point : source.points) {
            float dx = point.x - x;
            float dy = point.y - y;
            boolean erased = dx * dx + dy * dy <= radius2;
            if (erased) {
                if (current != null && !current.points.isEmpty()) pieces.add(current);
                current = null;
            } else {
                if (current == null) {
                    current = new Stroke();
                    current.color = source.color;
                    current.baseWidth = source.baseWidth;
                }
                current.add(new Point(point.x, point.y, point.pressure));
            }
        }
        if (current != null && !current.points.isEmpty()) pieces.add(current);
        return pieces;
    }

    private void quickSelect(float screenX, float screenY) {
        Stroke hit = findTopmostStroke(screenX, screenY, 14f);
        selection.clear();
        if (hit != null) selection.add(hit);
        postInvalidateOnAnimation();
    }

    private void finishBoxSelection(boolean ellipse) {
        selection.clear();
        if (selectionRect.width() < 0.001f && selectionRect.height() < 0.001f) return;
        float cx = selectionRect.centerX();
        float cy = selectionRect.centerY();
        float rx = Math.max(0.001f, selectionRect.width() * 0.5f);
        float ry = Math.max(0.001f, selectionRect.height() * 0.5f);
        for (Stroke stroke : strokes) {
            if (!ellipse) {
                if (RectF.intersects(selectionRect, stroke.bounds)) selection.add(stroke);
            } else {
                float sx = stroke.bounds.centerX();
                float sy = stroke.bounds.centerY();
                float nx = (sx - cx) / rx;
                float ny = (sy - cy) / ry;
                if (nx * nx + ny * ny <= 1f) selection.add(stroke);
            }
        }
    }

    private void finishLassoSelection() {
        selection.clear();
        if (lasso.size() < 3) {
            lasso.clear();
            return;
        }
        for (Stroke stroke : strokes) {
            if (pointInPolygon(stroke.bounds.centerX(), stroke.bounds.centerY(), lasso)) selection.add(stroke);
        }
        lasso.clear();
    }

    private void fillAt(float screenX, float screenY) {
        Stroke hit = findTopmostStroke(screenX, screenY, 14f);
        if (hit == null || hit.color == currentColor) return;
        ArrayList<Stroke> before = deepCopy(strokes);
        hit.color = currentColor;
        pushAction(new SnapshotAction(before, strokes));
    }

    private void pickColorAt(float screenX, float screenY) {
        Stroke hit = findTopmostStroke(screenX, screenY, 14f);
        if (hit != null) currentColor = hit.color;
    }

    private Stroke findTopmostStroke(float screenX, float screenY, float screenRadius) {
        float x = screenToWorldX(screenX);
        float y = screenToWorldY(screenY);
        float radius = screenRadius / scale;
        float radius2 = radius * radius;
        for (int i = strokes.size() - 1; i >= 0; i--) {
            Stroke stroke = strokes.get(i);
            RectF hitBounds = new RectF(stroke.bounds);
            hitBounds.inset(-radius, -radius);
            if (!hitBounds.contains(x, y)) continue;
            for (Point point : stroke.points) {
                float dx = point.x - x;
                float dy = point.y - y;
                if (dx * dx + dy * dy <= radius2) return stroke;
            }
        }
        return null;
    }

    private void finishComplexEdit() {
        if (gestureBefore == null) return;
        if (!sameGeometry(gestureBefore, strokes)) pushAction(new SnapshotAction(gestureBefore, strokes));
        gestureBefore = null;
    }

    private void finishTransientGesture() {
        finishStroke();
        finishComplexEdit();
        selecting = false;
        movingSelection = false;
        oneFingerPanning = false;
        zoomDragging = false;
        lasso.clear();
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
        scale = clamp(gestureStartScale * ratio, MIN_SCALE, MAX_SCALE);
        offsetX = midX - gestureAnchorWorldX * scale;
        offsetY = midY - gestureAnchorWorldY * scale;
        postInvalidateOnAnimation();
    }

    private void scaleAround(float screenX, float screenY, float nextScale) {
        float worldX = screenToWorldX(screenX);
        float worldY = screenToWorldY(screenY);
        scale = nextScale;
        offsetX = screenX - worldX * scale;
        offsetY = screenY - worldY * scale;
    }

    private static float pointerDistance(MotionEvent event) {
        if (event.getPointerCount() < 2) return 1f;
        float dx = event.getX(0) - event.getX(1);
        float dy = event.getY(0) - event.getY(1);
        return (float)Math.sqrt(dx * dx + dy * dy);
    }

    private float screenToWorldX(float screenX) { return (screenX - offsetX) / scale; }
    private float screenToWorldY(float screenY) { return (screenY - offsetY) / scale; }

    private static void normalize(RectF rect) {
        float left = Math.min(rect.left, rect.right);
        float right = Math.max(rect.left, rect.right);
        float top = Math.min(rect.top, rect.bottom);
        float bottom = Math.max(rect.top, rect.bottom);
        rect.set(left, top, right, bottom);
    }

    private static float distance2(Point point, float x, float y) {
        float dx = point.x - x;
        float dy = point.y - y;
        return dx * dx + dy * dy;
    }

    private static boolean pointInPolygon(float x, float y, List<Point> polygon) {
        boolean inside = false;
        for (int i = 0, j = polygon.size() - 1; i < polygon.size(); j = i++) {
            Point a = polygon.get(i);
            Point b = polygon.get(j);
            boolean intersects = ((a.y > y) != (b.y > y))
                && (x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) == 0f ? 0.00001f : (b.y - a.y)) + a.x);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    private static ArrayList<Stroke> deepCopy(List<Stroke> source) {
        ArrayList<Stroke> out = new ArrayList<>(source.size());
        for (Stroke stroke : source) out.add(stroke.copy());
        return out;
    }

    private static void replace(ArrayList<Stroke> target, List<Stroke> source) {
        target.clear();
        for (Stroke stroke : source) target.add(stroke.copy());
    }

    private static boolean sameGeometry(List<Stroke> a, List<Stroke> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            Stroke x = a.get(i);
            Stroke y = b.get(i);
            if (x.color != y.color || x.baseWidth != y.baseWidth || x.points.size() != y.points.size()) return false;
            if (x.points.isEmpty()) continue;
            Point xp = x.points.get(0);
            Point yp = y.points.get(0);
            Point xl = x.points.get(x.points.size() - 1);
            Point yl = y.points.get(y.points.size() - 1);
            if (xp.x != yp.x || xp.y != yp.y || xl.x != yl.x || xl.y != yl.y) return false;
        }
        return true;
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
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
            selection.clear();
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
