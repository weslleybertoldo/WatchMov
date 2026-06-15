// Reprodução de torrents direto no navegador via WebTorrent (sem debrid, grátis).
// WebTorrent v3 toca por streaming usando um service worker (createServer + streamURL).
// Limitações reais (comunicadas na UI):
//  - só conecta a peers WebRTC/WebSeed → muitos torrents têm poucos/zero → pode não achar peers;
//  - o <video> só decodifica MP4 (H.264/AAC) e WebM; .mkv/.avi não tocam no browser.

import type { Instance as WTInstance, Torrent, TorrentFile } from 'webtorrent';

// Usamos o bundle browser pré-compilado (public/webtorrent.min.js) carregado por
// dynamic import com @vite-ignore — assim o Vite não tenta empacotar o fonte do
// webtorrent (que puxa libs Node e quebra o build por falta de polyfills).
type WebTorrentCtor = new () => WTInstance;
let ctorPromise: Promise<WebTorrentCtor> | null = null;
function loadWebTorrent(): Promise<WebTorrentCtor> {
  if (!ctorPromise) {
    // Buscar o bundle e importar via blob URL: evita o Vite reescrever a URL
    // (em dev o `import('/x.js')` vira `/x.js?import` e o fetch do módulo falha).
    ctorPromise = (async () => {
      const res = await fetch('/webtorrent.min.js');
      if (!res.ok) throw new Error(`webtorrent.min.js HTTP ${res.status}`);
      let code = await res.text();
      code = code.replace(/\/\/#\s*sourceMappingURL=.*$/m, ''); // evita 404 do .map
      const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        const m = await import(/* @vite-ignore */ blobUrl);
        return (m.default ?? m) as WebTorrentCtor;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })();
  }
  return ctorPromise;
}

// Trackers WebSocket (essenciais — WebTorrent no browser só fala WSS/WebRTC).
export const WSS_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.files.fm:7073/announce',
];

const PLAYABLE_RE = /\.(mp4|m4v|webm)$/i;
const VIDEO_RE = /\.(mp4|m4v|webm|mkv|avi|mov|flv|wmv|ts)$/i;

let client: WTInstance | null = null;
let serverReady: Promise<void> | null = null;

async function ensureClient(): Promise<WTInstance> {
  const WebTorrent = await loadWebTorrent();
  if (!client) client = new WebTorrent();
  if (!serverReady) {
    serverReady = (async () => {
      if (!('serviceWorker' in navigator)) throw new Error('Service Worker indisponível neste navegador.');
      const reg = await navigator.serviceWorker.register('/sw.min.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      // @ts-expect-error createServer aceita { controller } no browser (tipos não cobrem)
      client!.createServer({ controller: reg });
    })();
  }
  await serverReady;
  return client!;
}

function pickFile(torrent: Torrent, fileIdx?: number): TorrentFile | null {
  const files = torrent.files;
  if (typeof fileIdx === 'number' && files[fileIdx] && VIDEO_RE.test(files[fileIdx].name)) return files[fileIdx];
  const videos = files.filter(f => VIDEO_RE.test(f.name));
  if (!videos.length) return null;
  // maior arquivo de vídeo
  return videos.reduce((a, b) => (b.length > a.length ? b : a));
}

export interface TorrentStream {
  url: string;        // streamURL servida pelo SW
  name: string;       // nome do arquivo
  playable: boolean;  // formato decodificável pelo <video> (mp4/webm)
  torrentId: string;  // infoHash/magnet pra destruir depois
}

/** Adiciona o magnet e devolve a URL de streaming do arquivo de vídeo. */
export async function getTorrentStream(magnet: string, fileIdx?: number, timeoutMs = 45000): Promise<TorrentStream> {
  const c = await ensureClient();

  const resolveFromTorrent = (torrent: Torrent): TorrentStream => {
    const file = pickFile(torrent, fileIdx);
    if (!file) throw new Error('Nenhum arquivo de vídeo neste torrent.');
    file.select();
    return {
      url: file.streamURL,
      name: file.name,
      playable: PLAYABLE_RE.test(file.name),
      torrentId: torrent.infoHash,
    };
  };

  // já adicionado?
  const existing = await c.get(magnet);
  if (existing) return resolveFromTorrent(existing);

  return new Promise<TorrentStream>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sem peers — nenhum seed WebRTC encontrado pra este torrent.')), timeoutMs);
    try {
      c.add(magnet, { announce: WSS_TRACKERS }, (torrent: Torrent) => {
        clearTimeout(timer);
        try { resolve(resolveFromTorrent(torrent)); } catch (e) { reject(e as Error); }
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e as Error);
    }
  });
}

/** Remove um torrent ativo (libera conexões) ao fechar o player. */
export async function destroyTorrent(torrentId: string): Promise<void> {
  if (!client) return;
  try {
    const t = await client.get(torrentId);
    if (t) await client.remove(torrentId);
  } catch { /* ignore */ }
}
