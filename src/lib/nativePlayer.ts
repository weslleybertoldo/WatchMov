import { registerPlugin, Capacitor } from '@capacitor/core';

interface PlayOpts { url: string; referer?: string; ua?: string; mime?: string; title?: string; startMs?: number; urls?: string[]; mimes?: string[] }
interface PlayResult { positionMs: number; url?: string }

interface NativePlayerPlugin {
  play(opts: PlayOpts): Promise<PlayResult>;
}

const NativePlayer = registerPlugin<NativePlayerPlugin>('NativePlayer');

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
