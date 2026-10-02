package work.heartful.canvas;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
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
    private File autosave;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        configureWindow();

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

        TextView hint = new TextView(this);
        hint.setText("1本指/ペン: 描画    2本指: 移動・拡大縮小");
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
        canvas.load(autosave);
        updateToolButtons();
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(250, 250, 248));
        window.setNavigationBarColor(Color.rgb(250, 250, 248));
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
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

        penButton = addToolButton(bar, "ペン", view -> {
            canvas.setTool(NativeCanvasView.Tool.PEN);
            updateToolButtons();
        });
        eraserButton = addToolButton(bar, "消し", view -> {
            canvas.setTool(NativeCanvasView.Tool.ERASER);
            updateToolButtons();
        });
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

    private void updateToolButtons() {
        boolean pen = canvas.getTool() == NativeCanvasView.Tool.PEN;
        penButton.setBackground(makeButtonBackground(pen));
        penButton.setTextColor(pen ? Color.WHITE : Color.rgb(33, 38, 44));
        eraserButton.setBackground(makeButtonBackground(!pen));
        eraserButton.setTextColor(!pen ? Color.WHITE : Color.rgb(33, 38, 44));
        boolean grid = canvas.isGridEnabled();
        gridButton.setBackground(makeButtonBackground(grid));
        gridButton.setTextColor(grid ? Color.WHITE : Color.rgb(33, 38, 44));
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
