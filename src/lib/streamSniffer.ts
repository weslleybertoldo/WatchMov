import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { temCaptura } from './desktop';

// synthetic: COMPLETO montado pelo app a partir de um par vídeo/áudio (synth://…, ver capturedList.ts).
// ephemeral: link /abyss/ servido pela página oculta (motor) — vale só enquanto o app estiver aberto; nunca vai pro cache.
export interface SniffResult { url: string; mime?: string; referer?: string; quality?: string; headers?: Record<string, string>; provider?: string; option?: string; synthetic?: boolean; ephemeral?: boolean }

// Resolução medida DEPOIS que o link já foi avisado (20/10/2026): o nativo avisa o link na hora e manda a qualidade
// quando terminar de medir — só serve pra rotular o link na lista.
export interface SniffQuality { url: string; quality: string }

interface StreamSnifferPlugin {
  startWatching(): Promise<void>;
  stopWatching(): Promise<void>;
  addListener(event: 'streamFound', cb: (r: SniffResult) => void): Promise<PluginListenerHandle>;
  addListener(event: 'streamQuality', cb: (q: SniffQuality) => void): Promise<PluginListenerHandle>;
}

// No app do Windows (Capacitor = "web") a captura é a da ponte (desktopPlugins.ts, desktop/captura.ts), com os mesmos eventos.
const StreamSniffer = registerPlugin<StreamSnifferPlugin>('StreamSniffer', {
  web: () => import('./desktopPlugins').then((m) => new m.SnifferDesktop()),
});

// Captura, resolvedor e player do app: o APK ou o app do Windows v5.23+ (temCaptura). Os guardas do VideoPlayer usam este.
export const isNative = () => temCaptura();

// Arma a captura passiva (o iframe do servidor toca no WebView do app e o nativo
// observa o tráfego). Retorna o handle do listener + função de parar.
export async function watchStream(onFound: (r: SniffResult) => void, onQuality?: (q: SniffQuality) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const handle = await StreamSniffer.addListener('streamFound', onFound);
  const handleQ = onQuality ? await StreamSniffer.addListener('streamQuality', onQuality) : null;
  await StreamSniffer.startWatching();
  return () => {
    StreamSniffer.stopWatching().catch(() => {});
    handle.remove();
    handleQ?.remove();
  };
}
