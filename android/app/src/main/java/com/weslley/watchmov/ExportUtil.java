package com.weslley.watchmov;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.Clock;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultDecoderFactory;
import androidx.media3.transformer.ExoPlayerAssetLoader;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Exporta um download (HLS no SimpleCache do Media3) pra um MP4 REAL em
 * Movies/WatchMov, visível pra qualquer app do aparelho.
 *
 * Por quê: o download vive em getExternalFilesDir()/wm_downloads como pedaços .exo
 * do SimpleCache — Android/data é invisível pra outros apps (Android 11+) e os
 * pedaços não são um vídeo. Então o Web Video Cast/VLC nunca achavam o baixado
 * pela aba "arquivos do telefone", e sobrava mandar a URL do proxy — que depende
 * do celular servir a stream e da TV engolir HLS (receptor DLNA não engole).
 *
 * Como: o Transformer REMUXA pra MP4 (sem re-encodar quando os codecs já cabem no
 * container, o caso de H.264+AAC) lendo pelo MESMO CacheDataSource do playback
 * offline. O ap=pt reaproveita a preferência de áudio PT do cast.
 */
@UnstableApi
public final class ExportUtil {

    public interface Cb {
        void progress(int percent);          // -1 = ainda sem estimativa
        void done(Uri uri, String name);
        void failed(String why);
        /** Esperando a vez (roda um por vez) — o nome vai junto pra UI mostrar o quê. */
        default void queued(int position, String name) {}
    }

    /** Pedido esperando a vez — converter é I/O+CPU pesado, então roda um por vez. */
    private static final class Job {
        final Context ctx; final String key, name, src, mime; final boolean fromCache;
        final long expectedBytes; final Cb cb;
        Job(Context ctx, String key, String name, String src, String mime, boolean fromCache, long expectedBytes, Cb cb) {
            this.ctx = ctx; this.key = key; this.name = name; this.src = src;
            this.mime = mime; this.fromCache = fromCache; this.expectedBytes = expectedBytes; this.cb = cb;
        }
    }

    private static final java.util.ArrayDeque<Job> queue = new java.util.ArrayDeque<>();

    /** Chaves esperando na fila (a UI mostra "na fila" em vez de recusar). */
    public static java.util.List<String> queuedKeys() {
        java.util.List<String> out = new java.util.ArrayList<>();
        for (Job j : queue) out.add(j.key);
        return out;
    }

    // Põe na fila; se nada estiver rodando, começa na hora.
    private static void enqueue(Job job) {
        for (Job j : queue) if (j.key.equals(job.key)) { job.cb.queued(queue.size(), job.name); return; }
        if (job.key.equals(runningKey)) { job.cb.progress(-1); return; }
        queue.addLast(job);
        if (runningKey == null) pump();
        else job.cb.queued(queue.size(), job.name);
    }

    // Puxa o próximo da fila (chamado ao terminar, falhar ou cancelar).
    private static void pump() {
        if (runningKey != null) return;
        Job j = queue.pollFirst();
        if (j == null) return;
        run(j.ctx, j.key, j.name, j.src, j.mime, j.fromCache, j.expectedBytes, j.cb);
    }

    private static final String PREFS = "wm_exports";      // key -> "<uri>|<nome>"
    private static final String TMP_DIR = "exports";

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Transformer transformer;    // um export por vez (I/O pesado)
    private static String runningKey;
    private static String runningName;
    private static long runningExpected;   // bytes esperados (base do % quando o Transformer não estima)
    private static File tmpFile;
    private static Cb cb;
    // Última execução (pro retry sem ap=pt e pro relato de erro no painel de bugs).
    private static Context lastCtx;
    private static String lastKey, lastName, lastSrc, lastMime;
    private static boolean lastFromCache;
    private static boolean retried = false;

    private ExportUtil() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** URI do MP4 já exportado dessa chave, ou null. Some se o arquivo foi apagado por fora. */
    public static Uri exported(Context ctx, String key) {
        if (key == null) return null;
        String v = prefs(ctx).getString(key, null);
        if (v == null) return null;
        int sep = v.indexOf('|');
        Uri uri = Uri.parse(sep >= 0 ? v.substring(0, sep) : v);
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            if (in != null) return uri;
        } catch (Exception ignored) {}
        prefs(ctx).edit().remove(key).apply();
        return null;
    }

    /** Chaves que já têm MP4 (pra aba Download marcar o formato de cada item). */
    public static java.util.List<String> exportedKeys(Context ctx) {
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String k : prefs(ctx).getAll().keySet()) if (exported(ctx, k) != null) out.add(k);
        return out;
    }

    public static boolean isRunning() { return runningKey != null; }
    public static String runningKey() { return runningKey; }
    /** Nome do arquivo em conversão (a central mostra "Convertendo: <título>"). */
    public static String runningName() { return runningName; }

    /** Chave de download (m:tmdbId / e:tmdbId:s:e) a partir da chave de resume do player. */
    public static String downloadKeyFromResume(String resumeKey) {
        if (resumeKey == null) return null;
        String[] p = resumeKey.split(":");      // tmdbId:type:season:ep
        if (p.length < 4) return null;
        if ("movie".equals(p[1])) return "m:" + p[0];
        return "e:" + p[0] + ":" + p[2] + ":" + p[3];
    }

    public static void start(Context context, String key, String title, Cb callback) {
        final Context ctx = context.getApplicationContext();
        Download d;
        try {
            d = DownloadUtil.getDownloadManager(ctx).getDownloadIndex().getDownload(key);
        } catch (Exception e) { callback.failed("não consegui ler o download: " + e.getMessage()); return; }
        if (d == null || d.state != Download.STATE_COMPLETED) {
            callback.failed("baixe o vídeo por completo antes de exportar"); return;
        }
        // O MP4 é uma CÓPIA do baixado e ainda passa por um temporário — sem espaço,
        // falharia no meio do remux. Avisa antes.
        long need = (long) (d.getBytesDownloaded() * 2.2);
        try {
            android.os.StatFs fs = new android.os.StatFs(DownloadUtil.downloadDirFor(ctx).getAbsolutePath());
            if (need > 0 && fs.getAvailableBytes() < need) {
                callback.failed("espaço insuficiente: precisa de ~" + (need / (1024 * 1024)) + " MB livres");
                return;
            }
        } catch (Exception ignored) {}

        String t = title;
        if ((t == null || t.isEmpty()) && d.request.data != null && d.request.data.length > 0) {
            try { t = new String(d.request.data); } catch (Exception ignored) {}
        }
        final String name = safeName(t, key) + ".mp4";

        ProxyServer.ensure();   // a URI do download aponta pro proxy local
        // ap=pt: mesma regra do cast — havendo faixa de áudio PT no master, o proxy
        // remove as demais, então o MP4 sai dublado (e não em inglês, que vem marcado
        // DEFAULT no HLS). Sem faixa PT, nada muda.
        String src = d.request.uri.toString();
        if (!src.contains("&ap=")) src = src + "&ap=pt";
        String mime = d.request.mimeType != null ? d.request.mimeType : MimeTypes.APPLICATION_M3U8;
        // bytes do cache = referência do progresso (o Transformer não sabe estimar HLS)
        enqueue(new Job(ctx, key, name, src, mime, true, d.getBytesDownloaded(), callback));
    }

    /**
     * Baixa JÁ EM MP4, direto do stream (sem passar pelo download do Media3): o
     * Transformer puxa o HLS pelo proxy e vai escrevendo o container. Não retoma se
     * cair (o MP4 só fecha no fim) — por isso é uma opção, não o padrão.
     */
    public static void startFromUrl(Context context, String key, String url, String referer,
                                    String mime, String title, Cb callback) {
        final Context ctx = context.getApplicationContext();
        if (url == null || url.isEmpty()) { callback.failed("sem link"); return; }
        ProxyServer.ensure();
        String src = url.contains("/s?u=") ? url : ProxyServer.local(url, referer);
        if (!src.contains("&ap=")) src = src + "&ap=pt";
        // O mime vindo do JS às vezes chega como video/* — e aí o ExoPlayer trata a
        // PLAYLIST como arquivo progressivo e morre em
        // "UnrecognizedInputFormatException: None of the available extractors could
        // read the stream". Quem manda é o padrão da URL (mesma regra do proxy e do
        // handoff); o mime do JS só decide quando não é HLS.
        String m = isHlsUrl(url, mime) ? MimeTypes.APPLICATION_M3U8
            : (mime == null || mime.isEmpty() ? MimeTypes.APPLICATION_M3U8 : mime);
        // Baixando da rede não dá pra saber o tamanho final → o anel gira sem %.
        enqueue(new Job(ctx, key, safeName(title, key) + ".mp4", src, m, false, 0, callback));
    }

    /** É HLS? (mesma leitura de URL que o ProxyServer e o handoff externo usam.) */
    private static boolean isHlsUrl(String url, String mime) {
        if (mime != null && mime.toLowerCase().contains("mpegurl")) return true;
        if (url == null) return false;
        String l = url.toLowerCase();
        return l.contains(".m3u8") || l.contains(".m3u") || l.contains("/hls/")
            || l.contains("/m3/") || l.contains("/md/") || l.contains("master")
            || l.contains("playlist") || l.endsWith(".txt");
    }

    /**
     * Motor comum: Transformer → MP4 temporário → MediaStore. fromCache=true lê os
     * segmentos do SimpleCache (título já baixado); false busca na rede pelo proxy.
     */
    private static void run(Context ctx, String key, String name, String src, String mime,
                            boolean fromCache, long expectedBytes, Cb callback) {
        File dir = new File(ctx.getExternalFilesDir(null), TMP_DIR);
        if (!dir.exists() && !dir.mkdirs()) { callback.failed("não consegui criar a pasta temporária"); pump(); return; }
        tmpFile = new File(dir, "export.mp4");
        if (tmpFile.exists() && !tmpFile.delete()) { tmpFile = null; callback.failed("sobrou um arquivo temporário travado"); pump(); return; }

        runningKey = key;
        runningName = name;
        runningExpected = expectedBytes;
        cb = callback;
        // Guardados pro RETRY sem ap=pt (ver onError): o proxy remove as faixas de
        // áudio não-PT do master e, em alguns títulos, o que sobra não casa com o
        // grupo AUDIO= das variantes → o parser HLS recusa a playlist.
        lastCtx = ctx; lastKey = key; lastName = name; lastSrc = src; lastMime = mime; lastFromCache = fromCache;
        final MediaItem item = new MediaItem.Builder().setUri(src).setMimeType(mime).build();
        final String out = tmpFile.getAbsolutePath();
        // Transformer é single-thread: criar, start, getProgress e cancel na main.
        main.post(() -> {
            try {
                Transformer.Builder b = new Transformer.Builder(ctx)
                    .addListener(new Transformer.Listener() {
                        @Override public void onCompleted(Composition c, ExportResult r) { publishAsync(ctx); }
                        @Override public void onError(Composition c, ExportResult r, ExportException e) { onExportError(e); }
                    });
                if (fromCache) {
                    // MESMO caminho de leitura do player offline: o CacheDataSource lê os
                    // segmentos do SimpleCache pela chave normalizada e só cai no
                    // proxy/rede em cache-miss.
                    b.setAssetLoaderFactory(new ExoPlayerAssetLoader.Factory(
                        ctx,
                        new DefaultDecoderFactory(ctx),
                        Clock.DEFAULT,
                        new DefaultMediaSourceFactory(DownloadUtil.getPlaybackCacheFactory(ctx))));
                }
                transformer = b.build();
                transformer.start(item, out);
                // Primeiro plano: sem isso o Android mata o processo quando o app sai
                // da tela e a conversão morre no meio.
                ConvertService.update(ctx, name.replace(".mp4", ""), -1);
                if (cb != null) cb.progress(-1);
                main.postDelayed(ExportUtil::poll, 800);
            } catch (Throwable th) {
                fail("não consegui iniciar: " + th.getMessage());
            }
        });
    }

    private static void poll() {
        if (transformer == null || runningKey == null) return;
        try {
            ProgressHolder h = new ProgressHolder();
            int st = transformer.getProgress(h);
            int pct = st == Transformer.PROGRESS_STATE_AVAILABLE ? h.progress : -1;
            // Em HLS o Transformer quase sempre responde UNAVAILABLE (não sabe a
            // duração de antemão) — o anel ficava girando pra sempre. Então estima
            // pelo MP4 que está sendo escrito vs o tamanho do que foi baixado.
            if (pct < 0 && runningExpected > 0 && tmpFile != null) {
                long len = tmpFile.length();
                if (len > 0) pct = (int) Math.min(99, len * 100 / runningExpected);
            }
            if (cb != null) cb.progress(pct);
            if (lastCtx != null) ConvertService.update(lastCtx, runningName == null ? "" : runningName.replace(".mp4", ""), pct);
        } catch (Throwable ignored) {}
        main.postDelayed(ExportUtil::poll, 800);
    }

    /** Cancela a conversão atual (ou tira da fila, se ainda não começou). */
    public static void cancel(String key) {
        main.post(() -> {
            if (key != null && !key.equals(runningKey)) {
                java.util.Iterator<Job> it = queue.iterator();
                while (it.hasNext()) if (it.next().key.equals(key)) it.remove();
                return;
            }
            try { if (transformer != null) transformer.cancel(); } catch (Throwable ignored) {}
            cleanup();
            pump();     // a fila continua andando
        });
    }

    public static void cancel() { cancel(null); }

    /**
     * Falhou. Antes de desistir, tenta UMA vez sem o &ap=pt: o proxy remove as faixas
     * de áudio não-PT do master e há títulos em que isso deixa as variantes apontando
     * pra um grupo AUDIO= que não existe mais — o parser recusa e o AssetLoader morre
     * antes de ler o 1º segmento ("Asset loader error"). Sem o ap, a playlist é a
     * original (áudio pode vir no idioma padrão, mas o arquivo sai).
     */
    private static void onExportError(ExportException e) {
        String why = friendly(e);
        // Registra no painel de bugs do app com código + causa raiz — sem isso o
        // usuário só vê "Asset loader error", que não diz nada.
        try {
            NativePlayerPlugin.reportError(lastSrc, 0, 0, "EXPORT_MP4",
                "[export] code=" + (e != null ? e.errorCode : -1) + " cache=" + lastFromCache
                + " msg=" + (e != null ? e.getMessage() : "") + " cause=" + rootCause(e),
                lastMime, null, lastName);
        } catch (Throwable ignored) {}

        boolean canRetry = !retried && lastSrc != null && lastSrc.contains("&ap=pt") && lastCtx != null;
        if (!canRetry) { retried = false; fail(why); return; }
        retried = true;
        final Context ctx = lastCtx; final String key = lastKey, name = lastName, mime = lastMime;
        final String src = lastSrc.replace("&ap=pt", "");
        final boolean fromCache = lastFromCache;
        final long expected = runningExpected;
        final Cb c = cb;
        cleanup();
        main.post(() -> run(ctx, key, name, src, mime, fromCache, expected, new Cb() {
            @Override public void progress(int p) { if (c != null) c.progress(p); }
            @Override public void done(Uri uri, String n) { retried = false; if (c != null) c.done(uri, n); }
            @Override public void failed(String w) { retried = false; if (c != null) c.failed(w); }
        }));
    }

    private static String rootCause(Throwable t) {
        Throwable c = t;
        int guard = 0;
        while (c != null && c.getCause() != null && guard++ < 8) c = c.getCause();
        return c == null ? "" : (c.getClass().getSimpleName() + ": " + c.getMessage());
    }

    // Erro do remux em linguagem de gente (o código cru não diz nada pro usuário).
    private static String friendly(ExportException e) {
        String msg = e != null && e.getMessage() != null ? e.getMessage() : "falha no remux";
        int code = e != null ? e.errorCode : 0;
        String cause = rootCause(e);
        if (code == ExportException.ERROR_CODE_MUXING_FAILED
            || code == ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED
            || code == ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED) {
            return "o formato desse vídeo não cabe num MP4 (codec incomum)";
        }
        if (code == ExportException.ERROR_CODE_IO_FILE_NOT_FOUND
            || code == ExportException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
            || code == ExportException.ERROR_CODE_IO_BAD_HTTP_STATUS) {
            return "não consegui ler o vídeo (código " + code + " · " + cause + ")";
        }
        // Sem tradução conhecida: mostra o que dá pra agir em cima (código + causa
        // raiz), não só "Asset loader error", que não diz nada.
        return msg + (cause.isEmpty() ? "" : " · " + cause) + " (código " + code + ")";
    }

    private static void fail(String why) {
        Cb c = cb;
        cleanup();
        if (c != null) c.failed(why);
        pump();     // libera a vez pro próximo da fila
    }

    private static void cleanup() {
        // Fila vazia = nada mais a converter → tira a notificação de primeiro plano.
        if (queue.isEmpty() && lastCtx != null) ConvertService.stop(lastCtx);
        runningKey = null;
        runningName = null;
        runningExpected = 0;
        transformer = null;
        cb = null;
        if (tmpFile != null && tmpFile.exists()) { try { tmpFile.delete(); } catch (Exception ignored) {} }
        tmpFile = null;
    }

    // Publica o temporário em Movies/WatchMov (thread separada: copia arquivo grande).
    private static void publishAsync(Context ctx) {
        final String key = runningKey, name = runningName;
        final File src = tmpFile;
        final Cb c = cb;
        transformer = null;
        if (key == null || src == null) { cleanup(); pump(); return; }
        new Thread(() -> {
            try {
                Uri uri = publish(ctx, src, name);
                prefs(ctx).edit().putString(key, uri.toString() + "|" + name).apply();
                main.post(() -> {
                    cleanup();
                    if (c != null) c.done(uri, name);
                    // Converter demora — o usuário raramente fica olhando a tela.
                    DownloadUtil.notifyReady(ctx, name.replace(".mp4", ""),
                        "foi convertido — já dá pra abrir no Web Video Cast");
                    pump();     // próximo da fila
                });
            } catch (Throwable t) {
                main.post(() -> {
                    cleanup();
                    if (c != null) c.failed("não consegui salvar em Movies: " + t.getMessage());
                    pump();
                });
            }
        }).start();
    }

    private static Uri publish(Context ctx, File src, String name) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = ctx.getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.Video.Media.DISPLAY_NAME, name);
            v.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
            v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/WatchMov");
            v.put(MediaStore.Video.Media.IS_PENDING, 1);   // some da galeria enquanto copia
            Uri uri = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
            if (uri == null) throw new Exception("MediaStore recusou o arquivo");
            try (InputStream in = new FileInputStream(src); OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) throw new Exception("sem stream de escrita");
                copy(in, out);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Video.Media.IS_PENDING, 0);
            cr.update(uri, done, null, null);
            return uri;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "WatchMov");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("não consegui criar Movies/WatchMov");
        File out = new File(dir, name);
        try (InputStream in = new FileInputStream(src); OutputStream o = new FileOutputStream(out)) { copy(in, o); }
        MediaScannerConnection.scanFile(ctx, new String[]{ out.getAbsolutePath() }, new String[]{ "video/mp4" }, null);
        return androidx.core.content.FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", out);
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[256 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }

    /** Chooser do sistema: Web Video Cast, VLC, MX, galeria… (quem abre video/*). */
    public static void openWith(Context ctx, Uri uri, String title) {
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(uri, "video/mp4");
        if (title != null && !title.isEmpty()) view.putExtra("title", title);
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(view, "Abrir com");
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ctx.startActivity(chooser);
    }

    public static void remove(Context ctx, String key) {
        Uri uri = exported(ctx, key);
        if (uri != null) {
            try { ctx.getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
        }
        prefs(ctx).edit().remove(key).apply();
    }

    // "Duna - T1E4.mp4" — sem caracteres que o sistema de arquivos recusa.
    private static String safeName(String title, String key) {
        String base = title == null ? "" : title.trim();
        String[] p = key.split(":");
        if (p.length >= 4 && "e".equals(p[0])) base = base + " - T" + p[2] + "E" + p[3];
        base = base.replaceAll("[\\\\/:*?\"<>|]", "").replaceAll("\\s+", " ").trim();
        if (base.isEmpty()) base = "WatchMov " + key.replace(':', '-');
        return base.length() > 80 ? base.substring(0, 80).trim() : base;
    }
}
