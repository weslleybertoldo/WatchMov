package com.weslley.watchmov;

import android.os.Bundle;
import android.os.Message;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

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
        super.onCreate(savedInstanceState);

        // Bloqueio de popups/anúncios dos players de embed (BetterFlix/Fembed etc).
        // Nível nativo do WebView — NÃO usa o atributo sandbox do iframe (que os
        // players detectam). Indetectável pelo JS do site.
        WebView webView = this.bridge.getWebView();
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        webView.getSettings().setSupportMultipleWindows(true);

        // 1) window.open clássico → recusa a nova janela.
        webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                return false;
            }
        });

        // 2) Popunder/redirect por navegação top-frame: o player troca a URL do
        // DOCUMENTO INTEIRO pra rede de anúncio; sem isso o Capacitor abriria no
        // Chrome via Intent. Bloqueamos só main-frame fora da allowlist (retornar
        // true sem startActivity = navegação abortada, player intacto). Subframes
        // (o iframe do player e seus recursos/vídeo) passam normalmente.
        webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && !isAllowedTopNav(request.getUrl().getHost())) {
                    return true; // engole o redirect de anúncio
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }
}
