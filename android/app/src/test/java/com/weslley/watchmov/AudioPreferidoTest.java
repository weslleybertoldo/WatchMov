package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** Estudo do Nuvio, item 13 (20/10/2026): o idioma da faixa escolhida no ⚙ Áudio fica lembrado pros próximos vídeos. */
public class AudioPreferidoTest {
    @Test
    public void lembraOIdiomaDaFaixaEscolhida() {
        assertEquals("pt", PlayerActivity.idiomaParaLembrar("pt"));
        assertEquals("en", PlayerActivity.idiomaParaLembrar("en"));
        assertEquals("pt-br", PlayerActivity.idiomaParaLembrar(" PT-BR "));
    }

    @Test
    public void faixaSemIdiomaNaoViraPreferencia() {
        assertNull(PlayerActivity.idiomaParaLembrar(null));
        assertNull(PlayerActivity.idiomaParaLembrar(""));
        assertNull(PlayerActivity.idiomaParaLembrar("und"));
    }
}
