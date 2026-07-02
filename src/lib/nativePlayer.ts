import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

interface PlayOpts { url: string; referer?: string; ua?: string; mime?: string; title?: string; startMs?: number; urls?: string[]; mimes?: string[]; qualities?: string[]; hasNext?: boolean; key?: string; watched?: boolean }
interface PlayResult { positionMs: number; url?: string; next?: boolean; server?: boolean; recapture?: boolean; watched?: boolean }

interface NativePlayerPlugin {
  play(opts: PlayOpts): Promise<PlayResult>;
  addListener(event: 'playerProgress', cb: (d: { url: string; positionMs: number; durationMs?: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerQuality', cb: (d: { url: string; quality: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerWatched', cb: (d: { watched: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerError', cb: (d: PlayerErrorEvent) => void): Promise<PluginListenerHandle>;
}

export interface PlayerErrorEvent {
  url?: string; code?: number; httpCode?: number; name?: string; cause?: string;
  mime?: string; referer?: string; title?: string;
}

const NativePlayer = registerPlugin<NativePlayerPlugin>('NativePlayer');

// Progresso periódico do player nativo (a cada ~5s) — salva a posição de forma
// robusta (não depende de o ExoPlayer devolver o result ao fechar).
export function onPlayerProgress(cb: (d: { url: string; positionMs: number; durationMs?: number }) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return NativePlayer.addListener('playerProgress', cb);
}

// Resolução real que o ExoPlayer decodificou pra um link (rotula a lista).
export function onPlayerQuality(cb: (d: { url: string; quality: string }) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return NativePlayer.addListener('playerQuality', cb);
}

// "Assistido" vindo do player nativo (botão, ou faltando 1 min pro fim).
export function onPlayerWatched(cb: (d: { watched: boolean }) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return NativePlayer.addListener('playerWatched', cb);
}

// Erro de reprodução do player nativo (código/causa reais) → registrar no banco.
export function onPlayerError(cb: (d: PlayerErrorEvent) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return NativePlayer.addListener('playerError', cb);
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
