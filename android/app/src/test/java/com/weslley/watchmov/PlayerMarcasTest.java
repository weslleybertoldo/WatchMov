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
}
