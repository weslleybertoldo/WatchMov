// Setas do controle da TV (W3 do app do Fire TV). A TV não tem toque nem mouse: as setas
// levam o foco pro item mais perto naquela direção e o OK clica. O foco nativo do WebView
// não serve (Fire TV: não entra nos cartazes; box Android: as setas só rolam a página).
// Só liga na TV (main.tsx); no celular nada disso roda.

import { aoSairDaSetinha, desligarSetinha, ligarSetinha } from './device';

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

// Setinha do ▣ Servidor (26/09/2026, pedido dele): a página do servidor é um iframe de outro site e as setas não
// entram nele. ↓ num botão da barra de cima (sem vizinho embaixo) liga um ponteiro nativo (TvCursor.java): as setas
// movem, o OK toca. A linha de saída é o TOPO da página — passar dele devolve o foco pro botão (antes era a base
// do Ligar e o topo da página ficava fora de alcance). A setinha nasce logo abaixo, no meio do botão. Sem espaço
// da página abaixo do botão = não liga (null).
export function inicioDaSetinha(from: Box, zona: Box): { x: number; y: number; exitY: number } | null {
  const ABAIXO = 32;
  const y = Math.max(from.bottom, zona.top) + ABAIXO;
  if (y > zona.bottom - 8 || zona.right - zona.left < 40) return null;
  const x = Math.min(Math.max((from.left + from.right) / 2, zona.left + 8), zona.right - 8);
  return { x, y, exitY: zona.top };
}

function visivel(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
}

// Com um diálogo aberto (Radix: role=dialog/alertdialog) o foco não sai dele. Camada por cima de tudo sem ser
// diálogo (player "Procurando…", canal ao vivo: um `fixed` que cobre a tela) também prende o foco — senão ele
// ficava no botão escondido atrás dela.
function raiz(): ParentNode {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  if (dialogs.length) return dialogs[dialogs.length - 1];
  const w = window.innerWidth, h = window.innerHeight;
  for (let el = document.elementFromPoint(w / 2, h / 2) as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.getAttribute('aria-hidden') === 'true' || getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width >= w * 0.9 && r.height >= h * 0.9) return el;
  }
  return document;
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
  if (!a || a === document.body || !a.isConnected || !visivel(a)) return true;
  const r = raiz();
  return r !== document && !(r as HTMLElement).contains(a);   // foco ficou atrás da camada de cima
}

// Setinha ligada: de qual botão ela saiu (o foco volta pra ele quando ela desliga).
let setinha: { origem: HTMLElement } | null = null;

// A página do servidor (iframe marcado no VideoPlayer) na tela.
function zonaDaSetinha(): HTMLElement | null {
  const z = document.querySelector<HTMLElement>('[data-tv-setinha]');
  return z && visivel(z) ? z : null;
}

function tentarSetinha(atual: HTMLElement) {
  const z = zonaDaSetinha();
  const ini = z && inicioDaSetinha(atual.getBoundingClientRect(), z.getBoundingClientRect());
  if (!ini) return;
  void ligarSetinha({ ...ini, dpr: window.devicePixelRatio || 1 }).then(ok => {
    if (!ok) return;   // APK sem a setinha: o foco fica no botão, como antes
    setinha = { origem: atual };
    atual.blur();      // o destaque sai do botão enquanto a setinha anda
  });
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
  else if (dir === 'down') tentarSetinha(atual);
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
  // Setinha desligada pelo nativo (subiu acima do botão, app foi pro fundo): o foco volta pro botão de onde saiu.
  const pararDeOuvir = aoSairDaSetinha(() => {
    const origem = setinha?.origem;
    setinha = null;
    const alvo = origem && origem.isConnected && visivel(origem) ? origem : focoInicial();
    if (alvo) focar(alvo);
  });
  // Troca de tela desmonta o item focado: o foco volta pro 1º item da tela nova sozinho.
  let t: ReturnType<typeof setTimeout> | undefined;
  const obs = new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (setinha) {
        if (zonaDaSetinha()) return;   // setinha andando na página: o foco fica quieto
        setinha = null;                // a página do servidor saiu (fechou o título, trocou a fonte…)
        desligarSetinha();
      }
      const seguindo = automatico && document.activeElement === automatico;
      if (!semFoco() && !seguindo) return;
      const ini = focoInicial();
      if (ini && ini !== document.activeElement) { focar(ini); automatico = ini; }
    }, 150);
  });
  window.addEventListener('keydown', onKey);
  obs.observe(document.body, { childList: true, subtree: true });
  return () => { window.removeEventListener('keydown', onKey); obs.disconnect(); clearTimeout(t); pararDeOuvir(); };
}
