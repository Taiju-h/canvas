package work.heartful.canvas;

import android.graphics.Rect;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class WindowLayoutTest {
    @Before public void resetWindowPreference() {
        ApplicationProvider.getApplicationContext().getSharedPreferences("canvas-shell", 0).edit().remove("fullscreen").commit();
    }
    private interface Check { boolean ready(MainActivity activity); }
    private void await(ActivityScenario<MainActivity> scenario, Check check, String message) {
        long end = SystemClock.uptimeMillis() + 10000;
        AtomicBoolean ready = new AtomicBoolean();
        while (SystemClock.uptimeMillis() < end) {
            scenario.onActivity(activity -> ready.set(check.ready(activity)));
            if (ready.get()) return;
            SystemClock.sleep(100);
        }
        fail(message);
    }
    private FrameLayout root(MainActivity activity) {
        return (FrameLayout) ((FrameLayout) activity.findViewById(android.R.id.content)).getChildAt(0);
    }
    @Test public void fullscreenHidesBarsAndNormalModeReservesTheirSpace() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            await(scenario, activity -> {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root(activity));
                return insets != null && root(activity).getChildAt(0).getHeight() > 0 && !insets.isVisible(WindowInsetsCompat.Type.statusBars()) && !insets.isVisible(WindowInsetsCompat.Type.navigationBars());
            }, "Full screen must hide Android status and navigation bars");
            AtomicReference<Integer> fullHeight = new AtomicReference<>();
            scenario.onActivity(activity -> { fullHeight.set(root(activity).getChildAt(0).getHeight()); activity.setFullscreenEnabled(false); });
            await(scenario, activity -> {
                FrameLayout root = root(activity);
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
                if (insets == null || !insets.isVisible(WindowInsetsCompat.Type.statusBars()) || !insets.isVisible(WindowInsetsCompat.Type.navigationBars())) return false;
                androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
                Rect content = new Rect(); root.getChildAt(0).getGlobalVisibleRect(content);
                return content.top >= bars.top && root.getPaddingBottom() >= bars.bottom && root.getChildAt(0).getHeight() < fullHeight.get();
            }, "Web content must stay clear of both bars in normal mode");
            scenario.onActivity(activity -> activity.setFullscreenEnabled(true));
            await(scenario, activity -> {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root(activity));
                return insets != null && !insets.isVisible(WindowInsetsCompat.Type.statusBars()) && !insets.isVisible(WindowInsetsCompat.Type.navigationBars());
            }, "Returning to fullscreen must hide both bars again");
        }
    }
    @Test public void headerUpdateTargetReceivesAnActualAndroidTapInNormalMode() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.setFullscreenEnabled(false);
                WebView view = (WebView) root(activity).getChildAt(0);
                view.loadDataWithBaseURL("https://canvas.uzero.style/canvas/", "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>update-fixture</title></head><body><button style='position:fixed;right:8px;top:8px;width:128px;height:48px' onclick=\"document.title='update-tapped'\">更新あり</button></body></html>", "text/html", "UTF-8", null);
            });
            await(scenario, activity -> "update-fixture".equals(((WebView) root(activity).getChildAt(0)).getTitle()), "Update fixture must load");
            AtomicReference<float[]> point = new AtomicReference<>();
            scenario.onActivity(activity -> {
                WebView view = (WebView) root(activity).getChildAt(0);
                int[] position = new int[2]; view.getLocationOnScreen(position);
                float scale = view.getScale();
                point.set(new float[]{position[0] + view.getWidth() - 72 * scale, position[1] + 32 * scale});
            });
            long now = SystemClock.uptimeMillis();
            MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, point.get()[0], point.get()[1], 0);
            MotionEvent up = MotionEvent.obtain(now, now + 50, MotionEvent.ACTION_UP, point.get()[0], point.get()[1], 0);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(down);InstrumentationRegistry.getInstrumentation().sendPointerSync(up);down.recycle();up.recycle();
            await(scenario, activity -> "update-tapped".equals(((WebView) root(activity).getChildAt(0)).getTitle()), "The update target must receive the tap instead of a system bar");
        }
    }
}
