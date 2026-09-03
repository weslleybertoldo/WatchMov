package com.weslley.watchmov;

import android.content.Context;
import android.net.Uri;

import java.io.IOException;
import java.net.URL;
import java.net.URLEncoder;
import java.util.concurrent.TimeUnit;

import fi.iki.elonen.NanoHTTPD;

import okhttp3.OkHttpClient;
import okhttp3.Request;

/**
 * Proxy HTTP local (como o Web Video Cast). O player/TV toca via 127.0.0.1/IP-LAN
 * e o proxy re-busca o stream real com Referer/User-Agent/Origin corretos e segue
 * redirects → resolve o 403 (ERROR_CODE_IO_BAD_HTTP_STATUS). Pra HLS, reescreve a
 * playlist pra que os segmentos também passem pelo proxy (URLs relativas).
 *
 * Também serve ARQUIVO LOCAL (content:// do MP4 exportado em Movies/WatchMov,
 * file://) com Range/206 — é o que faz a TV (DLNA/Chromecast) tocar um episódio
 * baixado em MP4: a TV não enxerga content://, só HTTP no IP do celular.
 */
public class ProxyServer extends NanoHTTPD {

    public static final int PORT = 8099;
    // Diagnóstico da ÚLTIMA busca de playlist (surfaça no wm_playback_errors via
    // PlayerActivity.onPlayerError) — pra achar por que SuperFlix falha no device.
    public static volatile String lastDiag = "";
    // Título do que está tocando (a Activity informa) — só pra rotular os eventos que
    // o proxy emite na aba Bugs (CAST_MASTER_INFO); o proxy em si não sabe o título.
    public static volatile String currentTitle = null;
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    private static ProxyServer instance;
    // Context da aplicação: necessário SÓ pro ramo content:// (ContentResolver). Sem
    // ele, content:// responde 500 "no_context" (e o log de acesso registra isso).
    private static volatile Context appCtx;
    private final OkHttpClient http = new OkHttpClient.Builder()
        .followRedirects(true).followSslRedirects(true)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build();

    private ProxyServer() { super(PORT); }
    // Porta alternativa SÓ pra teste fora do aparelho (smoke no JVM) — o app usa PORT.
    ProxyServer(int port) { super(port); }

    // Status 451 custom (não existe no enum do NanoHTTPD) — sinaliza pro player que o
    // segmento caiu no muro anti-hotlink (redirect pro dummy). Distinto de 403/410.
    private static final Response.IStatus BLOCKED_451 = new Response.IStatus() {
        @Override public int getRequestStatus() { return 451; }
        @Override public String getDescription() { return "451 Blocked"; }
    };
    // Redirect anti-abuso desses CDNs (EmbedPlayApi/lumicrest, SuperFlix): entregam
    // um MP4/PNG dummy quando a requisição não vem do browser real (WebView).
    private static boolean isAbuseHost(String host) {
        return host != null && host.contains("cloudflare-terms-of-service-abuse");
    }

    public static void attach(Context ctx) {
        if (ctx != null && appCtx == null) appCtx = ctx.getApplicationContext();
    }

    public static synchronized void ensure() {
        if (instance == null) {
            instance = new ProxyServer();
            try { instance.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false); } catch (IOException e) { instance = null; }
        }
    }

    public static synchronized void ensure(Context ctx) { attach(ctx); ensure(); }

    private static String enc(String s) { try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return ""; } }

    // ---------------------------------------------------------------------------
    // LOG DE ACESSO — o que cada cliente (TV, Chromecast, player local) pediu ao
    // proxy e o que recebeu. É o que separa "a TV nem chegou no celular" (rede/IP)
    // de "pediu o master e parou" (formato) de "baixou segmentos e não tocou"
    // (codec/Content-Type). Ring buffer em memória; resumo via trafficSummary().
    // ---------------------------------------------------------------------------
    public static final class Access {
        public final long ts; public final String ip, method, kind, range, note; public final int status; public final long bytes, ms;
        Access(long ts, String ip, String method, String kind, String range, int status, long bytes, long ms, String note) {
            this.ts = ts; this.ip = ip; this.method = method; this.kind = kind; this.range = range;
            this.status = status; this.bytes = bytes; this.ms = ms; this.note = note;
        }
    }
    private static final java.util.ArrayDeque<Access> LOG = new java.util.ArrayDeque<>();
    private static final int LOG_MAX = 600;

    private static void logAccess(Access a) {
        synchronized (LOG) { if (LOG.size() >= LOG_MAX) LOG.pollFirst(); LOG.addLast(a); }
    }

    /** Resumo do tráfego desde `sinceMs` (epoch), opcionalmente só de um IP (a TV). */
    public static String trafficSummary(long sinceMs, String ipFilter) {
        int req = 0, master = 0, variante = 0, seg = 0, arquivo = 0, head = 0, ranged = 0, erros = 0, outros = 0;
        long bytes = 0, maxMs = 0; Access lastErr = null, last = null;
        java.util.Set<String> ips = new java.util.TreeSet<>();
        java.util.List<Access> snap;
        synchronized (LOG) { snap = new java.util.ArrayList<>(LOG); }
        for (Access a : snap) {
            if (a.ts < sinceMs) continue;
            if (ipFilter != null && !ipFilter.equals(a.ip)) continue;
            req++; ips.add(a.ip); bytes += Math.max(0, a.bytes); maxMs = Math.max(maxMs, a.ms); last = a;
            if ("HEAD".equals(a.method)) head++;
            if (a.range != null) ranged++;
            switch (a.kind) {
                case "master": master++; break;
                case "variante": variante++; break;
                case "seg": seg++; break;
                case "arquivo": arquivo++; break;
                default: outros++;
            }
            if (a.status >= 400) { erros++; lastErr = a; }
        }
        StringBuilder sb = new StringBuilder();
        sb.append("req=").append(req).append(" ips=").append(ips)
          .append(" master=").append(master).append(" variante=").append(variante)
          .append(" seg=").append(seg).append(" arquivo=").append(arquivo).append(" outros=").append(outros)
          .append(" head=").append(head).append(" range=").append(ranged)
          .append(" bytes=").append(bytes / 1024).append("KB maxMs=").append(maxMs).append(" erros=").append(erros);
        if (lastErr != null) sb.append(" ultErro=[").append(lastErr.kind).append(' ').append(lastErr.status).append(' ').append(lastErr.note).append(']');
        if (last != null) sb.append(" ult=[").append(last.kind).append(' ').append(last.status).append(" +").append((System.currentTimeMillis() - last.ts) / 1000).append("s]");
        return sb.toString();
    }

    /** IPs de quem falou com o proxy desde `sinceMs` (sem o 127.0.0.1 do player local). */
    public static java.util.List<String> clientIps(long sinceMs) {
        java.util.Set<String> ips = new java.util.TreeSet<>();
        synchronized (LOG) { for (Access a : LOG) if (a.ts >= sinceMs && a.ip != null && !a.ip.startsWith("127.")) ips.add(a.ip); }
        return new java.util.ArrayList<>(ips);
    }

    // Descomprime se os bytes começarem com o magic gzip (1f 8b) — cobre CDNs que
    // mandam gzip sem o header Content-Encoding (o OkHttp não descomprime sozinho).
    private static byte[] gunzipIfNeeded(byte[] b) {
        if (b == null || b.length < 2 || (b[0] & 0xff) != 0x1f || (b[1] & 0xff) != 0x8b) return b;
        try (java.util.zip.GZIPInputStream gz = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(b))) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = gz.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (Exception e) { return b; }
    }

    private static boolean looksLikePlaylist(byte[] b) {
        if (b == null || b.length < 7) return false;
        String head = new String(b, 0, Math.min(b.length, 64), java.nio.charset.StandardCharsets.ISO_8859_1);
        return head.contains("#EXTM3U");
    }

    // Content-Type REAL de um segmento pelos primeiros bytes. Os CDNs disfarçam os
    // segmentos (.js/.css → application/javascript no EmbedPlay; octet-stream no
    // cache). O ExoPlayer ignora o header, mas o player DLNA da TV pode recusar um
    // "javascript" — o WVC normaliza pra video/mp2t. Só mexe quando o declarado NÃO
    // é vídeo/áudio.
    static String sniffBinaryType(byte[] head, int len, String declared) {
        String d = declared != null ? declared.toLowerCase() : "";
        if (d.startsWith("video/") || d.startsWith("audio/") || d.contains("mpegurl") || d.contains("dash+xml")) return declared;
        if (head == null || len <= 0) return declared != null ? declared : "application/octet-stream";
        if ((head[0] & 0xff) == 0x47 && (len < 189 || (head[188] & 0xff) == 0x47)) return "video/mp2t";
        if (len >= 12) {
            String box = new String(head, 4, 4, java.nio.charset.StandardCharsets.ISO_8859_1);
            if ("ftyp".equals(box) || "moof".equals(box) || "styp".equals(box) || "moov".equals(box) || "sidx".equals(box)) return "video/mp4";
        }
        if (len >= 3 && head[0] == 'I' && head[1] == 'D' && head[2] == '3') return "audio/aac";
        if (len >= 2 && (head[0] & 0xff) == 0xff && ((head[1] & 0xf6) == 0xf0)) return "audio/aac";
        if (len >= 6 && new String(head, 0, 6, java.nio.charset.StandardCharsets.ISO_8859_1).startsWith("WEBVTT")) return "text/vtt";
        return declared != null ? declared : "application/octet-stream";
    }

    private static String guessContentType(String url, byte[] b) {
        if (looksLikePlaylist(b)) return "application/vnd.apple.mpegurl";
        String l = url.toLowerCase();
        if (l.contains(".mp4") || l.contains(".m4s")) return "video/mp4";
        if (l.endsWith(".ts") || l.contains(".ts?")) return "video/mp2t";
        return sniffBinaryType(b, b != null ? Math.min(b.length, 256) : 0, "application/octet-stream");
    }

    /**
     * Lê a URL do cache de DOWNLOADS (Media3), se estiver baixada. Upstream nulo =
     * cache-only: se faltar qualquer pedaço, lança e devolvemos null → o proxy segue
     * buscando na rede como sempre (nenhuma regressão pra quem não baixou).
     */
    @androidx.media3.common.util.UnstableApi
    private static byte[] readFromCache(String url) {
        try {
            androidx.media3.datasource.cache.Cache cache = DownloadUtil.getCacheIfReady();
            if (cache == null) return null;
            String key = DownloadUtil.cacheKey(url);
            if (cache.getCachedSpans(key).isEmpty()) return null;      // nada baixado
            androidx.media3.datasource.cache.CacheDataSource ds =
                new androidx.media3.datasource.cache.CacheDataSource(cache, null);
            androidx.media3.datasource.DataSpec spec = new androidx.media3.datasource.DataSpec.Builder()
                .setUri(android.net.Uri.parse(url)).setKey(key).build();
            try {
                ds.open(spec);
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = ds.read(buf, 0, buf.length)) != androidx.media3.common.C.RESULT_END_OF_INPUT) out.write(buf, 0, n);
                return out.toByteArray();
            } finally {
                try { ds.close(); } catch (Exception ignored) {}
            }
        } catch (Throwable t) {
            return null;   // qualquer falha → caminho normal (rede)
        }
    }

    // Headers REAIS capturados pelo sniffer, por HOST — o proxy os reenvia verbatim
    // ao re-buscar o stream. Antes só o Referer sobrevivia à captura; CDNs do
    // EmbedPlay que gateiam por Origin/token respondiam 403 ("carrega e para"). O
    // gate é por host, então guardar por host cobre master + segmentos.
    private static final java.util.Map<String, java.util.Map<String, String>> HDRS =
        new java.util.concurrent.ConcurrentHashMap<>();

    public static void putHeaders(String url, java.util.Map<String, String> headers) {
        if (url == null || headers == null || headers.isEmpty()) return;
        try {
            String host = new URL(url).getHost();
            if (host != null) HDRS.put(host.toLowerCase(), new java.util.HashMap<>(headers));
        } catch (Exception ignored) {}
    }

    private static java.util.Map<String, String> headersFor(String url) {
        try {
            String host = new URL(url).getHost();
            if (host != null) return HDRS.get(host.toLowerCase());
        } catch (Exception ignored) {}
        return null;
    }

    // URL local (ExoPlayer no próprio aparelho).
    public static String local(String url, String referer) {
        ensure();
        return "http://127.0.0.1:" + PORT + "/s?u=" + enc(url) + "&r=" + enc(referer);
    }

    // URL na rede (TV via DLNA/Chromecast) — usa o IP do celular na LAN. ap=pt: no
    // cast, força SÓ o áudio português no master (TVs DLNA ignoram faixa alternativa
    // do HLS → tocavam inglês; removendo as outras, sobra PT) e deixa SÓ UMA variante
    // de vídeo (a TV não faz ABR: pegava a 1ª do master, que costuma ser a 360p).
    // q=<altura>: variante escolhida pelo usuário no overlay; sem q = a de maior
    // bandwidth. Native (local) não usa nada disso.
    public static String lan(String url, String referer, String ip) { return lan(url, referer, ip, 0); }

    public static String lan(String url, String referer, String ip, int qualityH) {
        ensure();
        return "http://" + ip + ":" + PORT + "/s?u=" + enc(url) + "&r=" + enc(referer) + "&ap=pt" + (qualityH > 0 ? "&q=" + qualityH : "");
    }

    // CORS: o Chromecast (CAF) busca o HLS via XHR e EXIGE esses headers no
    // manifesto E em todos os segmentos/keys, senão fica preso em "carregando".
    private static Response cors(Response resp) {
        resp.addHeader("Access-Control-Allow-Origin", "*");
        resp.addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        resp.addHeader("Access-Control-Allow-Headers", "*");
        resp.addHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range");
        // Headers DLNA (como o WVC os3.java): muitas TVs sondam com HEAD +
        // getcontentfeatures.dlna.org e recusam ("resource not found") sem estes.
        resp.addHeader("contentFeatures.dlna.org", "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000");
        resp.addHeader("TransferMode.DLNA.ORG", "Streaming");
        resp.addHeader("RealTimeInfo.DLNA.ORG", "DLNA.ORG_TLAG=*");
        return resp;
    }

    // Contexto de UMA requisição: o handler preenche tipo/bytes/nota e o serve() loga.
    private static final class Req {
        String kind = "outro"; String note = ""; long bytes = -1; int status = 0;
    }

    private static String clientIp(IHTTPSession s) {
        java.util.Map<String, String> h = s.getHeaders();
        String ip = h != null ? h.get("http-client-ip") : null;
        if (ip == null && h != null) ip = h.get("remote-addr");
        return ip != null ? ip : "?";
    }

    @Override
    public Response serve(IHTTPSession session) {
        long t0 = System.currentTimeMillis();
        Req rq = new Req();
        Response resp;
        try {
            resp = handle(session, rq);
        } catch (Throwable t) {
            rq.kind = "erro"; rq.note = "EXC: " + t;
            lastDiag = rq.note;
            resp = newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "proxy_err");
        }
        // HEAD: o NanoHTTPD 2.3.1 ESCREVE o corpo mesmo em HEAD (só pula quando é
        // chunked). A TV sonda com HEAD antes de tocar — mandar o MP4 inteiro numa
        // sondagem atrasa a resposta e corrompe a conexão keep-alive (o cliente lê o
        // corpo como início da PRÓXIMA resposta → "Invalid Http response"). Troca o
        // corpo por vazio mantendo o Content-Length declarado (flagrado no smoke).
        if (Method.HEAD.equals(session.getMethod())) {
            try {
                java.io.InputStream d = resp.getData();
                if (d != null) { try { d.close(); } catch (Exception ignored) {} resp.setData(new java.io.ByteArrayInputStream(new byte[0])); }
            } catch (Throwable ignored) {}
        }
        try {
            int st = resp.getStatus() != null ? resp.getStatus().getRequestStatus() : 0;
            String range = session.getHeaders() != null ? session.getHeaders().get("range") : null;
            String m = session.getMethod() != null ? session.getMethod().name() : "?";
            logAccess(new Access(t0, clientIp(session), m, rq.kind, range, st, rq.bytes, System.currentTimeMillis() - t0, rq.note));
        } catch (Throwable ignored) {}
        return resp;
    }

    private Response handle(IHTTPSession session, Req rq) throws Exception {
        if (Method.OPTIONS.equals(session.getMethod())) {
            rq.kind = "options";
            return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""));
        }
        // Teste de alcance: http://<ip>:8099/ping → "ok" (confirma que a TV/rede
        // consegue falar com o celular; se não abrir de outro aparelho = AP isolation).
        if (session.getUri() != null && session.getUri().endsWith("/ping")) {
            rq.kind = "ping";
            return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", "ok"));
        }
        String u = session.getParms().get("u");
        String r = session.getParms().get("r");
        if (u == null || u.isEmpty()) { rq.kind = "erro"; rq.note = "sem u"; return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "no url"); }
        boolean cast = "pt".equalsIgnoreCase(session.getParms().get("ap"));
        int qH = 0;
        try { String q = session.getParms().get("q"); if (q != null && !q.isEmpty()) qH = Integer.parseInt(q.trim()); } catch (Exception ignored) {}

        // ARQUIVO LOCAL (content:// do MP4 exportado, file://): só o celular resolve
        // esse esquema. A TV recebe HTTP com Range/206 — sem isso o OkHttp lançava
        // "Expected URL scheme http" → 500 → "Playing failed"/"Loading media resource…".
        if (u.startsWith("content://") || u.startsWith("file://")) {
            rq.kind = "arquivo";
            return serveLocalFile(session, u, rq);
        }

        // BAIXADO? Serve do disco (cache do Media3) em vez de ir no CDN: espelhar um
        // título já baixado (DLNA/WVC/Chromecast) fica rápido e funciona sem internet.
        // Cache miss/erro → null → segue pelo caminho normal (rede), sem regressão.
        byte[] cached = readFromCache(u);
        if (cached != null) {
            rq.bytes = cached.length;
            if (looksLikePlaylist(cached)) {
                String bodyC = new String(cached, java.nio.charset.StandardCharsets.UTF_8);
                rq.kind = bodyC.contains("#EXT-X-STREAM-INF") ? "master" : "variante"; rq.note = "cache";
                return cors(newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl", rewrite(bodyC, u, r, cast, qH)));
            }
            String ctc = guessContentType(u, cached);
            rq.kind = "seg"; rq.note = "cache ct=" + ctc;
            // Range no cache: fatia na mão (antes devolvia tudo com 200 ignorando o
            // Range — HLS picotado disfarçava, mas MP4/arquivo único quebrava o seek).
            String range = session.getHeaders().get("range");
            long[] rg = parseRange(range, cached.length);
            if (rg != null) {
                int start = (int) rg[0], end = (int) rg[1];
                Response rc = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, ctc, new java.io.ByteArrayInputStream(cached, start, end - start + 1), end - start + 1);
                rc.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + cached.length);
                rc.addHeader("Accept-Ranges", "bytes");
                return cors(rc);
            }
            Response rc = newFixedLengthResponse(Response.Status.OK, ctc, new java.io.ByteArrayInputStream(cached), cached.length);
            rc.addHeader("Accept-Ranges", "bytes");
            return cors(rc);
        }
        try {
            Request.Builder rb = new Request.Builder().url(u).header("User-Agent", UA);
            // Header set do Chrome (alguns anti-bot conferem Accept/sec-fetch/sec-ch-ua).
            rb.header("Accept", "*/*");
            rb.header("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7");
            rb.header("sec-ch-ua", "\"Chromium\";v=\"120\", \"Not:A-Brand\";v=\"99\"");
            rb.header("sec-ch-ua-mobile", "?1");
            rb.header("sec-ch-ua-platform", "\"Android\"");
            rb.header("Sec-Fetch-Dest", "empty");
            rb.header("Sec-Fetch-Mode", "cors");
            rb.header("Sec-Fetch-Site", "cross-site");
            if (r != null && !r.isEmpty()) {
                rb.header("Referer", r);
                try { URL ru = new URL(r); rb.header("Origin", ru.getProtocol() + "://" + ru.getHost()); } catch (Exception ignored) {}
            }
            // Headers REAIS que o WebView usou (Origin, sec-*, x-*, token…) — vêm do
            // sniffer via ProxyServer.putHeaders e VENCEM os adivinhados acima. É o que
            // faz os CDNs do EmbedPlay que gateiam por header aceitarem o replay.
            java.util.Map<String, String> real = headersFor(u);
            if (real != null) for (java.util.Map.Entry<String, String> e : real.entrySet()) {
                if (e.getKey() != null && e.getValue() != null) rb.header(e.getKey(), e.getValue());
            }
            // Cookies do WebView (mesma sessão que capturou): vários CDNs (SuperFlix)
            // devolvem HTML "security error" (anti-bot) sem o cookie de sessão. O proxy
            // roda no mesmo processo → lê o CookieManager e reenvia. ⚠️ getCookie NÃO
            // retorna cookies httpOnly (só o browser os envia) — se o gate for httpOnly,
            // OkHttp nunca consegue (→ só via WebView same-origin fetch, tipo WVC).
            int cookieLen = 0;
            try {
                String cookie = android.webkit.CookieManager.getInstance().getCookie(u);
                if (cookie != null && !cookie.isEmpty()) { rb.header("Cookie", cookie); cookieLen = cookie.length(); }
            } catch (Exception ignored) {}
            lastDiag = "cookieLen=" + cookieLen + " ";
            // Playlist (manifesto): busca IDENTITY (sem gzip) e SEM Range — igual ao
            // fetch do navegador/curl que retorna #EXTM3U limpo. Evita o edge-case
            // gzip+Range em que o ExoPlayer recebe bytes gzip → "não começa com
            // #EXTM3U" (fembed/SuperFlix). Segmento (binário): mantém Range p/ seek.
            String luEarly = u.toLowerCase();
            boolean urlPlaylist = luEarly.contains(".m3u8") || luEarly.contains("/m3/") || luEarly.endsWith(".txt")
                || luEarly.contains("/master") || luEarly.contains("playlist") || luEarly.contains(".m3u");
            if (urlPlaylist) {
                rb.header("Accept-Encoding", "identity");
            } else {
                String range = session.getHeaders().get("range");
                if (range != null) rb.header("Range", range);
            }

            okhttp3.Response up = http.newCall(rb.build()).execute();
            // Caiu no muro anti-hotlink? (a URL final, após os redirects, é o domínio de
            // abuso que serve um dummy). Falha limpo com 451 → o player cai pro Servidor
            // em vez de tocar o MP4 falso / crashar o parser (NPE). Vale p/ manifesto e
            // segmentos.
            if (isAbuseHost(up.request().url().host())) {
                lastDiag = "abuse_redirect host=" + up.request().url().host();
                rq.kind = "erro"; rq.note = lastDiag;
                up.close();
                return cors(newFixedLengthResponse(BLOCKED_451, "text/plain", "blocked_abuse_redirect"));
            }
            String ct = up.header("Content-Type", "application/octet-stream");
            String lu = u.toLowerCase(), lct = ct != null ? ct.toLowerCase() : "";
            rq.note = "up=" + up.code() + " ct=" + ct;
            // HLS do SuperFlix vem como text/plain em master.txt / /m3/ (sem .m3u8).
            // MAS os SEGMENTOS às vezes também vêm text/plain/html (disfarçados) — se eu
            // bufferizasse por content-type, leria o TS binário como String e corrompia
            // (tela preta). Então SÓ trato como playlist por PADRÃO DE URL (ou mpegurl
            // explícito) e confirmo por #EXTM3U; todo o resto = passthrough binário.
            boolean maybePlaylist = lct.contains("mpegurl")
                || lu.contains(".m3u8") || lu.contains("/m3/") || lu.endsWith(".txt")
                || lu.contains("/master") || lu.contains("playlist") || lu.contains(".m3u");
            if (maybePlaylist && up.body() != null) {
                // Alguns CDNs (SuperFlix) mandam o m3u8 gzip SEM Content-Encoding → o
                // OkHttp não descomprime. Detecta o magic 1f8b e descomprime na mão.
                byte[] raw = gunzipIfNeeded(up.body().bytes());
                rq.bytes = raw.length;
                // Confirma playlist por CONTEÚDO (#EXTM3U). ⚠️ Só o TEXTO vira String; o
                // resto (SEGMENTO binário disfarçado de .txt//m3/) sai CRU — String UTF-8
                // corrompia os bytes → "not a Transport Stream"/"no extractor" no player.
                String sniff = new String(raw, 0, Math.min(raw.length, 512), java.nio.charset.StandardCharsets.UTF_8);
                boolean isM3u = sniff.contains("#EXTM3U");
                String head = (sniff.length() > 40 ? sniff.substring(0, 40) : sniff).replaceAll("\\s+", " ");
                lastDiag = lastDiag + "up=" + up.code() + " ct=" + ct + " len=" + raw.length + " m3u=" + isM3u + " host=" + up.request().url().host() + " head=[" + head + "]";
                if (isM3u) {
                    String body = new String(raw, java.nio.charset.StandardCharsets.UTF_8);
                    rq.kind = body.contains("#EXT-X-STREAM-INF") ? "master" : "variante";
                    return cors(newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl", rewrite(body, u, r, cast, qH)));
                }
                if (up.code() >= 400) { rq.kind = "erro"; rq.note = rq.note + " head=[" + head + "]"; }
                else rq.kind = "seg";
                // NÃO era playlist (segmento binário) → serve os bytes CRUS (binário-safe).
                String realCt = sniffBinaryType(raw, Math.min(raw.length, 256), ct);
                Response.Status st2 = up.code() == 206 ? Response.Status.PARTIAL_CONTENT : Response.Status.OK;
                Response bin = newFixedLengthResponse(st2, realCt, new java.io.ByteArrayInputStream(raw), raw.length);
                String cr = up.header("Content-Range"); if (cr != null) bin.addHeader("Content-Range", cr);
                bin.addHeader("Accept-Ranges", "bytes");
                return cors(bin);
            }

            long len = up.body() != null ? up.body().contentLength() : -1;
            rq.bytes = len;
            rq.kind = up.code() >= 400 ? "erro" : "seg";
            Response.Status st = up.code() == 206 ? Response.Status.PARTIAL_CONTENT : Response.Status.OK;
            // Content-Type REAL: espia os primeiros bytes (mark/reset) sem consumir o
            // stream — segmento .js/.css do EmbedPlay vira video/mp2t pra TV.
            java.io.InputStream body = up.body() != null ? up.body().byteStream() : new java.io.ByteArrayInputStream(new byte[0]);
            String realCt = ct;
            if (!lct.startsWith("video/") && !lct.startsWith("audio/")) {
                java.io.BufferedInputStream bis = new java.io.BufferedInputStream(body, 1024);
                bis.mark(600);
                byte[] peek = new byte[512]; int n = 0, got;
                while (n < peek.length && (got = bis.read(peek, n, peek.length - n)) > 0) n += got;
                bis.reset();
                body = bis;
                realCt = sniffBinaryType(peek, n, ct);
                if (!realCt.equals(ct)) rq.note = rq.note + " → " + realCt;
            }
            // Tamanho conhecido → fixed-length (suporta Range/seek). Desconhecido (-1,
            // upstream chunked) → chunked, senão o newFixedLengthResponse trunca o
            // segmento e a TV para após ~2s. Como o WVC (copia o stream até acabar).
            Response resp = len >= 0
                ? newFixedLengthResponse(st, realCt, body, len)
                : newChunkedResponse(st, realCt, body);
            String cr = up.header("Content-Range");
            if (cr != null) resp.addHeader("Content-Range", cr);
            resp.addHeader("Accept-Ranges", "bytes");
            return cors(resp);
        } catch (Exception e) {
            lastDiag = "EXC: " + e;
            rq.kind = "erro"; rq.note = lastDiag;
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "proxy_err");
        }
    }

    // "bytes=X-Y" | "bytes=X-" | "bytes=-N" → {start, end} inclusivos e já limitados
    // ao tamanho; null = sem Range válido (ou pedido fora do arquivo).
    static long[] parseRange(String range, long total) {
        if (range == null || total <= 0) return null;
        String v = range.trim().toLowerCase();
        if (!v.startsWith("bytes=")) return null;
        v = v.substring(6).trim();
        int dash = v.indexOf('-');
        if (dash < 0) return null;
        try {
            String a = v.substring(0, dash).trim(), b = v.substring(dash + 1).trim();
            // Vários ranges ("0-1,5-9"): usa só o primeiro.
            int comma = b.indexOf(','); if (comma >= 0) b = b.substring(0, comma).trim();
            long start, end;
            if (a.isEmpty()) {                       // sufixo: últimos N bytes
                long n = Long.parseLong(b);
                if (n <= 0) return null;
                start = Math.max(0, total - n); end = total - 1;
            } else {
                start = Long.parseLong(a);
                end = b.isEmpty() ? total - 1 : Math.min(Long.parseLong(b), total - 1);
            }
            if (start < 0 || start >= total || end < start) return null;
            return new long[]{ start, end };
        } catch (Exception e) { return null; }
    }

    // MP4 exportado (content://) / file:// → HTTP com Range/206 pra TV. O fatiamento é
    // feito aqui (não há upstream pra delegar): abre o descritor, pula até `start` e
    // limita a leitura a `len` bytes. Content-Range certo importa — off-by-one faz a
    // TV pular errado ou recusar.
    private Response serveLocalFile(IHTTPSession session, String u, Req rq) {
        Context ctx = appCtx;
        try {
            long total; java.io.InputStream in; String ct; java.io.Closeable holder = null;
            if (u.startsWith("file://")) {
                java.io.File f = new java.io.File(new java.net.URI(u).getPath());
                if (!f.isFile()) { rq.note = "file inexistente"; return cors(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not_found")); }
                total = f.length(); in = new java.io.FileInputStream(f);
                ct = f.getName().toLowerCase().endsWith(".mkv") ? "video/x-matroska" : "video/mp4";
            } else {
                if (ctx == null) { rq.note = "no_context"; return cors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "no_context")); }
                Uri uri = Uri.parse(u);
                android.content.ContentResolver cr = ctx.getContentResolver();
                android.os.ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "r");
                if (pfd == null) { rq.note = "openFileDescriptor null"; return cors(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not_found")); }
                total = pfd.getStatSize();
                in = new java.io.FileInputStream(pfd.getFileDescriptor());
                holder = pfd;
                String t = null; try { t = cr.getType(uri); } catch (Exception ignored) {}
                ct = (t != null && t.startsWith("video/")) ? t : "video/mp4";
            }
            if (total <= 0) { in.close(); if (holder != null) holder.close(); rq.note = "tamanho=" + total; return cors(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "empty")); }
            String range = session.getHeaders().get("range");
            long[] rg = parseRange(range, total);
            if (range != null && rg == null) {           // Range pedido mas inválido/fora do arquivo
                in.close(); if (holder != null) holder.close();
                rq.note = "range invalido " + range + " total=" + total;
                Response r416 = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "");
                r416.addHeader("Content-Range", "bytes */" + total);
                return cors(r416);
            }
            long start = rg != null ? rg[0] : 0, end = rg != null ? rg[1] : total - 1;
            long len = end - start + 1;
            if (start > 0) skipFully(in, start);
            java.io.InputStream limited = new LimitedStream(in, len, holder);
            rq.bytes = len; rq.note = "ct=" + ct + " total=" + total + (rg != null ? " range=" + start + "-" + end : "");
            Response resp = newFixedLengthResponse(rg != null ? Response.Status.PARTIAL_CONTENT : Response.Status.OK, ct, limited, len);
            if (rg != null) resp.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + total);
            resp.addHeader("Accept-Ranges", "bytes");
            return cors(resp);
        } catch (SecurityException se) {
            rq.note = "sem permissao: " + se.getMessage();
            return cors(newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "forbidden"));
        } catch (Exception e) {
            rq.note = "EXC: " + e;
            lastDiag = rq.note;
            return cors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "file_err"));
        }
    }

    private static void skipFully(java.io.InputStream in, long n) throws IOException {
        long left = n;
        while (left > 0) {
            long s = in.skip(left);
            if (s <= 0) { if (in.read() < 0) throw new java.io.EOFException("skip alem do fim"); s = 1; }
            left -= s;
        }
    }

    // Limita a leitura a `remaining` bytes e fecha o descritor junto com o stream.
    private static final class LimitedStream extends java.io.InputStream {
        private final java.io.InputStream in; private long remaining; private final java.io.Closeable holder;
        LimitedStream(java.io.InputStream in, long len, java.io.Closeable holder) { this.in = in; this.remaining = len; this.holder = holder; }
        @Override public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = in.read(); if (b >= 0) remaining--; return b;
        }
        @Override public int read(byte[] buf, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int n = in.read(buf, off, (int) Math.min(len, remaining));
            if (n > 0) remaining -= n;
            return n;
        }
        @Override public int available() throws IOException { return (int) Math.min(in.available(), remaining); }
        @Override public void close() throws IOException {
            try { in.close(); } finally { if (holder != null) try { holder.close(); } catch (Exception ignored) {} }
        }
    }

    // ---------------------------------------------------------------------------
    // Variantes do master (por URL) — pro overlay listar as qualidades disponíveis e
    // pro CAST_MASTER_INFO dizer qual foi entregue. {altura, bandwidth}.
    // ---------------------------------------------------------------------------
    private static final java.util.Map<String, java.util.List<int[]>> MASTERS = new java.util.concurrent.ConcurrentHashMap<>();
    private static final java.util.Map<String, Long> INFO_TS = new java.util.concurrent.ConcurrentHashMap<>();

    /** Variantes conhecidas do master dessa URL ({altura, bandwidth}, maior primeiro) — vazio se ainda não foi buscado. */
    public static java.util.List<int[]> variantsOf(String masterUrl) {
        java.util.List<int[]> v = masterUrl != null ? MASTERS.get(masterUrl) : null;
        java.util.List<int[]> out = new java.util.ArrayList<>();
        if (v != null) for (int[] x : v) out.add(new int[]{ x[1], x[2] });
        java.util.Collections.sort(out, (a, b) -> b[1] != a[1] ? Integer.compare(b[1], a[1]) : Integer.compare(b[0], a[0]));
        return out;
    }

    private static int attrInt(String tag, String name) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile(name + "=(\\d+)").matcher(tag);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }

    private static int heightOf(String tag) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("RESOLUTION=(\\d+)x(\\d+)").matcher(tag);
        if (m.find()) return Integer.parseInt(m.group(2));
        m = java.util.regex.Pattern.compile("NAME=\"(\\d{3,4})p").matcher(tag);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }

    // Qual EXT-X-STREAM-INF sobrevive no cast: q=<altura> pedida (igual, senão a
    // maior abaixo dela); sem q = maior BANDWIDTH (empate → maior altura).
    private static int chooseVariant(java.util.List<int[]> vars, int qH) {
        int best = -1;
        if (qH > 0) {
            for (int i = 0; i < vars.size(); i++) if (vars.get(i)[1] == qH) return i;
            for (int i = 0; i < vars.size(); i++) {
                int h = vars.get(i)[1];
                if (h > 0 && h <= qH && (best < 0 || h > vars.get(best)[1])) best = i;
            }
            if (best >= 0) return best;
        }
        for (int i = 0; i < vars.size(); i++) {
            if (best < 0) { best = i; continue; }
            int[] a = vars.get(i), b = vars.get(best);
            if (a[2] > b[2] || (a[2] == b[2] && a[1] > b[1])) best = i;
        }
        return best;
    }

    private static String varLabel(int[] v) { return (v[1] > 0 ? v[1] + "p" : "?p") + "@" + (v[2] / 1000) + "k"; }

    // Reescreve a playlist HLS: cada URL (segmento/variante/chave) passa a apontar
    // pro proxy (caminho relativo → o cliente resolve contra o host que pediu).
    private static final java.util.regex.Pattern PT_AUDIO = java.util.regex.Pattern.compile(
        "TYPE=AUDIO[^\\n]*(LANGUAGE=\"(pt|por|pt-br)|NAME=\"[^\"]*(portug|português|brasil|dub))", java.util.regex.Pattern.CASE_INSENSITIVE);

    private String rewrite(String body, String baseUrl, String referer, boolean cast, int qH) {
        // Se houver faixa de áudio em PORTUGUÊS, marca ela como DEFAULT (e as outras
        // NÃO) → a TV pega PT em vez do inglês. No cast, REMOVE as faixas não-PT do
        // master (TVs DLNA ignoram alt-audio → tocavam inglês; sem as outras, sobra PT)
        // e deixa SÓ UMA variante de vídeo (a TV não faz ABR: pegava a 1ª do master,
        // que no EmbedPlay é a 360p → "qualidade baixa na TV"). Native não usa nada
        // disso (mantém seletor de áudio e ABR do ExoPlayer).
        boolean hasPt = PT_AUDIO.matcher(body).find();
        String[] lines = body.split("\n");
        java.util.List<int[]> vars = new java.util.ArrayList<>();   // {idxLinha, altura, bandwidth}
        int audios = 0, subs = 0;
        for (int i = 0; i < lines.length; i++) {
            String t = lines[i].trim();
            if (t.startsWith("#EXT-X-STREAM-INF")) vars.add(new int[]{ i, heightOf(t), attrInt(t, "BANDWIDTH") });
            else if (t.startsWith("#EXT-X-MEDIA")) { String up = t.toUpperCase(); if (up.contains("TYPE=AUDIO")) audios++; else if (up.contains("TYPE=SUBTITLES")) subs++; }
        }
        int keep = -1;
        if (!vars.isEmpty()) {
            MASTERS.put(baseUrl, vars);
            if (cast) keep = chooseVariant(vars, qH);
        }
        StringBuilder out = new StringBuilder();
        boolean skipUri = false;
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String t = line.trim();
            if (t.isEmpty()) { out.append(line).append("\n"); continue; }
            if (t.startsWith("#")) {
                if (keep >= 0 && t.startsWith("#EXT-X-STREAM-INF") && i != vars.get(keep)[0]) { skipUri = true; continue; } // variante descartada no cast
                boolean isAudio = t.toUpperCase().contains("EXT-X-MEDIA") && t.toUpperCase().contains("TYPE=AUDIO");
                if (hasPt && isAudio && cast && !PT_AUDIO.matcher(t).find()) continue; // remove faixa não-PT no cast
                int idx = t.indexOf("URI=\"");
                if (idx >= 0) {
                    int start = idx + 5, endq = t.indexOf('"', start);
                    if (endq > start) {
                        String uri = t.substring(start, endq);
                        line = t.substring(0, start) + proxied(uri, baseUrl, referer) + t.substring(endq);
                    }
                }
                if (hasPt && isAudio) line = setAudioDefault(line);
                out.append(line).append("\n");
            } else {
                if (skipUri) { skipUri = false; continue; }     // URI da variante descartada
                out.append(proxied(t, baseUrl, referer)).append("\n");
            }
        }
        if (cast && !vars.isEmpty()) {
            // Registra (1x por minuto por master) o que a TV recebeu — prova de qual
            // qualidade foi entregue e do que havia disponível.
            long now = System.currentTimeMillis();
            Long last = INFO_TS.get(baseUrl);
            if (last == null || now - last > 60000) {
                INFO_TS.put(baseUrl, now);
                StringBuilder sb = new StringBuilder("[master] variantes=");
                for (int i = 0; i < vars.size(); i++) { if (i > 0) sb.append(','); sb.append(varLabel(vars.get(i))); }
                sb.append(" entregue=").append(keep >= 0 ? varLabel(vars.get(keep)) : "todas")
                  .append(" q=").append(qH > 0 ? qH + "p" : "max")
                  .append(" audios=").append(audios).append(" audioPT=").append(hasPt).append(" legendas=").append(subs);
                try { NativePlayerPlugin.reportError(baseUrl, 0, 0, "CAST_MASTER_INFO", sb.toString(), "application/vnd.apple.mpegurl", referer, currentTitle); } catch (Throwable ignored) {}
            }
        }
        return out.toString();
    }

    // Força DEFAULT=YES na faixa de áudio PT e DEFAULT=NO nas demais (a TV segue o
    // DEFAULT no cast). Só chamado quando existe faixa PT no master.
    private static String setAudioDefault(String line) {
        boolean isPt = PT_AUDIO.matcher(line).find();
        String def = isPt ? "YES" : "NO";
        if (line.matches("(?i).*DEFAULT=(YES|NO).*")) line = line.replaceAll("(?i)DEFAULT=(YES|NO)", "DEFAULT=" + def);
        else line = line + ",DEFAULT=" + def;
        if (isPt) {
            if (line.matches("(?i).*AUTOSELECT=(YES|NO).*")) line = line.replaceAll("(?i)AUTOSELECT=(YES|NO)", "AUTOSELECT=YES");
            else line = line + ",AUTOSELECT=YES";
        }
        return line;
    }

    private String proxied(String ref, String baseUrl, String referer) {
        try {
            String abs = ref.startsWith("http") ? ref : new URL(new URL(baseUrl), ref).toString();
            return "/s?u=" + enc(abs) + "&r=" + enc(referer);
        } catch (Exception e) { return ref; }
    }

    // ---------------------------------------------------------------------------
    // PRÉ-AQUECIMENTO: busca o master (e a 1ª variante) pelo PRÓPRIO proxy antes de
    // mandar a URL pra TV. A LG sonda a URL antes de responder o SetAVTransportURI;
    // com o master já quente (conexão aberta, cache de variantes preenchido) ela
    // responde rápido em vez de estourar o timeout ("[recast] timeout"). Devolve um
    // resumo pro diagnóstico (DLNA_CONECTADO/RECAST_ENVIADO). Timebox ~8s.
    // ---------------------------------------------------------------------------
    public static String prewarm(String url, String referer, int qH) {
        ensure();
        if (url == null) return "prewarm=skip(sem url)";
        if (!(url.startsWith("http://") || url.startsWith("https://"))) {
            // Arquivo local: só confirma que o proxy consegue abrir (tamanho > 0).
            long t0 = System.currentTimeMillis();
            try {
                OkHttpClient c = new OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).build();
                String local = "http://127.0.0.1:" + PORT + "/s?u=" + enc(url) + "&r=" + enc(referer);
                try (okhttp3.Response rp = c.newCall(new Request.Builder().url(local).head().build()).execute()) {
                    return "prewarm=arquivo " + rp.code() + " len=" + rp.header("Content-Length", "?") + " ct=" + rp.header("Content-Type", "?") + " " + (System.currentTimeMillis() - t0) + "ms";
                }
            } catch (Exception e) { return "prewarm=arquivo EXC " + e.getClass().getSimpleName() + ":" + e.getMessage(); }
        }
        long t0 = System.currentTimeMillis();
        try {
            OkHttpClient c = new OkHttpClient.Builder().callTimeout(8, TimeUnit.SECONDS).build();
            String local = "http://127.0.0.1:" + PORT + "/s?u=" + enc(url) + "&r=" + enc(referer) + "&ap=pt" + (qH > 0 ? "&q=" + qH : "");
            String body; int code; String ct;
            try (okhttp3.Response rp = c.newCall(new Request.Builder().url(local).build()).execute()) {
                code = rp.code(); ct = rp.header("Content-Type", "?");
                body = rp.body() != null ? rp.body().string() : "";
            }
            long t1 = System.currentTimeMillis() - t0;
            if (code >= 400) return "prewarm=master " + code + " " + t1 + "ms";
            if (!body.contains("#EXTM3U")) return "prewarm=master ok nao-m3u ct=" + ct + " " + t1 + "ms";
            boolean isMaster = body.contains("#EXT-X-STREAM-INF");
            String first = null; int itens = 0;
            for (String line : body.split("\n")) { String t = line.trim(); if (t.isEmpty() || t.startsWith("#")) continue; itens++; if (first == null) first = t; }
            if (!isMaster) return "prewarm=variante-direta ok segs=" + itens + " " + t1 + "ms";
            String res = "prewarm=master ok variantes=" + itens;
            if (first != null && first.startsWith("/s?")) {
                try (okhttp3.Response rp2 = c.newCall(new Request.Builder().url("http://127.0.0.1:" + PORT + first).build()).execute()) {
                    String b2 = rp2.body() != null ? rp2.body().string() : "";
                    int segs = 0; for (String line : b2.split("\n")) { String t = line.trim(); if (!t.isEmpty() && !t.startsWith("#")) segs++; }
                    res += " variante=" + rp2.code() + " segs=" + segs + (b2.contains("#EXT-X-ENDLIST") ? " vod" : " sem-endlist");
                } catch (Exception e2) { res += " variante=EXC " + e2.getClass().getSimpleName(); }
            }
            return res + " " + (System.currentTimeMillis() - t0) + "ms";
        } catch (Exception e) {
            return "prewarm=EXC " + e.getClass().getSimpleName() + ":" + e.getMessage() + " " + (System.currentTimeMillis() - t0) + "ms";
        }
    }
}
