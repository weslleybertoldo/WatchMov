package com.weslley.watchmov;

import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Abre o seletor de transmissão/espelhamento de tela do sistema Android.
 * O usuário escolhe a TV (LG/Samsung/Chromecast via Miracast/Smart View) e a
 * tela inteira — incluindo o player — é espelhada. Não há como o app enviar só
 * o vídeo (ele roda em iframe cross-origin), então espelhamento de tela do SO é
 * o caminho real. Tenta a tela de Cast; se indisponível, cai pra Display/Wireless.
 */
@CapacitorPlugin(name = "ScreenCast")
public class ScreenCastPlugin extends Plugin {

    @PluginMethod()
    public void openCast(final PluginCall call) {
        // Ordem: espelhamento sem-fio (Miracast/Smart View — pega TV LG/Samsung comum)
        // ANTES do Cast (Chromecast, que só lista dispositivo Google). Fallback = Display.
        if (tryStart("android.settings.WIFI_DISPLAY_SETTINGS")
                || tryStart("android.settings.CAST_SETTINGS")
                || tryStart(Settings.ACTION_DISPLAY_SETTINGS)) {
            call.resolve();
        } else {
            call.reject("no_cast_settings");
        }
    }

    private boolean tryStart(String action) {
        try {
            Intent intent = new Intent(action);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
