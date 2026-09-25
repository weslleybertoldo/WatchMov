package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** ABYS (25/09/2026): qualidade que chega com o player aberto — entra no menu e troca sozinho só pra maior. */
public class LiveQualityTest {
    private static final String A360 = "http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/360p.mp4";
    private static final String A1080 = "http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/1080p.mp4";
    private static final String OUTRA = "http://127.0.0.1:8099/abyss/zzzz9999/1080p.mp4";

    @Test
    public void alturaPeloRotulo() {
        assertEquals(1080, LiveQuality.height("1080p"));
        assertEquals(360, LiveQuality.height("360p"));
        assertEquals(0, LiveQuality.height(""));
        assertEquals(0, LiveQuality.height(null));
    }

    @Test
    public void trocaSozinhoSoPraMaior() {
        assertTrue(LiveQuality.shouldSwitch("360p", "1080p"));
        assertTrue(LiveQuality.shouldSwitch("720p", "1080p"));
        assertFalse(LiveQuality.shouldSwitch("1080p", "720p"));   // menor: só entra no menu
        assertFalse(LiveQuality.shouldSwitch("720p", "720p"));
        assertFalse(LiveQuality.shouldSwitch("", "1080p"));       // não sei a atual: não troca no escuro
    }

    @Test
    public void aoAbrir_comecaNaMaiorDoMesmoMotor() {
        String a720 = "http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/720p.mp4";
        String[] urls = { a720, A360, A1080 };
        String[] qs = { "720p", "360p", "1080p" };
        assertEquals(2, LiveQuality.bestIndex(a720, urls, qs));        // a 1080p chegou antes da tela: começa nela
        assertEquals(-1, LiveQuality.bestIndex(A1080, urls, qs));      // já é a maior
        assertEquals(-1, LiveQuality.bestIndex(a720, new String[]{ a720, OUTRA }, new String[]{ "720p", "1080p" }));   // outro motor: não
        assertEquals(-1, LiveQuality.bestIndex("https://x.y/master.m3u8", urls, qs));   // não é /abyss/: não mexe
        assertEquals(2, LiveQuality.bestIndex(a720, urls, null));      // sem rótulos: lê a altura da URL
    }

    @Test
    public void soDoMesmoMotor() {
        assertEquals("rgrpr4ckmugeill5", LiveQuality.abyssSid(A1080));
        assertTrue(LiveQuality.sameEngine(A360, A1080));
        assertFalse(LiveQuality.sameEngine(A360, OUTRA));   // sessão velha/outro título
        assertFalse(LiveQuality.sameEngine("https://x.y/master.m3u8", A1080));
        assertNull(LiveQuality.abyssSid("https://x.y/v.mp4"));
    }
}
