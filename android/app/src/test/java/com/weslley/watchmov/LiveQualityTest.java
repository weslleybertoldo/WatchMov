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
        assertTrue(LiveQuality.shouldSwitch("360p", "1080p", 0));
        assertTrue(LiveQuality.shouldSwitch("720p", "1080p", 0));
        assertFalse(LiveQuality.shouldSwitch("1080p", "720p", 0));   // menor: só entra no menu
        assertFalse(LiveQuality.shouldSwitch("720p", "720p", 0));
        assertFalse(LiveQuality.shouldSwitch("", "1080p", 0));       // não sei a atual: não troca no escuro
    }

    @Test
    public void aoAbrir_comecaNaMaiorDoMesmoMotor() {
        String a720 = "http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/720p.mp4";
        String[] urls = { a720, A360, A1080 };
        String[] qs = { "720p", "360p", "1080p" };
        assertEquals(2, LiveQuality.bestIndex(a720, urls, qs, 0));        // a 1080p chegou antes da tela: começa nela
        assertEquals(-1, LiveQuality.bestIndex(A1080, urls, qs, 0));      // já é a maior
        assertEquals(-1, LiveQuality.bestIndex(a720, new String[]{ a720, OUTRA }, new String[]{ "720p", "1080p" }, 0));   // outro motor: não
        assertEquals(-1, LiveQuality.bestIndex("https://x.y/master.m3u8", urls, qs, 0));   // não é /abyss/: não mexe
        assertEquals(2, LiveQuality.bestIndex(a720, urls, null, 0));      // sem rótulos: lê a altura da URL
    }

    // Aparelho sem decodificador pro vídeo (26/09/2026, box sem AV1: a 1080p da ABYS tocava só o som). O teto é a
    // menor altura que não abriu NESTE aparelho pra esse filme/série; 0 = sem teto.
    @Test
    public void comTeto_abreNaMaiorAbaixoDele() {
        String a720 = "http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/720p.mp4";
        String[] urls = { a720, A360, A1080 };
        String[] qs = { "720p", "360p", "1080p" };
        assertEquals(-1, LiveQuality.bestIndex(a720, urls, qs, 1080));    // a 1080p não abre aqui: fica na 720p
        assertEquals(0, LiveQuality.bestIndex(A1080, urls, qs, 1080));    // pediu a 1080p: desce pra 720p
        assertEquals(1, LiveQuality.bestIndex(a720, urls, qs, 720));      // a 720p também não abriu: desce pra 360p
        assertEquals(-1, LiveQuality.bestIndex(A360, urls, qs, 360));     // nada abaixo: fica (o player avisa)
        assertEquals(-1, LiveQuality.bestIndex(A1080, new String[]{ A1080, OUTRA }, new String[]{ "1080p", "1080p" }, 1080));   // outro motor não serve
    }

    @Test
    public void trocaSozinhoNaoPassaDoTeto() {
        assertFalse(LiveQuality.shouldSwitch("720p", "1080p", 1080));   // a 1080p não abre aqui
        assertTrue(LiveQuality.shouldSwitch("360p", "720p", 1080));
        assertTrue(LiveQuality.shouldSwitch("720p", "1080p", 0));       // sem teto: igual antes
    }

    @Test
    public void alturaDoLinkAtual() {
        String a720 = "http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/720p.mp4";
        assertEquals(1080, LiveQuality.currentHeight(A1080, new String[]{ a720, A1080 }, new String[]{ "720p", "1080p" }));
        assertEquals(720, LiveQuality.currentHeight(a720, null, null));   // fora da lista: lê a URL
        assertEquals(0, LiveQuality.currentHeight("https://x.y/master.m3u8", null, null));
    }

    @Test
    public void tetoValePraSerieInteiraEDesceSo() {
        assertEquals("1399:tv", LiveQuality.capKey("1399:tv:1:7"));     // todos os episódios da série
        assertEquals("1399:tv", LiveQuality.capKey("1399:tv:2:1"));
        assertEquals("550:movie", LiveQuality.capKey("550:movie:0:0"));
        assertNull(LiveQuality.capKey(null));
        assertNull(LiveQuality.capKey("sem-tipo"));
        assertEquals(1080, LiveQuality.mergeCap(0, 1080));
        assertEquals(720, LiveQuality.mergeCap(1080, 720));   // a menor que não abriu vale
        assertEquals(720, LiveQuality.mergeCap(720, 1080));   // não sobe
        assertEquals(1080, LiveQuality.mergeCap(1080, 0));    // altura desconhecida não mexe
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
