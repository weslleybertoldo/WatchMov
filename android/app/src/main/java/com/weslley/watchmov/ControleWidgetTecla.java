package com.weslley.watchmov;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.widget.Toast;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Toque num botão do widget "Controle da TV" → a tecla vai pra TV escolhida pela edge function `tv-remote`, com o token
 * próprio do widget (WidgetEstado). Receiver separado do ControleWidget e NÃO exportado: o provider do widget precisa
 * ser exportado (é o sistema que manda as atualizações), e assim nenhum outro app consegue mandar tecla pra TV.
 * O 200 só diz que a tecla foi entregue no canal da conta: a TV não responde, então o widget não sabe se ela está aberta.
 */
public class ControleWidgetTecla extends BroadcastReceiver {

    static final String ACAO = "com.weslley.watchmov.WIDGET_TECLA";
    static final String EXTRA_TECLA = "tecla";

    private static final String TAG = "WmWidget";
    private static final long VIBRA_MS = 18;
    private static final long TOAST_MS = 3000;   // no máximo 1 aviso a cada 3 s (5 toques sem rede = 1 Toast só)
    private static final long SEGURA_MS = 500;   // ver onReceive
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    // UMA thread: as teclas chegam na TV na ordem em que foram tocadas.
    private static final ExecutorService FILA = Executors.newSingleThreadExecutor(r -> new Thread(r, "wm-widget-teclas"));
    // Cliente único: a conexão com o Supabase fica aberta de um toque pro outro (sem refazer o TLS a cada tecla).
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .writeTimeout(4, TimeUnit.SECONDS)
        .callTimeout(5, TimeUnit.SECONDS)
        .build();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static long ultimoToast = -TOAST_MS;   // só lido/gravado na main thread

    @Override
    public void onReceive(Context ctx, Intent intent) {
        final String tecla = intent == null ? null : intent.getStringExtra(EXTRA_TECLA);
        if (!WidgetDados.teclaValida(tecla)) return;
        final Context app = ctx.getApplicationContext();
        vibrar(app);
        final long tocouEm = SystemClock.elapsedRealtime();
        // O Android só entrega o próximo toque depois do finish() deste. Segurando até a chamada acabar, com a rede
        // travada os toques seguintes esperariam no SISTEMA e chegariam na TV segundos depois, sem o `velha` ver a
        // espera. Então solta no fim da chamada OU em SEGURA_MS, o que vier primeiro (uma vez só): os toques entram na
        // nossa fila na hora e na ordem, e o `velha` mede a espera de verdade. Com a rede boa a chamada acaba antes.
        final PendingResult pendente = goAsync();
        final AtomicBoolean solto = new AtomicBoolean();
        final Runnable soltar = () -> { if (solto.compareAndSet(false, true)) pendente.finish(); };
        MAIN.postDelayed(soltar, SEGURA_MS);
        try {
            FILA.execute(() -> {
                try {
                    mandar(app, tecla, tocouEm);
                } catch (Throwable t) {
                    Log.w(TAG, "tecla " + tecla + " falhou: " + t.getClass().getSimpleName());
                } finally {
                    MAIN.removeCallbacks(soltar);
                    soltar.run();
                }
            });
        } catch (Throwable t) {
            MAIN.removeCallbacks(soltar);
            soltar.run();
        }
    }

    private static void mandar(Context ctx, String tecla, long tocouEm) {
        long agora = SystemClock.elapsedRealtime();
        if (WidgetDados.velha(tocouEm, agora)) {
            Log.i(TAG, "tecla " + tecla + " esperou " + (agora - tocouEm) + " ms na fila: não vai (tecla fantasma)");
            return;
        }
        WidgetEstado e = WidgetEstado.ler(ctx);
        if (!e.configurado()) {   // widget ainda desenhado como pronto, mas o app tirou o token ou a TV
            ControleWidget.atualizarTodos(ctx);
            avisar(ctx, WidgetDados.mensagemDeErro(e.temToken() ? 400 : 401, false));
            return;
        }
        String corpo = WidgetDados.corpoTecla(e.token, e.tvSid, tecla);
        Resposta r = post(e.url, e.anon, corpo);
        // Falhou ANTES de chegar no servidor (DNS, rota, conexão: a rede do celular oscila): a tecla não foi, então
        // repetir não duplica. Tenta mais uma vez se ela ainda está fresca (no emulador 1 de 5 toques caiu assim).
        if (r.semRede && !WidgetDados.velha(tocouEm, SystemClock.elapsedRealtime() + 300)) {
            SystemClock.sleep(300);
            r = post(e.url, e.anon, corpo);
        }
        if (r.ok()) return;
        Log.w(TAG, "tecla " + tecla + ": status " + r.status + (r.semRede ? " (sem internet)" : ""));
        // Token apagado/inválido: o widget passa a pedir pra abrir o app (que cria outro token).
        if (r.status == 401 && WidgetEstado.apagarTokenSe(ctx, e.token)) ControleWidget.atualizarTodos(ctx);
        avisar(ctx, WidgetDados.mensagemDeErro(r.status, r.semRede));
    }

    /** Resposta da edge function. status 0 = não chegou no servidor (semRede = foi falta de internet). */
    static final class Resposta {
        final int status;
        final String corpo;
        final boolean semRede;

        Resposta(int status, String corpo, boolean semRede) {
            this.status = status; this.corpo = corpo; this.semRede = semRede;
        }

        boolean ok() { return status >= 200 && status < 300; }
    }

    /** POST na edge function `tv-remote` (a janelinha Trocar TV também usa). Bloqueia: nunca na main thread. */
    static Resposta post(String url, String anon, String corpo) {
        try {
            Request req = new Request.Builder()
                .url(WidgetDados.endereco(url))
                .header("apikey", anon)
                .header("Authorization", "Bearer " + anon)
                .post(RequestBody.create(corpo, JSON))
                .build();
            try (Response r = HTTP.newCall(req).execute()) {
                ResponseBody b = r.body();
                return new Resposta(r.code(), b != null ? b.string() : "", false);
            }
        } catch (IOException e) {
            return new Resposta(0, "", WidgetDados.semRede(e));
        } catch (RuntimeException e) {   // URL ou chave gravada torta (a mensagem pode trazer a chave: só o tipo no log)
            Log.w(TAG, "chamada inválida: " + e.getClass().getSimpleName());
            return new Resposta(0, "", false);
        }
    }

    // Aviso curto na tela inicial. Na main thread (Toast precisa de Looper) e no máximo 1 a cada TOAST_MS.
    private static void avisar(Context ctx, String msg) {
        MAIN.post(() -> {
            long agora = SystemClock.elapsedRealtime();
            if (agora - ultimoToast < TOAST_MS) return;
            ultimoToast = agora;
            try {
                Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show();
            } catch (Throwable ignored) {}
        });
    }

    // Vibração curtinha a cada toque. O Android 9+ ignora vibração de app em segundo plano (o widget roda assim), menos
    // a de notificação; no 13+ a de "retorno de hardware" também passa e não depende do modo silencioso. Sem motor
    // (TV) não faz nada.
    private static void vibrar(Context ctx) {
        try {
            Vibrator v = ctx.getSystemService(Vibrator.class);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 33) {
                v.vibrate(VibrationEffect.createOneShot(VIBRA_MS, VibrationEffect.DEFAULT_AMPLITUDE),
                    VibrationAttributes.createForUsage(VibrationAttributes.USAGE_HARDWARE_FEEDBACK));
            } else if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(VIBRA_MS, VibrationEffect.DEFAULT_AMPLITUDE),
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
            } else {
                v.vibrate(VIBRA_MS);
            }
        } catch (Throwable ignored) {}
    }
}
