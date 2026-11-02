import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startTvNav, raiz, lembrarCartaz } from './tvNav';

// W4 do raio-x (02/11/2026): com a navegação fluida o diálogo do Radix SAI animado — durante a saída (120 ms na TV) a
// caixa continua na página com data-state="closed". As setas não podem entrar nela: o foco volta pra página.

const ZERO = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
function caixa(el: Element): DOMRect | null {
  if (el.closest('[hidden]')) return null;
  const b = (el as HTMLElement).dataset?.box;
  if (!b) return null;
  const [left, top, width, height] = b.split(',').map(Number);
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

const seta = (key: string) => {
  const alvo = document.activeElement ?? document.body;
  alvo.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

describe('tvNav — diálogo saindo (animação de saída)', () => {
  let parar: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    document.elementFromPoint = () => null;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return caixa(this) ?? ZERO; });
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      const c = caixa(this);
      return (c ? [c] : []) as unknown as DOMRectList;
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => ({
      visibility: 'visible', opacity: '1', position: 'static', display: el.closest('[hidden]') ? 'none' : 'block',
    }) as unknown as CSSStyleDeclaration);
    // Página com uma fileira + o menu de favoritos FECHANDO por cima (o Radix ainda não tirou a caixa).
    document.body.innerHTML = `
      <main>
        <div data-row-key="top10-movie">
          <button data-tv-card data-tv-key="movie-1" id="c1" data-box="0,120,100,150">A</button>
          <button data-tv-card data-tv-key="movie-2" id="c2" data-box="112,120,100,150">B</button>
        </div>
      </main>
      <div role="alertdialog" data-state="closed" id="saindo">
        <button id="fav" data-box="400,300,200,40">Adicionar aos favoritos</button>
        <button id="cancelar" data-box="400,350,200,40">Cancelar</button>
      </div>`;
    parar = startTvNav();
  });

  afterEach(() => {
    parar();
    vi.restoreAllMocks();
    vi.useRealTimers();
    lembrarCartaz('');
    document.body.innerHTML = '';
  });

  it('a caixa saindo não é a raiz das setas (a página é)', () => {
    expect(raiz()).toBe(document);
  });

  it('a seta depois do OK anda na fileira, não entra na caixa saindo', () => {
    document.getElementById('c1')!.focus();
    seta('ArrowRight');
    expect(document.activeElement?.id).toBe('c2');
    seta('ArrowDown');                                // embaixo só tem a caixa saindo: fica na fileira
    expect(document.activeElement?.id).toBe('c2');
  });

  it('a mesma caixa ABERTA continua prendendo o foco', () => {
    document.getElementById('saindo')!.setAttribute('data-state', 'open');
    expect(raiz()).toBe(document.getElementById('saindo'));
    document.getElementById('fav')!.focus();
    seta('ArrowDown');
    expect(document.activeElement?.id).toBe('cancelar');
    seta('ArrowUp');
    expect(document.activeElement?.id).toBe('fav');
  });
});
