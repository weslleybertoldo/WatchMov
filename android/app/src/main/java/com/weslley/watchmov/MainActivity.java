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
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        webView.getSettings().setSupportMultipleWindows(true);

        webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            // Popup clássico (window.open) → recusa.
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                return false;
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
                    String u = request.getUrl().toString();
                    if (StreamSnifferPlugin.looksLikeVideo(u)) {
                        String ref = null;
                        Map<String, String> h = request.getRequestHeaders();
                        if (h != null) ref = h.get("Referer");
                        StreamSnifferPlugin.onVideoUrl(u, ref);
                    }
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
                            String u = request.getUrl().toString();
                            if (StreamSnifferPlugin.looksLikeVideo(u)) {
                                String ref = null;
                                Map<String, String> h = request.getRequestHeaders();
                                if (h != null) ref = h.get("Referer");
                                StreamSnifferPlugin.onVideoUrl(u, ref);
                            }
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
