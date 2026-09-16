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
import androidx.webkit.ScriptHandler;
import android.widget.FrameLayout;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;

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
    // ABYS (15/09/2026): a página oculta vira MOTOR do vídeo. abyssSid = sessão no ProxyServer
    // (/abyss/<sid>/…); `engine` = manter o WebView vivo depois do stop(keep) — o ExoPlayer lê os bytes
    // que o JS do frame abysscdn empurra. injectHandler = trocar o script (fallback Opção 2/Byse) e recarregar.
    private ScriptHandler injectHandler;
    private String abyssSid = "", injectAlt = "", startUrl = "";
    private boolean abyssReady = false, engine = false, abyssExtended = false;
    private Runnable abyssFallback;
    // v4.57: ciclo de opcoes (playerflix / Fonte 6). O console WMOPT diz N/nomes; o nativo troca o K e recarrega.
    private String referer = "";
    private int optK = 1, optN = 0, optReports = 0;
    private String[] optNames = new String[0];
    private long optMs = 30000;
    private Runnable optTimer;
    private int optTries = 0;
    private final StringBuilder abysLog = new StringBuilder();

    @Override
    public void load() {
        // O proxy avisa quando o JS do frame abysscdn leu as qualidades → emitimos os 3 links ao app.
        ProxyServer.onAbyssReady = (sid, qs) -> ui.post(() -> onAbyssReady(sid, qs));
    }

    @PluginMethod
    public void start(final PluginCall call) {
        final String url = call.getString("url");
        final String referer = call.getString("referer", "");
        final int budgetMs = call.getInt("budgetMs", 15000);
        final String script = call.getString("clickScript", "");
        final String inject = call.getString("injectScript", "");
        final String injectAltScript = call.getString("injectScriptAlt", "");
        final String sid = call.getString("abyssSid", "");
        final int fallbackMs = call.getInt("fallbackMs", 0);
        final int optMsArg = call.getInt("optMs", 30000);
        final int startOptArg = call.getInt("startOpt", 1);
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
                abyssSid = sid; injectAlt = injectAltScript; abyssReady = false; engine = false; abyssExtended = false; startUrl = url; injectHandler = null; abyssFallback = null;
                this.referer = referer; optMs = optMsArg; optK = Math.max(1, startOptArg); optN = 0; optReports = 0; optTries = 0; optNames = new String[0]; optTimer = null; abysLog.setLength(0); StreamSnifferPlugin.currentOption = "";
                if (abyssSid != null && !abyssSid.isEmpty()) { optN = 2; optNames = new String[]{ "ABYS", "Byse" }; }
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
                w.setWebChromeClient(new WebChromeClient() {
                    @Override public boolean onConsoleMessage(ConsoleMessage cm) {
                        try { handleConsole(mySession, cm.message()); } catch (Throwable ignored) {}
                        return false;
                    }
                });
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
                    try { injectHandler = WebViewCompat.addDocumentStartJavaScript(w, substK(injectScript, optK), java.util.Collections.singleton("*")); injected = true; }
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
                if (optN > 0) emitOption();
                // Fonte 1: o script principal clica "Opção 1" (ABYS). Sem `ready` do proxy em fallbackMs →
                // troca o script injetado pelo alternativo ("Opção 2"/Byse, caminho da v4.54) e recarrega.
                if (fallbackMs > 0 && injected && !injectAlt.isEmpty()) {
                    final Map<String, String> hh = new HashMap<>(h);
                    abyssFallback = () -> {
                        if (mySession != session || abyssReady || web == null) return;
                        // O frame abysscdn JÁ leu as qualidades (só falta medir/avisar): dá mais fallbackMs pro `ready`
                        // antes de desistir — no emulador lento as sources chegam aos ~30 s; no aparelho, ~10 s.
                        if (!abyssExtended && ProxyServer.abyssHasProgress(abyssSid)) {
                            abyssExtended = true;
                            report("RESOLVER_ABYS_WAIT", "sources lidas; +" + fallbackMs + " ms pro ready");
                            ui.postDelayed(abyssFallback, fallbackMs);
                            return;
                        }
                        optK = 2; emitOption(); reportOption("RESOLVER_OPTION_FAIL", "k=1/" + optN + " name=" + (optNames != null && optNames.length > 0 ? optNames[0] : "ABYS"));
                        report("RESOLVER_ABYS_FALLBACK", "sem ready em " + (abyssExtended ? 2 * fallbackMs : fallbackMs) + " ms → Opção 2 (Byse) frame=" + ProxyServer.abyssHasProgress(abyssSid) + " log=" + tailLog());
                        try {
                            if (injectHandler != null) injectHandler.remove();
                            injectHandler = WebViewCompat.addDocumentStartJavaScript(web, injectAlt, java.util.Collections.singleton("*"));
                        } catch (Throwable t) { report("RESOLVER_ABYS_FALLBACK", "troca de script falhou: " + t); }
                        ProxyServer.abyssDrop(abyssSid);
                        try { web.stopLoading(); web.loadUrl(startUrl, hh); } catch (Throwable ignored) {}
                    };
                    ui.postDelayed(abyssFallback, fallbackMs);
                }
                call.resolve();
            } catch (Throwable t) { call.reject("start: " + t); }
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        final boolean keep = Boolean.TRUE.equals(call.getBoolean("keep", false));
        ui.post(() -> { if (keep && engine) pauseInternal(); else stopInternal(); call.resolve(); });
    }

    // v4.61: escolha manual de opcao (tap na lista da tela "Procurando") — reinjeta/recarrega naquele k.
    @PluginMethod
    public void pickOption(final PluginCall call) {
        final int k = call.getInt("k", 1);
        ui.post(() -> {
            if (web == null || optN <= 0) { call.resolve(); return; }
            optK = Math.max(1, Math.min(k, optN));
            optTries = 0;
            emitOption();
            try {
                if (injectHandler != null) injectHandler.remove();
                injectHandler = WebViewCompat.addDocumentStartJavaScript(web, substK(injectScript, optK), java.util.Collections.singleton("*"));
            } catch (Throwable ignored) {}
            Map<String, String> h = new HashMap<>();
            if (referer != null && !referer.isEmpty()) h.put("Referer", referer);
            try { web.stopLoading(); web.loadUrl(startUrl, h); } catch (Throwable ignored) {}
            if (optTimer != null) { ui.removeCallbacks(optTimer); ui.postDelayed(optTimer, optMs); }
            call.resolve();
        });
    }

    // stop(keep): o vídeo já está no ExoPlayer via /abyss/ — para relógio, cliques e fallback, mas MANTÉM
    // o WebView (motor) vivo até o app fechar o player (stop sem keep) ou um start() novo.
    private void pauseInternal() {
        ui.removeCallbacks(ticker);
        if (deadline != null) { ui.removeCallbacks(deadline); deadline = null; }
        if (abyssFallback != null) { ui.removeCallbacks(abyssFallback); abyssFallback = null; }
        if (optTimer != null) { ui.removeCallbacks(optTimer); optTimer = null; }
    }

    // O JS do frame abysscdn leu as qualidades e o tamanho de cada MP4 virtual → os links locais entram
    // no app pelo MESMO streamFound. Ordem DECRESCENTE 1080p→720p→480p→360p (v4.57: padrão = MAIOR qualidade; o botão de qualidade troca), o
    // auto-avanço do player tenta o mais leve).
    private void onAbyssReady(String sid, java.util.List<ProxyServer.AbyssQuality> qs) {
        if (web == null || sid == null || !sid.equals(abyssSid)) return;
        abyssReady = true; engine = true;
        if (abyssFallback != null) { ui.removeCallbacks(abyssFallback); abyssFallback = null; }
        if (optTimer != null) { ui.removeCallbacks(optTimer); optTimer = null; }
        java.util.List<ProxyServer.AbyssQuality> order = new ArrayList<>(qs);
        java.util.Collections.sort(order, (a, b) -> b.q - a.q);   // v4.57: MAIOR qualidade primeiro (1080→720→480→360)
        StringBuilder sb = new StringBuilder();
        for (ProxyServer.AbyssQuality q : order) {
            if (sb.length() > 0) sb.append(',');
            sb.append(q.q).append("p=").append(q.total / 1048576).append("MiB");
            StreamSnifferPlugin.emitDirect(ProxyServer.abyssUrl(sid, q.q), "video/mp4", q.q + "p", currentUrl, true);
        }
        report("RESOLVER_ABYS_READY", sb.toString());
        emit("abyss", currentUrl);
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
        if (reports >= 14) return;
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

    private String substK(String t, int k) { return t == null ? "" : t.replace("__OPT_K__", String.valueOf(k)); }

    private String tailLog() { String x = abysLog.toString(); return x.length() > 180 ? x.substring(x.length() - 180) : x; }

    // Console do WebView (todos os frames): WMABYS = diagnostico do pump ABYS; WMOPT = lista de opcoes do playerflix.
    private void handleConsole(int mySession, String msg) {
        if (mySession != session || msg == null) return;
        if (msg.startsWith("WMABYS")) { if (abysLog.length() < 4000) abysLog.append(msg).append(" | "); return; }
        if (msg.startsWith("WMBLOG|")) {
            // v4.62: `WMBLOG|q=<qualidade>|url=<u>` (hook do batchexecute do Blogger: itag 18/22) ou o
            // formato antigo `WMBLOG|url=<u>` (leitor de config no frame do YouTube) = 360p.
            String body = msg.substring(7);
            String q = "360p";
            if (body.startsWith("q=")) {
                int bar = body.indexOf('|');
                if (bar < 0) return;
                q = body.substring(2, bar);
                body = body.substring(bar + 1);
            }
            if (!body.startsWith("url=")) return;
            final String u = body.substring(4);
            final String quality = q;
            if (u.startsWith("http")) ui.post(() -> {
                if (mySession != session) return;
                report("RESOLVER_BLOGGER", "url capturada " + quality);
                StreamSnifferPlugin.emitDirect(u, "video/mp4", quality, currentUrl, true);
            });
            return;
        }
        if (!msg.startsWith("WMOPT|")) return;
        final String body = msg.substring(6);
        // v4.62: opção que o JS já sabe que não dá (Premium = superflixapi atrás do Turnstile,
        // server-only) → avança na hora em vez de queimar os 30 s do cronômetro nela.
        // v4.63: opções NÃO dubladas ficam fora do ciclo (só pt-br) — registra quantas, pra ele ver na aba Bugs
        // por que um título só legendado caiu em "troque de fonte".
        if (body.startsWith("filtered|")) {
            final String note = body.substring(9);
            ui.post(() -> { if (mySession == session) report("RESOLVER_OPTION_FILTER", note); });
            return;
        }
        if (body.startsWith("skip|")) {
            final String note = body.substring(5);
            ui.post(() -> { if (mySession == session) skipOption(mySession, note); });
            return;
        }
        if (!body.startsWith("n=")) return;
        int n; String[] names;
        try {
            String[] parts = body.split("\\|names=", 2);
            n = Integer.parseInt(parts[0].substring(2).trim());
            names = (parts.length > 1 && !parts[1].isEmpty()) ? parts[1].split("\u00bb") : new String[0];
        } catch (Throwable t) { return; }
        final int nn = n; final String[] nm = names;
        ui.post(() -> onOptionsDiscovered(mySession, nn, nm));
    }

    // playerflix informou N opcoes -> cronometra cada uma (e cancela o deadline fixo: o ciclo controla o fim).
    private void onOptionsDiscovered(int mySession, int n, String[] names) {
        if (mySession != session || web == null || n <= 0) return;
        optN = n; optNames = names;
        emitOption();
        if (optTimer == null) {
            if (deadline != null) ui.removeCallbacks(deadline);
            optTimer = () -> advanceOption(mySession);
            ui.postDelayed(optTimer, optMs);
        }
    }

    // v4.62: opção descartada pelo JS (Turnstile) — mesma mecânica do advance, com registro próprio.
    private void skipOption(int mySession, String note) {
        if (mySession != session || web == null || optTimer == null) return;
        reportOption("RESOLVER_OPTION_SKIP", note);
        advanceOption(mySession, true);
    }

    // Opcao k nao achou video em optMs -> registra e tenta a proxima; todas falharam -> timeout (picker manual).
    private void advanceOption(int mySession) { advanceOption(mySession, false); }

    private void advanceOption(int mySession, boolean skipped) {
        if (mySession != session || web == null || abyssReady || engine) return;
        if (optTimer != null) ui.removeCallbacks(optTimer);   // chamada fora do cronômetro não pode deixar 2 timers
        String cur = (optNames != null && optK - 1 >= 0 && optK - 1 < optNames.length) ? optNames[optK - 1] : "";
        if (!skipped) reportOption("RESOLVER_OPTION_FAIL", "k=" + optK + "/" + optN + " name=" + cur);
        optTries++;
        if (optTries < optN) {
            optK = (optK % optN) + 1;
            emitOption();
            try {
                if (injectHandler != null) injectHandler.remove();
                injectHandler = WebViewCompat.addDocumentStartJavaScript(web, substK(injectScript, optK), java.util.Collections.singleton("*"));
            } catch (Throwable t) { reportOption("RESOLVER_OPTION_FAIL", "reinjecao: " + t); }
            Map<String, String> h = new HashMap<>();
            if (referer != null && !referer.isEmpty()) h.put("Referer", referer);
            try { web.stopLoading(); web.loadUrl(startUrl, h); } catch (Throwable ignored) {}
            ui.postDelayed(optTimer, optMs);
        } else {
            final int ms = mySession;
            snapshotThen(ms, snap -> {
                report("RESOLVER_TIMEOUT", "todas as " + optN + " opcoes falharam " + snap + " url=" + currentUrl);
                emit("timeout", currentUrl);
                stopInternal();
            });
        }
    }

    private void emitOption() {
        JSObject d = new JSObject();
        d.put("type", "option");
        d.put("k", optK);
        d.put("n", optN);
        String curNm = (optNames != null && optK - 1 >= 0 && optK - 1 < optNames.length) ? optNames[optK - 1] : "";
        d.put("name", curNm);
        JSArray nmArr = new JSArray(); if (optNames != null) for (String s : optNames) nmArr.put(s);
        d.put("names", nmArr);
        d.put("url", currentUrl);
        StreamSnifferPlugin.currentOption = curNm;
        notifyListeners("resolverEvent", d);
    }

    private void reportOption(String name, String note) {
        if (optReports >= 8) return;
        optReports++;
        try { NativePlayerPlugin.reportError(currentUrl, 0, 0, name, note, null, null, null); } catch (Throwable ignored) {}
    }

    private void stopInternal() {
        session++;
        StreamSnifferPlugin.currentOption = "";
        if (abyssFallback != null) { ui.removeCallbacks(abyssFallback); abyssFallback = null; }
        if (optTimer != null) { ui.removeCallbacks(optTimer); optTimer = null; }
        engine = false; abyssReady = false; abyssExtended = false; injectHandler = null;
        ProxyServer.abyssDrop(abyssSid);
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
