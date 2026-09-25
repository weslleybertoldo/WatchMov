package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Recados WMOPT|progress / WMOPT|dead do script injetado (25/09/2026): o K diz de qual opção veio. */
public class OptionMsgTest {
    @Test
    public void lerKeEtapa() {
        assertEquals(2, OptionMsg.k("k=2|stage=player"));
        assertEquals("player", OptionMsg.stage("k=2|stage=player"));
        assertEquals("play", OptionMsg.stage("k=1|stage=play"));
        assertEquals(3, OptionMsg.k("k=3|reason=not-found"));
    }

    @Test
    public void recadoTortoNaoValeNenhumaOpcao() {
        assertEquals(-1, OptionMsg.k("stage=player"));
        assertEquals(-1, OptionMsg.k("k=x|stage=player"));
        assertEquals(-1, OptionMsg.k(null));
        assertEquals("", OptionMsg.stage("k=2"));
    }
}
