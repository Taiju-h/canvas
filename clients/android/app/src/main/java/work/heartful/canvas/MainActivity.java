package work.heartful.canvas;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Browser;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerController;
import android.webkit.ServiceWorkerClient;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import android.widget.Toast;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import org.json.JSONObject;
import java.util.Collections;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends ComponentActivity {
    private static final String CANVAS_ROOT = "https://canvas.uzero.style/canvas/";
    private static final String CANVAS_URL = CANVAS_ROOT + "?app=" + BuildConfig.VERSION_NAME;
    private static final String CANVAS_HOST = "canvas.uzero.style";
    private static final int FILE_CHOOSER_REQUEST = 701;

    private WebView webView;
    private LinearLayout errorPanel;
    private TextView errorText;
    private ValueCallback<Uri[]> filePathCallback;
    private NativeDownloads nativeDownloads;
    private String downloadScript;
    private volatile boolean updateBusy;
    private volatile boolean fullscreenEnabled;
    private FrameLayout root;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(250, 250, 248));
        getWindow().setNavigationBarColor(Color.rgb(250, 250, 248));
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // An older downloaded UI must not override the Web bundle in a newer APK.
        android.content.SharedPreferences shell = getSharedPreferences("canvas-shell", MODE_PRIVATE);
        fullscreenEnabled = shell.getBoolean("fullscreen", true);
        String bundledCommit = readWebVersion(null).optString("commit", "");
        if (shell.getInt("installedVersion", 0) != BuildConfig.VERSION_CODE ||
            !shell.getString("bundledCommit", "").equals(bundledCommit)) {
            deleteTree(new File(getFilesDir(), "canvas-web"));
            deleteTree(new File(getFilesDir(), "canvas-web-next"));
            deleteTree(new File(getFilesDir(), "canvas-web-old"));
            shell.edit().putInt("installedVersion", BuildConfig.VERSION_CODE).putString("bundledCommit", bundledCommit).apply();
        }
        // A process death before the new bundle confirms startup rolls back only static UI.
        if (!shell.getString("pendingCommit", "").isEmpty()) rollbackWebUpdate();
        nativeDownloads = new NativeDownloads(this);
        File[] abandonedExports = getCacheDir().listFiles((dir, name) -> name.startsWith("kaeru-export-") && name.endsWith(".tmp"));
        if (abandonedExports != null) for (File export : abandonedExports) export.delete();
        try (InputStream input = getAssets().open("native-downloads.js")) {
            java.io.ByteArrayOutputStream script = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) script.write(buffer, 0, count);
            downloadScript = new String(script.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException error) { downloadScript = ""; }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(250, 250, 248));

        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        errorPanel = buildErrorPanel();
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            applyViewportInsets(v, insets);
            return WindowInsetsCompat.CONSUMED;
        });
        if (android.os.Build.VERSION.SDK_INT < 30) root.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
            if (insets != null) applyViewportInsets(root, insets);
        });
        setFullscreenEnabled(fullscreenEnabled);
        ViewCompat.requestApplyInsets(root);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) webView.goBack();
                else finish();
            }
        });

        // Start immediately from the bundled/downloaded local UI. Static requests for
        // this HTTPS origin are intercepted below, while API requests still use network.
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(canvasUrlFromIntent(getIntent()));
        }
    }

    private void applyViewportInsets(View view, WindowInsetsCompat insets) {
        androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        androidx.core.graphics.Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        int left = bars.left, top = bars.top, right = bars.right, bottom = Math.max(bars.bottom, ime.bottom);
        if (android.os.Build.VERSION.SDK_INT < 30 && fullscreenEnabled) {
            // Legacy immersive insets can still describe stable, hidden bars.
            // The visible frame also follows the keyboard without adding those bars twice.
            android.graphics.Rect visible = new android.graphics.Rect();view.getWindowVisibleDisplayFrame(visible);
            int[] position = new int[2];view.getLocationOnScreen(position);
            androidx.core.graphics.Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            left = Math.max(cutout.left, Math.max(0, visible.left - position[0]));
            top = Math.max(cutout.top, Math.max(0, visible.top - position[1]));
            right = Math.max(cutout.right, Math.max(0, position[0] + view.getWidth() - visible.right));
            bottom = Math.max(cutout.bottom, Math.max(0, position[1] + view.getHeight() - visible.bottom));
        }
        if (view.getPaddingLeft() != left || view.getPaddingTop() != top || view.getPaddingRight() != right || view.getPaddingBottom() != bottom)
            view.setPadding(left, top, right, bottom);
    }

    void setFullscreenEnabled(boolean enabled) {
        fullscreenEnabled = enabled;
        getSharedPreferences("canvas-shell", MODE_PRIVATE).edit().putBoolean("fullscreen", enabled).apply();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (enabled) controller.hide(WindowInsetsCompat.Type.systemBars());
        else controller.show(WindowInsetsCompat.Type.systemBars());
        if (root != null) ViewCompat.requestApplyInsets(root);
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('canvas-fullscreen-change'))", null);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && root != null) setFullscreenEnabled(fullscreenEnabled);
    }

    private String canvasUrlFromIntent(Intent intent) {
        if (intent == null) return CANVAS_URL;
        Uri uri = intent.getData();
        if (uri == null) return CANVAS_URL;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        String path = uri.getPath();
        if ("https".equalsIgnoreCase(scheme)
            && CANVAS_HOST.equalsIgnoreCase(host)
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && WebAssetPaths.isEditorPath(path)) {
            return uri.toString();
        }
        return CANVAS_URL;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null) webView.loadUrl(canvasUrlFromIntent(intent));
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setUserAgentString(settings.getUserAgentString() + " KaeruNoteAndroid/" + BuildConfig.VERSION_NAME);

        view.setBackgroundColor(Color.rgb(250, 250, 248));
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.addJavascriptInterface(new CanvasBridge(), "CanvasApp");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view, "CanvasDownloads",
                Collections.singleton("https://" + CANVAS_HOST),
                (source, message, origin, mainFrame, reply) -> {
                    if (mainFrame && "https".equals(origin.getScheme()) && CANVAS_HOST.equals(origin.getHost())) {
                        nativeDownloads.receive(message.getData(), reply);
                    }
                });
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(view, downloadScript,
                    Collections.singleton("https://" + CANVAS_HOST));
            }
        }
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return interceptLocal(request);
            }
        });

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, false);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
            ) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "この端末ではファイル選択を開けません。", Toast.LENGTH_LONG).show();
                    return true;
                }
            }
        });

        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                return interceptLocal(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if ("https".equalsIgnoreCase(scheme) && CANVAS_HOST.equalsIgnoreCase(host)) {
                    return false;
                }
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageStarted(WebView webView, String url, android.graphics.Bitmap favicon) {
                hideError();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if ("https".equals(uri.getScheme()) && CANVAS_HOST.equals(uri.getHost())) {
                    view.evaluateJavascript(downloadScript, null);
                }
            }

            @Override
            public void onReceivedError(
                WebView webView,
                WebResourceRequest request,
                WebResourceError error
            ) {
                if (request.isForMainFrame()) {
                    String message = error != null ? String.valueOf(error.getDescription()) : "読み込みエラー";
                    showError("KaeruNote を開けません。\n" + message);
                }
            }
        });

        view.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(
                String url,
                String userAgent,
                String contentDisposition,
                String mimeType,
                long contentLength
            ) {
                if (url == null) return;
                Uri uri = Uri.parse(url);
                String scheme = uri.getScheme();
                if ("blob".equalsIgnoreCase(scheme) || "data".equalsIgnoreCase(scheme)) {
                    String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    webView.evaluateJavascript("window.__kaeruSaveBlob ? window.__kaeruSaveBlob(" +
                        JSONObject.quote(url) + "," + JSONObject.quote(name) + ") : null", null);
                    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                        Toast.makeText(MainActivity.this, "保存にはAndroid System WebViewの更新が必要です。", Toast.LENGTH_LONG).show();
                    }
                    return;
                }
                if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                    openExternal(uri);
                    return;
                }
                try {
                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    DownloadManager.Request request = new DownloadManager.Request(uri);
                    String cookie = CookieManager.getInstance().getCookie(url);
                    if (cookie != null && !cookie.isEmpty()) request.addRequestHeader("Cookie", cookie);
                    if (userAgent != null && !userAgent.isEmpty()) request.addRequestHeader("User-Agent", userAgent);
                    request.addRequestHeader("Referer", CANVAS_URL);
                    request.setMimeType(mimeType);
                    request.setTitle(fileName);
                    request.setDescription("KaeruNote からダウンロード");
                    request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                    );
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                    ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                } catch (Exception error) {
                    openExternal(uri);
                }
            }
        });
    }

    private WebResourceResponse interceptLocal(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!"GET".equalsIgnoreCase(request.getMethod()) || !"https".equalsIgnoreCase(uri.getScheme()) ||
            !CANVAS_HOST.equalsIgnoreCase(uri.getHost()) || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
        if ("1".equals(uri.getQueryParameter("remote")) || "1".equals(uri.getQueryParameter("remoteui")) ||
            uri.getQueryParameter("check") != null) return null;
        return localResponse(uri.getPath());
    }

    private WebResourceResponse localResponse(String path) {
        String relative = WebAssetPaths.relative(path);
        if (relative == null) return null;
        File downloaded = new File(new File(getFilesDir(), "canvas-web"), relative);
        try {
            if (downloaded.isFile()) {
                return new WebResourceResponse(mimeType(relative), "UTF-8", new BufferedInputStream(new java.io.FileInputStream(downloaded)));
            }
            AssetManager assets = getAssets();
            InputStream input = assets.open("canvas/" + relative);
            return new WebResourceResponse(mimeType(relative), "UTF-8", new BufferedInputStream(input));
        } catch (IOException ignored) {
            return null;
        }
    }

    private String mimeType(String name) {
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if ((lower.endsWith(".js") || lower.endsWith(".mjs"))) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    private final class CanvasBridge {
        @JavascriptInterface public boolean isFullscreen() { return fullscreenEnabled; }
        @JavascriptInterface public String getAppVersion() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public void setFullscreen(boolean enabled) { runOnUiThread(() -> setFullscreenEnabled(enabled)); }

        @JavascriptInterface
        public void applyWebUpdate() {
            synchronized (MainActivity.this) {
                if (updateBusy) { runOnUiThread(() -> reportUpdateFailure("更新を取得中です。完了まで少しお待ちください。")); return; }
                updateBusy = true;
            }
            new Thread(() -> {
                try {
                    downloadWebUpdate();
                    runOnUiThread(() -> webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('canvas-update-ready'))", null));
                } catch (Exception error) {
                    String message = error.getMessage() == null ? "更新できませんでした" : error.getMessage();
                    String escaped = JSONObject.quote(message);
                    runOnUiThread(() -> webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('canvas-update-failed',{detail:" + escaped + "}))",
                        null
                    ));
                } finally {
                    updateBusy = false;
                }
            }).start();
        }

        @JavascriptInterface
        public void activateWebUpdate() {
            runOnUiThread(() -> {
                try {
                    File staging = new File(getFilesDir(), "canvas-web-next");
                    JSONObject version = new JSONObject(new String(java.nio.file.Files.readAllBytes(new File(staging, "build-version.json").toPath()), StandardCharsets.UTF_8));
                    String commit = version.getString("commit");
                    File current = new File(getFilesDir(), "canvas-web"), previous = new File(getFilesDir(), "canvas-web-old");
                    deleteTree(previous);
                    if (current.exists() && !current.renameTo(previous)) throw new IOException("旧UIを退避できません");
                    if (!staging.renameTo(current)) {
                        if (previous.exists()) previous.renameTo(current);
                        throw new IOException("更新を適用できません");
                    }
                    getSharedPreferences("canvas-shell", MODE_PRIVATE).edit().putString("pendingCommit", commit).apply();
                    String currentUrl = webView.getUrl();
                    Uri.Builder url = Uri.parse(currentUrl == null ? CANVAS_URL : currentUrl).buildUpon().clearQuery();
                    Uri old = Uri.parse(currentUrl == null ? CANVAS_URL : currentUrl);
                    for (String name : old.getQueryParameterNames()) if (!name.equals("remoteui") && !name.equals("updated"))
                        for (String value : old.getQueryParameters(name)) url.appendQueryParameter(name, value);
                    url.appendQueryParameter("updated", String.valueOf(System.currentTimeMillis()));
                    webView.loadUrl(url.build().toString());
                    webView.postDelayed(() -> {
                        if (!getSharedPreferences("canvas-shell", MODE_PRIVATE).getString("pendingCommit", "").isEmpty()) {
                            rollbackWebUpdate(); webView.reload();
                        }
                    }, 45000);
                } catch (Exception error) { reportUpdateFailure(error.getMessage()); }
            });
        }

        @JavascriptInterface
        public void confirmWebUpdate(String runningCommit) {
            runOnUiThread(() -> {
                android.content.SharedPreferences shell = getSharedPreferences("canvas-shell", MODE_PRIVATE);
                String expected = shell.getString("pendingCommit", "");
                if (expected.isEmpty()) return;
                if (WebVersions.sameCommit(expected, runningCommit)) {
                    shell.edit().remove("pendingCommit").apply();
                    deleteTree(new File(getFilesDir(), "canvas-web-old"));
                } else { rollbackWebUpdate(); webView.reload(); }
            });
        }
    }

    private void reportUpdateFailure(String message) {
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('canvas-update-failed',{detail:" + JSONObject.quote(message == null ? "更新できませんでした" : message) + "}))", null);
    }

    private void rollbackWebUpdate() {
        File current = new File(getFilesDir(), "canvas-web"), previous = new File(getFilesDir(), "canvas-web-old");
        deleteTree(current);
        if (previous.exists()) previous.renameTo(current);
        getSharedPreferences("canvas-shell", MODE_PRIVATE).edit().remove("pendingCommit").apply();
    }

    private JSONObject readWebVersion(File root) {
        try (InputStream input = root == null ? getAssets().open("canvas/build-version.json") : new java.io.FileInputStream(new File(root, "build-version.json"));
             java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 16384) throw new IOException("更新情報が不正です");
                output.write(buffer, 0, count);
            }
            return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception error) { return new JSONObject(); }
    }

    private void downloadWebUpdate() throws Exception {
        File staging = new File(getFilesDir(), "canvas-web-next");
        deleteTree(staging);
        if (!staging.mkdirs() && !staging.isDirectory()) throw new IOException("更新領域を作成できません");

        byte[] manifestBytes = fetchBytes(CANVAS_ROOT + "offline-assets.json?native=" + System.currentTimeMillis());
        String manifestText = new String(manifestBytes, StandardCharsets.UTF_8);
        JSONArray files = new JSONArray(manifestText);
        if (files.length() == 0 || files.length() > 1024) throw new IOException("更新一覧が不正です");

        writeFile(staging, "offline-assets.json", manifestBytes);
        String[] fixed = {"index.html", "build-version.json", "manifest.webmanifest", "favicon.svg", "sw.js"};
        for (String name : fixed) { writeFile(staging, name, fetchBytes(CANVAS_ROOT + name + "?native=" + System.currentTimeMillis())); reportUpdateProgress(); }

        JSONObject candidate = readWebVersion(staging), bundled = readWebVersion(null);
        File installedDir = new File(getFilesDir(), "canvas-web");
        JSONObject installed = installedDir.exists() ? readWebVersion(installedDir) : bundled;
        if (!WebVersions.canInstall(candidate.optLong("commitTime", 0), installed.optLong("commitTime", 0), bundled.optLong("commitTime", 0))) {
            throw new IOException("公開Web版が同梱または取得済みの画面より古いため、現在の画面を使います");
        }

        for (int i = 0; i < files.length(); i++) {
            String remotePath = files.getString(i);
            String relative = WebAssetPaths.relative(remotePath);
            if (relative == null || !relative.startsWith("assets/")) throw new IOException("更新パスが不正です");
            writeFile(staging, relative, fetchBytes("https://" + CANVAS_HOST + remotePath + "?native=" + System.currentTimeMillis()));
            reportUpdateProgress();
        }

        JSONObject version = new JSONObject(new String(java.nio.file.Files.readAllBytes(new File(staging, "build-version.json").toPath()), StandardCharsets.UTF_8));
        JSONObject finalVersion = new JSONObject(new String(fetchBytes(CANVAS_ROOT + "build-version.json?native=" + System.currentTimeMillis()), StandardCharsets.UTF_8));
        if (!version.getString("buildId").equals(finalVersion.getString("buildId")) ||
            !version.getString("commit").equals(finalVersion.getString("commit")) ||
            version.optLong("commitTime", 0) != finalVersion.optLong("commitTime", 0) ||
            !version.getString("commit").matches("[a-fA-F0-9]{7,40}")) throw new IOException("取得中にWeb版が更新されました。もう一度更新してください");
        String index = new String(java.nio.file.Files.readAllBytes(new File(staging, "index.html").toPath()), StandardCharsets.UTF_8);
        if (!index.contains("assets/") || !index.contains("<html")) throw new IOException("更新画面が不正です");
        // Keep staging separate until JavaScript acknowledges durable local storage.

    }

    private void reportUpdateProgress() {
        runOnUiThread(() -> webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('canvas-update-progress'))", null));
    }

    private byte[] fetchBytes(String value) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(value).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(10000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Cache-Control", "no-cache");
        String cookie = CookieManager.getInstance().getCookie(CANVAS_ROOT);
        if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
        int code = connection.getResponseCode();
        long expectedLength = connection.getContentLengthLong();
        if (code < 200 || code >= 300) {
            connection.disconnect();
            throw new IOException("更新サーバー応答: " + code);
        }
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (output.size() + count > 64 * 1024 * 1024) throw new IOException("更新ファイルが大きすぎます");
                output.write(buffer, 0, count);
            }
            if (expectedLength >= 0 && output.size() != expectedLength) throw new IOException("更新ファイルを最後まで取得できませんでした");
            return output.toByteArray();
        } finally {
            connection.disconnect();
        }
    }

    private void writeFile(File root, String relative, byte[] data) throws IOException {
        File target = new File(root, relative);
        if (!target.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) {
            throw new IOException("更新保存先が不正です");
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("更新フォルダを作成できません");
        try (FileOutputStream output = new FileOutputStream(target)) {
            output.write(data);
        }
    }

    private void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        file.delete();
    }

    private LinearLayout buildErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(28), dp(28), dp(28));
        panel.setBackgroundColor(Color.rgb(250, 250, 248));

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(24);
        title.setTextColor(Color.rgb(32, 42, 52));
        title.setGravity(Gravity.CENTER);
        panel.addView(title);

        errorText = new TextView(this);
        errorText.setTextSize(15);
        errorText.setTextColor(Color.rgb(79, 91, 104));
        errorText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        textParams.setMargins(0, dp(12), 0, dp(18));
        panel.addView(errorText, textParams);

        Button retry = new Button(this);
        retry.setText("再読み込み");
        retry.setOnClickListener(v -> {
            hideError();
            webView.loadUrl(CANVAS_URL);
        });
        panel.addView(retry);
        return panel;
    }

    private void showError(String message) {
        errorText.setText(message);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        errorPanel.setVisibility(View.GONE);
    }

    private void openExternal(Uri uri) {
        if (uri == null) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.putExtra(Browser.EXTRA_APPLICATION_ID, getPackageName());
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            showError("このリンクを開けるアプリがありません。");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == NativeDownloads.SAVE_REQUEST) {
            nativeDownloads.result(resultCode, data);
            return;
        }
        if (requestCode == FILE_CHOOSER_REQUEST) {
            ValueCallback<Uri[]> callback = filePathCallback;
            filePathCallback = null;
            if (callback != null) callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (nativeDownloads != null) nativeDownloads.close();
        ServiceWorkerController.getInstance().setServiceWorkerClient(null);
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
