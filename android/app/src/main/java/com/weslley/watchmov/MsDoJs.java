package com.weslley.watchmov;

/**
 * Milissegundos vindos do JS (ex.: o `startMs` do play). O `PluginCall.getLong` do Capacitor só devolve o valor quando
 * o JSON trouxe um Long — número que cabe em int (qualquer posição até ~24 dias) chega como Integer e virava o padrão 0:
 * o player nunca recebia o ponto que o app mandava e só retomava pela posição que ele mesmo guardou. Achado em 09/11/2026
 * no teste do "minuto onde parou em todos os aparelhos" (o app mandou startMs=600000 e o player abriu em 0).
 */
final class MsDoJs {
    private MsDoJs() {}

    /** Integer, Long, Double ou texto numérico → ms (nunca negativo); o resto → 0. */
    static long de(Object valor) {
        if (valor instanceof Number) return Math.max(0L, ((Number) valor).longValue());
        if (valor instanceof String) {
            try {
                return Math.max(0L, (long) Double.parseDouble(((String) valor).trim()));
            } catch (NumberFormatException e) {
                return 0L;
            }
        }
        return 0L;
    }
}
