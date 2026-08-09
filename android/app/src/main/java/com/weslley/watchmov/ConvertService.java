package com.weslley.watchmov;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.util.NotificationUtil;
import androidx.media3.common.util.UnstableApi;

/**
 * Mantém a conversão pra MP4 viva com o app em background/fechado.
 *
 * O motor continua no ExportUtil (o Transformer precisa do looper principal); este
 * serviço só segura o processo em primeiro plano e mostra o progresso. Sem ele, o
 * Android — MIUI em especial — mata o processo assim que o app sai da tela e a
 * conversão de um episódio inteiro se perde no meio.
 */
@UnstableApi
public class ConvertService extends Service {

    private static final int FG_ID = 4662;      // ≠ do serviço de download (4661)
    private static final String ACTION_UPDATE = "com.weslley.watchmov.CONVERT_UPDATE";
    private static final String EXTRA_LABEL = "label";
    private static final String EXTRA_PERCENT = "percent";

    /** Sobe o serviço (ou atualiza o texto/percentual, se já estiver de pé). */
    public static void update(Context ctx, String label, int percent) {
        try {
            Intent i = new Intent(ctx.getApplicationContext(), ConvertService.class)
                .setAction(ACTION_UPDATE)
                .putExtra(EXTRA_LABEL, label == null ? "" : label)
                .putExtra(EXTRA_PERCENT, percent);
            if (Build.VERSION.SDK_INT >= 26) ctx.getApplicationContext().startForegroundService(i);
            else ctx.getApplicationContext().startService(i);
        } catch (Throwable ignored) { /* sem serviço: converte só com o app aberto */ }
    }

    public static void stop(Context ctx) {
        try { ctx.getApplicationContext().stopService(new Intent(ctx.getApplicationContext(), ConvertService.class)); }
        catch (Throwable ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String label = intent != null ? intent.getStringExtra(EXTRA_LABEL) : "";
        int percent = intent != null ? intent.getIntExtra(EXTRA_PERCENT, -1) : -1;
        // BLINDAGEM: onStartCommand NÃO pode lançar. Se o startForeground não vier a
        // tempo (RemoteViews que não infla, FGS dataSync recusado no Android novo, etc.)
        // o sistema MATA o app. Então: (1) sempre chamar startForeground primeiro, com
        // a notificação mais simples que der; (2) se nem isso rolar, desligar o serviço
        // e deixar a conversão seguir SEM primeiro plano (funciona com o app aberto) —
        // melhor perder o background do que crashar.
        try {
            startForeground(FG_ID, build(label, percent));
        } catch (Throwable t) {
            try { startForeground(FG_ID, minimal(label, percent)); }
            catch (Throwable t2) { stopForeground(true); stopSelf(); }
        }
        // NÃO redisparar sozinho depois de morto: sem o Transformer vivo o serviço
        // ficaria de pé mostrando um progresso que não existe mais.
        return START_NOT_STICKY;
    }

    // Notificação SIMPLES (sem RemoteViews) — fallback à prova de falha.
    private Notification minimal(String label, int percent) {
        NotificationUtil.createNotificationChannel(this, DownloadUtil.CHANNEL_ID,
            R.string.download_channel_name, 0, NotificationUtil.IMPORTANCE_LOW);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, DownloadUtil.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Convertendo pra MP4")
            .setContentText(label == null || label.isEmpty() ? "Preparando…" : label)
            .setOngoing(true).setOnlyAlertOnce(true);
        if (percent >= 0) b.setProgress(100, percent, false); else b.setProgress(0, 0, true);
        return b.build();
    }

    private Notification build(String label, int percent) {
        NotificationUtil.createNotificationChannel(this, DownloadUtil.CHANNEL_ID,
            R.string.download_channel_name, 0, NotificationUtil.IMPORTANCE_LOW);
        String nome = label == null || label.isEmpty() ? "Preparando…" : label;

        // Layout próprio: a barra padrão do Android ocupa a linha toda e não mostra
        // número. Aqui ela é fina e o % fica no FIM dela.
        android.widget.RemoteViews rv = new android.widget.RemoteViews(getPackageName(), R.layout.wm_notif_convert);
        rv.setTextViewText(R.id.wm_notif_title, "Convertendo pra MP4");
        rv.setTextViewText(R.id.wm_notif_text, nome);
        rv.setProgressBar(R.id.wm_notif_bar, 100, Math.max(percent, 0), percent < 0);
        rv.setTextViewText(R.id.wm_notif_pct, percent >= 0 ? percent + "%" : "…");

        return new NotificationCompat.Builder(this, DownloadUtil.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Convertendo pra MP4")
            .setContentText(nome)
            .setCustomContentView(rv)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
