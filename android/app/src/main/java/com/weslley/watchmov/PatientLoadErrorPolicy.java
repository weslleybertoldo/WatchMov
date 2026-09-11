package com.weslley.watchmov;

import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;

/**
 * Política de retry do player pra FONTE LENTA. Erro de rede/timeout num pedaço ganha
 * 6 tentativas (padrão 3) antes de virar erro fatal — com o backoff padrão (1→5 s);
 * resposta HTTP de erro (403/404/410/5xx) continua com as 3 do padrão: é "link morto",
 * esticar só atrasaria o auto-avanço pro próximo link. Erros que o Media3 já não refaz
 * (ParserException, manifesto malformado…) seguem iguais.
 *
 * Caso 10/09/2026: CDN da embedplayer2 lento → SocketTimeoutException (10 s do OkHttp)
 * → ERROR_CODE_IO_NETWORK_CONNECTION_FAILED e recarga, em vez de buffering.
 * Puro (sem Android) — coberto pelo smoke da JVM.
 */
@UnstableApi
final class PatientLoadErrorPolicy extends DefaultLoadErrorHandlingPolicy {

    static final int TENTATIVAS_REDE = 6;
    static final int TENTATIVAS_HTTP = 3;

    PatientLoadErrorPolicy() { super(TENTATIVAS_REDE); }

    @Override
    public long getRetryDelayMsFor(LoadErrorInfo info) {
        long base = super.getRetryDelayMsFor(info);
        if (base == C.TIME_UNSET) return base;                 // o padrão já não refaz esse
        if (isHttpStatusError(info.exception) && info.errorCount > TENTATIVAS_HTTP) return C.TIME_UNSET;
        return base;
    }

    /** InvalidResponseCodeException em qualquer ponto da cadeia = o CDN RESPONDEU (com erro). */
    static boolean isHttpStatusError(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) return true;
            if (t.getCause() == t) break;
        }
        return false;
    }
}
