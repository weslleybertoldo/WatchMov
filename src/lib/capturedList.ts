import type { SniffResult } from '@/lib/streamSniffer';
import { streamKey } from '@/lib/streamCache';

// VARIANTE/FAIXA (playlist de 1 rendition ou faixa isolada: /m3/ vídeo, /md/ áudio,
// index-fN-vN-aN) vs COMPLETO/MASTER (multivariante master.* ou arquivo full .mp4).
// Usado p/ rotular, agrupar em abas, escopar o auto-avanço/handoff e o auto-abrir.
// A entrada sintética (synth://…?v=…&a=…) leva as faixas percent-encoded → não casa.
export const isTrackOnly = (u: string) => /\/m3\/|\/md\/|index-f\d|-v\d-a\d/i.test(u || '');

// Lista "Links do vídeo" do VideoPlayer: uma captura nova entra no fim; uma recaptura
// (mesma chave — o token da URL muda a cada play) ATUALIZA a entrada existente com a URL
// fresca, mantendo tudo que a nova não trouxe. Antes o dedup recriava o objeto só com
// url/mime/referer/provider e PERDIA `headers` e `quality`: os headers levam o UA real do
// WebView pro replay do proxy (googlevideo/Blogger prende a URL ao UA → 403 sem eles) e a
// quality some do rótulo (14/09/2026).
export function mergeCaptured(prev: SniffResult[], r: SniffResult): SniffResult[] {
  const key = streamKey(r.url);
  const idx = prev.findIndex(x => streamKey(x.url) === key);
  if (idx < 0) return [...prev, r];
  const cur = prev[idx];
  const copy = [...prev];
  copy[idx] = {
    ...cur,
    url: r.url,
    mime: r.mime || cur.mime,
    referer: r.referer || cur.referer,
    provider: r.provider || cur.provider,
    headers: r.headers || cur.headers,
    quality: r.quality || cur.quality,
    synthetic: r.synthetic || cur.synthetic,
  };
  return copy;
}

// ── COMPLETO sintetizado (vídeo + áudio) ──────────────────────────────────────────
// SuperFlix/Fembed (player em xn--…best): o master real é de UM uso — a 2ª busca (o probe
// do sniffer) recebe 403 — e nunca entra na lista; só as duas playlists de mídia
// (/m3/<sig>/<ts>/<tail>: uma só-vídeo e uma só-áudio; em outros players o áudio vem em
// /md/) ficam buscáveis por minutos e apareciam como FAIXA. Aqui montamos, por par, uma
// entrada synth://<host>/<chave>?v=<playlist 1>&a=<playlist 2> que o ProxyServer transforma
// num master HLS (variante de vídeo + EXT-X-MEDIA de áudio). Quem confere qual das duas é o
// áudio é o proxy (lê o 1º segmento de cada uma e troca se vier invertido) — pela URL não
// dá pra saber. A chave usa os <tail>s ordenados (estáveis por conteúdo; o <sig> rotaciona
// a cada play) → recaptura do par ATUALIZA a mesma entrada em vez de duplicar (mergeCaptured).
const PAIRABLE = /\/m3\/|\/md\//i;
const TRACK_AUDIO = /\/md\//i;
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };
const pathParts = (u: string) => u.split('?')[0].split('/');
const tailOf = (u: string) => { const p = pathParts(u); return p[p.length - 1] || ''; };
const tsOf = (u: string) => { const p = pathParts(u); return p.length >= 2 ? p[p.length - 2] : ''; };
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); };

function buildSynth(host: string, v: SniffResult, a: SniffResult): SniffResult {
  const key = hash(host + '|' + [tailOf(v.url), tailOf(a.url)].sort().join('|'));
  return {
    url: `synth://${host}/${key}?v=${encodeURIComponent(v.url)}&a=${encodeURIComponent(a.url)}`,
    mime: 'application/vnd.apple.mpegurl',
    referer: v.referer || a.referer,
    headers: v.headers || a.headers,
    provider: v.provider || a.provider,
    quality: v.quality || a.quality,
    synthetic: true,
  };
}

export function synthesizeCompletos(list: SniffResult[]): SniffResult[] {
  const byHost = new Map<string, SniffResult[]>();
  for (const s of list) {
    if (s.synthetic || !PAIRABLE.test(s.url)) continue;
    const h = hostOf(s.url);
    if (!h) continue;
    const arr = byHost.get(h) ?? [];
    arr.push(s);
    byHost.set(h, arr);
  }
  const out: SniffResult[] = [];
  for (const [host, tracks] of byHost) {
    // 1 entrada por <tail> (a rotação do <sig> gera chaves novas pro MESMO conteúdo) — fica a
    // mais recente; a ordem é a da 1ª aparição (a 1ª capturada costuma ser o vídeo).
    const byTail = new Map<string, SniffResult>();
    for (const t of tracks) byTail.set(tailOf(t.url), t);
    const uniq = [...byTail.values()];
    const audios = uniq.filter(t => TRACK_AUDIO.test(t.url));
    const videos = uniq.filter(t => !TRACK_AUDIO.test(t.url));
    const pairs: [SniffResult, SniffResult][] = [];
    if (audios.length) {
      const a = audios[audios.length - 1];
      for (const v of videos) pairs.push([v, a]);
    } else if (videos.length === 2) {
      pairs.push([videos[0], videos[1]]);
    } else {
      // 3+ playlists /m3/ sem /md/: pareia as que vieram do MESMO carregamento do master
      // (<ts> igual), 2 a 2; grupo ambíguo (1 ou 3+) fica de fora.
      const byTs = new Map<string, SniffResult[]>();
      for (const v of videos) { const k = tsOf(v.url); const g = byTs.get(k) ?? []; g.push(v); byTs.set(k, g); }
      for (const g of byTs.values()) if (g.length === 2) pairs.push([g[0], g[1]]);
    }
    for (const [v, a] of pairs) out.push(buildSynth(host, v, a));
  }
  return out;
}

// Mescla os COMPLETOs sintetizados na lista (mesma chave → URL fresca substitui a velha).
export function withCompletos(list: SniffResult[]): SniffResult[] {
  let next = list;
  for (const c of synthesizeCompletos(list)) next = mergeCaptured(next, c);
  return next;
}

// As duas playlists de uma entrada sintética (null se não for synth://).
export function synthParts(url: string): { v: string; a: string } | null {
  if (!url || !url.startsWith('synth://')) return null;
  const p = new URLSearchParams(url.split('?')[1] || '');
  const v = p.get('v'), a = p.get('a');
  return v && a ? { v, a } : null;
}

// Auto-abrir no reprodutor (14/09/2026): o 1º link COMPLETO/MASTER capturado AO VIVO nesta
// abertura (`fresh` = chaves que o sniffer acabou de ver; link vindo do cache não conta — pode
// estar expirado). Faixa isolada nunca. Sintético só se as DUAS playlists forem frescas
// (senão o áudio velho responde 403 e a estreia do recurso seria um erro).
export function pickAutoOpen(list: SniffResult[], fresh: Set<string>): SniffResult | null {
  for (const s of list) {
    if (isTrackOnly(s.url)) continue;
    const parts = synthParts(s.url);
    if (parts) {
      if (fresh.has(streamKey(parts.v)) && fresh.has(streamKey(parts.a))) return s;
      continue;
    }
    if (fresh.has(streamKey(s.url))) return s;
  }
  return null;
}
