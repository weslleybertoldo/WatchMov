import { qualidadeDaImagem } from '@/lib/qualidade';
import type { SniffResult } from '@/lib/streamSniffer';

// Por título/episódio guarda a LISTA cumulativa de links capturados + o último
// link aberto (chosenUrl) + a posição. Reabrir → abre o último link direto; a
// lista só cresce (novos links entram abaixo) e nunca se perde (TTL 12h).
const KEY = 'watchmov_streamcache';
const TTL_MS = 12 * 60 * 60 * 1000;

export interface StreamEntry {
  streams: SniffResult[];
  chosenUrl?: string;
  lastMode?: 'native' | 'server';  // como assistiu por último (reabre igual)
  positionMs?: number;
  durationMs?: number;             // duração REAL do arquivo (do player), p/ a barra
  // Quando a POSIÇÃO mudou (o `ts` muda também com link capturado): é com ela que o ponto deste aparelho é comparado com
  // o do banco, gravado por outro aparelho (src/lib/progressoRemoto.ts, 09/11/2026). Entrada antiga sem ela usa o `ts`.
  posTs?: number;
  ts: number;
}

function read(): Record<string, StreamEntry> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function write(d: Record<string, StreamEntry>) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
}
function keyFor(tmdbId?: number, type?: string, season?: number, episode?: number): string {
  return `${tmdbId ?? 0}:${type ?? 'movie'}:${season ?? 0}:${episode ?? 0}`;
}

export function getEntry(tmdbId?: number, type?: string, season?: number, episode?: number): StreamEntry | null {
  const e = read()[keyFor(tmdbId, type, season, episode)];
  if (!e || Date.now() - e.ts > TTL_MS) return null;
  return e;
}

// Chave estável do stream: URL sem a query (o token muda a cada captura, mas o
// caminho é o mesmo) → o mesmo vídeo não duplica.
// googlevideo (Blogger): o caminho é sempre `/videoplayback` e a QUALIDADE vem na query (`itag`). Sem ela na chave, o 720p
// e o 360p do mesmo vídeo eram "o mesmo link": o 360p (2º a chegar) caía em cima do 720p e o app abria em 360p (Re: Zero,
// 08/11/2026). `id` + `itag` não mudam quando o token (expire/sig) muda → a recaptura continua atualizando a mesma entrada.
export function streamKey(url: string): string {
  const [base, query = ''] = url.split('?');
  if (/\.googlevideo\.com\/videoplayback$/i.test(base)) {
    const p = new URLSearchParams(query);
    const id = p.get('id') ?? '', itag = p.get('itag') ?? '';
    if (id || itag) return `${base}?id=${id}&itag=${itag}`;
  }
  return base;
}

// Tenta extrair a resolução da URL (ex "720p", "1280x720", "/1080/"). Heurística —
// a resolução exata do HLS adaptativo vem do player (track selection).
export function qualityFromUrl(url: string): string {
  const p = url.split('?')[0].toLowerCase();
  let m = p.match(/(\d{3,4})p(?:[^0-9]|$)/);
  if (m) return m[1] + 'p';
  m = p.match(/(\d{3,4})x(\d{3,4})/);
  if (m) return qualidadeDaImagem(Number(m[1]), Number(m[2]));   // 1920x804 = "1080p" (classe da imagem)
  m = p.match(/[/_-](240|360|480|540|576|720|1080|1440|2160)[/_.-]/);
  if (m) return m[1] + 'p';
  return '';
}

// Adiciona links (dedup por streamKey; se já existe, atualiza o token/URL fresca;
// só entra novo se for um vídeo diferente).
// Link EFÊMERO (/abyss/ servido pela página oculta do resolvedor, 15/09/2026): só existe enquanto o app
// está aberto com o motor vivo → NUNCA persiste (reabrir o título roda o resolvedor de novo). Vale pela
// flag `ephemeral` E pela URL (o onPlayerQuality/fechar do player mandam só {url, quality}).
// Pedaço CIFRADO do player Abyss (`…/sora/<tamanho>/<token>`): nunca toca sozinho. O nativo não captura mais
// (25/09/2026), e um que ficou salvo antes não pode reabrir — no celular dele o Pecadores reabria direto nele e dava
// "Nenhum link tocou". Conta como efêmero: não entra na lista salva nem vira o último link.
export const isAbyssChunkUrl = (u: string | undefined | null) => /\/sora\/\d+\//i.test(u || '');
export const isEphemeralUrl = (u: string | undefined | null) => /^https?:\/\/127\.0\.0\.1:\d+\/abyss\//i.test(u || '') || isAbyssChunkUrl(u);

// Link com PRAZO na própria URL (`expires=<unix>`): a Fonte 6/WatchPlay vence em ~10 min (medido 24/09/2026).
// Vencido, o servidor responde 410/403 — reabrir o título ou baixar com ele "dava erro" (A Hipótese do Amor
// tocou às 12:47 um link das 01:22). Vencido = não reusa: reabrir roda o resolvedor e pega link novo.
// Margem de 1 min pra não vencer no meio da abertura. Só aceita número com cara de data (2017–2103).
export function linkExpiresAt(u: string | undefined | null): number | null {
  let s = u || '';
  try { s = decodeURIComponent(s); } catch { /* URL já decodificada */ }
  const m = /[?&](?:expires|exp)=(\d{10,13})(?=&|$)/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const ms = n < 1e12 ? n * 1000 : n;
  return ms > 1.5e12 && ms < 4.2e12 ? ms : null;
}
export const isExpiredUrl = (u: string | undefined | null, now = Date.now()) => {
  const t = linkExpiresAt(u);
  return t != null && now > t - 60_000;
};

// Link novo pedido sozinho pelo player (venceu/caiu no meio): antes era 1× por abertura — num filme longo
// espelhando, o link novo também vence e o 2º pedido jogava pro servidor. Agora vale de novo se o anterior foi
// há 3 min ou mais (o link novo tocou e venceu); pedido em menos de 3 min = o novo nem tocou → servidor (25/09/2026).
export const RECAPTURE_MIN_GAP_MS = 180_000;
export const canRecaptureAgain = (lastAtMs: number, now = Date.now()) => lastAtMs <= 0 || now - lastAtMs >= RECAPTURE_MIN_GAP_MS;

export function addStreams(list: SniffResult[], tmdbId?: number, type?: string, season?: number, episode?: number) {
  list = list.filter(s => !s.ephemeral && !isEphemeralUrl(s.url));
  if (!list.length) return;
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k];
  const arr: SniffResult[] = [...(prev?.streams || [])];
  for (const s of list) {
    const key = streamKey(s.url);
    const idx = arr.findIndex(x => streamKey(x.url) === key);
    if (idx >= 0) arr[idx] = { url: s.url, mime: s.mime || arr[idx].mime, referer: s.referer || arr[idx].referer, quality: s.quality || arr[idx].quality, headers: s.headers || arr[idx].headers, provider: s.provider || arr[idx].provider, synthetic: s.synthetic || arr[idx].synthetic };
    else arr.push(s);
  }
  // PRESERVA durationMs: é a duração REAL medida pelo player. Sem isso, capturar um
  // link novo apagava a duração e a barra/tempo ("22:55 / 1:40:15") sumia.
  // PRESERVA também a hora da posição (posTs): link novo não é posição nova — sem ela, o ponto mais novo que outro
  // aparelho gravou no banco perdia pra uma posição velha daqui (09/11/2026). Entrada antiga: a posição é de até o `ts`.
  d[k] = { streams: arr, chosenUrl: prev?.chosenUrl, lastMode: prev?.lastMode,
           positionMs: prev?.positionMs, durationMs: prev?.durationMs,
           posTs: prev?.posTs ?? (prev?.positionMs ? prev.ts : undefined), ts: Date.now() };
  write(d);
}

// Remove um link da lista (ex.: expirou/falhou ao tocar). Compara por streamKey
// (ignora o token). Se era o chosenUrl, limpa. Mantém a lista só com links bons.
export function removeStream(url: string, tmdbId?: number, type?: string, season?: number, episode?: number) {
  if (!url) return;
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const e = d[k];
  if (!e) return;
  const key = streamKey(url);
  const arr = e.streams.filter(s => streamKey(s.url) !== key);
  if (arr.length === e.streams.length) return; // não tinha esse link
  e.streams = arr;
  if (e.chosenUrl && streamKey(e.chosenUrl) === key) e.chosenUrl = undefined;
  write(d);
}

// Assistiu por link (reprodutor) → reabre no reprodutor nesse link.
export function setChosen(url: string, tmdbId?: number, type?: string, season?: number, episode?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k] || { streams: [], ts: Date.now() };
  d[k] = { ...prev, chosenUrl: url, lastMode: 'native', ts: Date.now() };
  write(d);
}

// Assistiu por link EFÊMERO (/abyss/ da página oculta, 15/09/2026): reabre no reprodutor, mas SEM
// chosenUrl — o link morre com o app; o resolvedor roda de novo e monta outro.
export function markNativeMode(tmdbId?: number, type?: string, season?: number, episode?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k] || { streams: [], ts: Date.now() };
  d[k] = { ...prev, chosenUrl: undefined, lastMode: 'native', ts: Date.now() };
  write(d);
}

// Assistiu pelo servidor → reabre no servidor (não no reprodutor).
export function setServerMode(tmdbId?: number, type?: string, season?: number, episode?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const prev = d[k] || { streams: [], ts: Date.now() };
  d[k] = { ...prev, lastMode: 'server', ts: Date.now() };
  write(d);
}

// Última posição salva de um título (o episódio mais recente, no caso de série):
// usado no card "Continuar assistindo" pra mostrar o progresso do EP atual.
// `ts` = quando a entrada mexeu por último neste aparelho (o Continuar compara com a última atividade gravada no banco).
// `posTs` = quando a posição mudou (comparada com a do banco).
export function latestPosition(tmdbId?: number): { season: number; episode: number; positionMs: number; durationMs?: number; ts: number; posTs: number } | null {
  if (tmdbId == null) return null;
  const d = read();
  let best: { season: number; episode: number; positionMs: number; durationMs?: number; ts: number; posTs: number } | null = null;
  for (const [k, e] of Object.entries(d)) {
    const [tid, , s, ep] = k.split(':');
    if (tid !== String(tmdbId) || !e.positionMs) continue;   // posição não expira (só os links)
    if (!best || e.ts > best.ts) best = { season: Number(s), episode: Number(ep), positionMs: e.positionMs, durationMs: e.durationMs, ts: e.ts, posTs: e.posTs ?? e.ts };
  }
  return best;
}

// Posição deste aparelho num episódio/filme (sem TTL) + quando ela mudou — pra comparar com a do banco.
export function posicaoLocal(tmdbId?: number, type?: string, season?: number, episode?: number): { positionMs: number; durationMs?: number; posTs: number } | null {
  const e = read()[keyFor(tmdbId, type, season, episode)];
  if (!e?.positionMs) return null;
  return { positionMs: e.positionMs, durationMs: e.durationMs, posTs: e.posTs ?? e.ts };
}

// Adota o ponto que veio do banco (outro aparelho tocou depois): vira a posição deste aparelho, com a hora em que tocou
// lá. O `ts` da entrada renova (é atividade agora; sem isso o `getEntry` dava a entrada como vencida e o player abria do 0).
export function adotarPosicao(positionMs: number, tmdbId: number, type: string, season: number, episode: number, durationMs: number | undefined, posTs: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  const e = d[k] ?? { streams: [], ts: 0 };
  e.positionMs = positionMs;
  if (durationMs && durationMs > 0) e.durationMs = durationMs;
  e.posTs = posTs;
  e.ts = Date.now();
  d[k] = e; write(d);
}

// Posição SEM TTL: o link expira em 12h, mas "onde parei" não pode sumir (o
// vídeo baixado continua lá). Fonte única lida pela home e pela aba Download.
// Posições salvas de TODOS os episódios de uma série numa leitura só ("temporada:ep" → posição/duração): o painel
// "Episódios" do player mostra a barra de quem parou no meio (06/11/2026). Ler ep por ep relia o storage inteiro.
export function posicoesDaSerie(tmdbId: number): Record<string, { positionMs: number; durationMs?: number }> {
  const out: Record<string, { positionMs: number; durationMs?: number }> = {};
  for (const [k, e] of Object.entries(read())) {
    const [tid, type, s, ep] = k.split(':');
    if (tid !== String(tmdbId) || type !== 'tv' || !e.positionMs) continue;
    out[`${Number(s)}:${Number(ep)}`] = { positionMs: e.positionMs, durationMs: e.durationMs };
  }
  return out;
}

export function getPosition(tmdbId?: number, type?: string, season?: number, episode?: number): { positionMs: number; durationMs?: number } | null {
  const e = read()[keyFor(tmdbId, type, season, episode)];
  if (!e?.positionMs) return null;
  return { positionMs: e.positionMs, durationMs: e.durationMs };
}

export function setStreamPosition(positionMs: number, tmdbId?: number, type?: string, season?: number, episode?: number, durationMs?: number) {
  const d = read(); const k = keyFor(tmdbId, type, season, episode);
  // CRIA a entrada se ainda não existe: assistir pela aba Download (que não passa
  // pela captura/addStreams) precisa salvar o progresso do mesmo jeito, senão o
  // "Continuar assistindo" não reflete o que foi visto ali.
  if (!d[k]) d[k] = { streams: [], ts: Date.now() };
  const e = d[k];
  e.ts = Date.now();          // renova: enquanto assiste, a entrada não expira
  e.posTs = e.ts;
  if (e) { e.positionMs = positionMs; if (durationMs && durationMs > 0) e.durationMs = durationMs; write(d); }
}

// Tempo da TV com o player fechado: ninguém escuta o progresso do player, então ele vem da consulta do espelhamento
// (a cada 4 s) pela chave `tmdbId:type:season:ep`. Só vale se for mais novo que o que já está no título — tocou no
// celular depois? fica o do celular. Até 3 s não conta, igual ao player.
export function applyTvPosition(key: string, positionMs: number, durationMs: number | undefined, ts: number): boolean {
  if (!key || !(positionMs > 3000)) return false;
  const d = read();
  const e = d[key] ?? { streams: [], ts: 0 };
  if (e.ts >= ts) return false;
  e.ts = ts; e.posTs = ts; e.positionMs = positionMs;
  if (durationMs && durationMs > 0) e.durationMs = durationMs;
  d[key] = e; write(d);
  return true;
}
