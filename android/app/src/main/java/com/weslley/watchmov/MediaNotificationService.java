package com.weslley.watchmov;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Notificação de mídia do player (barra de notificação, tela bloqueada e controles
 * de mídia do sistema): "<título>" + "Reproduzindo na TV (DLNA)"/"Reproduzindo",
 * botão ⏯ sempre, ⏭ (próximo episódio) só quando é série e "Parar" quando espelhando.
 * Vale pro player LOCAL e pro ESPELHAMENTO (DLNA/Chromecast) — o caso principal é
 * controlar a TV com o celular bloqueado ou em outro app.
 *
 * É um foreground service (mediaPlayback) por dois motivos: manter o processo vivo
 * enquanto o espelhamento roda em background e poder mostrar controles na tela
 * bloqueada. Os toques chegam por DOIS caminhos, ambos desaguando no Controller
 * (a PlayerActivity viva) — ou, sem Activity, no modo HEADLESS (abaixo):
 *  • Android ≤ 12: ações da própria notificação (PendingIntent → onStartCommand);
 *  • Android 13+: o sistema monta os controles a partir do PlaybackState da
 *    MediaSession (ignora as ações da notificação) → MediaSessionCompat.Callback.
 * Quem muda o estado (pausou, trocou de episódio, posição) chama update(); a
 * notificação só é re-postada quando algo VISÍVEL muda — a posição vai só pra
 * sessão (barra de progresso do Android 13+), sem piscar a notificação.
 *
 * MODO HEADLESS (espelhamento com o app FECHADO): a TV puxa o vídeo do ProxyServer que
 * roda NESTE processo — se o processo morre, a TV para no fim do buffer. Quando a
 * PlayerActivity fecha com a TV tocando, o serviço assume sozinho (goHeadless): segue em
 * foreground (stopWithTask=false no manifest), segura Wi-Fi/CPU (WifiLock +
 * PARTIAL_WAKE_LOCK), faz o poll da TV (tempo/estado) e responde ⏯/Parar/seek direto no
 * DLNA/Chromecast. A sessão fica gravada em CastSessionStore; num processo NOVO,
 * restoreIfAlive() pergunta à TV e, se ela ainda está na nossa mídia, repõe os estáticos
 * da PlayerActivity e religa o serviço — o app volta a mostrar "espelhando na TV" e o
 * player, ao abrir, reassume tempo e controles. ⏭ com o app fechado fica pra fase 2
 * (o link do próximo episódio vem do JS).
 */
public class MediaNotificationService extends Service {

    public static final String CHANNEL_ID = "watchmov_playback";
    public static final int NOTIF_ID = 4671;
    private static final String ACT_SHOW = "com.weslley.watchmov.media.SHOW";
    private static final String ACT_TOGGLE = "com.weslley.watchmov.media.TOGGLE";
    private static final String ACT_NEXT = "com.weslley.watchmov.media.NEXT";
    private static final String ACT_STOP = "com.weslley.watchmov.media.STOP";
    private static final String ACT_HEADLESS = "com.weslley.watchmov.media.HEADLESS";
    private static final long HEADLESS_POLL_MS = 3000;
    // Polls seguidos sem a TV responder/na nossa mídia até dar a sessão por encerrada
    // (~15 s): cobre TV lenta/TRANSITIONING sem segurar uma notificação fantasma.
    private static final int HEADLESS_FAILS_TO_END = 5;
    // Chromecast: o SDK retoma a sessão sozinho ao abrir o processo, mas leva alguns
    // segundos — até este teto não apagamos a sessão gravada só porque ainda não voltou.
    private static final long CC_RESUME_GRACE_MS = 30000;
    private static final long PROCESS_START = SystemClock.elapsedRealtime();

    /** Quem executa os comandos (a PlayerActivity viva). Tudo chamado na UI thread. */
    public interface Controller {
        void onNotifSetPlaying(boolean play);
        void onNotifNext();
        void onNotifSeekTo(long positionMs);
        void onNotifStop();
    }

    /** Resultado do restoreIfAlive (pode vir de outra thread). */
    public interface RestoreCallback { void done(boolean restored); }

    private static volatile Controller controller;
    private static volatile MediaNotificationService instance;
    // Estado exibido — a Activity escreve via update(), o serviço só lê (headless: o poll escreve).
    private static volatile String sTitle = "WatchMov", sSub = "";
    private static volatile boolean sPlaying = false, sHasNext = false, sCast = false;
    private static volatile long sPos = 0, sDur = 0;
    // Sessão de cast que o serviço controla SOZINHO (PlayerActivity morta). null = modo normal.
    private static volatile CastSessionStore.Session headless;
    private static volatile boolean restoring = false;

    private MediaSessionCompat session;
    private String shownKey = null;   // último "visual" postado (título/sub/estado/ações)
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WifiManager.WifiLock wifiLock;
    private PowerManager.WakeLock wakeLock;
    private boolean polling = false;
    private int pollGen = 0;          // invalida ticks em voo quando o poll para/reinicia
    private int pollFails = 0;

    public static void setController(Controller c) {
        controller = c;
        if (c != null) {
            // A Activity voltou: ela assume o poll/vigia da TV; o serviço para o dele. A
            // sessão persistida continua — só a Activity apaga (stopCasting).
            headless = null;
            final MediaNotificationService svc = instance;
            if (svc != null) svc.handler.post(svc::stopPoll);
        }
    }
    public static void clearController(Controller c) { if (controller == c) controller = null; }
    public static boolean isHeadless() { return headless != null; }

    /**
     * Mostra/atualiza a notificação. Na 1ª vez sobe o serviço (precisa do app em
     * primeiro plano — é o caso: só a PlayerActivity chama). Depois, atualiza direto.
     */
    public static void update(Context ctx, String title, String sub, boolean playing, boolean hasNext,
                              boolean cast, long posMs, long durMs) {
        headless = null;   // quem chama é a Activity viva → modo normal
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
        headless = null;
        try { ctx.stopService(new Intent(ctx, MediaNotificationService.class)); } catch (Exception ignored) {}
    }

    /**
     * PlayerActivity fechou COM a TV tocando: o serviço segue sozinho — mantém o processo
     * (e o ProxyServer) vivo, segura Wi-Fi/CPU, faz o poll da TV e responde ⏯/Parar.
     */
    public static void goHeadless(Context ctx, CastSessionStore.Session s) {
        if (s == null) { hide(ctx); return; }
        headless = s;
        sTitle = s.title != null && !s.title.isEmpty() ? s.title : "WatchMov";
        sCast = true;
        sHasNext = false;   // ⏭ com o app fechado = fase 2 (o link do próximo vem do JS)
        sSub = (sPlaying ? "Reproduzindo " : "Pausado ") + onde(s.mode);
        try { ProxyServer.ensure(ctx.getApplicationContext()); } catch (Exception ignored) {}
        final MediaNotificationService svc = instance;
        if (svc != null) { svc.handler.post(svc::startHeadless); return; }
        try {
            Intent i = new Intent(ctx, MediaNotificationService.class).setAction(ACT_HEADLESS);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        } catch (Exception e) { headless = null; }
    }

    /**
     * Processo NOVO (app reaberto depois de morrer com a TV tocando): se há sessão gravada
     * e a TV ainda está na NOSSA mídia, repõe os estáticos da PlayerActivity e religa o
     * serviço headless. Idempotente; a leitura da TV roda em thread própria (SOAP).
     * `cb` recebe true se restaurou (chamado na UI thread).
     */
    public static void restoreIfAlive(final Context ctx, final RestoreCallback cb) {
        if (PlayerActivity.isCasting()) { if (cb != null) cb.done(true); return; }
        final Context app = ctx.getApplicationContext();
        final CastSessionStore.Session s = CastSessionStore.load(app);
        if (s == null || restoring) { if (cb != null) cb.done(false); return; }
        restoring = true;
        new Thread(() -> {
            boolean alive = false; boolean decide = true;
            try {
                if (s.mode == PlayerActivity.CAST_DLNA) {
                    String[] ti = DlnaCastPlugin.getTransportInfoSync(s.dlnaCtrl);
                    String st = ti != null && ti[0] != null ? ti[0] : "";
                    alive = "PLAYING".equals(st) || "PAUSED_PLAYBACK".equals(st) || "TRANSITIONING".equals(st);
                    if (alive) {
                        // É a NOSSA mídia (URL do proxy do celular)? Se a TV está tocando
                        // outra coisa (outro app/fonte), a sessão morreu — não assume.
                        try {
                            String uri = DlnaCastPlugin.getCurrentUriSync(s.dlnaCtrl);
                            if (uri != null && !uri.isEmpty() && !uri.contains(":" + ProxyServer.PORT + "/")) alive = false;
                        } catch (Exception ignored) {}
                    }
                } else if (s.mode == PlayerActivity.CAST_CC) {
                    alive = ccConnected(app);
                    // SDK ainda retomando a sessão → não decide agora (nem apaga); o próximo
                    // castStatus (4 s) tenta de novo, até o teto.
                    if (!alive && SystemClock.elapsedRealtime() - PROCESS_START < CC_RESUME_GRACE_MS) decide = false;
                }
            } catch (Exception ignored) {}
            final boolean fAlive = alive, fDecide = decide;
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    if (fAlive) {
                        PlayerActivity.restoreCastSession(s);
                        goHeadless(app, s);
                    } else if (fDecide) {
                        CastSessionStore.clear(app);
                    }
                } finally { restoring = false; }
                if (cb != null) cb.done(fAlive);
            });
        }).start();
    }

    // Chromecast conectado com player remoto? (CastContext só na UI thread.)
    private static boolean ccConnected(final Context app) {
        final boolean[] r = { false };
        final java.util.concurrent.CountDownLatch l = new java.util.concurrent.CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                com.google.android.gms.cast.framework.CastSession cs =
                    com.google.android.gms.cast.framework.CastContext.getSharedInstance(app).getSessionManager().getCurrentCastSession();
                r[0] = cs != null && cs.isConnected() && cs.getRemoteMediaClient() != null;
            } catch (Exception ignored) {}
            l.countDown();
        });
        try { l.await(3, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        return r[0];
    }

    private static String onde(int mode) { return mode == PlayerActivity.CAST_CC ? "no Chromecast" : "na TV (DLNA)"; }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        ensureChannel(this);
        session = new MediaSessionCompat(this, "WatchMov");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { Controller c = controller; if (c != null) c.onNotifSetPlaying(true); else if (headless != null && !sPlaying) headlessToggle(); }
            @Override public void onPause() { Controller c = controller; if (c != null) c.onNotifSetPlaying(false); else if (headless != null && sPlaying) headlessToggle(); }
            @Override public void onStop() {
                Controller c = controller;
                if (c != null) { if (sCast) c.onNotifStop(); else c.onNotifSetPlaying(false); }
                else if (headless != null) headlessStop();
            }
            @Override public void onSkipToNext() { Controller c = controller; if (c != null && sHasNext) c.onNotifNext(); }
            @Override public void onSeekTo(long pos) { Controller c = controller; if (c != null) c.onNotifSeekTo(pos); else if (headless != null) headlessSeek(pos); }
        });
        try { session.setSessionActivity(openPlayerIntent()); } catch (Exception ignored) {}
        session.setActive(true);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Reinício pelo sistema (START_STICKY) depois de matar o processo: só faz sentido
            // se havia espelhamento — restaura a sessão gravada e segue headless; senão para.
            // (Android 12+ pode recusar o startForeground aqui: render() engole, e paramos.)
            CastSessionStore.Session s = controller == null ? CastSessionStore.load(this) : null;
            if (s != null) {
                PlayerActivity.restoreCastSession(s);
                headless = s; sCast = true; sHasNext = false;
                sTitle = s.title != null && !s.title.isEmpty() ? s.title : "WatchMov";
                sSub = "Reproduzindo " + onde(s.mode);
                render();
                if (shownKey == null) { stopSelf(); return START_NOT_STICKY; }   // startForeground recusado
                startHeadless();
                return START_STICKY;
            }
            render(); stopSelf();
            return START_NOT_STICKY;
        }
        String act = intent.getAction();
        Controller c = controller;
        if (ACT_TOGGLE.equals(act)) { if (c != null) c.onNotifSetPlaying(!sPlaying); else if (headless != null) headlessToggle(); }
        else if (ACT_NEXT.equals(act)) { if (c != null && sHasNext) c.onNotifNext(); }   // headless: fase 2
        else if (ACT_STOP.equals(act)) { if (c != null) c.onNotifStop(); else if (headless != null) headlessStop(); }
        render();   // SEMPRE: startForegroundService exige startForeground em até 5s
        if (ACT_HEADLESS.equals(act)) startHeadless();
        return START_STICKY;
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        // stopWithTask=false: o usuário deslizou o app dos recentes. Com a TV tocando
        // (headless, ou a Activity ainda por fechar → goHeadless) seguimos; sem cast e sem
        // Activity não há o que manter.
        if (headless == null && controller == null) stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        instance = null;
        shownKey = null;
        stopPoll();
        releaseLocks();
        try { if (session != null) { session.setActive(false); session.release(); } } catch (Exception ignored) {}
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        } catch (Exception ignored) {}
        try { NotificationManagerCompat.from(this).cancel(NOTIF_ID); } catch (Exception ignored) {}
        super.onDestroy();
    }

    // ---- Headless: poll da TV + comandos sem Activity ----

    private void startHeadless() {
        if (headless == null) return;
        acquireLocks();
        if (polling) return;
        polling = true; pollFails = 0; pollGen++;
        handler.removeCallbacks(pollTick);
        handler.post(pollTick);
    }

    private void stopPoll() {
        polling = false; pollGen++;
        handler.removeCallbacks(pollTick);
    }

    private final Runnable pollTick = new Runnable() {
        @Override public void run() {
            final CastSessionStore.Session s = headless;
            if (!polling || s == null) { polling = false; return; }
            final int gen = pollGen;
            if (s.mode == PlayerActivity.CAST_CC) {
                boolean ok = false;
                try {
                    com.google.android.gms.cast.framework.CastSession cs =
                        com.google.android.gms.cast.framework.CastContext.getSharedInstance(this_()).getSessionManager().getCurrentCastSession();
                    com.google.android.gms.cast.framework.media.RemoteMediaClient r = cs != null && cs.isConnected() ? cs.getRemoteMediaClient() : null;
                    if (r != null && r.getPlayerState() != com.google.android.gms.cast.MediaStatus.PLAYER_STATE_IDLE) {
                        sPos = Math.max(0, r.getApproximateStreamPosition()); sDur = Math.max(0, r.getStreamDuration()); sPlaying = r.isPlaying();
                        ok = true;
                    }
                } catch (Exception ignored) {}
                afterPoll(gen, ok);
                return;
            }
            // DLNA: SOAP em thread; serializado (o próximo ciclo só é agendado depois deste).
            new Thread(() -> {
                long[] pd = null; String[] ti = null;
                try { pd = DlnaCastPlugin.getPositionSync(s.dlnaCtrl); } catch (Exception ignored) {}
                try { ti = DlnaCastPlugin.getTransportInfoSync(s.dlnaCtrl); } catch (Exception ignored) {}
                final long[] f = pd; final String st = ti != null ? ti[0] : null;
                handler.post(() -> {
                    if (gen != pollGen) return;
                    boolean ok = st != null && ("PLAYING".equals(st) || "PAUSED_PLAYBACK".equals(st) || "TRANSITIONING".equals(st));
                    if (ok) {
                        if (f != null) { if (f[0] > 0) sPos = f[0]; if (f[1] > 0) sDur = f[1]; }
                        sPlaying = !"PAUSED_PLAYBACK".equals(st);
                    }
                    afterPoll(gen, ok);
                });
            }).start();
        }
    };

    private MediaNotificationService this_() { return this; }

    private void afterPoll(int gen, boolean ok) {
        if (gen != pollGen || !polling) return;
        final CastSessionStore.Session s = headless;
        if (s == null) { polling = false; return; }
        if (ok) {
            pollFails = 0;
            sSub = (sPlaying ? "Reproduzindo " : "Pausado ") + onde(s.mode);
            render();
        } else if (++pollFails >= HEADLESS_FAILS_TO_END) {
            // TV parou (fim do buffer/episódio, Stop no controle dela) ou sumiu da rede →
            // sessão encerrada: apaga a gravada, zera os estáticos e a notificação some.
            endHeadlessSession(false);
            return;
        }
        handler.postDelayed(pollTick, HEADLESS_POLL_MS);
    }

    private void headlessToggle() {
        final CastSessionStore.Session s = headless; if (s == null) return;
        final boolean play = !sPlaying;
        sPlaying = play; sSub = (play ? "Reproduzindo " : "Pausado ") + onde(s.mode); render();   // otimista; o poll corrige
        if (s.mode == PlayerActivity.CAST_DLNA) {
            final String c = s.dlnaCtrl;
            new Thread(() -> { try { DlnaCastPlugin.controlSync(c, play ? "Play" : "Pause"); } catch (Exception ignored) {} }).start();
        } else {
            try {
                com.google.android.gms.cast.framework.media.RemoteMediaClient r = ccRmc();
                if (r != null) { if (play) r.play(); else r.pause(); }
            } catch (Exception ignored) {}
        }
    }

    private void headlessSeek(final long posMs) {
        final CastSessionStore.Session s = headless; if (s == null) return;
        final long target = Math.max(0, posMs);
        sPos = target; render();
        if (s.mode == PlayerActivity.CAST_DLNA) {
            final String c = s.dlnaCtrl;
            new Thread(() -> { try { DlnaCastPlugin.seekSync(c, target); } catch (Exception ignored) {} }).start();
        } else {
            try {
                com.google.android.gms.cast.framework.media.RemoteMediaClient r = ccRmc();
                if (r != null) r.seek(new com.google.android.gms.cast.MediaSeekOptions.Builder().setPosition(target).build());
            } catch (Exception ignored) {}
        }
    }

    /** "Parar" na notificação com o app fechado: para a TV e encerra a sessão. */
    private void headlessStop() { endHeadlessSession(true); }

    private void endHeadlessSession(boolean stopTv) {
        final CastSessionStore.Session s = headless;
        stopPoll();
        headless = null;
        if (s != null && stopTv) {
            if (s.mode == PlayerActivity.CAST_DLNA) {
                final String c = s.dlnaCtrl;
                new Thread(() -> { try { DlnaCastPlugin.controlSync(c, "Stop"); } catch (Exception ignored) {} }).start();
            } else {
                try { com.google.android.gms.cast.framework.CastContext.getSharedInstance(this).getSessionManager().endCurrentSession(true); } catch (Exception ignored) {}
            }
        }
        CastSessionStore.clear(this);
        PlayerActivity.clearActiveCast();
        releaseLocks();
        if (controller == null) stopSelf();
    }

    private com.google.android.gms.cast.framework.media.RemoteMediaClient ccRmc() {
        try {
            com.google.android.gms.cast.framework.CastSession cs =
                com.google.android.gms.cast.framework.CastContext.getSharedInstance(this).getSessionManager().getCurrentCastSession();
            return cs != null ? cs.getRemoteMediaClient() : null;
        } catch (Exception e) { return null; }
    }

    // Wi-Fi em alto desempenho + CPU acordada enquanto a TV puxa do proxy com o app
    // fechado (sem isso o Android baixa o Wi-Fi/dorme e a TV para no fim do buffer).
    @SuppressWarnings("deprecation")
    private void acquireLocks() {
        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) { wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "watchmov:cast"); wifiLock.setReferenceCounted(false); }
            }
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (Exception ignored) {}
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) { wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "watchmov:cast"); wakeLock.setReferenceCounted(false); }
            }
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);   // teto de 6 h (um filme/episódio longo)
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) {}
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
    }

    // ---- Notificação / sessão ----

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
            session.setSessionActivity(openPlayerIntent());   // headless muda os extras → refaz
        } catch (Exception ignored) {}
        String key = sTitle + "|" + sSub + "|" + sPlaying + "|" + sHasNext + "|" + sCast + "|" + (headless != null);
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
        // Activity viva: SINGLE_TOP entrega onNewIntent nela em vez de criar outra (que
        // fecharia na hora por não ter URL). Headless (Activity morta): abre o player JÁ com
        // a mídia da TV (extras da sessão gravada) — ele cai no caminho castSilentStart
        // (estáticos restaurados) e reassume tempo e controles sem re-castar.
        Intent open = new Intent(this, PlayerActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        CastSessionStore.Session s = headless;
        if (s != null) {
            open.putExtra(PlayerActivity.EXTRA_URL, s.url)
                .putExtra(PlayerActivity.EXTRA_REFERER, s.referer)
                .putExtra(PlayerActivity.EXTRA_MIME, s.mime)
                .putExtra(PlayerActivity.EXTRA_TITLE, s.title)
                .putExtra(PlayerActivity.EXTRA_KEY, s.key)
                .putExtra(PlayerActivity.EXTRA_HAS_NEXT, s.hasNext)
                .putExtra(PlayerActivity.EXTRA_OFFLINE, s.offline)
                .putExtra(PlayerActivity.EXTRA_DOWNLOADED, s.downloaded)
                .putExtra(PlayerActivity.EXTRA_START_MS, sPos);
        }
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
        int n = 0;
        b.addAction(new NotificationCompat.Action(
            sPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            sPlaying ? "Pausar" : "Continuar", svcPi(2, ACT_TOGGLE))); n++;
        if (sHasNext) { b.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next, "Próximo episódio", svcPi(3, ACT_NEXT))); n++; }
        // Espelhando: "Parar" encerra o espelhamento (com ou sem o app aberto).
        if (sCast) { b.addAction(new NotificationCompat.Action(android.R.drawable.ic_menu_close_clear_cancel, "Parar", svcPi(4, ACT_STOP))); n++; }
        if (n >= 3) style.setShowActionsInCompactView(0, 1, 2);
        else if (n == 2) style.setShowActionsInCompactView(0, 1);
        else style.setShowActionsInCompactView(0);
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
