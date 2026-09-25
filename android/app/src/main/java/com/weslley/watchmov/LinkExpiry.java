package com.weslley.watchmov;

/**
 * Link com PRAZO na própria URL (`expires=<unix>`) e a decisão de pedir link novo quando ele cai no meio.
 * A Fonte 6/WatchPlay vence em ~10 min (medido 24/09/2026): vencido, o servidor responde 410/403 e o
 * player parava com "Nenhum link tocou" no meio do filme. Espelho de `linkExpiresAt`/`isExpiredUrl` do
 * streamCache.ts — mesma regra nos dois lados. Puro (sem Android) pra testar na JVM.
 */
final class LinkExpiry {
    private LinkExpiry() {}

    static final long MARGIN_MS = 60_000;   // não abrir um link que vence no meio da abertura
    private static final java.util.regex.Pattern EXP =
        java.util.regex.Pattern.compile("[?&](?:expires|exp)=(\\d{10,13})(?=&|$)", java.util.regex.Pattern.CASE_INSENSITIVE);

    /** Prazo do link em ms (epoch) ou -1 sem prazo. Aceita a URL real ou a do proxy (…/s?u=<real codificada>). */
    static long expiresAtMs(String url) {
        if (url == null || url.isEmpty()) return -1;
        String s = url;
        try { s = java.net.URLDecoder.decode(url, "UTF-8"); } catch (Exception ignored) { }
        java.util.regex.Matcher m = EXP.matcher(s);
        if (!m.find()) return -1;
        long n;
        try { n = Long.parseLong(m.group(1)); } catch (NumberFormatException e) { return -1; }
        long ms = n < 1_000_000_000_000L ? n * 1000 : n;
        return ms > 1_500_000_000_000L && ms < 4_200_000_000_000L ? ms : -1;   // só número com cara de data
    }

    static boolean isExpired(String url, long nowMs) {
        long t = expiresAtMs(url);
        return t > 0 && nowMs > t - MARGIN_MS;
    }

    /**
     * Acabaram os links da lista e o atual morreu: vale pedir link NOVO ao app (resolvedor) em vez de parar?
     * Sim quando o link venceu (403/410 ou prazo da URL) ou quando ele JÁ estava tocando (caiu no meio do
     * filme: 5xx, rede, motor /abyss/ parado). Link que nunca tocou por outro motivo (404, formato) = não.
     */
    static boolean shouldRecapture(int httpCode, boolean currentExpired, boolean everPlayed) {
        if (currentExpired || httpCode == 403 || httpCode == 410) return true;
        if (!everPlayed) return false;
        return httpCode <= 0 || httpCode >= 500 || httpCode == 408 || httpCode == 429;
    }
}
