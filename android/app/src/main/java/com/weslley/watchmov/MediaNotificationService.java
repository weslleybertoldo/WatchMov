package com.weslley.watchmov;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Notificação de mídia do player (barra de notificação, tela bloqueada e controles
 * de mídia do sistema): "<título>" + "Reproduzindo na TV (DLNA)"/"Reproduzindo",
 * botão ⏯ sempre e ⏭ (próximo episódio) só quando é série. Vale pro player LOCAL e
 * pro ESPELHAMENTO (DLNA/Chromecast) — o caso principal é controlar a TV com o
 * celular bloqueado ou em outro app.
 *
 * É um foreground service (mediaPlayback) por dois motivos: manter o processo vivo
 * enquanto o espelhamento roda em background (poll/vigia do DLNA moram na
 * PlayerActivity) e poder mostrar controles na tela bloqueada. Os toques chegam por
 * DOIS caminhos, ambos desaguando no Controller (a PlayerActivity viva):
 *  • Android ≤ 12: ações da própria notificação (PendingIntent → onStartCommand);
 *  • Android 13+: o sistema monta os controles a partir do PlaybackState da
 *    MediaSession (ignora as ações da notificação) → MediaSessionCompat.Callback.
 * Quem muda o estado (pausou, trocou de episódio, posição) chama update(); a
 * notificação só é re-postada quando algo VISÍVEL muda — a posição vai só pra
 * sessão (barra de progresso do Android 13+), sem piscar a notificação.
 */
public class MediaNotificationService extends Service {

    public static final String CHANNEL_ID = "watchmov_playback";
    public static final int NOTIF_ID = 4671;
    private static final String ACT_SHOW = "com.weslley.watchmov.media.SHOW";
    private static final String ACT_TOGGLE = "com.weslley.watchmov.media.TOGGLE";
    private static final String ACT_NEXT = "com.weslley.watchmov.media.NEXT";

    /** Quem executa os comandos (a PlayerActivity viva). Tudo chamado na UI thread. */
    public interface Controller {
        void onNotifSetPlaying(boolean play);
        void onNotifNext();
        void onNotifSeekTo(long positionMs);
    }

    private static volatile Controller controller;
    private static volatile MediaNotificationService instance;
    // Estado exibido — a Activity escreve via update(), o serviço só lê.
    private static volatile String sTitle = "WatchMov", sSub = "";
    private static volatile boolean sPlaying = false, sHasNext = false, sCast = false;
    private static volatile long sPos = 0, sDur = 0;

    private MediaSessionCompat session;
    private String shownKey = null;   // último "visual" postado (título/sub/estado/ações)

    public static void setController(Controller c) { controller = c; }
    public static void clearController(Controller c) { if (controller == c) controller = null; }

    /**
     * Mostra/atualiza a notificação. Na 1ª vez sobe o serviço (precisa do app em
     * primeiro plano — é o caso: só a PlayerActivity chama). Depois, atualiza direto.
     */
    public static void update(Context ctx, String title, String sub, boolean playing, boolean hasNext,
                              boolean cast, long posMs, long durMs) {
        sTitle = title != null && !title.isEmpty() ? title : "WatchMov";
        sSub = sub != null ? sub : "";
        sPlaying = playing; sHasNext = hasNext; sCast = cast;
        sPos = Math.max(0, posMs); sDur = Math.max(0, durMs);
        MediaNotificationService svc = instance;
        if (svc != null) { svc.render(); return; }
        try {
            Intent i = new Intent(ctx, MediaNotificationService.class).setAction(ACT_SHOW);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        } catch (Exception ignored) {}   // app em background sem poder subir FGS → fica sem notificação, sem crash
    }

    public static void hide(Context ctx) {
        try { ctx.stopService(new Intent(ctx, MediaNotificationService.class)); } catch (Exception ignored) {}
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        ensureChannel(this);
        session = new MediaSessionCompat(this, "WatchMov");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { Controller c = controller; if (c != null) c.onNotifSetPlaying(true); }
            @Override public void onPause() { Controller c = controller; if (c != null) c.onNotifSetPlaying(false); }
            @Override public void onStop() { Controller c = controller; if (c != null) c.onNotifSetPlaying(false); }
            @Override public void onSkipToNext() { Controller c = controller; if (c != null && sHasNext) c.onNotifNext(); }
            @Override public void onSeekTo(long pos) { Controller c = controller; if (c != null) c.onNotifSeekTo(pos); }
        });
        try { session.setSessionActivity(openPlayerIntent()); } catch (Exception ignored) {}
        session.setActive(true);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent != null ? intent.getAction() : null;
        Controller c = controller;
        if (ACT_TOGGLE.equals(act)) { if (c != null) c.onNotifSetPlaying(!sPlaying); }
        else if (ACT_NEXT.equals(act)) { if (c != null && sHasNext) c.onNotifNext(); }
        render();   // SEMPRE: startForegroundService exige startForeground em até 5s
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        instance = null;
        shownKey = null;
        try { if (session != null) { session.setActive(false); session.release(); } } catch (Exception ignored) {}
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        } catch (Exception ignored) {}
        try { NotificationManagerCompat.from(this).cancel(NOTIF_ID); } catch (Exception ignored) {}
        super.onDestroy();
    }

    // Sessão (metadados + estado + ações permitidas) e, se algo visível mudou, a notificação.
    private void render() {
        try {
            session.setMetadata(new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, sTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, sTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, sSub)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, sSub)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, sDur > 0 ? sDur : -1)
                .build());
            long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_STOP
                | PlaybackStateCompat.ACTION_SEEK_TO;
            if (sHasNext) actions |= PlaybackStateCompat.ACTION_SKIP_TO_NEXT;   // filme = só ⏯
            session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(sPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                          sPos, sPlaying ? 1f : 0f)
                .build());
        } catch (Exception ignored) {}
        String key = sTitle + "|" + sSub + "|" + sPlaying + "|" + sHasNext + "|" + sCast;
        boolean first = shownKey == null;
        if (!first && key.equals(shownKey)) return;   // só a posição mudou → já foi pra sessão
        shownKey = key;
        Notification n;
        try { n = build(); } catch (Exception e) { n = minimal(); }
        try {
            if (first) {
                if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                else startForeground(NOTIF_ID, n);
            } else {
                NotificationManagerCompat.from(this).notify(NOTIF_ID, n);
            }
        } catch (Exception e) {
            // Sem permissão de FGS/notificação: não derruba o player — a Activity
            // segue funcionando normalmente, só sem a notificação.
            shownKey = null;
        }
    }

    private PendingIntent openPlayerIntent() {
        // Volta pro player que JÁ está aberto (SINGLE_TOP entrega onNewIntent na Activity
        // viva em vez de criar outra — que fecharia na hora por não ter URL).
        Intent open = new Intent(this, PlayerActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent svcPi(int code, String action) {
        Intent i = new Intent(this, MediaNotificationService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification build() {
        androidx.media.app.NotificationCompat.MediaStyle style = new androidx.media.app.NotificationCompat.MediaStyle()
            .setMediaSession(session.getSessionToken());
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(sCast ? R.drawable.ic_cast : android.R.drawable.ic_media_play)
            .setContentTitle(sTitle)
            .setContentText(sSub)
            .setContentIntent(openPlayerIntent())
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)   // aparece na tela bloqueada
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false);
        // Ações (Android ≤ 12 usa estas; 13+ deriva do PlaybackState acima).
        b.addAction(new NotificationCompat.Action(
            sPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            sPlaying ? "Pausar" : "Continuar", svcPi(2, ACT_TOGGLE)));
        if (sHasNext) {
            b.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next, "Próximo episódio", svcPi(3, ACT_NEXT)));
            style.setShowActionsInCompactView(0, 1);
        } else {
            style.setShowActionsInCompactView(0);
        }
        b.setStyle(style);
        return b.build();
    }

    // Fallback se o build completo falhar por algum motivo: garante o startForeground.
    private Notification minimal() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(sTitle).setContentText(sSub)
            .setOngoing(true).setSilent(true).setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, ctx.getString(R.string.playback_channel_name), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            nm.createNotificationChannel(ch);
        } catch (Exception ignored) {}
    }
}
