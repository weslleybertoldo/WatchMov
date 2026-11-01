import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startTvNav, SEGURAR_MS } from './tvNav';

// Segurar o OK do controle numa capa (data-tv-hold) abre o menu dos favoritos; soltar rápido abre o título.
// O clique de um <button> sai no APERTAR do OK — na capa ele passa pro SOLTAR, senão não dá pra saber se vai segurar.

const ok = (alvo: Element, tipo: 'keydown' | 'keyup', repeat = false) => {
  const e = new KeyboardEvent(tipo, { key: 'Enter', bubbles: true, cancelable: true, repeat });
  alvo.dispatchEvent(e);
  return e;
};

describe('tvNav — segurar o OK na capa', () => {
  let parar: () => void;
  let capa: HTMLButtonElement;
  let outro: HTMLButtonElement;
  let cliques: number;
  let segurou: number;

  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    document.elementFromPoint = () => null;      // o jsdom não tem (o tvNav procura camada por cima da tela)
    document.body.innerHTML = '';
    capa = document.createElement('button');
    capa.setAttribute('data-tv-hold', '');
    capa.setAttribute('data-tv-card', '');
    capa.setAttribute('data-tv-key', 'movie-39254');
    capa.textContent = 'Gigantes de Aço';
    outro = document.createElement('button');
    outro.textContent = 'Remover dos favoritos';
    document.body.append(capa, outro);
    cliques = 0;
    segurou = 0;
    capa.addEventListener('click', () => { cliques++; });
    capa.addEventListener('tv-segurar', () => { segurou++; });
    capa.focus();
    parar = startTvNav();
  });

  afterEach(() => {
    parar();
    vi.useRealTimers();
  });

  it('apertar e soltar rápido = abre o título (clique no soltar), sem menu', () => {
    const desce = ok(capa, 'keydown');
    expect(desce.defaultPrevented).toBe(true);   // o clique nativo do apertar não sai
    expect(cliques).toBe(0);
    vi.advanceTimersByTime(150);
    ok(capa, 'keyup');
    expect(cliques).toBe(1);
    vi.advanceTimersByTime(SEGURAR_MS);
    expect(segurou).toBe(0);
  });

  it('segurar = menu, e soltar depois NÃO abre o título', () => {
    ok(capa, 'keydown');
    vi.advanceTimersByTime(SEGURAR_MS - 1);
    expect(segurou).toBe(0);
    vi.advanceTimersByTime(1);
    expect(segurou).toBe(1);
    ok(capa, 'keyup');
    expect(cliques).toBe(0);
  });

  it('as repetições do OK seguro não apertam o botão do menu que abriu com o foco nele', () => {
    ok(capa, 'keydown');
    vi.advanceTimersByTime(SEGURAR_MS);
    expect(segurou).toBe(1);
    outro.focus();                               // o menu abriu e o foco foi pro "Remover dos favoritos"
    const chegou = vi.fn();
    outro.addEventListener('keydown', chegou);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50);
      expect(ok(outro, 'keydown', true).defaultPrevented).toBe(true);
    }
    expect(chegou).not.toHaveBeenCalled();
    ok(outro, 'keyup');
    // Soltou: o próximo OK no menu vale normal.
    const depois = ok(outro, 'keydown');
    expect(depois.defaultPrevented).toBe(false);
    expect(chegou).toHaveBeenCalledTimes(1);
  });

  // 01/11/2026 (pedido dele: "quando eu clico e seguro ele trava"): desenhar o menu travou a página ~1 s (emulador:
  // repetição seguinte chegou 940 ms depois) — passava do REPETICAO_MS, virava "OK novo" e apertava sozinha o botão
  // do menu (o título entrava/saía dos favoritos e o menu fechava). Repetição é do MESMO aperto: sempre engolida.
  it('repetição atrasada (a TV travou desenhando o menu) não aperta o botão do menu', () => {
    ok(capa, 'keydown');
    vi.advanceTimersByTime(SEGURAR_MS);
    expect(segurou).toBe(1);
    outro.focus();
    const chegou = vi.fn();
    outro.addEventListener('keydown', chegou);
    vi.advanceTimersByTime(320);
    expect(ok(outro, 'keydown', true).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(940);                 // a página ficou presa desenhando o menu
    expect(ok(outro, 'keydown', true).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(50);
    expect(ok(outro, 'keydown', true).defaultPrevented).toBe(true);
    expect(chegou).not.toHaveBeenCalled();
    ok(outro, 'keyup');
    expect(ok(outro, 'keydown').defaultPrevented).toBe(false);   // soltou: o próximo OK no menu vale normal
    expect(chegou).toHaveBeenCalledTimes(1);
  });

  it('o soltar se perdeu: depois de uma pausa sem repetição, o próximo OK vale normal', () => {
    ok(capa, 'keydown');
    vi.advanceTimersByTime(SEGURAR_MS);
    outro.focus();
    vi.advanceTimersByTime(1000);                // nada de repetição nem de soltar
    expect(ok(outro, 'keydown').defaultPrevented).toBe(false);
  });

  it('repetição durante o segurar não dispara de novo nem clica', () => {
    ok(capa, 'keydown');
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(50); ok(capa, 'keydown', true); }
    vi.advanceTimersByTime(SEGURAR_MS);
    expect(segurou).toBe(1);
    ok(capa, 'keyup');
    expect(cliques).toBe(0);
  });

  it('botão que não é capa segue com o clique nativo do apertar (nada muda)', () => {
    outro.focus();
    expect(ok(outro, 'keydown').defaultPrevented).toBe(false);
    ok(outro, 'keyup');
    vi.advanceTimersByTime(SEGURAR_MS);
    expect(segurou).toBe(0);
  });

  it('o app saiu da frente no meio do segurar: nada de menu', () => {
    ok(capa, 'keydown');
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(SEGURAR_MS);
    expect(segurou).toBe(0);
    expect(cliques).toBe(0);
  });
});
