package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Espelhamento DLNA: TV parada ou congelada no meio do filme (25/09/2026). */
public class CastStallTest {
    private static final long DUR = 6_015_000;   // 1h40 (Fonte 6 do caso de 16/09)

    /** Poll a cada 1,5 s com a posição andando 1,5 s por poll, a partir de `pos`, por `polls` vezes. */
    private static long tocando(CastStall c, long t, long pos, int polls) {
        for (int i = 0; i < polls; i++) {
            assertEquals(CastStall.Event.NONE, c.onPoll(t, "PLAYING", pos, DUR, false));
            t += 1500; pos += 1500;
        }
        return t;
    }

    @Test
    public void congelou_posicaoParadaCom30sDeTvTocando() {
        CastStall c = new CastStall();
        c.reset(0);
        long t = tocando(c, 0, 542_000, 6);
        long parado = 551_000;
        assertEquals(CastStall.Event.NONE, c.onPoll(t, "PLAYING", parado, DUR, false));
        assertEquals(CastStall.Event.NONE, c.onPoll(t + 29_000, "PLAYING", parado, DUR, false));
        assertEquals(CastStall.Event.FROZEN, c.onPoll(t + 30_000, "PLAYING", parado, DUR, false));
        assertEquals("1 evento por envio", CastStall.Event.NONE, c.onPoll(t + 60_000, "PLAYING", parado, DUR, false));
        c.reset(t + 61_000);
        assertEquals("reset volta a olhar", CastStall.Event.NONE, c.onPoll(t + 62_000, "PLAYING", parado, DUR, false));
    }

    @Test
    public void pausadoPeloUsuario_naoEhTravamento() {
        CastStall c = new CastStall();
        c.reset(0);
        long t = tocando(c, 0, 100_000, 4);
        for (int i = 0; i < 60; i++) assertEquals(CastStall.Event.NONE, c.onPoll(t + i * 1500L, "PAUSED_PLAYBACK", 106_000, DUR, true));
        // voltou a tocar: conta de novo a partir de agora, não da pausa
        long volta = t + 90_000;
        assertEquals(CastStall.Event.NONE, c.onPoll(volta + 20_000, "PLAYING", 106_000, DUR, false));
    }

    @Test
    public void semPosicaoDaTvOuNaoTocouAinda_naoDispara() {
        CastStall c = new CastStall();
        c.reset(0);
        assertEquals(CastStall.Event.NONE, c.onPoll(60_000, "TRANSITIONING", -1, DUR, false));
        assertEquals(CastStall.Event.NONE, c.onPoll(90_000, "PLAYING", 0, DUR, false));
        assertEquals(CastStall.Event.NONE, c.onPoll(95_000, "STOPPED", -1, DUR, false));
        assertEquals(CastStall.Event.NONE, c.onPoll(97_000, "STOPPED", -1, DUR, false));
    }

    @Test
    public void parouNoMeio_duasConsultasSeguidas() {
        CastStall c = new CastStall();
        c.reset(0);
        long t = tocando(c, 0, 3_631_000, 5);
        assertEquals(CastStall.Event.NONE, c.onPoll(t, "STOPPED", 0, DUR, false));
        assertEquals(CastStall.Event.STOPPED, c.onPoll(t + 1500, "STOPPED", 0, DUR, false));
    }

    @Test
    public void fimDoFilme_naoEhQueda() {
        CastStall c = new CastStall();
        c.reset(0);
        long t = tocando(c, 0, DUR - 60_000, 5);
        assertEquals(CastStall.Event.NONE, c.onPoll(t, "STOPPED", 0, DUR, false));
        assertEquals(CastStall.Event.NONE, c.onPoll(t + 1500, "STOPPED", 0, DUR, false));
        CastStall d = new CastStall();
        d.reset(0);
        long u = tocando(d, 0, DUR - 30_000, 3);
        assertEquals("parado nos 90 s finais", CastStall.Event.NONE, d.onPoll(u + 40_000, "PLAYING", DUR - 27_000, DUR, false));
    }

    @Test
    public void decide_linkMortoPegaLinkNovo() {
        assertEquals(CastStall.Action.RELINK, CastStall.decide(CastStall.Event.FROZEN, true, 0, -1, 0, -1));
        assertEquals(CastStall.Action.RELINK, CastStall.decide(CastStall.Event.STOPPED, false, 410, -1, 0, -1));
        assertEquals(CastStall.Action.RELINK, CastStall.decide(CastStall.Event.FROZEN, false, 403, -1, 0, -1));
        assertEquals(CastStall.Action.RELINK, CastStall.decide(CastStall.Event.STOPPED, false, 404, -1, 0, -1));
    }

    @Test
    public void decide_travouSemLinkMortoReenviaOMesmo() {
        assertEquals(CastStall.Action.RESEND, CastStall.decide(CastStall.Event.FROZEN, false, 0, -1, 0, -1));
        assertEquals(CastStall.Action.RESEND, CastStall.decide(CastStall.Event.STOPPED, false, 504, -1, 0, -1));
        assertEquals("reenviou faz tempo", CastStall.Action.RESEND, CastStall.decide(CastStall.Event.FROZEN, false, 0, 10 * 60_000, 1, -1));
    }

    @Test
    public void decide_travouDeNovoLogoDepoisDoReenvio_pegaLinkNovo() {
        assertEquals(CastStall.Action.RELINK, CastStall.decide(CastStall.Event.FROZEN, false, 0, 60_000, 1, -1));
        assertEquals(CastStall.Action.RELINK, CastStall.decide(CastStall.Event.FROZEN, false, 0, 10 * 60_000, CastStall.MAX_RESENDS, -1));
    }

    @Test
    public void decide_parouSemErroNoProxy_foiOControleDaTv() {
        assertEquals(CastStall.Action.NONE, CastStall.decide(CastStall.Event.STOPPED, false, 0, -1, 0, -1));
        assertEquals(CastStall.Action.NONE, CastStall.decide(CastStall.Event.NONE, true, 410, -1, 0, -1));
    }

    // 25/09/2026 (prova dele): espelhando, arrastou pro 00:00:00 e a TV ficou carregando parada no zero — o
    // vigia não via nada porque só contava depois de a posição passar de 0.
    @Test
    public void puloPro00_tvParadaNoZero_congela() {
        CastStall c = new CastStall();
        c.reset(0);
        c.expect(1_000, 0, true);
        assertEquals(CastStall.Event.NONE, c.onPoll(2_500, "TRANSITIONING", -1, DUR, false));
        assertEquals(CastStall.Event.NONE, c.onPoll(20_000, "PLAYING", 0, DUR, false));
        assertEquals(CastStall.Event.NONE, c.onPoll(30_500, "TRANSITIONING", 0, DUR, false));
        assertEquals(CastStall.Event.FROZEN, c.onPoll(31_000, "PLAYING", 0, DUR, false));
    }

    @Test
    public void puloPro00_tvVoltaAAndar_naoDispara() {
        CastStall c = new CastStall();
        c.reset(0);
        c.expect(0, 0, true);
        assertEquals(CastStall.Event.NONE, c.onPoll(4_000, "TRANSITIONING", 0, DUR, false));
        tocando(c, 6_000, 1_500, 30);
    }

    @Test
    public void puloPro00_tvParou_contaComoQueda() {
        CastStall c = new CastStall();
        c.reset(0);
        c.expect(0, 0, true);
        assertEquals(CastStall.Event.NONE, c.onPoll(3_000, "STOPPED", 0, DUR, false));
        assertEquals(CastStall.Event.STOPPED, c.onPoll(4_500, "STOPPED", 0, DUR, false));
    }

    // 25/09/2026: saiu do player e voltou espelhando — o player novo não vigiava; com a TV já parada ao
    // reabrir, a posição salva vira a referência.
    @Test
    public void reabertoEspelhando_tvJaParada_contaComoQueda() {
        CastStall c = new CastStall();
        c.reset(0);
        c.expect(0, 434_000, false);
        assertEquals(CastStall.Event.NONE, c.onPoll(1_500, "NO_MEDIA_PRESENT", -1, DUR, false));
        assertEquals(CastStall.Event.STOPPED, c.onPoll(3_000, "NO_MEDIA_PRESENT", -1, DUR, false));
    }

    @Test
    public void sinceSeek_contaSoDepoisDeUmPulo() {
        CastStall c = new CastStall();
        c.reset(0);
        assertEquals(-1, c.sinceSeek(5_000));
        c.expect(1_000, 0, true);
        assertEquals(4_000, c.sinceSeek(5_000));
        c.expect(6_000, 434_000, false);
        assertEquals("reabrir não é pulo", -1, c.sinceSeek(7_000));
        c.reset(8_000);
        assertEquals(-1, c.sinceSeek(9_000));
    }

    @Test
    public void decide_parouLogoDepoisDoPulo_naoEhOControleDaTv() {
        assertEquals(CastStall.Action.RESEND, CastStall.decide(CastStall.Event.STOPPED, false, 0, -1, 0, 10_000));
        assertEquals("pulo antigo = controle da TV", CastStall.Action.NONE, CastStall.decide(CastStall.Event.STOPPED, false, 0, -1, 0, CastStall.SEEK_GRACE_MS));
    }

    @Test
    public void decide_parouLogoDepoisDoReenvio_pegaLinkNovo() {
        assertEquals(CastStall.Action.RELINK, CastStall.decide(CastStall.Event.STOPPED, false, 0, 60_000, 1, -1));
        assertEquals("reenvio antigo = controle da TV", CastStall.Action.NONE, CastStall.decide(CastStall.Event.STOPPED, false, 0, 10 * 60_000, 1, -1));
    }
}
