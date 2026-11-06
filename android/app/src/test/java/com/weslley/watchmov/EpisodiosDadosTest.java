package com.weslley.watchmov;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Regras do painel "Episódios" do player (06/11/2026). */
public class EpisodiosDadosTest {

    // O que o app manda na abertura (episodiosPlayer.ts).
    private static final String APP = "{\"tmdb\":46298,\"chave\":\"k\",\"temporadas\":["
        + "{\"n\":1,\"total\":6,\"min\":24,\"vistos\":[1,2,3],\"pct\":{\"4\":9,\"x\":5}},"
        + "{\"n\":2,\"total\":74,\"vistos\":[],\"pct\":{}},"
        + "{\"n\":3,\"total\":12}]}";

    // Pedaço da resposta da TMDB (/tv/46298/season/1).
    private static final String TMDB_T1 = "{\"episodes\":["
        + "{\"episode_number\":1,\"name\":\"Partida x e x Amigos\",\"still_path\":\"/a.jpg\",\"runtime\":24,\"air_date\":\"2011-10-02\"},"
        + "{\"episode_number\":2,\"name\":\"Teste x dos x Testes\",\"still_path\":null,\"runtime\":25},"
        + "{\"episode_number\":4,\"name\":\"Esperança x e x Ambição\",\"runtime\":null},"
        + "{\"episode_number\":5,\"name\":\"Hisoka x o x Ardiloso\",\"air_date\":\"2026-12-12\"},"
        + "{\"episode_number\":6,\"air_date\":\"2027-01-05\"},"
        + "{\"episode_number\":0,\"name\":\"especial sem número\"}]}";

    @Test public void leOQueOAppMandaNaAbertura() {
        EpisodiosDados.Serie s = EpisodiosDados.serieDoApp(APP);
        assertNotNull(s);
        assertEquals(46298, s.tmdb);
        assertEquals("k", s.chave);
        assertArrayEquals(new int[] { 1, 2, 3 }, s.numeros);
        EpisodiosDados.Temporada t1 = s.temporadas.get(1);
        assertEquals(6, t1.total);
        assertEquals(24, t1.minutos);
        assertTrue(t1.vistos.contains(3));
        assertEquals(Integer.valueOf(9), t1.pct.get(4));
        assertEquals(1, t1.pct.size());              // chave que não é número fica de fora
        assertEquals(0, s.temporadas.get(3).vistos.size());
        assertEquals("https://api.themoviedb.org/3/tv/46298/season/2?api_key=k&language=pt-BR",
            EpisodiosDados.urlDaTemporada(s, 2));
    }

    @Test public void semSerieOuJsonRuimNaoTemBotao() {
        assertNull(EpisodiosDados.serieDoApp(null));
        assertNull(EpisodiosDados.serieDoApp(""));
        assertNull(EpisodiosDados.serieDoApp("{quebrado"));
        assertNull(EpisodiosDados.serieDoApp("{\"tmdb\":1,\"temporadas\":[]}"));
        assertNull(EpisodiosDados.serieDoApp("{\"temporadas\":[{\"n\":1,\"total\":3}]}"));   // sem a série
        assertNull(EpisodiosDados.serieDoApp("{\"tmdb\":1,\"temporadas\":[{\"n\":0}]}"));
    }

    @Test public void montaATemporadaComATmdbEOsAssistidosDoApp() {
        EpisodiosDados d = EpisodiosDados.montar(EpisodiosDados.serieDoApp(APP), 1, TMDB_T1, "2026-11-06");
        assertEquals(1, d.temporada);
        assertArrayEquals(new int[] { 1, 2, 3 }, d.temporadas);
        assertEquals(6, d.eps.size());
        EpisodiosDados.Ep e1 = d.eps.get(0);
        assertEquals("Partida x e x Amigos", e1.nome);
        assertEquals("https://image.tmdb.org/t/p/w300/a.jpg", e1.imagem);
        assertEquals(24, e1.minutos);
        assertTrue(e1.visto);
        assertNull(e1.emBreve);                       // já foi ao ar
        assertNull(d.eps.get(1).imagem);              // still_path null
        assertEquals(25, d.eps.get(1).minutos);       // a duração do próprio episódio
        assertNull(d.eps.get(2).nome);                // E3 não veio da TMDB: só número e o ✓
        assertTrue(d.eps.get(2).visto);
        assertEquals(24, d.eps.get(3).minutos);       // sem runtime: a média da temporada
        assertEquals(9, d.eps.get(3).pct);
        assertFalse(d.eps.get(3).visto);
        assertEquals("Em breve 12/12", d.eps.get(4).emBreve);
        assertEquals("Em breve 05/01/27", d.eps.get(5).emBreve);
    }

    @Test public void semRedeAindaMostraNumerosEAssistidos() {
        EpisodiosDados d = EpisodiosDados.montar(EpisodiosDados.serieDoApp(APP), 1, null, "2026-11-06");
        assertEquals(6, d.eps.size());
        assertNull(d.eps.get(0).nome);
        assertTrue(d.eps.get(0).visto);
        assertEquals(24, d.eps.get(5).minutos);
        EpisodiosDados ruim = EpisodiosDados.montar(EpisodiosDados.serieDoApp(APP), 3, "{nada", "2026-11-06");
        assertEquals(12, ruim.eps.size());
        EpisodiosDados semInfo = EpisodiosDados.montar(EpisodiosDados.serieDoApp(APP), 9, TMDB_T1, "2026-11-06");
        assertEquals(6, semInfo.eps.size());           // temporada que o app não mandou: o que vier da TMDB
        assertFalse(semInfo.eps.get(0).visto);
    }

    @Test public void focoAbreNoEpisodioQueEstaTocando() {
        EpisodiosDados d = EpisodiosDados.montar(EpisodiosDados.serieDoApp(APP), 1, TMDB_T1, "2026-11-06");
        assertEquals(3, d.indiceInicial(1, 4));             // T1 E4 tocando → card do E4
        assertEquals(0, EpisodiosDados.primeiroVisivel(3)); // e os 3 assistidos antes dele à vista
        assertEquals(4, EpisodiosDados.primeiroVisivel(7));
        assertEquals(3, d.indiceInicial(2, 1));             // tocando a T2: na T1 o foco vai pro 1º não visto (E4)
        assertEquals(-1, d.indiceDo(40));
    }

    @Test public void linhaDeBaixoDoCard() {
        EpisodiosDados d = EpisodiosDados.montar(EpisodiosDados.serieDoApp(APP), 1, TMDB_T1, "2026-11-06");
        assertEquals("✓ Assistido", EpisodiosDados.info(d.eps.get(0), false, 0));
        assertEquals("Parou em 02:05", EpisodiosDados.info(d.eps.get(3), true, 125_000));
        assertEquals("✓ Assistido", EpisodiosDados.info(d.eps.get(0), true, 125_000));   // atual já visto
        assertEquals("Em breve 12/12", EpisodiosDados.info(d.eps.get(4), false, 0));
        assertEquals("E2 · 25 min", EpisodiosDados.info(new EpisodiosDados.Ep(2, null, null, 25, false, 0, null), false, 0));
        assertEquals("Episódio 3", EpisodiosDados.info(new EpisodiosDados.Ep(3, null, null, 0, false, 0, null), false, 0));
        assertEquals("1:02:03", EpisodiosDados.relogio(3_723_000));
        assertEquals("00:00", EpisodiosDados.relogio(-5));
        assertNull(EpisodiosDados.emBreve("2026-11-06", "2026-11-06"));   // estreia hoje: já dá pra ver
        assertNull(EpisodiosDados.emBreve("12/12/2026", "2026-11-06"));
    }

    @Test public void chaveDoEpisodioETituloDaSerie() {
        assertArrayEquals(new int[] { 1, 4 }, EpisodiosDados.temporadaEpisodio("46298:tv:1:4"));
        assertArrayEquals(new int[] { 12, 130 }, EpisodiosDados.temporadaEpisodio("37854:tv:12:130"));
        assertNull(EpisodiosDados.temporadaEpisodio("1368337:movie:0:0"));   // filme: sem botão
        assertNull(EpisodiosDados.temporadaEpisodio("46298:tv:0:0"));
        assertNull(EpisodiosDados.temporadaEpisodio("46298:tv:x:1"));
        assertNull(EpisodiosDados.temporadaEpisodio(null));
        assertEquals("Hunter x Hunter", EpisodiosDados.serieDoTitulo("Hunter x Hunter — T1 E4"));
        assertEquals("Dois Homens e Meio", EpisodiosDados.serieDoTitulo("Dois Homens e Meio — T5 E15"));
        assertEquals("X-Men '97", EpisodiosDados.serieDoTitulo("X-Men '97 - T1 E2"));
        assertEquals("A Odisseia", EpisodiosDados.serieDoTitulo("A Odisseia"));
        assertEquals("", EpisodiosDados.serieDoTitulo(null));
    }
}
