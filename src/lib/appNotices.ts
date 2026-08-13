import { useEffect, useReducer } from 'react';
import { supabase } from '@/lib/supabase';

// Central de avisos do app (o sino no topo). Os toasts passam e somem; aqui fica o
// registro — download concluído, MP4 pronto, conversão na fila ou falhada.
// Guardado em localStorage (funciona offline) e espelhado por usuário na tabela
// wm_notices: o web vê o que o APK gerou e vice-versa (sync em segundo plano).

// Uma aba por tipo na tela do sino: lançamentos, downloads e conversões.
export type NoticeKind = 'release' | 'download' | 'mp4';

export interface Notice {
  id: string;
  at: number;          // epoch ms
  kind: NoticeKind;
  title: string;
  body?: string;
  error?: boolean;     // falhou (aparece na aba do tipo, marcado em vermelho)
  read?: boolean;
  ref?: string;        // mesma tarefa (ex. "mp4:e:123:2:5") → o aviso é SUBSTITUÍDO
}

const KEY = 'watchmov_notices';
const MAX = 60;        // histórico curto: é aviso, não log

const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());

function read(): Notice[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list: Notice[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* cota cheia */ }
  notify();
}

export function addNotice(n: { kind: NoticeKind; title: string; body?: string; error?: boolean }) {
  const list = read();
  const at = Date.now();
  // Mesmo aviso repetido em sequência (ex. reenvio do evento) não duplica.
  if (list[0] && list[0].title === n.title && list[0].body === n.body && at - list[0].at < 15000) return;
  const novo: Notice = { id: `${at}-${Math.round(Math.random() * 1e6)}`, at, read: false, ...n };
  write([novo, ...list]);
  pushRemote(novo);
}

/**
 * Aviso da MESMA tarefa: substitui o anterior em vez de empilhar. "Convertendo X"
 * vira "Conversão de X concluída" na mesma linha — sem deixar um progresso morto
 * no histórico.
 */
export function upsertNotice(ref: string, n: { kind: NoticeKind; title: string; body?: string; error?: boolean }) {
  const list = read().filter(x => x.ref !== ref);
  const at = Date.now();
  const novo: Notice = { id: `${ref}-${at}`, at, read: false, ref, ...n };
  write([novo, ...list]);
  pushRemote(novo);
}

export function getNotices(): Notice[] { return read(); }
export function unreadCount(): number { return read().filter(n => !n.read).length; }
export function markAllRead() {
  write(read().map(n => ({ ...n, read: true })));
  void remote(async () => { await supabase.from('wm_notices').update({ read: true }).eq('read', false); });
}
export function clearNotices() {
  write([]);
  void remote(async () => { await supabase.from('wm_notices').delete().neq('id', ''); });
}

export function useNotices(): { list: Notice[]; unread: number } {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { subs.add(force); void syncNotices(); return () => { subs.delete(force); }; }, []);
  const list = read();
  return { list, unread: list.filter(n => !n.read).length };
}

// ---------- Sincronização entre aparelhos (wm_notices, RLS por user_id) ----------
// O localStorage continua mandando na UI (offline-first); o banco é o espelho.
// Toda escrita remota é fire-and-forget: sem sessão/sem rede = fica só no local
// e o syncNotices() sobe o que faltar na próxima abertura.

type Row = { id: string; at: string; kind: NoticeKind; title: string; body: string | null; error: boolean; read: boolean; ref: string | null };

const toRow = (n: Notice) => ({
  id: n.id, at: new Date(n.at).toISOString(), kind: n.kind, title: n.title,
  body: n.body ?? null, error: !!n.error, read: !!n.read, ref: n.ref ?? null,
});
const fromRow = (r: Row): Notice => ({
  id: r.id, at: Date.parse(r.at), kind: r.kind, title: r.title,
  body: r.body ?? undefined, error: r.error || undefined, read: r.read, ref: r.ref ?? undefined,
});

// Roda a operação só se houver sessão; erro nunca sobe pra UI de avisos.
async function remote(fn: () => Promise<unknown>) {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) await fn();
  } catch { /* offline/sem sessão: o local segue valendo */ }
}

function pushRemote(n: Notice) {
  void remote(async () => {
    // Aviso da mesma tarefa substitui o anterior também no banco.
    if (n.ref) await supabase.from('wm_notices').delete().eq('ref', n.ref).neq('id', n.id);
    await supabase.from('wm_notices').upsert(toRow(n));
  });
}

let lastSync = 0;
/** Puxa os avisos do usuário, sobe os que só existem aqui e mescla no local. */
export async function syncNotices() {
  if (Date.now() - lastSync < 60_000) return;   // sync barato, mas não a cada render
  lastSync = Date.now();
  await remote(async () => {
    const { data, error } = await supabase.from('wm_notices')
      .select('*').order('at', { ascending: false }).limit(MAX);
    if (error || !data) return;
    const remoto = (data as Row[]).map(fromRow);
    const local = read();
    const idsRemotos = new Set(remoto.map(n => n.id));
    const refMaisNovo = new Map<string, number>();
    for (const n of [...remoto, ...local]) if (n.ref) refMaisNovo.set(n.ref, Math.max(refMaisNovo.get(n.ref) ?? 0, n.at));
    // Sobe o que nasceu offline — a não ser que outro aparelho já tenha um
    // aviso mais novo da MESMA tarefa (ref): aí o daqui foi substituído.
    for (const n of local) {
      if (idsRemotos.has(n.id)) continue;
      if (n.ref && (refMaisNovo.get(n.ref) ?? 0) > n.at) continue;
      pushRemote(n);
    }
    // Mescla: união por id (banco vence — carrega o "lido" de outro aparelho),
    // por ref só o mais novo, ordena e corta no histórico.
    const porId = new Map<string, Notice>();
    for (const n of [...remoto, ...local]) if (!porId.has(n.id)) porId.set(n.id, n);
    const mesclado = [...porId.values()]
      .filter(n => !n.ref || n.at === refMaisNovo.get(n.ref))
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX);
    write(mesclado);
  });
}

// "agora", "há 5 min", "ontem 21:40" — o suficiente pra situar o aviso.
export function noticeWhen(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  const d = new Date(at);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  if (mesmoDia) return hhmm;
  const ontem = new Date(Date.now() - 86400000).toDateString() === d.toDateString();
  return ontem ? `ontem ${hhmm}` : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm}`;
}
