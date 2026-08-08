import { registerPlugin, Capacitor } from '@capacitor/core';

export type DownloadState =
  | 'queued' | 'downloading' | 'completed' | 'failed'
  | 'stopped' | 'removing' | 'restarting' | 'removed' | 'unknown';

export interface DownloadItem {
  key: string;
  state: DownloadState;
  percent: number;   // 0..100, ou -1 se desconhecido
  bytes?: number;
}

interface DownloaderPlugin {
  enqueue(o: { key: string; url: string; referer?: string; mime?: string; title?: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
  list(): Promise<{ downloads: DownloadItem[] }>;
  addListener(event: 'downloadChanged', cb: (d: DownloadItem) => void): Promise<{ remove: () => void }>;
}

// Plugin nativo Media3 (offline HLS+MP4). Só existe no Android.
export const Downloader = registerPlugin<DownloaderPlugin>('Downloader');
export const downloadsNative = () => Capacitor.isNativePlatform();
