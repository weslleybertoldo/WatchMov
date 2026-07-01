package com.weslley.watchmov;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Sniffer PASSIVO (estilo Web Video Cast): o iframe do servidor toca no WebView
 * principal do app; o WebViewClient do MainActivity observa o tráfego e, quando o
 * JS está "armado" (startWatching), reporta a URL do stream via evento streamFound.
 * O JS decide (banner "Reproduzir no meu player / Ficar no servidor") e cacheia.
 */
@CapacitorPlugin(name = "StreamSniffer")
public class StreamSnifferPlugin extends Plugin {

    private static StreamSnifferPlugin instance;
    private static volatile boolean watching = false;
    private static volatile String lastUrl = null;

    @Override
    public void load() { instance = this; }

    public static boolean isWatching() { return watching; }

    // Detecção por extensão (mesma lista do WVC), ignorando segmentos HLS (.ts).
    public static boolean looksLikeVideo(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        int q = u.indexOf('?');
        String path = q >= 0 ? u.substring(0, q) : u;
        if (path.endsWith(".m3u8") || path.endsWith(".mpd") || path.endsWith(".mp4")
            || path.endsWith(".mkv") || path.endsWith(".webm") || path.endsWith(".m4v")
            || path.endsWith(".mov") || path.endsWith(".avi") || path.endsWith(".flv")) return true;
        return u.contains("master.m3u8") || u.contains(".m3u8") || u.contains(".mpd") || u.contains("/manifest");
    }

    public static void onVideoUrl(String url, String referer) {
        if (instance == null || !watching || url == null) return;
        if (url.equals(lastUrl)) return;   // dedup
        lastUrl = url;
        JSObject d = new JSObject();
        d.put("url", url);
        if (referer != null) d.put("referer", referer);
        String lu = url.toLowerCase();
        d.put("mime", lu.contains(".mpd") ? "application/dash+xml"
            : (lu.contains(".m3u8") || lu.contains("/manifest")) ? "application/vnd.apple.mpegurl"
            : "video/mp4");
        instance.notifyListeners("streamFound", d);
    }

    // JS arma/desarma a captura (evita capturar o próprio hls.js do player).
    @PluginMethod
    public void startWatching(PluginCall call) { watching = true; lastUrl = null; call.resolve(); }

    @PluginMethod
    public void stopWatching(PluginCall call) { watching = false; call.resolve(); }
}
