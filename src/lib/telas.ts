import { createContext, useContext } from 'react';

// W3 do raio-x de fluidez (02/11/2026): voltar e trocar de aba na hora. Antes, abrir um título trocava o conteúdo inteiro
// da página: o Início (~118 cartazes) era desmontado e, no Voltar, montado de novo (~1 s na Fire TV). Agora o Início e as
// abas vistas por último ficam MONTADOS e escondidos (`hidden`) enquanto o título ou outra tela aparece por cima — voltar é
// só mostrar de novo, no mesmo lugar da rolagem e com o foco no cartaz aberto.

export type Rolagem = { y: number; rowKey?: string; rowTop?: number };

// Abas guardadas além do Início (que fica sempre). Cada aba guardada custa ~1.000–1.600 nós na página: na TV de 1 GB
// fica 1, no celular 2. Passou disso, sai a vista há mais tempo (ela monta de novo quando a pessoa voltar).
export const ABAS_GUARDADAS_TV = 1;
export const ABAS_GUARDADAS_CELULAR = 2;

// Lista das abas montadas depois de ir para `aba`: a fixa (Início) sempre primeiro; as outras da vista há mais tempo para
// a mais recente, no máximo `extras`.
export function guardarAba<T extends string>(vivas: readonly T[], aba: T, fixa: T, extras: number): T[] {
  const outras = vivas.filter(a => a !== fixa && a !== aba);
  if (aba !== fixa) outras.push(aba);
  return [fixa, ...outras.slice(Math.max(0, outras.length - Math.max(0, extras)))];
}

// A tela guardada sabe se está à vista: o que gira sozinho (o destaque do Início) para enquanto ela está escondida.
export const TelaVisivel = createContext(true);
export const useTelaVisivel = () => useContext(TelaVisivel);

// Fileira (data-row-key) À VISTA com essa chave. A mesma fileira pode estar também numa tela escondida (o Top 10 fica no
// Início e na aba Filmes): a escondida não tem caixa (getClientRects vazio) e não serve de âncora.
export function fileiraVisivel(chave: string, raiz: ParentNode = document): HTMLElement | undefined {
  return Array.from(raiz.querySelectorAll<HTMLElement>('[data-row-key]'))
    .find(el => el.dataset.rowKey === chave && el.getClientRects().length > 0);
}

// Recoloca a página no lugar guardado: a fileira âncora no mesmo lugar da tela (a de cima pode ter mudado de altura —
// "Continuar assistindo" novo), senão o scrollY. A 1ª passada é JÁ (antes de a tela pintar); as outras pegam o que
// chegou depois. Se a pessoa rolou no meio, não briga com ela. Devolve o cancelamento das passadas pendentes.
export function recolocarRolagem(pos: Rolagem): () => void {
  let ultima = -1;
  const passo = () => {
    if (ultima >= 0 && Math.abs(window.scrollY - ultima) > 1) return;
    const fileira = pos.rowKey ? fileiraVisivel(pos.rowKey) : undefined;
    const alvo = fileira && pos.rowTop != null ? fileira.getBoundingClientRect().top + window.scrollY - pos.rowTop : pos.y;
    const y = Math.max(0, Math.round(alvo));
    if (Math.abs(y - window.scrollY) > 1) window.scrollTo(0, y);
    ultima = window.scrollY;
  };
  passo();
  const raf = requestAnimationFrame(passo);
  const t = window.setTimeout(passo, 150);
  return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
}

// Memória da rolagem por tela. A página inteira rola (window), então cada tela guarda onde estava quando outra foi por
// cima dela, e a recebe de volta quando reaparece. Tela que nunca foi coberta (nova) nasce no topo.
export class MemoriaDeRolagem {
  private mapa = new Map<string, Rolagem>();

  guardar(tela: string, pos: Rolagem) { this.mapa.set(tela, pos); }
  ler(tela: string): Rolagem | undefined { return this.mapa.get(tela); }
  esquecer(tela: string) { this.mapa.delete(tela); }
  // Só fica a memória das telas que ainda podem voltar (as da pilha aberta e as abas guardadas).
  manterSo(telas: Iterable<string>) {
    const ficam = new Set(telas);
    for (const k of [...this.mapa.keys()]) if (!ficam.has(k)) this.mapa.delete(k);
  }
  chaves(): string[] { return [...this.mapa.keys()]; }
}
