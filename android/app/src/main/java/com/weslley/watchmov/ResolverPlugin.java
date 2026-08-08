package com.weslley.watchmov;

import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.WebChromeClient;
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

/**
 * Resolvedor ON-DEVICE (estilo Smart Play, mas server-side deles vira on-device
 * aqui). Abre o embed num WebView OCULTO (1x1) no IP residencial do celular,
 * bloqueia disable-devtool/trackers (StreamSnifferPlugin.shouldBlockResource),
 * injeta stealth + dispara o play, e captura a 1ª URL de vídeo (.m3u8/.mp4) com
 * o Referer. Devolve pro JS, que abre no player nativo — sem mostrar a UI/ads do
 * provedor. Provado no resolvedor Playwright (mesmo mecanismo, IP residencial).
 */
@CapacitorPlugin(name = "Resolver")
public class ResolverPlugin extends Plugin {

    private static final String UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    private static final String STEALTH_CLICK =
        "try{Object.defineProperty(navigator,'webdriver',{get:function(){return undefined}})}catch(e){}"
        + "try{window.chrome={runtime:{}}}catch(e){}"
        + "try{var S=['.jw-icon-display','.vjs-big-play-button','.plyr__control--overlaid','video','[class*=option]','[class*=opcao]','[class*=server]','.play','.btn-play','#player'];"
        + "S.forEach(function(s){document.querySelectorAll(s).forEach(function(el){try{el.click()}catch(e){}})});"
        + "document.querySelectorAll('button,a,li,div').forEach(function(el){var t=(el.innerText||'').trim();if(/^(op..o 1|dublado|assistir|play)/i.test(t)){try{el.click()}catch(e){}}});"
        + "document.querySelectorAll('video').forEach(function(v){try{v.muted=true;var p=v.play();if(p&&p.catch)p.catch(function(){})}catch(e){}});"
        + "try{if(window.jwplayer){var j=window.jwplayer();if(j&&j.play){j.setMute&&j.setMute(true);j.play(true)}}}catch(e){}"
        + "try{if(window.videojs){document.querySelectorAll('video-js,.video-js').forEach(function(el){try{var p=window.videojs(el);p.muted(true);p.play()}catch(e){}})}}catch(e){}"
        + "}catch(e){}";

    private WebView web;
    private WebView popup;
    private boolean done;
    private int hopCount;
    private Handler handler;

    @PluginMethod
    public void resolve(final PluginCall call) {
        final String url = call.getString("url");
        final int timeoutMs = call.getInt("timeoutMs", 20000);
        if (url == null || url.isEmpty()) { call.reject("no url"); return; }
        getActivity().runOnUiThread(() -> start(call, url, timeoutMs));
    }

    private FrameLayout decor() { return (FrameLayout) getActivity().getWindow().getDecorView(); }

    private void cleanup() {
        try { if (web != null) { web.stopLoading(); ((FrameLayout) web.getParent()).removeView(web); web.destroy(); } } catch (Exception ignored) {}
        try { if (popup != null) { popup.stopLoading(); ((FrameLayout) popup.getParent()).removeView(popup); popup.destroy(); } } catch (Exception ignored) {}
        web = null; popup = null;
    }

    private void finishOk(PluginCall call, String u, String referer, String mime) {
        if (done) return; done = true;
        JSObject r = new JSObject();
        r.put("url", u);
        r.put("referer", referer == null ? "" : referer);
        r.put("mime", mime);
        cleanup();
        call.resolve(r);
    }

    private void finishEmpty(PluginCall call) {
        if (done) return; done = true;
        cleanup();
        call.resolve(new JSObject()); // sem 'url' → chamador cai no fallback (iframe)
    }

    private WebResourceResponse handle(PluginCall call, WebView v, WebResourceRequest req) {
        String u = req.getUrl() != null ? req.getUrl().toString() : null;
        if (StreamSnifferPlugin.shouldBlockResource(u)) return StreamSnifferPlugin.blockedResponse();
        if (u != null && StreamSnifferPlugin.looksLikeVideo(u)) {
            String ref = req.getRequestHeaders() != null ? req.getRequestHeaders().get("Referer") : null;
            final String fu = u, fref = ref, fmime = mimeFor(u);
            android.util.Log.d("Resolver", "CAPTUROU: " + fu + " (ref=" + fref + ")");
            v.post(() -> finishOk(call, fu, fref, fmime));
        }
        return null;
    }

    private WebView makeSniffer(final PluginCall call) {
        WebView w = new WebView(getContext());
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUserAgentString(UA);
        // Tamanho REAL (senão o <video> não faz layout → player não autoplaya → sem
        // request de segmento). Invisível via alpha 0 (renderiza + roda JS/mídia).
        w.setLayoutParams(new FrameLayout.LayoutParams(1280, 720));
        w.setAlpha(0f);
        return w;
    }

    private void start(final PluginCall call, final String url, final int timeoutMs) {
        try {
            startInner(call, url, timeoutMs);
        } catch (Throwable t) {
            android.util.Log.e("Resolver", "start falhou: " + t, t);
            finishEmpty(call); // NUNCA deixa a promise pendente (senão o app trava no spinner)
        }
    }

    private void startInner(final PluginCall call, final String url, final int timeoutMs) {
        android.util.Log.d("Resolver", "resolve start: " + url);
        done = false;
        hopCount = 0;
        web = makeSniffer(call);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) { return handle(call, v, req); }
            @Override public void onPageFinished(WebView v, String u) {
                poke(v);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                try {
                    if (popup != null) { try { popup.destroy(); } catch (Exception ignored) {} }
                    popup = makeSniffer(call);
                    popup.setWebViewClient(new WebViewClient() {
                        @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) { return handle(call, v, req); }
                        @Override public void onPageFinished(WebView v, String u) { v.evaluateJavascript(STEALTH_CLICK, null); }
                    });
                    decor().addView(popup);
                    WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
                    t.setWebView(popup);
                    resultMsg.sendToTarget();
                    return true;
                } catch (Exception e) { return false; }
            }
        });
        decor().addView(web);
        web.loadUrl(url);
        handler = new Handler(Looper.getMainLooper());
        final WebView fw = web;
        // O player (JW) roda em iframe cross-origin → JS não alcança. Clique no
        // MAIN frame (seletor de áudio/servidor same-origin do embedplayapi) via JS
        // + TOQUE SINTÉTICO no centro (gesto real atravessa o iframe → play do JW).
        for (int i = 1; i <= 12; i++) {
            final int delay = 2000 + i * 1600;
            handler.postDelayed(() -> { if (!done && fw != null) poke(fw); }, delay);
        }
        handler.postDelayed(() -> { android.util.Log.d("Resolver", "timeout — sem stream"); finishEmpty(call); }, timeoutMs);
    }

    // Cutuca o player: clique JS (main-frame) + toque sintético + poll do iframe
    // aninhado (injetado por JS após o load) → hop pra folha onde o JW é main-frame.
    private void poke(WebView v) {
        if (v == null || done) return;
        v.evaluateJavascript(STEALTH_CLICK, null);
        tap(v);
        if (hopCount < 3) {
            final String cur = v.getUrl();
            v.evaluateJavascript(
                "(function(){var f=document.querySelector('iframe');return f&&f.src?f.src:''})()",
                val -> {
                    if (done || val == null) return;
                    String src = val.replace("\"", "").trim();
                    if (!src.startsWith("http")) return;
                    try {
                        String h1 = new java.net.URL(src).getHost();
                        String h0 = cur != null ? new java.net.URL(cur).getHost() : "";
                        // Só hopa pra iframe com PATH real (página) — evita pular pro
                        // endpoint de dados tipo abysscdn.com/?v= (path "/") e perder o JW.
                        String path = new java.net.URL(src).getPath();
                        boolean hasPath = path != null && path.length() > 1;
                        if (!h1.equalsIgnoreCase(h0) && hasPath) {
                            hopCount++;
                            android.util.Log.d("Resolver", "HOP(" + hopCount + ") -> " + src);
                            v.loadUrl(src);
                        }
                    } catch (Exception ignored) {}
                });
        }
    }

    // Toque sintético real no centro do WebView (atravessa iframe cross-origin →
    // aciona o play do JW Player, que o evaluateJavascript não alcança).
    private void tap(WebView w) {
        try {
            if (w == null) return;
            float x = w.getWidth() > 0 ? w.getWidth() / 2f : 640f;
            float y = w.getHeight() > 0 ? w.getHeight() / 2f : 360f;
            long t = SystemClock.uptimeMillis();
            MotionEvent down = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y, 0);
            MotionEvent up = MotionEvent.obtain(t, t + 90, MotionEvent.ACTION_UP, x, y, 0);
            w.dispatchTouchEvent(down);
            w.dispatchTouchEvent(up);
            down.recycle();
            up.recycle();
        } catch (Exception ignored) {}
    }

    private static String mimeFor(String u) {
        String l = u.toLowerCase();
        if (l.contains(".mpd")) return "application/dash+xml";
        if (l.contains(".m3u8") || l.contains("master") || l.contains("/m3/") || (l.contains(".txt") && !l.contains(".mp4"))) return "application/vnd.apple.mpegurl";
        return "video/mp4";
    }
}
