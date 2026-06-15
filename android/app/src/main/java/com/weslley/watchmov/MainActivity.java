package com.weslley.watchmov;

import android.os.Bundle;
import android.os.Message;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ScreenCastPlugin.class);
        super.onCreate(savedInstanceState);

        // Bloqueio de popups/anúncios dos players de embed (BetterFlix/Fembed etc).
        // Nível nativo do WebView — NÃO usa o atributo sandbox do iframe (que os
        // players detectam). O vídeo continua tocando; só as novas janelas/redirects
        // de anúncio (window.open / target=_blank) são engolidos silenciosamente.
        WebView webView = this.bridge.getWebView();
        // Bloqueia window.open automático (sem gesto do usuário).
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        // Precisa estar true pra o onCreateWindow ser chamado e a gente recusar.
        webView.getSettings().setSupportMultipleWindows(true);
        webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // Recusa abrir a nova janela (popup de anúncio). Retornar false sem
                // enviar resultMsg = nada é aberto e o player segue intacto.
                return false;
            }
        });
    }
}
