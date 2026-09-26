import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { applyTvPosition } from '@/lib/streamCache';

interface PlayOpts { url: string; referer?: string; ua?: string; mime?: string; title?: string; startMs?: number; urls?: string[]; mimes?: string[]; qualities?: string[]; hasNext?: boolean; key?: string; watched?: boolean; offline?: boolean; downloaded?: boolean; headers?: Record<string, string> }
// `watchedKey` = de QUAL episódio o `watched` fala (tmdbId:type:season:ep). O player
// troca de episódio sem recriar a Activity, então o estado final do "assistido" pode
// ser de um ep diferente do que abriu o player. APK antigo não manda → undefined.
interface PlayResult { positionMs: number; url?: string; next?: boolean; server?: boolean; recapture?: boolean; watched?: boolean; watchedKey?: string }

interface NativePlayerPlugin {
  play(opts: PlayOpts): Promise<PlayResult>;
  loadNext(opts: Partial<PlayOpts>): Promise<{ ok: boolean }>;
  clearResume(opts: { key: string }): Promise<void>;
  castStatus(): Promise<CastStatus>;
  ackTvProgress(opts: { ts: number }): Promise<void>;
  pendingExits(): Promise<{ exits?: AppExit[] }>;
  ackExits(opts: { ts: number }): Promise<void>;
  addListener(event: 'playerNext', cb: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerProgress', cb: (d: { url: string; positionMs: number; durationMs?: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerQuality', cb: (d: { url: string; quality: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerWatched', cb: (d: { watched: boolean; key?: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playerError', cb: (d: PlayerErrorEvent) => void): Promise<PluginListenerHandle>;
}

export interface PlayerErrorEvent {
  url?: string; code?: number; httpCode?: number; name?: string; cause?: string;
  mime?: string; referer?: string; title?: string;
}

// Um fechamento do app guardado pelo Android: `ts` = quando fechou, `reason` = código
// do ApplicationExitInfo (4 erro, 6 travou, 3 falta de memória…), `cause` = texto pronto.
export interface AppExit { ts: number; reason: number; cause: string }

const NativePlayer = registerPlugin<NativePlayerPlugin>('NativePlayer');

// Fechamentos do app (erro, travamento, sistema) que a aba Bugs ainda não recebeu: o
// processo que morre não consegue gravar a própria linha. APK antigo → lista vazia.
export async function pendingAppExits(): Promise<AppExit[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    return (await NativePlayer.pendingExits()).exits ?? [];
  } catch {
    return [];
  }
}

// Confirma até este fechamento — o nativo não manda de novo.
export function ackAppExits(ts: number): void {
  if (!Capacitor.isNativePlatform()) return;
  NativePlayer.ackExits({ ts }).catch(() => {});
}

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

// "Assistido" vindo do player nativo (botão, ou faltando 1 min pro fim). `key` diz
// de qual episódio — sem ela a marcação caía no ep que abriu o player.
export function onPlayerWatched(cb: (d: { watched: boolean; key?: string }) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return NativePlayer.addListener('playerWatched', cb);
}

// Erro de reprodução do player nativo (código/causa reais) → registrar no banco.
export function onPlayerError(cb: (d: PlayerErrorEvent) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return NativePlayer.addListener('playerError', cb);
}

// "Próximo episódio" tocado DENTRO do player nativo: ele não fecha mais: pede o
// link do próximo ep e espera o loadNextNative. Se ninguém responder em ~9s, ele
// cai sozinho no fluxo antigo (fecha devolvendo next).
// `auto` = veio do minuto final (auto-avanço): o JS só deve avançar se o próximo ep já
// tem link capturado/baixado; senão responde loadNextNative({}) e o player fica no ep.
export function onPlayerNext(cb: (e?: { auto?: boolean }) => void): Promise<PluginListenerHandle> | null {
  if (!Capacitor.isNativePlatform()) return null;
  return NativePlayer.addListener('playerNext', cb);
}

// Entrega o próximo episódio pro player que JÁ ESTÁ ABERTO (mantém o espelhamento
// na TV vivo). Sem url = "não achei link" → o player usa o fluxo antigo.
export async function loadNextNative(opts: Partial<PlayOpts>): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const r = await NativePlayer.loadNext(opts);
    return !!r?.ok;
  } catch {
    return false;
  }
}

// Apaga a posição salva NATIVA de um episódio (o player guarda em SharedPreferences
// além do streamCache). Usado ao avançar: o ep seguinte começa do zero.
export async function clearResumeNative(key: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try { await NativePlayer.clearResume({ key }); } catch { /* ignore */ }
}

// O que está espelhando na TV agora (ou null). A key é `tmdbId:type:season:ep` —
// é ela que permite reabrir exatamente o mesmo episódio pelo atalho do topo.
export interface CastNow { tmdbId: number; type: 'movie' | 'tv'; season: number; episode: number; title?: string }

// `positionMs`/`durationMs` = tempo da TV agora; `lastTv` = o último gravado com o player fechado (a TV parou ou
// caiu com o app no fundo). APK antigo não manda nenhum dos dois.
interface TvProgress { key: string; positionMs: number; durationMs?: number; ts: number }
interface CastStatus { active: boolean; key?: string | null; title?: string | null; positionMs?: number; durationMs?: number; lastTv?: TvProgress | null }

// `progressed` = gravou tempo da TV no "continuar" (a tela do título redesenha com ele).
export async function getCastNow(): Promise<{ now: CastNow | null; progressed: boolean }> {
  if (!Capacitor.isNativePlatform()) return { now: null, progressed: false };
  try {
    const s = await NativePlayer.castStatus();
    const progressed = syncTvProgress(s);
    if (!s?.active || !s.key) return { now: null, progressed };
    const [id, type, season, ep] = s.key.split(':');
    const tmdbId = Number(id);
    if (!tmdbId || (type !== 'movie' && type !== 'tv')) return { now: null, progressed };
    return { now: { tmdbId, type, season: Number(season) || 0, episode: Number(ep) || 0, title: s.title || undefined }, progressed };
  } catch {
    return { now: null, progressed: false };
  }
}

// Tempo da TV no "continuar" do título (25/09/2026: a TV foi até 36:50 com o player fechado e a tela seguia em 28:52).
// O último gravado com o player fechado é confirmado pro nativo não mandar de novo.
function syncTvProgress(s: CastStatus): boolean {
  let ok = false;
  if (s?.active && s.key && s.positionMs) ok = applyTvPosition(s.key, s.positionMs, s.durationMs, Date.now());
  const t = s?.lastTv;
  if (t?.key && t.ts) {
    ok = applyTvPosition(t.key, t.positionMs, t.durationMs, t.ts) || ok;
    NativePlayer.ackTvProgress({ ts: t.ts }).catch(() => {});
  }
  return ok;
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
