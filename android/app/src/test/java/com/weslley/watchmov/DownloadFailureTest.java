package com.weslley.watchmov;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Decisão de link morto (PR 4, 23/09/2026): só status permanente e só com dupla confirmação. */
public class DownloadFailureTest {

    @Test
    public void statusDeLinkMorto_soOsPermanentes() {
        assertTrue(DownloadFailure.isDeadLinkStatus(404));
        assertTrue(DownloadFailure.isDeadLinkStatus(410));
        assertTrue(DownloadFailure.isDeadLinkStatus(403));
        assertTrue(DownloadFailure.isDeadLinkStatus(451));
        // temporários / sucesso / sem status: nunca
        assertFalse(DownloadFailure.isDeadLinkStatus(200));
        assertFalse(DownloadFailure.isDeadLinkStatus(206));
        assertFalse(DownloadFailure.isDeadLinkStatus(408));
        assertFalse(DownloadFailure.isDeadLinkStatus(429));
        assertFalse(DownloadFailure.isDeadLinkStatus(500));
        assertFalse(DownloadFailure.isDeadLinkStatus(502));
        assertFalse(DownloadFailure.isDeadLinkStatus(503));
        assertFalse(DownloadFailure.isDeadLinkStatus(504));
        assertFalse(DownloadFailure.isDeadLinkStatus(0));
        assertFalse(DownloadFailure.isDeadLinkStatus(-1));
    }

    @Test
    public void duplaConfirmacao_exigeOMesmoStatusDeLinkMorto() {
        assertTrue(DownloadFailure.confirmsDeadLink(410, 410));
        assertTrue(DownloadFailure.confirmsDeadLink(404, 404));
        assertTrue(DownloadFailure.confirmsDeadLink(403, 403));
        // link voltou a responder → NÃO cancela
        assertFalse(DownloadFailure.confirmsDeadLink(410, 200));
        assertFalse(DownloadFailure.confirmsDeadLink(410, 206));
        // sem rede na 2ª consulta → NÃO cancela
        assertFalse(DownloadFailure.confirmsDeadLink(410, -1));
        // status diferente → NÃO cancela
        assertFalse(DownloadFailure.confirmsDeadLink(410, 404));
        assertFalse(DownloadFailure.confirmsDeadLink(404, 403));
        // 1ª falha não era de link morto → nunca entra, mesmo repetindo
        assertFalse(DownloadFailure.confirmsDeadLink(503, 503));
        assertFalse(DownloadFailure.confirmsDeadLink(0, 0));
        assertFalse(DownloadFailure.confirmsDeadLink(-1, -1));
    }

    @Test
    public void motivoDoCancelamento_porStatus() {
        assertEquals("Link expirou · download cancelado · abra o título de novo pra baixar", DownloadFailure.deadLinkReason(410));
        assertEquals("Link expirou · download cancelado · abra o título de novo pra baixar", DownloadFailure.deadLinkReason(404));
        assertEquals("A fonte bloqueou o download · cancelado · troque a fonte e baixe de novo", DownloadFailure.deadLinkReason(403));
        assertEquals("A fonte bloqueou o download · cancelado · troque a fonte e baixe de novo", DownloadFailure.deadLinkReason(451));
    }

    @Test
    public void failedUrlOf_semExcecaoHttp_devolveNull() {
        assertEquals(null, DownloadFailure.failedUrlOf(null));
        assertEquals(null, DownloadFailure.failedUrlOf(new java.io.IOException("sem rede")));
        assertEquals(null, DownloadFailure.failedUrlOf(new RuntimeException(new java.net.SocketTimeoutException("timeout"))));
    }
}
