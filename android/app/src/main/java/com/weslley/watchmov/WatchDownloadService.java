package com.weslley.watchmov;

import android.app.Notification;

import androidx.annotation.Nullable;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.exoplayer.scheduler.Scheduler;

import java.util.List;

/**
 * Foreground service do Media3 que roda os downloads (mantém o processo vivo pra o
 * ProxyServer local seguir servindo mesmo com o app em background). Notificação de
 * progresso via DownloadNotificationHelper.
 */
@UnstableApi
public class WatchDownloadService extends DownloadService {

    private static final int FG_NOTIFICATION_ID = 4661;

    public WatchDownloadService() {
        super(FG_NOTIFICATION_ID,
              DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL,
              DownloadUtil.CHANNEL_ID,
              R.string.download_channel_name,
              0);
    }

    @Override
    protected DownloadManager getDownloadManager() {
        return DownloadUtil.getDownloadManager(this);
    }

    @Nullable
    @Override
    protected Scheduler getScheduler() {
        return null;
    }

    @Override
    protected Notification getForegroundNotification(List<Download> downloads, int notMetRequirements) {
        return DownloadUtil.getNotificationHelper(this)
            .buildProgressNotification(this, android.R.drawable.stat_sys_download, null,
                (downloads.isEmpty() ? "Baixando…" : downloads.size() + " download(s)"),
                downloads, notMetRequirements);
    }
}
