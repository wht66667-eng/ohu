package com.sunshinecampus.app;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * 设备侧校园取数桥：一个离屏 WebView + 可选的可见登录层。
 *
 * 职责只做「加载页面 / 执行 JS / 返回 URL 与 HTML / 记录请求」，
 * 具体业务编排在 TypeScript（src/lib/one-click.ts），便于回归与复用现有解析器。
 *
 * 安全边界：
 *  - 只允许 jou.edu.cn / pocketuni.net / chaoxing.com 及其子域，避免被当成任意网页容器；
 *  - 不读取、不落盘任何密码；JS 由调用方注入，返回值只回给当前页面上下文；
 *  - 关闭时销毁 WebView 并清理 Cookie 之外的临时状态。
 */
@CapacitorPlugin(name = "CampusBridge")
public class CampusBridgePlugin extends Plugin {
    private static final String[] ALLOWED_SUFFIXES = {
        ".jou.edu.cn", ".pocketuni.net", ".chaoxing.com", ".chaoxing.com.cn"
    };
    private static final int OFFSCREEN_X = -4000;

    private WebView webView;
    private FrameLayout container;
    private Button closeButton;
    private boolean visible = false;
    private final List<String> capturedRequests = new ArrayList<>();
    private WebView captureView;
    private final RequestBudget pageLoads = new RequestBudget(12, 2);
    private final RequestBudget scriptReads = new RequestBudget(32, 8);

    // Budgets live for the plugin lifetime, across embedded browser resets.
    static final class RequestBudget {
        private final double capacity;
        private final double perMillisecond;
        private double available;
        private long lastRefill;

        RequestBudget(int capacity, int perSecond) {
            this.capacity = capacity;
            perMillisecond = perSecond / 1000.0;
            available = capacity;
        }

        boolean tryAcquire(long now) {
            available = Math.min(capacity, available + (now - lastRefill) * perMillisecond);
            lastRefill = now;
            if (available < 1) return false;
            available--;
            return true;
        }
    }

    static boolean sameOrigin(String trustedUrl, String currentUrl) {
        if (trustedUrl == null || currentUrl == null) return false;
        try {
            URI trusted = URI.create(trustedUrl);
            URI current = URI.create(currentUrl);
            String scheme = trusted.getScheme();
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return false;
            return scheme.equalsIgnoreCase(current.getScheme())
                && trusted.getHost() != null && trusted.getHost().equalsIgnoreCase(current.getHost())
                && current.getUserInfo() == null
                && effectivePort(trusted) == effectivePort(current);
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private static int effectivePort(URI url) {
        if (url.getPort() != -1) return url.getPort();
        return "https".equalsIgnoreCase(url.getScheme()) ? 443 : 80;
    }

    private boolean isAppOrigin() {
        // 主 WebView url 在冷启动极早期可能为 null：此时主视图尚未离开本地 origin，
        // 按「在 App 内」处理（拒绝外部页面的判定由 sameOrigin 的 host 校验兜底）。
        String current = getBridge().getWebView().getUrl();
        if (current == null || current.isEmpty()) return true;
        return sameOrigin(getBridge().getLocalUrl(), current);
    }

    private void runFromApp(PluginCall call, Runnable action) {
        getActivity().runOnUiThread(() -> {
            if (!isAppOrigin()) {
                call.reject("Campus bridge is only available to the app origin", "ORIGIN_DENIED");
                return;
            }
            action.run();
        });
    }

    private boolean allowRequest(PluginCall call, RequestBudget budget) {
        if (budget.tryAcquire(SystemClock.elapsedRealtime())) return true;
        call.reject("校园数据操作太频繁，请稍后重试。", "LOCAL_RATE_LIMIT");
        return false;
    }

    @Override
    protected void handleOnDestroy() {
        destroyWebView();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void open(PluginCall call) {
        runFromApp(call, () -> {
            ensureWebView();
            call.resolve();
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("url required");
            return;
        }
        if (!allowed(url) || url.trim().regionMatches(true, 0, "javascript:", 0, 11)) {
            call.reject("host not allowed");
            return;
        }
        JSObject headersObj = call.getObject("headers");
        Map<String, String> headers = null;
        if (headersObj != null) {
            headers = new java.util.HashMap<>();
            Iterator<String> keys = headersObj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                headers.put(key, headersObj.getString(key));
            }
        }
        final Map<String, String> finalHeaders = headers;
        runFromApp(call, () -> {
            if (!allowRequest(call, pageLoads)) return;
            ensureWebView();
            if (finalHeaders == null || finalHeaders.isEmpty()) {
                webView.loadUrl(url);
            } else {
                webView.loadUrl(url, finalHeaders);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void eval(PluginCall call) {
        String js = call.getString("js", "");
        if (js.isEmpty()) {
            call.reject("js required");
            return;
        }
        runFromApp(call, () -> {
            if (webView == null) {
                call.reject("webview not open");
                return;
            }
            if (!allowRequest(call, scriptReads)) return;
            WebView activeView = webView;
            try {
                activeView.evaluateJavascript(js, value -> {
                    if (!isAppOrigin() || webView != activeView) {
                        call.reject("Campus bridge session changed", "SESSION_CHANGED");
                        return;
                    }
                    JSObject result = new JSObject();
                    result.put("value", value == null ? "null" : value);
                    call.resolve(result);
                });
            } catch (Throwable error) {
                call.reject(error.getMessage() == null ? "eval failed" : error.getMessage());
            }
        });
    }

    @PluginMethod
    public void show(PluginCall call) {
        runFromApp(call, () -> {
            ensureWebView();
            visible = true;
            container.setVisibility(View.VISIBLE);
            container.setTranslationX(0);
            container.setTranslationY(0);
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            container.setLayoutParams(params);
            container.bringToFront();
            if (closeButton != null) closeButton.setVisibility(View.VISIBLE);
            call.resolve();
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        runFromApp(call, () -> {
            visible = false;
            if (container != null) {
                container.setTranslationX(dp(OFFSCREEN_X));
                container.setTranslationY(0);
                container.setLayoutParams(offscreenParams());
                if (closeButton != null) closeButton.setVisibility(View.GONE);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        runFromApp(call, () -> {
            destroyWebView();
            call.resolve();
        });
    }

    @PluginMethod
    public void currentUrl(PluginCall call) {
        runFromApp(call, () -> {
            JSObject result = new JSObject();
            String url = webView == null ? null : webView.getUrl();
            result.put("url", url == null ? "" : url);
            result.put("visible", visible);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void hasVpnSession(PluginCall call) {
        String url = call.getString("url", "");
        if (!allowed(url)) {
            call.reject("host not allowed");
            return;
        }
        runFromApp(call, () -> {
            String cookies = CookieManager.getInstance().getCookie(url);
            boolean hasSession = false;
            if (cookies != null) {
                for (String cookie : cookies.split(";")) {
                    if (cookie.trim().startsWith("wengine_vpn_ticket=")) {
                        hasSession = true;
                        break;
                    }
                }
            }
            JSObject result = new JSObject();
            result.put("hasSession", hasSession);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setCookie(PluginCall call) {
        String url = call.getString("url", "");
        String cookie = call.getString("cookie", "");
        if (!allowed(url)) {
            call.reject("host not allowed");
            return;
        }
        if (cookie == null || cookie.trim().isEmpty()) {
            call.reject("cookie required");
            return;
        }
        runFromApp(call, () -> {
            CookieManager manager = CookieManager.getInstance();
            manager.setAcceptCookie(true);
            manager.setCookie(url, cookie);
            manager.flush();
            call.resolve();
        });
    }

    @PluginMethod
    public void setCapture(PluginCall call) {
        runFromApp(call, () -> {
            synchronized (capturedRequests) {
                captureView = call.getBoolean("enabled", false) ? webView : null;
                if (captureView == null) capturedRequests.clear();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void requests(PluginCall call) {
        runFromApp(call, () -> {
            JSObject result = new JSObject();
            synchronized (capturedRequests) {
                result.put("requests", new com.getcapacitor.JSArray(capturedRequests));
            }
            call.resolve(result);
        });
    }

    @PluginMethod
    public void clearData(PluginCall call) {
        runFromApp(call, () -> {
            CookieManager.getInstance().removeAllCookies(null);
            CookieManager.getInstance().flush();
            if (webView != null) webView.clearCache(true);
            call.resolve();
        });
    }

    // ------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    private void ensureWebView() {
        if (webView != null) return;
        FrameLayout root = getActivity().findViewById(android.R.id.content);
        container = new FrameLayout(getActivity());
        container.setBackgroundColor(Color.WHITE);
        container.setLayoutParams(offscreenParams());
        container.setTranslationX(dp(OFFSCREEN_X));

        webView = new WebView(getActivity());
        webView.setBackgroundColor(Color.WHITE);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // 校内站点仍以 http 为主（WebVPN 网关、体测 8080），混用内容必须放行。
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl() == null ? "" : request.getUrl().toString();
                return !allowed(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                JSObject data = new JSObject();
                data.put("url", url);
                notifyListeners("pageLoaded", data);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                JSObject data = new JSObject();
                data.put("url", String.valueOf(request.getUrl()));
                data.put("code", error.getErrorCode());
                data.put("description", String.valueOf(error.getDescription()));
                notifyListeners("pageError", data);
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                synchronized (capturedRequests) {
                    if (view == captureView && request.getUrl() != null) {
                        String url = request.getUrl().toString();
                        String query = request.getUrl().getEncodedQuery();
                        // Only token URLs are consumed by the practice-system sync.
                        if (query != null && query.toLowerCase(java.util.Locale.ROOT).contains("token=")
                            && allowed(url) && capturedRequests.size() < 32
                            && !capturedRequests.contains(url)) {
                            capturedRequests.add(url);
                        }
                    }
                }
                return null;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                result.confirm();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                result.confirm();
                return true;
            }
        });

        container.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        closeButton = new Button(getActivity());
        closeButton.setText("完成");
        closeButton.setAllCaps(false);
        closeButton.setVisibility(View.GONE);
        FrameLayout.LayoutParams buttonParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.END);
        buttonParams.topMargin = dp(16);
        buttonParams.rightMargin = dp(16);
        closeButton.setOnClickListener(v -> {
            hideContainer();
            notifyListeners("closed", new JSObject());
        });
        container.addView(closeButton, buttonParams);

        root.addView(container);
        webView.loadUrl("about:blank");
    }

    private void hideContainer() {
        visible = false;
        container.setTranslationX(dp(OFFSCREEN_X));
        container.setLayoutParams(offscreenParams());
        closeButton.setVisibility(View.GONE);
    }

    private void destroyWebView() {
        synchronized (capturedRequests) {
            captureView = null;
            capturedRequests.clear();
        }
        if (webView != null) {
            try {
                webView.stopLoading();
                webView.loadUrl("about:blank");
                webView.removeAllViews();
                webView.destroy();
            } catch (Throwable ignored) {
                /* WebView 可能已被系统回收 */
            }
            webView = null;
        }
        if (container != null && container.getParent() instanceof ViewGroup) {
            ((ViewGroup) container.getParent()).removeView(container);
        }
        container = null;
        closeButton = null;
        visible = false;
    }

    private FrameLayout.LayoutParams offscreenParams() {
        // 用像素而不是 dp：离屏 WebView 需要一个足够大的渲染画布（1080×1920）。
        return new FrameLayout.LayoutParams(1080, 1920);
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value,
            getContext().getResources().getDisplayMetrics()));
    }

    private boolean allowed(String rawUrl) {
        if (rawUrl == null) return false;
        String url = rawUrl.trim().toLowerCase(java.util.Locale.ROOT);
        if (url.startsWith("about:") || url.startsWith("javascript:")) return true;
        if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
        String host;
        try {
            host = new URI(url).getHost();
        } catch (Throwable error) {
            return false;
        }
        if (host == null || host.isEmpty()) return false;
        for (String suffix : ALLOWED_SUFFIXES) {
            if (host.equals(suffix.substring(1)) || host.endsWith(suffix)) return true;
        }
        return false;
    }
}
