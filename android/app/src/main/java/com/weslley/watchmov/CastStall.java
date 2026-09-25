package com.weslley.watchmov;

/**
 * Espelhamento DLNA: a TV parou ou congelou NO MEIO do filme — e o que fazer.
 * O vigia do envio (watchdogTick) só olha os primeiros ~90 s; depois disso nada era visto. Casos reais da aba
 * Bugs (16–19/09/2026): a TV ficou em "PLAYING" com a posição parada (542 → 551 s e mais nada) e, noutra noite,
 * o link da Fonte 6 já respondia 410 quando ele reabriu o player. Puro (sem Android) pra testar na JVM.
 */
final class CastStall {
    static final long FROZEN_MS = 30_000;        // TV "tocando" com a posição parada por 30 s = congelou
    static final int STOP_POLLS = 2;             // STOPPED em 2 consultas seguidas (~3 s) = parou
    static final long END_MARGIN_MS = 90_000;    // parar nos 90 s finais é o fim do filme, não queda
    static final long RESEND_GAP_MS = 180_000;   // travou de novo < 3 min depois de reenviar → link novo
    static final int MAX_RESENDS = 2;            // reenvios do MESMO link por abertura do player
    static final long WATCHDOG_STOP_MS = 40_000; // STOPPED nos 40 s depois do envio é do vigia do envio (RECAST_TV_PAROU)
    static final long RELINK_VALID_MS = 300_000; // o resolvedor pode levar minutos: a marca do link novo vale 5 min

    enum Event { NONE, FROZEN, STOPPED }
    enum Action { NONE, RESEND, RELINK }

    private long lastPos = -1;          // última posição que a TV deu (> 0)
    private long posChangedAt = -1;     // quando a posição andou pela última vez
    private int stopPolls = 0;
    private boolean fired = false;      // 1 evento por envio: só volta a olhar depois do reset

    /** Envio novo pra TV (1º cast, reenvio, troca de episódio): começa a olhar do zero. */
    void reset(long now) { lastPos = -1; posChangedAt = now; stopPolls = 0; fired = false; }

    /**
     * Uma consulta à TV. `state` = GetTransportInfo (PLAYING/STOPPED/…; null = sem resposta), `posMs` = posição
     * (-1 = TV não disse), `durMs` = duração conhecida (≤ 0 = não sabe), `paused` = pausado pelo usuário.
     */
    Event onPoll(long now, String state, long posMs, long durMs, boolean paused) {
        if (fired) return Event.NONE;
        if (posChangedAt < 0) posChangedAt = now;
        if (paused) { posChangedAt = now; stopPolls = 0; return Event.NONE; }
        String s = state == null ? "" : state;
        if ("STOPPED".equals(s) || "NO_MEDIA_PRESENT".equals(s)) {
            posChangedAt = now;
            if (++stopPolls < STOP_POLLS || lastPos <= 0 || nearEnd(lastPos, durMs)) return Event.NONE;
            fired = true;
            return Event.STOPPED;
        }
        stopPolls = 0;
        if (!"PLAYING".equals(s) && !"TRANSITIONING".equals(s)) return Event.NONE;
        if (posMs > 0 && posMs != lastPos) { lastPos = posMs; posChangedAt = now; return Event.NONE; }
        if (lastPos <= 0 || nearEnd(lastPos, durMs) || now - posChangedAt < FROZEN_MS) return Event.NONE;
        fired = true;
        return Event.FROZEN;
    }

    private static boolean nearEnd(long pos, long dur) { return dur > 0 && pos >= dur - END_MARGIN_MS; }

    /**
     * O que fazer com o evento. Link morto (venceu pelo prazo da URL, ou o proxy devolveu 403/404/410 pra TV) ou
     * travou de novo logo depois de um reenvio → RELINK (pedir link novo ao app). Congelou ou parou com erro
     * passageiro → RESEND (mesmo link, mesma posição). Parou SEM erro no proxy e com o link válido = foi o
     * controle da TV → NONE (só avisa). `sinceResendMs` < 0 = ainda não reenviou nesta abertura.
     */
    static Action decide(Event ev, boolean linkExpired, int lastUpstreamErr, long sinceResendMs, int resends) {
        if (ev == Event.NONE) return Action.NONE;
        boolean dead = linkExpired || lastUpstreamErr == 403 || lastUpstreamErr == 404 || lastUpstreamErr == 410;
        if (dead) return Action.RELINK;
        if (ev == Event.STOPPED && lastUpstreamErr <= 0) return Action.NONE;
        if (resends >= MAX_RESENDS || (sinceResendMs >= 0 && sinceResendMs < RESEND_GAP_MS)) return Action.RELINK;
        return Action.RESEND;
    }
}
