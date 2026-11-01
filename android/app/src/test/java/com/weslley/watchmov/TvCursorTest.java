package com.weslley.watchmov;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;

import org.junit.Test;

/** Setinha do ▣ Servidor na TV (26/09/2026): passo que acelera segurando e o que acontece ao subir. */
public class TvCursorTest {
    @Test
    public void passoComecaDevagarEAceleraAteOTeto() {
        assertEquals(12f, TvCursor.passoDp(0), 0.001f);
        assertEquals(15f, TvCursor.passoDp(1), 0.001f);
        assertEquals(48f, TvCursor.passoDp(12), 0.001f);
        assertEquals(48f, TvCursor.passoDp(100), 0.001f);
    }

    @Test
    public void subindoAbaixoDaLinhaSoAnda() {
        assertEquals(TvCursor.SOBE, TvCursor.aoSubir(300f, 200f, 0));
        assertEquals(TvCursor.SOBE, TvCursor.aoSubir(200f, 200f, 3));
    }

    @Test
    public void passouDaLinhaSaiSeAPaginaNaoFoiRolada() {
        assertEquals(TvCursor.SAI, TvCursor.aoSubir(199f, 200f, 0));
    }

    @Test
    public void passouDaLinhaComPaginaRoladaDesrolaAntesDeSair() {
        assertEquals(TvCursor.ROLA_CIMA, TvCursor.aoSubir(199f, 200f, 2));
    }

    @Test
    public void areaFicaDentroDaMargemSeguraDaTv() {
        // 1920×1080, densidade 2: 2,5% de margem (48 / 27 px) e mais 12 dp (24 px) embaixo pra ponta aparecer.
        assertArrayEquals(new float[]{48f, 27f, 1871f, 1029f}, TvCursor.area(1920f, 1080f, 2f), 0.001f);
    }

    @Test
    public void someDepoisDe10sEOToqueSoTrazDeVolta() {
        assertEquals(10_000L, TvCursor.SOME_MS);
        assertEquals(TvCursor.MOSTRA, TvCursor.aoApertar(true, true, 0));    // OK não clica no escuro
        assertEquals(TvCursor.MOSTRA, TvCursor.aoApertar(true, false, 0));   // seta não anda
    }

    @Test
    public void visivelOkClicaUmaVezESetaAnda() {
        assertEquals(TvCursor.TOCA, TvCursor.aoApertar(false, true, 0));
        assertEquals(TvCursor.NADA, TvCursor.aoApertar(false, true, 3));
        assertEquals(TvCursor.ANDA, TvCursor.aoApertar(false, false, 5));
    }

    // Segurar o OK no cartaz (01/11/2026): o web só vê o apertar e o soltar; as repetições do OK ficam no nativo.
    @Test
    public void okSeguroSoPassaOApertarEOSoltar() {
        int[] oks = {KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A};
        for (int k : oks) {
            assertTrue(TvCursor.ehOk(k));
            assertFalse(TvCursor.repeticaoDoOk(k, KeyEvent.ACTION_DOWN, 0));   // o apertar passa
            assertTrue(TvCursor.repeticaoDoOk(k, KeyEvent.ACTION_DOWN, 1));    // a 1ª repetição (aos ~500 ms) fica
            assertTrue(TvCursor.repeticaoDoOk(k, KeyEvent.ACTION_DOWN, 25));
            assertFalse(TvCursor.repeticaoDoOk(k, KeyEvent.ACTION_UP, 0));     // o soltar passa
        }
    }

    @Test
    public void setasEVoltarSeguramNormal() {
        // Segurar ↓ rola a fileira (o controle repete a seta) e o Voltar segue com o Android: não são o OK.
        int[] outras = {KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE};
        for (int k : outras) {
            assertFalse(TvCursor.ehOk(k));
            assertFalse(TvCursor.repeticaoDoOk(k, KeyEvent.ACTION_DOWN, 3));
        }
    }
}
