package com.weslley.watchmov;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
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
 * com Referer/User-Agent + buffer, em tela cheia edge-to-edge, com barra de ações
 * que some junto com os controles e um seletor pra trocar de link sem sair.
 */
@UnstableApi
public class PlayerActivity extends Activity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_URLS = "urls";
    public static final String EXTRA_MIMES = "mimes";
    public static final String EXTRA_REFERER = "referer";
    public static final String EXTRA_UA = "ua";
    public static final String EXTRA_MIME = "mime";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_START_MS = "startMs";
    public static final String RESULT_POSITION = "positionMs";
    public static final String RESULT_URL = "url";

    private ExoPlayer player;
    private PlayerView view;
    private TextView status;
    private String currentUrl;
    private String[] urls;
    private String[] mimes;
    private boolean resultSaved = false;

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
        // Tela cheia de verdade: vídeo ocupa tudo (inclusive sob o entalhe), sem barras.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        WindowInsetsControllerCompat ctrl = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        ctrl.hide(WindowInsetsCompat.Type.systemBars());
        ctrl.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        currentUrl = getIntent().getStringExtra(EXTRA_URL);
        if (currentUrl == null) { finish(); return; }
        urls = getIntent().getStringArrayExtra(EXTRA_URLS);
        mimes = getIntent().getStringArrayExtra(EXTRA_MIMES);
        final String referer = getIntent().getStringExtra(EXTRA_REFERER);
        final String ua = getIntent().getStringExtra(EXTRA_UA);
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

        final LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(28, 24, 28, 24);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        Button back = pill("‹ Voltar", v -> finishWithResult());
        Button links = pill("Links", v -> showLinks());
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
        View spacer = new View(this);
        bar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));
        if (urls != null && urls.length > 1) bar.addView(links);
        bar.addView(speed); bar.addView(resize); bar.addView(rotate);
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        // A barra some/aparece junto com os controles do player.
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> bar.setVisibility(visibility));

        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(15);
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

        player.addListener(new androidx.media3.common.Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
                status.setText("Erro ao tocar: " + error.getErrorCodeName());
                status.setVisibility(View.VISIBLE);
            }
            @Override public void onPlaybackStateChanged(int state) {
                if (state == androidx.media3.common.Player.STATE_READY || state == androidx.media3.common.Player.STATE_ENDED) status.setVisibility(View.GONE);
                else if (state == androidx.media3.common.Player.STATE_BUFFERING) { status.setText("Carregando vídeo…"); status.setVisibility(View.VISIBLE); }
            }
        });

        playUrl(currentUrl, getIntent().getStringExtra(EXTRA_MIME), startMs);
    }

    private void playUrl(String url, String mime, long startMs) {
        currentUrl = url;
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

    private void showLinks() {
        if (urls == null || urls.length == 0) return;
        String[] labels = new String[urls.length];
        for (int i = 0; i < urls.length; i++) {
            String m = (mimes != null && i < mimes.length && mimes[i] != null) ? mimes[i] : "";
            String tag = m.contains("mpegurl") ? "HLS" : m.contains("dash") ? "DASH" : "MP4";
            labels[i] = "Link " + (i + 1) + " (" + tag + ")" + (urls[i].equals(currentUrl) ? "  ✓" : "");
        }
        final long pos = player != null ? player.getCurrentPosition() : 0;   // continua no mesmo tempo
        new AlertDialog.Builder(this)
            .setTitle("Trocar link")
            .setItems(labels, (d, i) -> playUrl(urls[i], mimes != null && i < mimes.length ? mimes[i] : null, pos))
            .show();
    }

    private void finishWithResult() {
        if (!resultSaved && player != null) {
            resultSaved = true;
            Intent data = new Intent();
            data.putExtra(RESULT_POSITION, player.getCurrentPosition());
            data.putExtra(RESULT_URL, currentUrl);
            setResult(RESULT_OK, data);
        }
        finish();
    }

    @Override
    public void onBackPressed() { finishWithResult(); }

    @Override
    protected void onPause() {
        // Back moderno/gesto/home nem sempre chama onBackPressed → salva aqui também.
        if (!resultSaved && player != null) {
            Intent data = new Intent();
            data.putExtra(RESULT_POSITION, player.getCurrentPosition());
            data.putExtra(RESULT_URL, currentUrl);
            setResult(RESULT_OK, data);
            resultSaved = true;
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
    }

    private Button pill(String text, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(15);
        b.setBackgroundColor(Color.parseColor("#99000000"));
        b.setPadding(36, 18, 36, 18);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = 12;
        b.setLayoutParams(lp);
        if (onClick != null) b.setOnClickListener(onClick);
        return b;
    }
}
