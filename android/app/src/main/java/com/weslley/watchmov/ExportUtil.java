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
    }

    private static final String PREFS = "wm_exports";      // key -> "<uri>|<nome>"
    private static final String TMP_DIR = "exports";

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Transformer transformer;    // um export por vez (I/O pesado)
    private static String runningKey;
    private static String runningName;
    private static File tmpFile;
    private static Cb cb;

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

    public static boolean isRunning() { return runningKey != null; }
    public static String runningKey() { return runningKey; }

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
        if (runningKey != null) { callback.failed("já tem uma exportação em andamento"); return; }
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

        File dir = new File(ctx.getExternalFilesDir(null), TMP_DIR);
        if (!dir.exists() && !dir.mkdirs()) { callback.failed("não consegui criar a pasta temporária"); return; }
        tmpFile = new File(dir, "export.mp4");
        if (tmpFile.exists() && !tmpFile.delete()) { tmpFile = null; callback.failed("sobrou um arquivo temporário travado"); return; }

        runningKey = key;
        runningName = name;
        cb = callback;
        final MediaItem item = new MediaItem.Builder().setUri(src).setMimeType(mime).build();
        final String out = tmpFile.getAbsolutePath();
        // Transformer é single-thread: criar, start, getProgress e cancel na main.
        main.post(() -> {
            try {
                transformer = new Transformer.Builder(ctx)
                    // MESMO caminho de leitura do player offline: o CacheDataSource lê os
                    // segmentos do SimpleCache pela chave normalizada e só cai no
                    // proxy/rede em cache-miss.
                    .setAssetLoaderFactory(new ExoPlayerAssetLoader.Factory(
                        ctx,
                        new DefaultDecoderFactory(ctx),
                        Clock.DEFAULT,
                        new DefaultMediaSourceFactory(DownloadUtil.getPlaybackCacheFactory(ctx))))
                    .addListener(new Transformer.Listener() {
                        @Override public void onCompleted(Composition c, ExportResult r) { publishAsync(ctx); }
                        @Override public void onError(Composition c, ExportResult r, ExportException e) { fail(friendly(e)); }
                    })
                    .build();
                transformer.start(item, out);
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
            if (cb != null) cb.progress(st == Transformer.PROGRESS_STATE_AVAILABLE ? h.progress : -1);
        } catch (Throwable ignored) {}
        main.postDelayed(ExportUtil::poll, 800);
    }

    public static void cancel() {
        main.post(() -> {
            try { if (transformer != null) transformer.cancel(); } catch (Throwable ignored) {}
            cleanup();
        });
    }

    // Erro do remux em linguagem de gente (o código cru não diz nada pro usuário).
    private static String friendly(ExportException e) {
        String msg = e != null && e.getMessage() != null ? e.getMessage() : "falha no remux";
        int code = e != null ? e.errorCode : 0;
        if (code == ExportException.ERROR_CODE_MUXING_FAILED
            || code == ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED
            || code == ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED) {
            return "o formato desse vídeo não cabe num MP4 (codec incomum)";
        }
        if (code == ExportException.ERROR_CODE_IO_FILE_NOT_FOUND
            || code == ExportException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
            || code == ExportException.ERROR_CODE_IO_BAD_HTTP_STATUS) {
            return "não consegui ler o vídeo baixado (abra o app e tente de novo)";
        }
        return msg;
    }

    private static void fail(String why) {
        Cb c = cb;
        cleanup();
        if (c != null) c.failed(why);
    }

    private static void cleanup() {
        runningKey = null;
        runningName = null;
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
        if (key == null || src == null) { cleanup(); return; }
        new Thread(() -> {
            try {
                Uri uri = publish(ctx, src, name);
                prefs(ctx).edit().putString(key, uri.toString() + "|" + name).apply();
                main.post(() -> {
                    cleanup();
                    if (c != null) c.done(uri, name);
                });
            } catch (Throwable t) {
                main.post(() -> {
                    cleanup();
                    if (c != null) c.failed("não consegui salvar em Movies: " + t.getMessage());
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
