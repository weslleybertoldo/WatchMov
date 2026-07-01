import { registerPlugin, Capacitor } from '@capacitor/core';

interface NativePlayerPlugin {
  play(opts: { url: string; referer?: string; ua?: string; mime?: string; title?: string; startMs?: number }): Promise<{ positionMs: number }>;
}

const NativePlayer = registerPlugin<NativePlayerPlugin>('NativePlayer');

// Abre o player nativo (ExoPlayer) com Referer/UA. Retorna a posição (ms) ao sair.
// Só no APK; na web retorna null (o chamador usa o <video>/iframe).
export async function playNative(opts: {
  url: string; referer?: string; ua?: string; mime?: string; title?: string; startMs?: number;
}): Promise<{ positionMs: number } | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await NativePlayer.play(opts);
  } catch {
    return null;
  }
}
