package work.heartful.canvas;

import android.graphics.Rect;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.io.File;
import java.io.FileOutputStream;
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
        AtomicReference<String> state = new AtomicReference<>();
        AtomicReference<File> screenshot = new AtomicReference<>();
        scenario.onActivity(activity -> {
            FrameLayout root = root(activity);
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
            Rect visible = new Rect(); root.getWindowVisibleDisplayFrame(visible);
            state.set(" insets=" + (insets == null ? "null" : "status=" + insets.isVisible(WindowInsetsCompat.Type.statusBars()) + " nav=" + insets.isVisible(WindowInsetsCompat.Type.navigationBars()) + " ime=" + insets.isVisible(WindowInsetsCompat.Type.ime()) + " bars=" + insets.getInsets(WindowInsetsCompat.Type.systemBars())) + " flags=" + activity.getWindow().getDecorView().getSystemUiVisibility() + " webHeight=" + root.getChildAt(0).getHeight() + " visible=" + visible);
            File dir = new File(activity.getCacheDir(), "window-check");dir.mkdirs();screenshot.set(new File(dir,"failure.png"));
        });
        Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        if (bitmap != null) try (FileOutputStream file = new FileOutputStream(screenshot.get())) { bitmap.compress(Bitmap.CompressFormat.PNG,100,file); } catch (Exception ignored) {}
        fail(message + state.get());
    }
    private FrameLayout root(MainActivity activity) {
        return (FrameLayout) ((FrameLayout) activity.findViewById(android.R.id.content)).getChildAt(0);
    }
    private boolean barsHidden(MainActivity activity) {
        FrameLayout root = root(activity);
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
        if (insets == null || root.getChildAt(0).getHeight() <= 0) return false;
        if (android.os.Build.VERSION.SDK_INT >= 30)
            return !insets.isVisible(WindowInsetsCompat.Type.statusBars()) && !insets.isVisible(WindowInsetsCompat.Type.navigationBars());
        // Android 10 reports stable bar insets even when immersive bars are hidden.
        // Verify the actual window frame and full-height content instead of that approximation.
        Rect visible = new Rect();root.getWindowVisibleDisplayFrame(visible);
        int[] position = new int[2];root.getLocationOnScreen(position);
        int flags = activity.getWindow().getDecorView().getSystemUiVisibility();
        return (flags & View.SYSTEM_UI_FLAG_FULLSCREEN) != 0 && (flags & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) != 0 &&
            visible.top <= position[1] && visible.bottom >= position[1] + root.getHeight() && root.getChildAt(0).getHeight() == root.getHeight();
    }
    @Test public void fullscreenHidesBarsAndNormalModeReservesTheirSpace() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            // Keep this window test independent of the remote sign-in page's autofocus/IME.
            scenario.onActivity(activity -> {
                WebView view = (WebView) root(activity).getChildAt(0);
                view.stopLoading();
                view.loadDataWithBaseURL("https://canvas.uzero.style/canvas/", "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>window-fixture</title></head><body>Window layout check</body></html>", "text/html", "UTF-8", null);
                view.clearFocus();root(activity).setFocusableInTouchMode(true);root(activity).requestFocus();
                WindowCompat.getInsetsController(activity.getWindow(),activity.getWindow().getDecorView()).hide(WindowInsetsCompat.Type.ime());
            });
            await(scenario, activity -> "window-fixture".equals(((WebView) root(activity).getChildAt(0)).getTitle()), "Window fixture must load");
            await(scenario, activity -> {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root(activity));
                return insets != null && !insets.isVisible(WindowInsetsCompat.Type.ime()) && barsHidden(activity);
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
                return barsHidden(activity);
            }, "Returning to fullscreen must hide both bars again");
        }
    }
    @Test public void headerUpdateTargetReceivesAnActualAndroidTapInNormalMode() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.setFullscreenEnabled(false);
                WebView view = (WebView) root(activity).getChildAt(0);
                view.loadDataWithBaseURL("https://canvas.uzero.style/canvas/", "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>update-fixture</title></head><body><button style='position:fixed;right:8px;top:8px;width:128px;height:48px' onclick=\"document.title='update-tapped'\">更新あり</button><script>requestAnimationFrame(()=>requestAnimationFrame(()=>document.title='update-fixture-ready'));</script></body></html>", "text/html", "UTF-8", null);
            });
            await(scenario, activity -> {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root(activity));
                return insets != null && insets.isVisible(WindowInsetsCompat.Type.statusBars()) && insets.isVisible(WindowInsetsCompat.Type.navigationBars()) &&
                    "update-fixture-ready".equals(((WebView) root(activity).getChildAt(0)).getTitle());
            }, "Update fixture and normal-mode bars must finish layout before the tap");
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
