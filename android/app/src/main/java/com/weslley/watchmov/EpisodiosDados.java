package com.weslley.watchmov;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Dados do painel "Episódios" do player (pedido dele 06/11/2026: "na barra inferior … a opção de abrir os EPS no caso
 * de séries … o foco abre no EP atual e aparecem os assistidos … e os próximos eps").
 *
 * Com o player na frente, a página do app fica CONGELADA (medido no emulador: os pedidos pro JS só eram respondidos nos
 * primeiros segundos). Por isso o app manda tudo o que só ele sabe JÁ NA ABERTURA, num JSON (Serie): a série na TMDB, a
 * chave e, por temporada, o total, a duração padrão, os assistidos e o progresso de quem parou no meio —
 * {"tmdb":2691,"chave":"…","temporadas":[{"n":5,"total":19,"min":22,"vistos":[15],"pct":{"16":12}}]}. Nome, frame,
 * duração e data de cada episódio o próprio player busca na TMDB (temporada/N), quando a temporada abre (montar).
 * Regras puras aqui (cobertas por EpisodiosDadosTest); a tela é o EpisodiosPainel.
 */
final class EpisodiosDados {

    static final class Ep {
        final int numero;
        final String nome;
        final String imagem;      // frame do episódio (TMDB w300) ou null
        final int minutos;        // duração (0 = sem)
        boolean visto;
        int pct;                  // progresso 0–100 de quem ainda não terminou (0 = sem barra)
        final String emBreve;     // "Em breve 12/09" (ainda não foi ao ar) ou null

        Ep(int numero, String nome, String imagem, int minutos, boolean visto, int pct, String emBreve) {
            this.numero = numero; this.nome = nome; this.imagem = imagem; this.minutos = minutos;
            this.visto = visto; this.pct = pct; this.emBreve = emBreve;
        }
    }

    /** Uma temporada do jeito que o app vê na abertura do player. */
    static final class Temporada {
        final int numero, total, minutos;
        final Set<Integer> vistos;
        final Map<Integer, Integer> pct;

        Temporada(int numero, int total, int minutos, Set<Integer> vistos, Map<Integer, Integer> pct) {
            this.numero = numero; this.total = total; this.minutos = minutos; this.vistos = vistos; this.pct = pct;
        }
    }

    /** A série inteira, como o app mandou na abertura (EXTRA_EPISODIOS). */
    static final class Serie {
        final long tmdb;
        final String chave;
        final int[] numeros;
        final Map<Integer, Temporada> temporadas;

        Serie(long tmdb, String chave, int[] numeros, Map<Integer, Temporada> temporadas) {
            this.tmdb = tmdb; this.chave = chave; this.numeros = numeros; this.temporadas = temporadas;
        }
    }

    final int temporada;
    final int[] temporadas;
    final List<Ep> eps;

    EpisodiosDados(int temporada, int[] temporadas, List<Ep> eps) {
        this.temporada = temporada; this.temporadas = temporadas; this.eps = eps;
    }

    /** JSON da abertura → Serie. Sem série/temporadas ou inválido = null (o botão não aparece). */
    static Serie serieDoApp(String json) {
        if (json == null || json.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(json);
            long tmdb = o.optLong("tmdb", 0);
            JSONArray ts = o.optJSONArray("temporadas");
            if (tmdb <= 0 || ts == null || ts.length() == 0) return null;
            Map<Integer, Temporada> mapa = new HashMap<>();
            List<Integer> numeros = new ArrayList<>();
            for (int i = 0; i < ts.length(); i++) {
                JSONObject t = ts.optJSONObject(i);
                if (t == null || t.optInt("n", 0) <= 0) continue;
                int n = t.optInt("n");
                Set<Integer> vistos = new HashSet<>();
                JSONArray v = t.optJSONArray("vistos");
                if (v != null) for (int k = 0; k < v.length(); k++) vistos.add(v.optInt(k));
                Map<Integer, Integer> pct = new HashMap<>();
                JSONObject p = t.optJSONObject("pct");
                if (p != null) for (java.util.Iterator<String> it = p.keys(); it.hasNext();) {
                    String k = it.next();
                    try { pct.put(Integer.parseInt(k), Math.max(0, Math.min(100, p.optInt(k)))); } catch (NumberFormatException ignored) {}
                }
                mapa.put(n, new Temporada(n, Math.max(0, t.optInt("total", 0)), Math.max(0, t.optInt("min", 0)), vistos, pct));
                numeros.add(n);
            }
            if (numeros.isEmpty()) return null;
            int[] arr = new int[numeros.size()];
            for (int i = 0; i < arr.length; i++) arr[i] = numeros.get(i);
            return new Serie(tmdb, o.optString("chave", ""), arr, mapa);
        } catch (Exception ex) {
            return null;
        }
    }

    /** Endereço da temporada na TMDB (pt-BR). */
    static String urlDaTemporada(Serie s, int temporada) {
        return String.format(Locale.ROOT, "https://api.themoviedb.org/3/tv/%d/season/%d?api_key=%s&language=pt-BR",
            s.tmdb, temporada, s.chave == null ? "" : s.chave);
    }

    /**
     * A lista de uma temporada: os episódios da TMDB (`tmdbJson`, null = sem rede: só número, assistido e progresso)
     * com os assistidos e o progresso que o app mandou. `hoje` = "aaaa-mm-dd" (o "Em breve" compara com ele).
     */
    static EpisodiosDados montar(Serie s, int temporada, String tmdbJson, String hoje) {
        Temporada t = s.temporadas.get(temporada);
        Map<Integer, JSONObject> info = new HashMap<>();
        int maior = 0;
        if (tmdbJson != null) try {
            JSONArray arr = new JSONObject(tmdbJson).optJSONArray("episodes");
            if (arr != null) for (int i = 0; i < arr.length(); i++) {
                JSONObject e = arr.optJSONObject(i);
                if (e == null || e.optInt("episode_number", 0) <= 0) continue;
                info.put(e.optInt("episode_number"), e);
                maior = Math.max(maior, e.optInt("episode_number"));
            }
        } catch (Exception ignored) {}
        int total = Math.max(t != null ? t.total : 0, maior);
        List<Ep> eps = new ArrayList<>();
        for (int n = 1; n <= total; n++) {
            JSONObject e = info.get(n);
            String nome = e != null ? texto(e, "name") : null;
            String still = e != null ? texto(e, "still_path") : null;
            int min = e != null ? Math.max(0, e.optInt("runtime", 0)) : 0;
            if (min == 0 && t != null) min = t.minutos;
            boolean visto = t != null && t.vistos.contains(n);
            Integer p = t != null ? t.pct.get(n) : null;
            String air = e != null ? texto(e, "air_date") : null;
            eps.add(new Ep(n, nome, still != null ? "https://image.tmdb.org/t/p/w300" + still : null, min, visto,
                visto || p == null ? 0 : p, emBreve(air, hoje)));
        }
        return new EpisodiosDados(temporada, s.numeros, eps);
    }

    /** "2026-12-12" depois de hoje → "Em breve 12/12" (outro ano: "Em breve 05/01/27"); já saiu ou sem data = null. */
    static String emBreve(String air, String hoje) {
        if (air == null || hoje == null || !air.matches("\\d{4}-\\d{2}-\\d{2}") || air.compareTo(hoje) <= 0) return null;
        String data = air.substring(8, 10) + "/" + air.substring(5, 7);
        return "Em breve " + (air.substring(0, 4).equals(hoje.substring(0, 4)) ? data : data + "/" + air.substring(2, 4));
    }

    private static String texto(JSONObject o, String k) {
        if (!o.has(k) || o.isNull(k)) return null;
        String s = o.optString(k, "");
        return s.isEmpty() ? null : s;
    }

    /** Posição do episódio na lista (-1 = não tem). */
    int indiceDo(int episodio) {
        for (int i = 0; i < eps.size(); i++) if (eps.get(i).numero == episodio) return i;
        return -1;
    }

    /**
     * Card que recebe o foco ao abrir: na temporada do episódio que está tocando, ele; nas outras, o 1º não
     * assistido (quem vai pra T2 quer o próximo a ver); tudo assistido ou lista vazia = o primeiro.
     */
    int indiceInicial(int temporadaAtual, int episodioAtual) {
        if (temporada == temporadaAtual) {
            int i = indiceDo(episodioAtual);
            if (i >= 0) return i;
        }
        for (int i = 0; i < eps.size(); i++) if (!eps.get(i).visto) return i;
        return 0;
    }

    /** Primeiro card à vista ao abrir: até 3 antes do focado, pra aparecerem os assistidos antes dele. */
    static int primeiroVisivel(int foco) { return Math.max(0, foco - 3); }

    /** Linha de baixo do card. `atual` = é o que está tocando; `posMs` = onde ele está agora. */
    static String info(Ep e, boolean atual, long posMs) {
        if (atual && !e.visto) return "Parou em " + relogio(posMs);
        if (e.visto) return "✓ Assistido";
        if (e.emBreve != null) return e.emBreve;
        return e.minutos > 0 ? "E" + e.numero + " · " + e.minutos + " min" : "Episódio " + e.numero;
    }

    /** 125000 ms → "02:05"; 1 h → "1:00:00". */
    static String relogio(long ms) {
        long s = Math.max(0, ms / 1000);
        long h = s / 3600, m = (s / 60) % 60, seg = s % 60;
        return h > 0 ? String.format(Locale.ROOT, "%d:%02d:%02d", h, m, seg)
            : String.format(Locale.ROOT, "%02d:%02d", m, seg);
    }

    /** "tmdbId:tv:temporada:ep" → {temporada, ep}; filme ou chave estranha = null. */
    static int[] temporadaEpisodio(String chave) {
        if (chave == null) return null;
        String[] p = chave.split(":");
        if (p.length < 4 || !"tv".equals(p[1])) return null;
        try {
            int t = Integer.parseInt(p[2]), e = Integer.parseInt(p[3]);
            return t > 0 && e > 0 ? new int[] { t, e } : null;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /** "Hunter x Hunter — T1 E4" → "Hunter x Hunter" (o título que o app manda pro player). */
    static String serieDoTitulo(String titulo) {
        if (titulo == null) return "";
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^(.*?)\\s+[—–-]\\s+T\\d+\\s+E\\d+\\s*$").matcher(titulo);
        return m.find() ? m.group(1).trim() : titulo.trim();
    }
}
