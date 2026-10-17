package com.weslley.watchmov;

import java.util.ArrayList;
import java.util.List;

/**
 * Popup do botão do servidor (pedido dele 17/10/2026): "Abrir servidores" (a aba de servidores, como antes) e, abaixo,
 * os servidores do título ("1 · EmbedPlay" … "6 · EmbedMovies"); escolher um troca de servidor e o resolvedor abre ele.
 *
 * O app manda a lista no extra "servidores" como "id|rótulo" (ex.: "embedmovies|6 · EmbedMovies"). Lógica pura (sem
 * View), pra caber em teste JVM.
 */
final class PlayerServidores {

    static final String ABRIR_SERVIDORES = "Abrir servidores";

    /** ids[i] = servidor da linha i do popup (null = "Abrir servidores"); nomes[i] = texto da linha (✓ no atual). */
    final String[] ids, nomes;

    private PlayerServidores(List<String> ids, List<String> nomes) {
        this.ids = ids.toArray(new String[0]);
        this.nomes = nomes.toArray(new String[0]);
    }

    /** Sem servidor nenhum (APK novo com app antigo, ou episódio baixado): o botão abre a aba direto, como antes. */
    boolean soAbrirServidores() { return ids.length <= 1; }

    static PlayerServidores de(String[] extra, String atual) {
        List<String> ids = new ArrayList<>(), nomes = new ArrayList<>();
        ids.add(null);
        nomes.add(ABRIR_SERVIDORES);
        if (extra != null) {
            for (String s : extra) {
                int i = s == null ? -1 : s.indexOf('|');
                if (i <= 0 || i == s.length() - 1) continue;
                String id = s.substring(0, i);
                if (ids.contains(id)) continue;
                ids.add(id);
                nomes.add((id.equals(atual) ? "✓ " : "") + s.substring(i + 1));
            }
        }
        return new PlayerServidores(ids, nomes);
    }
}
