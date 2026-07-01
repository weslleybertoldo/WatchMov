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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ScreenCastPlugin.class);
        registerPlugin(ImmersivePlugin.class);
        registerPlugin(StreamSnifferPlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(DlnaCastPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        webView.getSettings().setSupportMultipleWindows(true);

        webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            // Popup (window.open): fora da captura recusa (anti-anúncio). DURANTE a
            // captura, abre numa WebView oculta e observa o tráfego dela — vários
            // players (ex. SuperFlix) abrem o vídeo em popup (como o Web Video Cast).
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                if (!StreamSnifferPlugin.isWatching()) return false;
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
                            if (StreamSnifferPlugin.isWatching() && req.getUrl() != null) {
                                StreamSnifferPlugin.inspect(req.getUrl().toString(), req.getRequestHeaders());
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
                if (StreamSnifferPlugin.isWatching() && request.getUrl() != null) {
                    StreamSnifferPlugin.inspect(request.getUrl().toString(), request.getRequestHeaders());
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
                        if (StreamSnifferPlugin.isWatching() && request.getUrl() != null) {
                            StreamSnifferPlugin.inspect(request.getUrl().toString(), request.getRequestHeaders());
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
