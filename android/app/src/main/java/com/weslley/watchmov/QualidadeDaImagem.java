package com.weslley.watchmov;

/**
 * Rótulo de qualidade pela CLASSE do vídeo, não pela altura crua (09/11/2026, pedido do Weslley: o player mostrava
 * "804p" num filme que o site chama de 1080p). Filme de cinema vem sem as faixas pretas — 1920 × 804 é o Full HD
 * dele —, então a classe é a altura que a imagem teria numa tela 16:9: max(lado menor, lado maior × 9/16), encaixada
 * no degrau padrão mais perto (até 7%: 2048 × 1080 e 4096 × 2160 de cinema digital seguem 1080p e 2160p). Lado maior
 * e menor (e não largura e altura) deixam o vídeo em pé com a mesma classe do deitado.
 * Só RÓTULO: escolher a faixa, mandar pra TV e ordenar os links continuam pela altura de verdade.
 * Mesma regra do `qualidadeDaImagem` do web (src/lib/qualidade.ts).
 */
final class QualidadeDaImagem {
    private QualidadeDaImagem() {}

    private static final int[] DEGRAUS = {144, 240, 360, 480, 540, 576, 720, 1080, 1440, 2160, 4320};
    private static final double FOLGA = 0.07;

    /** Classe da imagem (1920×804 → 1080). Largura desconhecida (≤ 0) = só a altura. 0 = sem altura. */
    static int classe(int largura, int altura) {
        if (altura <= 0) return 0;
        double equivalente = altura;
        if (largura > 0) {
            int maior = Math.max(largura, altura), menor = Math.min(largura, altura);
            equivalente = Math.max(menor, maior * 9.0 / 16.0);
        }
        int perto = DEGRAUS[0];
        for (int d : DEGRAUS) if (Math.abs(d - equivalente) < Math.abs(perto - equivalente)) perto = d;
        return Math.abs(perto - equivalente) <= perto * FOLGA ? perto : (int) Math.round(equivalente);
    }

    /** "1080p"; vazio sem altura. */
    static String rotulo(int largura, int altura) {
        int c = classe(largura, altura);
        return c > 0 ? c + "p" : "";
    }

    /** Largura de exibição: a do quadro × o formato do pixel (vídeo anamórfico). Formato inválido = 1. */
    static int larguraExibida(int largura, float formatoDoPixel) {
        if (largura <= 0) return largura;
        float f = formatoDoPixel > 0 && !Float.isNaN(formatoDoPixel) && !Float.isInfinite(formatoDoPixel) ? formatoDoPixel : 1f;
        return Math.round(largura * f);
    }

    /** Maior classe anunciada num master HLS (RESOLUTION=1920x804 → "1080p"); vazio sem nenhuma. */
    static String doMaster(String texto) {
        if (texto == null) return "";
        int max = 0;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("RESOLUTION=(\\d{2,4})x(\\d{2,4})").matcher(texto);
        while (m.find()) max = Math.max(max, classe(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2))));
        return max > 0 ? max + "p" : "";
    }
}
