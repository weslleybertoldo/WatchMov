// Setas do controle da TV (W3 do app do Fire TV). A TV não tem toque nem mouse: as setas
// levam o foco pro item mais perto naquela direção e o OK clica. O foco nativo do WebView
// não serve (Fire TV: não entra nos cartazes; box Android: as setas só rolam a página).
// Só liga na TV (main.tsx); no celular nada disso roda.

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Box { left: number; top: number; right: number; bottom: number; }

const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const FOCAVEIS = 'button, a[href], input, select, textarea, [tabindex]';

// Escolhe o vizinho de `from` na direção `dir`. Primeiro os que estão inteiros daquele lado;
// sem nenhum, os que só têm o centro daquele lado. Nota = distância no eixo da seta + 3× o
// quanto sai da faixa do item atual + um pouco da distância entre os centros (desempate).
// Pros lados só vale quem divide a mesma faixa de altura: no fim da fileira o foco para.
export function pickNext(from: Box, cands: Box[], dir: Dir): number {
  const cx = (b: Box) => (b.left + b.right) / 2;
  const cy = (b: Box) => (b.top + b.bottom) / 2;
  const TOL = 4;
  const inteiro = (b: Box) =>
    dir === 'down' ? b.top >= from.bottom - TOL
    : dir === 'up' ? b.bottom <= from.top + TOL
    : dir === 'right' ? b.left >= from.right - TOL
    : b.right <= from.left + TOL;
  const centro = (b: Box) =>
    dir === 'down' ? cy(b) > cy(from) + TOL
    : dir === 'up' ? cy(b) < cy(from) - TOL
    : dir === 'right' ? cx(b) > cx(from) + TOL
    : cx(b) < cx(from) - TOL;
  const vertical = dir === 'up' || dir === 'down';
  const foraDaFaixa = (b: Box) => vertical
    ? Math.max(0, Math.max(from.left, b.left) - Math.min(from.right, b.right))
    : Math.max(0, Math.max(from.top, b.top) - Math.min(from.bottom, b.bottom));
  const nota = (b: Box) => {
    const eixo = dir === 'down' ? b.top - from.bottom
      : dir === 'up' ? from.top - b.bottom
      : dir === 'right' ? b.left - from.right
      : from.left - b.right;
    // Saindo de um item bem mais largo (destaque, botão da largura toda), o alinhamento é pela
    // borda esquerda: ↓ do destaque cai no 1º cartaz e ↑ no 1º item do cabeçalho.
    const largo = vertical && (from.right - from.left) > 2.5 * (b.right - b.left);
    const desvio = vertical ? Math.abs(cx(b) - (largo ? from.left : cx(from))) : Math.abs(cy(b) - cy(from));
    return Math.max(0, eixo) + 3 * foraDaFaixa(b) + 0.05 * desvio;
  };
  const valido = (b: Box) => vertical || foraDaFaixa(b) === 0;
  for (const filtro of [inteiro, centro]) {
    let melhor = -1;
    let melhorNota = Infinity;
    cands.forEach((b, i) => {
      if (!filtro(b) || !valido(b)) return;
      const n = nota(b);
      if (n < melhorNota) { melhorNota = n; melhor = i; }
    });
    if (melhor >= 0) return melhor;
  }
  return -1;
}

function visivel(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
}

// Com um diálogo aberto (Radix: role=dialog/alertdialog) o foco não sai dele.
function raiz(): ParentNode {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  return dialogs.length ? dialogs[dialogs.length - 1] : document;
}

function candidatos(): HTMLElement[] {
  return Array.from(raiz().querySelectorAll<HTMLElement>(FOCAVEIS))
    .filter(el => el.tabIndex >= 0 && visivel(el));
}

function focar(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Cartaz aberto por último (data-tv-key): ao voltar do detalhe o foco volta nele.
let ultimoCartaz = '';

// Onde o foco começa: o item marcado (ex.: "Assistir" no detalhe), o cartaz aberto por
// último, o 1º destaque/cartaz na tela ou o 1º item visível do conteúdo (sem o cabeçalho).
function focoInicial(): HTMLElement | null {
  const todos = candidatos();
  const marcado = todos.find(el => el.hasAttribute('data-tv-autofocus'));
  if (marcado) return marcado;
  const h = window.innerHeight;
  const naTela = todos.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < h; });
  const mesmoCartaz = ultimoCartaz ? todos.filter(el => el.getAttribute('data-tv-key') === ultimoCartaz) : [];
  const conteudo = naTela.filter(el => !el.closest('header'));
  return mesmoCartaz.find(el => naTela.includes(el)) ?? mesmoCartaz[0]
    ?? conteudo.find(el => el.matches('[data-tv-card], [data-row-key="hero"]'))
    ?? conteudo[0] ?? naTela[0] ?? todos[0] ?? null;
}

function semFoco(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !a || a === document.body || !a.isConnected || !visivel(a);
}

function mover(dir: Dir): boolean {
  if (semFoco()) {
    const ini = focoInicial();
    if (ini) focar(ini);
    return !!ini;
  }
  const atual = document.activeElement as HTMLElement;
  const todos = candidatos().filter(el => el !== atual && !atual.contains(el) && !el.contains(atual));
  const i = pickNext(atual.getBoundingClientRect(), todos.map(el => el.getBoundingClientRect()), dir);
  if (i >= 0) focar(todos[i]);
  return true;   // sem vizinho o foco fica onde está (e a página não rola sozinha)
}

// Campo de texto: ←/→ andam no texto; só saem do campo nas pontas.
function setaDentroDoTexto(el: Element | null, dir: Dir): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  if (dir === 'up' || dir === 'down') return el instanceof HTMLTextAreaElement;
  const ini = el.selectionStart ?? 0;
  const fim = el.selectionEnd ?? 0;
  return dir === 'left' ? ini > 0 : fim < el.value.length;
}

const NATIVO_CLICA = 'button, a[href], input, select, textarea, summary';

export function startTvNav(): () => void {
  // Foco posto sozinho (tela nova): enquanto ninguém apertar nada ele acompanha o que vai
  // carregando (ex.: o destaque chega depois das fileiras e passa a ser o 1º item).
  let automatico: HTMLElement | null = null;
  const onKey = (e: KeyboardEvent) => {
    automatico = null;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = KEY_DIR[e.key];
    if (dir) {
      if (setaDentroDoTexto(document.activeElement, dir)) return;
      if (mover(dir)) e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (semFoco()) {
        const ini = focoInicial();
        if (ini) { focar(ini); e.preventDefault(); }
        return;
      }
      const a = document.activeElement as HTMLElement;
      const chave = a.getAttribute('data-tv-key');
      if (chave) ultimoCartaz = chave;
      if (!a.matches(NATIVO_CLICA)) { a.click(); e.preventDefault(); }
    }
  };
  // Troca de tela desmonta o item focado: o foco volta pro 1º item da tela nova sozinho.
  let t: ReturnType<typeof setTimeout> | undefined;
  const obs = new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      const seguindo = automatico && document.activeElement === automatico;
      if (!semFoco() && !seguindo) return;
      const ini = focoInicial();
      if (ini && ini !== document.activeElement) { focar(ini); automatico = ini; }
    }, 150);
  });
  window.addEventListener('keydown', onKey);
  obs.observe(document.body, { childList: true, subtree: true });
  return () => { window.removeEventListener('keydown', onKey); obs.disconnect(); clearTimeout(t); };
}
