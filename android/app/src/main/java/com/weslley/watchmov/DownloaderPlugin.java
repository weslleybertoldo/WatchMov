package com.weslley.watchmov;

import android.net.Uri;

import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.NotificationUtil;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadCursor;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadRequest;
import androidx.media3.exoplayer.offline.DownloadService;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Ponte JS ↔ Media3 offline. enqueue baixa a MASTER capturada ATRAVÉS do ProxyServer
 * local (reaproveita headers anti-bot/gzip/segmento-raw). O ID do download = a chave
 * do JS (m:tmdbId / e:tmdbId:s:e) → o app sabe o que está baixado por título/ep.
 */
@UnstableApi
@CapacitorPlugin(name = "Downloader")
public class DownloaderPlugin extends Plugin {

    private DownloadManager.Listener listener;

    // Motivo LEGÍVEL da última falha, por download. O Download do Media3 só guarda um
    // int (failureReason=1) e a exceção chega UMA vez, no listener; sem guardar aqui, o
    // list() do polling do JS reescrevia o item com "falha (código 1)" por cima da
    // mensagem. Some ao voltar a baixar/concluir/remover.
    private static final Map<String, String> failReasons = new ConcurrentHashMap<>();
    // Último estado visto por download: o listener repete o mesmo estado várias vezes,
    // e a aba Bugs deve registrar falha/conclusão só na TRANSIÇÃO.
    private static final Map<String, Integer> lastState = new ConcurrentHashMap<>();

    @Override
    public void load() {
        // Canal de notificação (foreground service exige) + listener de mudanças.
        NotificationUtil.createNotificationChannel(getContext(), DownloadUtil.CHANNEL_ID,
            R.string.download_channel_name, 0, NotificationUtil.IMPORTANCE_LOW);
        DownloadManager dm = DownloadUtil.getDownloadManager(getContext());
        listener = new DownloadManager.Listener() {
            @Override public void onDownloadChanged(DownloadManager m, Download d, Exception e) {
                String id = d.request.id;
                Integer antes = lastState.put(id, d.state);
                boolean transicao = antes == null || antes != d.state;
                if (d.state == Download.STATE_FAILED) {
                    failReasons.put(id, DownloadFailure.describe(e, d.getPercentDownloaded()));
                    if (transicao) reportFailure(d, e);
                } else if (d.state == Download.STATE_DOWNLOADING || d.state == Download.STATE_COMPLETED) {
                    failReasons.remove(id);
                    if (transicao && d.state == Download.STATE_COMPLETED) reportDone(d);
                }
                notifyListeners("downloadChanged", toJson(d));
            }
            @Override public void onDownloadRemoved(DownloadManager m, Download d) {
                failReasons.remove(d.request.id);
                lastState.remove(d.request.id);
                JSObject o = new JSObject();
                o.put("key", d.request.id);
                o.put("state", "removed");
                o.put("percent", 0);
                notifyListeners("downloadChanged", o);
            }
        };
        dm.addListener(listener);
        resumePending();
    }

    /**
     * Falha → aba Bugs (wm_playback_errors) como DOWNLOAD_FALHOU, com a causa real, onde
     * parou e o diagnóstico do proxy. Antes a falha não ficava registrada em lugar nenhum
     * (só o "reason" na tela) — caso 10/09/2026: "Falhou: java.net.SocketTime…" sem rastro
     * pra investigar. O título vai no formato da aba ("Nome — T1 E4") pra cair na pasta
     * certa; error_code = failureReason (≠ 0) conta como erro de verdade.
     */
    private static void reportFailure(Download d, Exception e) {
        try {
            String proxied = d.request.uri.toString();
            String cause = "[download] " + (e == null ? "sem exceção (interrompido)" : String.valueOf(e))
                + " | percent=" + Math.round(d.getPercentDownloaded()) + " bytes=" + d.getBytesDownloaded()
                + " failureReason=" + d.failureReason
                + " | proxy{" + ProxyServer.lastDiag + "}";
            NativePlayerPlugin.reportError(DownloadUtil.cacheKey(proxied), d.failureReason,
                DownloadFailure.httpStatusOf(e), "DOWNLOAD_FALHOU", cause,
                d.request.mimeType, refererOf(proxied), DownloadUtil.bugsTitleOf(d));
        } catch (Throwable ignored) { /* diagnóstico nunca derruba o download */ }
    }

    // Conclusão também vai pra aba (código 0 = diagnóstico, não erro): dá a linha do
    // tempo "começou a falhar às X, terminou às Y" sem abrir o logcat.
    private static void reportDone(Download d) {
        try {
            String proxied = d.request.uri.toString();
            NativePlayerPlugin.reportError(DownloadUtil.cacheKey(proxied), 0, 0, "DOWNLOAD_CONCLUIDO",
                "[download] bytes=" + d.getBytesDownloaded(),
                d.request.mimeType, refererOf(proxied), DownloadUtil.bugsTitleOf(d));
        } catch (Throwable ignored) { }
    }

    private static String refererOf(String proxied) {
        try { return Uri.parse(proxied).getQueryParameter("r"); } catch (Exception e) { return null; }
    }

    /**
     * Retoma sozinho os downloads que ficaram pela metade (app atualizado, fechado ou
     * morto pelo sistema). Sem isso o usuário tinha que mandar baixar de novo.
     * 3 coisas precisam acontecer, nessa ordem:
     * 1. subir o ProxyServer — a URL baixada é http://127.0.0.1:8099/s?u=… e, com ele
     *    fora do ar, o download resumido bate em "connection refused" e falha de novo;
     * 2. religar o WatchDownloadService (o Media3 só baixa com o serviço rodando);
     * 3. re-enfileirar o que está FAILED/STOPPED — esses NÃO voltam sozinhos. Re-enviar
     *    a MESMA DownloadRequest continua de onde parou (o já baixado está no
     *    SimpleCache), não recomeça do zero.
     * Roda em thread: lê o índice em disco.
     */
    private void resumePending() {
        new Thread(() -> {
            try {
                DownloadManager dm = DownloadUtil.getDownloadManager(getContext());
                java.util.List<DownloadRequest> retry = new java.util.ArrayList<>();
                java.util.List<String> unstop = new java.util.ArrayList<>();
                boolean pending = false;
                try (DownloadCursor c = dm.getDownloadIndex().getDownloads(
                        Download.STATE_QUEUED, Download.STATE_DOWNLOADING,
                        Download.STATE_STOPPED, Download.STATE_FAILED)) {
                    while (c.moveToNext()) {
                        Download d = c.getDownload();
                        pending = true;
                        if (d.state == Download.STATE_FAILED) retry.add(d.request);
                        else if (d.state == Download.STATE_STOPPED) unstop.add(d.request.id);
                    }
                }
                if (!pending) return;
                ProxyServer.ensure();
                DownloadService.sendResumeDownloads(getContext(), WatchDownloadService.class, true);
                for (String id : unstop) {
                    DownloadService.sendSetStopReason(getContext(), WatchDownloadService.class,
                        id, Download.STOP_REASON_NONE, false);
                }
                for (DownloadRequest r : retry) {
                    DownloadService.sendAddDownload(getContext(), WatchDownloadService.class, r, false);
                }
            } catch (Exception ignored) { }
        }).start();
    }

    // Mesma retomada, disparável pelo JS (ex.: ao abrir a aba Download).
    @PluginMethod
    public void resume(PluginCall call) {
        resumePending();
        call.resolve();
    }

    private static String stateName(int s) {
        switch (s) {
            case Download.STATE_QUEUED: return "queued";
            case Download.STATE_STOPPED: return "stopped";
            case Download.STATE_DOWNLOADING: return "downloading";
            case Download.STATE_COMPLETED: return "completed";
            case Download.STATE_FAILED: return "failed";
            case Download.STATE_REMOVING: return "removing";
            case Download.STATE_RESTARTING: return "restarting";
            default: return "unknown";
        }
    }

    private static JSObject toJson(Download d) {
        JSObject o = new JSObject();
        o.put("key", d.request.id);
        o.put("state", stateName(d.state));
        // title (gravado em request.data) + uri proxied: permitem RECONSTRUIR o item na
        // aba Download mesmo sem o registro local (ex. baixado por uma versão antiga).
        try { if (d.request.data != null && d.request.data.length > 0) o.put("title", new String(d.request.data)); } catch (Exception ignored) {}
        try { o.put("uri", d.request.uri.toString()); } catch (Exception ignored) {}
        float p = d.getPercentDownloaded();
        o.put("percent", Float.isNaN(p) || p < 0 ? -1 : Math.round(p));
        o.put("bytes", d.getBytesDownloaded());
        if (d.state == Download.STATE_FAILED) {
            // Motivo guardado no listener; sem ele (app reaberto com FAILED no índice) a
            // frase genérica ainda diz onde parou e como retomar.
            String motivo = failReasons.get(d.request.id);
            o.put("reason", motivo != null ? motivo : DownloadFailure.describe(null, p));
        }
        return o;
    }

    @PluginMethod
    public void enqueue(PluginCall call) {
        String key = call.getString("key");
        String url = call.getString("url");
        String referer = call.getString("referer", "");
        String mime = call.getString("mime");
        String title = call.getString("title", "");
        if (key == null || url == null) { call.reject("key e url obrigatórios"); return; }
        // Baixa através do proxy local (mesmo caminho do player) → headers/gzip/raw ok.
        String proxied = ProxyServer.local(url, referer);
        DownloadRequest.Builder b = new DownloadRequest.Builder(key, Uri.parse(proxied));
        if (mime != null && mime.toLowerCase().contains("mpegurl")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
        if (title != null) b.setData(title.getBytes());
        try {
            DownloadService.sendAddDownload(getContext(), WatchDownloadService.class, b.build(), true);
            call.resolve();
        } catch (Exception e) { call.reject("falha ao enfileirar: " + e); }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key == null) { call.reject("key obrigatória"); return; }
        try {
            DownloadService.sendRemoveDownload(getContext(), WatchDownloadService.class, key, false);
            call.resolve();
        } catch (Exception e) { call.reject("falha ao remover: " + e); }
    }

    // Espaço do aparelho onde os downloads ficam (pra aba Download mostrar "livre").
    @PluginMethod
    public void storage(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            android.os.StatFs fs = new android.os.StatFs(
                DownloadUtil.downloadDirFor(getContext()).getAbsolutePath());
            ret.put("freeBytes", fs.getAvailableBytes());
            ret.put("totalBytes", fs.getTotalBytes());
        } catch (Exception e) {
            ret.put("freeBytes", 0);
            ret.put("totalBytes", 0);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray arr = new JSArray();
        try (DownloadCursor c = DownloadUtil.getDownloadManager(getContext()).getDownloadIndex().getDownloads()) {
            while (c.moveToNext()) arr.put(toJson(c.getDownload()));
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("downloads", arr);
        call.resolve(ret);
    }
}
