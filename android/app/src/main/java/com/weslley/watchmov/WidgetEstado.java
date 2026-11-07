package com.weslley.watchmov;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.List;

/**
 * O que o widget "Controle da TV" sabe (SharedPreferences privado `wm_widget_controle`): URL e chave anon do projeto, o
 * token PRÓPRIO do widget (o app cria e grava pelo WidgetControlePlugin; não é o login do app), a TV escolhida e a
 * última lista de TVs da conta. Tudo `synchronized`: o plugin, o receiver das teclas e a janelinha Trocar TV mexem aqui
 * de threads diferentes, e "apagar o token se ainda for o mesmo" precisa ler e gravar de uma vez só.
 */
final class WidgetEstado {

    static final String PREFS = "wm_widget_controle";
    static final String K_URL = "url", K_ANON = "anon", K_TOKEN = "token", K_TV_SID = "tv_sid", K_TV_NOME = "tv_nome",
        K_TVS = "tvs";

    final String url, anon, token, tvSid, tvNome, tvsJson;

    private WidgetEstado(SharedPreferences p) {
        url = p.getString(K_URL, null);
        anon = p.getString(K_ANON, null);
        token = p.getString(K_TOKEN, null);
        tvSid = p.getString(K_TV_SID, null);
        tvNome = p.getString(K_TV_NOME, null);
        tvsJson = p.getString(K_TVS, null);
    }

    boolean temToken() { return tem(token); }

    /** Tem com quem falar (URL do projeto + chave anon)? */
    boolean temConexao() { return tem(url) && tem(anon); }

    boolean temTv() { return tem(tvSid); }

    /** Pronto pra mandar tecla: token, URL, chave e TV. Senão o widget mostra o aviso de abrir o app. */
    boolean configurado() { return temToken() && temConexao() && temTv(); }

    /** Nome da TV escolhida pro cabeçalho (nunca vazio). */
    String nomeDaTv() { return tem(tvNome) ? tvNome : "TV"; }

    List<WidgetDados.Tv> tvs() { return WidgetDados.lerTvs(tvsJson); }

    private static boolean tem(String s) { return s != null && !s.trim().isEmpty(); }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized WidgetEstado ler(Context ctx) {
        return new WidgetEstado(prefs(ctx));
    }

    /** url / anon / token: grava o texto; null ou vazio apaga a chave. */
    static synchronized void salvarTexto(Context ctx, String chave, String valor) {
        SharedPreferences.Editor ed = prefs(ctx).edit();
        if (tem(valor)) ed.putString(chave, valor.trim()); else ed.remove(chave);
        ed.apply();
    }

    /** TV escolhida; null tira a escolha (o widget volta a pedir pra escolher). */
    static synchronized void salvarTv(Context ctx, WidgetDados.Tv tv) {
        SharedPreferences.Editor ed = prefs(ctx).edit();
        if (tv == null || !tem(tv.sessionId)) ed.remove(K_TV_SID).remove(K_TV_NOME);
        else ed.putString(K_TV_SID, tv.sessionId).putString(K_TV_NOME, tem(tv.nome) ? tv.nome : "TV");
        ed.apply();
    }

    /**
     * Lista nova de TVs da conta. A TV escolhida que sumiu dela (desconectada no app) sai junto; a que continua pega o
     * nome da lista (renomeada no app = o cabeçalho do widget acompanha).
     */
    static synchronized void salvarTvs(Context ctx, List<WidgetDados.Tv> tvs) {
        SharedPreferences p = prefs(ctx);
        SharedPreferences.Editor ed = p.edit().putString(K_TVS, WidgetDados.tvsParaJson(tvs));
        String sid = p.getString(K_TV_SID, null);
        if (sid != null) {
            WidgetDados.Tv atual = WidgetDados.achar(tvs, sid);
            if (atual == null) ed.remove(K_TV_SID).remove(K_TV_NOME);
            else ed.putString(K_TV_NOME, atual.nome);
        }
        ed.apply();
    }

    /**
     * O servidor recusou o token (401): apaga — mas só se ainda for o que foi usado. Se o app gravou um token novo
     * enquanto a tecla ia, o novo fica. true = apagou (o widget precisa redesenhar).
     */
    static synchronized boolean apagarTokenSe(Context ctx, String tokenUsado) {
        SharedPreferences p = prefs(ctx);
        String atual = p.getString(K_TOKEN, null);
        if (atual == null || !atual.equals(tokenUsado)) return false;
        p.edit().remove(K_TOKEN).apply();
        return true;
    }

    /** Apaga TUDO (sair da conta no app). Devolve o token que estava salvo, pro app revogar no servidor. */
    static synchronized String limpar(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String token = p.getString(K_TOKEN, null);
        p.edit().clear().apply();
        return token;
    }
}
