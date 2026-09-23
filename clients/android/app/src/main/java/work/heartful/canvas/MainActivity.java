package work.heartful.canvas;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final String SITE = "https://canvas.uzero.style/canvas/";
    private static final String SITE_HOST = "canvas.uzero.style";
    private static final int FILE_PICKER = 1001;
    private WebView web;
    private LinearLayout offline;
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private volatile boolean onCanvasSite = false;
    private boolean loadFailed = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(23, 35, 55));
        getWindow().setNavigationBarColor(Color.rgb(248, 250, 252));

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(Gravity.CENTER);
        offline.setBackgroundColor(Color.WHITE);
        offline.setPadding(24, 24, 24, 24);
        TextView message = new TextView(this);
        message.setText("最初の起動はネット接続が必要です\n一度開いたあとは端末の作品をオフラインでも編集できます");
        message.setTextColor(Color.rgb(31, 46, 65));
        message.setTextSize(17);
        message.setGravity(Gravity.CENTER);
        Button retry = new Button(this);
        retry.setText("再読み込み");
        retry.setOnClickListener(view -> {
            offline.setVisibility(View.GONE);
            web.loadUrl(SITE);
        });
        offline.addView(message);
        offline.addView(retry);
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        setContentView(root);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new ExportBridge(), "CanvasNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadFailed = false;
                onCanvasSite = SITE_HOST.equals(Uri.parse(url).getHost());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme()) && trustedHost(url.getHost())) return false;
                if ("https".equals(url.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                    catch (Exception ignored) { }
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!loadFailed) offline.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadFailed = true;
                    offline.setVisibility(View.VISIBLE);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_PICKER);
                    return true;
                } catch (Exception error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "画像を選べません", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this);
                input.setSingleLine(false);
                input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setTitle(message).setView(input)
                    .setNegativeButton("キャンセル", (dialog, which) -> result.cancel())
                    .setPositiveButton("OK", (dialog, which) -> result.confirm(input.getText().toString()))
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setNegativeButton("キャンセル", (dialog, which) -> result.cancel())
                    .setPositiveButton("OK", (dialog, which) -> result.confirm())
                    .show();
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, size) -> {
            if (!url.startsWith("https://")) return;
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mime);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "canvas-download");
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            } catch (Exception error) {
                Toast.makeText(this, "保存に失敗しました", Toast.LENGTH_SHORT).show();
            }
        });
        if (state != null) web.restoreState(state);
        else web.loadUrl(SITE);
    }

    private boolean trustedHost(String host) {
        return SITE_HOST.equals(host);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        web.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private class ExportBridge {
        @JavascriptInterface
        public void saveFile(String base64, String filename, String mime) {
            if (!onCanvasSite || base64.length() > 28_000_000) return;
            String safeName = filename.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
            if (safeName.isEmpty()) safeName = "canvas-export";
            String safeMime = mime.equals("image/png") ? "image/png" :
                mime.equals("image/svg+xml") ? "image/svg+xml" : "application/json";
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (bytes.length > 20_000_000) return;
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Canvas");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("save");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("stream");
                    out.write(bytes);
                } catch (Exception error) {
                    getContentResolver().delete(uri, null, null);
                    throw error;
                }
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, ready, null, null);
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    "ダウンロードに保存しました", Toast.LENGTH_SHORT).show());
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    "保存に失敗しました", Toast.LENGTH_SHORT).show());
            }
        }
    }
}
