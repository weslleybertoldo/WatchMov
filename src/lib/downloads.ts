import { useEffect, useReducer } from 'react';
import { Downloader, downloadsNative, type DownloadItem } from './downloader';

// Downloads offline reais (Media3). O estado da verdade é o DownloadManager nativo;
// aqui mantemos um espelho em memória (Map key→item) alimentado por list() no boot +
// eventos downloadChanged. No WEB (sem nativo) cai num fallback localStorage (só marca
// estado, sem arquivo) pra não quebrar o build/dev. Chaves: m:tmdbId / e:tmdbId:s:e.

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const items = new Map<string, DownloadItem>();
let inited = false;

export const movieKey = (tmdbId: number) => `m:${tmdbId}`;
export const epKey = (tmdbId: number, season: number, ep: number) => `e:${tmdbId}:${season}:${ep}`;

// ── Fallback WEB (sem nativo): mantém o comportamento antigo (só marcador) ──
const WEB_KEY = 'watchmov_downloads';
function webRead(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(WEB_KEY) || '[]')); } catch { return new Set(); }
}
function webWrite(s: Set<string>) { localStorage.setItem(WEB_KEY, JSON.stringify([...s])); notify(); }

function ensureInit() {
  if (inited) return;
  inited = true;
  if (!downloadsNative()) return;
  Downloader.list().then(({ downloads }) => {
    downloads.forEach(d => items.set(d.key, d));
    notify();
  }).catch(() => {});
  Downloader.addListener('downloadChanged', (d) => {
    if (d.state === 'removed' || d.state === 'failed') items.delete(d.key);
    else items.set(d.key, d);
    notify();
  }).catch(() => {});
}

// Set das chaves BAIXADAS (concluídas) — o que a tela de Downloads mostra.
function completedSet(): Set<string> {
  if (!downloadsNative()) return webRead();
  const s = new Set<string>();
  items.forEach((v, k) => { if (v.state === 'completed') s.add(k); });
  return s;
}

export function getDownloads(): Set<string> { ensureInit(); return completedSet(); }
export function isDownloaded(key: string): boolean { ensureInit(); return completedSet().has(key); }

// Item bruto (estado/progresso) — undefined se não há download pra essa chave.
export function getDownloadItem(key: string): DownloadItem | undefined {
  ensureInit();
  return items.get(key);
}

// Inicia o download real de uma MASTER capturada (precisa da URL resolvida do stream).
export function enqueueDownload(key: string, o: { url: string; referer?: string; mime?: string; title?: string }) {
  if (!downloadsNative()) { const s = webRead(); s.add(key); webWrite(s); return; }
  // Marca otimista como "queued" (some se falhar) pra UI reagir na hora.
  items.set(key, { key, state: 'queued', percent: 0 });
  notify();
  Downloader.enqueue({ key, ...o }).catch(() => { items.delete(key); notify(); });
}

export function removeDownload(key: string) {
  if (!downloadsNative()) { const s = webRead(); s.delete(key); webWrite(s); return; }
  items.delete(key); notify();
  Downloader.remove({ key }).catch(() => {});
}

// Compat: só removção é suportada por chave sem URL (marcar como baixado exige enqueue).
export function setDownloaded(keys: string[], value: boolean) {
  if (value) return;                       // "marcar baixado" agora é via enqueueDownload
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
  for (const k of [...completedSet(), ...items.keys()]) if (k.startsWith(p)) removeDownload(k);
}

// Hook reativo: re-renderiza quando os downloads mudam (Set de concluídos).
export function useDownloads(): Set<string> {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { ensureInit(); listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return completedSet();
}

// Hook reativo pro item de UMA chave (estado/progresso) — usado no botão Baixar.
export function useDownloadItem(key: string | null): DownloadItem | undefined {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { ensureInit(); listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return key ? items.get(key) : undefined;
}
