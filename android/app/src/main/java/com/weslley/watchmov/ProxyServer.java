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
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build();

    private ProxyServer() { super(PORT); }

    public static synchronized void ensure() {
        if (instance == null) {
            instance = new ProxyServer();
            try { instance.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false); } catch (IOException e) { instance = null; }
        }
    }

    private static String enc(String s) { try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return ""; } }

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
        resp.addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        resp.addHeader("Access-Control-Allow-Headers", "*");
        resp.addHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range");
        return resp;
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (Method.OPTIONS.equals(session.getMethod())) {
            return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""));
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
            String range = session.getHeaders().get("range");
            if (range != null) rb.header("Range", range);

            okhttp3.Response up = http.newCall(rb.build()).execute();
            String ct = up.header("Content-Type", "application/octet-stream");
            boolean isHls = (ct != null && ct.toLowerCase().contains("mpegurl")) || u.toLowerCase().contains(".m3u8");

            if (isHls && up.body() != null) {
                String body = up.body().string();
                String rewritten = rewrite(body, u, r);
                return cors(newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl", rewritten));
            }

            long len = up.body() != null ? up.body().contentLength() : -1;
            Response.Status st = up.code() == 206 ? Response.Status.PARTIAL_CONTENT : Response.Status.OK;
            Response resp = newFixedLengthResponse(st, ct, up.body().byteStream(), len);
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
