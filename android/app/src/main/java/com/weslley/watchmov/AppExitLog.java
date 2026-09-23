package com.weslley.watchmov;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.List;

/**
 * Por que o app FECHOU (aba Bugs, linha APP_FECHOU). Quando o processo morre — erro,
 * travamento (ANR), falta de memória, sistema matando — nada do que roda nele consegue
 * gravar a linha: a aba ficava vazia justamente no pior caso (23/09/2026: 3 fechamentos
 * sem nenhum registro, achados só pelo logcat). O Android guarda esse histórico
 * (getHistoricalProcessExitReasons, API 30+); no boot seguinte o JS pede os que ainda
 * não foram pra aba, grava e só então confirma (ackExits) — sem sessão ou sem rede, eles
 * ficam pro próximo boot.
 */
final class AppExitLog {

    private static final String PREFS = "wm_app_exit";
    private static final String K_ULTIMO = "ultimo_ts";     // último fechamento já gravado na aba
    private static final String K_PILHA = "crash_pilha";    // pilha do último crash Java (handler do MainActivity)
    private static final String K_PILHA_TS = "crash_ts";
    private static final int MAX_CAUSA = 3500;
    private static final int MAX_LINHAS_ANR = 40;

    private AppExitLog() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Fechamento que vira registro? Erro e travamento sempre; falta de memória e sistema
     *  matando só com o app na tela ou com serviço em primeiro plano (baixando/tocando) —
     *  em segundo plano o Android fecha apps o tempo todo e isso não é bug. Saída pelo
     *  usuário, atualização ou permissão nunca. */
    static boolean interessa(int reason, int importance) {
        switch (reason) {
            case ApplicationExitInfo.REASON_CRASH:
            case ApplicationExitInfo.REASON_CRASH_NATIVE:
            case ApplicationExitInfo.REASON_ANR:
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE:
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE:
                return true;
            case ApplicationExitInfo.REASON_LOW_MEMORY:
            case ApplicationExitInfo.REASON_SIGNALED:
            case ApplicationExitInfo.REASON_OTHER:
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED:
            case ApplicationExitInfo.REASON_FREEZER:
            case ApplicationExitInfo.REASON_UNKNOWN:
                return importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE;
            default:
                return false;
        }
    }

    static String motivo(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_CRASH: return "erro no app";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "erro nativo";
            case ApplicationExitInfo.REASON_ANR: return "travou (ANR)";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "falhou ao abrir";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "uso excessivo de recurso";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "falta de memória";
            case ApplicationExitInfo.REASON_SIGNALED: return "fechado pelo sistema (sinal)";
            case ApplicationExitInfo.REASON_OTHER: return "fechado pelo sistema";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "dependência parou";
            case ApplicationExitInfo.REASON_FREEZER: return "congelado pelo sistema";
            default: return "motivo " + reason;
        }
    }

    static String estado(int importance) {
        if (importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) return "na tela";
        if (importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE) return "baixando/tocando";
        if (importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE) return "visível";
        return "em segundo plano";
    }

    /** Handler de crash do MainActivity: o ApplicationExitInfo de erro Java não traz a
     *  pilha, então ela fica guardada pro registro do boot seguinte. commit() síncrono —
     *  o processo morre logo depois. */
    static void guardarPilha(Context ctx, String pilha) {
        try {
            prefs(ctx).edit().putString(K_PILHA, pilha).putLong(K_PILHA_TS, System.currentTimeMillis()).commit();
        } catch (Throwable ignored) { }
    }

    /** Fechamentos que ainda não foram pra aba, do mais velho pro mais novo. */
    static JSArray pendentes(Context ctx) {
        JSArray out = new JSArray();
        if (Build.VERSION.SDK_INT < 30) return out;
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            List<ApplicationExitInfo> lista = am.getHistoricalProcessExitReasons(ctx.getPackageName(), 0, 0);
            long ultimo = prefs(ctx).getLong(K_ULTIMO, 0);
            for (int i = lista.size() - 1; i >= 0; i--) {      // a lista vem do mais novo pro mais velho
                ApplicationExitInfo e = lista.get(i);
                if (e.getTimestamp() <= ultimo) continue;
                // Só o processo do app: o sandbox do WebView morre junto e repetiria a linha.
                if (!ctx.getPackageName().equals(e.getProcessName())) continue;
                if (!interessa(e.getReason(), e.getImportance())) continue;
                JSObject o = new JSObject();
                o.put("ts", e.getTimestamp());
                o.put("reason", e.getReason());
                o.put("cause", causa(ctx, e));
                out.put(o);
            }
        } catch (Throwable ignored) { }
        return out;
    }

    /** O JS gravou até este fechamento → não manda de novo. */
    static void confirmar(Context ctx, long ts) {
        SharedPreferences p = prefs(ctx);
        if (ts > p.getLong(K_ULTIMO, 0)) p.edit().putLong(K_ULTIMO, ts).apply();
    }

    @androidx.annotation.RequiresApi(30)
    private static String causa(Context ctx, ApplicationExitInfo e) {
        StringBuilder sb = new StringBuilder()
            .append(new java.text.SimpleDateFormat("dd/MM HH:mm:ss", java.util.Locale.US)
                .format(new java.util.Date(e.getTimestamp())))
            .append(" · ").append(motivo(e.getReason()))
            .append(" · ").append(estado(e.getImportance()));
        if (e.getPss() > 0) sb.append(" · memória ").append(e.getPss() / 1024).append(" MB");
        String desc = e.getDescription();
        if (desc != null && !desc.isEmpty()) sb.append(" · ").append(desc);
        String pilha = e.getReason() == ApplicationExitInfo.REASON_CRASH ? pilhaDoCrash(ctx, e.getTimestamp())
            : e.getReason() == ApplicationExitInfo.REASON_ANR ? pilhaDoAnr(e) : null;
        if (pilha != null) sb.append('\n').append(pilha);
        return sb.length() > MAX_CAUSA ? sb.substring(0, MAX_CAUSA) : sb.toString();
    }

    // A pilha guardada pelo handler só vale pro crash do mesmo instante (±1 min).
    private static String pilhaDoCrash(Context ctx, long ts) {
        SharedPreferences p = prefs(ctx);
        String pilha = p.getString(K_PILHA, null);
        long quando = p.getLong(K_PILHA_TS, 0);
        return pilha != null && Math.abs(ts - quando) < 60_000 ? pilha.trim() : null;
    }

    // Trace do ANR tem TODAS as threads (dezenas de KB): fica só a "main", que é a que travou.
    @androidx.annotation.RequiresApi(30)
    private static String pilhaDoAnr(ApplicationExitInfo e) {
        try (InputStream in = e.getTraceInputStream()) {
            if (in == null) return null;
            BufferedReader r = new BufferedReader(new InputStreamReader(in));
            StringBuilder sb = new StringBuilder();
            boolean main = false;
            int n = 0;
            for (String l; (l = r.readLine()) != null && n < MAX_LINHAS_ANR; ) {
                if (!main && l.startsWith("\"main\"")) main = true;
                else if (main && l.trim().isEmpty()) break;
                if (main) { sb.append(l).append('\n'); n++; }
            }
            return sb.length() > 0 ? sb.toString().trim() : null;
        } catch (Throwable t) {
            return null;
        }
    }
}
