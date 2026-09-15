package com.weslley.watchmov;

import java.net.URL;
import java.net.URLEncoder;

/**
 * Master HLS "COMPLETO" sintetizado a partir de duas playlists de mídia do MESMO player
 * (SuperFlix/Fembed em xn--…best: uma só-vídeo e uma só-áudio, as duas em /m3/…; em outros
 * players o áudio vem em /md/…), cujo master real é de UM uso — a 2ª busca (o probe do
 * sniffer) recebe 403 e ele nunca entra na lista do app. O JS monta
 * synth://host/<chave>?v=…&a=… (ver capturedList.ts); o ProxyServer descobre pelo 1º
 * segmento qual das duas é o áudio (detectKind/shouldSwap) e serve body() como
 * application/vnd.apple.mpegurl. As URIs saem RELATIVAS (/s?u=…), como no rewrite() dos
 * masters reais: o cliente (ExoPlayer local ou TV na LAN) resolve contra o host:porta em
 * que buscou o master.
 *
 * Puro Java (sem Android) — coberto pelo smoke da JVM (~/.cache/wm_probe/jvm).
 */
public final class SynthMaster {
    private SynthMaster() {}

    static String enc(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return ""; }
    }

    /** Corpo do master: 1 variante de vídeo + 1 faixa de áudio (pt, DEFAULT) apontando pro próprio proxy. */
    public static String body(String video, String audio, String referer) {
        String vu = "/s?u=" + enc(video) + "&r=" + enc(referer);
        String au = "/s?u=" + enc(audio) + "&r=" + enc(referer);
        return "#EXTM3U\n#EXT-X-VERSION:3\n"
            + "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",NAME=\"Áudio\",LANGUAGE=\"pt\",DEFAULT=YES,AUTOSELECT=YES,URI=\"" + au + "\"\n"
            + "#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO=\"aud\"\n"
            + vu + "\n";
    }

    /**
     * 1ª URL de mídia de uma playlist, absoluta (null se não achar). O init do fMP4
     * (#EXT-X-MAP) tem prioridade: é nele que mora o hdlr que diz vídeo/áudio.
     */
    public static String firstSegment(String playlist, String base) {
        if (playlist == null) return null;
        String first = null;
        for (String raw : playlist.split("\n")) {
            String t = raw.trim();
            if (t.isEmpty()) continue;
            if (t.startsWith("#")) {
                if (t.startsWith("#EXT-X-MAP")) {
                    int i = t.indexOf("URI=\"");
                    if (i >= 0) { int s = i + 5, e = t.indexOf('"', s); if (e > s) return resolve(base, t.substring(s, e)); }
                }
                continue;
            }
            if (first == null) first = t;
        }
        return first == null ? null : resolve(base, first);
    }

    static String resolve(String base, String ref) {
        try { return ref.startsWith("http") ? ref : new URL(new URL(base), ref).toString(); } catch (Exception e) { return null; }
    }

    /**
     * "video" | "audio" | "muxed" | "unknown" a partir dos primeiros bytes de um segmento:
     * MPEG-TS (PES 00 00 01 E0–EF = vídeo, C0–DF/BD = áudio), fMP4 (hdlr vide/soun), ADTS/ID3
     * (áudio cru). Segmento cifrado (AES-128) ou formato estranho → unknown.
     */
    public static String detectKind(byte[] b) {
        if (b == null || b.length < 8) return "unknown";
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xF6) == 0xF0) return "audio";          // ADTS
        if (b[0] == 'I' && b[1] == 'D' && b[2] == '3') return "audio";               // ID3 + AAC
        if ((b[0] & 0xFF) == 0x47 && (b.length < 189 || (b[188] & 0xFF) == 0x47)) {  // MPEG-TS
            int video = 0, audio = 0;
            for (int off = 0; off + 188 <= b.length; off += 188) {
                if ((b[off] & 0xFF) != 0x47) break;
                boolean pusi = (b[off + 1] & 0x40) != 0;
                int afc = (b[off + 3] >> 4) & 0x3;
                if (!pusi || (afc & 1) == 0) continue;               // sem início de PES / sem payload
                int p = off + 4;
                if ((afc & 2) != 0) p += 1 + (b[off + 4] & 0xFF);    // pula o adaptation field
                if (p + 3 >= off + 188) continue;
                if (b[p] == 0 && b[p + 1] == 0 && b[p + 2] == 1) {
                    int sid = b[p + 3] & 0xFF;
                    if (sid >= 0xE0 && sid <= 0xEF) video++;
                    else if ((sid >= 0xC0 && sid <= 0xDF) || sid == 0xBD) audio++;
                }
            }
            return verdict(video, audio);
        }
        if (b.length >= 12 && (matches(b, 4, "ftyp") || matches(b, 4, "styp") || matches(b, 4, "moov") || matches(b, 4, "moof"))) {
            int video = 0, audio = 0;                                 // fMP4: hdlr → handler_type
            for (int i = 0; i + 16 <= b.length; i++) {
                if (matches(b, i, "hdlr")) {
                    if (matches(b, i + 12, "vide")) video++;
                    else if (matches(b, i + 12, "soun")) audio++;
                }
            }
            return verdict(video, audio);
        }
        return "unknown";
    }

    private static String verdict(int video, int audio) {
        if (video > 0 && audio > 0) return "muxed";
        if (video > 0) return "video";
        if (audio > 0) return "audio";
        return "unknown";
    }

    private static boolean matches(byte[] b, int at, String s) {
        if (at < 0 || at + s.length() > b.length) return false;
        for (int i = 0; i < s.length(); i++) if (b[at + i] != (byte) s.charAt(i)) return false;
        return true;
    }

    /** Inverte v/a quando a sondagem mostra que o JS mandou trocado (sem prova, fica a ordem dele). */
    public static boolean shouldSwap(String kindV, String kindA) {
        boolean vAudio = "audio".equals(kindV), aAudio = "audio".equals(kindA);
        boolean vVideo = "video".equals(kindV) || "muxed".equals(kindV);
        boolean aVideo = "video".equals(kindA) || "muxed".equals(kindA);
        if (vAudio && !aAudio) return true;
        if (aVideo && !vVideo) return true;
        return false;
    }
}
