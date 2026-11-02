import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startTvNav, devolverFoco, lembrarCartaz } from './tvNav';

// W3 do raio-x (02/11/2026): o Início e as abas vistas ficam montados e ESCONDIDOS (`hidden`) com o título por cima.
// As setas não podem ver nada da tela escondida — nem o aviso de atualização (role=dialog) que mora no rodapé do Início —
// e, quando ela reaparece, o foco volta já no cartaz aberto.

// O jsdom não tem layout: a caixa vem de `data-box="esq,topo,larg,alt"`; dentro de [hidden] não há caixa.
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

describe('tvNav — telas guardadas escondidas', () => {
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
    // O jsdom devolve opacity "" (= 0, "invisível" pro tvNav): estilo de página normal.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => ({
      visibility: 'visible', opacity: '1', position: 'static', display: el.closest('[hidden]') ? 'none' : 'block',
    }) as unknown as CSSStyleDeclaration);
    // Início escondido (com o aviso de atualização e o MESMO cartaz da aba Filmes) + aba Filmes à vista.
    document.body.innerHTML = `
      <header><button id="aba-filmes" data-box="300,10,60,30">Filmes</button></header>
      <main>
        <div data-tela="aba:inicio" hidden>
          <div data-row-key="top10-movie">
            <button data-tv-card data-tv-key="movie-1" id="ini-1" data-box="0,300,100,150">A</button>
            <button data-tv-card data-tv-key="movie-2" id="ini-2" data-box="112,300,100,150">B</button>
          </div>
          <footer><div role="dialog"><button id="baixar" data-box="20,400,200,40">Baixar atualização</button></div></footer>
        </div>
        <div data-tela="aba:filmes">
          <div data-row-key="top10-movie">
            <button data-tv-card data-tv-key="movie-1" id="fil-1" data-box="0,120,100,150">A</button>
            <button data-tv-card data-tv-key="movie-2" id="fil-2" data-box="112,120,100,150">B</button>
            <button data-tv-card data-tv-key="movie-3" id="fil-3" data-box="224,120,100,150">C</button>
          </div>
        </div>
      </main>`;
    parar = startTvNav();
  });

  afterEach(() => {
    parar();
    vi.restoreAllMocks();
    vi.useRealTimers();
    lembrarCartaz('');
    document.body.innerHTML = '';
  });

  it('o aviso (role=dialog) da tela escondida não prende as setas', () => {
    document.getElementById('fil-1')!.focus();
    seta('ArrowRight');
    expect(document.activeElement?.id).toBe('fil-2');
    seta('ArrowRight');
    expect(document.activeElement?.id).toBe('fil-3');
  });

  it('a seta nunca cai num cartaz da tela escondida', () => {
    document.getElementById('fil-2')!.focus();
    seta('ArrowLeft');
    expect(document.activeElement?.id).toBe('fil-1');
    seta('ArrowLeft');                              // fim da fileira: fica (não pula pro Início escondido)
    expect(document.activeElement?.id).toBe('fil-1');
  });

  it('devolverFoco: foco perdido → já no cartaz aberto por último, o da tela à vista', () => {
    lembrarCartaz('movie-2');
    (document.activeElement as HTMLElement | null)?.blur();
    expect(devolverFoco()).toBe(true);
    expect(document.activeElement?.id).toBe('fil-2');
  });

  it('devolverFoco: foco ainda num item à vista (o botão da aba) fica onde está', () => {
    lembrarCartaz('movie-2');
    document.getElementById('aba-filmes')!.focus();
    expect(devolverFoco()).toBe(false);
    expect(document.activeElement?.id).toBe('aba-filmes');
  });

  it('devolverFoco: foco dentro da tela que acabou de esconder conta como perdido', () => {
    document.getElementById('ini-1')!.focus();       // estava no Início…
    lembrarCartaz('movie-3');
    expect(devolverFoco()).toBe(true);               // …que escondeu: vai pro da aba à vista
    expect(document.activeElement?.id).toBe('fil-3');
  });
});
