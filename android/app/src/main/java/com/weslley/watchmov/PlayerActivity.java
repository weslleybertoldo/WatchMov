package com.weslley.watchmov;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import java.util.HashMap;
import java.util.Map;

/**
 * Player nativo (Media3/ExoPlayer) — como o Web Video Cast. Toca a URL capturada
 * mandando Referer/User-Agent em CADA request (resolve 403/CORS que o <video>/hls.js
 * do WebView não consegue) e com buffer generoso (aguarda carregar → menos travada).
 */
@UnstableApi
public class PlayerActivity extends Activity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_REFERER = "referer";
    public static final String EXTRA_UA = "ua";
    public static final String EXTRA_MIME = "mime";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_START_MS = "startMs";
    public static final String RESULT_POSITION = "positionMs";

    private ExoPlayer player;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        final String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null) { finish(); return; }
        final String referer = getIntent().getStringExtra(EXTRA_REFERER);
        final String ua = getIntent().getStringExtra(EXTRA_UA);
        final String mime = getIntent().getStringExtra(EXTRA_MIME);
        final long startMs = getIntent().getLongExtra(EXTRA_START_MS, 0);

        PlayerView view = new PlayerView(this);
        view.setKeepScreenOn(true);
        setContentView(view);

        // DataSource com headers (Referer/UA) — a chave pra tocar os streams protegidos.
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent(ua != null ? ua
                : "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        Map<String, String> headers = new HashMap<>();
        if (referer != null && !referer.isEmpty()) {
            headers.put("Referer", referer);
            try { headers.put("Origin", new java.net.URL(referer).getProtocol() + "://" + new java.net.URL(referer).getHost()); } catch (Exception ignored) {}
        }
        if (!headers.isEmpty()) http.setDefaultRequestProperties(headers);

        // Buffer generoso: aguarda encher antes de liberar (menos travamento).
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(30000, 120000, 3000, 6000)
            .build();

        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http))
            .setLoadControl(loadControl)
            .build();
        view.setPlayer(player);

        MediaItem.Builder item = new MediaItem.Builder().setUri(url);
        if (mime != null) {
            if (mime.contains("mpegurl")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
            else if (mime.contains("dash")) item.setMimeType(MimeTypes.APPLICATION_MPD);
            else item.setMimeType(MimeTypes.VIDEO_MP4);
        }
        player.setMediaItem(item.build());
        if (startMs > 0) player.seekTo(startMs);
        player.setPlayWhenReady(true);
        player.prepare();
    }

    private void finishWithPosition() {
        Intent data = new Intent();
        if (player != null) data.putExtra(RESULT_POSITION, player.getCurrentPosition());
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() { finishWithPosition(); }

    @Override
    protected void onDestroy() {
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
    }
}
