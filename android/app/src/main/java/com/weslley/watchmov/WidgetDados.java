package com.weslley.watchmov;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;

/**
 * Widget "Controle da TV" na tela inicial (pedido dele 07/11/2026): os botões do Controle remoto funcionam SEM abrir o
 * app. O widget não usa o login do app: o app cria um token próprio do widget e grava no nativo (WidgetControlePlugin);
 * cada toque chama a edge function `tv-remote` com esse token (ControleWidgetTecla), que entrega a tecla no canal da
 * conta. Regras puras aqui (cobertas por WidgetDadosTest); quem guarda é o WidgetEstado e quem desenha, o ControleWidget.
 */
final class WidgetDados {
    private WidgetDados() {}

    /** Uma TV da conta: a sessão dela no Supabase (wm_tv_devices.session_id) e o nome que aparece no widget. */
    static final class Tv {
        final String sessionId;
        final String nome;

        Tv(String sessionId, String nome) { this.sessionId = sessionId; this.nome = nome; }
    }

    /**
     * Tecla que esperou mais que isso na fila não vai mais: com a rede travada, ela chegaria na TV muito depois do
     * toque e mexeria no que a pessoa já está vendo ("tecla fantasma").
     */
    static final long VELHA_MS = 4000;

    /** As teclas que a edge function aceita: as do Controle remoto do app, sem o "segurar o OK" (o widget só toca). */
    private static final String[] TECLAS = { "up", "down", "left", "right", "ok", "back", "home", "rew", "ff",
        "playpause", "prev-ep", "next-ep", "watched" };

    static boolean teclaValida(String tecla) {
        if (tecla == null) return false;
        for (String t : TECLAS) if (t.equals(tecla)) return true;
        return false;
    }

    /** Endereço da edge function a partir da URL do projeto que o app gravou (com ou sem a barra no fim). */
    static String endereco(String url) {
        String base = url == null ? "" : url.trim();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base + "/functions/v1/tv-remote";
    }

    /** Corpo do POST de uma tecla pra TV `to`. */
    static String corpoTecla(String token, String to, String tecla) {
        JSONObject o = new JSONObject();
        try {
            o.put("action", "key");
            o.put("token", token);
            o.put("to", to);
            o.put("key", tecla);
        } catch (JSONException ignored) {}
        return o.toString();
    }

    /** Corpo do POST que pede a lista de TVs da conta (janelinha Trocar TV). */
    static String corpoTvs(String token) {
        JSONObject o = new JSONObject();
        try {
            o.put("action", "tvs");
            o.put("token", token);
        } catch (JSONException ignored) {}
        return o.toString();
    }

    /**
     * Lista de TVs: aceita a que o widget guarda ([{"session_id","name"}]) e a resposta da edge function
     * ({"devices":[...]}). Item sem session_id fica de fora; sem nome vira "TV". JSON quebrado = lista vazia.
     */
    static List<Tv> lerTvs(String json) {
        List<Tv> tvs = new ArrayList<>();
        JSONArray itens = lista(json);
        if (itens == null) return tvs;
        for (int i = 0; i < itens.length(); i++) {
            Tv tv = tvDe(itens.optJSONObject(i));
            if (tv != null) tvs.add(tv);
        }
        return tvs;
    }

    /**
     * A resposta do servidor trouxe mesmo a lista ({"devices":[...]})? Um 200 com outra coisa (página de erro de
     * proxy, JSON torto) não pode apagar a lista salva nem tirar a TV escolhida.
     */
    static boolean temListaDeTvs(String json) {
        try {
            Object v = json == null ? null : new JSONTokener(json).nextValue();
            return v instanceof JSONObject && ((JSONObject) v).optJSONArray("devices") != null;
        } catch (Exception e) {
            return false;
        }
    }

    private static JSONArray lista(String json) {
        if (json == null || json.trim().isEmpty()) return null;
        try {
            Object v = new JSONTokener(json).nextValue();
            if (v instanceof JSONArray) return (JSONArray) v;
            if (v instanceof JSONObject) return ((JSONObject) v).optJSONArray("devices");
        } catch (Exception ignored) {}
        return null;
    }

    /** Uma TV de um objeto {"session_id","name"} (o que o app manda e o que o servidor devolve); null sem session_id. */
    static Tv tvDe(JSONObject o) {
        if (o == null) return null;
        String sid = texto(o, "session_id");
        if (sid.isEmpty()) return null;
        String nome = texto(o, "name");
        return new Tv(sid, nome.isEmpty() ? "TV" : nome);
    }

    // optString do Android devolve "null" (texto) pra um null do JSON: o isNull antes evita a TV "null".
    private static String texto(JSONObject o, String chave) {
        return o.isNull(chave) ? "" : o.optString(chave, "").trim();
    }

    /** Lista → o JSON que o widget guarda ([{"session_id","name"}]). */
    static String tvsParaJson(List<Tv> tvs) {
        JSONArray arr = new JSONArray();
        if (tvs != null) {
            for (Tv tv : tvs) {
                if (tv == null || tv.sessionId == null || tv.sessionId.isEmpty()) continue;
                JSONObject o = new JSONObject();
                try {
                    o.put("session_id", tv.sessionId);
                    o.put("name", tv.nome);
                } catch (JSONException ignored) {}
                arr.put(o);
            }
        }
        return arr.toString();
    }

    /** A TV `sid` da lista (null se não está). */
    static Tv achar(List<Tv> tvs, String sid) {
        if (tvs == null || sid == null) return null;
        for (Tv tv : tvs) if (tv != null && sid.equals(tv.sessionId)) return tv;
        return null;
    }

    static boolean contem(List<Tv> tvs, String sid) {
        return achar(tvs, sid) != null;
    }

    /**
     * Falha de rede que é falta de internet (sem DNS, sem rota, conexão recusada). Tempo esgotado fica de fora: com a
     * internet ruim ou o servidor lento, "sem internet" seria mentira.
     */
    static boolean semRede(Throwable e) {
        return e instanceof UnknownHostException || e instanceof ConnectException || e instanceof NoRouteToHostException;
    }

    /** Texto curto do Toast quando a tecla não foi. */
    static String mensagemDeErro(int status, boolean semRede) {
        if (semRede) return "Sem internet: a tecla não foi enviada";
        if (status == 401) return "Abra o WatchMov e escolha a TV no Controle remoto";   // token apagado: o app cria outro
        if (status == 400) return "Escolha a TV de novo em Trocar TV";                   // TV que saiu da conta
        return "Não deu pra falar com a TV agora";
    }

    /** A tecla esperou na fila mais que VELHA_MS (relógio monotônico: elapsedRealtime)? Então não vai. */
    static boolean velha(long enfileiradaEm, long agora) {
        return agora - enfileiradaEm > VELHA_MS;
    }
}
