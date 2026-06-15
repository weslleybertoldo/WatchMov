package com.weslley.watchmov;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Controle de tela do player de vídeo:
 * - enter(): paisagem + tela cheia imersiva edge-to-edge (vídeo entra SOB o
 *   entalhe/notch, sem faixa cinza; oculta status/nav bar).
 * - exit(): restaura barras + sem cutout + volta pra retrato (evita faixa cinza
 *   lateral residual depois que o vídeo termina).
 * - toggleOrientation(): alterna retrato/paisagem manualmente ("deitar a tela").
 */
@CapacitorPlugin(name = "Immersive")
public class ImmersivePlugin extends Plugin {

    @PluginMethod
    public void enter(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.reject("no_activity"); return; }
        a.runOnUiThread(() -> {
            Window w = a.getWindow();
            WindowCompat.setDecorFitsSystemWindows(w, false); // edge-to-edge: vídeo ocupa tudo
            a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            c.hide(WindowInsetsCompat.Type.systemBars());
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            setCutout(a, true);
        });
        call.resolve();
    }

    @PluginMethod
    public void exit(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.reject("no_activity"); return; }
        a.runOnUiThread(() -> {
            Window w = a.getWindow();
            WindowCompat.setDecorFitsSystemWindows(w, true);
            a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            c.show(WindowInsetsCompat.Type.systemBars());
            setCutout(a, false);
        });
        call.resolve();
    }

    @PluginMethod
    public void toggleOrientation(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.reject("no_activity"); return; }
        a.runOnUiThread(() -> {
            int cur = a.getResources().getConfiguration().orientation;
            a.setRequestedOrientation(cur == Configuration.ORIENTATION_LANDSCAPE
                ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        });
        call.resolve();
    }

    private void setCutout(Activity a, boolean useCutout) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = a.getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = useCutout
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            a.getWindow().setAttributes(lp);
        }
    }
}
