package work.heartful.canvas;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.File;

public class MainActivity extends Activity {
    private NativeCanvasView canvas;
    private Button penButton;
    private Button eraserButton;
    private Button gridButton;
    private TextView hint;
    private File autosave;
    private NativeCanvasView.Tool toolBeforeSpace;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        configureWindowColors();

        autosave = new File(getFilesDir(), "native-canvas-v1.bin");
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(250, 250, 248));

        canvas = new NativeCanvasView(this);
        root.addView(canvas, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout toolbar = buildToolbar();
        FrameLayout.LayoutParams toolsLayout = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        toolsLayout.bottomMargin = dp(18);
        root.addView(toolbar, toolsLayout);

        hint = new TextView(this);
        hint.setTextSize(11);
        hint.setTextColor(Color.rgb(98, 105, 114));
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(10), dp(6), dp(10), dp(6));
        GradientDrawable hintBg = new GradientDrawable();
        hintBg.setColor(Color.argb(220, 255, 255, 255));
        hintBg.setCornerRadius(dp(12));
        hint.setBackground(hintBg);
        FrameLayout.LayoutParams hintLayout = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        hintLayout.topMargin = dp(12);
        root.addView(hint, hintLayout);

        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }

        setContentView(root);
        applySystemBarAppearance();
        canvas.load(autosave);
        canvas.requestFocus();
        updateToolButtons();
    }

    private void configureWindowColors() {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(250, 250, 248));
        window.setNavigationBarColor(Color.rgb(250, 250, 248));
        if (Build.VERSION.SDK_INT < 30) {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    private void applySystemBarAppearance() {
        if (Build.VERSION.SDK_INT < 30) return;
        final View decor = getWindow().getDecorView();
        decor.post(() -> {
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller == null) return;
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(mask, mask);
        });
    }

    private LinearLayout buildToolbar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding(dp(6), dp(6), dp(6), dp(6));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(242, 255, 255, 255));
        background.setCornerRadius(dp(18));
        background.setStroke(dp(1), Color.rgb(224, 226, 229));
        bar.setBackground(background);
        bar.setElevation(dp(7));

        penButton = addToolButton(bar, "ペン", view -> selectTool(NativeCanvasView.Tool.PEN));
        eraserButton = addToolButton(bar, "消し", view -> selectTool(NativeCanvasView.Tool.ERASER));
        addToolButton(bar, "戻す", view -> canvas.undo());
        addToolButton(bar, "進む", view -> canvas.redo());
        gridButton = addToolButton(bar, "方眼", view -> {
            canvas.setGridEnabled(!canvas.isGridEnabled());
            updateToolButtons();
        });
        addToolButton(bar, "中央", view -> canvas.resetView());
        return bar;
    }

    private Button addToolButton(LinearLayout bar, String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(13);
        button.setTextColor(Color.rgb(33, 38, 44));
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(12), dp(9), dp(12), dp(9));
        button.setBackground(makeButtonBackground(false));
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(2), 0, dp(2), 0);
        bar.addView(button, params);
        return button;
    }

    private GradientDrawable makeButtonBackground(boolean selected) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(selected ? Color.rgb(32, 95, 232) : Color.TRANSPARENT);
        shape.setCornerRadius(dp(12));
        return shape;
    }

    private void selectTool(NativeCanvasView.Tool tool) {
        canvas.setTool(tool);
        canvas.requestFocus();
        updateToolButtons();
    }

    private void updateToolButtons() {
        NativeCanvasView.Tool tool = canvas.getTool();
        boolean pen = tool == NativeCanvasView.Tool.PEN || tool == NativeCanvasView.Tool.VECTOR_PEN;
        boolean eraser = tool == NativeCanvasView.Tool.ERASER;
        penButton.setBackground(makeButtonBackground(pen));
        penButton.setTextColor(pen ? Color.WHITE : Color.rgb(33, 38, 44));
        eraserButton.setBackground(makeButtonBackground(eraser));
        eraserButton.setTextColor(eraser ? Color.WHITE : Color.rgb(33, 38, 44));
        boolean grid = canvas.isGridEnabled();
        gridButton.setBackground(makeButtonBackground(grid));
        gridButton.setTextColor(grid ? Color.WHITE : Color.rgb(33, 38, 44));
        if (hint != null) hint.setText(canvas.getToolDisplayName() + "    Sペン側面: 消しゴム    Ctrl+側面: オブジェクト削除");
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (canvas == null) return super.dispatchKeyEvent(event);

        int action = event.getAction();
        int code = event.getKeyCode();
        boolean down = action == KeyEvent.ACTION_DOWN;
        boolean ctrl = event.isCtrlPressed();
        boolean shift = event.isShiftPressed();

        if (code == KeyEvent.KEYCODE_CTRL_LEFT || code == KeyEvent.KEYCODE_CTRL_RIGHT) {
            canvas.setCtrlPressed(down);
            return true;
        }

        if (code == KeyEvent.KEYCODE_SPACE) {
            if (down && event.getRepeatCount() == 0) {
                toolBeforeSpace = canvas.getTool();
                canvas.setTool(NativeCanvasView.Tool.HAND);
                updateToolButtons();
            } else if (!down && toolBeforeSpace != null) {
                canvas.setTool(toolBeforeSpace);
                toolBeforeSpace = null;
                updateToolButtons();
            }
            return true;
        }

        if (!down) return super.dispatchKeyEvent(event);

        if (ctrl) {
            switch (code) {
                case KeyEvent.KEYCODE_A:
                    canvas.selectAll();
                    return true;
                case KeyEvent.KEYCODE_D:
                    canvas.clearSelection();
                    return true;
                case KeyEvent.KEYCODE_C:
                    canvas.copySelection();
                    return true;
                case KeyEvent.KEYCODE_X:
                    canvas.cutSelection();
                    return true;
                case KeyEvent.KEYCODE_V:
                    canvas.pasteSelection();
                    return true;
                case KeyEvent.KEYCODE_Z:
                    if (shift) canvas.redo(); else canvas.undo();
                    return true;
                default:
                    break;
            }
        }

        switch (code) {
            case KeyEvent.KEYCODE_B:
                selectTool(NativeCanvasView.Tool.PEN);
                return true;
            case KeyEvent.KEYCODE_E:
                selectTool(NativeCanvasView.Tool.ERASER);
                return true;
            case KeyEvent.KEYCODE_M:
                NativeCanvasView.Tool current = canvas.getTool();
                selectTool(current == NativeCanvasView.Tool.RECT_SELECT
                    ? NativeCanvasView.Tool.ELLIPSE_SELECT
                    : NativeCanvasView.Tool.RECT_SELECT);
                return true;
            case KeyEvent.KEYCODE_L:
                selectTool(NativeCanvasView.Tool.LASSO_SELECT);
                return true;
            case KeyEvent.KEYCODE_W:
                selectTool(NativeCanvasView.Tool.QUICK_SELECT);
                return true;
            case KeyEvent.KEYCODE_G:
                selectTool(NativeCanvasView.Tool.FILL);
                return true;
            case KeyEvent.KEYCODE_V:
                selectTool(NativeCanvasView.Tool.MOVE);
                return true;
            case KeyEvent.KEYCODE_P:
                selectTool(NativeCanvasView.Tool.VECTOR_PEN);
                return true;
            case KeyEvent.KEYCODE_H:
                selectTool(NativeCanvasView.Tool.HAND);
                return true;
            case KeyEvent.KEYCODE_Z:
                selectTool(NativeCanvasView.Tool.ZOOM);
                return true;
            case KeyEvent.KEYCODE_I:
                selectTool(NativeCanvasView.Tool.EYEDROPPER);
                return true;
            case KeyEvent.KEYCODE_LEFT_BRACKET:
                canvas.adjustBrushSize(-1);
                return true;
            case KeyEvent.KEYCODE_RIGHT_BRACKET:
                canvas.adjustBrushSize(1);
                return true;
            case KeyEvent.KEYCODE_DEL:
            case KeyEvent.KEYCODE_FORWARD_DEL:
                canvas.deleteSelection();
                return true;
            default:
                return super.dispatchKeyEvent(event);
        }
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onPause() {
        if (canvas != null && autosave != null) canvas.save(autosave);
        super.onPause();
    }
}
