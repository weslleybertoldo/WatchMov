package com.weslley.watchmov;

import android.Manifest;
import android.net.Uri;
import android.os.Build;

import androidx.media3.common.util.UnstableApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Opção "baixar já em MP4": em vez de guardar o HLS no cache do Media3 (que só o
 * próprio app lê), grava um MP4 em Movies/WatchMov enquanto baixa. Some a retomada
 * automática (o MP4 só fecha no fim), ganha-se um arquivo que qualquer app abre —
 * Web Video Cast, VLC, galeria — e que a TV toca.
 *
 * O download normal (DownloaderPlugin) e o botão de converter do player continuam
 * exatamente como estavam; isto é só um caminho a mais.
 */
@UnstableApi
@CapacitorPlugin(name = "Mp4Download", permissions = {
    @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
})
public class Mp4DownloadPlugin extends Plugin {

    private void emit(String key, String state, int percent, String name, String uri, String error) {
        emit(key, state, percent, name, uri, error, null);
    }

    // mode: "download" (baixa já em MP4, nada no aparelho ainda) x "convert"
    // (o vídeo JÁ está baixado e vira MP4) — a central separa em abas diferentes.
    private void emit(String key, String state, int percent, String name, String uri, String error, String mode) {
        emit(key, state, percent, name, uri, error, mode, 0);
    }

    private void emit(String key, String state, int percent, String name, String uri, String error, String mode, int position) {
        JSObject o = new JSObject();
        o.put("key", key); o.put("state", state); o.put("percent", percent);
        if (mode != null) o.put("mode", mode);
        if (position > 0) o.put("position", position);   // lugar na fila (1º, 2º…)
        if (name != null) o.put("name", name);
        if (uri != null) o.put("uri", uri);
        if (error != null) o.put("error", error);
        notifyListeners("mp4Changed", o);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String key = call.getString("key");
        String url = call.getString("url");
        if (key == null || url == null) { call.reject("key e url obrigatórios"); return; }
        // Android ≤ 9 grava em Movies/ pelo sistema de arquivos → precisa da permissão.
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
        // Já existe MP4 desse episódio? Não baixa de novo.
        Uri ready = ExportUtil.exported(getContext(), key);
        if (ready != null) {
            emit(key, "done", 100, null, ready.toString(), null);
            call.resolve();
            return;
        }
        ExportUtil.startFromUrl(getContext(), key,
            call.getString("url"), call.getString("referer"),
            call.getString("mime"), call.getString("title", ""),
            new ExportUtil.Cb() {
                @Override public void progress(int p) { emit(key, "downloading", p, ExportUtil.runningName(), null, null, "download"); }
                @Override public void queued(int pos, String name) { emit(key, "queued", -1, name, null, null, "download", pos); }
                @Override public void done(Uri uri, String name) { emit(key, "done", 100, name, uri.toString(), null); }
                @Override public void failed(String why) { emit(key, "failed", 0, null, null, why); }
            });
        call.resolve();
    }

    // Todas as chaves que já viraram MP4 + a que está convertendo agora.
    @PluginMethod
    public void list(PluginCall call) {
        com.getcapacitor.JSArray arr = new com.getcapacitor.JSArray();
        for (String k : ExportUtil.exportedKeys(getContext())) arr.put(k);
        JSObject ret = new JSObject();
        ret.put("keys", arr);
        if (ExportUtil.runningKey() != null) ret.put("running", ExportUtil.runningKey());
        com.getcapacitor.JSArray q = new com.getcapacitor.JSArray();
        for (String k : ExportUtil.queuedKeys()) q.put(k);
        ret.put("queued", q);
        call.resolve(ret);
    }

    // Converte um título JÁ BAIXADO (cache do Media3) pra MP4 — mesmo caminho do
    // botão do player, disponível também na aba Download.
    @PluginMethod
    public void convert(PluginCall call) {
        final String key = call.getString("key");
        if (key == null) { call.reject("key obrigatória"); return; }
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermConvert");
            return;
        }
        doConvert(call, key);
    }

    @PermissionCallback
    private void storagePermConvert(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("sem permissão pra gravar em Movies");
            return;
        }
        doConvert(call, call.getString("key"));
    }

    private void doConvert(PluginCall call, final String key) {
        Uri ready = ExportUtil.exported(getContext(), key);
        if (ready != null) { emit(key, "done", 100, null, ready.toString(), null); call.resolve(); return; }
        ExportUtil.start(getContext(), key, call.getString("title", ""), new ExportUtil.Cb() {
            @Override public void progress(int p) { emit(key, "converting", p, ExportUtil.runningName(), null, null, "convert"); }
            @Override public void queued(int pos, String name) { emit(key, "queued", -1, name, null, null, "convert", pos); }
            @Override public void done(Uri uri, String name) { emit(key, "done", 100, name, uri.toString(), null, "convert"); }
            @Override public void failed(String why) { emit(key, "failed", 0, null, null, why, "convert"); }
        });
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String key = call.getString("key");
        String target = key != null ? key : ExportUtil.runningKey();
        ExportUtil.cancel(key);
        if (target != null) emit(target, "canceled", 0, null, null, null);
        call.resolve();
    }

    // Já existe MP4 pra essa chave? (o botão mostra "pronto" em vez de baixar de novo)
    @PluginMethod
    public void status(PluginCall call) {
        String key = call.getString("key", "");
        Uri uri = ExportUtil.exported(getContext(), key);
        JSObject ret = new JSObject();
        ret.put("done", uri != null);
        if (uri != null) ret.put("uri", uri.toString());
        ret.put("running", key != null && key.equals(ExportUtil.runningKey()));
        call.resolve(ret);
    }

    // Abre o chooser (Web Video Cast, VLC, MX, galeria) no MP4 dessa chave.
    @PluginMethod
    public void openWith(PluginCall call) {
        String key = call.getString("key", "");
        Uri uri = ExportUtil.exported(getContext(), key);
        if (uri == null) { call.reject("esse episódio ainda não tem MP4"); return; }
        try {
            ExportUtil.openWith(getContext(), uri, call.getString("title", ""));
            call.resolve();
        } catch (Exception e) { call.reject("não consegui abrir: " + e.getMessage()); }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "");
        ExportUtil.remove(getContext(), key);
        emit(key, "removed", 0, null, null, null);
        call.resolve();
    }
}
