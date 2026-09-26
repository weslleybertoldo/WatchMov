package com.weslley.watchmov;

/**
 * Espelhando, o que o player do CELULAR pode fazer (25/09/2026). A sessão ABYS do proxy é de UM leitor
 * (AbyssSession.want → gen++ derruba o anterior): o player local aberto na mesma fonte derrubava o leitor
 * da TV ("abyss: leitor substituído") e a TV parava → recarga. Puro, sem Android.
 */
final class CastLocal {
    private CastLocal() {}

    /** A fonte aguenta um leitor só (link do motor ABYS)? Então o player local fica parado enquanto espelha. */
    static boolean umLeitor(String url) { return LiveQuality.abyssSid(url) != null; }

    /**
     * Duração do que está na TV. DLNA: a do player local (a da TV às vezes vem errada — "Dia D" 05/09/2026);
     * com o local parado (fonte de 1 leitor), a que ele já sabia antes de parar; senão a da TV. Chromecast:
     * a da TV (RemoteMediaClient é confiável). Nunca menor que a posição.
     */
    static long duracao(boolean dlna, long local, long guardada, long tv, long pos) {
        long doCelular = local > 0 ? local : Math.max(0, guardada);
        long daTv = Math.max(0, tv);
        long dur = dlna ? (doCelular > 0 ? doCelular : daTv) : (daTv > 0 ? daTv : doCelular);
        return Math.max(dur, pos);
    }
}
