package com.weslley.watchmov;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.List;

/**
 * "Trocar TV" do widget (pedido dele 07/11/2026): janelinha por cima da tela inicial com as TVs da conta; tocar numa
 * TV passa a controlar ela. Mostra na hora a última lista salva e busca a nova em segundo plano (edge function
 * `tv-remote`, action "tvs"). Tela montada em código (lista curta: nada de RecyclerView).
 */
public class TrocarTvActivity extends Activity {

    private ScrollView rolagem;
    private LinearLayout lista, semToken;
    private TextView status, vazio;
    private boolean buscando;

    @Override
    protected void onCreate(Bundle salvo) {
        super.onCreate(salvo);
        setTitle(R.string.wm_widget_escolha_tv);   // o TalkBack lê ao abrir
        setContentView(montarTela());
        buscar();
        desenhar();
    }

    private View montarTela() {
        LinearLayout raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        raiz.setPadding(dp(20), dp(18), dp(20), dp(8));

        TextView titulo = texto(getString(R.string.wm_widget_escolha_tv), 18, R.color.wm_w_texto);
        titulo.setTypeface(Typeface.DEFAULT_BOLD);
        raiz.addView(titulo);

        // Linha discreta: "Atualizando a lista…" / "Sem internet: mostrando a última lista".
        status = texto("", 12, R.color.wm_w_apagado);
        status.setPadding(0, dp(4), 0, 0);
        status.setVisibility(View.GONE);
        raiz.addView(status);

        // Peso 1 com altura 0: lista comprida rola e o Cancelar continua na tela.
        rolagem = new ScrollView(this);
        lista = new LinearLayout(this);
        lista.setOrientation(LinearLayout.VERTICAL);
        lista.setPadding(0, dp(14), 0, 0);
        rolagem.addView(lista, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT));
        raiz.addView(rolagem, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        vazio = texto(getString(R.string.wm_widget_nenhuma_tv), 14, R.color.wm_w_apagado);
        vazio.setPadding(0, dp(14), 0, dp(4));
        vazio.setVisibility(View.GONE);
        raiz.addView(vazio);

        // Sem token do widget: o app é quem cria (Painel → Controle remoto).
        semToken = new LinearLayout(this);
        semToken.setOrientation(LinearLayout.VERTICAL);
        semToken.setPadding(0, dp(14), 0, 0);
        semToken.setVisibility(View.GONE);
        semToken.addView(texto(getString(R.string.wm_widget_aviso), 14, R.color.wm_w_texto));
        TextView abrir = texto(getString(R.string.wm_widget_abrir_app), 15, android.R.color.white);
        abrir.setTypeface(Typeface.DEFAULT_BOLD);
        abrir.setGravity(Gravity.CENTER);
        abrir.setMinHeight(dp(48));
        abrir.setPadding(dp(16), dp(10), dp(16), dp(10));
        abrir.setBackgroundResource(R.drawable.wm_w_botao_roxo);
        abrir.setClickable(true);
        abrir.setFocusable(true);
        abrir.setOnClickListener(v -> {
            startActivity(ControleWidget.intentDoApp(this));
            finish();
        });
        LinearLayout.LayoutParams lpAbrir = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT);
        lpAbrir.topMargin = dp(16);
        semToken.addView(abrir, lpAbrir);
        raiz.addView(semToken);

        TextView cancelar = texto(getString(R.string.wm_widget_cancelar), 14, R.color.wm_w_roxo);
        cancelar.setTypeface(Typeface.DEFAULT_BOLD);
        cancelar.setPadding(dp(14), dp(10), dp(14), dp(10));
        cancelar.setBackgroundResource(R.drawable.wm_w_toque_texto);
        cancelar.setClickable(true);
        cancelar.setFocusable(true);
        cancelar.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams lpCancelar = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT);
        lpCancelar.gravity = Gravity.END;
        lpCancelar.topMargin = dp(8);
        raiz.addView(cancelar, lpCancelar);
        return raiz;
    }

    /** Monta a tela com o que está salvo agora. */
    private void desenhar() {
        WidgetEstado e = WidgetEstado.ler(this);
        lista.removeAllViews();
        if (!e.temToken()) {   // o app ainda não criou o token do widget (ou o servidor recusou o antigo)
            rolagem.setVisibility(View.GONE);
            vazio.setVisibility(View.GONE);
            status.setVisibility(View.GONE);
            semToken.setVisibility(View.VISIBLE);
            return;
        }
        semToken.setVisibility(View.GONE);
        List<WidgetDados.Tv> tvs = e.tvs();
        for (WidgetDados.Tv tv : tvs) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = dp(8);
            lista.addView(linha(tv, tv.sessionId.equals(e.tvSid)), lp);
        }
        rolagem.setVisibility(tvs.isEmpty() ? View.GONE : View.VISIBLE);
        // Enquanto a lista nova não chega, "nenhuma TV" ainda não é verdade.
        vazio.setVisibility(tvs.isEmpty() && !buscando ? View.VISIBLE : View.GONE);
    }

    private View linha(WidgetDados.Tv tv, boolean atual) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        l.setMinimumHeight(dp(52));
        l.setPadding(dp(14), dp(10), dp(14), dp(10));
        l.setBackgroundResource(atual ? R.drawable.wm_w_linha_tv_atual : R.drawable.wm_w_linha_tv);
        l.setClickable(true);
        l.setFocusable(true);
        l.setContentDescription(atual ? getString(R.string.wm_widget_tv_atual, tv.nome) : tv.nome);
        l.setOnClickListener(v -> escolher(tv));

        ImageView icone = new ImageView(this);
        icone.setImageResource(R.drawable.wm_w_tv);
        icone.setImageTintList(ColorStateList.valueOf(getColor(atual ? R.color.wm_w_roxo : R.color.wm_w_apagado)));
        icone.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        l.addView(icone, new LinearLayout.LayoutParams(dp(22), dp(22)));

        TextView nome = texto(tv.nome, 15, R.color.wm_w_texto);
        nome.setSingleLine(true);
        nome.setEllipsize(TextUtils.TruncateAt.END);
        if (atual) nome.setTypeface(Typeface.DEFAULT_BOLD);
        nome.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        LinearLayout.LayoutParams lpNome = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lpNome.setMarginStart(dp(12));
        l.addView(nome, lpNome);

        if (atual) {   // a TV que o widget controla agora
            ImageView marca = new ImageView(this);
            marca.setImageResource(R.drawable.wm_w_check);
            marca.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            LinearLayout.LayoutParams lpMarca = new LinearLayout.LayoutParams(dp(22), dp(22));
            lpMarca.setMarginStart(dp(8));
            l.addView(marca, lpMarca);
        }
        return l;
    }

    private void escolher(WidgetDados.Tv tv) {
        WidgetEstado.salvarTv(this, tv);
        ControleWidget.atualizarTodos(this);
        finish();
    }

    // Lista nova em segundo plano. O resultado é salvo mesmo se a janelinha já fechou (a próxima abre atualizada).
    private void buscar() {
        final WidgetEstado e = WidgetEstado.ler(this);
        if (!e.temToken() || !e.temConexao()) return;   // sem como perguntar: fica a lista salva
        buscando = true;
        mostrarStatus(R.string.wm_widget_atualizando);
        final Context app = getApplicationContext();
        new Thread(() -> {
            ControleWidgetTecla.Resposta r = ControleWidgetTecla.post(e.url, e.anon, WidgetDados.corpoTvs(e.token));
            int aviso = 0;
            if (r.ok() && WidgetDados.temListaDeTvs(r.corpo)) {
                // A TV escolhida que saiu da conta sai do widget também (salvarTvs).
                WidgetEstado.salvarTvs(app, WidgetDados.lerTvs(r.corpo));
                ControleWidget.atualizarTodos(app);
            } else if (r.status == 401) {
                // Token do widget recusado: some daqui e do widget, e a janelinha pede pra abrir o app.
                if (WidgetEstado.apagarTokenSe(app, e.token)) ControleWidget.atualizarTodos(app);
            } else {
                aviso = r.semRede ? R.string.wm_widget_sem_internet_lista : R.string.wm_widget_falha_lista;
            }
            final int avisoFinal = aviso;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                buscando = false;
                if (avisoFinal != 0) mostrarStatus(avisoFinal); else status.setVisibility(View.GONE);
                desenhar();
            });
        }, "wm-widget-tvs").start();
    }

    private void mostrarStatus(int texto) {
        status.setText(texto);
        status.setVisibility(View.VISIBLE);
    }

    private TextView texto(String s, int sp, int cor) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(getColor(cor));
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
