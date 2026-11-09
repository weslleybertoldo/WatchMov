package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.json.JSONObject;
import org.junit.Test;

/** startMs do JS chegando no player (09/11/2026: o app mandou 600000 e o player abriu em 0). */
public class MsDoJsTest {
    @Test
    public void numeroQueCabeEmInt_chegaComoInteger_eAgoraVale() throws Exception {
        Object v = new JSONObject("{\"startMs\":600000}").opt("startMs");
        assertFalse("o getLong do Capacitor só aceita Long — por isso virava 0", v instanceof Long);
        assertEquals(600000L, MsDoJs.de(v));
    }

    @Test
    public void longDoubleETexto() throws Exception {
        assertEquals(3_000_000_000L, MsDoJs.de(new JSONObject("{\"a\":3000000000}").opt("a")));
        assertEquals(851000L, MsDoJs.de(851000.7));
        assertEquals(1500L, MsDoJs.de(" 1500 "));
    }

    @Test
    public void ausenteTortoOuNegativo_eZero() {
        assertEquals(0L, MsDoJs.de(null));
        assertEquals(0L, MsDoJs.de("abc"));
        assertEquals(0L, MsDoJs.de(-5));
        assertEquals(0L, MsDoJs.de(Boolean.TRUE));
    }
}
