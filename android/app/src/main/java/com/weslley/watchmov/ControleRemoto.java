package com.weslley.watchmov;

import android.view.KeyEvent;
import android.view.View;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.function.IntUnaryOperator;

/**
 * Controle remoto pelo celular (pedido dele 07/11/2026): o celular manda a tecla pela internet, o WatchMov da TV recebe
 * no web e, com o player nativo aberto, repassa pra cá (NativePlayerPlugin.remoteKey). Setas, OK e Voltar viram as
 * teclas do controle de verdade dentro do player; ⏪ ⏩ ⏯, episódio anterior/seguinte e "assistido" são ações diretas.
 * Regras puras aqui (cobertas por ControleRemotoTest); quem executa é o PlayerActivity (teclaRemota).
 */
final class ControleRemoto {
    private ControleRemoto() {}

    static final int NADA = 0, TECLA = 1, VOLTAR_10S = 2, AVANCAR_10S = 3, PLAY_PAUSE = 4, EP_ANTERIOR = 5,
        EP_SEGUINTE = 6, ASSISTIDO = 7;

    /** ⏪/⏩ do celular: o mesmo pulo das setas da TV com os controles escondidos. */
    static final long PULO_MS = 10_000;

    /**
     * Repetição das teclas sintetizadas: sempre 0 = um toque curto. O player conta como o 1º aperto (teclaTv:
     * `primeira`) e nunca como segurar (TvCursor.repeticaoDoOk só engole repetição > 0).
     */
    static final int REPETICAO = 0;

    /** O que a tecla do celular faz no player (nula ou desconhecida = NADA). */
    static int acao(String tecla) {
        if (tecla == null) return NADA;
        switch (tecla) {
            case "up": case "down": case "left": case "right": case "ok": case "back": return TECLA;
            case "rew": return VOLTAR_10S;
            case "ff": return AVANCAR_10S;
            case "playpause": return PLAY_PAUSE;
            case "prev-ep": return EP_ANTERIOR;
            case "next-ep": return EP_SEGUINTE;
            case "watched": return ASSISTIDO;
            default: return NADA;
        }
    }

    /** A tecla do controle da TV que ela imita (KeyEvent.KEYCODE_*); 0 = não é tecla do controle. */
    static int codigo(String tecla) {
        if (tecla == null) return 0;
        switch (tecla) {
            case "up": return KeyEvent.KEYCODE_DPAD_UP;
            case "down": return KeyEvent.KEYCODE_DPAD_DOWN;
            case "left": return KeyEvent.KEYCODE_DPAD_LEFT;
            case "right": return KeyEvent.KEYCODE_DPAD_RIGHT;
            case "ok": return KeyEvent.KEYCODE_DPAD_CENTER;
            case "back": return KeyEvent.KEYCODE_BACK;
            default: return 0;
        }
    }

    /** Pra onde o foco anda quando ninguém na tela usou a seta (como o Android faz com a tecla física). 0 = não é seta. */
    static int direcaoDoFoco(int codigo) {
        switch (codigo) {
            case KeyEvent.KEYCODE_DPAD_UP: return View.FOCUS_UP;
            case KeyEvent.KEYCODE_DPAD_DOWN: return View.FOCUS_DOWN;
            case KeyEvent.KEYCODE_DPAD_LEFT: return View.FOCUS_LEFT;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return View.FOCUS_RIGHT;
            default: return 0;
        }
    }

    /**
     * Episódio anterior {temporada, episódio}: o de antes na mesma temporada; no E1, o último da temporada anterior (a
     * maior das `temporadas` abaixo da atual) quando se sabe quantos episódios ela tem (`ultimoDa` → 0 = não sabe).
     * null = 1º episódio da série ou sem dados pra saber.
     */
    static int[] episodioAnterior(int temporada, int episodio, int[] temporadas, IntUnaryOperator ultimoDa) {
        if (temporada <= 0 || episodio <= 0) return null;
        if (episodio > 1) return new int[] { temporada, episodio - 1 };
        if (temporadas == null || ultimoDa == null) return null;
        int antes = 0;
        for (int t : temporadas) if (t > 0 && t < temporada && t > antes) antes = t;
        if (antes == 0) return null;
        int ultimo = ultimoDa.applyAsInt(antes);
        return ultimo > 0 ? new int[] { antes, ultimo } : null;
    }

    /**
     * Resposta do remoteState em `o`: aberto = título, posição, duração e se está tocando (temporada/episódio só em
     * série, pela chave "tmdbId:tv:temporada:ep"); fechado = só { open: false }.
     */
    static <T extends JSONObject> T estado(T o, boolean aberto, String titulo, String chave, long posMs, long durMs,
                                           boolean tocando) {
        try {
            o.put("open", aberto);
            if (!aberto) return o;
            if (titulo != null && !titulo.trim().isEmpty()) o.put("title", titulo);
            int[] te = EpisodiosDados.temporadaEpisodio(chave);
            if (te != null) { o.put("season", te[0]); o.put("episode", te[1]); }
            o.put("positionMs", Math.max(0, posMs));
            o.put("durationMs", Math.max(0, durMs));
            o.put("playing", tocando);
        } catch (JSONException ignored) {}
        return o;
    }
}
