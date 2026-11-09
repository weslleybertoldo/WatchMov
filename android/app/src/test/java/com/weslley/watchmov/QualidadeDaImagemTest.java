package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** 09/11/2026: o rótulo de qualidade é a classe da imagem (1920×804 = 1080p), não a altura crua ("804p"). */
public class QualidadeDaImagemTest {

    @Test
    public void filmeDeCinemaSemAsFaixasPretasMostraAClasse() {
        assertEquals("1080p", QualidadeDaImagem.rotulo(1920, 804));   // Bad Boys: Até o Fim (2,39:1), Fonte 2 ABYS
        assertEquals("1080p", QualidadeDaImagem.rotulo(1920, 800));
        assertEquals("1080p", QualidadeDaImagem.rotulo(1920, 696));   // 2,76:1
        assertEquals("720p", QualidadeDaImagem.rotulo(1280, 536));
        assertEquals("480p", QualidadeDaImagem.rotulo(854, 356));
        assertEquals("2160p", QualidadeDaImagem.rotulo(3840, 1608));
    }

    @Test
    public void tamanhosPadraoNaoMudam() {
        assertEquals("1080p", QualidadeDaImagem.rotulo(1920, 1080));
        assertEquals("720p", QualidadeDaImagem.rotulo(1280, 720));
        assertEquals("540p", QualidadeDaImagem.rotulo(960, 540));
        assertEquals("480p", QualidadeDaImagem.rotulo(854, 480));
        assertEquals("360p", QualidadeDaImagem.rotulo(640, 360));
        assertEquals("240p", QualidadeDaImagem.rotulo(426, 240));
        assertEquals("2160p", QualidadeDaImagem.rotulo(3840, 2160));
        assertEquals("1440p", QualidadeDaImagem.rotulo(2560, 1440));
    }

    @Test
    public void quatroPorTresECinemaDigital() {
        assertEquals("720p", QualidadeDaImagem.rotulo(960, 720));
        assertEquals("1080p", QualidadeDaImagem.rotulo(1440, 1080));
        assertEquals("576p", QualidadeDaImagem.rotulo(720, 576));
        assertEquals("480p", QualidadeDaImagem.rotulo(640, 480));
        assertEquals("1080p", QualidadeDaImagem.rotulo(2048, 1080));   // DCI 2K
        assertEquals("1080p", QualidadeDaImagem.rotulo(1998, 1080));
        assertEquals("2160p", QualidadeDaImagem.rotulo(4096, 2160));   // DCI 4K
    }

    @Test
    public void cortesQuebradosEncaixamNoDegrauDePerto() {
        assertEquals("1080p", QualidadeDaImagem.rotulo(1916, 1036));
        assertEquals("1080p", QualidadeDaImagem.rotulo(1904, 800));
        assertEquals("720p", QualidadeDaImagem.rotulo(1284, 722));     // Fonte 7 (Re:Zero) media 722p
        assertEquals("1000p", QualidadeDaImagem.rotulo(1778, 1000));   // longe de qualquer degrau: a conta, sem arredondar pra cima
    }

    @Test
    public void videoEmPeTemAMesmaClasseDoDeitado() {
        assertEquals("1080p", QualidadeDaImagem.rotulo(1080, 1920));
        assertEquals("720p", QualidadeDaImagem.rotulo(720, 1280));
    }

    @Test
    public void semLarguraUsaSoAAlturaESemAlturaEVazio() {
        assertEquals("804p", QualidadeDaImagem.rotulo(0, 804));
        assertEquals("1080p", QualidadeDaImagem.rotulo(0, 1080));
        assertEquals("", QualidadeDaImagem.rotulo(1920, 0));
        assertEquals("", QualidadeDaImagem.rotulo(0, 0));
        assertEquals(0, QualidadeDaImagem.classe(-1, -1));
    }

    @Test
    public void larguraExibidaAplicaOFormatoDoPixel() {
        assertEquals(1920, QualidadeDaImagem.larguraExibida(1440, 4f / 3f));   // HDV anamórfico
        assertEquals(853, QualidadeDaImagem.larguraExibida(720, 32f / 27f));   // DVD 16:9
        assertEquals(1920, QualidadeDaImagem.larguraExibida(1920, 1f));
        assertEquals(1920, QualidadeDaImagem.larguraExibida(1920, 0f));         // inválido = 1
        assertEquals(1920, QualidadeDaImagem.larguraExibida(1920, Float.NaN));
        assertEquals(0, QualidadeDaImagem.larguraExibida(0, 1f));
    }

    @Test
    public void masterHlsDaAMaiorClasse() {
        String master = "#EXTM3U\n"
            + "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x536\nb.m3u8\n"
            + "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x804\na.m3u8\n"
            + "#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x268\nc.m3u8\n";
        assertEquals("1080p", QualidadeDaImagem.doMaster(master));
        assertEquals("720p", QualidadeDaImagem.doMaster("#EXT-X-STREAM-INF:RESOLUTION=1280x720\nx.m3u8"));
        assertEquals("", QualidadeDaImagem.doMaster("#EXTM3U\n#EXTINF:6,\nseg1.ts"));
        assertEquals("", QualidadeDaImagem.doMaster(null));
    }
}
