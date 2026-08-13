package com.weslley.watchmov;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.FrameLayout;

import java.util.Map;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    private View customView;                              // view de fullscreen HTML5 do player
    private WebChromeClient.CustomViewCallback customViewCallback;
    private WebView sniffPopup;                           // popup oculta sniffada durante a captura

    // Hosts cuja navegação top-frame é permitida (app + login OAuth). Qualquer outra
    // navegação de documento inteiro = popunder/redirect de anúncio → bloqueada.
    private static boolean isAllowedTopNav(String host) {
        if (host == null) return false;
        host = host.toLowerCase();
        return host.equals("watchmovbr.vercel.app")
            || host.equals("localhost")
            || host.endsWith(".supabase.co")
            || host.endsWith("accounts.google.com")
            || host.endsWith(".google.com")
            || host.endsWith(".googleusercontent.com");
    }

    // Captador de crash: grava a stack em Movies/WatchMov/watchmov-crash.txt ANTES do
    // app morrer. Pega exceção Java não-tratada em QUALQUER thread (FGS, RemoteViews,
    // etc.). SIGSEGV nativo NÃO cai aqui — se o app fecha e o arquivo NÃO aparece, o
    // crash é nativo (ex. muxer do Transformer). Diagnóstico sem precisar de PC/logcat.
    private void installCrashCatcher() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, ex) -> {
            try {
                java.io.StringWriter sw = new java.io.StringWriter();
                ex.printStackTrace(new java.io.PrintWriter(sw));
                String txt = "thread=" + thread.getName() + "\n" + sw + "\n";
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, "watchmov-crash.txt");
                v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "text/plain");
                if (android.os.Build.VERSION.SDK_INT >= 29)
                    v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_MOVIES + "/WatchMov");
                android.net.Uri col = android.os.Build.VERSION.SDK_INT >= 29
                    ? android.provider.MediaStore.Downloads.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    : android.provider.MediaStore.Files.getContentUri("external");
                android.net.Uri uri = getContentResolver().insert(col, v);
                if (uri != null) {
                    try (java.io.OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os != null) { os.write(txt.getBytes()); os.flush(); }
                    }
                }
            } catch (Throwable ignored) {}
            if (prev != null) prev.uncaughtException(thread, ex);
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        installCrashCatcher();
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ScreenCastPlugin.class);
        registerPlugin(ImmersivePlugin.class);
        registerPlugin(StreamSnifferPlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(DlnaCastPlugin.class);
        registerPlugin(ExternalCastPlugin.class);
        registerPlugin(DownloaderPlugin.class);
        registerPlugin(Mp4DownloadPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        webView.getSettings().setSupportMultipleWindows(true);

        webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            // Popup (window.open): fora da captura recusa (anti-anúncio). DURANTE a
            // captura, abre numa WebView oculta e observa o tráfego dela — vários
            // players (ex. SuperFlix) abrem o vídeo em popup (como o Web Video Cast).
            // COMO O WVC (xw0.onCreateWindow): popup SEM gesto do usuário = anúncio →
            // bloqueia (return false). Só abre o sniffer quando o popup veio de um
            // toque real (isUserGesture) — assim o stream real é pego no frame/SW
            // principal e a propaganda não polui a lista nem rouba o play.
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                if (!StreamSnifferPlugin.isWatching()) return false;
                if (!isUserGesture) return false;   // anúncio auto-aberto → bloqueia
                try {
                    if (sniffPopup != null) { try { sniffPopup.destroy(); } catch (Exception ignored) {} }
                    sniffPopup = new WebView(MainActivity.this);
                    android.webkit.WebSettings ps = sniffPopup.getSettings();
                    ps.setJavaScriptEnabled(true);
                    ps.setDomStorageEnabled(true);
                    ps.setMediaPlaybackRequiresUserGesture(false);
                    ps.setSupportMultipleWindows(true);
                    ps.setJavaScriptCanOpenWindowsAutomatically(true);
                    sniffPopup.setWebViewClient(new android.webkit.WebViewClient() {
                        @Override
                        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                            String u = req.getUrl() != null ? req.getUrl().toString() : null;
                            if (StreamSnifferPlugin.shouldBlockResource(u)) return StreamSnifferPlugin.blockedResponse();
                            if (StreamSnifferPlugin.isWatching() && u != null) {
                                StreamSnifferPlugin.inspect(u, req.getRequestHeaders());
                            }
                            return null;
                        }
                    });
                    FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                    sniffPopup.setLayoutParams(new FrameLayout.LayoutParams(1, 1));
                    decor.addView(sniffPopup);
                    WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
                    t.setWebView(sniffPopup);
                    resultMsg.sendToTarget();
                    return true;
                } catch (Exception e) { return false; }
            }

            // Botão de tela cheia DO PRÓPRIO player (HTML5 Fullscreen API). Sem isso
            // o WebView não atende o pedido e o "expandir" do servidor fica travado.
            // O player centraliza/ajusta o vídeo certo (sem corte) e nós tratamos
            // orientação + barras + entalhe.
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customViewCallback = callback;
                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                decor.addView(customView, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                applyImmersive(true);
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                decor.removeView(customView);
                customView = null;
                if (customViewCallback != null) { customViewCallback.onCustomViewHidden(); customViewCallback = null; }
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                applyImmersive(false);
            }
        });

        // Popunder/redirect por navegação top-frame: bloqueia main-frame fora da
        // allowlist (retornar true sem startActivity = navegação abortada, player
        // intacto). Subframes (iframe do player + recursos/vídeo) passam normais.
        webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Esquema não-web (shopee://, intent://, market://…) em QUALQUER frame:
                // anúncio tentando abrir app externo — o Bridge do Capacitor repassaria
                // pro startActivity. Aborta aqui (nenhum fluxo legítimo do app navega
                // o WebView pra esquema custom; o deep link do login entra por fora).
                String scheme = request.getUrl() != null ? request.getUrl().getScheme() : null;
                if (scheme != null && !scheme.equals("http") && !scheme.equals("https")
                        && !scheme.equals("data") && !scheme.equals("blob")
                        && !scheme.equals("about") && !scheme.equals("file")) {
                    return true;
                }
                if (request.isForMainFrame() && !isAllowedTopNav(request.getUrl().getHost())) {
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }

            // Sniffer passivo: observa o tráfego do iframe do servidor (que roda
            // neste mesmo WebView) e, ao ver a URL do stream, avisa o JS via plugin.
            // Só emite quando o JS "armou" a captura (StreamSnifferPlugin.watching).
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String u = request.getUrl() != null ? request.getUrl().toString() : null;
                if (StreamSnifferPlugin.shouldBlockResource(u)) return StreamSnifferPlugin.blockedResponse();
                if (StreamSnifferPlugin.isWatching() && u != null) {
                    StreamSnifferPlugin.inspect(u, request.getRequestHeaders());
                }
                return super.shouldInterceptRequest(view, request);
            }
        });

        // Muitos players buscam o stream via SERVICE WORKER — que não passa pelo
        // WebViewClient acima. Intercepta o SW também (como o Web Video Cast).
        if (android.os.Build.VERSION.SDK_INT >= 24) {
            try {
                android.webkit.ServiceWorkerController.getInstance().setServiceWorkerClient(new android.webkit.ServiceWorkerClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                        String u = request.getUrl() != null ? request.getUrl().toString() : null;
                        if (StreamSnifferPlugin.shouldBlockResource(u)) return StreamSnifferPlugin.blockedResponse();
                        if (StreamSnifferPlugin.isWatching() && u != null) {
                            StreamSnifferPlugin.inspect(u, request.getRequestHeaders());
                        }
                        return null;
                    }
                });
            } catch (Exception ignored) {}
        }
    }

    // Liga/desliga tela cheia imersiva. NÃO mexe no layoutInDisplayCutoutMode pra
    // não deixar faixa cinza residual ao sair (o sistema faz letterbox preto no
    // entalhe em paisagem, sem resíduo).
    private void applyImmersive(boolean on) {
        Window w = getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, !on);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        if (on) {
            c.hide(WindowInsetsCompat.Type.systemBars());
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
    }
}
