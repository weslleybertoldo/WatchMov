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
    public static void reportProgress(String url, long positionMs) {
        if (instance == null || url == null) return;
        JSObject d = new JSObject();
        d.put("url", url);
        d.put("positionMs", positionMs);
        instance.notifyListeners("playerProgress", d);
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
        intent.putExtra(PlayerActivity.EXTRA_URLS, toArray(call.getArray("urls", null)));
        intent.putExtra(PlayerActivity.EXTRA_MIMES, toArray(call.getArray("mimes", null)));
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
        }
        res.put("positionMs", pos);
        call.resolve(res);
    }
}
