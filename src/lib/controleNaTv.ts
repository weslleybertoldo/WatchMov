// Controle remoto, lado da TV (pedido dele 07/11/2026): o que cada tecla que veio do celular faz no WatchMov da TV.
// Com o player nativo aberto, a tecla vai pra ele (setas/OK/Voltar viram as teclas do controle de verdade lá dentro);
// sem player, as setas e o OK andam pelo tvNav da página, o Voltar é o mesmo do controle e o Início vai pra aba Início.
import type { TeclaControle, TocandoNaTv } from '@/lib/tvRemote';
import type { EstadoDoPlayer, TeclaDoPlayer } from '@/lib/nativePlayer';

export interface AcoesDaTv {
  teclaNoPlayer: (k: TeclaDoPlayer) => Promise<boolean>;   // true = o player aberto atendeu
  estadoDoPlayer: () => Promise<EstadoDoPlayer>;
  fecharPlayer: () => Promise<boolean>;
  voltar: () => unknown;                                     // o mesmo Voltar do controle da TV
  inicio: () => void;                                        // aba Início, sem nada por cima
  capa?: () => string | undefined;                           // cartaz do título aberto (faixa "Tocando na TV")
}

const SETA: Partial<Record<TeclaControle, string>> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const DO_PLAYER = new Set<TeclaControle>(['up', 'down', 'left', 'right', 'ok', 'ok-hold', 'back', 'rew', 'ff', 'playpause',
  'prev-ep', 'next-ep', 'watched']);
// Botão, link e campo: o navegador é quem clica no Enter — e ele NÃO clica com tecla de mentira; então clicamos aqui.
const NATIVO_CLICA = 'button, a[href], input, select, textarea, summary';

function tecla(key: string) {
  const alvo = (document.activeElement as HTMLElement | null) ?? document.body;
  for (const type of ['keydown', 'keyup']) alvo.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
}

// OK na página. Capa (data-tv-hold): o tvNav decide no soltar — apertar e soltar abre; segurar = menu (tv-segurar).
// Nada focado: o Enter faz o tvNav focar o primeiro item, igual ao controle.
function ok(segurar: boolean) {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) { tecla('Enter'); return; }
  if (a.hasAttribute('data-tv-hold')) {
    if (segurar) a.dispatchEvent(new CustomEvent('tv-segurar', { bubbles: true }));
    else tecla('Enter');
    return;
  }
  if (a.matches(NATIVO_CLICA)) { a.click(); return; }
  tecla('Enter');
}

export async function executarTecla(key: TeclaControle, acoes: AcoesDaTv): Promise<void> {
  if (key === 'home') {
    await acoes.fecharPlayer();
    acoes.inicio();
    return;
  }
  if (DO_PLAYER.has(key) && await acoes.teclaNoPlayer((key === 'ok-hold' ? 'ok' : key) as TeclaDoPlayer)) return;
  const seta = SETA[key];
  if (seta) { tecla(seta); return; }
  if (key === 'ok' || key === 'ok-hold') { ok(key === 'ok-hold'); return; }
  if (key === 'back') { await acoes.voltar(); return; }
  // ⏪ ⏩ ⏯ e os de episódio só fazem sentido com o player aberto: sem ele, nada a fazer.
}

export async function oQueToca(acoes: AcoesDaTv): Promise<TocandoNaTv | null> {
  const e = await acoes.estadoDoPlayer();
  if (!e.open || !e.title) return null;
  // O player escreve "Série — T5 E17" no título; a faixa do celular já mostra a temporada e o episódio embaixo.
  const title = e.season && e.episode ? e.title.replace(/\s+[—-]\s+T\d+\s*E\d+\s*$/i, '') || e.title : e.title;
  return {
    title, season: e.season, episode: e.episode, positionMs: e.positionMs, durationMs: e.durationMs,
    playing: e.playing, posterUrl: acoes.capa?.(),
  };
}

// Espera no máximo `ms`: o que não terminou segue sozinho e a resposta vai sem esperar (undefined = não deu tempo).
// Trocar de episódio carrega o vídeo e passava dos 2,5 s que o celular espera → "não respondeu" com a TV funcionando.
export function comPrazo<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(undefined); });
  });
}
