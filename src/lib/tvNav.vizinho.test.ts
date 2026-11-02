import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startTvNav, ordemDosVizinhos, pickNext, type Box } from './tvNav';

// W2 do raio-x (02/11/2026): a seta procurava em TODOS os itens da página a cada tecla, lendo o estilo calculado de
// cada um. Agora ←/→ numa fileira olham só a fileira e a busca confere o estilo só dos melhores — com a MESMA escolha.

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });

describe('ordemDosVizinhos', () => {
  const fileira = [0, 1, 2, 3].map(i => box(i * 112, 300, 100, 150));
  const abaixo = [0, 1, 2, 3].map(i => box(i * 112, 500, 100, 150));

  it('o 1º da ordem é sempre o do pickNext', () => {
    const cands = [...fileira, ...abaixo];
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      for (const de of [fileira[1], abaixo[2], fileira[3]]) {
        expect(ordemDosVizinhos(de, cands, dir)[0] ?? -1).toBe(pickNext(de, cands, dir));
      }
    }
  });

  it('↓: os da fileira de baixo pela nota (o alinhado primeiro; empate = o que vem antes na página)', () => {
    expect(ordemDosVizinhos(fileira[1], abaixo, 'down')).toEqual([1, 0, 2, 3]);
  });

  it('→ só lista quem divide a faixa de altura', () => {
    expect(ordemDosVizinhos(fileira[1], [...fileira, ...abaixo], 'right')).toEqual([2, 3]);
  });
});

describe('tvNav — busca do vizinho a cada tecla', () => {
  let parar: () => void;
  const caixas = new Map<Element, Box>();
  const escondidos = new Set<Element>();
  let medidos: Element[];
  let estilos: Element[];
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const seta = (key: string) => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    document.elementFromPoint = () => null;      // o jsdom não tem (o tvNav procura camada por cima da tela)
    caixas.clear();
    escondidos.clear();
    medidos = [];
    estilos = [];
    document.body.innerHTML = `
      <header><button id="busca">Busca</button></header>
      <main>
        <div data-row-key="r1">${[0, 1, 2, 3].map(i => `<button id="a${i}" data-tv-card>A${i}</button>`).join('')}</div>
        <div data-row-key="r2">${[0, 1, 2, 3].map(i => `<button id="b${i}" data-tv-card>B${i}</button>`).join('')}</div>
        <button id="solto">Solto</button>
      </main>`;
    caixas.set($('busca'), box(800, 10, 60, 30));
    [0, 1, 2, 3].forEach(i => {
      caixas.set($(`a${i}`), box(i * 112, 300, 100, 150));
      caixas.set($(`b${i}`), box(i * 112, 500, 100, 150));
    });
    caixas.set($('solto'), box(0, 700, 100, 40));
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      medidos.push(this);
      const b = caixas.get(this) ?? box(0, 0, 0, 0);
      return { ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      estilos.push(el);
      return { visibility: escondidos.has(el) ? 'hidden' : 'visible', display: 'block', opacity: '1', position: 'static' } as unknown as CSSStyleDeclaration;
    });
    $('a1').focus();
    parar = startTvNav();
  });

  afterEach(() => {
    parar();
    vi.restoreAllMocks();
  });

  it('→ e ← andam na fileira; ↓ e ↑ trocam de fileira', () => {
    seta('ArrowRight');
    expect(document.activeElement?.id).toBe('a2');
    seta('ArrowLeft');
    expect(document.activeElement?.id).toBe('a1');
    seta('ArrowDown');
    expect(document.activeElement?.id).toBe('b1');
    seta('ArrowUp');
    expect(document.activeElement?.id).toBe('a1');
  });

  it('→ numa fileira mede só os itens da fileira (nada do cabeçalho nem das outras fileiras)', () => {
    medidos = [];
    seta('ArrowRight');
    expect(document.activeElement?.id).toBe('a2');
    const fora = medidos.filter(el => !el.closest('[data-row-key="r1"]'));
    expect(fora).toEqual([]);
  });

  it('→ no fim da fileira o foco fica (sem pular pra outra fileira)', () => {
    $('a3').focus();
    seta('ArrowRight');
    expect(document.activeElement?.id).toBe('a3');
  });

  it('↓ confere o estilo só do melhor candidato, não de todos os itens da página', () => {
    estilos = [];
    seta('ArrowDown');
    expect(document.activeElement?.id).toBe('b1');
    // o item focado (semFoco) + o escolhido; antes eram todos os 10 itens da página
    expect(estilos.filter(el => el !== $('a1'))).toEqual([$('b1')]);
  });

  it('o melhor está escondido: vai pro próximo da ordem (o mesmo que o pickNext escolheria só entre os visíveis)', () => {
    escondidos.add($('b1'));
    seta('ArrowDown');
    expect(document.activeElement?.id).toBe('b0');
  });

  it('item dentro de camada escondida (aria-hidden) não recebe o foco', () => {
    document.querySelector('[data-row-key="r2"]')?.setAttribute('aria-hidden', 'true');
    seta('ArrowDown');
    expect(document.activeElement?.id).toBe('solto');
  });

  it('com um diálogo aberto o foco não sai dele', () => {
    const dialogo = document.createElement('div');
    dialogo.setAttribute('role', 'dialog');
    dialogo.innerHTML = '<button id="d1">Sim</button><button id="d2">Não</button>';
    document.body.append(dialogo);
    caixas.set($('d1'), box(300, 200, 80, 40));
    caixas.set($('d2'), box(400, 200, 80, 40));
    $('d1').focus();
    seta('ArrowRight');
    expect(document.activeElement?.id).toBe('d2');
    seta('ArrowDown');                 // embaixo só tem a página de trás: fica no diálogo
    expect(document.activeElement?.id).toBe('d2');
  });
});
