package com.weslley.watchmov;

import android.app.ActivityManager;
import android.content.Context;
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
import java.util.Set;
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
    // Downloads com link morto em confirmação (2ª consulta agendada): resumePending não os
    // retenta enquanto a resposta não vem.
    private static final Set<String> probing = ConcurrentHashMap.newKeySet();
    // Espera entre a falha do Media3 e a 2ª consulta ao link — um 4xx passageiro (CDN, limite) já passou.
    static final long DEAD_LINK_PROBE_DELAY_MS = 60_000;
    // Links mortos confirmados com o app em 2º plano: a remoção fica pra próxima retomada em 1º plano.
    private static final String DEAD_PREFS = "wm_dead_links";
    private static final String DEAD_KEY = "ids";

    private static java.util.Set<String> deadLinks(Context app) {
        return new java.util.HashSet<>(app.getSharedPreferences(DEAD_PREFS, Context.MODE_PRIVATE)
            .getStringSet(DEAD_KEY, java.util.Collections.emptySet()));
    }

    private static void saveDeadLinks(Context app, java.util.Set<String> ids) {
        app.getSharedPreferences(DEAD_PREFS, Context.MODE_PRIVATE).edit().putStringSet(DEAD_KEY, ids).apply();
    }

    /** Este processo tem tela visível ou serviço em 1º plano → pode mexer no WatchDownloadService. */
    private static boolean emPrimeiroPlano() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE;
    }

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
                    if (transicao) { reportFailure(d, e); maybeConfirmDeadLink(d, e); }
                } else if (d.state == Download.STATE_DOWNLOADING || d.state == Download.STATE_COMPLETED) {
                    failReasons.remove(id);
                    if (transicao && d.state == Download.STATE_COMPLETED) reportDone(d);
                }
                notifyListeners("downloadChanged", toJson(d));
            }
            @Override public void onDownloadRemoved(DownloadManager m, Download d) {
                failReasons.remove(d.request.id);
                lastState.remove(d.request.id);
                try {
                    Context app = getContext().getApplicationContext();
                    java.util.Set<String> mortos = deadLinks(app);
                    if (mortos.remove(d.request.id)) saveDeadLinks(app, mortos);
                } catch (Throwable ignored) { }
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
     *
     * ⚠️ TODAS as chamadas ao WatchDownloadService saem com foreground=false (aqui, no
     * enqueue e no botão de baixar do player): elas só acontecem com o app ABERTO, onde o
     * startService comum é permitido, e o próprio DownloadService passa pra primeiro
     * plano quando um download começa. CAUSA RAIZ do "app fechou sozinho" (19/09 e
     * 23/09/2026, ForegroundServiceDidNotStartInTimeException apontando pra cá): este
     * método misturava sendResumeDownloads(true) com sendSetStopReason/sendAddDownload
     * (false). O startService comum zera o fgRequired do serviço antes do startForeground
     * e o fgWaiting fica preso; o próximo startForegroundService (app reaberto, aba
     * Download) liga o fgRequired de novo e ninguém mais limpa — quando o download
     * termina e o serviço para sozinho, o Android derruba o app ("Bringing down service
     * while still waiting for start foreground").
     */
    private void resumePending() {
        new Thread(() -> {
            try {
                DownloadManager dm = DownloadUtil.getDownloadManager(getContext());
                java.util.List<DownloadRequest> retry = new java.util.ArrayList<>();
                java.util.List<String> unstop = new java.util.ArrayList<>();
                java.util.List<String> remover = new java.util.ArrayList<>();
                java.util.Set<String> mortos = deadLinks(getContext().getApplicationContext());
                boolean pending = false;
                try (DownloadCursor c = dm.getDownloadIndex().getDownloads(
                        Download.STATE_QUEUED, Download.STATE_DOWNLOADING,
                        Download.STATE_STOPPED, Download.STATE_FAILED)) {
                    while (c.moveToNext()) {
                        Download d = c.getDownload();
                        pending = true;
                        if (d.state == Download.STATE_FAILED) {
                            // Link morto confirmado 2x com o app em 2º plano: cancela agora (1º plano), em
                            // vez de retentar. Em confirmação (2ª consulta pendente): não retenta enquanto
                            // a resposta não vem — era esse retentar a cada abertura que travava.
                            if (mortos.contains(d.request.id)) remover.add(d.request.id);
                            else if (!probing.contains(d.request.id)) retry.add(d.request);
                        } else if (d.state == Download.STATE_STOPPED) unstop.add(d.request.id);
                    }
                }
                if (!pending) return;
                ProxyServer.ensure();
                DownloadService.sendResumeDownloads(getContext(), WatchDownloadService.class, false);
                for (String id : unstop) {
                    DownloadService.sendSetStopReason(getContext(), WatchDownloadService.class,
                        id, Download.STOP_REASON_NONE, false);
                }
                for (DownloadRequest r : retry) {
                    DownloadService.sendAddDownload(getContext(), WatchDownloadService.class, r, false);
                }
                for (String id : remover) {
                    DownloadService.sendRemoveDownload(getContext(), WatchDownloadService.class, id, false);
                }
            } catch (Exception ignored) { }
        }).start();
    }

    /**
     * Link morto (404/410 = expirou; 403/451 = a fonte bloqueou) → o download é CANCELADO, mas só com
     * DUPLA confirmação (Weslley 23/09/2026: "precisa ter certeza que o link expirou, para não cancelar
     * link ativo"): 1ª = a falha do Media3 (depois das DL_MIN_RETRY_COUNT tentativas) com status de link
     * morto; 2ª = consulta direta ao link real, DEAD_LINK_PROBE_DELAY_MS depois, com o MESMO status.
     * Antes, resumePending re-adicionava todo FAILED a cada abertura do app/aba Download e o link morto
     * do Black Torch (HTTP 410, parado em 24%) gastava ~90 s de rede, cache e serviço em 1º plano TODA
     * vez — o "eps travado no download" que ele viu junto do vídeo travando (23/09/2026). Resposta
     * diferente na 2ª consulta (200/206, erro de rede, outro status) = falha temporária: nada muda.
     */
    private void maybeConfirmDeadLink(Download d, Exception e) {
        final int http = DownloadFailure.httpStatusOf(e);
        if (!DownloadFailure.isDeadLinkStatus(http)) return;
        final String id = d.request.id;
        if (!probing.add(id)) return;
        String falhou = DownloadFailure.failedUrlOf(e);
        final String proxied = falhou != null ? falhou : d.request.uri.toString();
        final String real = DownloadUtil.cacheKey(proxied);
        final String referer = refererOf(proxied);
        final android.content.Context app = getContext().getApplicationContext();
        new Thread(() -> {
            try {
                Thread.sleep(DEAD_LINK_PROBE_DELAY_MS);
                Download atual = DownloadUtil.getDownloadManager(app).getDownloadIndex().getDownload(id);
                if (atual == null || atual.state != Download.STATE_FAILED) return;   // removido/retomado no meio
                int probe = ProxyServer.probeStatus(real, referer);
                if (!DownloadFailure.confirmsDeadLink(http, probe)) {
                    android.util.Log.i("WatchMov", "link morto NÃO confirmado (" + http + " → " + probe + "); fica pra retomar: " + id);
                    return;
                }
                cancelDeadLink(app, atual, http, probe, real, referer);
            } catch (Throwable t) {
                android.util.Log.w("WatchMov", "confirmação de link morto falhou: " + t);
            } finally {
                probing.remove(id);
            }
        }, "wm-dead-link").start();
    }

    // Confirmado 2x: some da fila (e o pedaço baixado com ele), avisa a aba Download, a central e a
    // notificação, e registra na aba Bugs como DOWNLOAD_CANCELADO (com os dois status).
    private void cancelDeadLink(android.content.Context app, Download d, int http, int probe, String real, String referer) {
        String id = d.request.id;
        String reason = DownloadFailure.deadLinkReason(http);
        failReasons.put(id, reason);
        JSObject falha = toJson(d);
        falha.put("reason", reason);
        notifyListeners("downloadChanged", falha);
        JSObject cancel = new JSObject();
        cancel.put("key", id);
        try { if (d.request.data != null && d.request.data.length > 0) cancel.put("title", new String(d.request.data)); } catch (Exception ignored) {}
        cancel.put("reason", reason);
        cancel.put("http", http);
        notifyListeners("downloadCancelled", cancel);
        try {
            NativePlayerPlugin.reportError(DownloadUtil.cacheKey(d.request.uri.toString()), d.failureReason, http, "DOWNLOAD_CANCELADO",
                "[download] link morto confirmado 2x: falha do Media3=" + http + ", consulta direta 1 min depois=" + probe
                    + " | percent=" + Math.round(d.getPercentDownloaded()) + " bytes=" + d.getBytesDownloaded()
                    + " | url=" + real,
                d.request.mimeType, referer, DownloadUtil.bugsTitleOf(d));
        } catch (Throwable ignored) { /* diagnóstico nunca impede o cancelamento */ }
        DownloadUtil.notifyReady(app, DownloadUtil.labelOf(d), http == 403 || http == 451
            ? "download cancelado: a fonte bloqueou. Troque a fonte e baixe de novo."
            : "download cancelado: o link expirou. Abra o título de novo pra baixar.");
        if (emPrimeiroPlano()) {
            DownloadService.sendRemoveDownload(app, WatchDownloadService.class, id, false);
        } else {
            // App em 2º plano com o serviço parado: mandar o intent agora RELIGA o WatchDownloadService, que
            // ao ver REMOVING chama startForeground — e o Android 12+ nega (ForegroundServiceStartNotAllowed-
            // Exception, crash visto no emulador em 23/09/2026). A remoção fica pra próxima retomada em 1º
            // plano (resumePending), que também deixa de retentar este id. O tile já mostra "cancelado".
            java.util.Set<String> mortos = deadLinks(app);
            mortos.add(id);
            saveDeadLinks(app, mortos);
            android.util.Log.i("WatchMov", "link morto confirmado em 2º plano; remoção adiada pra próxima abertura: " + id);
        }
    }

    /**
     * App voltou pra tela (processo já vivo, então o load()/resumePending não roda de novo): aplica só a
     * remoção dos links mortos confirmados em 2º plano — sem retentar mais nada, que retentar a cada
     * volta era justamente o problema. Agora está em 1º plano, então mexer no serviço é seguro.
     */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        removerLinksMortos();
    }

    private void removerLinksMortos() {
        new Thread(() -> {
            try {
                Context app = getContext().getApplicationContext();
                java.util.Set<String> mortos = deadLinks(app);
                if (mortos.isEmpty()) return;
                DownloadManager dm = DownloadUtil.getDownloadManager(app);
                for (String id : mortos) {
                    Download d = dm.getDownloadIndex().getDownload(id);
                    if (d != null && d.state == Download.STATE_FAILED) {
                        DownloadService.sendRemoveDownload(app, WatchDownloadService.class, id, false);
                    }
                }
            } catch (Throwable t) {
                android.util.Log.w("WatchMov", "remoção adiada de link morto falhou: " + t);
            }
        }, "wm-dead-link-remove").start();
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
            // false: ver resumePending (primeiro plano aqui derrubava o app).
            DownloadService.sendAddDownload(getContext(), WatchDownloadService.class, b.build(), false);
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
