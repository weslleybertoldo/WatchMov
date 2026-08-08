package com.weslley.watchmov;

import android.os.Handler;
import android.os.Looper;
import android.os.Message;
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
        + "}catch(e){}";

    private WebView web;
    private WebView popup;
    private boolean done;
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
        w.setLayoutParams(new FrameLayout.LayoutParams(1, 1));
        return w;
    }

    private void start(final PluginCall call, final String url, final int timeoutMs) {
        done = false;
        web = makeSniffer(call);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) { return handle(call, v, req); }
            @Override public void onPageFinished(WebView v, String u) { v.evaluateJavascript(STEALTH_CLICK, null); }
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
        handler.postDelayed(() -> finishEmpty(call), timeoutMs);
    }

    private static String mimeFor(String u) {
        String l = u.toLowerCase();
        if (l.contains(".mpd")) return "application/dash+xml";
        if (l.contains(".m3u8") || l.contains("master") || l.contains("/m3/") || (l.contains(".txt") && !l.contains(".mp4"))) return "application/vnd.apple.mpegurl";
        return "video/mp4";
    }
}
