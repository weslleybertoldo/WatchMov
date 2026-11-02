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
  return ordemDosVizinhos(from, cands, dir)[0] ?? -1;
}

// A mesma regra do pickNext, devolvendo TODOS os que valem na ordem da escolha: os inteiros daquele lado pela nota, depois
// os que só têm o centro daquele lado pela nota (empate = o que vem antes na página). W2 do raio-x (02/11/2026): com a
// ordem, a seta confere se o item está visível de verdade (o caro: estilo calculado) só nos primeiros, até achar um.
export function ordemDosVizinhos(from: Box, cands: Box[], dir: Dir): number[] {
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
  const ordem: number[] = [];
  const ja = new Set<number>();
  for (const filtro of [inteiro, centro]) {
    const notas = new Map<number, number>();
    cands.forEach((b, i) => { if (!ja.has(i) && filtro(b) && valido(b)) notas.set(i, nota(b)); });
    const daVez = [...notas.keys()].sort((a, b) => notas.get(a)! - notas.get(b)! || a - b);
    for (const i of daVez) { ordem.push(i); ja.add(i); }
  }
  return ordem;
}

// A barra de cima é fixa (sticky). Pra achar o vizinho ela conta onde fica no topo da PÁGINA, não onde aparece
// na tela: com a página rolada, ↑ pulava a fileira escondida atrás da barra e ia direto pra ela (print dele,
// 27/09/2026).
export function noTopoDaPagina(b: Box, scrollY: number): Box {
  return { left: b.left, right: b.right, top: b.top - scrollY, bottom: b.bottom - scrollY };
}

// Topo cortado na TV (prints dele, 27/09/2026): a página rolava só o necessário pro item focado e o que vinha antes
// dele (abas Filmes/Séries/Animes do Procurar, a 1ª fileira) ficava atrás da barra. Foco na barra, ou num item que
// cabe inteiro na tela com a página no topo, leva a página pro topo.
const FOLGA_BAIXO = 48;   // = scroll-margin de baixo do index.css
export function voltaProTopo(naBarra: boolean, fundoNaPagina: number, alturaTela: number): boolean {
  return naBarra || fundoNaPagina + FOLGA_BAIXO <= alturaTela;
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
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return visivelPeloEstilo(el);
}

// A parte cara de "visível": fora de camada escondida/inerte e com o estilo calculado à vista.
function visivelPeloEstilo(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
}

// Com um diálogo aberto (Radix: role=dialog/alertdialog) o foco não sai dele. Camada por cima de tudo sem ser
// diálogo (player "Procurando…", canal ao vivo: um `fixed` que cobre a tela) também prende o foco — senão ele
// ficava no botão escondido atrás dela.
// W3 do raio-x (02/11/2026): diálogo dentro de uma tela guardada (escondida) não conta — o aviso de atualização mora no
// rodapé do Início, que fica montado embaixo do título; contado, ele prenderia as setas numa caixa invisível.
function raiz(): ParentNode {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'))
    .filter(d => !d.closest('[hidden]'));
  if (dialogs.length) return dialogs[dialogs.length - 1];
  const w = window.innerWidth, h = window.innerHeight;
  for (let el = document.elementFromPoint(w / 2, h / 2) as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.getAttribute('aria-hidden') === 'true' || getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width >= w * 0.9 && r.height >= h * 0.9) return el;
  }
  return document;
}

function candidatos(r: ParentNode = raiz()): HTMLElement[] {
  return Array.from(r.querySelectorAll<HTMLElement>(FOCAVEIS))
    .filter(el => el.tabIndex >= 0 && visivel(el));
}

function focar(el: HTMLElement, r: ParentNode = raiz()) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (window.scrollY === 0 || r !== document) return;   // diálogo ou camada por cima: a página de trás fica
  const fundo = el.getBoundingClientRect().bottom + window.scrollY;
  if (voltaProTopo(!!el.closest('header'), fundo, window.innerHeight)) window.scrollTo({ top: 0 });
}

// Cartaz aberto por último (data-tv-key): ao voltar do detalhe o foco volta nele.
let ultimoCartaz = '';

// Tela que fecha e devolve o foco pra um cartaz certo: ao sair da pasta de uma coleção o foco volta na pasta,
// mesmo que o último OK tenha sido num filme lá dentro (Coleções, 01/11/2026).
export function lembrarCartaz(chave: string) {
  ultimoCartaz = chave;
}

// Onde o foco começa: o item marcado (ex.: "Assistir" no detalhe), o cartaz aberto por
// último, o 1º destaque/cartaz na tela ou o 1º item visível do conteúdo (sem o cabeçalho).
function focoInicial(r: ParentNode = raiz()): HTMLElement | null {
  const todos = candidatos(r);
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

// W3 do raio-x (02/11/2026): a tela guardada (escondida, já montada) reapareceu — o foco vai JÁ pro cartaz aberto por
// último (senão o 1º item da tela), sem esperar o observador (que só age 150 ms depois de a página parar de mudar; e
// mostrar uma tela guardada nem mexe na lista de elementos). Foco ainda num item à vista (ex.: o botão da aba, na barra
// de cima) fica onde está.
export function devolverFoco(): boolean {
  const r = raiz();
  if (!semFoco(r)) return false;
  const ini = focoInicial(r);
  if (!ini) return false;
  focar(ini, r);
  return true;
}

function semFoco(r: ParentNode = raiz()): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body || !a.isConnected || !visivel(a)) return true;
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

// W2 do raio-x (02/11/2026): a seta procurava em TODOS os itens da página a cada tecla (~150 no Início, ~250 nas grades),
// lendo o estilo calculado de cada um, e calculava a camada de cima 4 vezes. Agora a camada sai 1 vez por tecla; ←/→
// dentro de uma fileira olham só a fileira (fora dela nada divide a mesma faixa de altura; sem vizinho ali, procura na
// página toda, como antes); e a busca mede só as caixas (barato) e confere o estilo dos melhores, na ordem da nota, até
// achar um visível — o escolhido é o mesmo de antes.
function vizinho(atual: HTMLElement, dir: Dir, r: ParentNode): HTMLElement | null {
  const rolagem = r === document ? window.scrollY : 0;
  const caixa = (el: HTMLElement, b: DOMRect): Box => (el.closest('header') ? noTopoDaPagina(b, rolagem) : b);
  const de = caixa(atual, atual.getBoundingClientRect());
  const procurar = (onde: ParentNode): HTMLElement | null => {
    const els: HTMLElement[] = [];
    const caixas: Box[] = [];
    onde.querySelectorAll<HTMLElement>(FOCAVEIS).forEach(el => {
      if (el === atual || el.tabIndex < 0 || (el as HTMLButtonElement).disabled) return;
      if (atual.contains(el) || el.contains(atual)) return;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return;
      els.push(el);
      caixas.push(caixa(el, b));
    });
    for (const i of ordemDosVizinhos(de, caixas, dir)) if (visivelPeloEstilo(els[i])) return els[i];
    return null;
  };
  if (r === document && (dir === 'left' || dir === 'right')) {
    const fileira = atual.closest<HTMLElement>('[data-row-key]');
    const naFileira = fileira ? procurar(fileira) : null;
    if (naFileira) return naFileira;
  }
  return procurar(r);
}

function mover(dir: Dir): boolean {
  const r = raiz();
  if (semFoco(r)) {
    const ini = focoInicial(r);
    if (ini) focar(ini, r);
    return !!ini;
  }
  const atual = document.activeElement as HTMLElement;
  const alvo = vizinho(atual, dir, r);
  if (alvo) focar(alvo, r);
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

// Segurar o OK num item marcado com data-tv-hold (a capa → menu dos favoritos; pedido dele 01/11/2026). O clique de
// um <button> sai no APERTAR do OK; num item que dá pra segurar ele passa pro SOLTAR: soltou antes de SEGURAR_MS =
// clique normal; segurou = evento 'tv-segurar' no item. Com o OK ainda apertado depois disso as repetições da tecla
// (o Android repete a cada ~50 ms) não valem — senão a 1ª apertaria o botão do menu que acabou de abrir com o foco
// nele. Pausa maior que REPETICAO_MS sem repetição = o soltar se perdeu: o próximo OK vale normal.
export const SEGURAR_MS = 500;
const REPETICAO_MS = 400;
let segurando: { el: HTMLElement; timer: ReturnType<typeof setTimeout>; disparou: boolean } | null = null;
let engolirOk = false;
let ultimoEngolido = 0;

function zerarSegurar() {
  if (segurando) clearTimeout(segurando.timer);
  segurando = null;
  engolirOk = false;
}

function okApertado(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return;
  if (engolirOk) {
    const agora = Date.now();
    // Repetição do MESMO aperto (e.repeat: o OK continua seguro) é sempre engolida, por mais atrasada que chegue —
    // desenhar o menu trava a página (~1 s no emulador, mais na Fire TV) e a repetição seguinte chegava depois do
    // REPETICAO_MS, virava "OK novo" e apertava sozinha o botão do menu (01/11/2026: "quando eu clico e seguro ele
    // trava"). A pausa só decide quando a tecla vem sem a marca de repetição (o soltar se perdeu).
    if (e.repeat || agora - ultimoEngolido < REPETICAO_MS) {
      ultimoEngolido = agora;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    engolirOk = false;
  }
  const a = document.activeElement as HTMLElement | null;
  if (!a || !a.hasAttribute('data-tv-hold')) return;
  e.preventDefault();          // sem o clique do apertar: ele sai no soltar (ou vira o menu)
  e.stopPropagation();
  if (segurando || e.repeat) return;
  const chave = a.getAttribute('data-tv-key');
  if (chave) ultimoCartaz = chave;
  const s = {
    el: a,
    disparou: false,
    timer: setTimeout(() => {
      s.disparou = true;
      engolirOk = true;
      ultimoEngolido = Date.now();
      a.dispatchEvent(new CustomEvent('tv-segurar', { bubbles: true }));
    }, SEGURAR_MS),
  };
  segurando = s;
}

function okSolto(e: KeyboardEvent) {
  if (e.key !== 'Enter') return;
  const s = segurando;
  const engolia = engolirOk;
  zerarSegurar();
  if (s) {
    e.preventDefault();
    if (!s.disparou && s.el.isConnected) s.el.click();
  } else if (engolia) {
    e.preventDefault();
  }
}

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
  // Segurar o OK: na CAPTURA, antes do React e do clique nativo do botão.
  const aoEsconder = () => { if (document.hidden) zerarSegurar(); };
  window.addEventListener('keydown', okApertado, true);
  window.addEventListener('keyup', okSolto, true);
  window.addEventListener('blur', zerarSegurar);
  document.addEventListener('visibilitychange', aoEsconder);
  window.addEventListener('keydown', onKey);
  obs.observe(document.body, { childList: true, subtree: true });
  return () => {
    window.removeEventListener('keydown', okApertado, true);
    window.removeEventListener('keyup', okSolto, true);
    window.removeEventListener('blur', zerarSegurar);
    document.removeEventListener('visibilitychange', aoEsconder);
    zerarSegurar();
    window.removeEventListener('keydown', onKey); obs.disconnect(); clearTimeout(t); pararDeOuvir();
  };
}
