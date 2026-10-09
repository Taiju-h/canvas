package work.heartful.canvas;

import android.app.Activity;
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

public final class MainActivity extends Activity {
    private static final String CANVAS_ROOT = "https://canvas.uzero.style/canvas/";
    private static final String CANVAS_URL = CANVAS_ROOT + "?app=0.4.0";
    private static final String CANVAS_HOST = "canvas.uzero.style";
    private static final int FILE_CHOOSER_REQUEST = 701;

    private WebView webView;
    private LinearLayout errorPanel;
    private TextView errorText;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(250, 250, 248));
        getWindow().setNavigationBarColor(Color.rgb(250, 250, 248));
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        );

        FrameLayout root = new FrameLayout(this);
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

        // Start immediately from the bundled/downloaded local UI. Static requests for
        // this HTTPS origin are intercepted below, while API requests still use network.
        webView.loadUrl(canvasUrlFromIntent(getIntent()));
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
            && path != null
            && path.startsWith("/canvas")) {
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
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setUserAgentString(settings.getUserAgentString() + " CanvasAndroidShell/0.4.0");

        view.setBackgroundColor(Color.rgb(250, 250, 248));
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.addJavascriptInterface(new CanvasBridge(), "CanvasApp");

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
                    showError("この端末ではファイル選択を開けません。");
                    return false;
                }
            }
        });

        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"GET".equalsIgnoreCase(request.getMethod())) return null;
                if (!"https".equalsIgnoreCase(uri.getScheme()) || !CANVAS_HOST.equalsIgnoreCase(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || !path.startsWith("/canvas/") || path.endsWith("api.php")) return null;
                String query = uri.getQuery();
                if (query != null && (query.contains("remote=1") || query.contains("remoteui=1"))) return null;
                return localResponse(path);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if (("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                    && CANVAS_HOST.equalsIgnoreCase(host)) {
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
            public void onReceivedError(
                WebView webView,
                WebResourceRequest request,
                WebResourceError error
            ) {
                if (request.isForMainFrame()) {
                    String message = error != null ? String.valueOf(error.getDescription()) : "読み込みエラー";
                    showError("Canvas を開けません。\n" + message);
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
                    request.setDescription("Canvas からダウンロード");
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

    private WebResourceResponse localResponse(String path) {
        String relative = path.substring("/canvas/".length());
        if (relative.isEmpty()) relative = "index.html";
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
        String lower = name.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private final class CanvasBridge {
        @JavascriptInterface
        public void applyWebUpdate() {
            new Thread(() -> {
                try {
                    downloadWebUpdate();
                    runOnUiThread(() -> webView.loadUrl(CANVAS_ROOT + "?updated=" + System.currentTimeMillis()));
                } catch (Exception error) {
                    String message = error.getMessage() == null ? "更新できませんでした" : error.getMessage();
                    String escaped = message.replace("\\", "\\\\").replace("'", "\\'");
                    runOnUiThread(() -> webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('canvas-update-failed',{detail:'" + escaped + "'}))",
                        null
                    ));
                }
            }).start();
        }
    }

    private void downloadWebUpdate() throws Exception {
        File staging = new File(getFilesDir(), "canvas-web-next");
        deleteTree(staging);
        if (!staging.mkdirs() && !staging.isDirectory()) throw new IOException("更新領域を作成できません");

        byte[] manifestBytes = fetchBytes(CANVAS_ROOT + "offline-assets.json?native=" + System.currentTimeMillis());
        String manifestText = new String(manifestBytes, StandardCharsets.UTF_8);
        JSONArray files = new JSONArray(manifestText);

        writeFile(staging, "offline-assets.json", manifestBytes);
        String[] fixed = {"index.html", "build-version.json", "manifest.webmanifest", "favicon.svg", "sw.js"};
        for (String name : fixed) writeFile(staging, name, fetchBytes(CANVAS_ROOT + name + "?native=" + System.currentTimeMillis()));

        for (int i = 0; i < files.length(); i++) {
            String remotePath = files.getString(i);
            if (!remotePath.startsWith("/canvas/")) continue;
            String relative = remotePath.substring("/canvas/".length());
            writeFile(staging, relative, fetchBytes("https://" + CANVAS_HOST + remotePath + "?native=" + System.currentTimeMillis()));
        }

        File current = new File(getFilesDir(), "canvas-web");
        File previous = new File(getFilesDir(), "canvas-web-old");
        deleteTree(previous);
        if (current.exists() && !current.renameTo(previous)) throw new IOException("旧UIを退避できません");
        if (!staging.renameTo(current)) {
            if (previous.exists()) previous.renameTo(current);
            throw new IOException("更新を適用できません");
        }
        deleteTree(previous);
    }

    private byte[] fetchBytes(String value) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(value).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(10000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Cache-Control", "no-cache");
        String cookie = CookieManager.getInstance().getCookie(CANVAS_ROOT);
        if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) throw new IOException("更新サーバー応答: " + code);
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toByteArray();
        } finally {
            connection.disconnect();
        }
    }

    private void writeFile(File root, String relative, byte[] data) throws IOException {
        File target = new File(root, relative);
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
        title.setText("Canvas");
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
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
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
