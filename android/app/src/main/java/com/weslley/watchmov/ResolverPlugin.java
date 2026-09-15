package com.weslley.watchmov;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import android.widget.FrameLayout;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Resolvedor OCULTO (pedido 14/09/2026: "quando clicar em assistir abra direto no reprodutor").
 * Carrega a página da fonte como FRAME PRINCIPAL de um WebView invisível (alpha 0, atrás do
 * WebView do app), com o MESMO UA e os MESMOS cookies do app e autoplay sem gesto, e:
 *  - intercepta cada request como o MainActivity faz (bloqueia lixo + StreamSnifferPlugin.inspect)
 *    → o link capturado chega ao JS pelo MESMO evento streamFound e o auto-abrir do VideoPlayer
 *    abre o reprodutor;
 *  - quando a página põe o player num IFRAME cross-origin de host conhecido (hopHosts), navega o
 *    WebView oculto PRA ESSA URL como frame principal (frame-hop; só o frame principal aceita
 *    evaluateJavascript), mandando a página atual como Referer;
 *  - a cada 1,5 s roda o clickScript (montado no JS, src/lib/resolver.ts) no frame principal:
 *    clica a 1ª opção/gate/play ainda não clicada e dá play mudo nos <video>.
 * budgetMs → evento resolverEvent{type:'timeout'}; stop() destrói o WebView. Um por vez.
 * Diagnóstico de campo: RESOLVER_HOP / RESOLVER_CLICK / RESOLVER_TIMEOUT na aba Bugs (≤ 10/sessão).
 */
@CapacitorPlugin(name = "Resolver")
public class ResolverPlugin extends Plugin {

    private WebView web;                                   // só na UI thread
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Set<String> hopped = new HashSet<>();
    private List<String> hopHosts = new ArrayList<>();
    private String clickScript = "";
    private String currentUrl = "";
    private int hops = 0;
    private int reports = 0;
    private int navReports = 0;                             // RESOLVER_NAV_BLOCKED: no máx. 3 (não come o teto do TIMEOUT)
    private int clicks = 0;
    private boolean injected = false;
    private String injectScript = "";
    private int session = 0;                                // invalida callbacks de um start() antigo
    private Runnable deadline;
    private final Runnable ticker = new Runnable() { @Override public void run() { tick(); } };

    @PluginMethod
    public void start(final PluginCall call) {
        final String url = call.getString("url");
        final String referer = call.getString("referer", "");
        final int budgetMs = call.getInt("budgetMs", 15000);
        final String script = call.getString("clickScript", "");
        final String inject = call.getString("injectScript", "");
        final List<String> hosts = new ArrayList<>();
        try {
            JSArray a = call.getArray("hopHosts");
            if (a != null) for (int i = 0; i < a.length(); i++) hosts.add(a.getString(i).toLowerCase());
        } catch (Exception ignored) {}
        final Activity act = getActivity();
        if (url == null || url.isEmpty() || act == null) { call.reject("url/activity"); return; }
        ui.post(() -> {
            try {
                stopInternal();
                final int mySession = ++session;
                hopped.clear(); hops = 0; reports = 0; navReports = 0; clicks = 0; hopHosts = hosts; clickScript = script; injectScript = inject; injected = false; currentUrl = url;
                WebView w = new WebView(act);
                WebSettings s = w.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setMediaPlaybackRequiresUserGesture(false);      // autoplay / play() sem toque
                s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                s.setSupportMultipleWindows(false);                // popup = anúncio → não abre
                s.setJavaScriptCanOpenWindowsAutomatically(false);
                s.setUserAgentString(ProxyServer.userAgent());     // MESMO UA do app (googlevideo prende a URL ao UA)
                CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);   // cf_clearance / Blogger
                w.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                        String u = req.getUrl() != null ? req.getUrl().toString() : null;
                        if (StreamSnifferPlugin.shouldBlockResource(u)) return StreamSnifferPlugin.blockedResponse();
                        if (u != null && StreamSnifferPlugin.isWatching()) StreamSnifferPlugin.inspect(u, req.getRequestHeaders());
                        maybeHop(mySession, req);
                        return null;
                    }
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        // Só http(s) navega; esquema de app externo (intent://, market://) = anúncio → aborta.
                        android.net.Uri u = req.getUrl();
                        String sch = u != null ? u.getScheme() : null;
                        if (sch == null || !(sch.equals("http") || sch.equals("https"))) return true;
                        // Subframe e redirect HTTP seguem. Main-frame por JS só pro MESMO site da página
                        // atual ou pra host de hop — troca cross-site (popunder via location.href) = anúncio.
                        if (!req.isForMainFrame() || req.isRedirect()) return false;
                        String host = u.getHost() != null ? u.getHost().toLowerCase() : "";
                        if (sameSite(host, hostOf(currentUrl)) || isHopHost(host)) return false;
                        if (navReports++ < 3) report("RESOLVER_NAV_BLOCKED", u.toString());
                        return true;
                    }
                    @Override
                    public void onPageFinished(WebView v, String u) {
                        if (mySession != session) return;
                        if (u != null && !u.isEmpty()) currentUrl = u;
                        emit("loaded", u);
                        if (!injected) runClicks();
                    }
                });
                w.setAlpha(0f);
                w.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                FrameLayout root = act.findViewById(android.R.id.content);
                // Tamanho REAL (players medem o viewport antes de iniciar), ATRÁS do WebView do app.
                root.addView(w, 0, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                web = w;
                // Injeta em TODOS os frames (inclusive cross-origin) no document-start: cada frame clica sua
                // opção/gate/play. O gate da Byse (.captcha-gate__play) só renderiza DENTRO do iframe f7hyg4q
                // (em branco no topo), então evaluateJavascript/hop não alcançavam; addDocumentStartJavaScript sim.
                if (injectScript != null && !injectScript.isEmpty() && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    try { WebViewCompat.addDocumentStartJavaScript(w, injectScript, java.util.Collections.singleton("*")); injected = true; }
                    catch (Throwable t) { injected = false; }
                }
                // Diagnóstico: a injeção em todos os frames ficou ativa? (aba Bugs)
                report("RESOLVER_INJECT", injected ? "on" : (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) ? "add-threw" : "unsupported"));
                Map<String, String> h = new HashMap<>();
                if (referer != null && !referer.isEmpty()) h.put("Referer", referer);
                w.loadUrl(url, h);
                if (!injected) ui.postDelayed(ticker, 1500);   // injeção cobre todos os frames; ticker só no fallback
                deadline = () -> {
                    if (mySession != session) return;
                    snapshotThen(mySession, snap -> {
                        report("RESOLVER_TIMEOUT", "hops=" + hops + " clicks=" + clicks + " " + snap + " url=" + currentUrl);
                        emit("timeout", currentUrl);
                        stopInternal();
                    });
                };
                ui.postDelayed(deadline, budgetMs);
                call.resolve();
            } catch (Throwable t) { call.reject("start: " + t); }
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        ui.post(() -> { stopInternal(); call.resolve(); });
    }

    // Player em IFRAME cross-origin de host conhecido → vira frame principal (só assim dá pra clicar por JS).
    private void maybeHop(final int mySession, WebResourceRequest req) {
        if (injected) return;   // injeção em todos os frames dispensa (e o hop deixa f7hyg4q em branco)
        try {
            if (req.isForMainFrame() || hops >= 3) return;
            Map<String, String> hdr = req.getRequestHeaders();
            String accept = hdr != null ? hdr.get("Accept") : null;
            String dest = hdr != null ? hdr.get("Sec-Fetch-Dest") : null;
            boolean doc = "iframe".equalsIgnoreCase(dest) || (accept != null && accept.contains("text/html"));
            if (!doc) return;
            String host = req.getUrl().getHost();
            if (host == null) return;
            host = host.toLowerCase();
            if (!isHopHost(host) || !hopped.add(host)) return;
            final String target = req.getUrl().toString();
            final String from = currentUrl;
            final String hdrRef = hdr != null ? hdr.get("Referer") : null;
            final String ref = (hdrRef != null && !hdrRef.isEmpty()) ? hdrRef : from;   // Referer real do iframe (página-mãe)
            hops++;
            ui.post(() -> {
                if (mySession != session || web == null) return;
                Map<String, String> h = new HashMap<>();
                h.put("Referer", ref);
                currentUrl = target;
                report("RESOLVER_HOP", target + " ref=" + hostOf(ref));
                emit("hop", target);
                web.loadUrl(target, h);
            });
        } catch (Throwable ignored) {}
    }

    private static String hostOf(String url) {
        try { String h = android.net.Uri.parse(url).getHost(); return h == null ? "" : h.toLowerCase(); } catch (Throwable t) { return ""; }
    }
    // Mesmo site = mesmos 2 últimos rótulos (www.embedplay.one ~ embedplay.one).
    private static boolean sameSite(String a, String b) {
        if (a.isEmpty() || b.isEmpty()) return false;
        if (a.equals(b)) return true;
        String[] x = a.split("\\."), y = b.split("\\.");
        if (x.length < 2 || y.length < 2) return false;
        return x[x.length - 1].equals(y[y.length - 1]) && x[x.length - 2].equals(y[y.length - 2]);
    }
    private boolean isHopHost(String host) {
        for (String x : hopHosts) if (host.equals(x) || host.endsWith("." + x)) return true;
        return false;
    }

    // Diagnóstico de campo no timeout: o que o frame principal do oculto tinha (vídeos, readyState,
    // iframes e título) — sem aparelho aqui é o único jeito de ver até onde a página chegou.
    private static final String SNAP_JS = "(function(){try{var v=document.querySelectorAll('video');var s='v='+v.length;"
        + "if(v[0])s+='/rs'+v[0].readyState+(v[0].paused?'p':'P');var f=[];document.querySelectorAll('iframe').forEach(function(i){try{f.push(new URL(i.src,location.href).host)}catch(e){}});"
        + "s+=' if='+f.slice(0,4).join(',');s+=' t='+(document.title||'').slice(0,30);return s}catch(e){return 'snap-err'}})()";

    private void snapshotThen(final int mySession, final java.util.function.Consumer<String> cb) {
        final WebView w = web;
        if (w == null || mySession != session) { cb.accept(""); return; }
        final boolean[] done = { false };
        try {
            w.evaluateJavascript(SNAP_JS, r -> {
                if (done[0]) return; done[0] = true;
                cb.accept(r == null ? "" : r.replace("\"", ""));
            });
        } catch (Throwable t) { if (!done[0]) { done[0] = true; cb.accept(""); } return; }
        ui.postDelayed(() -> { if (!done[0]) { done[0] = true; cb.accept("snap-timeout"); } }, 1000);
    }

    private void tick() {
        if (web == null) return;
        runClicks();
        ui.postDelayed(ticker, 1500);
    }

    private void runClicks() {
        if (web == null || clickScript == null || clickScript.isEmpty()) return;
        try {
            web.evaluateJavascript(clickScript, r -> {
                if (r == null || "null".equals(r) || r.contains("none")) return;
                clicks++;
                report("RESOLVER_CLICK", r + " @ " + currentUrl);
                emit("click", r);
            });
        } catch (Throwable ignored) {}
    }

    private void report(String name, String note) {
        if (reports >= 10) return;
        reports++;
        try { NativePlayerPlugin.reportError(currentUrl, 0, 0, name, note, null, null, null); } catch (Throwable ignored) {}
    }

    private void emit(String type, String url) {
        JSObject d = new JSObject();
        d.put("type", type);
        d.put("url", url == null ? "" : url);
        d.put("hops", hops);
        notifyListeners("resolverEvent", d);
    }

    private void stopInternal() {
        session++;
        ui.removeCallbacks(ticker);
        if (deadline != null) { ui.removeCallbacks(deadline); deadline = null; }
        WebView w = web;
        web = null;
        if (w == null) return;
        try { w.stopLoading(); w.loadUrl("about:blank"); } catch (Throwable ignored) {}
        try { if (w.getParent() instanceof FrameLayout) ((FrameLayout) w.getParent()).removeView(w); } catch (Throwable ignored) {}
        try { w.destroy(); } catch (Throwable ignored) {}
    }
}
