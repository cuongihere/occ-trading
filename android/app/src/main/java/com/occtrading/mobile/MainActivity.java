package com.occtrading.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private WebView browser;
    private final ExecutorService network = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean destroyed = false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        browser = new WebView(this);
        browser.setBackgroundColor(0xff0b1422);
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(true); // only bundled HTML/JS assets, never external scripts
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !("file".equals(request.getUrl().getScheme()) &&
                    "file:///android_asset/index.html".equals(request.getUrl().toString()));
            }
        });
        browser.addJavascriptInterface(new PublicMarketBridge(), "OCCAndroid");
        setContentView(browser);
        browser.loadUrl("file:///android_asset/index.html");
    }

    private static boolean allow(String path) {
        if (path == null) return false;
        if (path.equals("/fapi/v1/time") || path.equals("/fapi/v1/exchangeInfo")) return true;
        return path.equals("/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=500") ||
               path.equals("/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=1000");
    }

    private void response(String requestId, boolean ok, String result, int httpStatus) {
        if (destroyed) return;
        String javascript = "window.occNativeResponse(" +
            JSONObject.quote(requestId) + "," + ok + "," +
            JSONObject.quote(result) + "," + httpStatus + ");";
        main.post(() -> {
            if (!destroyed && browser != null) browser.evaluateJavascript(javascript, null);
        });
    }

    private static String readLimited(InputStream input) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] block = new byte[8192];
            int n, total = 0;
            while ((n = stream.read(block)) != -1) {
                total += n;
                if (total > 2_000_000) throw new IllegalStateException("Binance response exceeds limit");
                buffer.write(block, 0, n);
            }
            return buffer.toString(StandardCharsets.UTF_8.name());
        }
    }

    public final class PublicMarketBridge {
        @JavascriptInterface public void get(String path, String requestId) {
            if (requestId == null || requestId.length() > 48) return;
            if (!allow(path)) {
                response(requestId, false, "Public Binance URL not permitted", 403);
                return;
            }
            network.execute(() -> {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection)new URL("https://fapi.binance.com" + path).openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestMethod("GET");
                    connection.setConnectTimeout(7000);
                    connection.setReadTimeout(10000);
                    connection.setRequestProperty("Accept", "application/json");
                    int status = connection.getResponseCode();
                    if (status != 200) {
                        response(requestId, false, "Binance HTTP " + status, status);
                        return;
                    }
                    response(requestId, true, readLimited(connection.getInputStream()), status);
                } catch (Exception exception) {
                    response(requestId, false, "Network error: " + exception.getClass().getSimpleName(), 0);
                } finally {
                    if (connection != null) connection.disconnect();
                }
            });
        }
    }

    @Override protected void onDestroy() {
        destroyed = true;
        network.shutdownNow();
        if (browser != null) {
            browser.loadUrl("about:blank");
            browser.destroy();
            browser = null;
        }
        super.onDestroy();
    }
}
