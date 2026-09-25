package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Link com prazo (Fonte 6 vence em ~10 min, 24/09/2026) e quando pedir link novo ao app. */
public class LinkExpiryTest {
    private static final String F6 = "https://vid7102402.hclod.qzz.io/st/_s3_/v14/1032863/playlist.m3u8?md5=WbC2m_gT-K5Jptmb_lu9TQ&expires=1790223765";

    @Test
    public void prazo_emSegundosOuMs_eDentroDaUrlDoProxy() throws Exception {
        assertEquals(1790223765000L, LinkExpiry.expiresAtMs(F6));
        assertEquals(1790223765000L, LinkExpiry.expiresAtMs("https://x.y/a.m3u8?exp=1790223765000&t=1"));
        String proxied = "http://127.0.0.1:8099/s?u=" + java.net.URLEncoder.encode(F6, "UTF-8") + "&r=x";
        assertEquals(1790223765000L, LinkExpiry.expiresAtMs(proxied));
    }

    @Test
    public void semPrazoOuNumeroSemCaraDeData_nuncaVence() {
        assertEquals(-1, LinkExpiry.expiresAtMs("https://embedplayer2.xyz/cdn/hls/abc/master.m3u8"));
        assertEquals(-1, LinkExpiry.expiresAtMs("http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/1080p.mp4"));
        assertEquals(-1, LinkExpiry.expiresAtMs("https://x.y/v.mp4?X-Amz-Expires=604800"));
        assertEquals(-1, LinkExpiry.expiresAtMs("https://x.y/v.mp4?expires=9999999999"));
        assertEquals(-1, LinkExpiry.expiresAtMs(null));
    }

    @Test
    public void vencido_comUmMinutoDeMargem() {
        long t = 1790223765000L;
        assertTrue(LinkExpiry.isExpired(F6, t + 1));
        assertTrue(LinkExpiry.isExpired(F6, t - 30_000));
        assertFalse(LinkExpiry.isExpired(F6, t - 5 * 60_000));
        assertFalse(LinkExpiry.isExpired("https://embedplayer2.xyz/cdn/hls/abc/master.m3u8", t));
    }

    @Test
    public void pedeLinkNovo_quandoVenceuOuCaiuNoMeio() {
        // venceu (403/410 ou prazo da URL): sempre, mesmo sem ter tocado
        assertTrue(LinkExpiry.shouldRecapture(410, false, false));
        assertTrue(LinkExpiry.shouldRecapture(403, false, false));
        assertTrue(LinkExpiry.shouldRecapture(0, true, false));
        // caiu no meio do filme (já tocou): servidor fora, rede, motor /abyss/ parado
        assertTrue(LinkExpiry.shouldRecapture(503, false, true));
        assertTrue(LinkExpiry.shouldRecapture(0, false, true));
        assertTrue(LinkExpiry.shouldRecapture(429, false, true));
        // nunca tocou e não venceu (404, formato, 5xx logo de cara) → não insiste
        assertFalse(LinkExpiry.shouldRecapture(404, false, false));
        assertFalse(LinkExpiry.shouldRecapture(503, false, false));
        assertFalse(LinkExpiry.shouldRecapture(404, false, true));
    }
}
