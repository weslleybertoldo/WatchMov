package com.weslley.watchmov;

import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * "Sniffer" de stream (estilo Web Video Cast). Carrega a página do servidor
 * (embed) num WebView oculto com autoplay liberado e observa o tráfego de rede;
 * na primeira request de vídeo (.m3u8/.mp4/.mpd) devolve a URL + Referer pro JS,
 * que passa a tocar no player próprio do app. Se nada aparecer no tempo limite,
 * rejeita → o app cai no iframe do servidor (fallback).
 */
@CapacitorPlugin(name = "StreamSniffer")
public class StreamSnifferPlugin extends Plugin {

    private WebView sniffer;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable timeoutTask;

    private static boolean looksLikeVideo(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        // Ignora segmentos HLS (.ts) — queremos a playlist (.m3u8) ou o mp4/mpd.
        return u.contains(".m3u8") || u.contains(".mp4") || u.contains(".mpd")
            || u.contains("/manifest") || u.contains("master.m3u8");
    }

    private static String mimeFor(String url) {
        String u = url.toLowerCase();
        if (u.contains(".m3u8") || u.contains("master") || u.contains("/manifest")) return "application/vnd.apple.mpegurl";
        if (u.contains(".mpd")) return "application/dash+xml";
        return "video/mp4";
    }

    @PluginMethod
    public void sniff(final PluginCall call) {
        final String url = call.getString("url");
        final int timeoutMs = call.getInt("timeoutMs", 20000);
        if (url == null || url.isEmpty()) { call.reject("no_url"); return; }

        final AtomicBoolean done = new AtomicBoolean(false);

        main.post(() -> {
            teardown(); // garante que só há um sniffer por vez

            sniffer = new WebView(getContext());
            WebSettings s = sniffer.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);  // autoplay → dispara a request do vídeo
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            s.setLoadWithOverviewMode(true);
            s.setUseWideViewPort(true);

            // 1x1 fora da tela (precisa estar anexado pra renderizar/tocar).
            FrameLayout decor = (FrameLayout) getActivity().getWindow().getDecorView();
            sniffer.setLayoutParams(new FrameLayout.LayoutParams(1, 1));
            decor.addView(sniffer);

            sniffer.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    String reqUrl = request.getUrl() != null ? request.getUrl().toString() : null;
                    if (looksLikeVideo(reqUrl) && done.compareAndSet(false, true)) {
                        String referer = null;
                        Map<String, String> headers = request.getRequestHeaders();
                        if (headers != null) referer = headers.get("Referer");
                        final String fReferer = referer;
                        main.post(() -> resolveOnce(call, reqUrl, mimeFor(reqUrl), fReferer));
                    }
                    return null; // só observa; não altera a request
                }
            });

            sniffer.loadUrl(url);

            timeoutTask = () -> {
                if (done.compareAndSet(false, true)) {
                    teardown();
                    call.reject("not_found");
                }
            };
            main.postDelayed(timeoutTask, timeoutMs);
        });
    }

    private void resolveOnce(PluginCall call, String url, String mime, String referer) {
        if (timeoutTask != null) main.removeCallbacks(timeoutTask);
        teardown();
        JSObject res = new JSObject();
        res.put("url", url);
        res.put("mime", mime);
        if (referer != null) res.put("referer", referer);
        call.resolve(res);
    }

    @PluginMethod
    public void cancel(final PluginCall call) {
        main.post(() -> { teardown(); call.resolve(); });
    }

    private void teardown() {
        if (timeoutTask != null) { main.removeCallbacks(timeoutTask); timeoutTask = null; }
        if (sniffer != null) {
            try {
                sniffer.stopLoading();
                sniffer.loadUrl("about:blank");
                ViewGroup parent = (ViewGroup) sniffer.getParent();
                if (parent != null) parent.removeView(sniffer);
                sniffer.destroy();
            } catch (Exception ignored) {}
            sniffer = null;
        }
    }
}
