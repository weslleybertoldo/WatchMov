package com.weslley.watchmov;

import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.dnsoverhttps.DnsOverHttps;

/**
 * DNS do app: DNS-over-HTTPS (Cloudflare → Google) com fallback pro resolvedor do
 * sistema.
 *
 * Motivo (14/09/2026): o DNS da operadora (Claro, entregue pelo roteador via IPv6)
 * RECUSA os hosts do CDN de várias fontes (edge*-sprintcdn.r66nv9ed.com /
 * owphbf24.com — Byse, usado por Fonte 1 opção 2, Fonte 6 "Premium" e SuperFlix).
 * O OkHttp do app caía em UnknownHostException → proxy local 502 (antes de v4.48,
 * 500 genérico) → "link capturado mas não toca". Com DNS privado = dns.google no
 * aparelho o mesmo link tocou (prova viva do Weslley) — este resolvedor faz isso
 * dentro do app, sem depender da configuração do celular nem do Wi-Fi/4G.
 *
 * Ordem: DoH primeiro (um DNS que devolve "recusado" ou um IP falso NÃO pode ganhar),
 * sistema por último. Cache positivo de 5 min (o pool de conexões do OkHttp já evita a
 * maioria das consultas). Provedor DoH que falhou por transporte fica 60 s de lado.
 * Puro Java (sem Android) — coberto pelo smoke da JVM (scratchpad/AppDnsSmoke.java).
 */
public final class AppDns implements Dns {
    static final long CACHE_TTL_MS = 5 * 60 * 1000L;
    static final long PROVIDER_BACKOFF_MS = 60 * 1000L;

    /** Diagnóstico da ÚLTIMA resolução: doh:cloudflare | doh:google | system(fallback) | cache | literal | unresolved. */
    public static volatile String lastPath = "";

    private static volatile AppDns instance;

    /** Instância única do app (Cloudflare → Google → sistema). */
    public static AppDns get() {
        AppDns d = instance;
        if (d == null) {
            synchronized (AppDns.class) {
                d = instance;
                if (d == null) instance = d = defaults();
            }
        }
        return d;
    }

    static AppDns defaults() {
        return new AppDns(Arrays.asList(
            doh("cloudflare", "https://cloudflare-dns.com/dns-query", "1.1.1.1", "1.0.0.1"),
            doh("google", "https://dns.google/dns-query", "8.8.8.8", "8.8.4.4")), Dns.SYSTEM);
    }

    static final class Provider {
        final String name;
        final Dns dns;
        volatile long failedUntil = 0L;
        Provider(String name, Dns dns) { this.name = name; this.dns = dns; }
    }

    private static final class Entry {
        final List<InetAddress> addrs;
        final long expires;
        Entry(List<InetAddress> addrs, long expires) { this.addrs = addrs; this.expires = expires; }
    }

    private final List<Provider> providers;
    private final Dns system;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();

    AppDns(List<Provider> providers, Dns system) {
        this.providers = new ArrayList<>(providers);
        this.system = system;
    }

    /** Provedor DoH com bootstrap por IP literal (a resolução do próprio DoH não passa pelo DNS do sistema). */
    static Provider doh(String name, String url, String... bootstrapIps) {
        OkHttpClient boot = new OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(4, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
            .build();
        List<InetAddress> ips = new ArrayList<>();
        for (String ip : bootstrapIps) {
            try { ips.add(InetAddress.getByName(ip)); } catch (UnknownHostException ignored) {}
        }
        Dns d = new DnsOverHttps.Builder()
            .client(boot)
            .url(HttpUrl.get(url))
            .bootstrapDnsHosts(ips)
            .includeIPv6(true)
            .build();
        return new Provider(name, d);
    }

    /** IP literal, localhost e nomes de LAN (.local) não são pra DoH — vão direto pro sistema. */
    static boolean isSystemOnly(String host) {
        if (host == null || host.isEmpty()) return true;
        String h = host.toLowerCase();
        if (h.equals("localhost") || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home")) return true;
        if (h.indexOf(':') >= 0) return true;                 // IPv6 literal
        boolean digitsDots = true;
        for (int i = 0; i < h.length(); i++) {
            char c = h.charAt(i);
            if (!(c == '.' || (c >= '0' && c <= '9'))) { digitsDots = false; break; }
        }
        return digitsDots;                                    // IPv4 literal
    }

    @Override
    public List<InetAddress> lookup(String hostname) throws UnknownHostException {
        if (isSystemOnly(hostname)) { lastPath = "literal"; return system.lookup(hostname); }
        String key = hostname.toLowerCase();
        long now = System.currentTimeMillis();
        Entry e = cache.get(key);
        if (e != null && e.expires > now) { lastPath = "cache"; return e.addrs; }

        UnknownHostException last = null;
        for (Provider p : providers) {
            if (p.failedUntil > now) continue;
            try {
                List<InetAddress> r = p.dns.lookup(hostname);
                if (r != null && !r.isEmpty()) {
                    cache.put(key, new Entry(r, now + CACHE_TTL_MS));
                    lastPath = "doh:" + p.name;
                    return r;
                }
            } catch (UnknownHostException ex) {
                // DnsOverHttps embrulha falha de TRANSPORTE (timeout, sem rota, HTTP != 200)
                // em UnknownHostException com causa IOException → provedor fora por 60 s.
                // NXDOMAIN de verdade vem sem causa: só tenta o próximo.
                last = ex;
                if (ex.getCause() instanceof IOException) p.failedUntil = now + PROVIDER_BACKOFF_MS;
            } catch (RuntimeException ex) {
                last = new UnknownHostException(hostname + ": " + ex);
                p.failedUntil = now + PROVIDER_BACKOFF_MS;
            }
        }
        try {
            List<InetAddress> r = system.lookup(hostname);
            cache.put(key, new Entry(r, now + CACHE_TTL_MS));
            lastPath = "system(fallback)";
            return r;
        } catch (UnknownHostException ex) {
            lastPath = "unresolved";
            if (last != null) ex.addSuppressed(last);
            throw ex;
        }
    }

    /** Só pro smoke: limpa o cache e o backoff dos provedores. */
    void reset() {
        cache.clear();
        for (Provider p : providers) p.failedUntil = 0L;
    }
}
