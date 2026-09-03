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
public class PlayerActivity extends Activity implements MediaNotificationService.Controller {

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
    public static final String EXTRA_OFFLINE = "offline";
    public static final String EXTRA_DOWNLOADED = "downloaded";   // ep tem download concluído
    private static final long WATCHED_THRESHOLD_MS = 60000;   // "visto" quando falta 1 min pro fim
    public static final String RESUME_PREFS = "watchmov_resume";
    public static final String RESULT_POSITION = "positionMs";
    public static final String RESULT_URL = "url";
    public static final String RESULT_NEXT = "next";
    public static final String RESULT_SERVER = "server";
    public static final String RESULT_RECAPTURE = "recapture";
    public static final String RESULT_WATCHED = "watched";
    // De QUAL episódio o "assistido" acima está falando (tmdbId:type:season:ep). Sem
    // isto o JS aplicava a marcação no ep que ABRIU o player: depois de um "Próximo"
    // (in-place ou reabrindo), marcar o ep novo marcava — ou DESMARCAVA — o anterior.
    public static final String RESULT_WATCHED_KEY = "watchedKey";

    // Activity VIVA (só existe uma). O "Próximo episódio" NÃO fecha mais o player:
    // o JS resolve o link do próximo ep e entrega aqui (loadNextInPlace) — assim a
    // sessão DLNA/Chromecast, o proxy e o overlay nunca se perdem na troca.
    private static PlayerActivity current;
    public static PlayerActivity current() { return current; }

    private ExoPlayer player;
    private DefaultTrackSelector trackSelector;
    private Button qualityBtn;
    private Button nextBtn;                       // "Próximo ⏭" da barra de cima
    private Button nextCastBtn;                   // "Próximo episódio ▶|" do overlay do cast
    private TextView wmTitleTv;                   // título dentro do controller
    private OkHttpDataSource.Factory httpFactory; // headers (Referer) do ep atual
    private PlayerView view;
    private TextView status;
    private String currentUrl;
    private String mMime;                         // mime do ep ATUAL (muda no loadNext)
    private String mTitle;                        // título do ep ATUAL (muda no loadNext)
    private boolean awaitingNext = false;         // pediu o próximo ep ao JS, esperando resposta
    private String[] urls;
    private boolean errorHandled = false; // evita tratar o MESMO link 2x (ExoPlayer às vezes emite erro repetido)
    private final java.util.HashSet<String> triedUrls = new java.util.HashSet<>(); // links que já falharam (não repetir)
    private String[] mimes;
    private String[] qualities;
    private String mReferer;
    private boolean offline = false;              // item baixado → toca do cache (CacheDataSource)
    private boolean downloaded = false;           // ep tem download concluído (só indicador)
    private Button dlBtn;                         // "⤓" no topo: destaque = baixado
    private TextView sourceTv;                    // "Baixado"/"Servidor" na barra de baixo
    private Button castWatchedBtn;                // "concluído" no overlay do espelhamento
    private boolean hasNext = false;
    private boolean watched = false;              // estado atual do "assistido"
    private boolean userUnwatched = false;        // desmarcou manual → não auto-marcar de novo
    private android.widget.ImageButton watchedBtn;
    private android.widget.ImageButton shareBtn;   // enviar o vídeo pra outro app (WVC/VLC)
    private android.widget.ImageButton downloadBtn; // baixar o link atual (Media3/.exo x MP4)
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
            if (!watched && !userUnwatched && player != null) {
                long dur = player.getDuration(), pos = player.getCurrentPosition();
                if (dur > WATCHED_THRESHOLD_MS && pos >= dur - WATCHED_THRESHOLD_MS) setWatched(true);
            }
            refreshMediaNotification();   // posição fresca na barra de progresso da notificação
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

        current = this;
        currentUrl = getIntent().getStringExtra(EXTRA_URL);
        if (currentUrl == null) { finish(); return; }
        mMime = getIntent().getStringExtra(EXTRA_MIME);
        mTitle = getIntent().getStringExtra(EXTRA_TITLE);
        // O proxy precisa do Context pra servir content:// (MP4 exportado) pra TV, e do
        // título só pra rotular os eventos que ele mesmo emite na aba Bugs.
        ProxyServer.ensure(getApplicationContext());
        ProxyServer.currentTitle = mTitle;
        urls = getIntent().getStringArrayExtra(EXTRA_URLS);
        mimes = getIntent().getStringArrayExtra(EXTRA_MIMES);
        qualities = getIntent().getStringArrayExtra(EXTRA_QUALITIES);
        final String referer = getIntent().getStringExtra(EXTRA_REFERER);
        mReferer = referer;
        final String ua = getIntent().getStringExtra(EXTRA_UA);
        final long startMs = getIntent().getLongExtra(EXTRA_START_MS, 0);
        hasNext = getIntent().getBooleanExtra(EXTRA_HAS_NEXT, false);
        watched = getIntent().getBooleanExtra(EXTRA_WATCHED, false);
        offline = getIntent().getBooleanExtra(EXTRA_OFFLINE, false);
        downloaded = getIntent().getBooleanExtra(EXTRA_DOWNLOADED, false) || offline;
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

        wmTitleTv = view.findViewById(R.id.wm_title);
        wmTitleTv.setText(mTitle);

        sourceTv = view.findViewById(R.id.wm_source);
        watchedBtn = view.findViewById(R.id.wm_watched);
        watchedBtn.setColorFilter(watched ? Color.parseColor("#4ADE80") : Color.WHITE);
        watchedBtn.setOnClickListener(v -> toggleWatched());

        castBtn = view.findViewById(R.id.wm_cast);
        castBtn.setColorFilter(Color.WHITE);
        castBtn.setOnClickListener(v -> onCastButton());

        shareBtn = view.findViewById(R.id.wm_share);
        shareBtn.setOnClickListener(v -> onShareButton());
        refreshShareBtn();

        downloadBtn = view.findViewById(R.id.wm_download);
        if (downloadBtn != null) {
            downloadBtn.setColorFilter(Color.WHITE);
            downloadBtn.setOnClickListener(v -> onDownloadButton());
        }

        final LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(28, 24, 28, 24);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        Button back = pill("‹ Voltar", v -> finishWithResult(false, false));
        Button server = pill("▣ Servidor", v -> finishWithResult(false, true));
        Button links = pill("Links", v -> showLinks());
        // Indicador (não é botão de ação): destaque = este episódio está baixado.
        dlBtn = pill("⤓", v -> android.widget.Toast.makeText(this,
            downloaded ? "Episódio baixado no aparelho" : "Episódio não baixado", android.widget.Toast.LENGTH_SHORT).show());
        qualityBtn = pill("Auto", v -> showQuality());
        Button fwd60 = pill("+60s", v -> { if (player != null) player.seekTo(player.getCurrentPosition() + 60000); });
        nextBtn = pill("Próximo ⏭", v -> requestNext(false));
        Button speed = pill("1x", v -> {
            speedIdx = (speedIdx + 1) % speeds.length;
            if (player != null) player.setPlaybackParameters(new PlaybackParameters(speeds[speedIdx]));
            ((Button) v).setText(speeds[speedIdx] + "x");
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
        bar.addView(dlBtn);
        bar.addView(fwd60);
        bar.addView(nextBtn);
        nextBtn.setVisibility(hasNext ? View.VISIBLE : View.GONE);
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
        castStatusTv.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.92));   // "<título> — Reproduzindo…" quebra linha em vez de cortar
        castTimeTv = new TextView(this);
        castTimeTv.setTextColor(Color.parseColor("#B0FFFFFF")); castTimeTv.setTextSize(14); castTimeTv.setGravity(Gravity.CENTER);
        castTimeTv.setPadding(0, 12, 0, 24);
        LinearLayout castRow = new LinearLayout(this);
        castRow.setOrientation(LinearLayout.HORIZONTAL); castRow.setGravity(Gravity.CENTER);
        // castMsg em cada toque: se a faixa do topo NÃO aparecer, o toque não chegou
        // ao botão (problema de UI); se aparecer e a TV não reagir, é o comando UPnP.
        Button rew60 = pill("−60s", v -> { castMsg("−60s…", 1500); remoteSeekBy(-60000); });
        Button rew10 = pill("−10s", v -> { castMsg("−10s…", 1500); remoteSeekBy(-10000); });
        castPlayBtn = pill("⏸", v -> { castMsg(dlnaPaused ? "Continuar…" : "Pausar…", 1500); remotePlayPause(); });
        Button ff10 = pill("+10s", v -> { castMsg("+10s…", 1500); remoteSeekBy(10000); });
        Button ff60 = pill("+60s", v -> { castMsg("+60s…", 1500); remoteSeekBy(60000); });
        for (Button b : new Button[]{ rew60, rew10, castPlayBtn, ff10, ff60 }) {
            b.setTextSize(20); b.setPadding(28, 22, 28, 22);  // botões maiores
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(8, 0, 8, 0); b.setLayoutParams(lp);
        }
        castRow.addView(rew60); castRow.addView(rew10); castRow.addView(castPlayBtn); castRow.addView(ff10); castRow.addView(ff60);
        // Rolável na horizontal pra caber todos os botões (não cortar o +60s).
        android.widget.HorizontalScrollView castRowScroll = new android.widget.HorizontalScrollView(this);
        castRowScroll.setHorizontalScrollBarEnabled(false);
        castRowScroll.addView(castRow);
        // Linha 2 (abaixo de voltar/pausar/avançar): QUALIDADE na TV + VOLUME da TV.
        // Qualidade: o proxy entrega UMA variante pro cast (a TV não faz ABR) — por
        // padrão a maior; aqui dá pra BAIXAR se a internet não sustentar e voltar pra Máx.
        // Volume: "−"/"+" = ±10 % direto na TV; "Volume" mostra/esconde a barra; soltar a
        // barra manda pra TV (RenderingControl no DLNA, CastSession no Chromecast).
        // Layout pedido: [Qualidade: 720p]   (afastado)   [−] [Volume] [+]
        castQualityBtn = pill("Qualidade: Máx", v -> showCastQuality());
        volDownBtn = pill("−", v -> remoteVolumeBy(-10));
        volBtn = pill("Volume", v -> toggleVolumeBar());
        volUpBtn = pill("+", v -> remoteVolumeBy(10));
        LinearLayout castRow2 = new LinearLayout(this);
        castRow2.setOrientation(LinearLayout.HORIZONTAL); castRow2.setGravity(Gravity.CENTER);
        for (Button b : new Button[]{ castQualityBtn, volDownBtn, volBtn, volUpBtn }) {
            b.setTextSize(16); b.setPadding(28, 18, 28, 18);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(8, 18, 8, 0); b.setLayoutParams(lp);
        }
        // −/+ colados no "Volume" (leem como um grupo) e mais largos pra acertar com o dedo.
        for (Button b : new Button[]{ volDownBtn, volUpBtn }) {
            b.setPadding(40, 18, 40, 18);
            ((LinearLayout.LayoutParams) b.getLayoutParams()).setMargins(4, 18, 4, 0);
        }
        View volGap = new View(this);   // afasta o grupo Qualidade do grupo Volume
        castRow2.addView(castQualityBtn);
        castRow2.addView(volGap, new LinearLayout.LayoutParams(56, 1));
        castRow2.addView(volDownBtn); castRow2.addView(volBtn); castRow2.addView(volUpBtn);
        // Rolável como a linha 1 (não cortar o "+" em tela estreita); fillViewport centraliza.
        android.widget.HorizontalScrollView castRow2Scroll = new android.widget.HorizontalScrollView(this);
        castRow2Scroll.setHorizontalScrollBarEnabled(false);
        castRow2Scroll.setFillViewport(true);
        castRow2Scroll.addView(castRow2);
        volSeek = new android.widget.SeekBar(this);
        volSeek.setMax(100);
        volSeek.setVisibility(View.GONE);
        volSeek.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener() {
            @Override public void onStartTrackingTouch(android.widget.SeekBar sb) { volSeeking = true; }
            @Override public void onStopTrackingTouch(android.widget.SeekBar sb) {
                volSeeking = false;
                // Soltou a barra → esse passa a ser o volume conhecido; um "+" logo depois soma daqui.
                volKnown = true; remoteVolTarget = sb.getProgress(); remoteVolAppliedAt = android.os.SystemClock.elapsedRealtime();
                remoteVolumeSet(sb.getProgress());
            }
            @Override public void onProgressChanged(android.widget.SeekBar sb, int p, boolean fromUser) { if (fromUser) castMsg("Volume " + p, 900); }
        });
        // Próximo episódio SEM derrubar a TV: NÃO fecha mais a Activity. Pede o link do
        // próximo ep ao JS (evento playerNext) e troca a mídia AQUI (loadNextInPlace) —
        // a sessão DLNA/Chromecast continua viva, então não tem o que "reconectar".
        nextCastBtn = pill("Próximo episódio ▶|", v -> requestNext(true));
        nextCastBtn.setVisibility(hasNext ? View.VISIBLE : View.GONE);

        // Marcar concluído SEM sair do espelhamento (mesmo efeito do ✓ do reprodutor).
        // Não mexe na posição do player local — só na marcação.
        castWatchedBtn = pill("✓ Marcar como concluído", v -> {
            userUnwatched = watched;            // desmarcou na mão → não auto-marcar de novo
            setWatched(!watched);
            castMsg(watched ? "Marcado como concluído" : "Desmarcado", 2500);
        });

        Button stopCast = pill("Parar espelhamento", v -> {
            castMsg("Parando espelhamento…", 2500);
            if (castMode == CAST_CC && castSessionManager != null) castSessionManager.endCurrentSession(true);
            else stopCasting(true);
        });
        // Barra de progresso arrastável (controla o remoto: DLNA/CC).
        castSeek = new android.widget.SeekBar(this);
        castSeek.setMax(1000);
        castSeek.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener() {
            @Override public void onStartTrackingTouch(android.widget.SeekBar sb) { castSeeking = true; }
            @Override public void onStopTrackingTouch(android.widget.SeekBar sb) { castSeeking = false; remoteSeekTo((long) sb.getProgress() * 1000); }
            @Override public void onProgressChanged(android.widget.SeekBar sb, int p, boolean fromUser) {}
        });
        LinearLayout.LayoutParams seekLp = new LinearLayout.LayoutParams((int) (getResources().getDisplayMetrics().widthPixels * 0.7), ViewGroup.LayoutParams.WRAP_CONTENT);
        // Botões centralizados (fillViewport evita o scroll "colar" o conteúdo à
        // esquerda) e "Parar espelhamento" mais abaixo, separado dos controles.
        castRowScroll.setFillViewport(true);
        LinearLayout.LayoutParams nextLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nextLp.gravity = Gravity.CENTER_HORIZONTAL; nextLp.topMargin = 24;
        nextCastBtn.setLayoutParams(nextLp);
        LinearLayout.LayoutParams stopLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stopLp.gravity = Gravity.CENTER_HORIZONTAL; stopLp.topMargin = 56;
        stopCast.setLayoutParams(stopLp);
        castCol.addView(castStatusTv); castCol.addView(castTimeTv); castCol.addView(castSeek, seekLp);
        LinearLayout.LayoutParams doneLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        doneLp.gravity = Gravity.CENTER_HORIZONTAL; doneLp.topMargin = 16;
        castWatchedBtn.setLayoutParams(doneLp);
        // Ordem pedida: avançar/pausar → qualidade + volume (barra abaixo) → próximo
        // episódio (série) → concluído → parar espelhamento.
        LinearLayout.LayoutParams volLp = new LinearLayout.LayoutParams((int) (getResources().getDisplayMetrics().widthPixels * 0.6), ViewGroup.LayoutParams.WRAP_CONTENT);
        volLp.topMargin = 14;
        castCol.addView(castRowScroll); castCol.addView(castRow2Scroll); castCol.addView(volSeek, volLp);
        castCol.addView(nextCastBtn); castCol.addView(castWatchedBtn); castCol.addView(stopCast);
        castOverlay.addView(castCol, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        root.addView(castOverlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Avisos do espelhamento (procurando TVs, enviando, proxy, erros) numa faixa
        // FIXA NO TOPO — antes eram Toasts, que tapavam o vídeo e sumiam rápido.
        // Fica acima do "Reproduzindo na TV" e funciona mesmo com o overlay escondido.
        castMsgTv = new TextView(this);
        castMsgTv.setTextColor(Color.WHITE);
        castMsgTv.setTextSize(13);
        castMsgTv.setGravity(Gravity.CENTER);
        castMsgTv.setPadding(24, 14, 24, 14);
        castMsgTv.setBackgroundColor(Color.parseColor("#CC000000"));
        castMsgTv.setVisibility(View.GONE);
        FrameLayout.LayoutParams msgLp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP);
        msgLp.topMargin = 90;   // abaixo da barra superior (Voltar/Servidor/…)
        root.addView(castMsgTv, msgLp);

        setContentView(root);
        updateSourceUi();
        updateWatchedUi();

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
        httpFactory = http;
        applyRefererHeaders(referer);

        // Buffer maior p/ o HLS via proxy (cada segmento é um round-trip extra):
        // acumula mais antes de tocar e, sobretudo, ~15s após rebuffer → menos
        // travadas/paradas pra carregar. prioritizeTime = mantém a janela por tempo.
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(50000, 180000, 5000, 15000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();

        trackSelector = new DefaultTrackSelector(this);
        // ARQUIVO local (content:// do MP4 exportado, file://): o OkHttp não sabe abrir
        // esses esquemas e o player morria em ERROR_CODE_FAILED_RUNTIME_CHECK; o
        // DefaultDataSource resolve content/file/asset além de http.
        // Offline (cache Media3): CacheDataSource, sem rede. Online: OkHttp (descomprime
        // o gzip do m3u8).
        boolean arquivoLocal = currentUrl != null
            && !(currentUrl.startsWith("http://") || currentUrl.startsWith("https://"));
        androidx.media3.exoplayer.source.MediaSource.Factory msFactory = arquivoLocal
            ? new DefaultMediaSourceFactory(new androidx.media3.datasource.DefaultDataSource.Factory(this))
            : offline
                ? new DefaultMediaSourceFactory(DownloadUtil.getPlaybackCacheFactory(this))
                : new DefaultMediaSourceFactory(http);
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(msFactory)
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
                    localVideoH = size.height;   // MP4 no cast: é a altura do arquivo (não tem variantes)
                    NativePlayerPlugin.reportQuality(currentUrl, size.height);
                }
            }
            @Override public void onIsPlayingChanged(boolean isPlaying) { refreshMediaNotification(); }
            @Override public void onPlayerError(PlaybackException error) {
                // Detalha o motivo (código + causa: ex. "Response code: 403", codec, etc.)
                // pra diagnosticar o SuperFlix — o Weslley manda esse texto.
                String cause = error.getCause() != null ? (" — " + error.getCause().getClass().getSimpleName()
                    + (error.getCause().getMessage() != null ? ": " + error.getCause().getMessage() : "")) : "";
                String msg = "Erro: " + error.getErrorCodeName() + " (" + error.errorCode + ")" + cause;
                status.setText(msg);
                status.setVisibility(View.VISIBLE);
                android.widget.Toast.makeText(PlayerActivity.this, msg, android.widget.Toast.LENGTH_LONG).show();
                // Registra o motivo REAL no banco (aba "Bugs") — cause já tem classe+msg.
                String causeTxt = error.getCause() != null
                    ? error.getCause().getClass().getSimpleName()
                      + (error.getCause().getMessage() != null ? ": " + error.getCause().getMessage() : "")
                    : null;
                int httpCode = (error.getCause() instanceof androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException)
                    ? ((androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) error.getCause()).responseCode : 0;
                // Anexa o diagnóstico do proxy (o que o upstream REALMENTE devolveu) —
                // pra achar a causa do SuperFlix no device via wm_playback_errors.
                String causeFull = (causeTxt == null ? "" : causeTxt) + " || proxy{" + ProxyServer.lastDiag + "}";
                NativePlayerPlugin.reportError(currentUrl, error.errorCode, httpCode, error.getErrorCodeName(),
                    causeFull, mMime, mReferer, mTitle);
                // AUTO-AVANÇA: o link falhou (inclui muro 451, googlevideo 403, 500, etc.)
                // → tenta sozinho o PRÓXIMO link ainda não tentado. NÃO vai pro Servidor
                // automaticamente. Se acabarem os links, fica no player com aviso (o user
                // decide: ▣ Servidor ou Links). errorHandled evita tratar o mesmo link 2x.
                if (errorHandled) return;
                errorHandled = true;
                final int total = urls != null ? urls.length : 0;
                final int failedIdx = linkIndex();   // 0-based do link que falhou
                if (currentUrl != null) triedUrls.add(currentUrl);
                String nextUrl = null, nextMime = null; int nextIdx = -1;
                if (urls != null) {
                    // Segue a sequência PRA FRENTE a partir do link que falhou: escolheu o
                    // 6 e falhou → tenta 7, 8, 9… NÃO volta pro 1 (se o user quisesse o 1
                    // teria escolhido o 1). Acabou a lista → para. Se o link atual não está
                    // em urls[] (failedIdx<0), começa do início.
                    for (int i = Math.max(failedIdx + 1, 0); i < urls.length; i++) {
                        if (urls[i] != null && !triedUrls.contains(urls[i]) && !isTrackOnly(urls[i])) {
                            nextUrl = urls[i]; nextIdx = i;
                            nextMime = (mimes != null && i < mimes.length) ? mimes[i] : null;
                            break;
                        }
                    }
                }
                String falhou = "Link " + (failedIdx >= 0 ? (failedIdx + 1) : "?") + "/" + total + " falhou";
                if (nextUrl != null) {
                    status.setText(falhou + " — tentando " + (nextIdx + 1) + "/" + total + "…");
                    final String nu = nextUrl, nm = nextMime;
                    progressHandler.postDelayed(() -> playUrl(nu, nm, 0), 700);
                } else {
                    status.setText(falhou + ". Nenhum link tocou — toque em ▣ Servidor ou Links.");
                }
            }
            @Override public void onPlaybackStateChanged(int state) {
                refreshMediaNotification();
                if (state == androidx.media3.common.Player.STATE_READY || state == androidx.media3.common.Player.STATE_ENDED) status.setVisibility(View.GONE);
                else if (state == androidx.media3.common.Player.STATE_BUFFERING) {
                    int i = linkIndex(), n = urls != null ? urls.length : 0;
                    status.setText(n > 1 && i >= 0 ? "Carregando vídeo… (link " + (i + 1) + "/" + n + ")" : "Carregando vídeo…");
                    status.setVisibility(View.VISIBLE);
                }
            }
        });

        // Abrindo já espelhando: NÃO inicia o vídeo local — os dois puxariam o MESMO
        // HLS pelo MESMO proxy e a TV perdia banda/conexão logo após a troca. Vale pra
        // QUALQUER sessão viva, não só a que veio do "Próximo": abrir um episódio
        // diferente do espelhado deixava celular e TV tocando em paralelo.
        // DLNA sem controller é sessão fantasma (não dá pra mandar mídia) → local toca.
        castSilentStart = activeCastMode != CAST_NONE
            && (activeCastMode != CAST_DLNA || activeDlnaCtrl != null);
        playUrl(currentUrl, mMime, resolvedStart);

        // Veio do "Próximo episódio" com a TV conectada: reenvia a NOVA mídia pro mesmo
        // dispositivo (sem desconectar) e segue espelhando.
        if (castFollowNext || activeCastMode != CAST_NONE) {
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "PLAYER_ABERTO_CAST",
                "[recast] abriu: follow=" + castFollowNext + " activeCastMode=" + activeCastMode
                + " ctrl=" + (activeDlnaCtrl != null) + " key=" + resumeKey + " activeKey=" + activeCastKey,
                mMime, mReferer, mTitle);
        }
        if (castFollowNext) {
            castFollowNext = false;
            if (activeCastMode != CAST_NONE) {
                recastCurrent();
            } else {
                // Diagnóstico: veio do "Próximo" mas o estado do cast se perdeu no
                // caminho (é o que faz o usuário ter de reconectar) → registra pra ler.
                NativePlayerPlugin.reportError(currentUrl, 0, 0, "RECAST_SEM_SESSAO",
                    "[recast] castFollowNext=true mas activeCastMode=NONE (estado do cast perdido ao trocar de episódio)",
                    mMime, mReferer, mTitle);
            }
        }
        // Retoma o espelhamento se voltamos pro MESMO título e há cast ativo (o vídeo
        // segue na TV): reabre o overlay/controles sem re-castar (pausa o local de novo).
        else if (activeCastMode != CAST_NONE && resumeKey != null && resumeKey.equals(activeCastKey)) {
            if (activeCastMode == CAST_DLNA && activeDlnaCtrl != null) {
                startCasting(CAST_DLNA, activeDlnaCtrl);
            } else if (activeCastMode == CAST_CC) {
                try {
                    com.google.android.gms.cast.framework.CastSession cs = com.google.android.gms.cast.framework.CastContext.getSharedInstance(this).getSessionManager().getCurrentCastSession();
                    if (cs != null && cs.isConnected()) startCasting(CAST_CC, null);
                } catch (Exception ignored) {}
            }
        }
        // Episódio DIFERENTE do que está na TV (abriu o próximo pela lista, sem passar
        // pelo "Próximo episódio"): antes isto não caía em ramo NENHUM — a TV continuava
        // no episódio velho, o celular tocava o novo em paralelo e `activeCastKey` ficava
        // mentindo pro app inteiro (castStatus/getCastNow → tag "Espelhado" e o "Marcar
        // como concluído" do overlay falavam do ep errado). Agora reaponta a sessão.
        else if (activeCastMode != CAST_NONE && resumeKey != null) {
            boolean assumiu = false;
            if (activeCastMode == CAST_DLNA && activeDlnaCtrl != null) {
                startCasting(CAST_DLNA, activeDlnaCtrl);   // regrava activeCastKey = resumeKey
                recastCurrent(resolvedStart);              // …e manda a NOVA mídia pra TV
                assumiu = true;
            } else if (activeCastMode == CAST_CC) {
                try {
                    com.google.android.gms.cast.framework.CastSession cs = com.google.android.gms.cast.framework.CastContext.getSharedInstance(this).getSessionManager().getCurrentCastSession();
                    if (cs != null && cs.isConnected()) {
                        startCasting(CAST_CC, null);
                        recastCurrent(resolvedStart);
                        assumiu = true;
                    }
                } catch (Exception ignored) {}
            }
            if (!assumiu) {
                // Sessão fantasma (Chromecast já desconectado): sem isto a tela ficaria
                // muda e parada, porque o local foi silenciado lá em cima.
                activeCastMode = CAST_NONE; activeCastKey = null; activeCastTitle = null;
                CastSessionStore.clear(this);
                castSilentStart = false;
                if (player != null) { player.setVolume(1f); player.setPlayWhenReady(true); }
            }
        }

        // Notificação de mídia (barra + tela bloqueada): ⏯ e, em série, ⏭ — controla o
        // local OU a TV com o celular bloqueado/em outro app. Vive enquanto o player vive.
        MediaNotificationService.setController(this);
        ensureNotifPermission();
        refreshMediaNotification();
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
            userUnwatched = true; // desmarcou de propósito → não deixa o tick re-marcar
            setWatched(false);
        }
    }

    private void setWatched(boolean w) {
        if (watched == w) return;
        watched = w;
        if (watchedBtn != null) watchedBtn.setColorFilter(w ? Color.parseColor("#4ADE80") : Color.WHITE);
        updateWatchedUi();
        NativePlayerPlugin.reportWatched(w, resumeKey);   // sempre com a chave do ep ATUAL
    }

    private void updateWatchedUi() {
        if (castWatchedBtn == null) return;
        castWatchedBtn.setText(watched ? "✓ Concluído" : "✓ Marcar como concluído");
        castWatchedBtn.setTextColor(watched ? Color.parseColor("#4ADE80") : Color.WHITE);
    }

    // De onde o vídeo vem AGORA (barra de baixo) e se o episódio está baixado (topo).
    private void updateSourceUi() {
        if (sourceTv != null) {
            // "downloaded" cobre o MP4 local, que roda com offline=false (não passa pelo
            // proxy) mas é tão baixado quanto o cache.
            boolean doAparelho = offline || downloaded;
            sourceTv.setText(doAparelho ? "Baixado" : "Servidor");
            sourceTv.setTextColor(doAparelho ? Color.parseColor("#4ADE80") : Color.parseColor("#B0FFFFFF"));
        }
        if (dlBtn != null) {
            dlBtn.setText(downloaded ? "⤓ Baixado" : "⤓");
            dlBtn.setTextColor(downloaded ? Color.parseColor("#4ADE80") : Color.parseColor("#66FFFFFF"));
        }
    }

    private void saveResume() {
        if (resumeKey == null || resumePrefs == null || player == null) return;
        long pos = player.getCurrentPosition();
        if (pos > 3000) resumePrefs.edit().putLong(resumeKey, pos).apply();
    }

    // Posição (0-based) do link atual dentro de urls[] — pro contador "X/N".
    private int linkIndex() {
        if (urls == null || currentUrl == null) return -1;
        for (int i = 0; i < urls.length; i++) if (currentUrl.equals(urls[i])) return i;
        return -1;
    }

    private void playUrl(String url, String mime, long startMs) {
        currentUrl = url;
        ProxyServer.currentTitle = mTitle;   // rótulo dos eventos que o proxy emite (CAST_MASTER_INFO)
        errorHandled = false; // novo link → volta a permitir tratar erro
        // Link novo = qualidade entregue desconhecida até o proxy/player dizerem.
        localVideoH = 0; castDeliveredH = 0; fileHeightPending = false;
        updateCastQualityLabel();
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
        // HLS: toca via ProxyServer local (127.0.0.1). Vários CDNs BR (SuperFlix) servem
        // o m3u8 gzip/text-plain que o ExoPlayer recebe cru → "Input does not start with
        // #EXTM3U" (MANIFEST_MALFORMED). O proxy descomprime, garante #EXTM3U e reescreve
        // os segmentos (mesmo caminho que o cast já usa OK). MP4 toca direto.
        // Offline: baixamos via proxy (chaves de cache = URLs proxied) → toca sempre pelo
        // proxy pra bater no cache. Online: HLS via proxy, MP4 direto.
        // Instrumentação: com que tempo o player LOCAL abriu e em que chave — pra
        // separar "a TV pulou" de "o app mandou a posição errada".
        NativePlayerPlugin.reportError(url, 0, 0, "PLAYER_START",
            "[play] startMs=" + startMs + " key=" + resumeKey + " offline=" + offline
            + " silent=" + castSilentStart, mimeType, mReferer, mTitle);
        // Arquivo local (content:// do MP4 exportado, file://) NÃO passa pelo proxy: o
        // proxy só sabe falar HTTP e devolvia ERROR_CODE_IO_BAD_HTTP_STATUS ao tentar
        // "baixar" um content://.
        boolean rede = url.startsWith("http://") || url.startsWith("https://");
        String playUri = (rede && (offline || MimeTypes.APPLICATION_M3U8.equals(mimeType)))
            ? ProxyServer.local(url, mReferer) : url;
        MediaItem item = new MediaItem.Builder().setUri(playUri).setMimeType(mimeType).build();
        player.setMediaItem(item);
        if (startMs > 0) player.seekTo(startMs);
        player.setPlayWhenReady(!castSilentStart);
        if (castSilentStart) player.setVolume(0f);
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

    // Espelhar na TV: Chromecast, DLNA, espelhamento + players externos instalados
    // (Web Video Cast/VLC/MX) que recebem a URL atual (com Referer) e castam melhor.
    private void castToTv() {
        java.util.List<String> labels = new java.util.ArrayList<>();
        labels.add("Chromecast (Google Cast)");
        labels.add("Enviar para a TV (DLNA)");
        labels.add("Espelhar tela (qualquer formato)");
        final java.util.List<String> extPkgs = new java.util.ArrayList<>();
        android.content.pm.PackageManager pm = getPackageManager();
        for (String[] a : ExternalCastPlugin.APPS) {
            try { pm.getPackageInfo(a[1], 0); labels.add(a[2]); extPkgs.add(a[1]); } catch (Exception ignored) {}
        }
        new AlertDialog.Builder(this)
            .setTitle("Espelhar na TV")
            .setItems(labels.toArray(new String[0]), (d, i) -> {
                if (i == 0) castViaChromecast();
                else if (i == 1) castViaDlna();
                else if (i == 2) openScreenMirror();
                else openInExternal(extPkgs.get(i - 3));
            }).show();
    }

    private static final String UA_HANDOFF = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    // Detecta faixa ISOLADA (só vídeo ou só áudio): /m3/ = variante de vídeo,
    // /md/ = faixa de áudio. Sozinhas dão "sem som"/"só áudio" — não mandar.
    private static boolean isTrackOnly(String u) {
        String l = u.toLowerCase();
        return l.contains("/m3/") || l.contains("/md/") || l.contains("index-f") || l.matches(".*-v\\d-a\\d.*");
    }

    // Verde = este episódio já tem MP4 exportado (é só abrir no app externo).
    private void refreshShareBtn() {
        if (shareBtn == null) return;
        String key = ExportUtil.downloadKeyFromResume(resumeKey);
        boolean ready = key != null && ExportUtil.exported(this, key) != null;
        shareBtn.setColorFilter(ready ? Color.parseColor("#4ADE80") : Color.WHITE);
    }

    // Enviar pra outro app (Web Video Cast/VLC/MX). BAIXADO: converte num MP4 real em
    // Movies/WatchMov e abre o chooser — é o que faz a TV tocar, já que receptor DLNA
    // não engole HLS e o arquivo do download (SimpleCache em Android/data) é invisível
    // pros outros apps. NÃO baixado: manda a URL, como o handoff sempre fez.
    private void onShareButton() {
        final String key = ExportUtil.downloadKeyFromResume(resumeKey);
        if (!downloaded || key == null) { shareStreamUrl(); return; }
        android.net.Uri ready = ExportUtil.exported(this, key);
        if (ready != null) { ExportUtil.openWith(this, ready, mTitle); return; }
        if (ExportUtil.isRunning()) { castMsg("Já tem uma conversão em andamento…", 3000); return; }
        new AlertDialog.Builder(this)
            .setTitle("Enviar pra outro app")
            .setMessage("Converto o vídeo baixado num MP4 (fica em Movies/WatchMov) e abro o Web Video Cast/VLC — aí a TV toca direto. Leva alguns minutos; deixe o app aberto.")
            .setPositiveButton("Converter", (d, w) -> startExport(key))
            .setNeutralButton("Só mandar o link", (d, w) -> shareStreamUrl())
            .setNegativeButton("Cancelar", null)
            .show();
    }

    private void startExport(String key) {
        castMsg("Convertendo pra MP4…", 0);
        ExportUtil.start(this, key, mTitle, new ExportUtil.Cb() {
            @Override public void progress(int p) {
                castMsg(p >= 0 ? "Convertendo pra MP4… " + p + "%" : "Convertendo pra MP4…", 0);
            }
            @Override public void done(android.net.Uri uri, String name) {
                castMsg("Pronto: " + name, 4000);
                refreshShareBtn();
                ExportUtil.openWith(PlayerActivity.this, uri, mTitle);
            }
            @Override public void failed(String why) {
                castMsg("Não consegui converter: " + why, 7000);
            }
        });
    }

    // Baixar o link ATUAL direto do player (mesma escolha do ⤓ em "Links do vídeo"):
    // Media3 (.exo, cache que retoma e toca offline) OU MP4 (Movies/WatchMov, abre em
    // qualquer app). Reusa ExportUtil (MP4) e o mesmo enqueue do DownloaderPlugin (.exo).
    private void onDownloadButton() {
        if (currentUrl == null) { castMsg("Sem link pra baixar", 2500); return; }
        final String key = ExportUtil.downloadKeyFromResume(resumeKey);
        if (key == null) { castMsg("Não dá pra baixar este item", 2500); return; }
        new AlertDialog.Builder(this)
            .setTitle("Como quer baixar?")
            .setItems(new CharSequence[]{ "Media3 (.exo)", "MP4 em Movies/WatchMov" }, (d, which) -> {
                if (which == 0) dlAsMedia3(key); else dlAsMp4(key);
            })
            .setNegativeButton("Cancelar", null)
            .show();
    }

    private void dlAsMp4(String key) {
        castMsg("Baixando em MP4…", 3000);
        ExportUtil.startFromUrl(this, key, currentUrl, mReferer, mMime, mTitle, new ExportUtil.Cb() {
            @Override public void progress(int p) {}
            @Override public void done(android.net.Uri uri, String name) { castMsg("MP4 salvo: " + name, 4000); refreshShareBtn(); }
            @Override public void failed(String why) { castMsg("Falha no MP4: " + why, 6000); }
        });
    }

    private void dlAsMedia3(String key) {
        try {
            String proxied = ProxyServer.local(currentUrl, mReferer);
            androidx.media3.exoplayer.offline.DownloadRequest.Builder b =
                new androidx.media3.exoplayer.offline.DownloadRequest.Builder(key, android.net.Uri.parse(proxied));
            if (mMime != null && mMime.toLowerCase().contains("mpegurl")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
            if (mTitle != null) b.setData(mTitle.getBytes());
            androidx.media3.exoplayer.offline.DownloadService.sendAddDownload(
                this, WatchDownloadService.class, b.build(), true);
            castMsg("Baixando… acompanhe na aba Download", 4000);
        } catch (Exception e) { castMsg("Falha ao baixar: " + e, 6000); }
    }

    // Sem arquivo exportado: manda a URL (HLS vai pelo proxy da LAN, com áudio PT) pro
    // app que o usuário escolher no chooser.
    private void shareStreamUrl() {
        if (currentUrl == null) { castMsg("Sem link", 2500); return; }
        try {
            String url = currentUrl;
            String m = (mMime == null || mMime.isEmpty()) ? "video/*" : mMime;
            String lu = url.toLowerCase();
            boolean hls = m.toLowerCase().contains("mpegurl")
                || lu.contains(".m3u8") || lu.contains(".txt") || lu.contains("master")
                || lu.contains("/m3/") || lu.contains("playlist");
            if (hls) {
                if (!url.contains("/s?u=")) {
                    String ip = localIp();
                    if (ip != null) url = ProxyServer.lan(url, mReferer, ip);
                }
                if ("video/*".equals(m)) m = "application/x-mpegURL";
            }
            android.content.Intent view = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            view.setDataAndType(android.net.Uri.parse(url), m);
            if (mTitle != null) view.putExtra("title", mTitle);
            view.putExtra("secure_uri", true);
            android.os.Bundle hb = new android.os.Bundle();
            if (mReferer != null && !mReferer.isEmpty()) hb.putString("Referer", mReferer);
            hb.putString("User-Agent", UA_HANDOFF);
            view.putExtra("headers", hb);
            view.putExtra("com.android.browser.headers", hb);
            view.putExtra("android.media.intent.extra.HTTP_HEADERS", hb);
            android.content.Intent chooser = android.content.Intent.createChooser(view, "Abrir com");
            chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(chooser);
        } catch (Exception e) {
            castMsg("Não consegui abrir: " + e.getMessage(), 5000);
        }
    }

    // Handoff pro player externo. Manda a(s) MASTER (playlist completa áudio+vídeo);
    // ignora as faixas isoladas (/m3/,/md/) que sozinhas só têm vídeo OU áudio.
    private void openInExternal(String pkg) {
        if (currentUrl == null) { android.widget.Toast.makeText(this, "Sem link", android.widget.Toast.LENGTH_SHORT).show(); return; }
        final java.util.List<String> us = new java.util.ArrayList<>();
        final java.util.List<String> ms = new java.util.ArrayList<>();
        if (urls != null) {
            for (int i = 0; i < urls.length; i++) {
                String u = urls[i];
                if (u == null || isTrackOnly(u)) continue;
                us.add(u); ms.add(mimes != null && i < mimes.length ? mimes[i] : null);
            }
        }
        if (us.isEmpty()) { us.add(currentUrl); ms.add(mMime); }
        final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        for (int i = 0; i < us.size(); i++) {
            final int idx = i;
            h.postDelayed(() -> fireExternal(pkg, us.get(idx), ms.get(idx), idx), idx * 700L);
        }
    }

    private void fireExternal(String pkg, String url, String mime, int idx) {
        try {
            String m = (mime == null || mime.isEmpty())
                ? ((url.contains(".m3u8") || url.contains("master") || url.contains(".txt")) ? "application/x-mpegURL" : "video/*")
                : mime;
            // Áudio em PORTUGUÊS também no app externo (WVC/VLC/MX): manda pelo proxy
            // da LAN com &ap=pt — o mesmo caminho do DLNA, que REMOVE as faixas de
            // áudio não-PT do master (senão o player externo pega o inglês, que vem
            // marcado como DEFAULT no HLS). Sem IP de Wi-Fi, cai na URL original.
            String lu = url.toLowerCase();
            boolean hls = m.toLowerCase().contains("mpegurl")
                || lu.contains(".m3u8") || lu.contains(".txt") || lu.contains("master")
                || lu.contains("/m3/") || lu.contains("playlist");
            if (hls && !url.contains("/s?u=")) {          // não re-proxiar o que já é proxy
                String ip = localIp();
                if (ip != null) url = ProxyServer.lan(url, mReferer, ip);
            }
            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            intent.setPackage(pkg);
            intent.setDataAndType(android.net.Uri.parse(url), m);
            String t = mTitle;
            intent.putExtra("title", (t != null ? t : "") + (idx > 0 ? " #" + (idx + 1) : ""));
            intent.putExtra("secure_uri", true);
            android.os.Bundle hb = new android.os.Bundle();
            if (mReferer != null && !mReferer.isEmpty()) hb.putString("Referer", mReferer);
            hb.putString("User-Agent", UA_HANDOFF);
            intent.putExtra("headers", hb);
            intent.putExtra("com.android.browser.headers", hb);
            intent.putExtra("android.media.intent.extra.HTTP_HEADERS", hb);
            if (idx == 0) intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            // Registra a URL REAL entregue ao app externo — sem isso não dá pra saber
            // se o áudio veio errado por falta do ap=pt ou porque o player externo
            // ignora faixa alternativa de áudio.
            if (idx == 0) NativePlayerPlugin.reportError(url, 0, 0, "HANDOFF_EXTERNO",
                "[handoff] pkg=" + pkg + " mime=" + m, m, mReferer, mTitle);
            startActivity(intent);
        } catch (Exception e) {
            if (idx == 0) android.widget.Toast.makeText(this, "Não consegui abrir: " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show();
        }
    }

    // Espelhamento de tela do sistema (Miracast/Smart View): quem DECODIFICA é o
    // ExoPlayer do celular; a TV só reproduz a tela → toca QUALQUER formato, inclusive
    // os que o receptor DLNA da LG e o Chromecast recusam (MKV/HEVC/HLS raro). Custo:
    // qualidade/latência um pouco piores e o celular fica dedicado. Abre a tela do SO
    // (o usuário escolhe a TV e volta ao vídeo).
    private void openScreenMirror() {
        for (String a : new String[]{ "android.settings.CAST_SETTINGS", "android.settings.WIFI_DISPLAY_SETTINGS", android.provider.Settings.ACTION_DISPLAY_SETTINGS }) {
            try {
                startActivity(new Intent(a));
                android.widget.Toast.makeText(this, "Escolha sua TV em Espelhamento/Smart View e volte ao vídeo.", android.widget.Toast.LENGTH_LONG).show();
                return;
            } catch (Exception ignored) {}
        }
        android.widget.Toast.makeText(this, "Abra o espelhamento pelas Configurações rápidas do Android (Smart View/Transmitir).", android.widget.Toast.LENGTH_LONG).show();
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
        // Já espelhando (Chromecast OU DLNA) → oferece parar; senão abre a escolha.
        if (castMode != CAST_NONE) {
            new AlertDialog.Builder(this).setTitle("Espelhando na TV")
                .setMessage("Parar o espelhamento?")
                .setPositiveButton("Parar", (d, w) -> {
                    if (castMode == CAST_CC && castSessionManager != null) castSessionManager.endCurrentSession(true);
                    else stopCasting(true);
                })
                .setNegativeButton("Cancelar", null).show();
            return;
        }
        castToTv();
    }

    // ---- Espelhamento: controle remoto da TV (o player local pausa) ----
    static final int CAST_NONE = 0, CAST_CC = 1, CAST_DLNA = 2;   // package-private: CastSessionStore/MediaNotificationService leem
    private int castMode = CAST_NONE;
    // Sessão de cast ATIVA no nível do app (sobrevive ao fechar o player): permite
    // retomar o overlay/controles ao reabrir o MESMO título, sem re-castar.
    private static int activeCastMode = CAST_NONE;
    private static String activeDlnaCtrl;
    private static String activeCastKey;
    private static String activeCastTitle;     // o que está na TV (pro atalho do topo do app)

    /** Espelhamento ativo? (sobrevive ao fechar o player — os estados são estáticos.) */
    public static boolean isCasting() { return activeCastMode != CAST_NONE; }
    public static String castKey() { return activeCastKey; }
    public static String castTitle() { return activeCastTitle; }

    /**
     * Processo NOVO com a TV ainda tocando (MediaNotificationService.restoreIfAlive): repõe
     * os estáticos que castSilentStart/castStatus leem — o app volta a mostrar "espelhando
     * na TV" e o player, ao abrir o mesmo episódio, reassume sem re-castar.
     */
    static void restoreCastSession(CastSessionStore.Session s) {
        if (s == null) return;
        activeCastMode = s.mode;
        activeDlnaCtrl = s.mode == CAST_DLNA ? s.dlnaCtrl : null;
        activeDlnaRenderCtrl = s.renderCtrl;
        activeCastKey = s.key; activeCastTitle = s.title;
    }

    /** "Parar" na notificação com o app fechado / TV parou sozinha: sessão encerrada. */
    static void clearActiveCast() {
        activeCastMode = CAST_NONE; activeDlnaCtrl = null; activeDlnaRenderCtrl = null;
        activeCastKey = null; activeCastTitle = null;
    }

    // Grava a sessão de cast em prefs (CastSessionStore): é o que deixa o serviço seguir
    // sozinho com o app fechado e o app reassumir num processo novo. Chamado em todo
    // startCasting (1º cast, recast, troca de episódio) — sempre com a URL/chave atuais.
    private void saveCastSession() {
        if (castMode == CAST_NONE || currentUrl == null) return;
        CastSessionStore.Session s = new CastSessionStore.Session();
        s.mode = castMode;
        s.dlnaCtrl = castMode == CAST_DLNA ? dlnaCtrl : null;
        s.renderCtrl = activeDlnaRenderCtrl;
        s.url = currentUrl; s.referer = mReferer; s.mime = mMime; s.title = mTitle; s.key = resumeKey;
        s.tvIp = castTvIp; s.qualityH = castQualityH; s.hasNext = hasNext;
        s.offline = offline; s.downloaded = downloaded;
        CastSessionStore.save(this, s);
    }
    // "Próximo episódio" tocado no overlay do cast: a TV NÃO é desconectada — ao
    // reabrir com o novo episódio, reenviamos a mídia pro mesmo dispositivo.
    private static boolean castFollowNext = false;
    private boolean castSilentStart = false;   // abriu já espelhando → não toca local
    private long recastAtMs = 0;               // instante do recast (p/ diagnosticar queda)
    private boolean recastDropReported = false;
    private int recastRetries = 0;             // 1 reenvio automático por episódio (sem loop)
    private long recastTargetMs = 0;           // posição que PEDIMOS no último recast
    private volatile boolean recastPending = false;  // recast em voo: a TV ainda reporta a mídia VELHA
    private boolean posVelhaReportada = false; // registra 1x por troca que a TV devolveu a posição antiga
    private String dlnaCtrl;
    private boolean dlnaPaused = false;
    private long lastRemotePosMs = 0, lastRemoteDurMs = 0;
    // Geração da sessão de cast: incrementa a cada start/stop. O poll DLNA captura a
    // geração e só atualiza/reagenda se ainda for a mesma — evita que uma thread de
    // poll em voo (de uma sessão anterior) reagende um segundo laço em paralelo.
    private int castGen = 0;
    private FrameLayout castOverlay;
    private TextView castStatusTv, castTimeTv;
    private Button castPlayBtn;
    private Button castQualityBtn;             // "Qualidade: Máx/720p" no overlay do cast
    private int castQualityH = 0;              // altura escolhida pro cast (0 = maior bandwidth)
    private int castDeliveredH = 0;            // altura que a TV está RECEBENDO (proxy no HLS; arquivo no MP4)
    private int localVideoH = 0;               // altura reportada pelo player local (onVideoSizeChanged)
    private boolean fileHeightPending = false; // já tem thread lendo a altura do arquivo (MediaMetadataRetriever)
    private Button volBtn;                     // "Volume" — mostra/esconde a barra
    private Button volDownBtn, volUpBtn;       // "−"/"+" do overlay: ±10 % do volume da TV
    private android.widget.SeekBar volSeek;    // 0–100 → volume da TV
    private boolean volSeeking = false;
    private boolean volKnown = false;          // volSeek já reflete o volume REAL da TV nesta sessão
    // Volume relativo (−/+): alvo do último ajuste e quando foi aplicado — toques em
    // sequência SOMAM a partir do alvo (mesmo padrão de remoteSeekTarget/remoteSeekAppliedAt).
    private volatile int remoteVolTarget = -1;
    private volatile long remoteVolAppliedAt = 0;
    private String dlnaRenderCtrl;             // controlURL do RenderingControl (volume) da sessão atual
    private static String activeDlnaRenderCtrl;
    // ---- Vigia do envio (1º cast e recast) — diagnóstico do "conecta e fica carregando" ----
    private long castSentAtMs = 0;             // elapsedRealtime em que a TV ACEITOU o envio (0 = nada em vigia)
    private long castSentWallMs = 0;           // mesmo instante em epoch (o log de acesso do proxy usa epoch)
    private String castSentOrigem = "";        // "inicial" | "recast"
    private String castTvIp = null;            // IP da TV (host do controlUrl) → filtra o tráfego dela no proxy
    private final StringBuilder castStateLog = new StringBuilder();   // "+0.8s TRANSITIONING, +4.1s PLAYING"
    private String castLastState = null;
    private boolean castStateReported = false, castTrafficReported = false, castStuckHandled = false;
    private boolean recastStopFirst = false;   // próximo recast manda Stop antes (reenvio de TV travada)
    // Seek relativo (±10s/±60s): alvo do último seek e quando foi aplicado — toques em
    // sequência somam a partir do alvo, e o poll não sobrescreve a posição por ~3s.
    private volatile long remoteSeekTarget = 0, remoteSeekAppliedAt = 0;
    private final Object remoteSeekLock = new Object();
    private TextView castMsgTv;                 // faixa de avisos do cast (topo da tela)
    private final Runnable hideCastMsg = () -> { if (castMsgTv != null) castMsgTv.setVisibility(View.GONE); };

    // Aviso do espelhamento no TOPO (substitui os Toasts). ms<=0 = fica fixo.
    private void castMsg(String text, long ms) {
        if (castMsgTv == null) { android.widget.Toast.makeText(this, text, android.widget.Toast.LENGTH_LONG).show(); return; }
        castMsgTv.setText(text);
        castMsgTv.setVisibility(View.VISIBLE);
        progressHandler.removeCallbacks(hideCastMsg);
        if (ms > 0) progressHandler.postDelayed(hideCastMsg, ms);
    }

    private android.widget.SeekBar castSeek;
    private boolean castSeeking = false;

    private com.google.android.gms.cast.framework.media.RemoteMediaClient rmc() {
        com.google.android.gms.cast.framework.CastSession s = castSessionManager != null ? castSessionManager.getCurrentCastSession() : null;
        return s != null ? s.getRemoteMediaClient() : null;
    }

    // Conectou: pausa o player local e mostra o overlay de controle da TV.
    private void startCasting(int mode, String ctrl) {
        castGen++; // nova sessão — invalida qualquer poll da sessão anterior
        castMode = mode; dlnaCtrl = ctrl; dlnaPaused = false;
        dlnaRenderCtrl = mode == CAST_DLNA ? activeDlnaRenderCtrl : null;   // volume (RenderingControl) da TV escolhida
        castTvIp = mode == CAST_DLNA ? hostOf(ctrl) : null;   // pra filtrar o tráfego da TV no proxy
        remoteSeekTarget = 0; remoteSeekAppliedAt = 0;
        remoteVolTarget = -1; remoteVolAppliedAt = 0; volKnown = false;   // volume relativo recomeça na sessão nova
        if (volSeek != null) volSeek.setVisibility(View.GONE);
        activeCastMode = mode; activeDlnaCtrl = (mode == CAST_DLNA ? ctrl : null); activeCastKey = resumeKey; // p/ retomar ao voltar
        activeCastTitle = mTitle;
        saveCastSession();   // sobrevive ao fechar o app (serviço headless) e à morte do processo (reabrir)
        // Pausa E muta o local: às vezes só o pause não pegava (continuava tocando) e
        // o áudio do celular disputava foco com a TV → oscilava. Mudo garante silêncio.
        if (player != null) { player.pause(); player.setPlayWhenReady(false); player.setVolume(0f); }
        updateCastButton(true); // botão verde (conectado) nos 2 modos
        if (castStatusTv != null) setCastStatus(mode == CAST_CC ? "Reproduzindo no Chromecast" : "Reproduzindo na TV (DLNA)");
        // IP do proxy num Toast (o texto do overlay corta) — pro teste do /ping.
        String ip = localIp();
        // Sem IP de Wi-Fi a TV não alcança o celular → aviso ACIONÁVEL. O endereço do
        // proxy era diagnóstico interno (não diz nada pro usuário) → removido.
        if (ip == null) castMsg("Conecte o celular no mesmo Wi-Fi da TV", 8000);
        if (castOverlay != null) castOverlay.setVisibility(View.VISIBLE);
        // DESLIGA o controller do player local: ele fica por cima do overlay e ENGOLE
        // os toques (pausar/avançar/parar espelhamento não respondiam). hideController
        // sozinho não basta — ele reaparece ao tocar na tela.
        if (view != null) { view.hideController(); view.setUseController(false); }
        updatePlayIcon(true);
        progressHandler.removeCallbacks(castPoll);
        progressHandler.postDelayed(castPoll, 800);
        refreshCastDeliveredHeight();   // "Qualidade: 720p" assim que o proxy/arquivo souber
        refreshMediaNotification();     // notificação passa a falar da TV
    }

    // Seek no DLNA COM CONFIRMAÇÃO. Um Seek logo após o Play é recusado/ignorado
    // (a TV ainda está abrindo o stream) e o erro era engolido por catch vazio → a
    // TV começava do ZERO mesmo com o celular em 47:59. Agora insiste até a posição
    // reportada bater com o alvo e, se não bater, registra o motivo.
    // Roda em background (faz sleeps) — chamar de dentro de uma thread.
    private void seekWithRetry(final String ctrl, final long targetMs, final String origem) {
        // Sessão/mídia deste seek. Se trocar de episódio no meio, este laço TEM que
        // morrer: ele insiste ~10s e estava arrastando o episódio NOVO de volta pro
        // tempo do anterior (o vídeo "brigava" entre 00:00 e o tempo herdado).
        final int gen = castGen;
        // Espera a TV SAIR de TRANSITIONING (até ~15s) antes do 1º Seek: seek durante o
        // carregamento reinicia o pipeline em várias TVs (tela preta por segundos) e é
        // recusado à toa — o laço antigo mandava o 1º Seek 1,2s após o Play.
        long waitStart = android.os.SystemClock.elapsedRealtime();
        String estado = "?";
        for (int w = 0; w < 15; w++) {
            if (gen != castGen) return;
            try {
                String[] ti = DlnaCastPlugin.getTransportInfoSync(ctrl);
                estado = ti[0] + (ti[1] != null && !ti[1].isEmpty() && !"OK".equals(ti[1]) ? "/" + ti[1] : "");
                if ("PLAYING".equals(ti[0]) || "PAUSED_PLAYBACK".equals(ti[0])) break;
                if (ti[1] != null && ti[1].toUpperCase().contains("ERROR")) break;   // não vai tocar — não insiste
            } catch (Exception e) { estado = "sem-resposta"; }
            try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
        }
        long esperou = android.os.SystemClock.elapsedRealtime() - waitStart;
        NativePlayerPlugin.reportError(currentUrl, 0, 0, "SEEK_TV",
            "[seek] origem=" + origem + " alvo=" + targetMs + "ms gen=" + gen + " esperouPlaying=" + esperou + "ms estadoTV=" + estado, mMime, mReferer, mTitle);
        String lastErr = null;
        for (int i = 0; i < 6; i++) {
            try { Thread.sleep(i == 0 ? 500 : 1800); } catch (InterruptedException ignored) {}
            if (gen != castGen) {   // trocou de episódio/sessão → este seek é do ep anterior
                NativePlayerPlugin.reportError(currentUrl, 0, 0, "SEEK_TV_CANCELADO",
                    "[seek] origem=" + origem + " alvo=" + targetMs + "ms abortado (gen " + gen + "→" + castGen + ")",
                    mMime, mReferer, mTitle);
                return;
            }
            try { DlnaCastPlugin.seekSync(ctrl, targetMs); lastErr = null; }
            catch (Exception e) { lastErr = e.getMessage() != null ? e.getMessage() : e.toString(); continue; }
            try {
                long[] pd = DlnaCastPlugin.getPositionSync(ctrl);
                if (pd != null && Math.abs(pd[0] - targetMs) < 20000) return;   // chegou
            } catch (Exception ignored) {}
        }
        final String fe = lastErr;
        runOnUiThread(() -> {
            castMsg("A TV não aceitou continuar de onde parou — use a barra pra ajustar", 7000);
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_SEEK_FALHOU",
                "[seek] origem=" + origem + " alvo=" + targetMs + "ms erro=" + fe, mMime, mReferer, mTitle);
        });
    }

    // Troca a mídia NA TV sem derrubar a conexão: o DLNA aceita um novo
    // SetAVTransportURI no mesmo controlUrl (é o que o "Próximo episódio" usa).
    // No Chromecast, o load() na sessão viva faz o mesmo papel.
    private void recastCurrent() { recastCurrent(0); }

    private void recastCurrent(final long startFromMs) {
        if (currentUrl == null) return;
        if (activeCastMode == CAST_DLNA && activeDlnaCtrl != null) {
            final String ctrl = activeDlnaCtrl;
            final String ip = localIp();
            final String castUrl = ip != null ? ProxyServer.lan(currentUrl, mReferer, ip, castQualityH) : currentUrl;
            final String tt = mTitle;
            final String t = tt != null ? tt : "WatchMov";
            final String srcUrl = currentUrl, srcRef = mReferer;
            final int qH = castQualityH;
            // Reenvio de TV travada/parada: manda Stop antes (reseta o transporte da TV).
            final boolean stopFirstNow = recastStopFirst; recastStopFirst = false;
            startCasting(CAST_DLNA, ctrl);                 // overlay + pausa o local já
            // Zera o tempo do remoto (senão o overlay mostra o do episódio anterior) e
            // só arma o vigia DEPOIS que o castSync foi aceito — antes ele lia a TV
            // no meio do próprio Stop→SetAVTransportURI→Play e logava "STOPPED" à toa.
            lastRemotePosMs = 0; lastRemoteDurMs = 0;
            recastAtMs = 0; castSentAtMs = 0;
            recastDropReported = false;
            recastTargetMs = startFromMs;
            // Enquanto o recast está em voo a TV ainda responde pela mídia ANTERIOR:
            // aceitar essa posição fazia o watchdog reenviar o episódio novo NO TEMPO
            // DO ANTERIOR (o vídeo "brigava": ia pro 0 e voltava pro tempo herdado).
            recastPending = true;
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "RECAST_ENVIADO",
                "[recast] alvo=" + startFromMs + "ms retries=" + recastRetries + " stopFirst=" + stopFirstNow + " q=" + (qH > 0 ? qH + "p" : "max") + " url=" + castUrl, mMime, mReferer, mTitle);
            if (castStatusTv != null) setCastStatus("Enviando próximo episódio pra TV…");
            new Thread(() -> {
                // Pré-aquece o master pelo proxy: a LG SONDA a URL antes de responder o
                // SetAVTransportURI — com stream online frio isso estourava o timeout
                // ("[recast] timeout" com a TV em "Loading media resource…").
                final String warm = ProxyServer.prewarm(srcUrl, srcRef, qH);
                // A TV costuma recusar logo após o Stop do episódio anterior
                // ("Transition not available"): espera e TENTA DE NOVO. NÃO derruba a
                // conexão em falha — o usuário não deve precisar reconectar.
                String err = null; String res = "";
                for (int i = 0; i < 3; i++) {
                    try { Thread.sleep(i == 0 ? 900 : 2000); } catch (InterruptedException ignored) {}
                    // stopFirst=false: troca a mídia SEM parar a TV (o Stop é o que a
                    // fazia "cair e reconectar"); só para se ela recusar a troca.
                    try { DlnaCastPlugin.CastResult cr = DlnaCastPlugin.castSync(ctrl, castUrl, t, stopFirstNow); res = cr.toString(); err = null; break; }
                    catch (DlnaCastPlugin.CastException ce) { err = ce.getMessage(); res = ce.result.toString(); }
                    catch (Exception e) { err = e.getMessage() != null ? e.getMessage() : e.toString(); }
                }
                final String fe = err, fres = res;
                runOnUiThread(() -> {
                    if (fe == null) {
                        armCastWatchdog("recast", startFromMs);   // vigia: estado/tráfego/travou
                        NativePlayerPlugin.reportError(srcUrl, 0, 0, "RECAST_ACEITO",
                            "[recast] " + fres + " " + warm, mMime, srcRef, tt);
                        if (castStatusTv != null) setCastStatus("Reproduzindo na TV (DLNA)");
                    } else {
                        // Mantém o espelhamento ativo (a TV segue pareada) e registra o
                        // motivo real pra diagnóstico — o usuário pode tocar de novo.
                        if (castStatusTv != null) setCastStatus("A TV recusou o próximo episódio — toque em Próximo de novo");
                        castMsg("TV recusou o episódio: " + fe + " — toque em Próximo de novo", 8000);
                        NativePlayerPlugin.reportError(srcUrl, 0, 0, "RECAST_DLNA_FALHOU",
                            "[recast] " + fe + " | " + fres + " " + warm, mMime, srcRef, tt);
                    }
                });
                if (err == null && startFromMs > 3000) seekWithRetry(ctrl, startFromMs, "recast");
                recastPending = false;
            }).start();
        } else if (activeCastMode == CAST_CC) {
            try {
                com.google.android.gms.cast.framework.CastSession cs =
                    com.google.android.gms.cast.framework.CastContext.getSharedInstance(this).getSessionManager().getCurrentCastSession();
                if (cs != null && cs.isConnected()) loadOnCast(cs);
            } catch (Exception ignored) {}
        }
    }

    // Parou/desconectou: esconde o overlay e volta a tocar local na posição da TV.
    private void stopCasting(boolean resumeLocal) {
        if (castMode == CAST_NONE) return;
        final long tvPos = lastRemotePosMs;
        if (castMode == CAST_DLNA && dlnaCtrl != null) {
            final String c = dlnaCtrl;
            new Thread(() -> {
                try { DlnaCastPlugin.controlSync(c, "Stop"); }
                catch (Exception e) { final String m = String.valueOf(e.getMessage()); runOnUiThread(() -> castMsg("TV recusou parar: " + m, 6000)); }
            }).start();
        }
        castGen++; // encerra a sessão — o poll em voo não reagenda
        castMode = CAST_NONE; dlnaCtrl = null;
        castSentAtMs = 0; recastAtMs = 0; castTvIp = null;   // desarma o vigia
        dlnaRenderCtrl = null; activeDlnaRenderCtrl = null;
        remoteVolTarget = -1; remoteVolAppliedAt = 0; volKnown = false;
        if (volSeek != null) volSeek.setVisibility(View.GONE);
        activeCastMode = CAST_NONE; activeDlnaCtrl = null; activeCastKey = null; activeCastTitle = null; // sessão encerrada
        CastSessionStore.clear(this);             // encerrada de verdade → nada pra restaurar ao reabrir
        updateCastButton(false); // volta o botão pro branco (desconectado)
        progressHandler.removeCallbacks(castPoll);
        if (castOverlay != null) castOverlay.setVisibility(View.GONE);
        if (view != null) view.setUseController(true);      // devolve os controles locais
        progressHandler.removeCallbacks(hideCastMsg);
        if (castMsgTv != null) castMsgTv.setVisibility(View.GONE);   // some com a faixa
        castSilentStart = false;                  // sem espelho, o local volta a tocar
        if (player != null) player.setVolume(1f); // restaura o áudio local
        if (resumeLocal && player != null) { if (tvPos > 0) player.seekTo(tvPos); player.setPlayWhenReady(true); }
        castDeliveredH = 0; updateCastQualityLabel();   // próximo cast recomeça sem valor velho
        refreshMediaNotification();               // notificação volta a falar do local
    }

    private void remotePlayPause() {
        if (castMode == CAST_CC) {
            com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc();
            if (r == null) return;
            if (r.isPlaying()) r.pause(); else r.play();
        } else if (castMode == CAST_DLNA && dlnaCtrl != null) {
            final String c = dlnaCtrl; final boolean pause = !dlnaPaused; dlnaPaused = pause;
            updatePlayIcon(!pause);
            new Thread(() -> {
                try { DlnaCastPlugin.controlSync(c, pause ? "Pause" : "Play"); }
                catch (Exception e) { final String m = String.valueOf(e.getMessage()); runOnUiThread(() -> castMsg("TV recusou " + (pause ? "pausar" : "continuar") + ": " + m, 6000)); }
            }).start();
        }
    }

    private void remoteSeekBy(long deltaMs) {
        if (castMode == CAST_CC) {
            com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc();
            if (r == null) return;
            long target = Math.max(0, r.getApproximateStreamPosition() + deltaMs);
            r.seek(new com.google.android.gms.cast.MediaSeekOptions.Builder().setPosition(target).build());
        } else if (castMode == CAST_DLNA && dlnaCtrl != null) {
            final String c = dlnaCtrl; final int gen = castGen;
            new Thread(() -> {
                // Serializado: toques em sequência SOMAM (+10 +10 = +20) a partir do alvo
                // anterior, em vez de recalcular todos do mesmo ponto velho.
                synchronized (remoteSeekLock) {
                    if (gen != castGen) return;
                    long base = lastRemotePosMs; String fonte = "poll";
                    long agora = android.os.SystemClock.elapsedRealtime();
                    if (remoteSeekTarget > 0 && agora - remoteSeekAppliedAt < 4000) { base = remoteSeekTarget; fonte = "alvo-anterior"; }
                    else {
                        // Posição FRESCA da TV: a do poll tinha até ~3s de atraso (ou era 0 logo
                        // após conectar) → −10s virava "voltar pro início" e +10s às vezes
                        // andava PRA TRÁS. Era o "botão de 10s não funciona".
                        try { long[] pd = DlnaCastPlugin.getPositionSync(c); if (pd != null && pd[0] > 0) { base = pd[0]; fonte = "tv"; } } catch (Exception ignored) {}
                    }
                    final long target = Math.max(0, base + deltaMs);
                    String err = null;
                    try { DlnaCastPlugin.seekSync(c, target); remoteSeekTarget = target; remoteSeekAppliedAt = android.os.SystemClock.elapsedRealtime(); }
                    catch (Exception e) { err = e.getMessage() != null ? e.getMessage() : e.toString(); }
                    final long fb = base; final String ff = fonte, fe = err;
                    runOnUiThread(() -> {
                        if (gen != castGen) return;
                        if (fe == null) {
                            lastRemotePosMs = target;   // otimista: a UI acompanha na hora
                            if (castTimeTv != null) castTimeTv.setText(fmtClock(lastRemotePosMs) + " / " + fmtClock(lastRemoteDurMs));
                            updateCastSeek();
                        } else castMsg("TV recusou avançar/voltar: " + fe, 6000);
                        NativePlayerPlugin.reportError(currentUrl, 0, 0, "SEEK_REMOTO",
                            "[seek] delta=" + deltaMs + "ms base=" + fb + "ms(" + ff + ") alvo=" + target + "ms " + (fe == null ? "ok" : "erro=" + fe),
                            mMime, mReferer, mTitle);
                    });
                }
            }).start();
        }
    }

    private void remoteSeekTo(long absMs) {
        if (castMode == CAST_CC) {
            com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc();
            if (r != null) r.seek(new com.google.android.gms.cast.MediaSeekOptions.Builder().setPosition(Math.max(0, absMs)).build());
        } else if (castMode == CAST_DLNA && dlnaCtrl != null) {
            final String c = dlnaCtrl; final long t = Math.max(0, absMs);
            new Thread(() -> { try { DlnaCastPlugin.seekSync(c, t); } catch (Exception ignored) {} }).start();
        }
    }

    private static String hostOf(String url) {
        try { return url != null ? new java.net.URL(url).getHost() : null; } catch (Exception e) { return null; }
    }

    // Arma o vigia depois que a TV ACEITOU um envio (SetAVTransportURI+Play OK) —
    // no 1º cast E na troca de episódio. Antes só o recast tinha vigia: tela preta ou
    // "carregando" pra sempre no primeiro espelhamento não deixava rastro.
    private void armCastWatchdog(String origem, long targetMs) {
        castSentAtMs = android.os.SystemClock.elapsedRealtime();
        castSentWallMs = System.currentTimeMillis();
        recastAtMs = castSentAtMs;
        castSentOrigem = origem;
        recastTargetMs = targetMs;
        recastDropReported = false;
        castStateLog.setLength(0); castLastState = null;
        castStateReported = false; castTrafficReported = false; castStuckHandled = false;
    }

    // Um ciclo do vigia (chamado pelo poll DLNA, na UI). Registra a linha do tempo de
    // estados da TV, o tráfego que ela fez no proxy e reage:
    //  • TV PAROU (STOPPED/NO_MEDIA…) após 6s de carência → RECAST_TV_PAROU + reenvia 1x
    //  • TV PRESA em "carregando" (TRANSITIONING/sem resposta/ERROR) por 30s →
    //    CAST_TV_TRAVADA + reenvia 1x COM Stop
    //  • TV não pediu NADA ao celular em 20s → aviso de rede (IP/roteador isolando)
    // Devolve true quando disparou um reenvio (o chamador não reagenda o poll: o
    // startCasting do recast já faz isso).
    private boolean watchdogTick(String fst, String fstatus, long[] f) {
        if (castSentAtMs <= 0) return false;
        long since = android.os.SystemClock.elapsedRealtime() - castSentAtMs;
        boolean erroTv = fstatus != null && fstatus.toUpperCase().contains("ERROR");
        String cur = (fst == null ? "sem-resposta" : (fst.isEmpty() ? "vazio" : fst))
            + (fstatus != null && !fstatus.isEmpty() && !"OK".equals(fstatus) ? "/" + fstatus : "");
        if (!cur.equals(castLastState)) {
            castLastState = cur;
            if (castStateLog.length() > 0) castStateLog.append(", ");
            castStateLog.append('+').append(since / 1000).append('.').append((since % 1000) / 100).append("s ").append(cur);
        }
        boolean playingOk = "PLAYING".equals(fst) && !erroTv;
        long pos = f != null ? f[0] : -1, dur = f != null ? f[1] : -1;
        // Linha do tempo: fecha quando a TV está tocando de verdade (posição andando),
        // em 30s, ou quando ela reporta erro.
        if (!castStateReported && ((playingOk && pos > 1000 && since > 2000) || since > 30000 || erroTv)) {
            castStateReported = true;
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_TV_ESTADO",
                "[tv] origem=" + castSentOrigem + " " + castStateLog + " | pos=" + pos + "ms dur=" + dur + "ms" + (erroTv ? " ⚠ TV reportou erro" : ""),
                mMime, mReferer, mTitle);
        }
        // Tráfego da TV no proxy — 20s após o envio (ou já, se a TV reportou erro).
        // Nenhum pedido = TV não alcança o celular (rede). Só master = não engoliu a
        // playlist. Master+variante sem segmentos = host dos segmentos. Segmentos e
        // sem PLAYING = formato/Content-Type.
        if (!castTrafficReported && (since > 20000 || erroTv)) {
            castTrafficReported = true;
            String tr = ProxyServer.trafficSummary(castSentWallMs - 3000, castTvIp);
            String trAll = ProxyServer.trafficSummary(castSentWallMs - 3000, null);
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_TRAFEGO_TV",
                "[proxy] origem=" + castSentOrigem + " tvIp=" + castTvIp + " estadoTV=" + cur + " || tv{" + tr + "} || todos{" + trAll + "}",
                mMime, mReferer, mTitle);
            if (!playingOk && tr.startsWith("req=0")) {
                String ipL = localIp();
                castMsg("A TV não buscou o vídeo no celular (IP " + ipL + "). Confira se os dois estão no mesmo Wi-Fi; teste http://" + ipL + ":8099/ping no navegador da TV", 12000);
            }
        }
        // PAROU de verdade após carência de 6s (o próprio castSync faz Stop→Set→Play,
        // então logo depois a TV reporta STOPPED sem ter caído) → reenvia 1x.
        if (!recastDropReported && since > 6000 && since < 40000
            && fst != null && !fst.isEmpty() && !"PLAYING".equals(fst) && !"TRANSITIONING".equals(fst)
            && !"PAUSED_PLAYBACK".equals(fst)) {
            recastDropReported = true;
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "RECAST_TV_PAROU",
                "[" + castSentOrigem + "] TV state=" + cur + " apos " + since + "ms pos=" + lastRemotePosMs + " | " + castStateLog,
                mMime, mReferer, mTitle);
            if (recastRetries < 1) {
                recastRetries++;
                castMsg("A TV parou o vídeo — reenviando…", 5000);
                // Reenvia no ALVO que pedimos (0 na troca de episódio) — usar
                // lastRemotePosMs levava o ep novo pro tempo do anterior.
                recastStopFirst = true;
                recastCurrent(recastTargetMs);
                return true;
            }
            castMsg("A TV parou o vídeo — toque em Próximo/Espelhar de novo", 8000);
        }
        // PRESA em "carregando" (TRANSITIONING, sem resposta ou erro) por 30s sem
        // nunca tocar → reenvia 1x com Stop (reseta o transporte da TV).
        if (!castStuckHandled && since > 30000 && since < 90000 && !playingOk && !"PAUSED_PLAYBACK".equals(fst)
            && (fst == null || fst.isEmpty() || "TRANSITIONING".equals(fst) || erroTv)) {
            castStuckHandled = true;
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_TV_TRAVADA",
                "[" + castSentOrigem + "] TV em " + cur + " ha " + since + "ms sem tocar | " + castStateLog,
                mMime, mReferer, mTitle);
            if (recastRetries < 1) {
                recastRetries++;
                castMsg("A TV ficou carregando — reenviando com Stop…", 5000);
                recastStopFirst = true;
                recastCurrent(recastTargetMs);
                return true;
            }
            castMsg("A TV não começou a tocar — toque em Espelhar de novo ou baixe a qualidade", 8000);
        }
        return false;
    }

    // Status do overlay COM o título do que está na TV:
    // "Shangri-La Frontier — T1 E35 — Reproduzindo na TV (DLNA)".
    private void setCastStatus(String s) {
        if (castStatusTv == null) return;
        String t = mTitle != null && !mTitle.isEmpty() ? mTitle + " — " : "";
        castStatusTv.setText(t + s);
    }

    // "Volume": mostra a barra já com o volume ATUAL da TV (GetVolume); esconder = tocar de
    // novo. Soltar a barra → remoteVolumeSet.
    private void toggleVolumeBar() {
        if (volSeek == null) return;
        if (castMode == CAST_NONE) { castMsg("Só vale com a TV conectada", 2500); return; }
        if (volSeek.getVisibility() == View.VISIBLE) { volSeek.setVisibility(View.GONE); return; }
        if (castMode == CAST_DLNA && dlnaRenderCtrl == null) {
            castMsg("Esta TV não expõe controle de volume por DLNA (RenderingControl) — use o controle dela", 6000);
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_VOLUME_INDISPONIVEL", "[volume] TV sem RenderingControl ctrl=" + dlnaCtrl, mMime, mReferer, mTitle);
            return;
        }
        volSeek.setVisibility(View.VISIBLE);
        if (castMode == CAST_CC) {
            try {
                com.google.android.gms.cast.framework.CastSession s = castSessionManager != null ? castSessionManager.getCurrentCastSession() : null;
                if (s != null) { volSeek.setProgress((int) Math.round(s.getVolume() * 100)); volKnown = true; }
            } catch (Exception ignored) {}
            return;
        }
        castMsg("Lendo volume da TV…", 1500);
        final String rc = dlnaRenderCtrl; final int gen = castGen;
        new Thread(() -> {
            int v = -1; String err = null;
            try { v = DlnaCastPlugin.getVolumeSync(rc); } catch (Exception e) { err = e.getMessage() != null ? e.getMessage() : e.toString(); }
            final int fv = v; final String fe = err;
            runOnUiThread(() -> {
                if (gen != castGen || volSeek == null) return;
                if (fv >= 0) { if (!volSeeking) volSeek.setProgress(fv); volKnown = true; castMsg("Volume da TV: " + fv, 1500); }
                else if (fe != null) {
                    castMsg("Não consegui ler o volume: " + fe, 4000);
                    NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_VOLUME_FALHOU", "[volume] GetVolume erro=" + fe, mMime, mReferer, mTitle);
                }
            });
        }).start();
    }

    private void remoteVolumeSet(final int vol) {
        if (castMode == CAST_CC) {
            try {
                com.google.android.gms.cast.framework.CastSession s = castSessionManager != null ? castSessionManager.getCurrentCastSession() : null;
                if (s != null) s.setVolume(vol / 100.0);
                castMsg("Volume " + vol, 1200);
            } catch (Exception e) { castMsg("Chromecast recusou volume: " + e.getMessage(), 4000); }
            return;
        }
        if (castMode != CAST_DLNA || dlnaRenderCtrl == null) return;
        final String rc = dlnaRenderCtrl;
        new Thread(() -> {
            String err = null;
            try { DlnaCastPlugin.setVolumeSync(rc, vol); } catch (Exception e) { err = e.getMessage() != null ? e.getMessage() : e.toString(); }
            final String fe = err;
            runOnUiThread(() -> {
                if (fe == null) castMsg("Volume " + vol, 1200);
                else {
                    castMsg("TV recusou volume: " + fe, 5000);
                    NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_VOLUME_FALHOU", "[volume] SetVolume " + vol + " erro=" + fe, mMime, mReferer, mTitle);
                }
            });
        }).start();
    }

    // "−"/"+" do overlay: ±10 % do volume da TV sem abrir a barra. Base = alvo do último
    // toque (se foi há <4s → toques em sequência SOMAM), senão a barra (se já reflete a
    // TV), senão lê na TV antes de aplicar. Mesmas guardas do toggleVolumeBar.
    private void remoteVolumeBy(final int delta) {
        if (castMode == CAST_NONE) { castMsg("Só vale com a TV conectada", 2500); return; }
        if (castMode == CAST_DLNA && dlnaRenderCtrl == null) {
            castMsg("Esta TV não expõe controle de volume por DLNA (RenderingControl) — use o controle dela", 6000);
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_VOLUME_INDISPONIVEL", "[volume] TV sem RenderingControl ctrl=" + dlnaCtrl, mMime, mReferer, mTitle);
            return;
        }
        long agora = android.os.SystemClock.elapsedRealtime();
        if (remoteVolTarget >= 0 && agora - remoteVolAppliedAt < 4000) { applyVolumeDelta(remoteVolTarget, delta); return; }
        if (volKnown && volSeek != null) { applyVolumeDelta(volSeek.getProgress(), delta); return; }
        if (castMode == CAST_CC) {
            int cur = 50;
            try {
                com.google.android.gms.cast.framework.CastSession s = castSessionManager != null ? castSessionManager.getCurrentCastSession() : null;
                if (s != null) cur = (int) Math.round(s.getVolume() * 100);
            } catch (Exception ignored) {}
            applyVolumeDelta(cur, delta);
            return;
        }
        castMsg("Lendo volume da TV…", 1500);
        final String rc = dlnaRenderCtrl; final int gen = castGen;
        new Thread(() -> {
            int v = -1; String err = null;
            try { v = DlnaCastPlugin.getVolumeSync(rc); } catch (Exception e) { err = e.getMessage() != null ? e.getMessage() : e.toString(); }
            final int fv = v; final String fe = err;
            runOnUiThread(() -> {
                if (gen != castGen) return;
                if (fv >= 0) applyVolumeDelta(fv, delta);
                else {
                    castMsg("Não consegui ler o volume: " + fe, 4000);
                    NativePlayerPlugin.reportError(currentUrl, 0, 0, "CAST_VOLUME_FALHOU", "[volume] GetVolume (−/+) erro=" + fe, mMime, mReferer, mTitle);
                }
            });
        }).start();
    }

    private void applyVolumeDelta(int base, int delta) {
        final int target = Math.max(0, Math.min(100, base + delta));
        remoteVolTarget = target; remoteVolAppliedAt = android.os.SystemClock.elapsedRealtime();
        volKnown = true;
        if (volSeek != null && !volSeeking) volSeek.setProgress(target);
        castMsg("Volume " + target, 1200);   // remoteVolumeSet repete o mesmo texto ao confirmar (sem piscar) ou mostra "TV recusou volume"
        remoteVolumeSet(target);
    }

    // Rótulo do botão = qualidade ATUAL na TV: a variante que o proxy ENTREGOU (HLS) ou
    // a altura do arquivo (MP4). Enquanto ninguém confirmou (segundos após o envio) cai
    // na escolhida pelo usuário; sem nada = "Máx" (padrão: maior bandwidth). Antes
    // mostrava "Máx" fixo — não dizia se a TV estava em 720p ou 360p.
    private void updateCastQualityLabel() {
        if (castQualityBtn == null) return;
        String q = castDeliveredH > 0 ? castDeliveredH + "p" : castQualityH > 0 ? castQualityH + "p" : "Máx";
        castQualityBtn.setText("Qualidade: " + q);
    }

    // Descobre a altura que a TV está recebendo e atualiza o rótulo quando mudar.
    // HLS: o proxy registra a variante que serviu no master do cast (prewarm já
    // preenche; a TV pede o master logo após o SetAVTransportURI). MP4/arquivo: não há
    // variantes — usa a altura que o player local reportou ou lê o arquivo (thread).
    private void refreshCastDeliveredHeight() {
        if (castMode == CAST_NONE || currentUrl == null) return;
        int h = ProxyServer.deliveredHeight(currentUrl);
        if (h <= 0 && !isHlsCurrent()) {
            if (localVideoH > 0) h = localVideoH;
            else if (!fileHeightPending) { fileHeightPending = true; readFileHeightAsync(currentUrl); }
        }
        if (h != castDeliveredH) { castDeliveredH = h; updateCastQualityLabel(); }
    }

    private void readFileHeightAsync(final String url) {
        new Thread(() -> {
            int h = 0;
            android.media.MediaMetadataRetriever mr = new android.media.MediaMetadataRetriever();
            try {
                if (url.startsWith("content://")) mr.setDataSource(this, android.net.Uri.parse(url));
                else if (url.startsWith("file://")) mr.setDataSource(new java.net.URI(url).getPath());
                else return;   // MP4 de rede: ler custaria baixar — fica com o player local (onVideoSizeChanged)
                String s = mr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                if (s != null) h = Integer.parseInt(s.trim());
            } catch (Exception ignored) {
            } finally {
                try { mr.release(); } catch (Exception ignored) {}
                final int fh = h;
                runOnUiThread(() -> {
                    fileHeightPending = false;
                    if (fh > 0 && url.equals(currentUrl) && castMode != CAST_NONE && localVideoH <= 0) localVideoH = fh;
                    refreshCastDeliveredHeight();
                });
            }
        }).start();
    }

    // O link ATUAL é HLS (master com variantes) ou arquivo único (MP4/content://)?
    private boolean isHlsCurrent() {
        String url = currentUrl;
        boolean rede = url != null && (url.startsWith("http://") || url.startsWith("https://"));
        String lu = url != null ? url.toLowerCase() : "";
        return rede && ((mMime != null && mMime.toLowerCase().contains("mpegurl"))
            || lu.contains(".m3u8") || lu.contains("master") || lu.contains("/m3/") || lu.contains(".txt") || lu.contains("playlist"));
    }

    // Qualidade NA TV. O proxy entrega UMA variante pro cast (a TV não faz ABR):
    // padrão = maior bandwidth. Aqui lista as alturas do master + "Máxima"; escolher
    // reenvia a mídia atual pra TV (mesma sessão) na posição em que ela está, com
    // q=<altura> na URL — a TV recarrega já na qualidade nova.
    private void showCastQuality() {
        if (castMode == CAST_NONE) { castMsg("Só vale com a TV conectada", 2500); return; }
        final String url = currentUrl;
        if (!isHlsCurrent()) {
            castMsg("Este vídeo é arquivo único (MP4" + (castDeliveredH > 0 ? " em " + castDeliveredH + "p" : "") + ") — não tem variantes de qualidade", 4000);
            return;
        }
        castMsg("Lendo qualidades do vídeo…", 0);
        final String ref = mReferer;
        new Thread(() -> {
            java.util.List<int[]> vars = ProxyServer.variantsOf(url);
            if (vars.isEmpty()) { ProxyServer.prewarm(url, ref, 0); vars = ProxyServer.variantsOf(url); }
            final java.util.List<int[]> fv = vars;
            runOnUiThread(() -> {
                progressHandler.removeCallbacks(hideCastMsg);
                if (castMsgTv != null) castMsgTv.setVisibility(View.GONE);
                if (fv.isEmpty()) { castMsg("Não achei variantes no master deste link", 4000); return; }
                final String[] labels = new String[fv.size() + 1];
                labels[0] = "Máxima (padrão)" + (castQualityH == 0 && castDeliveredH > 0 ? " = " + castDeliveredH + "p" : "") + (castQualityH == 0 ? "   ✓" : "");
                for (int i = 0; i < fv.size(); i++) {
                    int[] v = fv.get(i);
                    labels[i + 1] = (v[0] > 0 ? v[0] + "p" : "?") + "  ·  " + (v[1] / 1000) + " kbps" + (castQualityH == v[0] ? "   ✓" : "");
                }
                new AlertDialog.Builder(this).setTitle("Qualidade na TV").setItems(labels, (d, i) -> {
                    int h = i == 0 ? 0 : fv.get(i - 1)[0];
                    if (h == castQualityH) return;
                    castQualityH = h;
                    // Até a TV pedir o master de novo, o valor "entregue" é o da qualidade
                    // anterior → esquece e mostra a escolhida; o poll confirma depois.
                    castDeliveredH = 0; ProxyServer.forgetDelivered(url);
                    updateCastQualityLabel();
                    castMsg("Trocando qualidade na TV…", 4000);
                    NativePlayerPlugin.reportError(url, 0, 0, "CAST_QUALIDADE",
                        "[qualidade] escolhida=" + (h > 0 ? h + "p" : "max") + " posTV=" + lastRemotePosMs + "ms castMode=" + castMode, mMime, ref, mTitle);
                    // Mesma sessão, nova URL (q=) — DLNA via recast; Chromecast via load().
                    recastCurrent(lastRemotePosMs);
                }).show();
            });
        }).start();
    }

    private void updatePlayIcon(boolean playing) {
        if (castPlayBtn != null) castPlayBtn.setText(playing ? "⏸" : "▶");
        refreshMediaNotification();   // ⏯ da notificação acompanha o estado real da TV
    }

    // Reflete a posição do remoto na barra (em segundos); não mexe enquanto o user arrasta.
    private void updateCastSeek() {
        if (castSeek == null || castSeeking) return;
        int dur = (int) (lastRemoteDurMs / 1000);
        if (dur > 0) { castSeek.setMax(dur); castSeek.setProgress((int) (lastRemotePosMs / 1000)); }
    }

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
                updateCastSeek();
                refreshCastDeliveredHeight();
                progressHandler.postDelayed(this, 1000);
            } else if (castMode == CAST_DLNA && dlnaCtrl != null) {
                final String c = dlnaCtrl;
                final int gen = castGen;
                // Poll SERIALIZADO: agenda o próximo ciclo só DEPOIS que este terminar.
                // O postDelayed fixo (antigo) não esperava a thread anterior → quando a
                // TV demorava (TRANSITIONING no início) as chamadas SOAP empilhavam e
                // afogavam o controle UPnP da TV → travava/dava timeout. Serializando,
                // no máximo 1 par de chamadas fica em voo por vez.
                new Thread(() -> {
                    long[] pd; try { pd = DlnaCastPlugin.getPositionSync(c); } catch (Exception e) { pd = null; }
                    // Estado + STATUS: "ERROR_OCCURRED" é a TV dizendo que tentou e falhou
                    // (formato/rede) — separa "carregando" de "quebrou".
                    String[] ti; try { ti = DlnaCastPlugin.getTransportInfoSync(c); } catch (Exception e) { ti = null; }
                    final long[] f = pd; final String fst = ti != null ? ti[0] : null; final String fstatus = ti != null ? ti[1] : null;
                    runOnUiThread(() -> {
                        if (castMode != CAST_DLNA || gen != castGen) return; // sessão trocou/encerrou
                        // Logo após um ±10s/±60s a TV ainda devolve a posição antiga por 1–2
                        // ciclos → não deixa o poll puxar a barra de volta.
                        boolean seekRecente = remoteSeekAppliedAt > 0 && android.os.SystemClock.elapsedRealtime() - remoteSeekAppliedAt < 3000;
                        if (recastPending) {
                            // Posição que a TV devolve aqui é da mídia ANTERIOR — descarta.
                            if (f != null && f[0] > 0 && !posVelhaReportada) {
                                posVelhaReportada = true;
                                NativePlayerPlugin.reportError(currentUrl, 0, 0, "POS_TV_VELHA",
                                    "[recast] TV ainda reportando " + f[0] + "ms (mídia anterior) — ignorado",
                                    mMime, mReferer, mTitle);
                            }
                        } else if (f != null && (f[0] > 0 || f[1] > 0)) {
                            if (!seekRecente) lastRemotePosMs = f[0];
                            if (f[1] > 0) lastRemoteDurMs = f[1];
                        }
                        // Só PAUSED_PLAYBACK é pausa real. PLAYING e TRANSITIONING (a TV
                        // ainda carregando) contam como tocando — senão o ícone virava ▶
                        // no início enquanto a TV só estava abrindo o stream.
                        if (fst != null && !fst.isEmpty()) { dlnaPaused = "PAUSED_PLAYBACK".equals(fst); updatePlayIcon(!dlnaPaused); }
                        // Vigia do envio (1º cast E troca de episódio): linha do tempo de
                        // estados, tráfego da TV no proxy, reenvio se parou/travou.
                        if (watchdogTick(fst, fstatus, f)) return;   // reenviou → startCasting já reagendou o poll
                        if (castTimeTv != null) castTimeTv.setText(fmtClock(lastRemotePosMs) + " / " + fmtClock(lastRemoteDurMs));
                        updateCastSeek();
                        refreshCastDeliveredHeight();   // proxy já serviu o master → "Qualidade: 720p"
                        progressHandler.postDelayed(castPoll, 1500); // próximo ciclo só agora
                    });
                }).start();
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
        castMsg("Procurando Chromecast na rede…", 0);

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
                castMsg("Conectando a " + routes.get(i).getName() + "…", 0);
                routes.get(i).select();
                // Se em 25s não abrir sessão, provavelmente a TV não tem Cast integrado
                // (ou a conexão Cast falhou — vale tentar de novo).
                progressHandler.postDelayed(() -> {
                    if (!castConnected) android.widget.Toast.makeText(this, "Não conectou. Tente de novo; se persistir, essa TV pode não ter Chromecast/Google Cast integrado (TV só-DLNA use a opção DLNA).", android.widget.Toast.LENGTH_LONG).show();
                }, 25000);
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
                castMsg("Estabelecendo sessão Cast…", 0);
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
        final String title = mTitle;
        // O Chromecast busca a URL sozinho e o CDN costuma bloquear (IP/fingerprint)
        // ou servir HLS gzip que o receiver não parseia → fica "carregando". Serve
        // pela LAN: o Chromecast busca do celular (refaz fetch com headers, descomprime
        // gzip, reescreve o HLS). Fallback = URL direta se não achar o IP.
        final String ip = localIp();
        // content:// (MP4 exportado) também passa pelo proxy: o Chromecast só fala HTTP.
        final String castUrl = ip != null ? ProxyServer.lan(currentUrl, mReferer, ip, castQualityH) : currentUrl;
        final String castCt = castContentType(currentUrl);
        final long startPos = player != null ? player.getCurrentPosition() : 0;
        castMsg("Enviando vídeo pro Chromecast…", 0);
        // Detecta TS vs fMP4 (.m4s / #EXT-X-MAP) num thread — o Default Media Receiver
        // dá tela preta se o hlsVideoSegmentFormat estiver errado. Depois carrega na UI.
        new Thread(() -> {
            final String vf = castCt.contains("mpegurl") ? detectHlsVideoFormat(currentUrl, mReferer)
                                                          : com.google.android.gms.cast.HlsVideoSegmentFormat.MPEG2_TS;
            runOnUiThread(() -> {
                com.google.android.gms.cast.MediaMetadata md = new com.google.android.gms.cast.MediaMetadata(com.google.android.gms.cast.MediaMetadata.MEDIA_TYPE_MOVIE);
                md.putString(com.google.android.gms.cast.MediaMetadata.KEY_TITLE, title != null ? title : "WatchMov");
                com.google.android.gms.cast.MediaInfo.Builder mib = new com.google.android.gms.cast.MediaInfo.Builder(castUrl)
                    .setStreamType(com.google.android.gms.cast.MediaInfo.STREAM_TYPE_BUFFERED)
                    .setContentType(castCt)
                    .setMetadata(md);
                if (castCt.contains("mpegurl")) {
                    boolean fmp4 = com.google.android.gms.cast.HlsVideoSegmentFormat.FMP4.equals(vf);
                    mib.setHlsVideoSegmentFormat(vf)
                       .setHlsSegmentFormat(fmp4 ? com.google.android.gms.cast.HlsSegmentFormat.FMP4
                                                 : com.google.android.gms.cast.HlsSegmentFormat.TS);
                }
                com.google.android.gms.cast.MediaLoadRequestData req = new com.google.android.gms.cast.MediaLoadRequestData.Builder()
                    .setMediaInfo(mib.build()).setAutoplay(true).setCurrentTime(startPos).build();
                rmc.load(req).setResultCallback(result -> {
                    if (result.getStatus().isSuccess()) {
                        castMsg("Tocando no Chromecast — o app vira controle.", 5000);
                        startCasting(CAST_CC, null);
                    } else {
                        android.widget.Toast.makeText(this, "Chromecast conectou mas recusou o vídeo (código " + result.getStatus().getStatusCode() + "). Formato pode não ser suportado.", android.widget.Toast.LENGTH_LONG).show();
                    }
                });
            });
        }).start();
    }

    // TS (MPEG2_TS) por padrão; fMP4 se a playlist tiver #EXT-X-MAP ou segmentos .m4s.
    // Retorna uma constante String @HlsVideoSegmentFormat (não é enum no Cast SDK).
    private String detectHlsVideoFormat(String url, String referer) {
        try {
            okhttp3.OkHttpClient c = new okhttp3.OkHttpClient();
            String body = fetchText(c, url, referer);
            if (body == null) return com.google.android.gms.cast.HlsVideoSegmentFormat.MPEG2_TS;
            if (body.contains("#EXT-X-STREAM-INF")) { // master → busca a 1ª variante
                String variant = firstUri(body, url);
                if (variant != null) { String b2 = fetchText(c, variant, referer); if (b2 != null) body = b2; }
            }
            if (body.contains("#EXT-X-MAP") || body.toLowerCase().contains(".m4s"))
                return com.google.android.gms.cast.HlsVideoSegmentFormat.FMP4;
        } catch (Exception ignored) {}
        return com.google.android.gms.cast.HlsVideoSegmentFormat.MPEG2_TS;
    }

    private String fetchText(okhttp3.OkHttpClient c, String url, String referer) {
        try {
            okhttp3.Request.Builder rb = new okhttp3.Request.Builder().url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
            if (referer != null && !referer.isEmpty()) rb.header("Referer", referer);
            try (okhttp3.Response rp = c.newCall(rb.build()).execute()) {
                return rp.body() != null ? rp.body().string() : null;
            }
        } catch (Exception e) { return null; }
    }

    private String firstUri(String playlist, String baseUrl) {
        for (String line : playlist.split("\n")) {
            String t = line.trim();
            if (t.isEmpty() || t.startsWith("#")) continue;
            try { return t.startsWith("http") ? t : new java.net.URL(new java.net.URL(baseUrl), t).toString(); }
            catch (Exception e) { return null; }
        }
        return null;
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
        castMsg("Procurando TVs na rede…", 0);
        new Thread(() -> {
            final java.util.List<DlnaCastPlugin.Device> devs = DlnaCastPlugin.discoverSync(this, 6000);
            final String ipCel = localIp();
            // Registra SEMPRE (achou ou não). Era o buraco: a tentativa de conectar não
            // deixava rastro nenhum na aba Bugs — só Toast que sumia.
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "DLNA_DESCOBERTA",
                "[dlna] " + DlnaCastPlugin.lastDiscoverySummary + " ipCelular=" + ipCel + (ipCel == null ? " (SEM Wi-Fi: a TV não alcança o celular)" : ""),
                mMime, mReferer, mTitle);
            runOnUiThread(() -> {
                if (devs.isEmpty()) {
                    String msg = DlnaCastPlugin.lastRawResponses == 0
                        ? "Nenhuma resposta na rede — ative o compartilhamento/DLNA na TV e use o mesmo Wi-Fi (roteador pode isolar dispositivos)."
                        : "Recebi " + DlnaCastPlugin.lastRawResponses + " respostas, mas nenhuma TV com DLNA compatível.";
                    castMsg(msg, 9000);
                    return;
                }
                String[] names = new String[devs.size()];
                for (int i = 0; i < devs.size(); i++) names[i] = devs.get(i).name + "  (" + devs.get(i).ip() + ")";
                new AlertDialog.Builder(this).setTitle("Enviar para a TV").setItems(names, (d, i) -> {
                    final DlnaCastPlugin.Device dev = devs.get(i);
                    final long castFromMs = player != null ? player.getCurrentPosition() : 0; // continua de onde estava
                    final String srcUrl = currentUrl, srcRef = mReferer, srcTitle = mTitle;
                    final int qH = castQualityH;
                    castMsg("Enviando para " + dev.name + "…", 0);
                    new Thread(() -> {
                        // A TV não alcança a URL do CDN (punycode/HLS) nem um content:// →
                        // serve pela LAN: a TV busca do celular (que refaz o fetch com headers,
                        // descomprime gzip, reescreve o HLS e fatia o MP4 exportado com Range).
                        // Fallback = URL direta.
                        final String ip = localIp();
                        final String castUrl = ip != null ? ProxyServer.lan(srcUrl, srcRef, ip, qH) : srcUrl;
                        // Pré-aquece o master pelo proxy: a LG sonda a URL ANTES de responder o
                        // SetAVTransportURI — frio, estourava o timeout ("Read timed out").
                        final String warm = ProxyServer.prewarm(srcUrl, srcRef, qH);
                        runOnUiThread(() -> castMsg("Enviando para " + dev.name + "… (a TV está lendo o vídeo)", 0));
                        String err = null; DlnaCastPlugin.CastResult cr = null;
                        long tSend = System.currentTimeMillis();
                        try { cr = DlnaCastPlugin.castSync(dev.controlUrl, castUrl, srcTitle != null ? srcTitle : "WatchMov"); }
                        catch (DlnaCastPlugin.CastException ce) { err = ce.getMessage(); cr = ce.result; }
                        catch (Exception e) { err = e.getMessage() != null ? e.getMessage() : e.toString(); }
                        final long ms = System.currentTimeMillis() - tSend;
                        final String ferr = err, fres = cr != null ? cr.toString() : "";
                        String base = "[dlna] tv=" + dev.name + "@" + dev.ip() + " ipCelular=" + ip + " q=" + (qH > 0 ? qH + "p" : "max")
                            + " volume=" + (dev.renderUrl != null ? "sim" : "NAO(sem RenderingControl)")
                            + " posLocal=" + castFromMs + "ms " + fres + " total=" + ms + "ms " + warm + " url=" + castUrl;
                        if (ferr == null) NativePlayerPlugin.reportError(srcUrl, 0, 0, "DLNA_CONECTADO", base, mMime, srcRef, srcTitle);
                        else NativePlayerPlugin.reportError(srcUrl, 0, 0, "DLNA_FALHOU", "erro=" + ferr + " " + base, mMime, srcRef, srcTitle);
                        // Mostra o overlay JÁ (o seek leva alguns segundos) e SÓ DEPOIS
                        // dispara o seek: o startCasting incrementa o castGen, e o
                        // seekWithRetry usa esse gen como guarda — disparado antes, ele
                        // abortava sozinho e a TV começava do zero (o 1º espelhamento
                        // tem que continuar de onde o celular estava).
                        runOnUiThread(() -> {
                            castMsg(ferr == null ? "Tocando na TV — o app vira controle" : "TV recusou: " + ferr, ferr == null ? 4000 : 10000);
                            if (ferr != null) return;
                            activeDlnaRenderCtrl = dev.renderUrl;      // volume da TV (RenderingControl), se ela expõe
                            startCasting(CAST_DLNA, dev.controlUrl);
                            armCastWatchdog("inicial", castFromMs);   // vigia: estado/tráfego/travou (antes só no recast)
                            // Continua na posição atual do reprodutor (ex.: 30min → abre em
                            // 30min). COM retry+confirmação: o Seek logo após o Play é
                            // recusado enquanto a TV carrega — sem insistir, ela tocava do 0.
                            if (castFromMs > 3000) {
                                new Thread(() -> seekWithRetry(dev.controlUrl, castFromMs, "inicial")).start();
                            }
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

    // Referer/Origin do episódio ATUAL nos requests do player (muda no loadNextInPlace).
    private void applyRefererHeaders(String referer) {
        if (httpFactory == null) return;
        Map<String, String> headers = new HashMap<>();
        if (referer != null && !referer.isEmpty()) {
            headers.put("Referer", referer);
            try { headers.put("Origin", new java.net.URL(referer).getProtocol() + "://" + new java.net.URL(referer).getHost()); } catch (Exception ignored) {}
        }
        httpFactory.setDefaultRequestProperties(headers);
    }

    // "Próximo episódio": pede o link do próximo ao JS SEM fechar o player. Se o JS
    // não responder (ex.: o ep ainda não tem link capturado → precisa do servidor),
    // cai no comportamento antigo (fecha devolvendo "next") depois do timeout.
    private void requestNext(boolean fromCast) {
        if (awaitingNext) return;
        if (fromCast) {
            castMsg("Trocando de episódio na TV…", 4000);
            NativePlayerPlugin.reportError(currentUrl, 0, 0, "NEXT_CAST_CLICADO",
                "[recast] clique: castMode=" + castMode + " activeCastMode=" + activeCastMode
                + " ctrl=" + (activeDlnaCtrl != null), mMime, mReferer, mTitle);
        }
        saveResume();   // garante a posição do ep que está saindo na chave DELE
        if (!NativePlayerPlugin.requestNext()) { finishWithResult(true, false); return; }
        awaitingNext = true;
        status.setText("Carregando próximo episódio…");
        status.setVisibility(View.VISIBLE);
        if (castStatusTv != null && castMode != CAST_NONE) setCastStatus("Carregando próximo episódio…");
        progressHandler.postDelayed(nextTimeout, 9000);
    }

    // O JS não devolveu o próximo ep a tempo (sem link capturado) → fluxo antigo.
    private final Runnable nextTimeout = new Runnable() {
        @Override public void run() {
            if (!awaitingNext) return;
            awaitingNext = false;
            castFollowNext = activeCastMode != CAST_NONE;   // reabre já espelhando
            finishWithResult(true, false);
        }
    };

    // Troca o episódio SEM recriar a Activity: o player toca o novo link e, se há
    // espelhamento ativo, a mesma sessão recebe a nova mídia. url == null significa
    // que o JS não achou link pro próximo ep → cai no fluxo antigo (fecha o player).
    public void loadNextInPlace(final String url, final String referer, final String mime,
                                final String title, final String[] nUrls, final String[] nMimes,
                                final String[] nQualities, final boolean nHasNext, final String key,
                                final long startMs, final boolean nOffline, final boolean nWatched,
                                final boolean nDownloaded) {
        runOnUiThread(() -> {
            progressHandler.removeCallbacks(nextTimeout);
            if (!awaitingNext) return;
            awaitingNext = false;
            if (url == null || url.isEmpty()) {   // JS não resolveu → comportamento antigo
                castFollowNext = activeCastMode != CAST_NONE;
                finishWithResult(true, false);
                return;
            }
            saveResume();                       // posição final do ep anterior
            resumeKey = key;                    // a partir daqui salva na chave do NOVO ep
            // AVANÇAR = COMEÇAR DO ZERO. Não herda posição salva do ep seguinte: a TV
            // abria o ep novo em 0:50:19 (o tempo do anterior, gravado na chave errada
            // pelas versões antigas). Retomar de onde parou continua valendo quando o
            // usuário ABRE o episódio pela lista — só o "Próximo" começa do início.
            if (resumeKey != null && resumePrefs != null) resumePrefs.edit().remove(resumeKey).apply();
            final long start = 0;
            mReferer = referer;
            applyRefererHeaders(referer);
            mMime = mime; mTitle = title;
            urls = nUrls; mimes = nMimes; qualities = nQualities;
            hasNext = nHasNext; offline = nOffline; downloaded = nDownloaded || nOffline;
            watched = nWatched; userUnwatched = false;
            updateSourceUi(); updateWatchedUi();
            triedUrls.clear(); errorHandled = false;
            if (wmTitleTv != null) wmTitleTv.setText(title);
            if (activeCastMode != CAST_NONE) { activeCastKey = key; activeCastTitle = title; }
            if (watchedBtn != null) watchedBtn.setColorFilter(watched ? Color.parseColor("#4ADE80") : Color.WHITE);
            refreshShareBtn();                  // o novo ep pode não ter MP4 exportado
            if (nextBtn != null) nextBtn.setVisibility(hasNext ? View.VISIBLE : View.GONE);
            if (nextCastBtn != null) nextCastBtn.setVisibility(hasNext ? View.VISIBLE : View.GONE);
            // Zera o tempo do remoto: o overlay mostrava o tempo do ep ANTERIOR (a TV
            // devolve 0/0 enquanto carrega e o poll só sobrescreve com valor > 0).
            lastRemotePosMs = 0; lastRemoteDurMs = 0; recastRetries = 0;
            recastTargetMs = 0; posVelhaReportada = false;
            remoteSeekTarget = 0; remoteSeekAppliedAt = 0;
            if (castTimeTv != null) castTimeTv.setText(fmtClock(0) + " / " + fmtClock(0));
            updateCastSeek();
            // Espelhando: o local NÃO toca (os dois puxariam o mesmo HLS pelo mesmo
            // proxy). Parar o espelhamento devolve o áudio/play local.
            castSilentStart = activeCastMode != CAST_NONE;
            playUrl(url, mime, start);
            if (activeCastMode != CAST_NONE) recastCurrent(start);
            refreshMediaNotification();   // título/⏭ do novo episódio
        });
    }

    private void finishWithResult(boolean next, boolean server) { finishWithResult(next, server, false); }

    private void finishWithResult(boolean next, boolean server, boolean recapture) {
        saveResume();
        Intent data = new Intent();
        if (player != null) data.putExtra(RESULT_POSITION, player.getCurrentPosition());
        data.putExtra(RESULT_URL, currentUrl);
        data.putExtra(RESULT_NEXT, next);
        data.putExtra(RESULT_SERVER, server);
        data.putExtra(RESULT_RECAPTURE, recapture);
        data.putExtra(RESULT_WATCHED, watched); // estado final do "assistido" (fonte da verdade no fechar)
        data.putExtra(RESULT_WATCHED_KEY, resumeKey);   // …e de qual episódio ele é
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
            data.putExtra(RESULT_WATCHED, watched);
            data.putExtra(RESULT_WATCHED_KEY, resumeKey);
            setResult(RESULT_OK, data);
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        MediaNotificationService.clearController(this);
        // Fechou o player COM a TV tocando → o serviço assume sozinho (headless): a
        // notificação segue com ⏯/Parar, o proxy continua vivo e o app reassume ao
        // reabrir. Sem espelhamento → a notificação some como antes.
        if (isCasting()) MediaNotificationService.goHeadless(this, CastSessionStore.load(this));
        else MediaNotificationService.hide(this);
        awaitingNext = false;
        progressHandler.removeCallbacks(nextTimeout);
        progressHandler.removeCallbacks(progressTick);
        progressHandler.removeCallbacks(castPoll);
        if (player != null) { player.release(); player = null; }
        if (castSessionManager != null && castSessionListener != null) {
            castSessionManager.removeSessionManagerListener(castSessionListener, com.google.android.gms.cast.framework.CastSession.class);
        }
        super.onDestroy();
    }

    // ---- Notificação de mídia (MediaNotificationService.Controller) ----
    // Os botões da notificação/tela bloqueada caem aqui, na UI thread.

    @Override public void onNotifSetPlaying(boolean play) {
        if (castMode == CAST_CC) {
            com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc();
            if (r != null) { if (play) r.play(); else r.pause(); }
        } else if (castMode == CAST_DLNA) {
            if (play == dlnaPaused) remotePlayPause();   // remotePlayPause é toggle → só quando muda
        } else if (player != null) {
            if (play) { player.setVolume(1f); player.play(); } else player.pause();
        }
        refreshMediaNotification();
    }

    @Override public void onNotifNext() {
        if (!hasNext) return;
        requestNext(castMode != CAST_NONE);
    }

    @Override public void onNotifSeekTo(long positionMs) {
        if (castMode != CAST_NONE) { remoteSeekTo(positionMs); lastRemotePosMs = Math.max(0, positionMs); updateCastSeek(); }
        else if (player != null) player.seekTo(Math.max(0, positionMs));
        refreshMediaNotification();
    }

    // "Parar" da notificação (só aparece espelhando): mesmo efeito do "Parar espelhamento"
    // do overlay. Sem cast (STOP da MediaSession no local) só pausa.
    @Override public void onNotifStop() {
        if (castMode == CAST_NONE) { if (player != null) player.pause(); refreshMediaNotification(); return; }
        castMsg("Parando espelhamento…", 2500);
        if (castMode == CAST_CC && castSessionManager != null) castSessionManager.endCurrentSession(true);
        else stopCasting(true);
    }

    // Estado atual → notificação. Barato de chamar (só re-posta quando algo visível muda).
    private void refreshMediaNotification() {
        if (isFinishing() || isDestroyed()) return;
        boolean cast = castMode != CAST_NONE;
        boolean playing; long pos, dur; String sub;
        if (cast) {
            if (castMode == CAST_DLNA) playing = !dlnaPaused;
            else { com.google.android.gms.cast.framework.media.RemoteMediaClient r = rmc(); playing = r != null && r.isPlaying(); }
            pos = lastRemotePosMs; dur = lastRemoteDurMs;
            String onde = castMode == CAST_CC ? "no Chromecast" : "na TV (DLNA)";
            sub = (playing ? "Reproduzindo " : "Pausado ") + onde;
        } else {
            if (player == null) return;
            int st = player.getPlaybackState();
            playing = player.getPlayWhenReady() && st != androidx.media3.common.Player.STATE_ENDED && st != androidx.media3.common.Player.STATE_IDLE;
            pos = player.getCurrentPosition();
            dur = player.getDuration() > 0 ? player.getDuration() : 0;
            sub = playing ? "Reproduzindo" : "Pausado";
        }
        MediaNotificationService.update(this, mTitle, sub, playing, hasNext, cast, pos, dur);
    }

    // Android 13+: sem POST_NOTIFICATIONS a notificação de mídia não aparece. O app já
    // pede no boot (push); aqui só garante — se já foi negada de vez, não abre nada.
    private void ensureNotifPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        try {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{ android.Manifest.permission.POST_NOTIFICATIONS }, 7331);
        } catch (Exception ignored) {}
    }

    private Button pill(String text, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(18);
        b.setBackground(pillBg());
        b.setPadding(48, 26, 48, 26);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = 14;
        b.setLayoutParams(lp);
        // Toda pill dá feedback de clique: pressed muda o fundo (pillBg) e o clique dá um
        // "pulso" de escala — o pressed sozinho dura ~64ms num toque rápido e não se vê.
        if (onClick != null) b.setOnClickListener(v -> { clickPulse(v); onClick.onClick(v); });
        return b;
    }

    // Fundo dos botões com estado PRESSIONADO visível: normal = preto translúcido (como
    // antes); pressionado/focado = roxo + borda branca. Antes era setBackgroundColor
    // fixo → "não dá sensação de clique" (pedido dele 03/09).
    private android.graphics.drawable.Drawable pillBg() {
        android.graphics.drawable.GradientDrawable normal = new android.graphics.drawable.GradientDrawable();
        normal.setColor(Color.parseColor("#99000000")); normal.setCornerRadius(12);
        android.graphics.drawable.GradientDrawable pressed = new android.graphics.drawable.GradientDrawable();
        pressed.setColor(Color.parseColor("#CC7C3AED")); pressed.setCornerRadius(12); pressed.setStroke(3, Color.WHITE);
        android.graphics.drawable.StateListDrawable sl = new android.graphics.drawable.StateListDrawable();
        sl.addState(new int[]{ android.R.attr.state_pressed }, pressed);
        sl.addState(new int[]{ android.R.attr.state_focused }, pressed);
        sl.addState(new int[]{}, normal);
        return sl;
    }

    private static void clickPulse(View v) {
        v.animate().cancel();
        v.setScaleX(1f); v.setScaleY(1f);
        v.animate().scaleX(0.9f).scaleY(0.9f).setDuration(70)
            .withEndAction(() -> v.animate().scaleX(1f).scaleY(1f).setDuration(130).start()).start();
    }
}
