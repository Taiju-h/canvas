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
import androidx.lifecycle.Lifecycle;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.io.File;
import java.io.FileOutputStream;
import org.junit.Before;
import org.junit.Assume;
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
            WebView view = (WebView) root.getChildAt(0);
            android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
            state.set(" url=" + view.getUrl() + " title=" + view.getTitle() + " webview=" + (provider == null ? "unknown" : provider.versionName) + " insets=" + (insets == null ? "null" : "status=" + insets.isVisible(WindowInsetsCompat.Type.statusBars()) + " nav=" + insets.isVisible(WindowInsetsCompat.Type.navigationBars()) + " ime=" + insets.isVisible(WindowInsetsCompat.Type.ime()) + " bars=" + insets.getInsets(WindowInsetsCompat.Type.systemBars())) + " flags=" + activity.getWindow().getDecorView().getSystemUiVisibility() + " webHeight=" + root.getChildAt(0).getHeight() + " visible=" + visible);
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
    private void showWindowFixture(ActivityScenario<MainActivity> scenario) {
        scenario.onActivity(activity -> {
            WebView view = (WebView) root(activity).getChildAt(0);
            view.stopLoading();
            view.loadDataWithBaseURL("https://canvas.uzero.style/canvas/", "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>resume-fixture</title></head><body>Fullscreen resume check</body></html>", "text/html", "UTF-8", null);
            view.clearFocus();root(activity).setFocusableInTouchMode(true);root(activity).requestFocus();
            WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView()).hide(WindowInsetsCompat.Type.ime());
        });
        await(scenario, activity -> "resume-fixture".equals(((WebView) root(activity).getChildAt(0)).getTitle()), "Window fixture must load");
    }
    @Test public void privateShellRequiresEnrollmentAndExcludesCredentialBackup() {
        int flags = ApplicationProvider.getApplicationContext().getApplicationInfo().flags;
        assertEquals("Device credentials must not enter Android auto backup", 0, flags & android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            showWindowFixture(scenario);
            AtomicReference<String> bridge = new AtomicReference<>("");
            scenario.onActivity(activity -> ((WebView) root(activity).getChildAt(0)).evaluateJavascript(
                "CanvasApp.persistDeviceRegistration(); String(CanvasApp.requiresDeviceRegistration()) + ':' + CanvasApp.getAppVersionCode()", bridge::set));
            await(scenario, activity -> "\"true:13\"".equals(bridge.get()), "The real Android bridge must require private enrollment");
        }
    }
    @Test public void upgradingBypassesLegacyWorkerHtmlAndRetainsLocalData() {
        android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
        int major = WebVersions.browserMajor(provider == null ? null : provider.versionName);
        Assume.assumeTrue("Full UI requires the Vite browser baseline; provider=" + (provider == null ? "unknown" : provider.versionName), major == 0 || major >= WebVersions.MIN_WEBVIEW_MAJOR);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<String> loaded = new AtomicReference<>("");
            await(scenario, activity -> {
                WebView view = (WebView) root(activity).getChildAt(0);
                view.evaluateJavascript("Boolean(document.getElementById('private-title'))", loaded::set);
                return "true".equals(loaded.get());
            }, "The bundled private UI must start");
            scenario.onActivity(activity -> ((WebView) root(activity).getChildAt(0)).evaluateJavascript(
                "(async()=>{await navigator.serviceWorker.ready;const keys=(await caches.keys()).filter(k=>k.startsWith('uzero-canvas-shell-'));if(!keys.length)throw Error('no shell');for(const k of keys)await(await caches.open(k)).put('/canvas/index.html',new Response('<title>legacy-cached-ui</title><p>Old cached HTML</p>',{headers:{'Content-Type':'text/html'}}));localStorage.setItem('private-upgrade-data-marker','retained');localStorage.setItem('canvasSessionCache',JSON.stringify({authenticated:true,accountId:'legacy-cache'}));document.title='legacy-cache-ready';})().catch(()=>document.title='legacy-cache-failed')", null));
            await(scenario, activity -> "legacy-cache-ready".equals(((WebView) root(activity).getChildAt(0)).getTitle()), "A legacy cached editor must be installed before the upgrade");
            scenario.onActivity(activity -> activity.getSharedPreferences("canvas-shell",0).edit().putInt("installedVersion",12).commit());
            scenario.recreate();
            AtomicReference<String> upgraded = new AtomicReference<>("");
            await(scenario, activity -> {
                WebView view = (WebView) root(activity).getChildAt(0);
                view.evaluateJavascript("Boolean(document.getElementById('private-title')) && localStorage.getItem('private-upgrade-data-marker')==='retained'", upgraded::set);
                return view.getUrl() != null && view.getUrl().contains(WebAssetPaths.NATIVE_ENTRY) && "true".equals(upgraded.get());
            }, "Upgrading must bypass old worker HTML and keep the user's stored data");
        }
    }
    @Test public void legacyWebViewShowsAnUpdateMessageInsteadOfABlankEditor() {
        android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
        int major = WebVersions.browserMajor(provider == null ? null : provider.versionName);
        Assume.assumeTrue("This check needs an older WebView provider", major > 0 && major < WebVersions.MIN_WEBVIEW_MAJOR);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            await(scenario, activity -> {
                FrameLayout root = root(activity);
                android.widget.LinearLayout panel = (android.widget.LinearLayout) root.getChildAt(1);
                for (int i = 0; i < panel.getChildCount(); i++) if (panel.getChildAt(i) instanceof android.widget.TextView && ((android.widget.TextView) panel.getChildAt(i)).getText().toString().contains("WebViewを更新")) return panel.getVisibility() == View.VISIBLE;
                return false;
            }, "An unsupported WebView must explain the required update without deleting local data");
        }
    }
    @Test public void legacyNormalPreferenceDoesNotShowTheClockOnANewLaunch() {
        ApplicationProvider.getApplicationContext().getSharedPreferences("canvas-shell", 0).edit().putBoolean("fullscreen", false).commit();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            showWindowFixture(scenario);
            await(scenario, this::barsHidden, "A fresh launch must hide the clock despite the previous normal-mode preference");
            scenario.onActivity(activity -> activity.setFullscreenEnabled(false));
            await(scenario, activity -> {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root(activity));
                return insets != null && insets.isVisible(WindowInsetsCompat.Type.statusBars());
            }, "An explicit normal-mode toggle must still work");
            scenario.recreate();
            showWindowFixture(scenario);
            await(scenario, activity -> {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root(activity));
                return insets != null && insets.isVisible(WindowInsetsCompat.Type.statusBars());
            }, "Recreation must preserve the current session's explicit normal mode");
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            showWindowFixture(scenario);
            await(scenario, this::barsHidden, "The next fresh launch must return to fullscreen");
        }
    }
    @Test public void returningToTheForegroundRestoresHiddenSystemBars() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            showWindowFixture(scenario);
            await(scenario, this::barsHidden, "The initial window must be fullscreen");
            scenario.moveToState(Lifecycle.State.CREATED);
            scenario.moveToState(Lifecycle.State.RESUMED);
            await(scenario, this::barsHidden, "Returning to the app must keep the clock and navigation bar hidden");
        }
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
