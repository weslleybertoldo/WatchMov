package com.weslley.watchmov;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Fonte 4 (Pomfy, 19/10/2026): a página da fonte vai num iframe — aberta direto, o servidor dela responde 403. */
public class ResolverIframeTest {
    @Test
    public void iframeLevaOEnderecoDaFonte() {
        String p = ResolverPlugin.iframePage("https://api.pomfy.stream/serie/95350/1/2");
        assertTrue(p.contains("<iframe src=\"https://api.pomfy.stream/serie/95350/1/2\""));
        assertTrue(p.contains("allow=\"autoplay; fullscreen; encrypted-media\""));
    }

    @Test
    public void enderecoNaoQuebraOHtml() {
        String p = ResolverPlugin.iframePage("https://x.test/a?b=1&c=\"><script>alert(1)</script>");
        assertTrue(p.contains("src=\"https://x.test/a?b=1&amp;c=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;\""));
        assertFalse(p.contains("<script>"));
    }
}
