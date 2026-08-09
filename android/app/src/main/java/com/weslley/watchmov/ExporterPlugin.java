package com.weslley.watchmov;

import android.Manifest;
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

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

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
 * pedaços não são um vídeo. Então o Web Video Cast/VLC nunca acham o baixado pela
 * aba "arquivos do telefone", e o único caminho era mandar a URL do proxy (que
 * depende do celular servir a stream e da TV engolir HLS — DLNA não engole).
 *
 * Como: o Transformer lê pela MESMA URL do proxy usada no download (o ProxyServer
 * serve do cache quando está baixado → funciona offline) e REMUXA pra MP4 — sem
 * re-encodar quando os codecs já cabem no container, que é o caso de H.264+AAC.
 * O ap=pt reaproveita a preferência de áudio PT do cast.
 */
@UnstableApi
@CapacitorPlugin(name = "Exporter", permissions = {
    @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
})
public class ExporterPlugin extends Plugin {

    private static final String PREFS = "wm_exports";      // key -> "<uri>|<nome>"
    private static final String TMP_DIR = "exports";

    private final Handler main = new Handler(Looper.getMainLooper());
    private Transformer transformer;    // um export por vez (remux é I/O pesado)
    private String runningKey;
    private String runningName;
    private File tmpFile;

    // ── estado persistido ──

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private JSObject exported(String key) {
        String v = prefs().getString(key, null);
        if (v == null) return null;
        int sep = v.indexOf('|');
        String uri = sep >= 0 ? v.substring(0, sep) : v;
        String name = sep >= 0 ? v.substring(sep + 1) : "";
        // O arquivo pode ter sido apagado por fora (galeria/gerenciador) — some da UI.
        if (!stillThere(Uri.parse(uri))) { prefs().edit().remove(key).apply(); return null; }
        JSObject o = new JSObject();
        o.put("key", key); o.put("state", "done"); o.put("percent", 100);
        o.put("uri", uri); o.put("name", name);
        return o;
    }

    private boolean stillThere(Uri uri) {
        try (java.io.InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            return in != null;
        } catch (Exception e) { return false; }
    }

    private void emit(String key, String state, int percent, String uri, String name, String error) {
        JSObject o = new JSObject();
        o.put("key", key); o.put("state", state); o.put("percent", percent);
        if (uri != null) o.put("uri", uri);
        if (name != null) o.put("name", name);
        if (error != null) o.put("error", error);
        notifyListeners("exportChanged", o);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray arr = new JSArray();
        for (String k : prefs().getAll().keySet()) {
            JSObject o = exported(k);
            if (o != null) arr.put(o);
        }
        if (runningKey != null) {
            JSObject o = new JSObject();
            o.put("key", runningKey); o.put("state", "exporting"); o.put("percent", -1);
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("exports", arr);
        call.resolve(ret);
    }

    // ── exportar ──

    @PluginMethod
    public void start(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) { call.reject("key obrigatória"); return; }
        if (runningKey != null) {
            call.reject(runningKey.equals(key) ? "já está exportando" : "aguarde a exportação em andamento terminar");
            return;
        }
        // Android ≤ 9 grava em Movies/ pelo sistema de arquivos → precisa da permissão.
        // Android 10+ usa MediaStore com scoped storage (não pede nada).
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePerm");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void storagePerm(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("sem permissão pra gravar em Movies");
            return;
        }
        doStart(call);
    }

    private void doStart(PluginCall call) {
        final String key = call.getString("key");
        Download d;
        try {
            d = DownloadUtil.getDownloadManager(getContext()).getDownloadIndex().getDownload(key);
        } catch (Exception e) { call.reject("não consegui ler o download: " + e.getMessage()); return; }
        if (d == null || d.state != Download.STATE_COMPLETED) {
            call.reject("baixe o vídeo por completo antes de exportar"); return;
        }
        // O MP4 sai do lado do baixado (é uma cópia remuxada) e ainda passa pelo
        // arquivo temporário → sem espaço, falharia no meio. Avisa antes.
        long need = (long) (d.getBytesDownloaded() * 2.2);
        try {
            android.os.StatFs fs = new android.os.StatFs(DownloadUtil.downloadDirFor(getContext()).getAbsolutePath());
            if (need > 0 && fs.getAvailableBytes() < need) {
                call.reject("espaço insuficiente: precisa de ~" + (need / (1024 * 1024)) + " MB livres");
                return;
            }
        } catch (Exception ignored) {}

        String title = call.getString("title", "");
        if ((title == null || title.isEmpty()) && d.request.data != null && d.request.data.length > 0) {
            try { title = new String(d.request.data); } catch (Exception ignored) {}
        }
        final String name = safeName(title, key) + ".mp4";

        ProxyServer.ensure();   // a URI do download aponta pro proxy local
        // ap=pt: mesma regra do cast — havendo faixa de áudio PT no master, o proxy
        // remove as demais, então o MP4 sai com o áudio dublado (e não o inglês, que
        // vem marcado DEFAULT no HLS). Sem faixa PT, nada muda.
        String src = d.request.uri.toString();
        if (!src.contains("&ap=")) src = src + "&ap=pt";
        String mime = d.request.mimeType != null ? d.request.mimeType : MimeTypes.APPLICATION_M3U8;

        File dir = new File(getContext().getExternalFilesDir(null), TMP_DIR);
        if (!dir.exists() && !dir.mkdirs()) { call.reject("não consegui criar a pasta temporária"); return; }
        tmpFile = new File(dir, "export.mp4");
        if (tmpFile.exists() && !tmpFile.delete()) { call.reject("sobrou um arquivo temporário travado"); return; }

        runningKey = key;
        runningName = name;
        final MediaItem item = new MediaItem.Builder().setUri(src).setMimeType(mime).build();
        final String out = tmpFile.getAbsolutePath();
        // Transformer é single-thread: criar, start, getProgress e cancel na main.
        main.post(() -> {
            try {
                transformer = new Transformer.Builder(getContext())
                    // MESMO caminho de leitura do player offline (PlayerActivity): o
                    // CacheDataSource lê os segmentos do SimpleCache pela chave
                    // normalizada e só cai no proxy/rede em cache-miss.
                    .setAssetLoaderFactory(new ExoPlayerAssetLoader.Factory(
                        getContext(),
                        new DefaultDecoderFactory(getContext()),
                        Clock.DEFAULT,
                        new DefaultMediaSourceFactory(DownloadUtil.getPlaybackCacheFactory(getContext()))))
                    .addListener(new Transformer.Listener() {
                        @Override public void onCompleted(Composition c, ExportResult r) { publishAsync(); }
                        @Override public void onError(Composition c, ExportResult r, ExportException e) { fail(friendly(e)); }
                    })
                    .build();
                transformer.start(item, out);
                emit(key, "exporting", -1, null, name, null);
                main.postDelayed(this::poll, 800);
            } catch (Throwable t) {
                fail("não consegui iniciar: " + t.getMessage());
            }
        });
        call.resolve();
    }

    private void poll() {
        if (transformer == null || runningKey == null) return;
        try {
            ProgressHolder h = new ProgressHolder();
            int st = transformer.getProgress(h);
            emit(runningKey, "exporting",
                st == Transformer.PROGRESS_STATE_AVAILABLE ? h.progress : -1, null, runningName, null);
        } catch (Throwable ignored) {}
        main.postDelayed(this::poll, 800);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            try { if (transformer != null) transformer.cancel(); } catch (Throwable ignored) {}
            String k = runningKey;
            cleanup();
            if (k != null) emit(k, "canceled", 0, null, null, null);
        });
        call.resolve();
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
            return "não consegui ler o vídeo baixado (tente abrir o app e exportar de novo)";
        }
        return msg;
    }

    private void fail(String why) {
        String k = runningKey;
        cleanup();
        if (k != null) emit(k, "failed", 0, null, null, why);
    }

    private void cleanup() {
        runningKey = null;
        runningName = null;
        transformer = null;
        if (tmpFile != null && tmpFile.exists()) { try { tmpFile.delete(); } catch (Exception ignored) {} }
        tmpFile = null;
    }

    // Publica o temporário em Movies/WatchMov (thread separada: copia arquivo grande).
    private void publishAsync() {
        final String key = runningKey, name = runningName;
        final File src = tmpFile;
        transformer = null;
        if (key == null || src == null) { cleanup(); return; }
        new Thread(() -> {
            try {
                Uri uri = publish(src, name);
                prefs().edit().putString(key, uri.toString() + "|" + name).apply();
                main.post(() -> {
                    cleanup();
                    emit(key, "done", 100, uri.toString(), name, null);
                });
            } catch (Throwable t) {
                main.post(() -> fail("não consegui salvar em Movies: " + t.getMessage()));
            }
        }).start();
    }

    private Uri publish(File src, String name) throws Exception {
        Context ctx = getContext();
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

    // ── abrir / apagar ──

    // Chooser do sistema: lista Web Video Cast, VLC, MX, galeria… (quem declara
    // ACTION_VIEW video/*). É por aqui que o vídeo baixado chega na TV.
    @PluginMethod
    public void openWith(PluginCall call) {
        JSObject e = exported(call.getString("key", ""));
        if (e == null) { call.reject("esse título ainda não foi exportado"); return; }
        try {
            Uri uri = Uri.parse(e.getString("uri"));
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, "video/mp4");
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(view, "Abrir com");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception ex) { call.reject("não consegui abrir: " + ex.getMessage()); }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "");
        JSObject e = exported(key);
        if (e != null) {
            try { getContext().getContentResolver().delete(Uri.parse(e.getString("uri")), null, null); } catch (Exception ignored) {}
        }
        prefs().edit().remove(key).apply();
        emit(key, "removed", 0, null, null, null);
        call.resolve();
    }

    // "Duna: Parte 2 - T1E4.mp4" — sem caracteres que o sistema de arquivos recusa.
    private static String safeName(String title, String key) {
        String base = title == null ? "" : title.trim();
        String[] p = key.split(":");
        if (p.length >= 4 && "e".equals(p[0])) base = base + " - T" + p[2] + "E" + p[3];
        base = base.replaceAll("[\\\\/:*?\"<>|]", "").replaceAll("\\s+", " ").trim();
        if (base.isEmpty()) base = "WatchMov " + key.replace(':', '-');
        return base.length() > 80 ? base.substring(0, 80).trim() : base;
    }
}
