package com.weslley.watchmov;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Controle de tela do player de vídeo:
 * - enter(): paisagem + modo imersivo (oculta status bar, nav bar e usa o entalhe/
 *   notch — só o vídeo aparente).
 * - exit(): restaura orientação livre + barras do sistema.
 * - toggleOrientation(): alterna retrato/paisagem manualmente ("deitar a tela").
 */
@CapacitorPlugin(name = "Immersive")
public class ImmersivePlugin extends Plugin {

    @PluginMethod
    public void enter(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.reject("no_activity"); return; }
        a.runOnUiThread(() -> {
            a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            hideSystemUi(a);
            setCutout(a, true);
        });
        call.resolve();
    }

    @PluginMethod
    public void exit(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.reject("no_activity"); return; }
        a.runOnUiThread(() -> {
            a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            showSystemUi(a);
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

    private void hideSystemUi(Activity a) {
        a.getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private void showSystemUi(Activity a) {
        a.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
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
