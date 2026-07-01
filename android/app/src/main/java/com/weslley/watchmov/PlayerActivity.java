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
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
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
    public static final String EXTRA_QUALITIES = "qualities";
    public static final String EXTRA_REFERER = "referer";
    public static final String EXTRA_UA = "ua";
    public static final String EXTRA_MIME = "mime";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_START_MS = "startMs";
    public static final String EXTRA_KEY = "resumeKey";
    public static final String EXTRA_HAS_NEXT = "hasNext";
    public static final String EXTRA_WATCHED = "watched";
    private static final long WATCHED_THRESHOLD_MS = 60000;   // "visto" quando falta 1 min pro fim
    private static final String RESUME_PREFS = "watchmov_resume";
    public static final String RESULT_POSITION = "positionMs";
    public static final String RESULT_URL = "url";
    public static final String RESULT_NEXT = "next";
    public static final String RESULT_SERVER = "server";

    private ExoPlayer player;
    private DefaultTrackSelector trackSelector;
    private Button qualityBtn;
    private PlayerView view;
    private TextView status;
    private String currentUrl;
    private String[] urls;
    private String[] mimes;
    private String[] qualities;
    private String mReferer;
    private boolean hasNext = false;
    private boolean watched = false;              // estado atual do "assistido"
    private android.widget.ImageButton watchedBtn;
    private boolean resultSaved = false;
    private String resumeKey;
    private android.content.SharedPreferences resumePrefs;
    private final android.os.Handler progressHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable progressTick = new Runnable() {
        @Override public void run() {
            // Salva a posição a cada 5s (robusto — não depende só do fechar).
            saveResume();
            if (player != null && player.getCurrentPosition() > 0) {
                NativePlayerPlugin.reportProgress(currentUrl, player.getCurrentPosition(), player.getDuration());
            }
            // "Assistido" automático: quando falta ≤1 min pro fim.
            if (!watched && player != null) {
                long dur = player.getDuration(), pos = player.getCurrentPosition();
                if (dur > WATCHED_THRESHOLD_MS && pos >= dur - WATCHED_THRESHOLD_MS) setWatched(true);
            }
            progressHandler.postDelayed(this, 5000);
        }
    };

    private final float[] speeds = {1f, 1.25f, 1.5f, 2f, 0.5f};
    private int speedIdx = 0;
    private final int[] resizeModes = {
        AspectRatioFrameLayout.RESIZE_MODE_FIT,
        AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
        AspectRatioFrameLayout.RESIZE_MODE_FILL,
    };
    private final String[] resizeNames = { "Ajustar", "Zoom", "Esticar" };
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
        qualities = getIntent().getStringArrayExtra(EXTRA_QUALITIES);
        final String referer = getIntent().getStringExtra(EXTRA_REFERER);
        mReferer = referer;
        final String ua = getIntent().getStringExtra(EXTRA_UA);
        final long startMs = getIntent().getLongExtra(EXTRA_START_MS, 0);
        hasNext = getIntent().getBooleanExtra(EXTRA_HAS_NEXT, false);
        watched = getIntent().getBooleanExtra(EXTRA_WATCHED, false);
        resumePrefs = getSharedPreferences(RESUME_PREFS, MODE_PRIVATE);
        resumeKey = getIntent().getStringExtra(EXTRA_KEY);
        long savedPos = resumeKey != null ? resumePrefs.getLong(resumeKey, 0) : 0;
        final long resolvedStart = savedPos > 3000 ? savedPos : startMs;
        if (resumeKey != null) resizeIdx = resumePrefs.getInt(resumeKey + "_resize", 0);   // modo de tela salvo por título

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        // PlayerView com controller customizado (wm_player_control_view.xml): título +
        // botões assistido/espelhar ficam DENTRO da barra de baixo, junto de legenda/config.
        view = (PlayerView) getLayoutInflater().inflate(R.layout.wm_player_view, root, false);
        view.setKeepScreenOn(true);
        view.setResizeMode(resizeModes[resizeIdx]);
        view.setControllerShowTimeoutMs(3500);
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView wmTitle = view.findViewById(R.id.wm_title);
        wmTitle.setText(getIntent().getStringExtra(EXTRA_TITLE));

        watchedBtn = view.findViewById(R.id.wm_watched);
        watchedBtn.setColorFilter(watched ? Color.parseColor("#4ADE80") : Color.WHITE);
        watchedBtn.setOnClickListener(v -> toggleWatched());

        castBtn = view.findViewById(R.id.wm_cast);
        castBtn.setColorFilter(Color.WHITE);
        castBtn.setOnClickListener(v -> onCastButton());

        final LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(28, 24, 28, 24);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        Button back = pill("‹ Voltar", v -> finishWithResult(false, false));
        Button server = pill("▣ Servidor", v -> finishWithResult(false, true));
        Button links = pill("Links", v -> showLinks());
        qualityBtn = pill("Auto", v -> showQuality());
        Button fwd60 = pill("+60s", v -> { if (player != null) player.seekTo(player.getCurrentPosition() + 60000); });
        Button next = pill("Próximo ⏭", v -> finishWithResult(true, false));
        Button speed = pill("1x", null);
        speed.setOnClickListener(v -> {
            speedIdx = (speedIdx + 1) % speeds.length;
            player.setPlaybackParameters(new PlaybackParameters(speeds[speedIdx]));
            speed.setText(speeds[speedIdx] + "x");
        });
        Button resize = pill("Tela: " + resizeNames[resizeIdx], v -> {
            resizeIdx = (resizeIdx + 1) % resizeModes.length;
            view.setResizeMode(resizeModes[resizeIdx]);
            ((Button) v).setText("Tela: " + resizeNames[resizeIdx]);
            if (resumeKey != null) resumePrefs.edit().putInt(resumeKey + "_resize", resizeIdx).apply();
        });
        Button rotate = pill("Girar", v -> {
            landscape = !landscape;
            setRequestedOrientation(landscape ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        });

        bar.addView(back);
        View spacer = new View(this);
        bar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));
        bar.addView(server);
        bar.addView(fwd60);
        if (hasNext) bar.addView(next);
        if (urls != null && urls.length > 1) bar.addView(links);
        bar.addView(qualityBtn); bar.addView(speed); bar.addView(resize); bar.addView(rotate);
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        // A barra de cima some/aparece junto com os controles do player (o título e os
        // botões assistido/espelhar já fazem parte do controller de baixo, então se
        // escondem sozinhos com ele).
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            bar.setVisibility(visibility);
        });

        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(15);
        status.setText("Carregando vídeo…");
        root.addView(status, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        // Overlay de controle remoto (some por padrão; aparece ao espelhar).
        castOverlay = new FrameLayout(this);
        castOverlay.setBackgroundColor(Color.parseColor("#E6000000"));
        castOverlay.setClickable(true);
        castOverlay.setVisibility(View.GONE);
        LinearLayout castCol = new LinearLayout(this);
        castCol.setOrientation(LinearLayout.VERTICAL);
        castCol.setGravity(Gravity.CENTER);
        castStatusTv = new TextView(this);
        castStatusTv.setTextColor(Color.WHITE); castStatusTv.setTextSize(18); castStatusTv.setGravity(Gravity.CENTER);
        castTimeTv = new TextView(this);
        castTimeTv.setTextColor(Color.parseColor("#B0FFFFFF")); castTimeTv.setTextSize(14); castTimeTv.setGravity(Gravity.CENTER);
        castTimeTv.setPadding(0, 12, 0, 24);
        LinearLayout castRow = new LinearLayout(this);
        castRow.setOrientation(LinearLayout.HORIZONTAL); castRow.setGravity(Gravity.CENTER);
        Button rew10 = pill("⏪ 10s", v -> remoteSeekBy(-10000));
        castPlayBtn = pill("⏸", v -> remotePlayPause());
        Button ff10 = pill("10s ⏩", v -> remoteSeekBy(10000));
        castRow.addView(rew10); castRow.addView(castPlayBtn); castRow.addView(ff10);
        Button stopCast = pill("Parar espelhamento", v -> {
            if (castMode == CAST_CC && castSessionManager != null) castSessionManager.endCurrentSession(true);
            else stopCasting(true);
        });
        castCol.addView(castStatusTv); castCol.addView(castTimeTv); castCol.addView(castRow); castCol.addView(stopCast);
        castOverlay.addView(castCol, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        root.addView(castOverlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);

        // Inicializa o Cast cedo: registra o provider do Google Cast no MediaRouter
        // ainda no onCreate, senão selecionar a rota conecta no MediaRouter mas NÃO
        // cria a CastSession (fica preso em "conectando" sem onSessionStarted).
        // Registra o listener já aqui p/ o botão refletir o estado desde o início.
        try {
            com.google.android.gms.cast.framework.CastContext cc = com.google.android.gms.cast.framework.CastContext.getSharedInstance(this);
            registerCastListener(cc);
            com.google.android.gms.cast.framework.CastSession cur = cc.getSessionManager().getCurrentCastSession();
            if (cur != null && cur.isConnected()) { castConnected = true; updateCastButton(true); }
        } catch (Exception ignored) {}

        // DataSource baseado em OkHttp (como o Web Video Cast): o OkHttp descomprime
        // gzip transparente. Vários players BR (SuperFlix/EmbedPlay) servem o m3u8 como
        // text/plain GZIP e o DefaultHttpDataSource do ExoPlayer NÃO descomprime o
        // manifest → o parser recebe bytes gzip e falha "Input does not start with
        // #EXTM3U" (ERROR_CODE_PARSING_MANIFEST_MALFORMED). OkHttp resolve isso.
        final String defUa = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
        okhttp3.OkHttpClient okClient = new okhttp3.OkHttpClient.Builder()
            .followRedirects(true).followSslRedirects(true).build();
        OkHttpDataSource.Factory http = new OkHttpDataSource.Factory(okClient)
            .setUserAgent(ua != null ? ua : defUa);
        Map<String, String> headers = new HashMap<>();
        if (referer != null && !referer.isEmpty()) {
            headers.put("Referer", referer);
            try { headers.put("Origin", new java.net.URL(referer).getProtocol() + "://" + new java.net.URL(referer).getHost()); } catch (Exception ignored) {}
        }
        if (!headers.isEmpty()) http.setDefaultRequestProperties(headers);

        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(30000, 120000, 3000, 6000)
            .build();

        trackSelector = new DefaultTrackSelector(this);
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http))
            .setLoadControl(loadControl)
            .setTrackSelector(trackSelector)
            .setSeekBackIncrementMs(10000)
            .setSeekForwardIncrementMs(10000)
            .build();
        view.setPlayer(player);

        player.addListener(new androidx.media3.common.Player.Listener() {
            @Override public void onVideoSizeChanged(VideoSize size) {
                if (size.height > 0) {
                    qualityBtn.setText(size.height + "p");
                    NativePlayerPlugin.reportQuality(currentUrl, size.height);
                }
            }
            @Override public void onPlayerError(PlaybackException error) {
                status.setText("Erro ao tocar: " + error.getErrorCodeName());
                status.setVisibility(View.VISIBLE);
            }
            @Override public void onPlaybackStateChanged(int state) {
                if (state == androidx.media3.common.Player.STATE_READY || state == androidx.media3.common.Player.STATE_ENDED) status.setVisibility(View.GONE);
                else if (state == androidx.media3.common.Player.STATE_BUFFERING) { status.setText("Carregando vídeo…"); status.setVisibility(View.VISIBLE); }
            }
        });

        playUrl(currentUrl, getIntent().getStringExtra(EXTRA_MIME), resolvedStart);
    }

    // Toggle do botão "assistido": marca (e pula p/ faltar 1 min, como pedido) ou
    // desmarca. As 3 formas de marcar convergem aqui/no tick: botão, assistir até
    // faltar 1 min, ou o checkbox do overlay (via JS).
    private void toggleWatched() {
        if (!watched) {
            setWatched(true);
            if (player != null) {
                long dur = player.getDuration();
                if (dur > WATCHED_THRESHOLD_MS) player.seekTo(dur - WATCHED_THRESHOLD_MS);
            }
        } else {
            setWatched(false);
        }
    }

    private void setWatched(boolean w) {
        if (watched == w) return;
        watched = w;
        if (watchedBtn != null) watchedBtn.setColorFilter(w ? Color.parseColor("#4ADE80") : Color.WHITE);
        NativePlayerPlugin.reportWatched(w);
    }

    private void saveResume() {
        if (resumeKey == null || resumePrefs == null || player == null) return;
        long pos = player.getCurrentPosition();
        if (pos > 3000) resumePrefs.edit().putLong(resumeKey, pos).apply();
    }

    private void playUrl(String url, String mime, long startMs) {
        currentUrl = url;
        // O mime capturado nem sempre chega certo (SuperFlix/EmbedPlay servem HLS como
        // text/plain em master.txt/`/m3/` sem extensão). Se o mime já diz HLS/DASH,
        // usa direto; senão SNIFFA os bytes reais (OkHttp descomprime gzip) e decide
        // pelo conteúdo (#EXTM3U=HLS, ftyp=mp4) — fonte da verdade, não depende da
        // captura. Roda em thread e prepara na UI.
        final String mimeLc = mime != null ? mime.toLowerCase() : "";
        if (mimeLc.contains("mpegurl")) { prepare(url, MimeTypes.APPLICATION_M3U8, startMs); return; }
        if (mimeLc.contains("dash"))    { prepare(url, MimeTypes.APPLICATION_MPD, startMs); return; }
        status.setText("Carregando vídeo…"); status.setVisibility(View.VISIBLE);
        new Thread(() -> {
            String resolved = sniffMime(url);
            runOnUiThread(() -> { if (url.equals(currentUrl)) prepare(url, resolved, startMs); });
        }).start();
    }

    // Descobre o tipo pelo conteúdo real (o servidor mente na extensão/Content-Type).
    private String sniffMime(String url) {
        try {
            okhttp3.OkHttpClient c = new okhttp3.OkHttpClient();
            okhttp3.Request rq = new okhttp3.Request.Builder().url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
                .header("Range", "bytes=0-511").build();
            try (okhttp3.Response rp = c.newCall(rq).execute()) {
                String ct = rp.header("Content-Type", "");
                if (ct != null && ct.toLowerCase().contains("mpegurl")) return MimeTypes.APPLICATION_M3U8;
                if (ct != null && ct.toLowerCase().contains("dash+xml")) return MimeTypes.APPLICATION_MPD;
                byte[] b = rp.body() != null ? rp.body().bytes() : new byte[0];
                String head = new String(b, 0, Math.min(b.length, 256));
                if (head.contains("#EXTM3U")) return MimeTypes.APPLICATION_M3U8;
                if (head.contains("<MPD") || head.contains("dash")) return MimeTypes.APPLICATION_MPD;
            }
        } catch (Exception ignored) {}
        // fallback pela extensão
        String p = url.split("\\?")[0].toLowerCase();
        if (p.endsWith(".m3u8") || p.contains("master") || p.contains("/m3/")) return MimeTypes.APPLICATION_M3U8;
        if (p.endsWith(".mpd")) return MimeTypes.APPLICATION_MPD;
        return MimeTypes.VIDEO_MP4;
    }

    private void prepare(String url, String mimeType, long startMs) {
        if (player == null) return;
        MediaItem item = new MediaItem.Builder().setUri(url).setMimeType(mimeType).build();
        player.setMediaItem(item);
        if (startMs > 0) player.seekTo(startMs);
        player.setPlayWhenReady(true);
        player.prepare();
        progressHandler.removeCallbacks(progressTick);
        progressHandler.postDelayed(progressTick, 5000);
    }

    // Qualidade real do vídeo: lê as resoluções das faixas HLS e deixa escolher
    // (Auto = adaptativo). Trava a resolução via setMaxVideoSize.
    private void showQuality() {
        if (player == null) return;
        List<Integer> heights = new ArrayList<>();
        for (Tracks.Group g : player.getCurrentTracks().getGroups()) {
            if (g.getType() != androidx.media3.common.C.TRACK_TYPE_VIDEO) continue;
            for (int i = 0; i < g.length; i++) {
                int h = g.getTrackFormat(i).height;
                if (h > 0 && !heights.contains(h)) heights.add(h);
            }
        }
        Collections.sort(heights, Collections.reverseOrder());
        if (heights.isEmpty()) return;
        final String[] labels = new String[heights.size() + 1];
        labels[0] = "Auto";
        for (int i = 0; i < heights.size(); i++) labels[i + 1] = heights.get(i) + "p";
        new AlertDialog.Builder(this)
            .setTitle("Qualidade")
            .setItems(labels, (d, i) -> {
                if (i == 0) {
                    trackSelector.setParameters(trackSelector.buildUponParameters().clearVideoSizeConstraints());
                    qualityBtn.setText("Auto");
                } else {
                    int h = heights.get(i - 1);
                    trackSelector.setParameters(trackSelector.buildUponParameters().setMaxVideoSize(Integer.MAX_VALUE, h).setMinVideoSize(0, h));
                    qualityBtn.setText(h + "p");
                }
            })
            .show();
    }

    // Resolução pela URL (heurística) — só pra rotular os links na lista.
    private static String qualityFromUrl(String url) {
        if (url == null) return "";
        String p = url.split("\\?")[0].toLowerCase();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d{3,4})p(?:[^0-9]|$)").matcher(p);
        if (m.find()) return m.group(1) + "p";
        m = java.util.regex.Pattern.compile("\\d{3,4}x(\\d{3,4})").matcher(p);
        if (m.find()) return m.group(1) + "p";
        m = java.util.regex.Pattern.compile("[/_-](240|360|480|540|576|720|1080|1440|2160)[/_.-]").matcher(p);
        if (m.find()) return m.group(1) + "p";
        return "";
    }

    // Espelhar na TV: pergunta o método (Chromecast ou DLNA) e delega.
    private void castToTv() {
        new AlertDialog.Builder(this)
            .setTitle("Espelhar na TV")
            .setItems(new String[]{ "Chromecast (Google Cast)", "Enviar para a TV (DLNA)" }, (d, i) -> {
                if (i == 0) castViaChromecast(); else castViaDlna();
            }).show();
    }

    // ---- Chromecast (Google Cast) ----
    private com.google.android.gms.cast.framework.SessionManager castSessionManager;
    private com.google.android.gms.cast.framework.SessionManagerListener<com.google.android.gms.cast.framework.CastSession> castSessionListener;
    private boolean castConnected = false;
    private boolean castMediaCbSet = false;
    private android.widget.ImageButton castBtn;

    // Cor do botão espelhar: verde quando há sessão Cast ativa, branco quando não.
    private void updateCastButton(boolean connected) {
        if (castBtn != null) castBtn.setColorFilter(connected ? Color.parseColor("#4ADE80") : Color.WHITE);
    }

    // Clique no botão espelhar: se já tem Cast conectado, oferece desconectar;
    // senão abre a caixa de escolha (Chromecast/DLNA).
    private void onCastButton() {
        com.google.android.gms.cast.framework.CastSession s =
            castSessionManager != null ? castSessionManager.getCurrentCastSession() : null;
        if (s != null && s.isConnected()) {
            new AlertDialog.Builder(this).setTitle("Chromecast conectado")
                .setMessage("Desconectar da TV?")
                .setPositiveButton("Desconectar", (d, w) -> { if (castSessionManager != null) castSessionManager.endCurrentSession(true); })
                .setNegativeButton("Cancelar", null).show();
        } else {
            castToTv();
        }
    }

    // ---- Espelhamento: controle remoto da TV (o player local pausa) ----
    private static final int CAST_NONE = 0, CAST_CC = 1, CAST_DLNA = 2;
    private int castMode = CAST_NONE;
    private String dlnaCtrl;
    private boolean dlnaPaused = false;
    private long lastRemotePosMs = 0, lastRemoteDurMs = 0;
    private FrameLayout castOverlay;
    private TextView castStatusTv, castTimeTv;
    private Button castPlayBtn;

    private com.google.android.gms.cast.framework.media.RemoteMediaClient rmc() {
        com.google.android.gms.cast.framework.CastSession s = castSessionManager != null ? castSessionManager.getCurrentCastSession() : null;
        return s != null ? s.getRemoteMediaClient() : null;
    }

    // Conectou: pausa o player local e mostra o overlay de controle da TV.
    private void startCasting(int mode, String ctrl) {
        castMode = mode; dlnaCtrl = ctrl; dlnaPaused = false;
        if (player != null) player.setPlayWhenReady(false);
        if (castStatusTv != null) castStatusTv.setText(mode == CAST_CC ? "Reproduzindo no Chromecast" : "Reproduzindo na TV (DLNA)");
        // IP do proxy num Toast (o texto do overlay corta) — pro teste do /ping.
        String ip = localIp();
        android.widget.Toast.makeText(this,
            ip != null ? ("Proxy: http://" + ip + ":" + ProxyServer.PORT + "  — teste /ping de outro aparelho no Wi-Fi")
                       : "Sem IP de Wi-Fi detectado (o celular está no Wi-Fi?).",
            android.widget.Toast.LENGTH_LONG).show();
        if (castOverlay != null) castOverlay.setVisibility(View.VISIBLE);
        if (view != null) view.hideController();
        updatePlayIcon(true);
        progressHandler.removeCallbacks(castPoll);
        progressHandler.postDelayed(castPoll, 800);
    }

    // Parou/desconectou: esconde o overlay e volta a tocar local na posição da TV.
    private void stopCasting(boolean resumeLocal) {
        if (castMode == CAST_NONE) return;
        final long tvPos = lastRemotePosMs;
        if (castMode == CAST_DLNA && dlnaCtrl != null) {
            final String c = dlnaCtrl;
            new Thread(() -> { try { DlnaCastPlugin.controlSync(c, "Stop"); } catch (Exception ignored) {} }).start();
        }
        castMode = CAST_NONE; dlnaCtrl = null;
        progressHandler.removeCallbacks(castPoll);
        if (castOverlay != null) castOverlay.setVisibility(View.GONE);
        if (resumeLocal && player != null) { if (tvPos > 0) player.seekTo(tvPos); player.setPlayWhenReady(true); }
    }

    private void remotePlayPause() {
        if (castMode == CAST_CC) {
            com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc();
            if (r == null) return;
            if (r.isPlaying()) r.pause(); else r.play();
        } else if (castMode == CAST_DLNA && dlnaCtrl != null) {
            final String c = dlnaCtrl; final boolean pause = !dlnaPaused; dlnaPaused = pause;
            updatePlayIcon(!pause);
            new Thread(() -> { try { DlnaCastPlugin.controlSync(c, pause ? "Pause" : "Play"); } catch (Exception ignored) {} }).start();
        }
    }

    private void remoteSeekBy(long deltaMs) {
        if (castMode == CAST_CC) {
            com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc();
            if (r == null) return;
            long target = Math.max(0, r.getApproximateStreamPosition() + deltaMs);
            r.seek(new com.google.android.gms.cast.MediaSeekOptions.Builder().setPosition(target).build());
        } else if (castMode == CAST_DLNA && dlnaCtrl != null) {
            final String c = dlnaCtrl; final long target = Math.max(0, lastRemotePosMs + deltaMs);
            new Thread(() -> { try { DlnaCastPlugin.seekSync(c, target); } catch (Exception ignored) {} }).start();
        }
    }

    private void updatePlayIcon(boolean playing) { if (castPlayBtn != null) castPlayBtn.setText(playing ? "⏸" : "▶"); }

    private String fmtClock(long ms) {
        long s = Math.max(0, ms) / 1000;
        return String.format(java.util.Locale.US, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60);
    }

    // Atualiza o tempo no overlay (CC lê do RemoteMediaClient; DLNA faz GetPositionInfo).
    private final Runnable castPoll = new Runnable() {
        @Override public void run() {
            if (castMode == CAST_CC) {
                com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc();
                if (r != null) { lastRemotePosMs = r.getApproximateStreamPosition(); lastRemoteDurMs = r.getStreamDuration(); updatePlayIcon(r.isPlaying()); }
                if (castTimeTv != null) castTimeTv.setText(fmtClock(lastRemotePosMs) + " / " + fmtClock(lastRemoteDurMs));
                progressHandler.postDelayed(this, 1000);
            } else if (castMode == CAST_DLNA && dlnaCtrl != null) {
                final String c = dlnaCtrl;
                new Thread(() -> {
                    long[] pd; try { pd = DlnaCastPlugin.getPositionSync(c); } catch (Exception e) { pd = null; }
                    final long[] f = pd;
                    runOnUiThread(() -> {
                        if (castMode != CAST_DLNA) return;
                        if (f != null) { lastRemotePosMs = f[0]; lastRemoteDurMs = f[1]; }
                        if (castTimeTv != null) castTimeTv.setText(fmtClock(lastRemotePosMs) + " / " + fmtClock(lastRemoteDurMs));
                    });
                }).start();
                progressHandler.postDelayed(this, 2000);
            }
        }
    };

    private void castViaChromecast() {
        final com.google.android.gms.cast.framework.CastContext castContext;
        try {
            castContext = com.google.android.gms.cast.framework.CastContext.getSharedInstance(this);
        } catch (Exception e) {
            android.widget.Toast.makeText(this, "Chromecast indisponível (atualize o Google Play Services).", android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        // Já conectado numa sessão? carrega direto.
        com.google.android.gms.cast.framework.CastSession cur = castContext.getSessionManager().getCurrentCastSession();
        if (cur != null && cur.isConnected()) { registerCastListener(castContext); loadOnCast(cur); return; }

        // Descobre os dispositivos Cast na rede (mDNS) e lista num AlertDialog (o tema
        // desta Activity não é AppCompat, então evitamos o chooser nativo do Cast SDK).
        final androidx.mediarouter.media.MediaRouter router = androidx.mediarouter.media.MediaRouter.getInstance(this);
        final androidx.mediarouter.media.MediaRouteSelector selector = new androidx.mediarouter.media.MediaRouteSelector.Builder()
            .addControlCategory(com.google.android.gms.cast.CastMediaControlIntent.categoryForCast(
                com.google.android.gms.cast.CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID))
            .build();
        final androidx.mediarouter.media.MediaRouter.Callback cb = new androidx.mediarouter.media.MediaRouter.Callback() {};
        router.addCallback(selector, cb, androidx.mediarouter.media.MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN);
        android.widget.Toast.makeText(this, "Procurando Chromecast na rede…", android.widget.Toast.LENGTH_SHORT).show();

        progressHandler.postDelayed(() -> {
            final List<androidx.mediarouter.media.MediaRouter.RouteInfo> routes = new ArrayList<>();
            for (androidx.mediarouter.media.MediaRouter.RouteInfo r : router.getRoutes()) {
                if (r.matchesSelector(selector) && !r.isDefaultOrBluetooth()) routes.add(r);
            }
            router.removeCallback(cb);
            if (routes.isEmpty()) {
                android.widget.Toast.makeText(this, "Nenhum Chromecast encontrado — confira se está no mesmo Wi-Fi.", android.widget.Toast.LENGTH_LONG).show();
                return;
            }
            String[] names = new String[routes.size()];
            for (int i = 0; i < routes.size(); i++) names[i] = routes.get(i).getName();
            new AlertDialog.Builder(this).setTitle("Chromecast").setItems(names, (d, i) -> {
                registerCastListener(castContext);
                castConnected = false;
                android.widget.Toast.makeText(this, "Conectando a " + routes.get(i).getName() + "…", android.widget.Toast.LENGTH_SHORT).show();
                routes.get(i).select();
                // Se em 15s não abrir sessão, provavelmente a TV não tem Cast integrado.
                progressHandler.postDelayed(() -> {
                    if (!castConnected) android.widget.Toast.makeText(this, "Não conectou. Essa TV tem Chromecast/Google Cast integrado? (TV só-DLNA não funciona pelo Chromecast — use a opção DLNA.)", android.widget.Toast.LENGTH_LONG).show();
                }, 15000);
            }).show();
        }, 4000);
    }

    private void registerCastListener(com.google.android.gms.cast.framework.CastContext castContext) {
        castSessionManager = castContext.getSessionManager();
        if (castSessionListener != null) return;
        castSessionListener = new com.google.android.gms.cast.framework.SessionManagerListener<com.google.android.gms.cast.framework.CastSession>() {
            @Override public void onSessionStarted(com.google.android.gms.cast.framework.CastSession s, String id) { castConnected = true; updateCastButton(true); loadOnCast(s); }
            @Override public void onSessionResumed(com.google.android.gms.cast.framework.CastSession s, boolean w) { castConnected = true; updateCastButton(true); loadOnCast(s); }
            @Override public void onSessionStartFailed(com.google.android.gms.cast.framework.CastSession s, int err) {
                castConnected = true; // já respondeu (com falha) — não dispara o timeout
                updateCastButton(false);
                android.widget.Toast.makeText(PlayerActivity.this, "Falha ao conectar no Chromecast (código " + err + ").", android.widget.Toast.LENGTH_LONG).show();
            }
            @Override public void onSessionStarting(com.google.android.gms.cast.framework.CastSession s) {
                android.widget.Toast.makeText(PlayerActivity.this, "Estabelecendo sessão Cast…", android.widget.Toast.LENGTH_SHORT).show();
            }
            @Override public void onSessionEnding(com.google.android.gms.cast.framework.CastSession s) {}
            @Override public void onSessionEnded(com.google.android.gms.cast.framework.CastSession s, int e) { castConnected = false; updateCastButton(false); stopCasting(true); }
            @Override public void onSessionResuming(com.google.android.gms.cast.framework.CastSession s, String id) {}
            @Override public void onSessionResumeFailed(com.google.android.gms.cast.framework.CastSession s, int e) {}
            @Override public void onSessionSuspended(com.google.android.gms.cast.framework.CastSession s, int r) { castConnected = false; updateCastButton(false); }
        };
        castSessionManager.addSessionManagerListener(castSessionListener, com.google.android.gms.cast.framework.CastSession.class);
    }

    private void loadOnCast(com.google.android.gms.cast.framework.CastSession session) {
        com.google.android.gms.cast.framework.media.RemoteMediaClient rmc = session.getRemoteMediaClient();
        if (rmc == null) { android.widget.Toast.makeText(this, "Chromecast conectou, mas o player remoto não respondeu.", android.widget.Toast.LENGTH_LONG).show(); return; }
        // Diagnóstico: se o receiver falhar ao tocar (fica "carregando" e vai a IDLE/erro),
        // avisa que foi formato/rede em vez de travar mudo.
        if (!castMediaCbSet) {
            castMediaCbSet = true;
            rmc.registerCallback(new com.google.android.gms.cast.framework.media.RemoteMediaClient.Callback() {
                @Override public void onStatusUpdated() {
                    com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc();
                    if (r != null && r.getPlayerState() == com.google.android.gms.cast.MediaStatus.PLAYER_STATE_IDLE
                        && r.getIdleReason() == com.google.android.gms.cast.MediaStatus.IDLE_REASON_ERROR) {
                        android.widget.Toast.makeText(PlayerActivity.this, "Chromecast: erro ao reproduzir o vídeo (formato/rede não suportado pelo receiver).", android.widget.Toast.LENGTH_LONG).show();
                    }
                }
            });
        }
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        // O Chromecast busca a URL sozinho e o CDN costuma bloquear (IP/fingerprint)
        // ou servir HLS gzip que o receiver não parseia → fica "carregando". Serve
        // pela LAN: o Chromecast busca do celular (refaz fetch com headers, descomprime
        // gzip, reescreve o HLS). Fallback = URL direta se não achar o IP.
        String ip = localIp();
        String castUrl = ip != null ? ProxyServer.lan(currentUrl, mReferer, ip) : currentUrl;
        com.google.android.gms.cast.MediaMetadata md = new com.google.android.gms.cast.MediaMetadata(com.google.android.gms.cast.MediaMetadata.MEDIA_TYPE_MOVIE);
        md.putString(com.google.android.gms.cast.MediaMetadata.KEY_TITLE, title != null ? title : "WatchMov");
        com.google.android.gms.cast.MediaInfo info = new com.google.android.gms.cast.MediaInfo.Builder(castUrl)
            .setStreamType(com.google.android.gms.cast.MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(castContentType(currentUrl))
            .setMetadata(md)
            .build();
        com.google.android.gms.cast.MediaLoadRequestData req = new com.google.android.gms.cast.MediaLoadRequestData.Builder()
            .setMediaInfo(info).setAutoplay(true)
            .setCurrentTime(player != null ? player.getCurrentPosition() : 0)
            .build();
        android.widget.Toast.makeText(this, "Enviando vídeo pro Chromecast…", android.widget.Toast.LENGTH_SHORT).show();
        rmc.load(req).setResultCallback(result -> {
            if (result.getStatus().isSuccess()) {
                android.widget.Toast.makeText(this, "Tocando no Chromecast — o app vira controle.", android.widget.Toast.LENGTH_LONG).show();
                startCasting(CAST_CC, null);
            } else {
                android.widget.Toast.makeText(this, "Chromecast conectou mas recusou o vídeo (código " + result.getStatus().getStatusCode() + "). Formato pode não ser suportado.", android.widget.Toast.LENGTH_LONG).show();
            }
        });
    }

    private String castContentType(String url) {
        String p = url != null ? url.split("\\?")[0].toLowerCase() : "";
        if (p.endsWith(".m3u8") || p.contains("master") || p.contains("/m3/") || p.endsWith(".txt")) return "application/x-mpegurl";
        if (p.endsWith(".mpd")) return "application/dash+xml";
        return "video/mp4";
    }

    // ---- DLNA / UPnP (fallback) ----
    // Espelhar na TV: descobre DLNA → escolhe → manda a URL atual (a TV toca).
    private void castViaDlna() {
        android.widget.Toast.makeText(this, "Procurando TVs na rede…", android.widget.Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            final java.util.List<DlnaCastPlugin.Device> devs = DlnaCastPlugin.discoverSync(this, 6000);
            runOnUiThread(() -> {
                if (devs.isEmpty()) {
                    String msg = DlnaCastPlugin.lastRawResponses == 0
                        ? "Nenhuma resposta na rede — ative o compartilhamento/DLNA na TV e use o mesmo Wi-Fi (roteador pode isolar dispositivos)."
                        : "Recebi " + DlnaCastPlugin.lastRawResponses + " respostas, mas nenhuma TV com DLNA compatível.";
                    android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_LONG).show();
                    return;
                }
                String[] names = new String[devs.size()];
                for (int i = 0; i < devs.size(); i++) names[i] = devs.get(i).name;
                new AlertDialog.Builder(this).setTitle("Enviar para a TV").setItems(names, (d, i) -> {
                    final DlnaCastPlugin.Device dev = devs.get(i);
                    android.widget.Toast.makeText(this, "Enviando para " + dev.name + "…", android.widget.Toast.LENGTH_SHORT).show();
                    new Thread(() -> {
                        String err = null;
                        // A TV não alcança a URL do CDN (punycode/HLS) → "resource not found".
                        // Serve pela LAN: a TV busca do celular (que refaz o fetch com headers,
                        // descomprime gzip e reescreve o HLS). Fallback = URL direta.
                        String ip = localIp();
                        String castUrl = ip != null ? ProxyServer.lan(currentUrl, mReferer, ip) : currentUrl;
                        try { DlnaCastPlugin.castSync(dev.controlUrl, castUrl, "WatchMov"); }
                        catch (Exception e) { err = e.getMessage() != null ? e.getMessage() : e.toString(); }
                        final String ferr = err;
                        runOnUiThread(() -> {
                            android.widget.Toast.makeText(this, ferr == null ? "Tocando na TV — o app vira controle" : ferr, android.widget.Toast.LENGTH_LONG).show();
                            if (ferr == null) startCasting(CAST_DLNA, dev.controlUrl);
                        });
                    }).start();
                }).show();
            });
        }).start();
    }

    // IP que a TV/Chromecast (no Wi-Fi) consegue alcançar. ANTES pegava o 1º IPv4
    // não-loopback — que num aparelho com dados móveis podia ser a interface de
    // celular (rmnet) → a TV não alcançava e dava "resource not found"/trava.
    private String localIp() {
        // 1) IP do Wi-Fi direto (o correto p/ a TV na mesma rede).
        try {
            android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) getApplicationContext().getSystemService(android.content.Context.WIFI_SERVICE);
            if (wm != null && wm.getConnectionInfo() != null) {
                int ip = wm.getConnectionInfo().getIpAddress(); // little-endian
                if (ip != 0) return String.format(java.util.Locale.US, "%d.%d.%d.%d", ip & 0xff, (ip >> 8) & 0xff, (ip >> 16) & 0xff, (ip >> 24) & 0xff);
            }
        } catch (Exception ignored) {}
        // 2) Fallback: endereço site-local (192.168/10/172.16-31), pulando loopback/celular.
        try {
            for (java.util.Enumeration<java.net.NetworkInterface> en = java.net.NetworkInterface.getNetworkInterfaces(); en.hasMoreElements();) {
                java.net.NetworkInterface ni = en.nextElement();
                if (ni.isLoopback() || !ni.isUp()) continue;
                for (java.util.Enumeration<java.net.InetAddress> ia = ni.getInetAddresses(); ia.hasMoreElements();) {
                    java.net.InetAddress a = ia.nextElement();
                    if (a instanceof java.net.Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        return null; // sem IP LAN confiável → chamador usa a URL direta
    }

    private void showLinks() {
        if (urls == null || urls.length == 0) return;
        String[] labels = new String[urls.length];
        for (int i = 0; i < urls.length; i++) {
            String m = (mimes != null && i < mimes.length && mimes[i] != null) ? mimes[i] : "";
            String tag = m.contains("mpegurl") ? "HLS" : m.contains("dash") ? "DASH" : "MP4";
            String q = (qualities != null && i < qualities.length && qualities[i] != null && !qualities[i].isEmpty()) ? qualities[i] : qualityFromUrl(urls[i]);
            labels[i] = "Link " + (i + 1) + " (" + tag + ")" + (q.isEmpty() ? "" : " " + q) + (urls[i].equals(currentUrl) ? "  ✓" : "");
        }
        final long pos = player != null ? player.getCurrentPosition() : 0;   // continua no mesmo tempo
        new AlertDialog.Builder(this)
            .setTitle("Trocar link")
            .setItems(labels, (d, i) -> playUrl(urls[i], mimes != null && i < mimes.length ? mimes[i] : null, pos))
            .show();
    }

    private void finishWithResult(boolean next, boolean server) {
        saveResume();
        Intent data = new Intent();
        if (player != null) data.putExtra(RESULT_POSITION, player.getCurrentPosition());
        data.putExtra(RESULT_URL, currentUrl);
        data.putExtra(RESULT_NEXT, next);
        data.putExtra(RESULT_SERVER, server);
        setResult(RESULT_OK, data);
        resultSaved = true;
        finish();
    }

    @Override
    public void onBackPressed() { finishWithResult(false, false); }

    @Override
    protected void onPause() {
        saveResume();
        // Back moderno/gesto/home nem sempre chama onBackPressed → salva aqui também.
        if (!resultSaved && player != null) {
            NativePlayerPlugin.reportProgress(currentUrl, player.getCurrentPosition(), player.getDuration());
            Intent data = new Intent();
            data.putExtra(RESULT_POSITION, player.getCurrentPosition());
            data.putExtra(RESULT_URL, currentUrl);
            setResult(RESULT_OK, data);
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        progressHandler.removeCallbacks(progressTick);
        progressHandler.removeCallbacks(castPoll);
        if (player != null) { player.release(); player = null; }
        if (castSessionManager != null && castSessionListener != null) {
            castSessionManager.removeSessionManagerListener(castSessionListener, com.google.android.gms.cast.framework.CastSession.class);
        }
        super.onDestroy();
    }

    private Button pill(String text, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(18);
        b.setBackgroundColor(Color.parseColor("#99000000"));
        b.setPadding(48, 26, 48, 26);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = 14;
        b.setLayoutParams(lp);
        if (onClick != null) b.setOnClickListener(onClick);
        return b;
    }
}
