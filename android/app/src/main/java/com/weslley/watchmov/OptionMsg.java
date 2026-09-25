package com.weslley.watchmov;

/**
 * Recados do script injetado no WebView oculto (25/09/2026), depois do prefixo `WMOPT|progress|` / `WMOPT|dead|`:
 * `k=2|stage=player` · `k=2|reason=not-found`. O K diz de qual opção o recado veio — o ResolverPlugin ignora
 * recado atrasado da opção anterior. Puro (testável na JVM).
 */
final class OptionMsg {
    private OptionMsg() {}

    /** K da opção; -1 se o recado não tiver um K válido. */
    static int k(String rest) {
        String v = field(rest, "k");
        if (v == null) return -1;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return -1; }
    }

    /** Etapa do progresso (player / play); "" se não tiver. */
    static String stage(String rest) {
        String v = field(rest, "stage");
        return v == null ? "" : v;
    }

    static String field(String rest, String key) {
        if (rest == null || key == null) return null;
        for (String part : rest.split("\\|")) {
            int eq = part.indexOf('=');
            if (eq > 0 && part.substring(0, eq).equals(key)) return part.substring(eq + 1);
        }
        return null;
    }
}
