package com.weslley.watchmov;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PlayerServidoresTest {

    @Test public void abrirServidoresPrimeiroEDepoisOsDoTituloComOAtualMarcado() {
        PlayerServidores p = PlayerServidores.de(new String[]{
            "embedplayapi|1 · EmbedPlay", "superflix|2 · SuperFlix", "embedmovies|6 · EmbedMovies" }, "embedmovies");
        assertArrayEquals(new String[]{ null, "embedplayapi", "superflix", "embedmovies" }, p.ids);
        assertArrayEquals(new String[]{ "Abrir servidores", "1 · EmbedPlay", "2 · SuperFlix", "✓ 6 · EmbedMovies" }, p.nomes);
        assertFalse(p.soAbrirServidores());
    }

    @Test public void semListaOBotaoAbreAAbaComoAntes() {
        assertTrue(PlayerServidores.de(null, "embedmovies").soAbrirServidores());
        assertTrue(PlayerServidores.de(new String[0], null).soAbrirServidores());
    }

    @Test public void entradaTortaERepetidaFicamDeFora() {
        PlayerServidores p = PlayerServidores.de(new String[]{
            "semrotulo", "|sem id", "vazio|", null, "fshd|5 · FS/HD", "fshd|5 · FS/HD" }, "x");
        assertArrayEquals(new String[]{ null, "fshd" }, p.ids);
        assertArrayEquals(new String[]{ "Abrir servidores", "5 · FS/HD" }, p.nomes);
    }
}
