// Regras puras do player do app do Windows (W3, plano 07/11/2026) — as mesmas do player do APK (PlayerMarcas.java e
// PlayerActivity.java), pra o PC se comportar igual: pular abertura/resumo, contagem do próximo episódio, assistido,
// teclado, qualidade, áudio, legenda e quando pedir um link novo. Sem DOM: o componente (PlayerDesktop.tsx) só chama.
import type { SerieDoPlayer } from '@/lib/episodiosPlayer';
import { qualidadeDaImagem } from '@/lib/qualidade';
import { isExpiredUrl } from '@/lib/streamCache';

// ── marcas (abertura, resumo, créditos) ──────────────────────────────────────────────────────────────────────────────

/** Trecho [início, fim) em ms; fim -1 = até o fim do vídeo. */
export type Trecho = [number, number];
export interface Marcas { abertura: Trecho[]; resumo: Trecho[]; creditos: Trecho[] }
export const SEM_MARCAS: Marcas = { abertura: [], resumo: [], creditos: [] };

export const CONTAGEM_MS = 10_000;               // a contagem do próximo episódio dura 10 s
export const SEM_MAPA_FALTANDO_MS = 40_000;      // sem créditos mapeados, a contagem começa faltando 40 s
export const MARGEM_FIM_PULO_MS = 1_000;         // no último segundo do trecho o "Pular" some
export const PROXIMO_MARCA_FALTANDO_MS = 120_000;
export const ASSISTIDO_FALTANDO_MS = 60_000;

type Bruto = { start_ms?: unknown; end_ms?: unknown } | null | undefined;

// `start_ms` nulo = desde o começo; `end_ms` nulo = até o fim. Trecho sem tamanho é descartado.
function trechos(lista: Bruto[] | null | undefined): Trecho[] {
  if (!Array.isArray(lista)) return [];
  const out: Trecho[] = [];
  for (const t of lista) {
    if (!t || typeof t !== 'object') continue;
    const ini = t.start_ms == null ? 0 : typeof t.start_ms === 'number' ? t.start_ms : -1;
    const fim = t.end_ms == null ? -1 : typeof t.end_ms === 'number' ? t.end_ms : -2;
    if (ini < 0 || fim === -2 || (fim >= 0 && fim <= ini)) continue;
    out.push([ini, fim]);
  }
  return out;
}

/** Resposta da TheIntroDB (`/v3/media`): listas `intro`, `recap`, `credits`. JSON torto = sem marcas. */
export function marcasDaTheIntroDb(json: unknown): Marcas {
  if (!json || typeof json !== 'object') return SEM_MARCAS;
  const o = json as Record<string, Bruto[]>;
  return { abertura: trechos(o.intro), resumo: trechos(o.recap), creditos: trechos(o.credits) };
}

/** Resposta da IntroDB (`/segments`): cada trecho é UM objeto (ou null) e os créditos se chamam `outro`. */
export function marcasDaIntroDb(json: unknown): Marcas {
  if (!json || typeof json !== 'object') return SEM_MARCAS;
  const o = json as Record<string, Bruto>;
  return { abertura: trechos([o.intro]), resumo: trechos([o.recap]), creditos: trechos([o.outro]) };
}

/** Por trecho, vale o da TheIntroDB e a IntroDB completa o que faltar (pedido dele 18/10/2026). */
export function juntarMarcas(theIntroDb: Marcas, introDb: Marcas): Marcas {
  return {
    abertura: theIntroDb.abertura.length ? theIntroDb.abertura : introDb.abertura,
    resumo: theIntroDb.resumo.length ? theIntroDb.resumo : introDb.resumo,
    creditos: theIntroDb.creditos.length ? theIntroDb.creditos : introDb.creditos,
  };
}

/** "tmdbId:tv:temporada:ep" → [tmdb, temporada, ep]; filme ou chave torta = null (sem marcas). */
export function chaveDeSerie(chave: string | undefined): [number, number, number] | null {
  const m = /^(\d+):tv:(\d+):(\d+)$/.exec(chave ?? '');
  if (!m) return null;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  return v.every((n) => n > 0) ? v : null;
}

export const urlTheIntroDb = ([tmdb, t, e]: [number, number, number]) =>
  `https://api.theintrodb.org/v3/media?tmdb_id=${tmdb}&season=${t}&episode=${e}`;
export const urlIntroDb = (imdbId: string, [, t, e]: [number, number, number]) =>
  /^tt\d+$/.test(imdbId) ? `https://api.introdb.app/segments?imdb_id=${imdbId}&season=${t}&episode=${e}` : null;

// Trecho sem fim conhecido não vira "Pular": não dá pra saber pra onde ir.
const achar = (ts: Trecho[], pos: number) => ts.find(([a, b]) => b > 0 && pos >= a && pos < b - MARGEM_FIM_PULO_MS);

/** 'abertura' | 'resumo' quando a posição está num trecho que dá pra pular; senão null. */
export function tipoDoPulo(m: Marcas, posMs: number): 'abertura' | 'resumo' | null {
  if (achar(m.abertura, posMs)) return 'abertura';
  if (achar(m.resumo, posMs)) return 'resumo';
  return null;
}

/** Pra onde o "Pular" leva (fim do trecho em que a posição está); -1 = nada a pular. */
export function fimDoPulo(m: Marcas, posMs: number): number {
  return (achar(m.abertura, posMs) ?? achar(m.resumo, posMs))?.[1] ?? -1;
}

/**
 * Onde a contagem do próximo episódio começa: no início dos créditos quando eles estão mapeados e fazem sentido (depois
 * da metade e cabendo os 10 s antes do fim); senão faltando 40 s. -1 = vídeo curto demais.
 */
export function inicioDaContagem(m: Marcas, durMs: number): number {
  if (!(durMs > SEM_MAPA_FALTANDO_MS * 2)) return -1;
  const c = m.creditos.find(([a]) => a >= durMs / 2 && a <= durMs - CONTAGEM_MS);
  return c ? c[0] : durMs - SEM_MAPA_FALTANDO_MS;
}

export function naJanelaDaContagem(m: Marcas, posMs: number, durMs: number): boolean {
  const ini = inicioDaContagem(m, durMs);
  return ini >= 0 && posMs >= ini;
}

/** Pedir o próximo marca o atual como assistido? Na contagem ou faltando até 2 min (pedido dele 20/10/2026). */
export function proximoMarcaAssistido(m: Marcas, posMs: number, durMs: number): boolean {
  if (naJanelaDaContagem(m, posMs, durMs)) return true;
  return durMs > PROXIMO_MARCA_FALTANDO_MS && posMs >= durMs - PROXIMO_MARCA_FALTANDO_MS;
}

/** Faltando 1 min o episódio/filme conta como assistido sozinho (igual ao APK). */
export function chegouNoAssistido(posMs: number, durMs: number): boolean {
  return durMs > ASSISTIDO_FALTANDO_MS && posMs >= durMs - ASSISTIDO_FALTANDO_MS;
}

/** Pra onde o botão "Assistido" pula (-1 = fica): com próximo, pro ponto da contagem; sem, faltando 1 min. */
export function pontoDoAssistido(m: Marcas, posMs: number, durMs: number, comProximo: boolean): number {
  let alvo = comProximo ? inicioDaContagem(m, durMs) : -1;
  if (alvo < 0 && durMs > ASSISTIDO_FALTANDO_MS) alvo = durMs - ASSISTIDO_FALTANDO_MS;
  return alvo > posMs ? alvo : -1;
}

// ── teclado ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AcaoDaTecla = 'play-pausa' | 'voltar' | 'avancar' | 'volume+' | 'volume-' | 'mudo' | 'tela-cheia' | 'proximo' | 'fechar';

/** Espaço/K, ←/→ (±10 s), ↑/↓ volume, M mudo, F tela cheia, N próximo, Esc fecha (fora da tela cheia: lá o Esc sai dela). */
export function acaoDaTecla(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }, telaCheia: boolean): AcaoDaTecla | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  switch (e.key) {
    case ' ': case 'k': case 'K': case 'MediaPlayPause': return 'play-pausa';
    case 'ArrowLeft': case 'j': case 'J': return 'voltar';
    case 'ArrowRight': case 'l': case 'L': return 'avancar';
    case 'ArrowUp': return 'volume+';
    case 'ArrowDown': return 'volume-';
    case 'm': case 'M': return 'mudo';
    case 'f': case 'F': return 'tela-cheia';
    case 'n': case 'N': case 'MediaTrackNext': return 'proximo';
    case 'Escape': return telaCheia ? null : 'fechar';
    default: return null;
  }
}

// ── qualidade, áudio e legenda (faixas do hls.js) ────────────────────────────────────────────────────────────────────

/** "Auto" + as qualidades (maior primeiro, sem repetir). `indice` = o nível do hls.js (-1 = automático). O rótulo é a
 *  classe da imagem (1920×804 = "1080p", src/lib/qualidade.ts); dois níveis com o mesmo rótulo ficam só com o maior. */
export function niveisDeQualidade(niveis: { height?: number; width?: number }[]): { indice: number; rotulo: string }[] {
  const vistos = new Set<string>();
  const out = niveis
    .map((n, indice) => ({ indice, h: n.height ?? 0, rotulo: qualidadeDaImagem(n.width, n.height) }))
    .filter(({ h }) => h > 0)
    .sort((a, b) => b.h - a.h)
    .filter(({ rotulo }) => !vistos.has(rotulo) && (vistos.add(rotulo), true))
    .map(({ indice, rotulo }) => ({ indice, rotulo }));
  return [{ indice: -1, rotulo: 'Auto' }, ...out];
}

const ehPt = (lang?: string, nome?: string) => /^pt|^por/i.test(lang ?? '') || /portugu|dublad|\bpt-?br\b/i.test(nome ?? '');

/** Índice da faixa de áudio que começa: a em português, se tiver; senão a padrão do arquivo (-1 = não troca). */
export function audioQueComeca(faixas: { lang?: string; name?: string; default?: boolean }[]): number {
  const pt = faixas.findIndex((f) => ehPt(f.lang, f.name));
  if (pt >= 0) return pt;
  return faixas.findIndex((f) => f.default);
}

/**
 * Legenda que liga sozinha (= PlayerActivity.flagsIgnoradasDaLegenda): a FORÇADA sempre (trechos em outra língua num
 * áudio dublado); a "padrão" só quando o áudio que toca NÃO é português. -1 = nenhuma. Português primeiro nas duas.
 */
export function legendaQueLiga(faixas: { lang?: string; name?: string; forced?: boolean; default?: boolean }[], audioEhPt: boolean): number {
  const melhor = (ok: (f: (typeof faixas)[number]) => boolean) => {
    const idx = faixas.map((f, i) => ({ f, i })).filter(({ f }) => ok(f));
    return (idx.find(({ f }) => ehPt(f.lang, f.name)) ?? idx[0])?.i ?? -1;
  };
  const forcada = melhor((f) => !!f.forced);
  if (forcada >= 0) return forcada;
  return audioEhPt ? -1 : melhor((f) => !!f.default || ehPt(f.lang, f.name));
}

export { ehPt as idiomaEhPt };

/** Nome da faixa de áudio/legenda no menu: o nome dela, senão a língua, senão "Faixa N"; a forçada avisa. */
export function rotuloDaFaixa(f: { lang?: string; name?: string; forced?: boolean }, i: number): string {
  const base = f.name?.trim() || f.lang?.trim() || `Faixa ${i + 1}`;
  return f.forced && !/forçad|forced/i.test(base) ? `${base} (forçada)` : base;
}

// ── servidores, links, recaptura ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Popup do servidor (= PlayerServidores.java): só "id|rótulo" com os dois lados (o app manda assim), sem repetir id.
 * Lista vazia = o botão abre a aba de servidores direto (resultado `server`).
 */
export function servidoresDoPlayer(lista: string[] | undefined): { id: string; rotulo: string }[] {
  const vistos = new Set<string>();
  const out: { id: string; rotulo: string }[] = [];
  for (const s of lista ?? []) {
    const i = typeof s === 'string' ? s.indexOf('|') : -1;
    if (i <= 0 || i === s.length - 1) continue;
    const id = s.slice(0, i);
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.push({ id, rotulo: s.slice(i + 1) });
  }
  return out;
}

/**
 * Próximo link depois que o de índice `falhou` caiu (= PlayerActivity.onPlayerError): segue PRA FRENTE na lista
 * (escolheu o 6 e falhou → 7, 8…, não volta pro 1), pulando os já tentados e os vencidos. Link fora da lista (-1)
 * começa do início. -1 = acabou a lista.
 */
export function proximoLinkAposFalha(urls: readonly string[] | undefined, falhou: number, tentados: ReadonlySet<string>, agoraMs: number): number {
  const lista = urls ?? [];
  for (let i = Math.max(falhou + 1, 0); i < lista.length; i++) {
    const u = lista[i];
    if (u && !tentados.has(u) && !isExpiredUrl(u, agoraMs)) return i;
  }
  return -1;
}

/**
 * Acabaram os links e o atual morreu: pedir um link NOVO ao app (resultado `recapture`, o resolvedor pega outro e
 * reabre na posição)? (= LinkExpiry.shouldRecapture) Sim quando ele morreu (403/404/410 ou o prazo da URL venceu) ou
 * quando já estava tocando (caiu no meio: rede, 5xx, 408, 429). Nunca tocou por outro motivo (formato) = não.
 */
export function deveRecapturar(httpCode: number | undefined, vencido: boolean, jaTocou: boolean): boolean {
  const c = httpCode ?? 0;
  if (vencido || c === 403 || c === 404 || c === 410) return true;
  if (!jaTocou) return false;
  return c <= 0 || c >= 500 || c === 408 || c === 429;
}

export { isExpiredUrl as linkVencido };

/** "720p" tirado do endereço (…/720p/…, _1080p.mp4); sem número com "p" = vazio. */
export function qualidadeDaUrl(url: string): string {
  const m = /(?:^|\D)(2160|1440|1080|720|480|360|240)p(?:\D|$)/i.exec(url);
  return m ? `${m[1]}p` : '';
}

/** "Link 2 (HLS) 720p" — a linha da lista de links (= PlayerActivity.showLinks). */
export function rotuloDoLink(i: number, url: string, mime?: string, qualidade?: string): string {
  const m = (mime ?? '').toLowerCase();
  const tipo = m.includes('mpegurl') || /\.m3u8(\?|#|$)|master\.txt(\?|#|$)/i.test(url) ? 'HLS' : m.includes('dash') ? 'DASH' : 'MP4';
  const q = qualidade?.trim() || qualidadeDaUrl(url);
  return `Link ${i + 1} (${tipo})${q ? ` ${q}` : ''}`;
}

// ── contagem do próximo episódio (= PlayerMarcas.Contagem) ───────────────────────────────────────────────────────────

export type TiqueDaContagem = 'nada' | 'mostrar' | 'atualizar' | 'esconder' | 'pular';

/**
 * A contagem de 10 s do próximo episódio, igual à do APK. Um tique a cada ~0,5 s: só desconta tocando (pausou = para);
 * voltar pra antes do início rearma (inclusive depois de cancelar); o vídeo acabar com ela na tela pula na hora.
 * Um objeto por episódio.
 */
export class Contagem {
  visivel = false;
  cancelada = false;
  disparou = false;
  restanteMs = CONTAGEM_MS;
  private ultimoMs = -1;

  tique(posMs: number, inicioMs: number, tocando: boolean, acabou: boolean, agoraMs: number): TiqueDaContagem {
    if (this.disparou || inicioMs < 0) return 'nada';
    if (posMs < inicioMs - 2_000) {
      const estava = this.visivel;
      this.visivel = false; this.cancelada = false; this.restanteMs = CONTAGEM_MS; this.ultimoMs = -1;
      return estava ? 'esconder' : 'nada';
    }
    if (this.cancelada || posMs < inicioMs) return 'nada';
    if (!this.visivel) {
      this.visivel = true; this.restanteMs = CONTAGEM_MS; this.ultimoMs = agoraMs;
      if (!acabou) return 'mostrar';
    }
    if (tocando && this.ultimoMs >= 0) this.restanteMs -= Math.max(0, agoraMs - this.ultimoMs);
    this.ultimoMs = agoraMs;
    if (this.restanteMs <= 0 || acabou) { this.disparou = true; this.visivel = false; return 'pular'; }
    return 'atualizar';
  }

  /** Segundos na tela (arredonda pra cima: 9,1 s mostra 10). */
  segundos(): number { return Math.max(0, Math.ceil(this.restanteMs / 1000)); }

  cancelar(): void { this.cancelada = true; this.visivel = false; }

  pularAgora(): void { this.disparou = true; this.visivel = false; }

  /** "Assistido" leva pro ponto da contagem: abre de novo mesmo se ele tinha cancelado antes (na tela, segue). */
  rearmar(): void {
    if (this.disparou || this.visivel) return;
    this.cancelada = false; this.visivel = false; this.restanteMs = CONTAGEM_MS; this.ultimoMs = -1;
  }
}

// ── painel de episódios (= EpisodiosPainel.java + EpisodiosDados.java) ───────────────────────────────────────────────

/** O `episodios` que o app manda no play (JSON de SerieDoPlayer, episodiosPlayer.ts); torto = sem painel. */
export function serieDoPlayer(json: string | undefined): SerieDoPlayer | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as SerieDoPlayer;
    if (!s || typeof s.tmdb !== 'number' || !Array.isArray(s.temporadas)) return null;
    const temporadas = s.temporadas.filter((t) => t && typeof t.n === 'number' && typeof t.total === 'number' && t.total > 0);
    return temporadas.length ? { tmdb: s.tmdb, chave: typeof s.chave === 'string' ? s.chave : '', temporadas } : null;
  } catch {
    return null;
  }
}

/** Temporada e episódio da chave "tmdb:tv:T:E" (null = filme ou chave torta). */
export function episodioDaChave(chave: string | undefined): { temporada: number; episodio: number } | null {
  const s = chaveDeSerie(chave);
  return s ? { temporada: s[1], episodio: s[2] } : null;
}

/** Episódios da temporada na TMDB (nome, imagem, data) — o mesmo endereço do EpisodiosDados.java. */
export const urlTemporadaTmdb = (tmdb: number, temporada: number, chave: string) =>
  `https://api.themoviedb.org/3/tv/${tmdb}/season/${temporada}?api_key=${encodeURIComponent(chave)}&language=pt-BR`;

export interface EpisodioDaLista { n: number; nome: string; imagem?: string; data?: string; minutos?: number }

/** Resposta da TMDB → episódios 1…total (o que ela não trouxe vira "Episódio N"). JSON torto = só os números. */
export function episodiosDaTemporada(json: unknown, total: number): EpisodioDaLista[] {
  const brutos = json && typeof json === 'object' && Array.isArray((json as { episodes?: unknown }).episodes)
    ? (json as { episodes: Record<string, unknown>[] }).episodes : [];
  const porNumero = new Map<number, Record<string, unknown>>();
  for (const e of brutos) if (e && typeof e.episode_number === 'number') porNumero.set(e.episode_number, e);
  const n = Math.max(total, ...porNumero.keys(), 0);
  const out: EpisodioDaLista[] = [];
  for (let i = 1; i <= n; i++) {
    const e = porNumero.get(i);
    const nome = typeof e?.name === 'string' && e.name.trim() ? e.name.trim() : `Episódio ${i}`;
    const imagem = typeof e?.still_path === 'string' && e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : undefined;
    const data = typeof e?.air_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.air_date) ? e.air_date : undefined;
    const minutos = typeof e?.runtime === 'number' && e.runtime > 0 ? e.runtime : undefined;
    out.push({ n: i, nome, imagem, data, minutos });
  }
  return out;
}

/** "Estreia 21/11" quando o episódio ainda não saiu (data da TMDB depois de hoje); senão vazio. */
export function estreiaDoEpisodio(data: string | undefined, hoje: Date): string {
  if (!data) return '';
  const [a, m, d] = data.split('-').map(Number);
  const dia = new Date(a, m - 1, d);
  const zero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return dia > zero ? `Estreia ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}` : '';
}

// ── barra ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 1:02:03 · 12:34 (ms). */
export function tempo(ms: number): string {
  const s = Math.floor((Number.isFinite(ms) && ms > 0 ? ms : 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const dd = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dd(m)}:${dd(ss)}` : `${m}:${dd(ss)}`;
}

/** Velocidades do bloco "Velocidade" (= PlayerActivity.speeds; cada toque passa pra seguinte). */
export const VELOCIDADES = [1, 1.25, 1.5, 2, 0.5] as const;
export const rotuloDaVelocidade = (v: number) => (v === 1 ? 'Normal' : `${String(v).replace('.', ',')}x`);

/** Bloco "Tela" (= os modos de redimensionar do APK): ajustar (com faixas), preencher (corta) ou esticar. */
export const AJUSTES_DA_TELA = [
  { rotulo: 'Ajustar', fit: 'contain' },
  { rotulo: 'Preencher', fit: 'cover' },
  { rotulo: 'Esticar', fit: 'fill' },
] as const;

/** Volume salvo entre aberturas (0–1; torto = 1). */
export function volumeSalvo(texto: string | null): number {
  const v = Number(texto);
  return texto !== null && texto !== '' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}
