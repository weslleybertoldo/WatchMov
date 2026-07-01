import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

interface PlayOpts { url: string; referer?: string; ua?: string; mime?: string; title?: string; startMs?: number; urls?: string[]; mimes?: string[]; qualities?: string[]; hasNext?: boolean; key?: string }
interface PlayResult { positionMs: number; url?: string; next?: boolean }

interface NativePlayerPlugin {
  play(opts: PlayOpts): Promise<PlayResult>;
  addListener(event: 'playerProgress', cb: (d: { url: string; positionMs: number }) => void): Promise<PluginListenerHandle>;
}

const NativePlayer = registerPlugin<NativePlayerPlugin>('NativePlayer');

// Progresso periódico do player nativo (a cada ~5s) — salva a posição de forma
// robusta (não depende de o ExoPlayer devolver o result ao fechar).
export function onPlayerProgress(cb: (d: { url: string; positionMs: number }) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return NativePlayer.addListener('playerProgress', cb);
}

// Abre o player nativo (ExoPlayer) com Referer/UA. Retorna a posição (ms) + o link
// que ficou tocando. Só no APK; na web retorna null (o chamador usa o <video>/iframe).
export async function playNative(opts: PlayOpts): Promise<PlayResult | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await NativePlayer.play(opts);
  } catch {
    return null;
  }
}
