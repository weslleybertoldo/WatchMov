package com.weslley.watchmov;

import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.HttpDataSource;

import java.io.EOFException;
import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;

/**
 * Motivo LEGÍVEL de uma falha de download (Media3) + status HTTP real. Sem Android:
 * dá pra testar na JVM. Antes o app mostrava a exceção crua ("Falhou:
 * java.net.SocketTimeoutException: Read timed out"), não dizia onde parou nem que dá
 * pra continuar — retomar SEMPRE segue do cache (mesma DownloadRequest), e a aba
 * Download já retoma sozinha ao abrir (Downloader.resume).
 */
@UnstableApi
final class DownloadFailure {

    static final String RETOMAR = "abra a aba Download pra retomar de onde parou";

    private DownloadFailure() {}

    /** Status HTTP da resposta que derrubou o download (InvalidResponseCodeException na cadeia), ou 0. */
    static int httpStatusOf(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) {
                return ((HttpDataSource.InvalidResponseCodeException) t).responseCode;
            }
            if (t.getCause() == t) break;
        }
        return 0;
    }

    static Throwable rootCause(Throwable e) {
        Throwable t = e;
        while (t != null && t.getCause() != null && t.getCause() != t) t = t.getCause();
        return t;
    }

    /** Frase curta do motivo (sem "onde parou"). */
    static String motivo(Throwable e) {
        if (e == null) return "Download interrompido";
        int http = httpStatusOf(e);
        if (http == 404 || http == 410) return "Link expirou: abra o título de novo pra capturar outro";
        if (http == 403 || http == 451) return "A fonte bloqueou o download: troque a fonte";
        if (http == 504 || http == 408) return "Servidor da fonte demorou demais pra responder";
        if (http == 502 || http == 503) return "Servidor da fonte fora do ar";
        if (http >= 400) return "Servidor da fonte respondeu erro " + http;
        Throwable root = rootCause(e);
        if (root instanceof SocketTimeoutException) return "Servidor da fonte parou de responder";
        if (root instanceof UnknownHostException) return "Sem conexão com o servidor da fonte";
        if (root instanceof ConnectException) return "Servidor da fonte recusou a conexão";
        if (root instanceof EOFException) return "Conexão com a fonte caiu no meio";
        String msg = root != null && root.getMessage() != null ? root.getMessage().toLowerCase() : "";
        if (root instanceof IOException && (msg.contains("unexpected end") || msg.contains("reset") || msg.contains("broken pipe"))) {
            return "Conexão com a fonte caiu no meio";
        }
        return "Falha: " + (root != null ? root.getClass().getSimpleName() : e.getClass().getSimpleName());
    }

    /** "Servidor da fonte parou de responder · parou em 37% · abra a aba Download pra retomar de onde parou". */
    static String describe(Throwable e, float percent) {
        StringBuilder sb = new StringBuilder(motivo(e));
        if (!Float.isNaN(percent) && percent > 0 && percent < 100) {
            sb.append(" · parou em ").append(Math.round(percent)).append('%');
        }
        sb.append(" · ").append(RETOMAR);
        return sb.toString();
    }
}
