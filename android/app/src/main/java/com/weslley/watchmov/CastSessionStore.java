package com.weslley.watchmov;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Sessão de espelhamento PERSISTIDA (SharedPreferences). Os estáticos da PlayerActivity
 * (activeCastMode/activeDlnaCtrl/…) morrem com o processo; isto sobrevive — é o que
 * permite (a) o MediaNotificationService seguir controlando a TV com o app fechado e
 * (b) o app, ao reabrir num processo NOVO, descobrir que a TV ainda está tocando e
 * reassumir (atalho "espelhando na TV" + player com tempo e controles funcionando).
 * Só strings/ints/booleans — sem JSON.
 */
final class CastSessionStore {
    private static final String PREFS = "wm_cast_session";

    static final class Session {
        int mode;              // PlayerActivity.CAST_DLNA / CAST_CC
        String dlnaCtrl;       // controlURL do AVTransport (DLNA) — null no Chromecast
        String renderCtrl;     // controlURL do RenderingControl (volume) — pode ser null
        String url;            // URL da mídia (provedor ou content://) — o proxy é reconstruído a partir dela
        String referer, mime, title;
        String key;            // tmdbId:type:season:ep — o atalho do app usa pra reabrir o mesmo episódio
        String tvIp;           // host do controlURL (filtra o tráfego da TV no proxy)
        int qualityH;          // altura escolhida pro cast (0 = maior bandwidth)
        boolean hasNext;
        boolean offline, downloaded;   // reabrir o player igual ao original (cache/rótulo "Baixado")
        long savedAt;

        @Override public String toString() {
            return "mode=" + mode + " key=" + key + " title=" + title + " ctrl=" + (dlnaCtrl != null)
                + " render=" + (renderCtrl != null) + " q=" + qualityH + " url=" + url;
        }
    }

    private CastSessionStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context ctx, Session s) {
        if (ctx == null || s == null || s.mode == PlayerActivity.CAST_NONE || s.url == null) return;
        SharedPreferences.Editor e = prefs(ctx).edit().clear();
        e.putInt("mode", s.mode);
        put(e, "dlnaCtrl", s.dlnaCtrl); put(e, "renderCtrl", s.renderCtrl);
        put(e, "url", s.url); put(e, "referer", s.referer); put(e, "mime", s.mime);
        put(e, "title", s.title); put(e, "key", s.key); put(e, "tvIp", s.tvIp);
        e.putInt("qualityH", s.qualityH);
        e.putBoolean("hasNext", s.hasNext);
        e.putBoolean("offline", s.offline); e.putBoolean("downloaded", s.downloaded);
        e.putLong("savedAt", System.currentTimeMillis());
        e.apply();
    }

    /** null se não há sessão gravada (ou se é DLNA sem controlURL — não dá pra controlar). */
    static Session load(Context ctx) {
        if (ctx == null) return null;
        SharedPreferences p = prefs(ctx);
        int mode = p.getInt("mode", PlayerActivity.CAST_NONE);
        String url = p.getString("url", null);
        if (mode == PlayerActivity.CAST_NONE || url == null) return null;
        Session s = new Session();
        s.mode = mode; s.url = url;
        s.dlnaCtrl = p.getString("dlnaCtrl", null); s.renderCtrl = p.getString("renderCtrl", null);
        s.referer = p.getString("referer", null); s.mime = p.getString("mime", null);
        s.title = p.getString("title", null); s.key = p.getString("key", null); s.tvIp = p.getString("tvIp", null);
        s.qualityH = p.getInt("qualityH", 0);
        s.hasNext = p.getBoolean("hasNext", false);
        s.offline = p.getBoolean("offline", false); s.downloaded = p.getBoolean("downloaded", false);
        s.savedAt = p.getLong("savedAt", 0);
        if (mode == PlayerActivity.CAST_DLNA && s.dlnaCtrl == null) return null;
        return s;
    }

    static void clear(Context ctx) {
        if (ctx == null) return;
        prefs(ctx).edit().clear().apply();
    }

    private static void put(SharedPreferences.Editor e, String k, String v) {
        if (v != null) e.putString(k, v); else e.remove(k);
    }
}
