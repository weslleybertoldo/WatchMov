import { registerPlugin } from '@capacitor/core';
import { temDownloads } from './desktop';

export type DownloadState =
  | 'queued' | 'downloading' | 'completed' | 'failed'
  | 'stopped' | 'removing' | 'restarting' | 'removed' | 'unknown';

export interface DownloadItem {
  key: string;
  state: DownloadState;
  percent: number;   // 0..100, ou -1 se desconhecido
  bytes?: number;
  reason?: string;   // motivo da falha (state === 'failed')
  title?: string;    // gravado no DownloadRequest.data (reconstrói item sem registro local)
  uri?: string;      // URI proxied (http://127.0.0.1:8099/s?u=...&r=...)
}

// Download cancelado pelo nativo: link morto (404/410 expirou, 403/451 a fonte bloqueou) confirmado
// duas vezes — a falha do Media3 e uma consulta direta ao link 1 min depois com o mesmo status.
export interface DownloadCancelled {
  key: string;
  title?: string;
  reason?: string;   // "Link expirou · download cancelado · abra o título de novo pra baixar"
  http?: number;     // status confirmado
}

interface DownloaderPlugin {
  enqueue(o: { key: string; url: string; referer?: string; mime?: string; title?: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
  list(): Promise<{ downloads: DownloadItem[] }>;
  resume(): Promise<void>;   // retoma o que ficou pela metade (app atualizado/fechado)
  storage(): Promise<{ freeBytes: number; totalBytes: number }>;
  addListener(event: 'downloadChanged', cb: (d: DownloadItem) => void): Promise<{ remove: () => void }>;
  addListener(event: 'downloadCancelled', cb: (d: DownloadCancelled) => void): Promise<{ remove: () => void }>;
}

// Plugin nativo Media3 (offline HLS+MP4) no Android. No app do Windows (W4) a versão web do mesmo plugin passa pro
// processo principal (desktop/downloads.ts: .mp4 em Vídeos\WatchMov), com os mesmos métodos e eventos.
export const Downloader = registerPlugin<DownloaderPlugin>('Downloader', {
  web: () => import('./desktopPlugins').then((m) => new m.DownloaderDesktop()),
});
export const downloadsNative = () => temDownloads();

// "1,4 GB" / "820 MB" — tamanho legível pra aba Download.
export function fmtBytes(b?: number): string {
  if (!b || b <= 0) return '—';
  const mb = b / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`;
}
