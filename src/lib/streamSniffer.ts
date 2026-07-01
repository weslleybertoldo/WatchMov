import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

export interface SniffResult { url: string; mime?: string; referer?: string }

interface StreamSnifferPlugin {
  startWatching(): Promise<void>;
  stopWatching(): Promise<void>;
  addListener(event: 'streamFound', cb: (r: SniffResult) => void): Promise<PluginListenerHandle>;
}

const StreamSniffer = registerPlugin<StreamSnifferPlugin>('StreamSniffer');

export const isNative = () => Capacitor.isNativePlatform();

// Arma a captura passiva (o iframe do servidor toca no WebView do app e o nativo
// observa o tráfego). Retorna o handle do listener + função de parar.
export async function watchStream(onFound: (r: SniffResult) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const handle = await StreamSniffer.addListener('streamFound', onFound);
  await StreamSniffer.startWatching();
  return () => {
    StreamSniffer.stopWatching().catch(() => {});
    handle.remove();
  };
}
