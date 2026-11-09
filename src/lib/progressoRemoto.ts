import type { ProgressoRemoto, WatchItem } from '@/types/watch';
import { adotarPosicao, latestPosition, posicaoLocal, posicoesDaSerie } from '@/lib/streamCache';

// O minuto onde parou valendo em todos os aparelhos (pedido dele 09/11/2026 — "Quer que o minuto onde você parou passe a
// valer em todos os aparelhos?" → "1", filme e série). Antes a posição dentro do episódio/filme ficava só no aparelho
// (streamCache + SharedPreferences do player): o E28 do Re:Zero parou nos ~14 min na Fire TV e o projetor abriu o E28 do
// zero. Agora cada aparelho grava o último ponto tocado no banco (`wm_items.progress`) e, ao abrir, vale o mais novo
// entre o deste aparelho e o do banco.

export const GRAVAR_A_CADA_MS = 30_000;   // tocando: no máximo uma gravação a cada 30 s por título
export const POSICAO_MINIMA_MS = 3_000;   // até 3 s não conta (igual ao player)

const numero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** O que veio do banco (jsonb) → ponto válido, ou null (vazio, torto ou de versão futura sem os campos). */
export function normalizarProgresso(raw: unknown): ProgressoRemoto | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!numero(r.s) || !numero(r.e) || !numero(r.pos) || !numero(r.ts)) return null;
  const p: ProgressoRemoto = { s: Math.floor(r.s), e: Math.floor(r.e), pos: Math.round(r.pos), ts: Math.round(r.ts) };
  if (numero(r.dur) && r.dur > 0) p.dur = Math.round(r.dur);
  return p;
}

export interface UltimaGravacao { s: number; e: number; pos: number; em: number; dur?: number }

/**
 * Grava agora? Trocou de episódio = sim; parado no mesmo ponto (pausa) = não; senão no máximo a cada 30 s — e sempre que
 * o player fecha (`final`). Até 3 s não grava (abriu e fechou não apaga o ponto bom que já está no banco).
 */
export function deveGravar(ultima: UltimaGravacao | undefined, p: Pick<ProgressoRemoto, 's' | 'e' | 'pos'>, agora: number, final: boolean): boolean {
  if (!(p.pos > POSICAO_MINIMA_MS)) return false;
  if (!ultima || ultima.s !== p.s || ultima.e !== p.e) return true;
  if (Math.abs(p.pos - ultima.pos) < 1000) return false;
  return final || agora - ultima.em >= GRAVAR_A_CADA_MS;
}

export interface Posicao { season: number; episode: number; positionMs: number; durationMs?: number; ts: number }

/**
 * Onde o título parou: o ponto mais novo entre o deste aparelho e o do banco (que pode ter vindo de outro aparelho).
 * `ts` = hora da última atividade daquele ponto — o Continuar compara com a última atividade gravada no banco.
 */
export function posicaoAtual(item: Pick<WatchItem, 'tmdbId' | 'progress'> | null | undefined): Posicao | null {
  if (!item || item.tmdbId == null) return null;
  const local = latestPosition(item.tmdbId);
  const doLocal = local ? { season: local.season, episode: local.episode, positionMs: local.positionMs, durationMs: local.durationMs, ts: local.ts } : null;
  const r = normalizarProgresso(item.progress);
  if (!r || !(r.pos > POSICAO_MINIMA_MS)) return doLocal;
  if (local && local.posTs >= r.ts) return doLocal;
  return { season: r.s, episode: r.e, positionMs: r.pos, durationMs: r.dur, ts: r.ts };
}

/**
 * O ponto do banco vira a posição deste aparelho? Só se for DESTE episódio/filme, passar de 3 s e ser mais novo que a
 * posição daqui. Já assistido não adota: o ponto guardado é o do fim (abriria nos créditos e a contagem pularia).
 */
export function deveAdotar(
  r: ProgressoRemoto | null,
  alvo: { s: number; e: number },
  local: { positionMs: number; posTs: number } | null,
  assistido: boolean,
): boolean {
  if (!r || assistido) return false;
  if (r.s !== alvo.s || r.e !== alvo.e) return false;
  if (!(r.pos > POSICAO_MINIMA_MS)) return false;
  if (local && local.positionMs > POSICAO_MINIMA_MS && local.posTs >= r.ts) return false;
  return true;
}

/**
 * Antes de abrir o episódio/filme: se o banco tem um ponto mais novo dele, o player abre ali. `limparNativo` apaga a
 * posição própria do player do APK (SharedPreferences), que senão ganharia da que vai na abertura.
 */
export function adotarProgressoRemoto(
  item: Pick<WatchItem, 'progress'> | null | undefined,
  tmdbId: number,
  type: 'movie' | 'tv',
  season: number | undefined,
  episode: number | undefined,
  assistido: boolean,
  limparNativo?: (key: string) => unknown,
): boolean {
  const r = normalizarProgresso(item?.progress);
  const s = type === 'tv' ? (season ?? 0) : 0;
  const e = type === 'tv' ? (episode ?? 0) : 0;
  if (!deveAdotar(r, { s, e }, posicaoLocal(tmdbId, type, s, e), assistido)) return false;
  adotarPosicao(r!.pos, tmdbId, type, s, e, r!.dur, r!.ts);
  limparNativo?.(`${tmdbId}:${type}:${s}:${e}`);
  return true;
}

/** Barras do painel "Episódios" do player: as posições daqui + o ponto do banco quando ele é mais novo. */
export function posicoesComRemoto(item: Pick<WatchItem, 'progress'> | null | undefined, tmdbId: number): Record<string, { positionMs: number; durationMs?: number }> {
  const out = posicoesDaSerie(tmdbId);
  const r = normalizarProgresso(item?.progress);
  if (!r || r.s <= 0 || r.e <= 0 || !(r.pos > POSICAO_MINIMA_MS)) return out;
  const local = posicaoLocal(tmdbId, 'tv', r.s, r.e);
  if (!local || !(local.positionMs > POSICAO_MINIMA_MS) || local.posTs < r.ts) out[`${r.s}:${r.e}`] = { positionMs: r.pos, durationMs: r.dur };
  return out;
}
