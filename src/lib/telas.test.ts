import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { guardarAba, MemoriaDeRolagem, fileiraVisivel, recolocarRolagem } from './telas';

// W3 do raio-x (02/11/2026): abas guardadas montadas e a rolagem de cada tela.

describe('guardarAba', () => {
  it('Início fica sempre, primeiro', () => {
    expect(guardarAba(['inicio'], 'filmes', 'inicio', 2)).toEqual(['inicio', 'filmes']);
    expect(guardarAba(['inicio', 'filmes'], 'inicio', 'inicio', 2)).toEqual(['inicio', 'filmes']);
  });

  it('passou do limite, sai a vista há mais tempo', () => {
    let v: string[] = guardarAba<string>(['inicio'], 'filmes', 'inicio', 2);
    v = guardarAba(v, 'series', 'inicio', 2);
    v = guardarAba(v, 'animes', 'inicio', 2);
    expect(v).toEqual(['inicio', 'series', 'animes']);
  });

  it('voltar a uma aba guardada a põe como a mais recente', () => {
    const v = guardarAba(['inicio', 'filmes', 'series'], 'filmes', 'inicio', 2);
    expect(v).toEqual(['inicio', 'series', 'filmes']);
    expect(guardarAba(v, 'animes', 'inicio', 2)).toEqual(['inicio', 'filmes', 'animes']);
  });

  it('TV: só 1 além do Início', () => {
    let v: string[] = guardarAba<string>(['inicio'], 'filmes', 'inicio', 1);
    v = guardarAba(v, 'series', 'inicio', 1);
    expect(v).toEqual(['inicio', 'series']);
  });

  it('limite 0 = só o Início', () => {
    expect(guardarAba(['inicio', 'filmes'], 'series', 'inicio', 0)).toEqual(['inicio']);
  });
});

describe('MemoriaDeRolagem', () => {
  it('guarda, lê e esquece por tela', () => {
    const m = new MemoriaDeRolagem();
    m.guardar('aba:inicio', { y: 900, rowKey: 'top10-movie', rowTop: 120 });
    expect(m.ler('aba:inicio')).toEqual({ y: 900, rowKey: 'top10-movie', rowTop: 120 });
    m.esquecer('aba:inicio');
    expect(m.ler('aba:inicio')).toBeUndefined();
  });

  it('manterSo apaga as telas que não podem mais voltar', () => {
    const m = new MemoriaDeRolagem();
    m.guardar('aba:inicio', { y: 1 });
    m.guardar('categoria:cat-recent-movie', { y: 2 });
    m.guardar('titulo:movie-1', { y: 3 });
    m.manterSo(['aba:inicio', 'aba:filmes']);
    expect(m.chaves()).toEqual(['aba:inicio']);
  });
});

// O jsdom não tem layout: cada elemento ganha a caixa de `data-top` (relativa à tela) e, dentro de [hidden], nenhuma.
function caixa(el: Element) {
  if (el.closest('[hidden]')) return null;
  const top = Number((el as HTMLElement).dataset.top ?? 0) - window.scrollY;
  return { top, bottom: top + 200, left: 0, right: 960, width: 960, height: 200, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

describe('fileiraVisivel e recolocarRolagem', () => {
  let rolagem = 0;
  beforeEach(() => {
    rolagem = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => rolagem });
    window.scrollTo = vi.fn((_x: number | ScrollToOptions, y?: number) => { rolagem = Number(y ?? 0); }) as unknown as typeof window.scrollTo;
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      const c = caixa(this);
      return (c ? [c] : []) as unknown as DOMRectList;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return caixa(this) ?? ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    });
    // A tela escondida (aba Filmes) vem ANTES da visível no documento, com a mesma fileira do Top 10.
    document.body.innerHTML = `
      <div data-tela="aba:filmes" hidden><div data-row-key="top10-movie" data-top="300"></div></div>
      <div data-tela="aba:inicio"><div data-row-key="hero" data-top="0"></div><div data-row-key="top10-movie" data-top="1500"></div></div>`;
  });
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('acha a fileira da tela à vista, não a da escondida', () => {
    const f = fileiraVisivel('top10-movie');
    expect(f?.closest('[data-tela]')?.getAttribute('data-tela')).toBe('aba:inicio');
  });

  it('recoloca a fileira âncora no mesmo lugar da tela — já, antes de pintar', () => {
    const cancelar = recolocarRolagem({ y: 50, rowKey: 'top10-movie', rowTop: 120 });
    expect(rolagem).toBe(1500 - 120);
    cancelar();
  });

  it('sem âncora (ou a fileira sumiu), volta pro scrollY guardado', () => {
    recolocarRolagem({ y: 640 })();
    expect(rolagem).toBe(640);
    recolocarRolagem({ y: 222, rowKey: 'nao-existe', rowTop: 10 })();
    expect(rolagem).toBe(222);
  });

  it('a pessoa rolou depois da 1ª passada: as outras não brigam com ela', () => {
    vi.useFakeTimers();
    try {
      recolocarRolagem({ y: 640 });
      expect(rolagem).toBe(640);
      rolagem = 900;                 // rolou
      vi.advanceTimersByTime(200);   // a passada dos 150 ms
      expect(rolagem).toBe(900);
    } finally {
      vi.useRealTimers();
    }
  });
});
