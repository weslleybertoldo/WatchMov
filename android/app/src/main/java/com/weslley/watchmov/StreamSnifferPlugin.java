package com.weslley.watchmov;

import android.annotation.SuppressLint;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * "Sniffer" de stream (estilo Web Video Cast). Carrega a página do servidor num
 * WebView oculto com autoplay liberado, injeta JS que força o play e hooka
 * fetch/XHR, e observa o tráfego de rede; na primeira request de vídeo devolve a
 * URL + Referer. Se nada aparecer no tempo limite, devolve diagnóstico (quantas
 * requests viu) → o app cai no iframe do servidor (fallback).
 */
@CapacitorPlugin(name = "StreamSniffer")
public class StreamSnifferPlugin extends Plugin {

    private static final String TAG = "WatchMovSniff";

    private WebView sniffer;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable timeoutTask;
    private final Set<String> seen = Collections.synchronizedSet(new LinkedHashSet<String>());

    // Hook JS: força play e reporta URLs de fetch/XHR (o iframe cross-origin não é
    // alcançável, mas cobre players no documento principal + apressa o autoplay).
    private static final String INJECT_JS =
        "(function(){try{" +
        "function rep(u){try{u=''+u;if(u&&(u.indexOf('.m3u8')>-1||u.indexOf('.mp4')>-1||u.indexOf('.mpd')>-1)){AndroidSniffer.onUrl(u);}}catch(e){}}" +
        "var of=window.fetch;if(of){window.fetch=function(){try{rep(arguments[0]&&arguments[0].url?arguments[0].url:arguments[0]);}catch(e){}return of.apply(this,arguments);};}" +
        "var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{rep(u);}catch(e){}return oo.apply(this,arguments);};" +
        "function play(){try{var vs=document.getElementsByTagName('video');for(var i=0;i<vs.length;i++){try{vs[i].muted=true;var p=vs[i].play();if(p&&p.catch)p.catch(function(){});}catch(e){}}" +
        "var sel=['.vjs-big-play-button','[class*=play]','[id*=play]','.jw-icon-playback','button'];for(var s=0;s<sel.length;s++){try{var e=document.querySelector(sel[s]);if(e)e.click();}catch(_){}}}catch(e){}}" +
        "var n=0;var iv=setInterval(function(){play();if(++n>25)clearInterval(iv);},800);play();" +
        "}catch(e){}})();";

    private static boolean looksLikeVideo(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        return u.contains(".m3u8") || u.contains(".mp4") || u.contains(".mpd")
            || u.contains("master.m3u8") || u.contains("/manifest");
    }

    private static String mimeFor(String url) {
        String u = url.toLowerCase();
        if (u.contains(".m3u8") || u.contains("master") || u.contains("/manifest")) return "application/vnd.apple.mpegurl";
        if (u.contains(".mpd")) return "application/dash+xml";
        return "video/mp4";
    }

    @PluginMethod
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    public void sniff(final PluginCall call) {
        final String url = call.getString("url");
        final int timeoutMs = call.getInt("timeoutMs", 20000);
        if (url == null || url.isEmpty()) { call.reject("no_url"); return; }
        Log.d(TAG, "sniff START url=" + url + " timeout=" + timeoutMs);

        final AtomicBoolean done = new AtomicBoolean(false);
        seen.clear();

        main.post(() -> {
            teardown();

            sniffer = new WebView(getContext());
            WebSettings s = sniffer.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            s.setLoadWithOverviewMode(true);
            s.setUseWideViewPort(true);
            s.setUserAgentString("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");

            sniffer.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void onUrl(String u) {
                    Log.d(TAG, "JS reported: " + u);
                    handleCandidate(call, done, u);
                }
            }, "AndroidSniffer");

            // Fora da tela, atrás do conteúdo (índice 0). Tamanho real ajuda players a iniciar.
            FrameLayout decor = (FrameLayout) getActivity().getWindow().getDecorView();
            sniffer.setLayoutParams(new FrameLayout.LayoutParams(640, 360));
            sniffer.setAlpha(0.01f);
            decor.addView(sniffer, 0);

            sniffer.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    String reqUrl = request.getUrl() != null ? request.getUrl().toString() : null;
                    if (reqUrl != null) {
                        seen.add(reqUrl);
                        if (looksLikeVideo(reqUrl)) {
                            String referer = null;
                            Map<String, String> h = request.getRequestHeaders();
                            if (h != null) referer = h.get("Referer");
                            final String fRef = referer;
                            Log.d(TAG, "NET video: " + reqUrl + " (ref=" + fRef + ")");
                            if (done.compareAndSet(false, true)) {
                                main.post(() -> resolveOnce(call, reqUrl, mimeFor(reqUrl), fRef));
                            }
                        }
                    }
                    return null;
                }

                @Override
                public void onPageFinished(WebView view, String pageUrl) {
                    Log.d(TAG, "onPageFinished: " + pageUrl + " | seen=" + seen.size());
                    view.evaluateJavascript(INJECT_JS, null);
                }
            });

            sniffer.loadUrl(url);

            timeoutTask = () -> {
                if (done.compareAndSet(false, true)) {
                    Log.d(TAG, "TIMEOUT — nenhuma URL de vídeo. Requests vistas=" + seen.size());
                    resolveDiag(call);
                }
            };
            main.postDelayed(timeoutTask, timeoutMs);
        });
    }

    private void handleCandidate(PluginCall call, AtomicBoolean done, String u) {
        if (u != null) seen.add(u);
        if (looksLikeVideo(u) && done.compareAndSet(false, true)) {
            main.post(() -> resolveOnce(call, u, mimeFor(u), null));
        }
    }

    private void resolveOnce(PluginCall call, String url, String mime, String referer) {
        if (timeoutTask != null) main.removeCallbacks(timeoutTask);
        Log.d(TAG, "RESOLVE url=" + url + " mime=" + mime);
        teardown();
        JSObject res = new JSObject();
        res.put("url", url);
        res.put("mime", mime);
        if (referer != null) res.put("referer", referer);
        call.resolve(res);
    }

    // Timeout sem vídeo: devolve diagnóstico (nº de requests + amostra) sem rejeitar.
    private void resolveDiag(PluginCall call) {
        JSArray sample = new JSArray();
        int i = 0;
        synchronized (seen) {
            for (String u : seen) { if (i++ >= 15) break; sample.put(u); }
        }
        int total = seen.size();
        teardown();
        JSObject res = new JSObject();
        res.put("seenCount", total);
        res.put("sample", sample);
        call.resolve(res);   // sem url → o JS trata como "não capturou"
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
