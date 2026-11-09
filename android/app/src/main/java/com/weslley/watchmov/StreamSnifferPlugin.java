package com.weslley.watchmov;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Sniffer passivo (estilo Web Video Cast). O iframe do servidor toca no WebView
 * principal do app; MainActivity observa o tráfego (WebViewClient + Service
 * Worker) e chama inspect(). Detecta vídeo por EXTENSÃO e, quando não tem, por
 * CONTENT-TYPE (probe OkHttp com os headers — como o fpa.c do WVC). Ao achar um
 * HLS, baixa o master e lê a RESOLUTION pra rotular a qualidade.
 */
@CapacitorPlugin(name = "StreamSniffer")
public class StreamSnifferPlugin extends Plugin {

    private static StreamSnifferPlugin instance;
    private static volatile boolean watching = false;
    private static final Set<String> emitted = Collections.synchronizedSet(new HashSet<String>());
    private static final Set<String> probed = Collections.synchronizedSet(new HashSet<String>());
    private static final ExecutorService pool = Executors.newFixedThreadPool(3);
    private static final OkHttpClient http = new OkHttpClient.Builder().dns(AppDns.get()).build();   // DoH → sistema (AppDns)
    private static int probeCount = 0;

    @Override
    public void load() { instance = this; }

    public static boolean isWatching() { return watching; }

    private static String noQuery(String url) { int q = url.indexOf('?'); return q >= 0 ? url.substring(0, q) : url; }

    // Domínios que NUNCA são o vídeo (aposta/ads/tracker/abuso) — nem salva nem proba.
    // Barra lixo tipo brwin.games/api/hall/manifest e o dummy do muro anti-hotlink.
    // v4.61: opcao ativa do resolvedor (WatchPlay/Premium/ABYS/Blogger) pra carimbar cada captura.
    public static volatile String currentOption = "";

    private static final String[] BLOCKED_HOSTS = {
        "cloudflare-terms-of-service-abuse", "brwin.games",
        "doubleclick.net", "googlesyndication.com", "adservice.", "popads.", "popcash.",
        "propellerads.", "propu.", "adnxs.", "onclickalgo.", "hilltopads.", "juicyads.",
        "exoclick.", "trafficjunky.", "mgid.", "revcontent.", "outbrain.", "taboola.",
        // criativos de vídeo-anúncio vistos poluindo o picker (09/08): apostas/adulto
        "redgarto.", "blacked.com", "masonry.blacked", "clickadu.", "adsterra.",
        "monetag.", "galaksion.", "trafficstars.", "eroadvertising.", "vast."
    };

    // Paths típicos de criativo de anúncio (mesmo em CDN "neutra"): nunca é o conteúdo.
    private static final String[] AD_PATHS = {
        "/gambling/", "/interstitial/", "/notifications/", "/creatives/", "/adasset",
    };
    private static boolean isAdPath(String u) {
        for (String p : AD_PATHS) if (u.contains(p)) return true;
        return false;
    }

    public static boolean isBlockedHost(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        for (String b : BLOCKED_HOSTS) if (u.contains(b)) return true;
        return false;
    }

    // Hosts que servem VÍDEO mas nunca o conteúdo (anúncio em vídeo / trailer). Ficam fora da
    // LISTA "Links do vídeo", mas continuam carregando no WebView — bloquear o pré-roll
    // travava o JW Player (14/09/2026: anúncio Betano via bannerflow entrava como MASTER e
    // morria em ERROR_CODE_PARSING_MANIFEST_MALFORMED).
    private static final String[] NOT_CONTENT_HOSTS = { "bannerflow.net", "betano.", "gmlinteractive." };
    static boolean isNotContent(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        for (String h : NOT_CONTENT_HOSTS) if (u.contains(h)) return true;
        // Pedaço CIFRADO do player Abyss (`…sssrr.org/sora/<tamanho>/<token>`, 2 MiB): nunca toca sozinho — o ABYS toca
        // pelo /abyss/ do ProxyServer. 25/09/2026, no celular dele: o probe pegou um /sora/ como vídeo, o auto-abrir
        // abriu ele antes do `ready` e o player deu "Nenhum link tocou" (EOFException).
        if (u.contains("/sora/")) return true;
        // Blogger entrega o episódio via googlevideo (source=blogger — MANTÉM); trailer/anúncio
        // do YouTube vem do mesmo CDN com source=youtube → lixo.
        return u.contains("googlevideo.com") && u.contains("source=youtube");
    }

    // Recursos que QUEBRAM a página (anti-devtool blanka a tela ao detectar o
    // browser controlado) ou são analytics/tracker — bloqueados no WebView pra a
    // página renderizar e o sniffer captar (provado no resolvedor Playwright).
    private static final String[] KILL_RES = {
        "disable-devtool", "metricas.site", "whos.amung", "amung.us",
        "pixel.morphify", "morphify.net", "histats", "static.cloudflareinsights",
        "google-analytics.com", "googletagmanager.com",
    };

    // 04/11/2026 (Fontes 5 e 6 — SuperFlix, WarezCDN e rede OverFlix): o servidor bloqueia com HTTP 403
    // ("Acesso bloqueado para este app · com.weslley.watchmov") quando recebe o header
    // automático do Android WebView `X-Requested-With: com.weslley.watchmov` (no GET inicial,
    // em iframes do servidor ou no POST do formulário de validação da Cloudflare). Interceptamos
    // os hosts das Fontes 5 e 6 e domínios irmãos via OkHttp (sem tocar em challenges.cloudflare.com),
    // sincronizando cookies em todos os hops e convertendo o POST da validação para sair sem o nome do app.
    private static final String[] HOSTS_SEM_NOME_DO_APP = {
        "superflixapi.", "superflixonline.", "superflix.",
        "warezcdn.", "overflixhd.", "overflix.",
        "megaflixonline.", "megaflix."
    };

    /** Desativa o cabeçalho automático X-Requested-With no WebView para que nenhuma requisição
     *  vaze a identificação com.weslley.watchmov para domínios externos. */
    public static void desativarHeaderApp(android.webkit.WebView wv) {
        if (wv == null) return;
        try {
            if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
                androidx.webkit.WebSettingsCompat.setRequestedWithHeaderOriginAllowList(wv.getSettings(), java.util.Collections.emptySet());
            }
        } catch (Throwable ignored) {}
    }

    // 04/11/2026: player final que a WarezCDN abre no iframe (FirePlayer da SuperFlixAPI, host disfarçado
    // "ココ・レストラン予約センター", o mesmo desde 14/09/2026; o TLD troca). O access.js dele lê o X-Requested-With da
    // página /video/ e troca o player por "Acesso bloqueado para este app" (A Odisseia na Fonte 6 parava ali; no
    // WebView 155 do emulador o setRequestedWithHeaderOriginAllowList não tirou o cabeçalho). Só a página, o controle
    // de acesso e os scripts vão sem o nome do app: o POST /layer/ (o jQuery já põe X-Requested-With: XMLHttpRequest)
    // e a mídia (master.txt de uso único, faixas /m3/) seguem pelo próprio WebView — refeitos pelo OkHttp davam 403.
    static boolean ehPlayerFinal(String url) {
        return url != null && url.toLowerCase(java.util.Locale.ROOT).contains("xn--tckasiu6cvova0eb5fua2449g98vg.");
    }

    public static boolean precisaEsconderApp(String url) {
        if (url == null) return false;
        String u = url.toLowerCase(java.util.Locale.ROOT);
        for (String h : HOSTS_SEM_NOME_DO_APP) if (u.contains(h)) return true;
        return ehPlayerFinal(u) && (u.contains("/video/") || u.contains("/fireplayer-control/") || u.contains("/player/assets/"));
    }

    private static final OkHttpClient httpSemNome = new OkHttpClient.Builder()
        .dns(AppDns.get())
        .followRedirects(false)
        .followSslRedirects(false)
        .addNetworkInterceptor(chain -> {
            Request req = chain.request();
            String reqUrl = req.url().toString();
            Request.Builder rb = req.newBuilder()
                .removeHeader("X-WM-Post-Body")
                .removeHeader("X-WM-Post-CT");
            String xrw = req.header("X-Requested-With");
            if (xrw != null && !"XMLHttpRequest".equalsIgnoreCase(xrw.trim())) {
                rb.removeHeader("X-Requested-With");
            }
            try {
                String ck = android.webkit.CookieManager.getInstance().getCookie(reqUrl);
                if (ck != null && !ck.isEmpty()) rb.header("Cookie", ck);
            } catch (Throwable ignored) {}
            Response resp = chain.proceed(rb.build());
            try {
                android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                java.util.List<String> setCookies = resp.headers("Set-Cookie");
                if (setCookies != null && !setCookies.isEmpty()) {
                    for (String sc : setCookies) cm.setCookie(reqUrl, sc);
                    cm.flush();
                }
            } catch (Throwable ignored) {}
            return resp;
        })
        .build();

    static String uaLimpo(String ua) {
        if (ua == null || ua.isEmpty()) ua = ProxyServer.userAgent();
        if (ua == null) return "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
        return ua.replace("; wv)", ")").replace(" wv)", ")").replace("com.weslley.watchmov", "").replaceAll("\\s{2,}", " ").trim();
    }

    static boolean ehPaginaEntradaEmbed(String url) {
        if (url == null) return false;
        try {
            String path = new java.net.URI(url).getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) return true;
            String p = path.toLowerCase(java.util.Locale.ROOT);
            return p.startsWith("/filme/") || p.startsWith("/serie/") || p.startsWith("/tv/");
        } catch (Throwable t) {
            String low = url.toLowerCase(java.util.Locale.ROOT);
            return low.contains("/filme/") || low.contains("/serie/") || low.contains("/tv/");
        }
    }

    private static String extrairOrigin(String url) {
        if (url == null) return null;
        try {
            java.net.URI u = new java.net.URI(url);
            if (u.getScheme() != null && u.getHost() != null) return u.getScheme() + "://" + u.getHost();
        } catch (Throwable ignored) {}
        return null;
    }

    private static String extrairHost(String url) {
        if (url == null) return null;
        try {
            return new java.net.URI(url).getHost();
        } catch (Throwable ignored) { return null; }
    }

    static String resolverUrlRelativa(String baseUrl, String location) {
        if (location == null || location.isEmpty()) return baseUrl;
        if (location.startsWith("http://") || location.startsWith("https://")) return location;
        try {
            return new java.net.URI(baseUrl).resolve(location).toString();
        } catch (Throwable ignored) { return location; }
    }

    private static final Pattern NMS_PATTERN = Pattern.compile("https?:\\\\?/\\\\?/[^\"'\\s<>]+\\\\?/player\\\\?/native\\\\?/media-source\\\\?/[^\"'\\s<>]+");

    static String extrairMediaSourceNativo(String html) {
        if (html == null || !html.contains("media-source")) return null;
        Matcher m = NMS_PATTERN.matcher(html);
        if (!m.find()) return null;
        return m.group(0).replace("\\/", "/");
    }

    private static void resolverMediaSourceNativo(String nmsUrl, String referer, String ua) {
        try {
            Request.Builder rb = new Request.Builder()
                .url(nmsUrl)
                .get()
                .header("User-Agent", ua)
                .header("Accept", "*/*")
                .header("Range", "bytes=0-100")
                .header("Sec-Fetch-Dest", "video")
                .header("Sec-Fetch-Mode", "no-cors")
                .header("Sec-Fetch-Site", "same-origin");
            if (referer != null && !referer.isEmpty()) rb.header("Referer", referer);
            try (Response r = httpSemNome.newCall(rb.build()).execute()) {
                String loc = r.header("Location");
                if (loc != null && !loc.isEmpty()) {
                    String abs = resolverUrlRelativa(nmsUrl, loc);
                    report(abs, null, mimeFor(abs), null);
                }
            }
        } catch (Throwable ignored) {}
    }

    private static final String HOOK_POST_E_LIMPA_URL =
        "<script>(function(){try{"
        + "if(location.search.indexOf('__wm_post=')>=0)history.replaceState(null,'',location.pathname+location.hash);"
        + "var okU=function(u){try{var p=new URL(String(u||''),location.href);return p.hostname===location.hostname||/(superflixapi|superflixonline|superflix|warezcdn|overflixhd|overflix)\\./i.test(p.hostname)}catch(_){return false}};"
        + "var b64=function(s){try{return btoa(unescape(encodeURIComponent(s)))}catch(_){return ''}};"
        + "var strBody=function(b){if(!b)return null;if(typeof b==='string')return {s:b,ct:''};"
        + "if(typeof URLSearchParams!=='undefined'&&b instanceof URLSearchParams)return {s:b.toString(),ct:'application/x-www-form-urlencoded;charset=UTF-8'};"
        + "if(typeof FormData!=='undefined'&&b instanceof FormData){try{return {s:new URLSearchParams(b).toString(),ct:'application/x-www-form-urlencoded;charset=UTF-8'}}catch(_){}}return null;};"
        + "var OF=window.fetch;if(OF)window.fetch=function(i,init){try{var u=typeof i==='string'?i:(i&&i.url)||'';if(okU(u)&&init&&String(init.method||'').toUpperCase()==='POST'&&init.body){"
        + "var sb=strBody(init.body);if(sb){var h=new Headers(init.headers||{});h.set('X-WM-Post-Body',b64(sb.s));if(sb.ct&&!h.has('Content-Type'))h.set('X-WM-Post-CT',sb.ct);init=Object.assign({},init,{headers:h});}}}"
        + "catch(_){}return OF.call(this,i,init)};"
        + "var XO=XMLHttpRequest.prototype.open,XS=XMLHttpRequest.prototype.send;"
        + "XMLHttpRequest.prototype.open=function(m,u){this.__wmM=String(m||'').toUpperCase();this.__wmU=String(u||'');return XO.apply(this,arguments)};"
        + "XMLHttpRequest.prototype.send=function(b){try{if(this.__wmM==='POST'&&b&&okU(this.__wmU)){var sb=strBody(b);if(sb){this.setRequestHeader('X-WM-Post-Body',b64(sb.s));if(sb.ct)this.setRequestHeader('X-WM-Post-CT',sb.ct);}}}catch(_){}return XS.apply(this,arguments)};"
        + "}catch(_){}})();</script>";

    private static final String HOOK_TURNSTILE_TAP =
        "<script>(function(){try{"
        + "var n=0,iv=setInterval(function(){"
        + "n++;if(n>30){clearInterval(iv);return;}"
        + "var s=document.querySelector('.captcha-status');"
        + "if(s&&/conclu/i.test(s.textContent||'')){clearInterval(iv);return;}"
        + "var b=document.querySelector('.cf-turnstile-placeholder')||document.querySelector('.captcha-box');"
        + "if(!b)return;"
        + "var r=b.getBoundingClientRect();"
        + "if(r.width>100&&r.height>30&&window.innerWidth>0&&window.innerHeight>0){"
        + "console.log('WMCFTAP|'+Math.round(r.left+28)+'|'+Math.round(r.top+r.height/2)+'|'+Math.round(window.innerWidth)+'|'+Math.round(window.innerHeight));"
        + "}"
        + "},3200);"
        + "}catch(_){}})();</script>";

    // 04/11/2026: a lista chega pelo POST /player/bootstrap DEPOIS da página completa (A Odisseia na Fonte 6 pulava
    // pra Fonte 7) e a página tenta até 3× com 12 s cada → espera até ~42 s e só desiste quando a PÁGINA escreve na
    // lista que não há servidor ("Nenhum servidor nesta opção.") ou que falhou ("Não foi possível carregar…").
    private static final String HOOK_AUTO_SERVER_PLAY =
        "<script>(function(){try{"
        + "var done=false,n=0,iv=setInterval(function(){"
        + "n++;if(done||n>120){clearInterval(iv);return;}"
        + "var box=typeof sfDomEl==='function'?sfDomEl('serverList'):null;"
        + "var list=box?box.querySelectorAll('a'):document.querySelectorAll('a[href=\"javascript:void(0)\"]');"
        + "for(var i=0;i<list.length;i++){"
        + "var a=list[i],t=(a.textContent||'').trim();"
        + "if(/download|voltar/i.test(t))continue;"
        + "if((box&&box.contains(a))||/servidor\\s+(principal|alternativo)/i.test(t)){"
        + "done=true;clearInterval(iv);a.click();return;"
        + "}"
        + "}"
        + "var msg=box&&!box.querySelector('a')?String(box.innerText||box.textContent||'').trim():'';"
        + "if(msg){done=true;clearInterval(iv);try{console.log('WMOPT|none|reason='+(/foi poss/i.test(msg)?'f56-erro-servidores':'f56-sem-servidor')+'|host='+location.hostname);}catch(_){}}"
        + "},350);"
        + "}catch(_){}})();</script>";

    static String preparaHtmlVerificacao(String html) {
        if (html == null || html.isEmpty()) return html;
        String out = html;
        if (out.contains("cloudflareEmbedCaptchaPassed") || out.contains("cf_embed_challenge")) {
            // O Turnstile moderno renderiza o iframe num Closed Shadow DOM → querySelector no Light DOM
            // retorna null e aos 12 s a página mostra falso erro ("Não foi possível carregar a verificação").
            out = out.replace("if(!hasTurnstile)", "if(false)");
            // Em vez de form.submit() (POST nativo que reenvia X-Requested-With: com.weslley.watchmov),
            // navega com __wm_post=... que o fetchSemNomeDoApp converte em POST real no OkHttp.
            out = out.replace(
                "form.submit();",
                "try{var _u=new URL(form.action||location.href,location.href);_u.searchParams.set('__wm_post',new URLSearchParams(new FormData(form)).toString());location.replace(_u.toString());return;}catch(_e){form.submit();}"
            );
            int bodyEnd = out.lastIndexOf("</body>");
            if (bodyEnd >= 0) out = out.substring(0, bodyEnd) + HOOK_TURNSTILE_TAP + out.substring(bodyEnd);
            else out = out + HOOK_TURNSTILE_TAP;
        }
        if (out.contains("renderServerList") || out.contains("SF_DOM_IDS")) {
            out = out.replace("event.originalEvent.isTrusted !== true", "false");
            int bodyEnd = out.lastIndexOf("</body>");
            if (bodyEnd >= 0) out = out.substring(0, bodyEnd) + HOOK_AUTO_SERVER_PLAY + out.substring(bodyEnd);
            else out = out + HOOK_AUTO_SERVER_PLAY;
        }
        if (out.contains("/player/native/media-source/")) {
            out = out.replace("/player/native/media-source/", "/player/native/media-source-capturado/");
        }
        int headIdx = out.indexOf("<head>");
        if (headIdx >= 0) {
            out = out.substring(0, headIdx + 6) + HOOK_POST_E_LIMPA_URL + out.substring(headIdx + 6);
        } else {
            out = HOOK_POST_E_LIMPA_URL + out;
        }
        return out;
    }

    public static void tocarCheckboxTurnstile(final android.webkit.WebView w, final android.os.Handler ui, String msg) {
        if (w == null || ui == null || msg == null || !msg.startsWith("WMCFTAP|")) return;
        try {
            String[] p = msg.substring(8).split("\\|");
            if (p.length < 4) return;
            final int xCss = Integer.parseInt(p[0].trim());
            final int yCss = Integer.parseInt(p[1].trim());
            final int vw = Integer.parseInt(p[2].trim());
            final int vh = Integer.parseInt(p[3].trim());
            if (vw <= 0 || vh <= 0 || w.getWidth() <= 0 || w.getHeight() <= 0) return;
            final float px = xCss * ((float) w.getWidth() / (float) vw);
            final float py = yCss * ((float) w.getHeight() / (float) vh);
            long now = android.os.SystemClock.uptimeMillis();
            final android.view.MotionEvent down = android.view.MotionEvent.obtain(now, now, android.view.MotionEvent.ACTION_DOWN, px, py, 0);
            w.dispatchTouchEvent(down);
            ui.postDelayed(() -> {
                try {
                    long upAt = android.os.SystemClock.uptimeMillis();
                    android.view.MotionEvent up = android.view.MotionEvent.obtain(now, upAt, android.view.MotionEvent.ACTION_UP, px, py, 0);
                    w.dispatchTouchEvent(up);
                    up.recycle();
                } catch (Throwable ignored) {}
                try { down.recycle(); } catch (Throwable ignored) {}
            }, 60);
        } catch (Throwable ignored) {}
    }

    public static android.webkit.WebResourceResponse fetchSemNomeDoApp(android.webkit.WebResourceRequest req) {
        if (req == null || req.getUrl() == null) return null;
        String rawUrl = req.getUrl().toString();
        if (!precisaEsconderApp(rawUrl)) return null;
        if (rawUrl.contains("/player/native/media-source-capturado/")) return blockedResponse();
        try {
            String method = req.getMethod() != null ? req.getMethod().toUpperCase(java.util.Locale.ROOT) : "GET";
            Map<String, String> hdr = req.getRequestHeaders();
            String wmPostQuery = null;
            try { wmPostQuery = req.getUrl().getQueryParameter("__wm_post"); } catch (Throwable ignored) {}
            String wmPostHdr = hdr != null ? hdr.get("X-WM-Post-Body") : null;
            String wmPostCt = hdr != null ? hdr.get("X-WM-Post-CT") : null;

            String targetUrl = rawUrl;
            okhttp3.RequestBody postBody = null;
            boolean isAjaxPost = false;
            if (wmPostQuery != null) {
                method = "POST";
                targetUrl = rawUrl.replaceAll("([?&])__wm_post=[^&#]*(&?)", "$1").replaceAll("[?&]$", "").replace("?&", "?");
                postBody = okhttp3.RequestBody.create(wmPostQuery, okhttp3.MediaType.parse("application/x-www-form-urlencoded"));
            } else if ("POST".equals(method) && wmPostHdr != null && !wmPostHdr.isEmpty()) {
                isAjaxPost = true;
                byte[] decoded = android.util.Base64.decode(wmPostHdr, android.util.Base64.DEFAULT);
                String ct = (wmPostCt != null && !wmPostCt.isEmpty()) ? wmPostCt
                    : (hdr != null && hdr.get("Content-Type") != null ? hdr.get("Content-Type") : "application/x-www-form-urlencoded;charset=UTF-8");
                postBody = okhttp3.RequestBody.create(decoded, okhttp3.MediaType.parse(ct));
            } else if (!"GET".equals(method)) {
                return null;
            }

            String ua = hdr != null ? hdr.get("User-Agent") : null;
            final String cleanUa = uaLimpo(ua);

            if (targetUrl.contains("/player/native/media-source/")) {
                final String finalTargetUrl = targetUrl;
                final String finalRef = hdr != null ? hdr.get("Referer") : extrairOrigin(targetUrl);
                pool.submit(() -> resolverMediaSourceNativo(finalTargetUrl, finalRef, cleanUa));
                return blockedResponse();
            }

            String currentUrl = targetUrl;
            String currentMethod = method;
            okhttp3.RequestBody currentBody = ("POST".equals(method) && postBody != null) ? postBody : null;
            boolean currentTurnstilePost = (wmPostQuery != null);
            boolean currentAjaxPost = isAjaxPost;
            Response resp = null;

            for (int hop = 0; hop < 6; hop++) {
                Request.Builder rb = new Request.Builder().url(currentUrl);
                if ("POST".equals(currentMethod) && currentBody != null) {
                    rb.post(currentBody);
                } else {
                    rb.get();
                }
                if (hdr != null) {
                    for (Map.Entry<String, String> e : hdr.entrySet()) {
                        String k = e.getKey(), v = e.getValue();
                        if (k == null || v == null) continue;
                        if (k.equalsIgnoreCase("X-Requested-With") || k.equalsIgnoreCase("X-WM-Post-Body") || k.equalsIgnoreCase("X-WM-Post-CT")) continue;
                        if (k.equalsIgnoreCase("User-Agent") || k.equalsIgnoreCase("Host") || k.equalsIgnoreCase("Accept-Encoding")
                            || k.equalsIgnoreCase("Cookie") || k.equalsIgnoreCase("Content-Length")
                            || (currentBody != null && k.equalsIgnoreCase("Content-Type"))) continue;
                        rb.header(k, v);
                    }
                }
                rb.header("User-Agent", cleanUa);
                String origin = extrairOrigin(currentUrl);
                if (currentTurnstilePost) {
                    if (origin != null) rb.header("Origin", origin);
                    rb.header("Referer", currentUrl);
                    rb.header("Sec-Fetch-Site", "same-origin");
                    rb.header("Sec-Fetch-Mode", "navigate");
                    rb.header("Sec-Fetch-Dest", "iframe");
                } else if (currentAjaxPost) {
                    if (origin != null) rb.header("Origin", origin);
                    String ref = hdr != null ? hdr.get("Referer") : null;
                    if (ref == null || ref.isEmpty() || ref.contains("watchmovbr.vercel.app")) {
                        ref = origin != null ? origin + "/" : currentUrl;
                    }
                    rb.header("Referer", ref);
                    rb.header("X-Requested-With", "XMLHttpRequest");
                    rb.header("Sec-Fetch-Site", "same-origin");
                    rb.header("Sec-Fetch-Mode", "cors");
                    rb.header("Sec-Fetch-Dest", "empty");
                } else if ("GET".equals(currentMethod) && ehPaginaEntradaEmbed(currentUrl)) {
                    rb.removeHeader("Origin");
                    rb.header("Referer", "https://watchmovbr.vercel.app/");
                    rb.header("Sec-Fetch-Site", "cross-site");
                    rb.header("Sec-Fetch-Mode", "navigate");
                    rb.header("Sec-Fetch-Dest", "iframe");
                    rb.header("Upgrade-Insecure-Requests", "1");
                } else if ("GET".equals(currentMethod) && (currentUrl.contains("/player/redirect") || currentUrl.contains("/player/native/media/"))) {
                    rb.removeHeader("Origin");
                    String ref = hdr != null ? hdr.get("Referer") : null;
                    if (ref == null || ref.isEmpty() || ref.contains("watchmovbr.vercel.app")) {
                        ref = origin != null ? origin + "/" : currentUrl;
                    }
                    rb.header("Referer", ref);
                    rb.header("Sec-Fetch-Site", "same-origin");
                    rb.header("Sec-Fetch-Mode", "navigate");
                    rb.header("Sec-Fetch-Dest", "iframe");
                }

                resp = httpSemNome.newCall(rb.build()).execute();
                int code = resp.code();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = resp.header("Location");
                    try { resp.close(); } catch (Throwable ignored) {}
                    if (loc == null || loc.isEmpty()) break;
                    String absLoc = resolverUrlRelativa(currentUrl, loc);
                    if (looksLikeVideo(absLoc) || currentUrl.contains("/player/native/media-source/")) {
                        report(absLoc, null, mimeFor(absLoc), null);
                        return blockedResponse();
                    }
                    if (!precisaEsconderApp(absLoc)) {
                        String safeUrl = absLoc.replace("\\", "\\\\").replace("\"", "\\\"");
                        String redir = "<!doctype html><html><head><meta charset=\"utf-8\"><script>location.replace(\"" + safeUrl + "\");</script></head><body></body></html>";
                        return new android.webkit.WebResourceResponse("text/html", "utf-8", new java.io.ByteArrayInputStream(redir.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                    }
                    String curHost = extrairHost(currentUrl);
                    String nextHost = extrairHost(absLoc);
                    if (!currentTurnstilePost && curHost != null && nextHost != null && !curHost.equalsIgnoreCase(nextHost)) {
                        String safeUrl = absLoc.replace("\\", "\\\\").replace("\"", "\\\"");
                        String redir = "<!doctype html><html><head><meta charset=\"utf-8\"><script>location.replace(\"" + safeUrl + "\");</script></head><body></body></html>";
                        return new android.webkit.WebResourceResponse("text/html", "utf-8", new java.io.ByteArrayInputStream(redir.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                    }
                    currentUrl = absLoc;
                    currentMethod = "GET";
                    currentBody = null;
                    currentTurnstilePost = false;
                    currentAjaxPost = false;
                    continue;
                }
                break;
            }
            if (resp == null) return null;

            byte[] bodyBytes = resp.body() != null ? resp.body().bytes() : new byte[0];
            String ct = resp.header("Content-Type", "text/html; charset=utf-8");
            String mime = "text/html", enc = "utf-8";
            if (ct != null) {
                String[] p = ct.split(";");
                if (p.length > 0 && !p[0].trim().isEmpty()) mime = p[0].trim();
                for (int i = 1; i < p.length; i++) {
                    String s = p[i].trim().toLowerCase(java.util.Locale.ROOT);
                    if (s.startsWith("charset=")) enc = s.substring(8).trim().replace("\"", "");
                }
            }
            if ("text/html".equalsIgnoreCase(mime)) {
                String html = new String(bodyBytes, java.nio.charset.StandardCharsets.UTF_8);
                String nmsUrl = extrairMediaSourceNativo(html);
                if (nmsUrl != null) {
                    final String finalRef = currentUrl;
                    pool.submit(() -> resolverMediaSourceNativo(nmsUrl, finalRef, cleanUa));
                }
                // Player final (FirePlayer): o HTML vai como veio — sem o gancho de POST. O POST /layer/ dele sai pelo
                // próprio WebView (o jQuery já põe X-Requested-With: XMLHttpRequest, que não entrega o app); refeito
                // pelo OkHttp a página congelava esperando a resposta (A Odisseia na Fonte 6, 04/11/2026).
                if (!ehPlayerFinal(currentUrl)) {
                    bodyBytes = preparaHtmlVerificacao(html).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    enc = "utf-8";
                }
            }

            android.webkit.WebResourceResponse out = new android.webkit.WebResourceResponse(
                mime, enc, new java.io.ByteArrayInputStream(bodyBytes));
            int code = resp.code();
            if (code >= 300 && code < 400) code = 200;
            String msg = resp.message();
            try { out.setStatusCodeAndReasonPhrase(code, (msg == null || msg.isEmpty()) ? "OK" : msg); } catch (Throwable ignored) {}
            Map<String, String> rHdr = new java.util.HashMap<>();
            for (String name : resp.headers().names()) {
                String low = name.toLowerCase(java.util.Locale.ROOT);
                if (low.equals("content-encoding") || low.equals("content-length") || low.equals("transfer-encoding")
                    || low.equals("x-frame-options") || low.equals("content-security-policy") || low.equals("set-cookie")) continue;
                String val = resp.header(name);
                if (val != null) rHdr.put(name, val);
            }
            out.setResponseHeaders(rHdr);
            return out;
        } catch (Throwable ignored) { return null; }
    }

    // (SNIFF_TRACE da v4.51 removido em 15/09/2026: cumpriu o papel — 193 registros provaram como o
    // player Abyss entrega o vídeo — e inundava a aba Bugs. O ABYS agora toca via /abyss/ do ProxyServer.)

    public static boolean shouldBlockResource(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        for (String k : KILL_RES) if (u.contains(k)) return true;
        return isBlockedHost(url) || isAdPath(u);
    }

    public static android.webkit.WebResourceResponse blockedResponse() {
        return new android.webkit.WebResourceResponse("text/plain", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
    }

    public static boolean looksLikeVideo(String url) {
        if (url == null || isBlockedHost(url)) return false;
        String u = url.toLowerCase();
        if (isAdPath(u)) return false;              // criativo de anúncio, não é o vídeo
        String path = noQuery(u);
        // Segmentos/init NÃO são links tocáveis sozinhos → não captura (poluíam a lista
        // com dezenas de seg-/init/.m4s/.ts que o ExoPlayer já busca sozinho do master).
        if (path.contains("seg-") || path.contains("/seg") || path.contains("init-")
            || path.contains("/init.") || path.contains("chunk") || path.endsWith(".ts") || path.endsWith(".m4s")) return false;
        if (path.endsWith(".m3u8") || path.endsWith(".mpd") || path.endsWith(".mp4")
            || path.endsWith(".mkv") || path.endsWith(".webm") || path.endsWith(".m4v")
            || path.endsWith(".mov") || path.endsWith(".avi") || path.endsWith(".flv")) return true;
        // NÃO casa "/manifest" cru (pegava /api/hall/manifest de aposta) — sem extensão
        // vai pro probe, que confirma por conteúdo (#EXTM3U/ftyp/content-type).
        return u.contains("master.m3u8") || u.contains(".m3u8") || u.contains(".mpd");
    }

    // Requests que NÃO vale a pena probar (recursos óbvios não-vídeo).
    static boolean skipProbe(String url) {
        if (precisaEsconderApp(url)) return true;
        String p = noQuery(url.toLowerCase());
        // master.txt do player final = link de UM uso, do próprio player (o probe roubaria o pedido dele).
        if (ehPlayerFinal(p) && p.endsWith("master.txt")) return true;
        // v4.60: segmento/init de fMP4/HLS nunca é o link tocável sozinho (o master .m3u8/.mpd já os busca).
        // Antes o probe capturava o init.mp4 do WatchPlay (hclod.qzz.io) e o ExoPlayer dava ERROR_CODE_PARSING_CONTAINER_MALFORMED.
        if (p.contains("seg-") || p.contains("/seg") || p.contains("init-") || p.contains("/init.") || p.contains("chunk") || p.endsWith(".m4s")) return true;
        return p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".png") || p.endsWith(".jpg")
            || p.endsWith(".jpeg") || p.endsWith(".gif") || p.endsWith(".webp") || p.endsWith(".svg")
            || p.endsWith(".ico") || p.endsWith(".woff") || p.endsWith(".woff2") || p.endsWith(".ttf")
            || p.endsWith(".ts") || p.endsWith(".html") || p.endsWith(".json") || p.endsWith(".php")
            || p.startsWith("data:") || p.startsWith("blob:");
    }

    private static boolean isVideoContentType(String ct) {
        if (ct == null) return false;
        String c = ct.toLowerCase();
        return c.contains("mpegurl") || c.contains("dash+xml") || c.contains("video/")
            || c.contains("x-matroska") || c.contains("mp2t");
    }

    // Chamado pelo MainActivity (WebView + Service Worker) pra cada request.
    public static void inspect(String url, Map<String, String> headers) {
        if (!watching || url == null || isBlockedHost(url) || isNotContent(url)) return;
        // Chamadas do próprio app ao ProxyServer local (pump do ABYS: /abyss/progress|ready|next|push) nunca são
        // conteúdo — e o probe delas repetia o `ready` (RESOLVER_ABYS_READY em dobro, 15/09/2026).
        if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return;
        String ref = headers != null ? headers.get("Referer") : null;
        if (looksLikeVideo(url)) { report(url, ref, mimeFor(url), headers); return; }
        if (skipProbe(url)) return;
        if (probeCount > 60 || !probed.add(noQuery(url))) return;   // teto e dedup de probes
        probeCount++;
        pool.submit(() -> {
            try {
                Request.Builder rb = new Request.Builder().url(url).header("Range", "bytes=0-255");
                if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getKey() != null && e.getValue() != null && !e.getKey().equalsIgnoreCase("Range")) rb.header(e.getKey(), e.getValue());
                }
                try (Response resp = http.newCall(rb.build()).execute()) {
                    String ct = resp.header("Content-Type");
                    if (isVideoContentType(ct)) { report(url, ref, ct, headers); return; }
                    // Content-Type genérico (octet-stream/text/nulo): confere os 1os bytes.
                    if (ct == null || ct.toLowerCase().contains("octet-stream") || ct.toLowerCase().contains("text/")
                        || ct.toLowerCase().contains("application/binary")) {
                        if (resp.body() != null) {
                            byte[] b = resp.body().bytes();
                            String head = new String(b, 0, Math.min(b.length, 64));
                            if (head.contains("#EXTM3U")) { report(url, ref, "application/vnd.apple.mpegurl", headers); }
                            else if (head.contains("ftyp")) { report(url, ref, "video/mp4", headers); }
                        }
                    }
                }
            } catch (Exception ignored) {}
        });
    }

    private static String mimeFor(String url) {
        String u = url.toLowerCase();
        if (u.contains(".m3u8") || u.contains("master") || u.contains("/manifest")) return "application/vnd.apple.mpegurl";
        if (u.contains(".mpd")) return "application/dash+xml";
        return "video/mp4";
    }

    // Headers que NÃO devem ser replicados no replay do proxy: são recalculados por
    // conexão (hop-by-hop) ou atrapalham (Range/Accept-Encoding do probe).
    private static boolean dropHeader(String k) {
        if (k == null) return true;
        String l = k.toLowerCase();
        return l.equals("host") || l.equals("content-length") || l.equals("connection")
            || l.equals("accept-encoding") || l.equals("range") || l.equals("if-range")
            || l.equals("transfer-encoding") || l.equals("upgrade") || l.equals("keep-alive");
    }

    private static void report(String url, String referer, String mime, Map<String, String> headers) {
        if (instance == null || !watching || url == null || isBlockedHost(url)) return;
        if (!emitted.add(noQuery(url))) return;
        final String fMime = mime != null ? mime : mimeFor(url);
        final boolean isHls = fMime.toLowerCase().contains("mpegurl") || url.toLowerCase().contains(".m3u8");
        // Copia os headers REAIS que o WebView usou (Origin, sec-*, x-*, etc.) — o proxy
        // vai reenviar VERBATIM. Antes só o Referer sobrevivia à captura, e CDNs que
        // gateiam por Origin/token respondiam 403 ao replay incompleto ("chega com falha").
        final JSObject hdrs = new JSObject();
        if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) {
            if (e.getKey() != null && e.getValue() != null && !dropHeader(e.getKey())) hdrs.put(e.getKey(), e.getValue());
        }
        // O link vai pro app NA HORA (estudo do Nuvio, item 2, 20/10/2026): antes a resolução era medida primeiro
        // (baixar o master ou ler o vídeo = 0,3 a 3 s a mais em todo Play). A qualidade segue depois, sem tocar, num 2º
        // evento (streamQuality) que só rotula o link na lista.
        JSObject d = new JSObject();
        d.put("url", url);
        if (referer != null) d.put("referer", referer);
        d.put("mime", fMime);
        if (hdrs.length() > 0) d.put("headers", hdrs);
        if (currentOption != null && !currentOption.isEmpty()) d.put("option", currentOption);
        instance.notifyListeners("streamFound", d);
        pool.submit(() -> {
            String quality = probeQuality(url, referer, isHls);
            StreamSnifferPlugin p = instance;
            if (quality.isEmpty() || p == null) return;
            JSObject q = new JSObject();
            q.put("url", url);
            q.put("quality", quality);
            p.notifyListeners("streamQuality", q);
        });
    }

    // Link que NÃO veio do tráfego (ex.: /abyss/ do ProxyServer): entra no app pelo MESMO streamFound,
    // sem probe de qualidade (o rótulo já vem) e sem dedup por URL (cada sid é novo). `ephemeral` = só
    // vale enquanto a página oculta (motor) estiver viva → o JS não guarda no cache de links.
    public static void emitDirect(String url, String mime, String quality, String referer, boolean ephemeral) {
        if (instance == null || url == null) return;
        JSObject d = new JSObject();
        d.put("url", url); d.put("mime", mime);
        if (referer != null) d.put("referer", referer);
        if (quality != null && !quality.isEmpty()) d.put("quality", quality);
        d.put("ephemeral", ephemeral);
        if (currentOption != null && !currentOption.isEmpty()) d.put("option", currentOption);
        instance.notifyListeners("streamFound", d);
    }

    // Resolução sem tocar: 1) master m3u8 (RESOLUTION); 2) metadados do vídeo.
    private static String probeQuality(String url, String referer, boolean isHls) {
        if (isHls) {
            String q = hlsQuality(url, referer);
            if (!q.isEmpty()) return q;
        }
        android.media.MediaMetadataRetriever mmr = new android.media.MediaMetadataRetriever();
        try {
            java.util.HashMap<String, String> h = new java.util.HashMap<>();
            if (referer != null) h.put("Referer", referer);
            h.put("User-Agent", ProxyServer.userAgent());   // mesmo UA do WebView (googlevideo prende a URL ao UA)
            mmr.setDataSource(url, h);
            String hh = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            String ww = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            if (hh != null && !hh.trim().isEmpty()) {   // rótulo pela classe da imagem (1920×804 = "1080p")
                int w = 0;
                try { if (ww != null) w = Integer.parseInt(ww.trim()); } catch (NumberFormatException ignored) {}
                return QualidadeDaImagem.rotulo(w, Integer.parseInt(hh.trim()));
            }
        } catch (Exception ignored) {} finally {
            try { mmr.release(); } catch (Exception ignored) {}
        }
        return "";
    }

    private static String hlsQuality(String url, String referer) {
        try {
            Request.Builder rb = new Request.Builder().url(url);
            if (referer != null) rb.header("Referer", referer);
            rb.header("User-Agent", ProxyServer.userAgent());   // mesmo UA do WebView
            try (Response resp = http.newCall(rb.build()).execute()) {
                if (resp.body() == null) return "";
                return QualidadeDaImagem.doMaster(resp.body().string());   // maior classe do master (1920x804 = "1080p")
            }
        } catch (Exception e) { return ""; }
    }

    @PluginMethod
    public void startWatching(PluginCall call) { watching = true; emitted.clear(); probed.clear(); probeCount = 0; call.resolve(); }

    // Captura parou (fechou o título ou trocou de fonte): a MainActivity fecha a popup oculta que abriu nela.
    static volatile Runnable aoParar;

    @PluginMethod
    public void stopWatching(PluginCall call) {
        watching = false;
        Runnable r = aoParar;
        android.app.Activity a = getActivity();
        if (r != null && a != null) a.runOnUiThread(r);
        call.resolve();
    }
}
