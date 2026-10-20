package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;

import androidx.media3.common.C;

import org.junit.Test;

/** Fonte 4 (Pomfy, 19/10/2026): episódio com áudio e legenda Português marcados como padrão ligava os dois juntos. */
public class LegendaPadraoTest {
    @Test
    public void audioEmPortuguesIgnoraALegendaPadrao() {
        assertEquals(C.SELECTION_FLAG_DEFAULT, PlayerActivity.flagsIgnoradasDaLegenda("pt"));
        assertEquals(C.SELECTION_FLAG_DEFAULT, PlayerActivity.flagsIgnoradasDaLegenda("pt-BR"));
        assertEquals(C.SELECTION_FLAG_DEFAULT, PlayerActivity.flagsIgnoradasDaLegenda("PT"));
    }

    @Test
    public void audioEmOutraLinguaOuSemLinguaDeixaComoSempreFoi() {
        assertEquals(0, PlayerActivity.flagsIgnoradasDaLegenda("en"));
        assertEquals(0, PlayerActivity.flagsIgnoradasDaLegenda("und"));
        assertEquals(0, PlayerActivity.flagsIgnoradasDaLegenda(null));
    }
}
