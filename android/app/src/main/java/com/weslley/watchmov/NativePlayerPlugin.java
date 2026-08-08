package com.weslley.watchmov;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Abre o player nativo (ExoPlayer) pra tocar o stream capturado com Referer/UA.
 * Ao fechar, devolve a posição (ms) pra salvar o progresso.
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    private static NativePlayerPlugin instance;

    @Override
    public void load() { instance = this; }

    // Chamado pela PlayerActivity a cada ~5s → JS salva a posição (robusto).
    public static void reportProgress(String url, long positionMs, long durationMs) {
        if (instance == null || url == null) return;
        JSObject d = new JSObject();
        d.put("url", url);
        d.put("positionMs", positionMs);
        d.put("durationMs", durationMs > 0 ? durationMs : 0);
        instance.notifyListeners("playerProgress", d);
    }

    // Episódio/filme marcado como assistido (faltando 1 min pro fim, ou pelo botão).
    public static void reportWatched(boolean watched) {
        if (instance == null) return;
        JSObject d = new JSObject();
        d.put("watched", watched);
        instance.notifyListeners("playerWatched", d);
    }

    // Erro de reprodução → JS registra na tabela wm_playback_errors (aba "Bugs").
    // Motivo REAL do erro (código + causa) pra diagnosticar por que o link não toca.
    public static void reportError(String url, int code, int httpCode, String name, String cause,
                                   String mime, String referer, String title) {
        if (instance == null) return;
        JSObject d = new JSObject();
        d.put("url", url);
        d.put("code", code);
        d.put("httpCode", httpCode);   // status HTTP real (403/410/451…) ou 0
        d.put("name", name);
        d.put("cause", cause);
        d.put("mime", mime);
        d.put("referer", referer);
        d.put("title", title);
        instance.notifyListeners("playerError", d);
    }

    // "Próximo episódio" tocado COM o player aberto: pede o link do próximo ep ao JS
    // sem fechar a Activity (a sessão de espelhamento continua viva). Devolve false
    // se não há JS escutando — aí o player usa o fluxo antigo (fecha devolvendo next).
    public static boolean requestNext() {
        if (instance == null) return false;
        instance.notifyListeners("playerNext", new JSObject());
        return true;
    }

    // Resposta do JS ao playerNext: troca o episódio na Activity VIVA. Sem url = o JS
    // não achou link capturado pro próximo ep → o player cai no fluxo antigo.
    @PluginMethod
    public void loadNext(final PluginCall call) {
        PlayerActivity act = PlayerActivity.current();
        if (act == null) { call.resolve(new JSObject().put("ok", false)); return; }
        act.loadNextInPlace(
            call.getString("url"), call.getString("referer"), call.getString("mime"),
            call.getString("title"), toArray(call.getArray("urls", null)),
            toArray(call.getArray("mimes", null)), toArray(call.getArray("qualities", null)),
            Boolean.TRUE.equals(call.getBoolean("hasNext", false)), call.getString("key"),
            call.getLong("startMs", 0L),
            Boolean.TRUE.equals(call.getBoolean("offline", false)),
            Boolean.TRUE.equals(call.getBoolean("watched", false)),
            Boolean.TRUE.equals(call.getBoolean("downloaded", false)));
        call.resolve(new JSObject().put("ok", true));
    }

    // Apaga a posição salva de um episódio (chave tmdbId:type:season:ep). Usado ao
    // AVANÇAR: o ep seguinte tem que começar do zero, e versões antigas deixaram o
    // tempo do ep anterior gravado na chave do seguinte (a TV abria em 0:50:19).
    @PluginMethod
    public void clearResume(final PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) { call.resolve(); return; }
        getContext().getSharedPreferences(PlayerActivity.RESUME_PREFS, android.content.Context.MODE_PRIVATE)
            .edit().remove(key).apply();
        call.resolve();
    }

    // Resolução real que o ExoPlayer decodificou → rotula o link na lista.
    public static void reportQuality(String url, int height) {
        if (instance == null || url == null || height <= 0) return;
        JSObject d = new JSObject();
        d.put("url", url);
        d.put("quality", height + "p");
        instance.notifyListeners("playerQuality", d);
    }

    @PluginMethod
    public void play(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("no_url"); return; }
        Intent intent = new Intent(getContext(), PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url);
        intent.putExtra(PlayerActivity.EXTRA_REFERER, call.getString("referer"));
        intent.putExtra(PlayerActivity.EXTRA_UA, call.getString("ua"));
        intent.putExtra(PlayerActivity.EXTRA_MIME, call.getString("mime"));
        intent.putExtra(PlayerActivity.EXTRA_TITLE, call.getString("title"));
        intent.putExtra(PlayerActivity.EXTRA_START_MS, call.getLong("startMs", 0L));
        intent.putExtra(PlayerActivity.EXTRA_KEY, call.getString("key"));
        intent.putExtra(PlayerActivity.EXTRA_HAS_NEXT, Boolean.TRUE.equals(call.getBoolean("hasNext", false)));
        intent.putExtra(PlayerActivity.EXTRA_WATCHED, Boolean.TRUE.equals(call.getBoolean("watched", false)));
        intent.putExtra(PlayerActivity.EXTRA_OFFLINE, Boolean.TRUE.equals(call.getBoolean("offline", false)));
        intent.putExtra(PlayerActivity.EXTRA_DOWNLOADED, Boolean.TRUE.equals(call.getBoolean("downloaded", false)));
        intent.putExtra(PlayerActivity.EXTRA_URLS, toArray(call.getArray("urls", null)));
        intent.putExtra(PlayerActivity.EXTRA_MIMES, toArray(call.getArray("mimes", null)));
        intent.putExtra(PlayerActivity.EXTRA_QUALITIES, toArray(call.getArray("qualities", null)));
        startActivityForResult(call, intent, "playerResult");
    }

    private static String[] toArray(JSArray arr) {
        if (arr == null) return null;
        try {
            List<Object> list = arr.toList();
            String[] out = new String[list.size()];
            for (int i = 0; i < list.size(); i++) out[i] = list.get(i) == null ? null : String.valueOf(list.get(i));
            return out;
        } catch (Exception e) { return null; }
    }

    @ActivityCallback
    private void playerResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        JSObject res = new JSObject();
        long pos = 0;
        if (result != null && result.getData() != null) {
            pos = result.getData().getLongExtra(PlayerActivity.RESULT_POSITION, 0);
            res.put("url", result.getData().getStringExtra(PlayerActivity.RESULT_URL));
            res.put("next", result.getData().getBooleanExtra(PlayerActivity.RESULT_NEXT, false));
            res.put("server", result.getData().getBooleanExtra(PlayerActivity.RESULT_SERVER, false));
            res.put("recapture", result.getData().getBooleanExtra(PlayerActivity.RESULT_RECAPTURE, false));
            if (result.getData().hasExtra(PlayerActivity.RESULT_WATCHED))
                res.put("watched", result.getData().getBooleanExtra(PlayerActivity.RESULT_WATCHED, false));
        }
        res.put("positionMs", pos);
        call.resolve(res);
    }
}
