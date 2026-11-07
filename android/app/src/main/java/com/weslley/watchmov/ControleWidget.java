package com.weslley.watchmov;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Widget "Controle da TV" na tela inicial do celular (pedido dele 07/11/2026): os botões do Controle remoto do app —
 * setas, OK, Voltar, Início, ⏪ ⏯ ⏩, episódios e assistido — funcionando SEM abrir o app. Aqui só desenha: cada botão
 * é um PendingIntent pro ControleWidgetTecla (receiver NÃO exportado, que manda a tecla) e "Trocar TV" abre a
 * TrocarTvActivity. Sem token ou sem TV escolhida, os botões somem e fica o aviso de abrir o app.
 * O mesmo APK roda na TV (Fire TV): lá não tem widget na tela inicial, e nada daqui pode derrubar o app.
 */
public class ControleWidget extends AppWidgetProvider {

    private static final String TAG = "WmWidget";

    // Cada botão do layout e a tecla que ele manda (as de WidgetDados.teclaValida).
    private static final int[] BOTOES = { R.id.wm_w_cima, R.id.wm_w_baixo, R.id.wm_w_esq, R.id.wm_w_dir, R.id.wm_w_ok,
        R.id.wm_w_voltar, R.id.wm_w_inicio, R.id.wm_w_rew, R.id.wm_w_playpause, R.id.wm_w_ff, R.id.wm_w_ep_ant,
        R.id.wm_w_assistido, R.id.wm_w_ep_prox };
    private static final String[] TECLAS = { "up", "down", "left", "right", "ok", "back", "home", "rew", "playpause",
        "ff", "prev-ep", "watched", "next-ep" };

    // requestCode único por PendingIntent: com o mesmo, o FLAG_UPDATE_CURRENT trocaria a tecla de um botão pela de outro.
    private static final int RC_ABRIR_APP = 1, RC_TROCAR_TV = 2, RC_TECLA = 100;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        atualizarTodos(ctx);
    }

    /** Redesenha todos os widgets na tela com o que está salvo (WidgetEstado). Pode ser chamado de qualquer thread. */
    public static void atualizarTodos(Context ctx) {
        try {
            Context app = ctx.getApplicationContext();
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            if (mgr == null) return;   // aparelho sem widgets (TV)
            int[] ids = mgr.getAppWidgetIds(new ComponentName(app, ControleWidget.class));
            if (ids == null || ids.length == 0) return;
            mgr.updateAppWidget(ids, montar(app, WidgetEstado.ler(app)));
        } catch (Throwable t) {
            Log.w(TAG, "widget não redesenhou: " + t);
        }
    }

    /** Quantos widgets estão na tela inicial (0 na TV). */
    static int quantos(Context ctx) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr == null ? null : mgr.getAppWidgetIds(new ComponentName(ctx, ControleWidget.class));
            return ids == null ? 0 : ids.length;
        } catch (Throwable t) {
            return 0;
        }
    }

    /** O launcher aceita que o app peça pra fixar o widget (Android 8+)? */
    static boolean suportaFixar(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return false;
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            return mgr != null && mgr.isRequestPinAppWidgetSupported();
        } catch (Throwable t) {
            return false;
        }
    }

    /** Pede ao launcher pra pôr o widget na tela inicial (o próprio Android mostra a confirmação). */
    static boolean fixar(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return false;
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            return mgr != null && mgr.isRequestPinAppWidgetSupported()
                && mgr.requestPinAppWidget(new ComponentName(ctx, ControleWidget.class), null, null);
        } catch (Throwable t) {
            Log.w(TAG, "não deu pra fixar o widget: " + t);
            return false;
        }
    }

    private static RemoteViews montar(Context ctx, WidgetEstado e) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.wm_widget_controle);
        boolean pronto = e.configurado();
        v.setTextViewText(R.id.wm_w_tv_nome, pronto ? e.nomeDaTv() : ctx.getString(R.string.wm_widget_nome));
        v.setViewVisibility(R.id.wm_w_controles, pronto ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.wm_w_aviso, pronto ? View.GONE : View.VISIBLE);
        // Todo clique vai nos dois estados: o launcher reaplica o desenho novo por cima do antigo, e um clique que não
        // fosse reposto continuaria fazendo o que fazia no estado anterior.
        for (int i = 0; i < BOTOES.length; i++) v.setOnClickPendingIntent(BOTOES[i], tecla(ctx, TECLAS[i], RC_TECLA + i));
        PendingIntent trocar = trocarTv(ctx), abrir = abrirApp(ctx);
        v.setOnClickPendingIntent(R.id.wm_w_trocar, trocar);
        v.setOnClickPendingIntent(R.id.wm_w_tv_nome, pronto ? trocar : abrir);   // tocar no nome da TV = trocar
        v.setOnClickPendingIntent(R.id.wm_w_aviso, abrir);
        return v;
    }

    private static PendingIntent tecla(Context ctx, String tecla, int rc) {
        Intent i = new Intent(ctx, ControleWidgetTecla.class)
            .setAction(ControleWidgetTecla.ACAO)
            .putExtra(ControleWidgetTecla.EXTRA_TECLA, tecla)
            // Fila de entrega de primeiro plano: na de segundo plano o toque pode esperar segundos atrás de outros apps.
            .addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
        return PendingIntent.getBroadcast(ctx, rc, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent trocarTv(Context ctx) {
        Intent i = new Intent(ctx, TrocarTvActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, RC_TROCAR_TV, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // Igual ao ícone do app (MAIN + LAUNCHER): com o app já aberto, volta pra onde a pessoa estava (até o player).
    static PendingIntent abrirApp(Context ctx) {
        return PendingIntent.getActivity(ctx, RC_ABRIR_APP, intentDoApp(ctx),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Intent intentDoApp(Context ctx) {
        return new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
    }
}
