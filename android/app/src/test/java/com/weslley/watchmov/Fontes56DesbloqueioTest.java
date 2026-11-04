package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** 04/11/2026: Desbloqueio das Fontes 5 (superflixapi) e 6 (warezcdn) — esconde o nome do app, sem tocar no frame da Cloudflare. */
public class Fontes56DesbloqueioTest {
    @Test
    public void identificaSomenteFontes5e6() {
        assertTrue(StreamSnifferPlugin.precisaEsconderApp("https://superflixapi.fun/filme/tt0433035"));
        assertTrue(StreamSnifferPlugin.precisaEsconderApp("https://superflixonline.lat/filme/1368337"));
        assertTrue(StreamSnifferPlugin.precisaEsconderApp("https://warezcdn.sbs/filme/39254"));
        assertTrue(StreamSnifferPlugin.precisaEsconderApp("https://overflixhd.sbs/filme/1368337"));
        assertTrue(StreamSnifferPlugin.precisaEsconderApp("https://megaflixonline.sbs/filme/1368337"));
        // 04/11/2026: player final (FirePlayer da SuperFlixAPI) que a WarezCDN abre no iframe — o access.js dele bloqueia
        // "com.weslley.watchmov" (fireAccessBlockType "app") quando a página /video/ chega com o X-Requested-With do app.
        assertTrue(StreamSnifferPlugin.precisaEsconderApp("https://xn--tckasiu6cvova0eb5fua2449g98vg.best/video/b568a8236bc5ff33ec47e46657336dcc"));
        assertTrue(StreamSnifferPlugin.precisaEsconderApp("https://xn--tckasiu6cvova0eb5fua2449g98vg.xn--tckasiu6cvova0eb5fua2449g98vg.best/fireplayer-control/access.js?url=x"));
        // ...mas a mídia (master.txt de uso único, faixas /m3/) e o POST /layer/ seguem pelo WebView.
        assertFalse(StreamSnifferPlugin.precisaEsconderApp("https://xn--tckasiu6cvova0eb5fua2449g98vg.best/OfJnAipASabPR4mZ250tqw/78f60a8b9d7e45018c7773c5fa360679/1793831847/master.txt"));
        assertFalse(StreamSnifferPlugin.precisaEsconderApp("https://xn--tckasiu6cvova0eb5fua2449g98vg.best/layer/9e12322db46d4cc3/b568a8236bc5ff33ec47e46657336dcc/"));
        assertFalse(StreamSnifferPlugin.precisaEsconderApp("https://challenges.cloudflare.com/turnstile/v0/api.js"));
        assertFalse(StreamSnifferPlugin.precisaEsconderApp("https://myembed.biz/filme/39254"));
    }

    @Test
    public void limpaNomeDoAppDoUserAgent() {
        String ua = "Mozilla/5.0 (Linux; Android 11; AFTMM Build/RS8332; wv) AppleWebKit/537.36 com.weslley.watchmov Chrome/120.0.0.0";
        String limpo = StreamSnifferPlugin.uaLimpo(ua);
        assertFalse(limpo.contains("; wv"));
        assertFalse(limpo.contains("com.weslley.watchmov"));
        assertTrue(limpo.contains("AFTMM Build/RS8332)"));
    }

    @Test
    public void preparaHtmlDaVerificacaoSemFalsoErroDe12sEComPostSemNome() {
        String html = "<html><head></head><body><form id=\"f\"><input name=\"cf_embed_challenge\" value=\"1\"></form>"
            + "<script>window.cloudflareEmbedCaptchaPassed=function(t){form.submit();};"
            + "if(!hasTurnstile) showRetry('erro');</script></body></html>";
        String out = StreamSnifferPlugin.preparaHtmlVerificacao(html);
        assertFalse(out.contains("if(!hasTurnstile)"));
        assertTrue(out.contains("if(false) showRetry('erro')"));
        assertTrue(out.contains("__wm_post"));
        assertTrue(out.contains("WMCFTAP|"));
        assertTrue(out.contains("X-WM-Post-Body"));
    }

    @Test
    public void identificaPaginaEntradaEmbedEExtraiMediaSourceNativo() {
        assertTrue(StreamSnifferPlugin.ehPaginaEntradaEmbed("https://warezcdn.sbs/filme/39254"));
        assertTrue(StreamSnifferPlugin.ehPaginaEntradaEmbed("https://superflixapi.fun/serie/1399/1/1"));
        assertFalse(StreamSnifferPlugin.ehPaginaEntradaEmbed("https://warezcdn.sbs/player/bootstrap"));
        assertFalse(StreamSnifferPlugin.ehPaginaEntradaEmbed("https://warezcdn.sbs/player/redirect?t=abc"));

        String nmpHtml = "var SOURCES = [{\"src\":\"https:\\/\\/warezcdn.sbs\\/player\\/native\\/media-source\\/nms_ABC123\",\"type\":\"video\\/mp4\"}];";
        assertEquals("https://warezcdn.sbs/player/native/media-source/nms_ABC123", StreamSnifferPlugin.extrairMediaSourceNativo(nmpHtml));
        assertNull(StreamSnifferPlugin.extrairMediaSourceNativo("<html><body>sem fonte</body></html>"));
    }

    @Test
    public void preparaHtmlDoPlayerLiberandoCliqueSinteticoNoServidor() {
        String playerHtml = "<html><head></head><body><script>const SF_DOM_IDS = {};"
            + "if (!event.originalEvent || event.originalEvent.isTrusted !== true) return;"
            + "function renderServerList(t){}</script></body></html>";
        String out = StreamSnifferPlugin.preparaHtmlVerificacao(playerHtml);
        assertFalse(out.contains("event.originalEvent.isTrusted !== true"));
        assertTrue(out.contains("sfDomEl('serverList')"));
    }

    @Test
    public void listaVaziaEnquantoOBootstrapCarregaNaoViraSemServidor() {
        // 04/11/2026: a lista chega pelo POST /player/bootstrap DEPOIS da página completa (A Odisseia na Fonte 6
        // pulava pra Fonte 7). Só desiste quando a página escreve na lista que não há servidor ou que falhou.
        String playerHtml = "<html><head></head><body><script>const SF_DOM_IDS = {};"
            + "function renderServerList(t){}</script></body></html>";
        String out = StreamSnifferPlugin.preparaHtmlVerificacao(playerHtml);
        assertFalse(out.contains("document.readyState==='complete'"));
        assertTrue(out.contains("box.innerText||box.textContent"));
        assertTrue(out.contains("f56-sem-servidor"));
        assertTrue(out.contains("f56-erro-servidores"));
    }

    @Test
    public void masterTxtDoPlayerFinalNaoViraLinkNemProbe() {
        // 04/11/2026: o master.txt do FirePlayer só vale UMA vez, pro pedido do próprio player (o ExoPlayer e o OkHttp
        // levavam 403). O link tocável sai das faixas /m3/ (re-buscáveis) pelo synth:// COMPLETO da v4.50.
        String master = "https://xn--tckasiu6cvova0eb5fua2449g98vg.best/OfJnAipASabPR4mZ250tqw/78f60a8b9d7e45018c7773c5fa360679/1793831847/master.txt";
        assertFalse(StreamSnifferPlugin.looksLikeVideo(master));
        assertTrue(StreamSnifferPlugin.skipProbe(master));
        assertFalse(StreamSnifferPlugin.skipProbe("https://xn--tckasiu6cvova0eb5fua2449g98vg.best/m3/OfJnAipASabPR4mZ250tqw/1793831847/aHR0cHM6Ly9leGFtcGxl"));
    }
}
