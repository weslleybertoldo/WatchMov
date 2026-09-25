package com.weslley.watchmov;

/**
 * Qualidade que chega com o player JÁ aberto (25/09/2026, ABYS): a 1ª qualidade medida abre o filme e as
 * atrasadas entram depois no menu. Decisão dele ("1"): se a nova for MAIOR que a que está tocando, troca sozinho.
 * Só entra na lista do link que está tocando se for do MESMO motor (/abyss/&lt;sid&gt;/) — outra sessão não serve.
 * Puro (testável na JVM).
 */
final class LiveQuality {
    private LiveQuality() {}

    /** "1080p" → 1080; rótulo sem número → 0. */
    static int height(String label) {
        if (label == null) return 0;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d{3,4})p").matcher(label);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }

    /** Sessão do motor na URL `http://127.0.0.1:PORT/abyss/<sid>/720p.mp4`; null se não for /abyss/. */
    static String abyssSid(String url) {
        if (url == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("/abyss/([A-Za-z0-9_-]+)/\\d{3,4}p\\.mp4").matcher(url);
        return m.find() ? m.group(1) : null;
    }

    /** A qualidade nova pertence ao mesmo motor do link que está tocando? */
    static boolean sameEngine(String currentUrl, String newUrl) {
        String a = abyssSid(currentUrl), b = abyssSid(newUrl);
        return a != null && a.equals(b);
    }

    /** Troca sozinho? Só se a nova for maior que a atual (rótulo desconhecido = não troca). */
    static boolean shouldSwitch(String currentLabel, String newLabel) {
        int cur = height(currentLabel), nova = height(newLabel);
        return cur > 0 && nova > cur;
    }

    /**
     * Ao ABRIR o player: a qualidade maior do mesmo motor pode ter terminado de medir entre o "ready" e o player
     * abrir (no emulador a 1080p chegou 18 s antes da tela) → índice dela pra já começar nela; -1 = fica no link pedido.
     */
    static int bestIndex(String currentUrl, String[] urls, String[] qualities) {
        if (urls == null || abyssSid(currentUrl) == null) return -1;
        int best = -1, bestH = 0;
        for (int i = 0; i < urls.length; i++) {
            if (currentUrl.equals(urls[i])) { bestH = Math.max(bestH, heightAt(urls, qualities, i)); break; }
        }
        for (int i = 0; i < urls.length; i++) {
            if (!sameEngine(currentUrl, urls[i])) continue;
            int h = heightAt(urls, qualities, i);
            if (h > bestH) { bestH = h; best = i; }
        }
        return best;
    }

    private static int heightAt(String[] urls, String[] qualities, int i) {
        String q = qualities != null && i < qualities.length ? qualities[i] : null;
        int h = height(q);
        return h > 0 ? h : height(urls[i]);
    }
}
