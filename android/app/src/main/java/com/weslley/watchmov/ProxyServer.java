package com.weslley.watchmov;

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
 */
public class ProxyServer extends NanoHTTPD {

    public static final int PORT = 8099;
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    private static ProxyServer instance;
    private final OkHttpClient http = new OkHttpClient.Builder()
        .followRedirects(true).followSslRedirects(true)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build();

    private ProxyServer() { super(PORT); }

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

    public static synchronized void ensure() {
        if (instance == null) {
            instance = new ProxyServer();
            try { instance.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false); } catch (IOException e) { instance = null; }
        }
    }

    private static String enc(String s) { try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return ""; } }

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

    // URL local (ExoPlayer no próprio aparelho).
    public static String local(String url, String referer) {
        ensure();
        return "http://127.0.0.1:" + PORT + "/s?u=" + enc(url) + "&r=" + enc(referer);
    }

    // URL na rede (TV via DLNA) — usa o IP do celular na LAN.
    public static String lan(String url, String referer, String ip) {
        ensure();
        return "http://" + ip + ":" + PORT + "/s?u=" + enc(url) + "&r=" + enc(referer);
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

    @Override
    public Response serve(IHTTPSession session) {
        if (Method.OPTIONS.equals(session.getMethod())) {
            return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""));
        }
        // Teste de alcance: http://<ip>:8099/ping → "ok" (confirma que a TV/rede
        // consegue falar com o celular; se não abrir de outro aparelho = AP isolation).
        if (session.getUri() != null && session.getUri().endsWith("/ping")) {
            return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", "ok"));
        }
        String u = session.getParms().get("u");
        String r = session.getParms().get("r");
        if (u == null || u.isEmpty()) return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "no url");
        try {
            Request.Builder rb = new Request.Builder().url(u).header("User-Agent", UA);
            if (r != null && !r.isEmpty()) {
                rb.header("Referer", r);
                try { URL ru = new URL(r); rb.header("Origin", ru.getProtocol() + "://" + ru.getHost()); } catch (Exception ignored) {}
            }
            // Cookies do WebView (mesma sessão que capturou): vários CDNs (SuperFlix)
            // devolvem HTML "security error" (anti-bot) sem o cookie de sessão. O proxy
            // roda no mesmo processo → lê o CookieManager e reenvia.
            try {
                String cookie = android.webkit.CookieManager.getInstance().getCookie(u);
                if (cookie != null && !cookie.isEmpty()) rb.header("Cookie", cookie);
            } catch (Exception ignored) {}
            String range = session.getHeaders().get("range");
            if (range != null) rb.header("Range", range);

            okhttp3.Response up = http.newCall(rb.build()).execute();
            // Caiu no muro anti-hotlink? (a URL final, após os redirects, é o domínio de
            // abuso que serve um dummy). Falha limpo com 451 → o player cai pro Servidor
            // em vez de tocar o MP4 falso / crashar o parser (NPE). Vale p/ manifesto e
            // segmentos.
            if (isAbuseHost(up.request().url().host())) {
                up.close();
                return cors(newFixedLengthResponse(BLOCKED_451, "text/plain", "blocked_abuse_redirect"));
            }
            String ct = up.header("Content-Type", "application/octet-stream");
            String lu = u.toLowerCase(), lct = ct != null ? ct.toLowerCase() : "";
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
                // OkHttp não descomprime. Detecta o magic 1f8b e descomprime na mão,
                // senão o ExoPlayer recebe bytes gzip → "não começa com #EXTM3U".
                String body = new String(gunzipIfNeeded(up.body().bytes()), java.nio.charset.StandardCharsets.UTF_8);
                if (body.contains("#EXTM3U")) {
                    return cors(newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl", rewrite(body, u, r)));
                }
                // Não era playlist: devolve o texto como veio (corpo já lido).
                return cors(newFixedLengthResponse(up.code() == 206 ? Response.Status.PARTIAL_CONTENT : Response.Status.OK, ct, body));
            }

            long len = up.body() != null ? up.body().contentLength() : -1;
            Response.Status st = up.code() == 206 ? Response.Status.PARTIAL_CONTENT : Response.Status.OK;
            // Tamanho conhecido → fixed-length (suporta Range/seek). Desconhecido (-1,
            // upstream chunked) → chunked, senão o newFixedLengthResponse trunca o
            // segmento e a TV para após ~2s. Como o WVC (copia o stream até acabar).
            Response resp = len >= 0
                ? newFixedLengthResponse(st, ct, up.body().byteStream(), len)
                : newChunkedResponse(st, ct, up.body().byteStream());
            String cr = up.header("Content-Range");
            if (cr != null) resp.addHeader("Content-Range", cr);
            resp.addHeader("Accept-Ranges", "bytes");
            return cors(resp);
        } catch (Exception e) {
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "proxy_err");
        }
    }

    // Reescreve a playlist HLS: cada URL (segmento/variante/chave) passa a apontar
    // pro proxy (caminho relativo → o cliente resolve contra o host que pediu).
    private String rewrite(String body, String baseUrl, String referer) {
        StringBuilder out = new StringBuilder();
        for (String line : body.split("\n")) {
            String t = line.trim();
            if (t.isEmpty()) { out.append(line).append("\n"); continue; }
            if (t.startsWith("#")) {
                int idx = t.indexOf("URI=\"");
                if (idx >= 0) {
                    int start = idx + 5, endq = t.indexOf('"', start);
                    if (endq > start) {
                        String uri = t.substring(start, endq);
                        line = t.substring(0, start) + proxied(uri, baseUrl, referer) + t.substring(endq);
                    }
                }
                out.append(line).append("\n");
            } else {
                out.append(proxied(t, baseUrl, referer)).append("\n");
            }
        }
        return out.toString();
    }

    private String proxied(String ref, String baseUrl, String referer) {
        try {
            String abs = ref.startsWith("http") ? ref : new URL(new URL(baseUrl), ref).toString();
            return "/s?u=" + enc(abs) + "&r=" + enc(referer);
        } catch (Exception e) { return ref; }
    }
}
