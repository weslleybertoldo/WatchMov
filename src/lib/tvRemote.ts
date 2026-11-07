// Enviar pra TV (pedido dele 26/09/2026): o celular manda "abrir este título" pro app da TV escolhida e a TV,
// com o WatchMov na frente, abre a página e responde. Canal privado do Realtime `wm-tv:<user_id>`: só quem está
// logado nesta conta entra (policies em realtime.messages, migration 20260926_wm_tv_remote.sql).
// Cada TV é a sessão do Supabase dela (claim session_id do JWT = wm_tv_devices.session_id).
// Sem resposta no prazo = TV desligada ou com o app fechado/no fundo.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { MediaSummary } from '@/lib/tmdb';

export type TvCmd =
  | { id: string; to: string; action: 'open'; media: MediaSummary }
  | { id: string; to: string; action: 'logout' };

// ok = a TV abriu · no_answer = a TV não respondeu · offline = este aparelho não conseguiu falar no canal
export type SendResult = 'ok' | 'no_answer' | 'offline';

// Controle remoto (pedido dele 07/11/2026): as teclas vão no evento 'ctl' do MESMO canal. Evento novo de propósito: a TV
// com o app antigo só escuta 'cmd' e ignora o 'ctl' (se fosse 'cmd', ela tratava a tecla como "abrir título" e fechava
// o player). 'ping' só pergunta se o WatchMov está aberto e o que está tocando; a resposta vem no próprio ack.
export type TeclaControle =
  | 'up' | 'down' | 'left' | 'right' | 'ok' | 'ok-hold' | 'back' | 'home'
  | 'rew' | 'ff' | 'playpause' | 'prev-ep' | 'next-ep' | 'watched';
export interface TocandoNaTv {
  title: string;
  season?: number;
  episode?: number;
  positionMs?: number;
  durationMs?: number;
  playing?: boolean;
  posterUrl?: string;
}
export type CtlCmd =
  | { id: string; to: string; action: 'key'; key: TeclaControle }
  | { id: string; to: string; action: 'ping' };
export interface CtlResposta { tocando?: TocandoNaTv | null }
export const CTL_ACK_MS = 2500;

export const ACK_TIMEOUT_MS = 6000;
const JOIN_TIMEOUT_MS = 6000;
const RETRY_MS = 10000;

export const topicFor = (uid: string) => `wm-tv:${uid}`;

// session_id do JWT do Supabase. Sem ele não dá pra saber qual TV é esta.
export function sessionIdOf(jwt: string | null | undefined): string | null {
  try {
    const b = (jwt || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
    return typeof claims.session_id === 'string' ? claims.session_id : null;
  } catch {
    return null;
  }
}

export function newCmdId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Um canal por conta, reaproveitado: o realtime-js devolve o MESMO canal pro mesmo tópico, então abrir/fechar
// a cada envio quebrava dois envios seguidos. Erro no canal = esquece e o próximo uso abre de novo.
let conn: { uid: string; ch: RealtimeChannel; ready: Promise<boolean> } | null = null;
const waiters = new Map<string, (resposta: Record<string, unknown>) => void>();   // id do pedido → TV respondeu
let onCmd: ((cmd: TvCmd) => void) | null = null;      // só na TV
let onCtl: ((cmd: CtlCmd) => void) | null = null;     // só na TV (controle remoto)

function connect(uid: string) {
  if (conn && conn.uid === uid) return conn;
  if (conn) void supabase.removeChannel(conn.ch);
  const ch = supabase.channel(topicFor(uid), { config: { private: true, broadcast: { self: false, ack: true } } });
  ch.on('broadcast', { event: 'ack' }, ({ payload }) => {
    const w = waiters.get(payload?.id);
    if (w) { waiters.delete(payload.id); w(payload ?? {}); }
  });
  ch.on('broadcast', { event: 'cmd' }, ({ payload }) => onCmd?.(payload as TvCmd));
  ch.on('broadcast', { event: 'ctl' }, ({ payload }) => onCtl?.(payload as CtlCmd));
  const ready = new Promise<boolean>(resolve => {
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') { resolve(true); return; }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        resolve(false);
        if (conn?.ch === ch) { conn = null; void supabase.removeChannel(ch); }
      }
    });
  });
  conn = { uid, ch, ready };
  return conn;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Manda no canal e espera a TV responder (o ack pode trazer dados, ex.: o que está tocando).
async function enviar(uid: string, event: 'cmd' | 'ctl', cmd: TvCmd | CtlCmd, ackTimeoutMs: number):
  Promise<{ result: SendResult; resposta?: Record<string, unknown> }> {
  const c = connect(uid);
  const joined = await Promise.race([c.ready, sleep(JOIN_TIMEOUT_MS).then(() => false)]);
  if (!joined) return { result: 'offline' };
  let answered!: (r: Record<string, unknown>) => void;
  const ack = new Promise<Record<string, unknown>>(res => { answered = res; });
  waiters.set(cmd.id, answered);
  try {
    const r = await c.ch.send({ type: 'broadcast', event, payload: cmd });
    if (r !== 'ok') return { result: 'offline' };
    const resposta = await Promise.race([ack, sleep(ackTimeoutMs).then(() => null)]);
    return resposta ? { result: 'ok', resposta } : { result: 'no_answer' };
  } finally {
    waiters.delete(cmd.id);
  }
}

// Celular: manda o pedido pra TV `cmd.to` e espera ela responder.
export async function sendToTv(uid: string, cmd: TvCmd, ackTimeoutMs = ACK_TIMEOUT_MS): Promise<SendResult> {
  return (await enviar(uid, 'cmd', cmd, ackTimeoutMs)).result;
}

// Celular (controle remoto): manda a tecla/ping e devolve se a TV atendeu e o que ela está tocando.
export async function mandarControle(uid: string, cmd: CtlCmd, ackTimeoutMs = CTL_ACK_MS):
  Promise<{ result: SendResult; tocando?: TocandoNaTv | null }> {
  const { result, resposta } = await enviar(uid, 'ctl', cmd, ackTimeoutMs);
  return result === 'ok' ? { result, tocando: (resposta?.tocando as TocandoNaTv | null | undefined) ?? null } : { result };
}

// TV: escuta os pedidos pra ESTA sessão. `handle` devolve true quando atendeu (aí a TV responde "recebi");
// false = não atende (app no fundo) e o celular mostra que ela está desligada. `handleCtl` (controle remoto) devolve a
// resposta que vai junto do ack (o que está tocando) ou false.
export function listenAsTv(uid: string, mySessionId: string, handle: (cmd: TvCmd) => Promise<boolean>,
  handleCtl?: (cmd: CtlCmd) => Promise<CtlResposta | false>): () => void {
  const vistos: string[] = [];
  const novo = (c: { id?: unknown; to?: unknown } | null): c is { id: string; to: string } => {
    if (!c || c.to !== mySessionId || typeof c.id !== 'string' || vistos.includes(c.id)) return false;
    vistos.push(c.id);
    if (vistos.length > 40) vistos.shift();
    return true;
  };
  const responder = (id: string, extra: Record<string, unknown> = {}) => {
    if (conn) void conn.ch.send({ type: 'broadcast', event: 'ack', payload: { id, ...extra } });
  };
  onCmd = (cmd) => {
    if (!novo(cmd)) return;
    void handle(cmd).then(ok => { if (ok) responder(cmd.id); }).catch(() => undefined);
  };
  onCtl = !handleCtl ? null : (cmd) => {
    if (!novo(cmd)) return;
    void handleCtl(cmd).then(r => { if (r) responder(cmd.id, { tocando: r.tocando ?? null }); }).catch(() => undefined);
  };
  connect(uid);
  // Canal caiu com erro (sem rede, token trocado no meio): volta sozinho.
  const timer = setInterval(() => { if (!conn) connect(uid); }, RETRY_MS);
  return () => {
    clearInterval(timer);
    onCmd = null;
    onCtl = null;
    if (conn) { void supabase.removeChannel(conn.ch); conn = null; }
  };
}
