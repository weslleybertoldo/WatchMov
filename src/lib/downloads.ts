import { useEffect, useReducer } from 'react';
import { Downloader, downloadsNative, type DownloadItem } from './downloader';
import { getPosition, setStreamPosition } from './streamCache';
import { fmtClock } from './watchProgress';
import { playNative, onPlayerProgress } from './nativePlayer';
import { upsertNotice } from './appNotices';

// Downloads offline reais (Media3). Estado da verdade = DownloadManager nativo
// (espelho em memória via list()+eventos+polling). A METADATA do título (título,
// poster, url do stream) vai num registro localStorage → a aba Download aparece
// OFFLINE sem depender da store Supabase. Chaves: m:tmdbId / e:tmdbId:s:e.

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const items = new Map<string, DownloadItem>();
let inited = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// "Seus Amigos e Vizinhos — T2E5" a partir da chave + título gravado no download.
function labelOf(key: string, title?: string): string {
  const p = key.split(':');
  const base = title && title.trim() ? title.trim() : 'Seu vídeo';
  return p[0] === 'e' && p.length >= 4 ? `${base} — T${p[2]}E${p[3]}` : base;
}

export const movieKey = (tmdbId: number) => `m:${tmdbId}`;
export const epKey = (tmdbId: number, season: number, ep: number) => `e:${tmdbId}:${season}:${ep}`;

// ── Registro local de metadata (offline) ──
export interface DownloadMeta {
  tmdbId: number; type: 'movie' | 'tv'; title: string; posterUrl?: string;
  season?: number; ep?: number; url: string; referer?: string; mime?: string;
  stillUrl?: string;   // frame do episódio (guardado aqui pra aba funcionar OFFLINE)
}
const META_KEY = 'watchmov_dl_meta';
function readMeta(): Record<string, DownloadMeta> {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
function writeMeta(m: Record<string, DownloadMeta>) { localStorage.setItem(META_KEY, JSON.stringify(m)); notify(); }

// Reconstrói a metadata a partir do PRÓPRIO download nativo (key + title + uri
// proxied), pra itens sem registro local — ex. baixados por versão anterior, que
// sumiam da aba. A key carrega tmdbId/tipo/temporada/ep; a uri carrega ?u= e &r=.
function syntheticMeta(it: DownloadItem): DownloadMeta | null {
  const p = it.key.split(':');
  const tmdbId = Number(p[1]);
  if (!tmdbId) return null;
  let url = '', referer: string | undefined;
  try {
    const q = new URL(it.uri || '').searchParams;
    url = q.get('u') || '';
    referer = q.get('r') || undefined;
  } catch { /* uri ausente/inválida */ }
  if (p[0] === 'm') return { tmdbId, type: 'movie', title: it.title || `Filme ${tmdbId}`, url, referer };
  return {
    tmdbId, type: 'tv', title: it.title || `Série ${tmdbId}`,
    season: Number(p[2]), ep: Number(p[3]), url, referer,
  };
}

// Metadata efetiva: registro local (rico: poster) + reconstruída do nativo (legado).
export function getDownloadMeta(): Record<string, DownloadMeta> {
  const stored = readMeta();
  const out: Record<string, DownloadMeta> = { ...stored };
  items.forEach((it, k) => {
    if (out[k] || it.state === 'removed') return;
    const s = syntheticMeta(it);
    if (s) out[k] = s;
  });
  return out;
}

// ── Fallback WEB (sem nativo): só marcador (sem arquivo) ──
const WEB_KEY = 'watchmov_downloads';
function webRead(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(WEB_KEY) || '[]')); } catch { return new Set(); } }
function webWrite(s: Set<string>) { localStorage.setItem(WEB_KEY, JSON.stringify([...s])); notify(); }

function anyActive(): boolean {
  for (const v of items.values()) if (v.state === 'downloading' || v.state === 'queued' || v.state === 'restarting') return true;
  return false;
}
function syncPolling() {
  if (!downloadsNative()) return;
  if (anyActive() && !pollTimer) {
    pollTimer = setInterval(() => {
      Downloader.list().then(({ downloads }) => {
        items.clear();
        downloads.forEach(d => items.set(d.key, d));
        notify();
        if (!anyActive() && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }).catch(() => {});
    }, 1200);
  } else if (!anyActive() && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function ensureInit() {
  if (inited) return;
  inited = true;
  if (!downloadsNative()) return;
  Downloader.list().then(({ downloads }) => {
    downloads.forEach(d => items.set(d.key, d));
    notify(); syncPolling();
  }).catch(() => {});
  Downloader.addListener('downloadChanged', (d) => {
    const antes = items.get(d.key)?.state;
    if (d.state === 'removed') items.delete(d.key);
    else items.set(d.key, d);   // mantém 'failed' visível (com reason)
    // Registra na central (aba Downloads) só na TRANSIÇÃO pra concluído/falhou —
    // o listener repete o mesmo estado várias vezes.
    if (antes !== d.state) {
      if (d.state === 'completed') {
        upsertNotice(`dl:${d.key}`, { kind: 'download', title: `Download de ${labelOf(d.key, d.title)} concluído`,
          body: 'Já está disponível na aba Download pra assistir offline.' });
      } else if (d.state === 'failed') {
        upsertNotice(`dl:${d.key}`, { kind: 'download', error: true, title: `Falhou o download de ${labelOf(d.key, d.title)}`,
          body: d.reason || 'erro' });
      }
    }
    notify(); syncPolling();
  }).catch(() => {});
}

// Set das chaves com download (qualquer estado ≠ removed) — a aba mostra em
// andamento E concluído. Offline usa o registro de metadata como fonte das chaves.
function knownKeys(): Set<string> {
  if (!downloadsNative()) return webRead();
  return new Set<string>(Object.keys(getDownloadMeta()));
}

// Assistido/progresso offline: vem do streamCache (positionMs/durationMs salvos
// pelo player), não da store Supabase. ≥92% = assistido. O label usa o MESMO
// formato do "Continuar assistindo" da home ("22:55 / 1:40:15").
export function watchProgressOf(key: string): { percent: number; watched: boolean; label: string } | null {
  const meta = getDownloadMeta()[key];
  if (!meta) return null;
  const e = getPosition(meta.tmdbId, meta.type, meta.season, meta.ep);
  if (!e) return null;
  if (!e.durationMs) return { percent: 0, watched: false, label: fmtClock(e.positionMs) };
  const percent = Math.min(100, Math.round((e.positionMs / e.durationMs) * 100));
  return { percent, watched: percent >= 92, label: `${fmtClock(e.positionMs)} / ${fmtClock(e.durationMs)}` };
}
function completedSet(): Set<string> {
  if (!downloadsNative()) return webRead();
  const s = new Set<string>();
  items.forEach((v, k) => { if (v.state === 'completed') s.add(k); });
  return s;
}

export function getDownloads(): Set<string> { ensureInit(); return completedSet(); }
export function isDownloaded(key: string): boolean { ensureInit(); return completedSet().has(key); }
export function getDownloadItem(key: string): DownloadItem | undefined { ensureInit(); return items.get(key); }

// Inicia o download real de uma MASTER + salva a metadata (offline-safe).
export function enqueueDownload(key: string, o: {
  url: string; referer?: string; mime?: string; title?: string;
  tmdbId: number; type: 'movie' | 'tv'; posterUrl?: string; season?: number; ep?: number;
}) {
  const meta: DownloadMeta = {
    tmdbId: o.tmdbId, type: o.type, title: o.title || '', posterUrl: o.posterUrl,
    season: o.season, ep: o.ep, url: o.url, referer: o.referer, mime: o.mime,
  };
  const all = readMeta(); all[key] = meta; writeMeta(all);
  if (!downloadsNative()) { const s = webRead(); s.add(key); webWrite(s); return; }
  items.set(key, { key, state: 'queued', percent: 0 }); notify(); syncPolling();
  Downloader.enqueue({ key, url: o.url, referer: o.referer, mime: o.mime, title: o.title })
    .catch(() => { items.delete(key); notify(); });
}

export function removeDownload(key: string) {
  const all = readMeta(); delete all[key]; writeMeta(all);
  if (!downloadsNative()) { const s = webRead(); s.delete(key); webWrite(s); return; }
  items.delete(key); notify();
  Downloader.remove({ key }).catch(() => {});
}

// Compat: só remoção por chave (marcar baixado exige enqueueDownload com metadata).
export function setDownloaded(keys: string[], value: boolean) {
  if (value) return;
  keys.forEach(k => removeDownload(k));
}

export function hasAnyDownload(set: Set<string>, tmdbId: number, isMovie: boolean): boolean {
  if (isMovie) return set.has(movieKey(tmdbId));
  const prefix = `e:${tmdbId}:`;
  for (const k of set) if (k.startsWith(prefix)) return true;
  return false;
}

export function downloadedEpisodesOf(set: Set<string>, tmdbId: number): { season: number; ep: number }[] {
  const p = `e:${tmdbId}:`;
  const out: { season: number; ep: number }[] = [];
  for (const k of set) if (k.startsWith(p)) {
    const parts = k.split(':');
    out.push({ season: Number(parts[2]), ep: Number(parts[3]) });
  }
  return out.sort((a, b) => a.season - b.season || a.ep - b.ep);
}

export function clearDownloadsFor(tmdbId: number, isMovie: boolean) {
  if (isMovie) { removeDownload(movieKey(tmdbId)); return; }
  const p = `e:${tmdbId}:`;
  for (const k of [...knownKeys()]) if (k.startsWith(p)) removeDownload(k);
}

// Reproduz um download OFFLINE direto do cache (sem passar por MediaDetail/TMDB,
// que exigem rede). Retoma da posição salva; salva a posição ao fechar.
export async function playDownloaded(key: string) {
  const meta = getDownloadMeta()[key];   // inclui itens reconstruídos do nativo
  if (!meta || !meta.url) return;
  // MESMA chave de resume do VideoPlayer (`tmdbId:type:season:ep`) → o progresso é
  // um só: retoma de onde parou na home e o que assistir aqui reflete lá.
  const resumeKey = `${meta.tmdbId}:${meta.type}:${meta.season ?? 0}:${meta.ep ?? 0}`;
  const startMs = getPosition(meta.tmdbId, meta.type, meta.season, meta.ep)?.positionMs ?? 0;
  // Próximo episódio BAIXADO (mesma temporada): habilita o botão "Próximo" do player
  // — sem isso, quem abre pela aba Download nunca via a opção (nem no espelhamento).
  const nextKey = (meta.type === 'tv' && meta.season != null && meta.ep != null)
    ? epKey(meta.tmdbId, meta.season, meta.ep + 1) : null;
  const hasNext = !!nextKey && items.get(nextKey)?.state === 'completed';
  // Salva a posição a cada ~5s (igual ao fluxo normal): se o app morrer, não perde.
  let handle: { remove: () => void } | null = null;
  onPlayerProgress?.(({ positionMs, durationMs }) => {
    if (positionMs > 0) setStreamPosition(positionMs, meta.tmdbId, meta.type, meta.season, meta.ep, durationMs);
  })?.then(h => { handle = h; }).catch(() => {});
  try {
    const res = await playNative({
      url: meta.url, referer: meta.referer, mime: meta.mime, title: meta.title,
      startMs, offline: true, key: resumeKey, hasNext,
    });
    if (res && res.positionMs > 0) setStreamPosition(res.positionMs, meta.tmdbId, meta.type, meta.season, meta.ep);
    // "Próximo" no player → toca o episódio seguinte JÁ BAIXADO (encadeia offline).
    if (res?.next && nextKey) { handle?.remove(); handle = null; await playDownloaded(nextKey); }
  } finally {
    handle?.remove();
    notify();   // atualiza a barra da aba na volta
  }
}

// Hook reativo: Set de concluídos.
export function useDownloads(): Set<string> {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { ensureInit(); listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return completedSet();
}

// Hook reativo pro item de UMA chave (estado/progresso).
export function useDownloadItem(key: string | null): DownloadItem | undefined {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { ensureInit(); listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return key ? items.get(key) : undefined;
}

// Hook reativo pra aba Download: metadata (offline) + estados nativos.
export function useDownloadList(): { meta: Record<string, DownloadMeta>; items: Map<string, DownloadItem> } {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { ensureInit(); listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return { meta: getDownloadMeta(), items };
}
