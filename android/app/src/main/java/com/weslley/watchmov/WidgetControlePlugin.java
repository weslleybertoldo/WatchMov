package com.weslley.watchmov;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Ponte do app (web) com o widget "Controle da TV" (pedido dele 07/11/2026). O widget não usa o login do app: o web
 * cria um token próprio do widget e grava aqui, junto com a URL/chave anon do projeto, a TV escolhida e a lista de TVs
 * da conta. Tudo responde na hora (só SharedPreferences + redesenho do widget).
 */
@CapacitorPlugin(name = "WidgetControle")
public class WidgetControlePlugin extends Plugin {

    /** { temToken, tv: {session_id, name} | null, widgets: quantos na tela inicial, suportaFixar }. */
    @PluginMethod
    public void estado(PluginCall call) {
        Context ctx = getContext();
        WidgetEstado e = WidgetEstado.ler(ctx);
        JSObject r = new JSObject();
        r.put("temToken", e.temToken());
        r.put("tv", e.temTv() ? new JSObject().put("session_id", e.tvSid).put("name", e.nomeDaTv()) : JSONObject.NULL);
        r.put("widgets", ControleWidget.quantos(ctx));
        r.put("suportaFixar", ControleWidget.suportaFixar(ctx));
        call.resolve(r);
    }

    /**
     * { url?, anon?, token?, tv?: {session_id, name} | null, tvs?: [{session_id, name}] } — grava só o que veio
     * (texto vazio ou null apaga; `tv: null` tira a TV). Lista nova sem a TV atual = a TV atual sai também.
     */
    @PluginMethod
    public void salvar(PluginCall call) {
        Context ctx = getContext();
        JSObject d = call.getData();
        for (String chave : new String[] { WidgetEstado.K_URL, WidgetEstado.K_ANON, WidgetEstado.K_TOKEN }) {
            if (d.has(chave)) WidgetEstado.salvarTexto(ctx, chave, d.isNull(chave) ? null : d.optString(chave, null));
        }
        if (d.has("tv")) {
            if (d.isNull("tv")) {
                WidgetEstado.salvarTv(ctx, null);
            } else {
                WidgetDados.Tv tv = WidgetDados.tvDe(d.optJSONObject("tv"));
                if (tv != null) WidgetEstado.salvarTv(ctx, tv);   // objeto sem session_id: ignora
            }
        }
        // Depois da TV: assim `salvar({ tv, tvs })` confere a TV nova contra a lista nova.
        JSONArray tvs = d.optJSONArray("tvs");
        if (tvs != null) WidgetEstado.salvarTvs(ctx, WidgetDados.lerTvs(tvs.toString()));
        ControleWidget.atualizarTodos(ctx);
        call.resolve(new JSObject().put("ok", true));
    }

    /** Sair da conta: apaga TUDO e devolve { token } (o que estava salvo, ou null) pro web revogar no servidor. */
    @PluginMethod
    public void limpar(PluginCall call) {
        Context ctx = getContext();
        String token = WidgetEstado.limpar(ctx);
        ControleWidget.atualizarTodos(ctx);
        call.resolve(new JSObject().put("token", token != null ? token : JSONObject.NULL));
    }

    /** Pede ao launcher pra pôr o widget na tela inicial → { ok } (false se o launcher não aceita, ou na TV). */
    @PluginMethod
    public void fixar(PluginCall call) {
        call.resolve(new JSObject().put("ok", ControleWidget.fixar(getContext())));
    }
}
