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
 * Abre o WebView VISÍVEL de captura (SnifferActivity). O usuário vê a página do
 * servidor e interage (play/captcha); ao detectar o stream, a Activity devolve a
 * URL e o app troca pro player próprio. Cancelar = o app segue no iframe.
 */
@CapacitorPlugin(name = "StreamSniffer")
public class StreamSnifferPlugin extends Plugin {

    @PluginMethod
    public void sniff(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("no_url"); return; }
        Intent intent = new Intent(getContext(), SnifferActivity.class);
        intent.putExtra(SnifferActivity.EXTRA_URL, url);
        startActivityForResult(call, intent, "sniffResult");
    }

    @ActivityCallback
    private void sniffResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        JSObject res = new JSObject();
        if (result != null && result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Intent data = result.getData();
            String url = data.getStringExtra(SnifferActivity.RESULT_URL);
            if (url != null) {
                res.put("url", url);
                res.put("mime", data.getStringExtra(SnifferActivity.RESULT_MIME));
                String ref = data.getStringExtra(SnifferActivity.RESULT_REFERER);
                if (ref != null) res.put("referer", ref);
            }
        }
        // Sem url → cancelado/sem captura; o JS trata como "usar servidor".
        call.resolve(res);
    }

    @PluginMethod
    public void cancel(final PluginCall call) {
        call.resolve();
    }
}
