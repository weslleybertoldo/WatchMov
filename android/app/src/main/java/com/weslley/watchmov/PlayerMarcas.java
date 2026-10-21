package com.weslley.watchmov;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Player novo (17/10/2026): marcas do episódio (abertura, resumo e créditos) e as regras que dependem delas.
 *
 * As marcas vêm da TheIntroDB (`api.theintrodb.org`, a mesma base que o BingeBang usa) pela chave do episódio
 * ("tmdbId:tv:temporada:ep"), completadas pela IntroDB (`api.introdb.app`, pelo IMDb da série) desde 18/10/2026.
 * Regras pedidas por ele:
 * - "Pular abertura"/"Pular resumo" enquanto a posição está dentro do trecho.
 * - Próximo episódio: com os créditos mapeados a contagem de 10 s começa neles; sem mapa ela aparece faltando 40 s
 *   ("Faltando 40s aparece o popup de 10s e faltando 30 ele pausa, marca como assistido e pula o eps").
 * - Voltar com os botões na tela só esconde; com eles escondidos, sai (só na TV).
 *
 * Lógica pura (sem View), pra caber em teste JVM.
 */
final class PlayerMarcas {

    static final int NENHUM = 0, ABERTURA = 1, RESUMO = 2;
    /** Contagem do próximo episódio. */
    static final long CONTAGEM_MS = 10_000;
    /** Sem créditos mapeados a contagem aparece faltando 40 s (e o pulo cai faltando 30 s). */
    static final long SEM_MAPA_FALTANDO_MS = 40_000;
    /** O botão "Pular" some 1 s antes do fim do trecho (pular pra 1 s à frente não vale o toque). */
    static final long MARGEM_FIM_PULO_MS = 1_000;

    private static final long[][] NADA = new long[0][];
    static final PlayerMarcas VAZIO = new PlayerMarcas(NADA, NADA, NADA);

    /** Trechos {início, fim} em ms; fim = -1 quando vai até o fim do vídeo. */
    final long[][] abertura, resumo, creditos;

    PlayerMarcas(long[][] abertura, long[][] resumo, long[][] creditos) {
        this.abertura = abertura; this.resumo = resumo; this.creditos = creditos;
    }

    boolean vazio() { return abertura.length == 0 && resumo.length == 0 && creditos.length == 0; }

    /** Resposta da TheIntroDB → marcas. Episódio sem mapa (404 `{"error":…}`) ou JSON torto = VAZIO. */
    static PlayerMarcas deJson(String json) {
        if (json == null || json.isEmpty()) return VAZIO;
        try {
            JSONObject o = new JSONObject(json);
            return new PlayerMarcas(trechos(o.optJSONArray("intro")), trechos(o.optJSONArray("recap")),
                trechos(o.optJSONArray("credits")));
        } catch (Exception e) {
            return VAZIO;
        }
    }

    /**
     * Resposta da IntroDB (`api.introdb.app/segments`, 18/10/2026) → marcas. Lá cada trecho é UM objeto (ou null) e os
     * créditos se chamam "outro". Episódio sem mapa (404) ou JSON torto = VAZIO.
     */
    static PlayerMarcas deIntroDb(String json) {
        if (json == null || json.isEmpty()) return VAZIO;
        try {
            JSONObject o = new JSONObject(json);
            return new PlayerMarcas(trechoUnico(o, "intro"), trechoUnico(o, "recap"), trechoUnico(o, "outro"));
        } catch (Exception e) {
            return VAZIO;
        }
    }

    private static long[][] trechoUnico(JSONObject o, String nome) {
        JSONObject t = o.optJSONObject(nome);
        return t == null ? NADA : trechos(new JSONArray().put(t));
    }

    /**
     * Junta as 2 bases (pedido dele 18/10/2026: a Lanternas T1E5 não tinha créditos na TheIntroDB e ficou sem o popup;
     * a IntroDB tinha). Por trecho: vale o da TheIntroDB (a base de antes) e a IntroDB completa o que faltar.
     */
    static PlayerMarcas juntar(PlayerMarcas theIntroDb, PlayerMarcas introDb) {
        return new PlayerMarcas(
            theIntroDb.abertura.length > 0 ? theIntroDb.abertura : introDb.abertura,
            theIntroDb.resumo.length > 0 ? theIntroDb.resumo : introDb.resumo,
            theIntroDb.creditos.length > 0 ? theIntroDb.creditos : introDb.creditos);
    }

    // `start_ms` nulo = desde o começo; `end_ms` nulo = até o fim. Trecho sem tamanho é descartado.
    private static long[][] trechos(JSONArray a) {
        if (a == null) return NADA;
        ArrayList<long[]> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) {
            JSONObject t = a.optJSONObject(i);
            if (t == null) continue;
            long ini = t.isNull("start_ms") ? 0 : t.optLong("start_ms", -1);
            long fim = t.isNull("end_ms") ? -1 : t.optLong("end_ms", -2);
            if (ini < 0 || fim == -2 || (fim >= 0 && fim <= ini)) continue;
            out.add(new long[]{ ini, fim });
        }
        return out.toArray(NADA);
    }

    /** ABERTURA/RESUMO quando a posição está num trecho que dá pra pular; senão NENHUM. */
    int tipoDoPulo(long posMs) {
        if (dentro(abertura, posMs)) return ABERTURA;
        if (dentro(resumo, posMs)) return RESUMO;
        return NENHUM;
    }

    /** Pra onde o "Pular" leva (fim do trecho em que a posição está); -1 se não há o que pular. */
    long fimDoPulo(long posMs) {
        long f = fim(abertura, posMs);
        return f >= 0 ? f : fim(resumo, posMs);
    }

    // Trecho sem fim conhecido não vira "Pular": não dá pra saber pra onde ir.
    private static boolean dentro(long[][] ts, long pos) { return fim(ts, pos) >= 0; }

    private static long fim(long[][] ts, long pos) {
        for (long[] t : ts) if (t[1] > 0 && pos >= t[0] && pos < t[1] - MARGEM_FIM_PULO_MS) return t[1];
        return -1;
    }

    /**
     * Onde a contagem do próximo episódio começa: no início dos créditos quando eles estão mapeados e fazem sentido
     * (depois da metade e cabendo os 10 s antes do fim); senão faltando 40 s. -1 = vídeo curto demais.
     */
    long inicioDaContagem(long durMs) {
        if (durMs <= SEM_MAPA_FALTANDO_MS * 2) return -1;
        for (long[] c : creditos) if (c[0] >= durMs / 2 && c[0] <= durMs - CONTAGEM_MS) return c[0];
        return durMs - SEM_MAPA_FALTANDO_MS;
    }

    /** Já chegou no trecho da contagem (créditos ou últimos 40 s)? Aí o ⏭ vale o "Assistir agora" (marca assistido). */
    boolean naJanelaDaContagem(long posMs, long durMs) {
        long ini = inicioDaContagem(durMs);
        return ini >= 0 && posMs >= ini;
    }

    /** Pedir o próximo faltando até isso também marca o atual como assistido (fora da contagem). */
    static final long PROXIMO_MARCA_FALTANDO_MS = 120_000;

    /**
     * O pedido do próximo episódio marca o atual como assistido? Na contagem (créditos ou últimos 40 s) ou faltando
     * até 2 min (pedido dele 20/10/2026: apertava "próx eps" nos créditos de Dois Homens e Meio, que não tem créditos
     * mapeados, com pouco mais de 1 min faltando — o ep ficava sem ✓). Antes disso pular não é ter assistido.
     */
    boolean proximoMarcaAssistido(long posMs, long durMs) {
        if (naJanelaDaContagem(posMs, durMs)) return true;
        return durMs > PROXIMO_MARCA_FALTANDO_MS && posMs >= durMs - PROXIMO_MARCA_FALTANDO_MS;
    }

    /** O "Assistido" sem próximo episódio pula pra faltar 1 min (como sempre foi). */
    static final long ASSISTIDO_FALTANDO_MS = 60_000;

    /**
     * Pra onde o "Assistido" pula (-1 = fica onde está; nunca volta pra trás). Com próximo episódio vai pro ponto da
     * contagem (créditos ou faltando 40 s) e o popup de 10 s abre na hora (pedido dele 18/10/2026: "clicar em assistido
     * avançar para 40s e abrir o popup de 10s", com os créditos seguindo e, no zero, pausa e passa). Sem próximo
     * (filme, último ep da temporada), faltando 1 min.
     */
    long pontoDoAssistido(long posMs, long durMs, boolean comPopup) {
        long alvo = comPopup ? inicioDaContagem(durMs) : -1;
        if (alvo < 0 && durMs > ASSISTIDO_FALTANDO_MS) alvo = durMs - ASSISTIDO_FALTANDO_MS;
        return alvo > posMs ? alvo : -1;
    }

    /** tmdbId, temporada e episódio da chave "tmdbId:tv:temporada:ep"; null se não é episódio de série. */
    static long[] chaveDeSerie(String chave) {
        if (chave == null) return null;
        String[] p = chave.split(":");
        if (p.length != 4 || !"tv".equals(p[1])) return null;
        try {
            long id = Long.parseLong(p[0]), temp = Long.parseLong(p[2]), ep = Long.parseLong(p[3]);
            return id > 0 && temp >= 0 && ep > 0 ? new long[]{ id, temp, ep } : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static String urlDaApi(long[] serie) {
        return String.format(Locale.ROOT, "https://api.theintrodb.org/v3/media?tmdb_id=%d&season=%d&episode=%d",
            serie[0], serie[1], serie[2]);
    }

    /** IntroDB pelo IMDb da série (ela não aceita o id do TMDB); null quando o id não tem a cara "tt123…". */
    static String urlDaIntroDb(String imdbId, long[] serie) {
        if (imdbId == null || !imdbId.matches("tt\\d+")) return null;
        return String.format(Locale.ROOT, "https://api.introdb.app/segments?imdb_id=%s&season=%d&episode=%d",
            imdbId, serie[1], serie[2]);
    }

    // ── Voltar ─────────────────────────────────────────────────────────────────────────────────────────────
    static final int VOLTAR_SAI = 0, VOLTAR_FECHA_PAINEL = 1, VOLTAR_CANCELA_CONTAGEM = 2, VOLTAR_ESCONDE_CONTROLES = 3;

    /** O que o "voltar" faz agora. Esconder os controles é só na TV e sem espelhar (o overlay do cast tem os dele). */
    static int acaoDoVoltar(boolean painelAberto, boolean contagemNaTela, boolean controlesNaTela, boolean naTv,
                            boolean espelhando) {
        if (painelAberto) return VOLTAR_FECHA_PAINEL;
        if (contagemNaTela) return VOLTAR_CANCELA_CONTAGEM;
        if (naTv && controlesNaTela && !espelhando) return VOLTAR_ESCONDE_CONTROLES;
        return VOLTAR_SAI;
    }

    // ── Contagem do próximo episódio ───────────────────────────────────────────────────────────────────────
    static final int CONTAGEM_NADA = 0, CONTAGEM_MOSTRAR = 1, CONTAGEM_ATUALIZAR = 2, CONTAGEM_ESCONDER = 3,
        CONTAGEM_PULAR = 4;

    /** Estado da contagem de UM episódio (episódio novo = Contagem nova). */
    static final class Contagem {
        boolean visivel, cancelada, disparou;
        long restanteMs = CONTAGEM_MS;
        private long ultimoMs = -1;

        /**
         * Um tique (~2×/s). Só desconta enquanto o vídeo toca (pausou = a contagem para). Voltou pra antes do início
         * = rearma (inclusive depois de cancelar). Vídeo acabou com a contagem na tela = pula na hora.
         */
        int tique(long posMs, long inicioMs, boolean tocando, boolean acabou, long agoraMs) {
            if (disparou || inicioMs < 0) return CONTAGEM_NADA;
            if (posMs < inicioMs - 2_000) {
                boolean estava = visivel;
                visivel = false; cancelada = false; restanteMs = CONTAGEM_MS; ultimoMs = -1;
                return estava ? CONTAGEM_ESCONDER : CONTAGEM_NADA;
            }
            if (cancelada || posMs < inicioMs) return CONTAGEM_NADA;
            if (!visivel) {
                visivel = true; restanteMs = CONTAGEM_MS; ultimoMs = agoraMs;
                if (!acabou) return CONTAGEM_MOSTRAR;
            }
            if (tocando && ultimoMs >= 0) restanteMs -= Math.max(0, agoraMs - ultimoMs);
            ultimoMs = agoraMs;
            if (restanteMs <= 0 || acabou) { disparou = true; visivel = false; return CONTAGEM_PULAR; }
            return CONTAGEM_ATUALIZAR;
        }

        /** Segundos que aparecem no botão (arredonda pra cima: 9,1 s mostra 10). */
        int segundos() { return (int) Math.max(0, (restanteMs + 999) / 1000); }

        void cancelar() { cancelada = true; visivel = false; }

        void pularAgora() { disparou = true; visivel = false; }

        /** "Assistido" leva pro ponto da contagem: abre de novo mesmo se ele tinha cancelado antes (na tela, segue). */
        void rearmar() {
            if (disparou || visivel) return;
            cancelada = false; visivel = false; restanteMs = CONTAGEM_MS; ultimoMs = -1;
        }
    }
}
