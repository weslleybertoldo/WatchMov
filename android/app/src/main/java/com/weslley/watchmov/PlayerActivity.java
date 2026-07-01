package com.weslley.watchmov;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import java.util.HashMap;
import java.util.Map;

/**
 * Player nativo (Media3/ExoPlayer) — como o Web Video Cast. Toca a URL capturada
 * mandando Referer/User-Agent (resolve 403/CORS) com buffer generoso, e expõe os
 * controles do WVC: play/pause, seek ±10s, barra/tempo, velocidade, ajuste de
 * tela (fit/zoom/preencher), girar e legendas.
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
    private PlayerView view;
    private TextView status;
    private final float[] speeds = {1f, 1.25f, 1.5f, 2f, 0.5f};
    private int speedIdx = 0;
    private final int[] resizeModes = {
        AspectRatioFrameLayout.RESIZE_MODE_FIT,
        AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
        AspectRatioFrameLayout.RESIZE_MODE_FILL,
    };
    private int resizeIdx = 0;
    private boolean landscape = true;

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

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        view = new PlayerView(this);
        view.setKeepScreenOn(true);
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS);
        view.setShowFastForwardButton(true);
        view.setShowRewindButton(true);
        view.setShowSubtitleButton(true);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        view.setControllerShowTimeoutMs(3500);
        view.setResizeMode(resizeModes[0]);
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Barra de ações extra (topo direito): velocidade, ajuste de tela, girar, voltar.
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(16, 16, 16, 16);

        Button back = pill("‹ Voltar", v -> finishWithPosition());
        Button speed = pill("1x", null);
        speed.setOnClickListener(v -> {
            speedIdx = (speedIdx + 1) % speeds.length;
            player.setPlaybackParameters(new PlaybackParameters(speeds[speedIdx]));
            speed.setText(speeds[speedIdx] + "x");
        });
        Button resize = pill("Tela", v -> {
            resizeIdx = (resizeIdx + 1) % resizeModes.length;
            view.setResizeMode(resizeModes[resizeIdx]);
        });
        Button rotate = pill("Girar", v -> {
            landscape = !landscape;
            setRequestedOrientation(landscape ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        });

        bar.addView(back);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        View spacer = new View(this); bar.addView(spacer, sp);
        bar.addView(speed); bar.addView(resize); bar.addView(rotate);
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(14);
        status.setPadding(40, 40, 40, 40);
        status.setText("Carregando vídeo…");
        root.addView(status, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        setContentView(root);

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

        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(30000, 120000, 3000, 6000)
            .build();

        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http))
            .setLoadControl(loadControl)
            .setSeekBackIncrementMs(10000)
            .setSeekForwardIncrementMs(10000)
            .build();
        view.setPlayer(player);

        MediaItem.Builder item = new MediaItem.Builder().setUri(url);
        if (mime != null) {
            if (mime.contains("mpegurl")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
            else if (mime.contains("dash")) item.setMimeType(MimeTypes.APPLICATION_MPD);
            else item.setMimeType(MimeTypes.VIDEO_MP4);
        }
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                status.setText("Erro ao tocar: " + error.getErrorCodeName()
                    + (error.getCause() != null ? "\n" + error.getCause().getMessage() : ""));
                status.setVisibility(View.VISIBLE);
            }
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY || state == Player.STATE_ENDED) status.setVisibility(View.GONE);
                else if (state == Player.STATE_BUFFERING) { status.setText("Carregando vídeo…"); status.setVisibility(View.VISIBLE); }
            }
        });

        player.setMediaItem(item.build());
        if (startMs > 0) player.seekTo(startMs);
        player.setPlayWhenReady(true);
        player.prepare();
    }

    private Button pill(String text, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundColor(Color.parseColor("#66000000"));
        b.setMinWidth(0); b.setMinHeight(0);
        b.setPadding(24, 10, 24, 10);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = 8;
        b.setLayoutParams(lp);
        if (onClick != null) b.setOnClickListener(onClick);
        return b;
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
