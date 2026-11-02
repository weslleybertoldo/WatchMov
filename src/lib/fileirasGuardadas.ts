import type { MediaSummary } from './tmdb';

// W1 do raio-x de fluidez (02/11/2026): as fileiras da TMDB (destaque, Top 10, lançamentos, gêneros) ficam guardadas no
// aparelho. Na abertura seguinte elas aparecem NA HORA, sem esperar a TMDB — na Fire TV o 1º cartaz levava 6–9 s.
// - Guardada há menos de FRESCA_MS: vale como está, nem pergunta à TMDB.
// - Mais velha (até VALIDA_MS): aparece na hora e a TMDB é consultada no tempo ocioso; a resposta fica guardada pra
//   PRÓXIMA abertura. Trocar os cartazes com a pessoa olhando mexeria no foco da TV e na posição da tela.
// - Mais velha que isso (ou nada guardado): busca na TMDB como sempre.
// Cada fileira numa chave própria (a abertura lê só as que aparecem); só os 10 primeiros, sem os gêneros (eles só servem
// pra montar a fileira, que já vem pronta).
const PREFIXO = 'wm_fileira:';
export const FRESCA_MS = 6 * 3600_000;
export const VALIDA_MS = 3 * 86400_000;
export const MAX_GUARDADOS = 10;

interface Guardada { itens: MediaSummary[]; em: number }

export interface FileiraLida { itens: MediaSummary[]; fresca: boolean }

export function lerFileira(chave: string, agora = Date.now()): FileiraLida | null {
  try {
    const g = JSON.parse(localStorage.getItem(PREFIXO + chave) || 'null') as Guardada | null;
    if (!g || typeof g.em !== 'number' || !Array.isArray(g.itens) || g.itens.length === 0) return null;
    const idade = agora - g.em;
    if (idade < 0 || idade > VALIDA_MS) return null;   // relógio voltou ou velha demais
    return { itens: g.itens, fresca: idade < FRESCA_MS };
  } catch {
    return null;
  }
}

export function guardarFileira(chave: string, itens: MediaSummary[], agora = Date.now()): void {
  if (!itens.length) return;
  const enxutos = itens.slice(0, MAX_GUARDADOS).map(({ genreIds: _g, ...m }) => m);
  try {
    localStorage.setItem(PREFIXO + chave, JSON.stringify({ itens: enxutos, em: agora } satisfies Guardada));
  } catch { /* sem espaço / sem localStorage: segue sem guardar */ }
}

// Fileiras que entraram VELHAS nesta abertura: cada uma pergunta à TMDB uma vez só (no ocioso) e guarda a resposta.
const paraAtualizar = new Set<string>();

export function marcarParaAtualizar(chave: string): void { paraAtualizar.add(chave); }

/** true só na 1ª vez depois de marcada (quem chama faz a busca); as outras montagens da mesma fileira não repetem. */
export function pegarParaAtualizar(chave: string): boolean { return paraAtualizar.delete(chave); }
