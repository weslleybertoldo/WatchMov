package com.weslley.watchmov;

import android.content.Context;

import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.DatabaseProvider;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.Cache;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.exoplayer.offline.DefaultDownloaderFactory;
import androidx.media3.exoplayer.offline.DefaultDownloadIndex;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadNotificationHelper;

import java.io.File;
import java.util.concurrent.Executors;

/**
 * Infra de download offline (Media3). Singletons compartilhados: um SimpleCache (o
 * MESMO usado pra baixar E pra tocar offline — SimpleCache trava o diretório, então
 * só pode existir 1 instância por processo), o DownloadManager e o helper de
 * notificação. O download é feito através do ProxyServer local (127.0.0.1) — que já
 * resolve headers anti-bot/gzip/segmento-raw — então o DataSource é HTTP simples.
 */
@UnstableApi
public final class DownloadUtil {

    public static final String CHANNEL_ID = "watchmov_downloads";
    private static final String CACHE_DIR = "wm_downloads";

    private static DatabaseProvider databaseProvider;
    private static File downloadDir;
    private static Cache cache;
    private static DownloadManager downloadManager;
    private static DownloadNotificationHelper notificationHelper;

    private DownloadUtil() {}

    public static synchronized DownloadNotificationHelper getNotificationHelper(Context ctx) {
        if (notificationHelper == null) {
            notificationHelper = new DownloadNotificationHelper(ctx.getApplicationContext(), CHANNEL_ID);
        }
        return notificationHelper;
    }

    public static synchronized DownloadManager getDownloadManager(Context ctx) {
        if (downloadManager == null) {
            Context app = ctx.getApplicationContext();
            DefaultDownloadIndex index = new DefaultDownloadIndex(getDatabaseProvider(app));
            DataSource.Factory httpFactory = new DefaultHttpDataSource.Factory();
            CacheDataSource.Factory cacheWriter = new CacheDataSource.Factory()
                .setCache(getCache(app))
                .setUpstreamDataSourceFactory(httpFactory);
            downloadManager = new DownloadManager(
                app, index,
                new DefaultDownloaderFactory(cacheWriter, Executors.newFixedThreadPool(4)));
            downloadManager.setMaxParallelDownloads(2);
        }
        return downloadManager;
    }

    // DataSource pra PLAYBACK offline: lê do cache; só cai na rede em cache-miss.
    public static synchronized CacheDataSource.Factory getPlaybackCacheFactory(Context ctx) {
        return new CacheDataSource.Factory()
            .setCache(getCache(ctx.getApplicationContext()))
            .setUpstreamDataSourceFactory(new DefaultHttpDataSource.Factory())
            .setCacheWriteDataSinkFactory(null)   // playback não regrava no cache
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    }

    private static synchronized Cache getCache(Context app) {
        if (cache == null) {
            cache = new SimpleCache(new File(getDownloadDir(app), CACHE_DIR),
                new NoOpCacheEvictor(), getDatabaseProvider(app));
        }
        return cache;
    }

    private static synchronized DatabaseProvider getDatabaseProvider(Context app) {
        if (databaseProvider == null) databaseProvider = new StandaloneDatabaseProvider(app);
        return databaseProvider;
    }

    private static synchronized File getDownloadDir(Context app) {
        if (downloadDir == null) {
            downloadDir = app.getExternalFilesDir(null);
            if (downloadDir == null) downloadDir = app.getFilesDir();
        }
        return downloadDir;
    }
}
