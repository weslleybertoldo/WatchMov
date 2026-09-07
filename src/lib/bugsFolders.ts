// Aba Bugs em pastas: título → (episódio | dia) → registros. Funções puras (sem
// React) pra dar pra testar sem montar a tela.

export interface BugRow {
  id: string;
  created_at: string;
  title: string | null;
  error_code: number | null;
  error_name: string | null;
}

export type TitleKind = 'tv' | 'movie';

export interface ParsedTitle {
  /** Pasta de 1º nível: nome da série ou do filme. */
  show: string;
  kind: TitleKind;
  /** "T1 E49" — só série. */
  ep: string | null;
}

// Título que o player nativo manda: série = "Nome — T1 E49" (o baixado pode vir com
// sufixo de arquivo: "Nome — T1 E25 - T1E25.mp4"); registro antigo = chave cru
// "e:<tmdb>:<temporada>:<episódio>". Qualquer outra coisa é filme.
const EP_RE = /^(.*?)\s+—\s+T(\d+)\s+E(\d+)\b/;
const KEY_RE = /^e:(\d+):(\d+):(\d+)$/;

export function parseTitle(title: string | null | undefined): ParsedTitle {
  const t = (title ?? '').trim();
  if (!t) return { show: 'Sem título', kind: 'movie', ep: null };
  const m = EP_RE.exec(t);
  if (m) return { show: m[1], kind: 'tv', ep: `T${Number(m[2])} E${Number(m[3])}` };
  const k = KEY_RE.exec(t);
  if (k) return { show: `Série #${k[1]}`, kind: 'tv', ep: `T${Number(k[2])} E${Number(k[3])}` };
  return { show: t, kind: 'movie', ep: null };
}

// Falha de verdade (o link não abriu / a TV não respondeu) vs. registro de
// diagnóstico (PLAYER_START, SEEK_*, CAST_*…, sempre código 0).
const FAIL_NAME = /ERROR_|FALHOU|TRAVADA|PAROU|EXPORT_MP4/;
export function isRealError(r: Pick<BugRow, 'error_code' | 'error_name'>): boolean {
  if (r.error_code != null && r.error_code !== 0) return true;
  return FAIL_NAME.test(r.error_name ?? '');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Dia LOCAL (fuso do aparelho) como "YYYY-MM-DD" — as pastas de filme e o filtro
 *  usam o dia que a pessoa viu na tela, não o UTC do banco. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY". */
export function fmtDay(key: string): string {
  const [y, m, d] = key.split('-');
  return y && m && d ? `${d}/${m}/${y}` : key;
}

/** Limites do filtro por data (dias locais, inclusivos) em ISO pro banco:
 *  `from` = 00:00 do 1º dia; `toExclusive` = 00:00 do dia SEGUINTE ao último. */
export function rangeBounds(from: string, to: string): { from: string | null; toExclusive: string | null } {
  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);
  const iso = (d: Date | null) => (d && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
  return { from: iso(start), toExclusive: iso(end) };
}

export interface Entry<R extends BugRow = BugRow> { row: R; p: ParsedTitle }

export function toEntries<R extends BugRow>(rows: R[]): Entry<R>[] {
  return rows.map(row => ({ row, p: parseTitle(row.title) }));
}

export interface Folder {
  key: string;
  label: string;
  /** tv/movie = 1º nível; ep = episódio de série; day = dia de filme. */
  kind: TitleKind | 'ep' | 'day';
  /** Registros dentro da pasta. */
  count: number;
  /** Falhas de verdade dentro da pasta (isRealError), no total. */
  errors: number;
  /** Falhas na ÚLTIMA reprodução (lastSession) — é o que a tag "sem erro"/"N erros" mostra. */
  lastErrors: number;
  /** created_at mais recente (ISO) — ordena "últimos primeiro". */
  last: string;
  /** Subpastas (episódios ou dias) — só no 1º nível. */
  subs: number;
}

const ts = (iso: string) => Date.parse(iso) || 0;
const byLastDesc = (a: Folder, b: Folder) => ts(b.last) - ts(a.last);

/** Início de uma reprodução: o player nativo grava PLAYER_START toda vez que abre ou
 *  troca de mídia (inclusive no "Próximo" e ao reabrir espelhando). */
export const SESSION_START = 'PLAYER_START';

/** Registros da ÚLTIMA reprodução (a tag da pasta é dela, não da soma histórica — pedido
 *  07/09/2026): do último PLAYER_START (inclusive; empate de horário entra) até o registro
 *  mais recente. Sem PLAYER_START (registro antigo, ou o filtro por data cortou o início):
 *  os do mesmo dia local do registro mais recente. Devolve do mais antigo pro mais novo. */
export function lastSession<R extends BugRow>(rows: R[]): R[] {
  if (!rows.length) return [];
  const asc = [...rows].sort((a, b) => ts(a.created_at) - ts(b.created_at));
  for (let i = asc.length - 1; i >= 0; i--) {
    if (asc[i].error_name === SESSION_START) {
      const t0 = ts(asc[i].created_at);
      return asc.filter(r => ts(r.created_at) >= t0);
    }
  }
  const day = dayKey(asc[asc.length - 1].created_at);
  return asc.filter(r => dayKey(r.created_at) === day);
}

const countErrors = (rows: Pick<BugRow, 'error_code' | 'error_name'>[]) => rows.filter(isRealError).length;

/** Tipo da pasta de um título: série se QUALQUER registro dele tiver episódio. */
export function kindOf(entries: Entry[], show: string): TitleKind {
  return entries.some(e => e.p.show === show && e.p.kind === 'tv') ? 'tv' : 'movie';
}

/** Chave da subpasta: episódio (série) ou dia (filme). */
export function subKeyOf(e: Entry, kind: TitleKind): string {
  return kind === 'tv' ? (e.p.ep ?? 'Sem episódio') : dayKey(e.row.created_at);
}

interface Bucket { f: Folder; rows: BugRow[]; subKeys: Set<string> }

function bucket(key: string, label: string, kind: Folder['kind'], first: BugRow): Bucket {
  return { f: { key, label, kind, count: 0, errors: 0, lastErrors: 0, last: first.created_at, subs: 0 }, rows: [], subKeys: new Set() };
}

/** Fecha as contas da pasta: total, erros no total, erros na última reprodução, mais recente. */
function close({ f, rows, subKeys }: Bucket): Folder {
  let last = f.last;
  for (const r of rows) if (ts(r.created_at) > ts(last)) last = r.created_at;
  return { ...f, count: rows.length, errors: countErrors(rows), lastErrors: countErrors(lastSession(rows)), last, subs: subKeys.size };
}

/** 1º nível: uma pasta por título, da mais recente pra mais antiga. */
export function rootFolders(entries: Entry[]): Folder[] {
  const kinds = new Map<string, TitleKind>();
  for (const e of entries) if (e.p.kind === 'tv' || !kinds.has(e.p.show)) kinds.set(e.p.show, e.p.kind);
  const map = new Map<string, Bucket>();
  for (const e of entries) {
    const kind = kinds.get(e.p.show) ?? 'movie';
    let b = map.get(e.p.show);
    if (!b) { b = bucket(e.p.show, e.p.show, kind, e.row); map.set(e.p.show, b); }
    b.rows.push(e.row);
    b.subKeys.add(subKeyOf(e, kind));
  }
  return [...map.values()].map(close).sort(byLastDesc);
}

/** 2º nível de um título: episódios (série) ou dias (filme), mais recente primeiro. */
export function subFolders(entries: Entry[], show: string): Folder[] {
  const kind = kindOf(entries, show);
  const map = new Map<string, Bucket>();
  for (const e of entries) {
    if (e.p.show !== show) continue;
    const key = subKeyOf(e, kind);
    let b = map.get(key);
    if (!b) { b = bucket(key, kind === 'tv' ? key : fmtDay(key), kind === 'tv' ? 'ep' : 'day', e.row); map.set(key, b); }
    b.rows.push(e.row);
  }
  return [...map.values()].map(close).sort(byLastDesc);
}

/** 3º nível: os registros de uma subpasta, mais recente primeiro. */
export function folderRows<R extends BugRow>(entries: Entry<R>[], show: string, sub: string): R[] {
  const kind = kindOf(entries, show);
  return entries
    .filter(e => e.p.show === show && subKeyOf(e, kind) === sub)
    .map(e => e.row)
    .sort((a, b) => ts(b.created_at) - ts(a.created_at));
}
