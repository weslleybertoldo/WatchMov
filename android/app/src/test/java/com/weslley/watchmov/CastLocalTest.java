package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** 25/09/2026: com a TV tocando ABYS, o player do celular não pode abrir leitor na mesma sessão. */
public class CastLocalTest {
    @Test public void abysEhFonteDeUmLeitor() {
        assertTrue(CastLocal.umLeitor("http://127.0.0.1:8099/abyss/29v627c6muhlfem9/1080p.mp4"));
        assertTrue(CastLocal.umLeitor("http://127.0.0.1:8099/abyss/rgrpr4ckmugeill5/360p.mp4"));
    }

    @Test public void hlsMp4ENuloNaoSaoDeUmLeitor() {
        assertFalse(CastLocal.umLeitor("https://vid7102402.hclod.qzz.io/st/_s3_/v14/1032863/playlist.m3u8?md5=x&expires=1"));
        assertFalse(CastLocal.umLeitor("https://cdn.exemplo/v.mp4"));
        assertFalse(CastLocal.umLeitor(null));
    }

    @Test public void dlnaUsaLocalDepoisGuardadaDepoisTv() {
        assertEquals(6_724_000, CastLocal.duracao(true, 6_724_000, 1_000, 999, 0));   // local manda
        assertEquals(6_724_000, CastLocal.duracao(true, 0, 6_724_000, 999, 0));       // local parado → a que ele sabia
        assertEquals(999_000, CastLocal.duracao(true, 0, 0, 999_000, 0));              // ninguém sabe → TV
    }

    @Test public void chromecastConfiaNaTv() {
        assertEquals(5_000_000, CastLocal.duracao(false, 6_724_000, 6_724_000, 5_000_000, 0));
        assertEquals(6_724_000, CastLocal.duracao(false, 0, 6_724_000, 0, 0));
    }

    @Test public void nuncaMenorQueAPosicao() {
        assertEquals(7_000_000, CastLocal.duracao(true, 0, 0, 999_000, 7_000_000));
    }

    // 25/09/2026: player fechado, TV tocando até 19 min, caiu → o título reabriu em 14 (a posição do fechar).
    @Test public void gravaPosicaoDaTvQuandoAndou5s() {
        assertTrue(CastLocal.gravarPosicaoTv(1_140_000, 0));          // 1ª leitura
        assertTrue(CastLocal.gravarPosicaoTv(1_145_000, 1_140_000));  // andou 5 s
        assertTrue(CastLocal.gravarPosicaoTv(600_000, 1_140_000));    // voltou (seek pra trás)
    }

    @Test public void naoGravaInicioNemPassoPequeno() {
        assertFalse(CastLocal.gravarPosicaoTv(2_000, 0));             // < 3 s: igual ao saveResume do player
        assertFalse(CastLocal.gravarPosicaoTv(1_143_000, 1_140_000)); // só 3 s depois da última
        assertFalse(CastLocal.gravarPosicaoTv(0, 1_140_000));         // TV sem posição
    }
}
