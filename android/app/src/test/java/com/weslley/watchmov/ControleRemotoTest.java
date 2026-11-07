package com.weslley.watchmov;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;
import android.view.View;

import org.json.JSONObject;
import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

/** Controle remoto pelo celular (07/11/2026): o que cada tecla faz no player, o episódio anterior e o estado. */
public class ControleRemotoTest {

    @Test public void cadaTeclaDoCelularViraUmaAcao() {
        for (String t : new String[] { "up", "down", "left", "right", "ok", "back" })
            assertEquals(t, ControleRemoto.TECLA, ControleRemoto.acao(t));
        assertEquals(ControleRemoto.VOLTAR_10S, ControleRemoto.acao("rew"));
        assertEquals(ControleRemoto.AVANCAR_10S, ControleRemoto.acao("ff"));
        assertEquals(ControleRemoto.PLAY_PAUSE, ControleRemoto.acao("playpause"));
        assertEquals(ControleRemoto.EP_ANTERIOR, ControleRemoto.acao("prev-ep"));
        assertEquals(ControleRemoto.EP_SEGUINTE, ControleRemoto.acao("next-ep"));
        assertEquals(ControleRemoto.ASSISTIDO, ControleRemoto.acao("watched"));
        // O web troca o "ok-hold" por "ok" antes de mandar; o "home" ele mesmo resolve (fecha o player).
        for (String t : new String[] { "home", "ok-hold", "UP", "", " ok" })
            assertEquals(t, ControleRemoto.NADA, ControleRemoto.acao(t));
        assertEquals(ControleRemoto.NADA, ControleRemoto.acao(null));
    }

    @Test public void setasOkEVoltarViramAsTeclasDoControleDaTv() {
        assertEquals(KeyEvent.KEYCODE_DPAD_UP, ControleRemoto.codigo("up"));
        assertEquals(KeyEvent.KEYCODE_DPAD_DOWN, ControleRemoto.codigo("down"));
        assertEquals(KeyEvent.KEYCODE_DPAD_LEFT, ControleRemoto.codigo("left"));
        assertEquals(KeyEvent.KEYCODE_DPAD_RIGHT, ControleRemoto.codigo("right"));
        assertEquals(KeyEvent.KEYCODE_DPAD_CENTER, ControleRemoto.codigo("ok"));   // o OK do D-pad (teclaTv trata)
        assertEquals(KeyEvent.KEYCODE_BACK, ControleRemoto.codigo("back"));
        for (String t : new String[] { "rew", "ff", "playpause", "prev-ep", "next-ep", "watched", "home", "x" })
            assertEquals(t, 0, ControleRemoto.codigo(t));   // ações diretas: não viram tecla
        assertEquals(0, ControleRemoto.codigo(null));
        // Toda tecla que vira KeyEvent tem ação TECLA (e vice-versa): nada cai no meio do caminho.
        for (String t : new String[] { "up", "down", "left", "right", "ok", "back", "rew", "ff", "playpause", "watched" })
            assertEquals(t, ControleRemoto.acao(t) == ControleRemoto.TECLA, ControleRemoto.codigo(t) != 0);
    }

    @Test public void soAsSetasAndamComOFoco() {
        assertEquals(View.FOCUS_UP, ControleRemoto.direcaoDoFoco(KeyEvent.KEYCODE_DPAD_UP));
        assertEquals(View.FOCUS_DOWN, ControleRemoto.direcaoDoFoco(KeyEvent.KEYCODE_DPAD_DOWN));
        assertEquals(View.FOCUS_LEFT, ControleRemoto.direcaoDoFoco(KeyEvent.KEYCODE_DPAD_LEFT));
        assertEquals(View.FOCUS_RIGHT, ControleRemoto.direcaoDoFoco(KeyEvent.KEYCODE_DPAD_RIGHT));
        assertEquals(0, ControleRemoto.direcaoDoFoco(KeyEvent.KEYCODE_DPAD_CENTER));
        assertEquals(0, ControleRemoto.direcaoDoFoco(KeyEvent.KEYCODE_BACK));
        assertEquals(0, ControleRemoto.direcaoDoFoco(0));
    }

    // O aperto que vem do celular é UM toque curto: repetição 0 no apertar e no soltar. Segurar (repetição > 0) é o
    // que o player e a página tratam como "segurado" (TvCursor.repeticaoDoOk engole; teclaTv só age na `primeira`).
    @Test public void apertoDoCelularEUmToqueCurtoNuncaSegurar() {
        assertEquals(0, ControleRemoto.REPETICAO);
        for (String t : new String[] { "up", "down", "left", "right", "ok", "back" }) {
            int k = ControleRemoto.codigo(t);
            assertFalse(t, TvCursor.repeticaoDoOk(k, KeyEvent.ACTION_DOWN, ControleRemoto.REPETICAO));
            assertFalse(t, TvCursor.repeticaoDoOk(k, KeyEvent.ACTION_UP, ControleRemoto.REPETICAO));
        }
        assertTrue(TvCursor.repeticaoDoOk(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.ACTION_DOWN, 1));   // segurado de verdade
        assertEquals(10_000L, ControleRemoto.PULO_MS);   // o mesmo ±10 s do ←/→ da TV
    }

    @Test public void episodioAnteriorNaMesmaTemporada() {
        assertArrayEquals(new int[] { 2, 4 }, ControleRemoto.episodioAnterior(2, 5, new int[] { 1, 2 }, t -> 10));
        assertArrayEquals(new int[] { 1, 1 }, ControleRemoto.episodioAnterior(1, 2, null, null));   // nem precisa dos dados
        assertArrayEquals(new int[] { 3, 129 }, ControleRemoto.episodioAnterior(3, 130, new int[0], t -> 0));
    }

    @Test public void noE1VaiProUltimoDaTemporadaAnterior() {
        Map<Integer, Integer> totais = new HashMap<>();
        totais.put(1, 6); totais.put(2, 74); totais.put(3, 12); totais.put(5, 8);
        assertArrayEquals(new int[] { 2, 74 },
            ControleRemoto.episodioAnterior(3, 1, new int[] { 1, 2, 3 }, t -> totais.getOrDefault(t, 0)));
        // Temporadas puladas (T4 não existe) e fora de ordem: a maior abaixo da atual.
        assertArrayEquals(new int[] { 3, 12 },
            ControleRemoto.episodioAnterior(5, 1, new int[] { 5, 3, 1 }, t -> totais.getOrDefault(t, 0)));
        // Com o JSON que o app manda na abertura do player (episodiosPlayer.ts → EpisodiosDados.serieDoApp).
        EpisodiosDados.Serie s = EpisodiosDados.serieDoApp("{\"tmdb\":46298,\"chave\":\"k\",\"temporadas\":["
            + "{\"n\":1,\"total\":6,\"vistos\":[1,2]},{\"n\":2,\"total\":74},{\"n\":3,\"total\":0}]}");
        assertArrayEquals(new int[] { 1, 6 }, ControleRemoto.episodioAnterior(2, 1, s.numeros, t -> s.temporadas.get(t).total));
    }

    @Test public void semAnteriorNaoAtende() {
        assertNull(ControleRemoto.episodioAnterior(1, 1, new int[] { 1, 2 }, t -> 10));     // 1º episódio da série
        assertNull(ControleRemoto.episodioAnterior(3, 1, new int[] { 1, 2, 3 }, t -> 0));   // T2 sem total: não sabe o último
        assertNull(ControleRemoto.episodioAnterior(2, 1, null, t -> 10));                  // série sem os dados do app
        assertNull(ControleRemoto.episodioAnterior(2, 1, new int[] { 1, 2 }, null));
        assertNull(ControleRemoto.episodioAnterior(2, 1, new int[] { 2, 3 }, t -> 10));     // nenhuma temporada antes
        assertNull(ControleRemoto.episodioAnterior(0, 3, new int[] { 1 }, t -> 10));        // chave estranha
        assertNull(ControleRemoto.episodioAnterior(1, 0, new int[] { 1 }, t -> 10));
    }

    @Test public void estadoDoPlayerAbertoParaOCelular() throws Exception {
        JSONObject serie = ControleRemoto.estado(new JSONObject(), true, "Hunter x Hunter — T1 E4", "46298:tv:1:4",
            125_000, 1_440_000, true);
        assertTrue(serie.getBoolean("open"));
        assertEquals("Hunter x Hunter — T1 E4", serie.getString("title"));   // o título que o player mostra
        assertEquals(1, serie.getInt("season"));
        assertEquals(4, serie.getInt("episode"));
        assertEquals(125_000L, serie.getLong("positionMs"));
        assertEquals(1_440_000L, serie.getLong("durationMs"));
        assertTrue(serie.getBoolean("playing"));

        JSONObject filme = ControleRemoto.estado(new JSONObject(), true, "A Odisseia", "1368337:movie:0:0", -5, 0, false);
        assertFalse(filme.has("season"));                                      // temporada/episódio só em série
        assertFalse(filme.has("episode"));
        assertEquals(0L, filme.getLong("positionMs"));                          // nunca negativo
        assertFalse(filme.getBoolean("playing"));

        assertFalse(ControleRemoto.estado(new JSONObject(), true, "  ", null, 0, 0, false).has("title"));
        JSONObject fechado = ControleRemoto.estado(new JSONObject(), false, "A Odisseia", "1:movie:0:0", 9, 9, true);
        assertFalse(fechado.getBoolean("open"));
        assertEquals(1, fechado.length());                                     // sem player: só { open: false }
    }
}
