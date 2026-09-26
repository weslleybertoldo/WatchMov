package com.weslley.watchmov;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * O MESMO APK roda no celular e na TV (Fire TV / Android TV). Aqui o app descobre, em tempo de
 * execução, se está numa TV: modo de interface "televisão" OU aparelho leanback (Fire TV e as
 * boxes Android TV têm os dois). Na TV não existe retrato, nem espelhar/compartilhar pra outra TV.
 * O JS pergunta uma vez na abertura (src/lib/device.ts).
 */
@CapacitorPlugin(name = "TvMode")
public class TvMode extends Plugin {

    private static Boolean cached;

    public static boolean isTv(Context ctx) {
        if (cached != null) return cached;
        int modo = -1;
        boolean leanback = false;
        try {
            UiModeManager ui = (UiModeManager) ctx.getSystemService(Context.UI_MODE_SERVICE);
            if (ui != null) modo = ui.getCurrentModeType();
        } catch (Exception ignored) {}
        try {
            PackageManager pm = ctx.getPackageManager();
            leanback = pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                || pm.hasSystemFeature("amazon.hardware.fire_tv");
        } catch (Exception ignored) {}
        boolean tv = modo == Configuration.UI_MODE_TYPE_TELEVISION || leanback;
        // 1 linha por processo: `adb logcat -s TvMode` mostra o que o app decidiu no aparelho.
        Log.i("TvMode", "tv=" + tv + " modo=" + modo + " leanback=" + leanback);
        cached = tv;
        return tv;
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        r.put("tv", isTv(getContext()));
        call.resolve(r);
    }
}
