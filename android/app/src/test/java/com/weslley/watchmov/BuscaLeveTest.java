package com.weslley.watchmov;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.widget.FrameLayout;

import org.junit.Test;

/** 01/11/2026 (W3 das quedas na Fire TV): a busca escondida fica mais leve na TV. */
public class BuscaLeveTest {

    @Test
    public void naTvAJanelaDaBuscaEMetadeDaTela() {
        assertArrayEquals(new int[] { 960, 540 }, ResolverPlugin.tamanhoDaBusca(true, 1920, 1080));
        assertArrayEquals(new int[] { 640, 360 }, ResolverPlugin.tamanhoDaBusca(true, 1280, 720));
    }

    @Test
    public void noCelularOuSemMedidaATelaToda() {
        int[] cheia = { FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT };
        assertArrayEquals(cheia, ResolverPlugin.tamanhoDaBusca(false, 1080, 2400));
        assertArrayEquals(cheia, ResolverPlugin.tamanhoDaBusca(true, 0, 0));
    }

    @Test
    public void desafioDaCloudflareNuncaEBarrado() {
        assertFalse(ResolverPlugin.recursoDispensavelNaTv("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/pat/x.png", "image/png"));
        assertFalse(ResolverPlugin.recursoDispensavelNaTv("https://site.exemplo/cdn-cgi/challenge-platform/h/b/orchestrate/logo.svg", null));
        assertTrue(ResolverPlugin.recursoDispensavelNaTv("https://site.exemplo/assets/logo.svg", null));
    }
}
