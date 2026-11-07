package com.weslley.watchmov;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;

import com.getcapacitor.CapacitorWebView;

import java.lang.ref.WeakReference;

/**
 * O WebView da página do app: o mesmo CapacitorWebView de sempre (res/layout/capacitor_bridge_layout_main.xml troca o
 * do Capacitor por este), com uma diferença só na TV.
 *
 * Controle remoto (pedido dele 07/11/2026): com o player nativo na frente, a janela da página some, o WebView avisa o
 * Chromium que ficou invisível e a página CONGELA uns segundos depois (medido no emulador wm_tv: um setInterval de 1 s
 * bateu 0 vezes em 8 s e as mensagens do canal ficaram paradas; a Fire TV faz o mesmo com o motor ABYS, ver
 * ResolverPlugin, 25/09/2026). Resultado: o celular não comandava mais o player e o "Enviar pra TV" parava de responder
 * no meio do filme.
 *
 * Na TV, enquanto um PlayerActivity está na frente, a página segue se achando visível — o mesmo truque do motor. Ela
 * não desenha nada (a janela dela continua escondida atrás do player); só o JS segue vivo. O que só serve pra tela de
 * trás continua parado pelo JS (usePaginaVisivel olha se o player nativo está aberto). Player fechado ou app no fundo →
 * a página volta à visibilidade de verdade (e o Chromium congela como sempre).
 */
public class PaginaViva extends CapacitorWebView {
    private static int playersNaFrente;   // PlayerActivity entre onStart e onStop (UI thread)
    private static WeakReference<PaginaViva> atual = new WeakReference<>(null);

    public PaginaViva(Context context, AttributeSet attrs) {
        super(context, attrs);
        atual = new WeakReference<>(this);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(manterViva() ? View.VISIBLE : visibility);
    }

    private boolean manterViva() {
        return playersNaFrente > 0 && TvMode.isTv(getContext());
    }

    /** PlayerActivity.onStart (true) / onStop (false), na UI thread. Contador: um player novo pode abrir antes do outro parar. */
    static void player(boolean naFrente) {
        playersNaFrente = Math.max(0, playersNaFrente + (naFrente ? 1 : -1));
        PaginaViva w = atual.get();
        // Saiu o último player (fechou ou o app foi pro fundo): a página recebe a visibilidade real da janela dela.
        if (w != null && playersNaFrente == 0) w.onWindowVisibilityChanged(w.getWindowVisibility());
    }
}
