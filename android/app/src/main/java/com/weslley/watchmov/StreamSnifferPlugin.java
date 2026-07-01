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
    private static final OkHttpClient http = new OkHttpClient();
    private static int probeCount = 0;

    @Override
    public void load() { instance = this; }

    public static boolean isWatching() { return watching; }

    private static String noQuery(String url) { int q = url.indexOf('?'); return q >= 0 ? url.substring(0, q) : url; }

    public static boolean looksLikeVideo(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        String path = noQuery(u);
        if (path.endsWith(".m3u8") || path.endsWith(".mpd") || path.endsWith(".mp4")
            || path.endsWith(".mkv") || path.endsWith(".webm") || path.endsWith(".m4v")
            || path.endsWith(".mov") || path.endsWith(".avi") || path.endsWith(".flv")) return true;
        return u.contains("master.m3u8") || u.contains(".m3u8") || u.contains(".mpd") || u.contains("/manifest");
    }

    // Requests que NÃO vale a pena probar (recursos óbvios não-vídeo).
    private static boolean skipProbe(String url) {
        String p = noQuery(url.toLowerCase());
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
        if (!watching || url == null) return;
        String ref = headers != null ? headers.get("Referer") : null;
        if (looksLikeVideo(url)) { report(url, ref, mimeFor(url)); return; }
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
                    if (isVideoContentType(ct)) { report(url, ref, ct); return; }
                    // Content-Type genérico (octet-stream/text/nulo): confere os 1os bytes.
                    if (ct == null || ct.toLowerCase().contains("octet-stream") || ct.toLowerCase().contains("text/")
                        || ct.toLowerCase().contains("application/binary")) {
                        if (resp.body() != null) {
                            byte[] b = resp.body().bytes();
                            String head = new String(b, 0, Math.min(b.length, 64));
                            if (head.contains("#EXTM3U")) { report(url, ref, "application/vnd.apple.mpegurl"); }
                            else if (head.contains("ftyp")) { report(url, ref, "video/mp4"); }
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

    private static void report(String url, String referer, String mime) {
        if (instance == null || !watching || url == null) return;
        if (!emitted.add(noQuery(url))) return;
        final String fMime = mime != null ? mime : mimeFor(url);
        final boolean isHls = fMime.toLowerCase().contains("mpegurl") || url.toLowerCase().contains(".m3u8");
        // Tenta descobrir a resolução SEM tocar (rotula o link já na captura).
        pool.submit(() -> {
            String quality = probeQuality(url, referer, isHls);
            JSObject d = new JSObject();
            d.put("url", url);
            if (referer != null) d.put("referer", referer);
            d.put("mime", fMime);
            if (!quality.isEmpty()) d.put("quality", quality);
            instance.notifyListeners("streamFound", d);
        });
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
            h.put("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
            mmr.setDataSource(url, h);
            String hh = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            if (hh != null && !hh.trim().isEmpty()) return hh.trim() + "p";
        } catch (Exception ignored) {} finally {
            try { mmr.release(); } catch (Exception ignored) {}
        }
        return "";
    }

    private static final Pattern RES = Pattern.compile("RESOLUTION=\\d{2,4}x(\\d{2,4})");

    private static String hlsQuality(String url, String referer) {
        try {
            Request.Builder rb = new Request.Builder().url(url);
            if (referer != null) rb.header("Referer", referer);
            rb.header("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
            try (Response resp = http.newCall(rb.build()).execute()) {
                if (resp.body() == null) return "";
                String body = resp.body().string();
                int max = 0;
                Matcher m = RES.matcher(body);
                while (m.find()) { int h = Integer.parseInt(m.group(1)); if (h > max) max = h; }
                return max > 0 ? max + "p" : "";
            }
        } catch (Exception e) { return ""; }
    }

    @PluginMethod
    public void startWatching(PluginCall call) { watching = true; emitted.clear(); probed.clear(); probeCount = 0; call.resolve(); }

    @PluginMethod
    public void stopWatching(PluginCall call) { watching = false; call.resolve(); }
}
