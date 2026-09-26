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
const waiters = new Map<string, () => void>();        // id do pedido → resolve quando a TV responde
let onCmd: ((cmd: TvCmd) => void) | null = null;      // só na TV

function connect(uid: string) {
  if (conn && conn.uid === uid) return conn;
  if (conn) void supabase.removeChannel(conn.ch);
  const ch = supabase.channel(topicFor(uid), { config: { private: true, broadcast: { self: false, ack: true } } });
  ch.on('broadcast', { event: 'ack' }, ({ payload }) => {
    const w = waiters.get(payload?.id);
    if (w) { waiters.delete(payload.id); w(); }
  });
  ch.on('broadcast', { event: 'cmd' }, ({ payload }) => onCmd?.(payload as TvCmd));
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

// Celular: manda o pedido pra TV `cmd.to` e espera ela responder.
export async function sendToTv(uid: string, cmd: TvCmd, ackTimeoutMs = ACK_TIMEOUT_MS): Promise<SendResult> {
  const c = connect(uid);
  const joined = await Promise.race([c.ready, sleep(JOIN_TIMEOUT_MS).then(() => false)]);
  if (!joined) return 'offline';
  let answered!: () => void;
  const ack = new Promise<boolean>(res => { answered = () => res(true); });
  waiters.set(cmd.id, answered);
  try {
    const r = await c.ch.send({ type: 'broadcast', event: 'cmd', payload: cmd });
    if (r !== 'ok') return 'offline';
    return (await Promise.race([ack, sleep(ackTimeoutMs).then(() => false)])) ? 'ok' : 'no_answer';
  } finally {
    waiters.delete(cmd.id);
  }
}

// TV: escuta os pedidos pra ESTA sessão. `handle` devolve true quando atendeu (aí a TV responde "recebi");
// false = não atende (app no fundo) e o celular mostra que ela está desligada.
export function listenAsTv(uid: string, mySessionId: string, handle: (cmd: TvCmd) => Promise<boolean>): () => void {
  const vistos: string[] = [];
  onCmd = (cmd) => {
    if (!cmd || cmd.to !== mySessionId || typeof cmd.id !== 'string' || vistos.includes(cmd.id)) return;
    vistos.push(cmd.id);
    if (vistos.length > 20) vistos.shift();
    void handle(cmd).then(ok => {
      if (ok && conn) void conn.ch.send({ type: 'broadcast', event: 'ack', payload: { id: cmd.id } });
    }).catch(() => undefined);
  };
  connect(uid);
  // Canal caiu com erro (sem rede, token trocado no meio): volta sozinho.
  const timer = setInterval(() => { if (!conn) connect(uid); }, RETRY_MS);
  return () => {
    clearInterval(timer);
    onCmd = null;
    if (conn) { void supabase.removeChannel(conn.ch); conn = null; }
  };
}
