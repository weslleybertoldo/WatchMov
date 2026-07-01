package com.weslley.watchmov;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Abre o player nativo (ExoPlayer) pra tocar o stream capturado com Referer/UA.
 * Ao fechar, devolve a posição (ms) pra salvar o progresso.
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

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
        startActivityForResult(call, intent, "playerResult");
    }

    @ActivityCallback
    private void playerResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        JSObject res = new JSObject();
        long pos = 0;
        if (result != null && result.getData() != null) {
            pos = result.getData().getLongExtra(PlayerActivity.RESULT_POSITION, 0);
        }
        res.put("positionMs", pos);
        call.resolve(res);
    }
}
