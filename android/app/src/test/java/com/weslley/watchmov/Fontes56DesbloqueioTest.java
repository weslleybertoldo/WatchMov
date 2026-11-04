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
        assertTrue(StreamSnifferPlugin.precisaEsconderApp("https://warezcdn.sbs/filme/39254"));
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
}
