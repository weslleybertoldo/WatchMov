package com.weslley.watchmov;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** 01/11/2026 (quedas na Fire TV): na página do motor ABYS só imagem e fonte deixam de carregar. */
public class MotorLeveTest {

    @Test
    public void imagemEFonteSaoDispensaveis() {
        assertTrue(ResolverPlugin.recursoDispensavelNoMotor("https://ads.exemplo.com/banner.png", null));
        assertTrue(ResolverPlugin.recursoDispensavelNoMotor("https://cdn.exemplo.com/capa.JPG?w=300#x", null));
        assertTrue(ResolverPlugin.recursoDispensavelNoMotor("https://cdn.exemplo.com/fonte.woff2", null));
        assertTrue(ResolverPlugin.recursoDispensavelNoMotor("https://cdn.exemplo.com/pixel", "image/avif,image/webp,*/*"));
    }

    @Test
    public void videoScriptEProxyPassam() {
        assertFalse(ResolverPlugin.recursoDispensavelNoMotor("https://abysscdn.com/sw.import.v3.js", "*/*"));
        assertFalse(ResolverPlugin.recursoDispensavelNoMotor("https://cdn.exemplo.com/video/720p/seg.mp4", "*/*"));
        assertFalse(ResolverPlugin.recursoDispensavelNoMotor("https://cdn.exemplo.com/player.css", "text/css,*/*;q=0.1"));
        assertFalse(ResolverPlugin.recursoDispensavelNoMotor("http://127.0.0.1:8099/abyss/push?sid=x&q=720&off=0", null));
        assertFalse(ResolverPlugin.recursoDispensavelNoMotor(null, "image/png"));
        assertFalse(ResolverPlugin.recursoDispensavelNoMotor("https://exemplo.com/png/listar", null));
    }
}
