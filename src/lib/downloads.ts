import { useEffect, useReducer } from 'react';
import { Downloader, downloadsNative, type DownloadItem } from './downloader';
import { getEntry, setStreamPosition } from './streamCache';
import { playNative } from './nativePlayer';

// Downloads offline reais (Media3). Estado da verdade = DownloadManager nativo
// (espelho em memória via list()+eventos+polling). A METADATA do título (título,
// poster, url do stream) vai num registro localStorage → a aba Download aparece
// OFFLINE sem depender da store Supabase. Chaves: m:tmdbId / e:tmdbId:s:e.

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const items = new Map<string, DownloadItem>();
let inited = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export const movieKey = (tmdbId: number) => `m:${tmdbId}`;
export const epKey = (tmdbId: number, season: number, ep: number) => `e:${tmdbId}:${season}:${ep}`;

// ── Registro local de metadata (offline) ──
export interface DownloadMeta {
  tmdbId: number; type: 'movie' | 'tv'; title: string; posterUrl?: string;
  season?: number; ep?: number; url: string; referer?: string; mime?: string;
}
const META_KEY = 'watchmov_dl_meta';
function readMeta(): Record<string, DownloadMeta> {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
function writeMeta(m: Record<string, DownloadMeta>) { localStorage.setItem(META_KEY, JSON.stringify(m)); notify(); }
export function getDownloadMeta(): Record<string, DownloadMeta> { return readMeta(); }

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
    if (d.state === 'removed') items.delete(d.key);
    else items.set(d.key, d);   // mantém 'failed' visível (com reason)
    notify(); syncPolling();
  }).catch(() => {});
}

// Set das chaves com download (qualquer estado ≠ removed) — a aba mostra em
// andamento E concluído. Offline usa o registro de metadata como fonte das chaves.
function knownKeys(): Set<string> {
  if (!downloadsNative()) return webRead();
  const s = new Set<string>(Object.keys(readMeta()));
  items.forEach((v, k) => { if (v.state !== 'removed') s.add(k); });
  return s;
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
  const meta = readMeta()[key];
  if (!meta) return;
  const startMs = getEntry(meta.tmdbId, meta.type, meta.season, meta.ep)?.positionMs ?? 0;
  const res = await playNative({
    url: meta.url, referer: meta.referer, mime: meta.mime, title: meta.title,
    startMs, offline: true, key,
  });
  if (res && res.positionMs > 0) setStreamPosition(res.positionMs, meta.tmdbId, meta.type, meta.season, meta.ep);
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
  return { meta: readMeta(), items };
}
