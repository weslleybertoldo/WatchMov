package com.weslley.watchmov;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PlayerMarcasTest {

    // Resposta real da TheIntroDB (Re:Zero T1E2, 17/10/2026).
    private static final String REZERO_T1E2 = "{\"tmdb_id\":65942,\"type\":\"tv\",\"season\":1,\"episode\":2,"
        + "\"intro\":[{\"start_ms\":65993,\"end_ms\":156099}],\"credits\":[{\"start_ms\":1375000,\"end_ms\":1465000}]}";
    // Breaking Bad T1E1: créditos sem fim (até o fim do vídeo).
    private static final String BB_T1E1 = "{\"intro\":[{\"start_ms\":228664,\"end_ms\":246143}],"
        + "\"credits\":[{\"start_ms\":3431000,\"end_ms\":null}]}";

    @Test public void lePulosECreditosDaResposta() {
        PlayerMarcas m = PlayerMarcas.deJson(REZERO_T1E2);
        assertEquals(PlayerMarcas.NENHUM, m.tipoDoPulo(65_000));
        assertEquals(PlayerMarcas.ABERTURA, m.tipoDoPulo(66_000));
        assertEquals(156_099, m.fimDoPulo(100_000));
        // 1 s antes do fim o botão já some.
        assertEquals(PlayerMarcas.NENHUM, m.tipoDoPulo(155_500));
        assertEquals(-1, m.fimDoPulo(200_000));
    }

    @Test public void episodioSemMapaEJsonTortoFicamVazios() {
        assertTrue(PlayerMarcas.deJson("{\"error\":\"media not found\"}").vazio());
        assertTrue(PlayerMarcas.deJson("não é json").vazio());
        assertTrue(PlayerMarcas.deJson(null).vazio());
        assertTrue(PlayerMarcas.deJson("{\"intro\":[{\"start_ms\":5000,\"end_ms\":4000}]}").vazio());
    }

    @Test public void resumoTambemPula() {
        PlayerMarcas m = PlayerMarcas.deJson("{\"recap\":[{\"start_ms\":null,\"end_ms\":45000}]}");
        assertEquals(PlayerMarcas.RESUMO, m.tipoDoPulo(0));
        assertEquals(45_000, m.fimDoPulo(10_000));
    }

    @Test public void contagemComecaNosCreditosMapeados() {
        // Re:Zero T1E2 tem ~24:25 (1.465.000 ms): os créditos começam em 22:55.
        assertEquals(1_375_000, PlayerMarcas.deJson(REZERO_T1E2).inicioDaContagem(1_465_000));
        // Créditos até o fim (end_ms nulo) também valem.
        assertEquals(3_431_000, PlayerMarcas.deJson(BB_T1E1).inicioDaContagem(3_480_000));
    }

    @Test public void semMapaOuCreditosForaDoVideoContagemFaltando40s() {
        assertEquals(1_465_000 - 40_000, PlayerMarcas.VAZIO.inicioDaContagem(1_465_000));
        // Créditos depois do fim do vídeo (versão mais curta na fonte) → regra dos 40 s.
        assertEquals(600_000 - 40_000, PlayerMarcas.deJson(BB_T1E1).inicioDaContagem(600_000));
        // Créditos antes da metade = marcação errada → regra dos 40 s.
        PlayerMarcas cedo = PlayerMarcas.deJson("{\"credits\":[{\"start_ms\":100000,\"end_ms\":null}]}");
        assertEquals(1_000_000 - 40_000, cedo.inicioDaContagem(1_000_000));
        // Vídeo curto demais: sem contagem.
        assertEquals(-1, PlayerMarcas.VAZIO.inicioDaContagem(70_000));
    }

    @Test public void proximoNoFimValeOAssistirAgora() {
        // Sem mapa: a janela começa faltando 40 s.
        assertFalse(PlayerMarcas.VAZIO.naJanelaDaContagem(1_465_000 - 40_001, 1_465_000));
        assertTrue(PlayerMarcas.VAZIO.naJanelaDaContagem(1_465_000 - 40_000, 1_465_000));
        // Créditos mapeados: começa neles.
        PlayerMarcas m = PlayerMarcas.deJson(REZERO_T1E2);
        assertFalse(m.naJanelaDaContagem(1_374_999, 1_465_000));
        assertTrue(m.naJanelaDaContagem(1_375_000, 1_465_000));
        // Vídeo curto demais ou duração desconhecida: nunca.
        assertFalse(PlayerMarcas.VAZIO.naJanelaDaContagem(69_000, 70_000));
        assertFalse(PlayerMarcas.VAZIO.naJanelaDaContagem(0, Long.MIN_VALUE + 1));
    }

    @Test public void chaveDeSerie() {
        assertArrayEquals(new long[]{ 65942, 1, 2 }, PlayerMarcas.chaveDeSerie("65942:tv:1:2"));
        assertNull(PlayerMarcas.chaveDeSerie("603:movie:0:0"));
        assertNull(PlayerMarcas.chaveDeSerie("0:tv:1:2"));
        assertNull(PlayerMarcas.chaveDeSerie("abc:tv:1:2"));
        assertNull(PlayerMarcas.chaveDeSerie(null));
        assertEquals("https://api.theintrodb.org/v3/media?tmdb_id=65942&season=1&episode=2",
            PlayerMarcas.urlDaApi(new long[]{ 65942, 1, 2 }));
    }

    @Test public void voltarEscondeOsBotoesSoNaTv() {
        assertEquals(PlayerMarcas.VOLTAR_ESCONDE_CONTROLES, PlayerMarcas.acaoDoVoltar(false, false, true, true, false));
        assertEquals(PlayerMarcas.VOLTAR_SAI, PlayerMarcas.acaoDoVoltar(false, false, false, true, false));
        assertEquals(PlayerMarcas.VOLTAR_SAI, PlayerMarcas.acaoDoVoltar(false, false, true, false, false));
        assertEquals(PlayerMarcas.VOLTAR_SAI, PlayerMarcas.acaoDoVoltar(false, false, true, true, true));
        assertEquals(PlayerMarcas.VOLTAR_FECHA_PAINEL, PlayerMarcas.acaoDoVoltar(true, true, true, true, false));
        assertEquals(PlayerMarcas.VOLTAR_CANCELA_CONTAGEM, PlayerMarcas.acaoDoVoltar(false, true, true, false, false));
    }

    @Test public void contagemDe10sSoDescontaTocandoEPula() {
        PlayerMarcas.Contagem c = new PlayerMarcas.Contagem();
        long ini = 1_000_000;
        assertEquals(PlayerMarcas.CONTAGEM_NADA, c.tique(ini - 500, ini, true, false, 0));
        assertEquals(PlayerMarcas.CONTAGEM_MOSTRAR, c.tique(ini, ini, true, false, 1_000));
        assertEquals(10, c.segundos());
        assertEquals(PlayerMarcas.CONTAGEM_ATUALIZAR, c.tique(ini + 4_000, ini, true, false, 5_000));
        assertEquals(6, c.segundos());
        // Pausado: não desconta.
        assertEquals(PlayerMarcas.CONTAGEM_ATUALIZAR, c.tique(ini + 4_000, ini, false, false, 60_000));
        assertEquals(6, c.segundos());
        assertEquals(PlayerMarcas.CONTAGEM_ATUALIZAR, c.tique(ini + 9_000, ini, true, false, 65_000));
        assertEquals(PlayerMarcas.CONTAGEM_PULAR, c.tique(ini + 10_000, ini, true, false, 66_000));
        // Já pulou: não repete.
        assertEquals(PlayerMarcas.CONTAGEM_NADA, c.tique(ini + 11_000, ini, true, false, 67_000));
    }

    @Test public void cancelarSeguraEVoltarAntesRearma() {
        PlayerMarcas.Contagem c = new PlayerMarcas.Contagem();
        long ini = 500_000;
        c.tique(ini, ini, true, false, 0);
        c.cancelar();
        assertEquals(PlayerMarcas.CONTAGEM_NADA, c.tique(ini + 20_000, ini, true, false, 20_000));
        // Voltou pra antes dos créditos: rearma e mostra de novo quando chegar.
        assertEquals(PlayerMarcas.CONTAGEM_NADA, c.tique(ini - 60_000, ini, true, false, 21_000));
        assertEquals(PlayerMarcas.CONTAGEM_MOSTRAR, c.tique(ini, ini, true, false, 80_000));
        // Voltou com a contagem na tela: esconde.
        assertEquals(PlayerMarcas.CONTAGEM_ESCONDER, c.tique(ini - 10_000, ini, true, false, 81_000));
    }

    @Test public void videoAcabouComContagemPulaNaHora() {
        PlayerMarcas.Contagem c = new PlayerMarcas.Contagem();
        long ini = 500_000;
        assertEquals(PlayerMarcas.CONTAGEM_PULAR, c.tique(ini + 39_900, ini, false, true, 0));
        PlayerMarcas.Contagem d = new PlayerMarcas.Contagem();
        d.tique(ini, ini, true, false, 0);
        assertEquals(PlayerMarcas.CONTAGEM_PULAR, d.tique(ini + 3_000, ini, false, true, 3_000));
    }

    // ── 18/10/2026: IntroDB completando a TheIntroDB, ⏭ e "Assistido" ─────────────────────────────────────────
    // Resposta real da IntroDB (Lanternas T1E5, 18/10/2026): a TheIntroDB não tinha este episódio (404).
    private static final String LANTERNAS_T1E5_INTRODB = "{\"imdb_id\":\"tt26545992\",\"media_type\":\"tv\","
        + "\"is_movie\":false,\"season\":1,\"episode\":5,"
        + "\"intro\":{\"start_sec\":389,\"end_sec\":398,\"start_ms\":389000,\"end_ms\":398000,\"confidence\":0.5,"
        + "\"submission_count\":1,\"updated_at\":\"2026-10-12T00:00:00Z\"},\"recap\":null,"
        + "\"outro\":{\"start_sec\":3069,\"end_sec\":3189,\"start_ms\":3069000,\"end_ms\":3189000,\"confidence\":0.5,"
        + "\"submission_count\":1,\"updated_at\":\"2026-10-12T00:00:00Z\"},\"post_credits\":null,"
        + "\"no_intro\":false,\"no_recap\":false,\"no_outro\":false}";

    @Test public void introDbViraMarcasComOutroNosCreditos() {
        PlayerMarcas m = PlayerMarcas.deIntroDb(LANTERNAS_T1E5_INTRODB);
        assertArrayEquals(new long[]{ 389_000, 398_000 }, m.abertura[0]);
        assertEquals(0, m.resumo.length);
        assertArrayEquals(new long[]{ 3_069_000, 3_189_000 }, m.creditos[0]);
        // Vídeo de 53:09: o popup abre no começo dos créditos (51:09), não faltando 40 s.
        assertEquals(3_069_000, m.inicioDaContagem(3_189_000));
    }

    @Test public void introDbSemMapaOuTortaFicaVazia() {
        assertTrue(PlayerMarcas.deIntroDb("{\"error\":\"not found\"}").vazio());
        assertTrue(PlayerMarcas.deIntroDb("{\"intro\":null,\"recap\":null,\"outro\":null}").vazio());
        assertTrue(PlayerMarcas.deIntroDb("<html>").vazio());
        assertTrue(PlayerMarcas.deIntroDb(null).vazio());
    }

    @Test public void juntarUsaATheIntroDbECompletaComAIntroDb() {
        PlayerMarcas tidb = PlayerMarcas.deJson(BB_T1E1);   // abertura + créditos
        PlayerMarcas idb = PlayerMarcas.deIntroDb(LANTERNAS_T1E5_INTRODB);
        PlayerMarcas j = PlayerMarcas.juntar(tidb, idb);
        assertArrayEquals(tidb.abertura[0], j.abertura[0]);
        assertArrayEquals(tidb.creditos[0], j.creditos[0]);
        // A que só a IntroDB tem (Lanternas T1E5: TheIntroDB 404) vem inteira dela.
        PlayerMarcas k = PlayerMarcas.juntar(PlayerMarcas.VAZIO, idb);
        assertArrayEquals(new long[]{ 3_069_000, 3_189_000 }, k.creditos[0]);
        assertTrue(PlayerMarcas.juntar(PlayerMarcas.VAZIO, PlayerMarcas.VAZIO).vazio());
        // Trecho a trecho: a TheIntroDB só com abertura ganha os créditos da IntroDB.
        PlayerMarcas soAbertura = PlayerMarcas.deJson("{\"intro\":[{\"start_ms\":1000,\"end_ms\":9000}]}");
        PlayerMarcas l = PlayerMarcas.juntar(soAbertura, idb);
        assertArrayEquals(new long[]{ 1_000, 9_000 }, l.abertura[0]);
        assertArrayEquals(new long[]{ 3_069_000, 3_189_000 }, l.creditos[0]);
    }

    @Test public void urlDaIntroDbSoComImdbValido() {
        long[] serie = PlayerMarcas.chaveDeSerie("95350:tv:1:5");
        assertEquals("https://api.introdb.app/segments?imdb_id=tt26545992&season=1&episode=5",
            PlayerMarcas.urlDaIntroDb("tt26545992", serie));
        assertNull(PlayerMarcas.urlDaIntroDb(null, serie));
        assertNull(PlayerMarcas.urlDaIntroDb("", serie));
        assertNull(PlayerMarcas.urlDaIntroDb("26545992", serie));
        assertNull(PlayerMarcas.urlDaIntroDb("tt265&x=1", serie));
    }

    @Test public void assistidoComProximoVaiProPontoDoPopup() {
        long dur = 3_189_000;
        // Sem mapa: faltando 40 s.
        assertEquals(dur - 40_000, PlayerMarcas.VAZIO.pontoDoAssistido(1_000_000, dur, true));
        // Com créditos: no começo deles.
        PlayerMarcas m = PlayerMarcas.deIntroDb(LANTERNAS_T1E5_INTRODB);
        assertEquals(3_069_000, m.pontoDoAssistido(1_000_000, dur, true));
        // Já passou do ponto: não volta.
        assertEquals(-1, m.pontoDoAssistido(3_100_000, dur, true));
        assertEquals(-1, PlayerMarcas.VAZIO.pontoDoAssistido(dur - 20_000, dur, true));
    }

    @Test public void assistidoSemProximoContinuaFaltando1Min() {
        long dur = 3_189_000;
        assertEquals(dur - 60_000, PlayerMarcas.VAZIO.pontoDoAssistido(1_000_000, dur, false));
        assertEquals(-1, PlayerMarcas.VAZIO.pontoDoAssistido(dur - 30_000, dur, false));
        // Vídeo curto (sem contagem) com próximo: cai no 1 min; duração desconhecida (C.TIME_UNSET) não pula.
        assertEquals(10_000, PlayerMarcas.VAZIO.pontoDoAssistido(0, 70_000, true));
        assertEquals(-1, PlayerMarcas.VAZIO.pontoDoAssistido(0, Long.MIN_VALUE + 1, true));
    }

    @Test public void rearmarReabreDepoisDeCancelarMasNaoMexeNaContagemNaTela() {
        long ini = 500_000;
        PlayerMarcas.Contagem c = new PlayerMarcas.Contagem();
        assertEquals(PlayerMarcas.CONTAGEM_MOSTRAR, c.tique(ini, ini, true, false, 0));
        c.cancelar();
        assertEquals(PlayerMarcas.CONTAGEM_NADA, c.tique(ini + 1_000, ini, true, false, 1_000));
        c.rearmar();
        assertEquals(PlayerMarcas.CONTAGEM_MOSTRAR, c.tique(ini + 1_000, ini, true, false, 2_000));
        assertEquals(10, c.segundos());
        // Na tela e contando: rearmar não volta pros 10 s.
        c.tique(ini + 5_000, ini, true, false, 6_000);
        int antes = c.segundos();
        c.rearmar();
        assertEquals(antes, c.segundos());
        // Já disparou: nada.
        c.pularAgora();
        c.rearmar();
        assertEquals(PlayerMarcas.CONTAGEM_NADA, c.tique(ini + 6_000, ini, true, false, 7_000));
    }

    @Test public void proximoFaltandoAte2MinMarcaAssistido() {
        long dur = 1_305_000;   // 21:45, Dois Homens e Meio (sem créditos mapeados)
        assertTrue(PlayerMarcas.VAZIO.proximoMarcaAssistido(dur - 61_000, dur));    // créditos, 1:01 faltando (o caso dele)
        assertTrue(PlayerMarcas.VAZIO.proximoMarcaAssistido(dur - 120_000, dur));
        assertFalse(PlayerMarcas.VAZIO.proximoMarcaAssistido(dur - 120_001, dur));
        assertFalse(PlayerMarcas.VAZIO.proximoMarcaAssistido(600_000, dur));          // no meio: só pula
        assertTrue(PlayerMarcas.VAZIO.proximoMarcaAssistido(dur - 30_000, dur));     // contagem (últimos 40 s)
        assertFalse(PlayerMarcas.VAZIO.proximoMarcaAssistido(1_000, Long.MIN_VALUE + 1));   // duração desconhecida
        assertFalse(PlayerMarcas.VAZIO.proximoMarcaAssistido(60_000, 70_000));        // vídeo de até 80 s: sem contagem nem 2 min
    }
}
