package com.weslley.watchmov;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.Iterator;

/**
 * Handoff pro player externo (estilo Smart Play: AppUtils.startExternalUrl). Manda
 * a URL do stream + headers (Referer/User-Agent) + legendas pro Web Video Cast /
 * VLC / MX / XCast via Intent ACTION_VIEW. Esses apps já castam pra TV melhor que
 * DLNA/Chromecast puro (usam o próprio motor). Requer o app instalado.
 */
@CapacitorPlugin(name = "ExternalCast")
public class ExternalCastPlugin extends Plugin {

    // Pacotes conhecidos (também declarados em <queries> no AndroidManifest).
    static final String[][] APPS = {
        {"wvc", "com.instantbits.cast.webvideo", "Web Video Cast"},
        {"wvc2", "castwebbrowsertotv.castwebvideo.webvideocaster", "Web Video Cast"},
        {"xcast", "cast.video.screenmirroring.casttotv", "XCast"},
        {"vlc", "org.videolan.vlc", "VLC"},
        {"mx", "com.mxtech.videoplayer.ad", "MX Player"},
        {"mxpro", "com.mxtech.videoplayer.pro", "MX Player Pro"},
    };

    // Lista os players externos INSTALADOS (id, pkg, name).
    @PluginMethod
    public void listApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSArray out = new JSArray();
        for (String[] a : APPS) {
            if (isInstalled(pm, a[1])) {
                JSObject o = new JSObject();
                o.put("id", a[0]); o.put("pkg", a[1]); o.put("name", a[2]);
                out.put(o);
            }
        }
        JSObject r = new JSObject();
        r.put("apps", out);
        call.resolve(r);
    }

    // Abre a URL do stream no app externo escolhido.
    @PluginMethod
    public void castToApp(PluginCall call) {
        String pkg = call.getString("pkg");
        String url = call.getString("url");
        String mime = call.getString("mime", "video/*");
        String title = call.getString("title", "");
        String referer = call.getString("referer");
        String ua = call.getString("ua");
        if (pkg == null || url == null) { call.reject("pkg/url faltando"); return; }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setPackage(pkg);
            intent.setDataAndType(Uri.parse(url), mime != null ? mime : "video/*");
            if (!title.isEmpty()) intent.putExtra("title", title);
            intent.putExtra("secure_uri", true);

            Bundle headers = new Bundle();
            if (referer != null && !referer.isEmpty()) headers.putString("Referer", referer);
            if (ua != null && !ua.isEmpty()) headers.putString("User-Agent", ua);
            // headers extra passados pelo JS (objeto {k:v})
            JSObject extra = call.getObject("headers");
            if (extra != null) {
                Iterator<String> it = extra.keys();
                while (it.hasNext()) { String k = it.next(); headers.putString(k, extra.getString(k)); }
            }
            if (!headers.isEmpty()) {
                intent.putExtra("headers", headers);
                intent.putExtra("com.android.browser.headers", headers);
                intent.putExtra("android.media.intent.extra.HTTP_HEADERS", headers);
            }
            // legendas (array de urls)
            JSArray subs = call.getArray("subs");
            if (subs != null && subs.length() > 0) {
                Uri[] uris = new Uri[subs.length()];
                for (int i = 0; i < subs.length(); i++) uris[i] = Uri.parse(subs.getString(i));
                intent.putExtra("subs", uris);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Não foi possível abrir: " + e.getMessage());
        }
    }

    private boolean isInstalled(PackageManager pm, String pkg) {
        try { pm.getPackageInfo(pkg, 0); return true; } catch (PackageManager.NameNotFoundException e) { return false; }
    }
}
