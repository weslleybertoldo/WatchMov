import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import Grade from './Grade';
import { faixaDaJanela, alturaDasLinhas, linhaNaAltura, palpiteDeAltura, JANELA_TV } from '@/lib/gradeJanela';
import { isTv } from '@/lib/device';

vi.mock('@/lib/device', () => ({ isTv: vi.fn(() => false) }));

const itens = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, nome: `Filme ${i}` }));
const desenhar = (n: number) => render(
  <Grade itens={itens(n)} chave={m => `m-${m.id}`}>
    {m => <button data-cartaz={m.id}>{m.nome}</button>}
  </Grade>,
);
// A janela anda logo depois do quadro que mostra o foco novo (rAF + tarefa): espera esse passo, como na TV.
const depoisDoQuadro = () => act(() => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0))));
const focarEsperar = async (c: HTMLElement, i: number) => { fireEvent.focus(c.querySelector(`[data-cartaz="${i}"]`)!); await depoisDoQuadro(); };
const cartazes = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-cartaz]')).map(b => Number(b.dataset.cartaz));

describe('Grade — contas da janela (W5 do raio-x)', () => {
  it('faixa = a linha do foco ± janela, sem passar das pontas', () => {
    expect(faixaDaJanela(0, 17)).toEqual([0, JANELA_TV]);
    expect(faixaDaJanela(8, 17)).toEqual([8 - JANELA_TV, 8 + JANELA_TV]);
    expect(faixaDaJanela(16, 17)).toEqual([16 - JANELA_TV, 16]);
    expect(faixaDaJanela(40, 17)).toEqual([16 - JANELA_TV, 16]);   // a lista encolheu: fica na última
    expect(faixaDaJanela(2, 3)).toEqual([0, 2]);
    expect(faixaDaJanela(0, 0)).toEqual([0, -1]);
  });

  it('altura das linhas fora da janela: a medida de cada uma (ou o palpite) + o vão', () => {
    const m = new Map([[0, 200], [1, 210]]);
    expect(alturaDasLinhas(0, 1, m, 230, 12)).toBe(200 + 12 + 210 + 12);
    expect(alturaDasLinhas(1, 3, m, 230, 12)).toBe(210 + 12 + 2 * (230 + 12));
    expect(alturaDasLinhas(0, -1, m, 230, 12)).toBe(0);
    expect(palpiteDeAltura(m)).toBe(205);
    expect(palpiteDeAltura(new Map())).toBe(230);
  });

  it('linha na altura y (o meio do vão decide)', () => {
    const m = new Map<number, number>();
    expect(linhaNaAltura(-50, 10, m, 100, 10)).toBe(0);
    expect(linhaNaAltura(104, 10, m, 100, 10)).toBe(0);
    expect(linhaNaAltura(106, 10, m, 100, 10)).toBe(1);
    expect(linhaNaAltura(330, 10, m, 100, 10)).toBe(3);
    expect(linhaNaAltura(99999, 10, m, 100, 10)).toBe(9);
  });
});

describe('Grade — celular', () => {
  beforeEach(() => vi.mocked(isTv).mockReturnValue(false));

  it('monta a lista inteira, sem invólucro (igual a antes)', () => {
    const { container } = desenhar(100);
    expect(cartazes(container)).toHaveLength(100);
    expect(container.querySelector('[data-grade-tv]')).toBeNull();
    expect(container.querySelector('[data-grade-i]')).toBeNull();
    const grade = container.firstElementChild as HTMLElement;
    expect(grade.className).toContain('grid-cols-3');
    expect(grade.firstElementChild?.tagName).toBe('BUTTON');
  });
});

describe('Grade — TV (só as linhas perto do foco)', () => {
  beforeEach(() => vi.mocked(isTv).mockReturnValue(true));   // jsdom: 1024 px de largura = 6 colunas

  it('começa com as primeiras linhas e o resto vira espaço vazio embaixo', () => {
    const { container } = desenhar(100);                       // 17 linhas de 6
    const montados = cartazes(container);
    expect(montados).toEqual(Array.from({ length: (JANELA_TV + 1) * 6 }, (_, i) => i));
    const grade = container.querySelector<HTMLElement>('[data-grade-tv]')!;
    expect(parseFloat(grade.style.paddingTop)).toBe(0);
    expect(parseFloat(grade.style.paddingBottom)).toBe((17 - (JANELA_TV + 1)) * (230 + 12));
  });

  it('a janela anda com o foco e o espaço de cima guarda a altura das linhas que saíram', async () => {
    const { container } = desenhar(100);
    for (const linha of [1, 2, 3, 4, 5, 6]) await focarEsperar(container, linha * 6);    // desce linha por linha, como a seta ↓
    const montados = cartazes(container);
    expect(montados[0]).toBe((6 - JANELA_TV) * 6);                // linhas 3..9
    expect(montados[montados.length - 1]).toBe((6 + JANELA_TV) * 6 + 5);
    expect(montados).toContain(36);                               // o cartaz focado está montado
    const grade = container.querySelector<HTMLElement>('[data-grade-tv]')!;
    expect(parseFloat(grade.style.paddingTop)).toBe((6 - JANELA_TV) * (230 + 12));
    expect(parseFloat(grade.style.paddingBottom)).toBe((17 - 1 - (6 + JANELA_TV)) * (230 + 12));
    // cada cartaz fica num invólucro `display: contents` com a posição dele na lista
    const inv = container.querySelector<HTMLElement>('[data-grade-i="36"]')!;
    expect(inv.style.display).toBe('contents');
    expect(inv.querySelector('[data-cartaz="36"]')).not.toBeNull();
  });

  it('no fim da lista a janela para na última linha; voltar pra cima remonta as de cima', async () => {
    const { container } = desenhar(100);
    for (let linha = 1; linha <= 16; linha++) await focarEsperar(container, Math.min(99, linha * 6));
    let montados = cartazes(container);
    expect(montados[montados.length - 1]).toBe(99);
    expect(montados[0]).toBe((16 - JANELA_TV) * 6);
    for (let linha = 15; linha >= 0; linha--) await focarEsperar(container, linha * 6);
    montados = cartazes(container);
    expect(montados[0]).toBe(0);
    expect(montados).toHaveLength((JANELA_TV + 1) * 6);
  });

  it('seta seguida (sem esperar o quadro): a linha de baixo do foco SEMPRE já está montada', async () => {
    const { container } = desenhar(120);
    for (let linha = 1; linha <= 15; linha++) {
      fireEvent.focus(container.querySelector(`[data-cartaz="${linha * 6}"]`)!);   // sem esperar: tecla segurada
      expect(cartazes(container)).toContain((linha + 1) * 6);                    // a próxima ↓ acha a linha de baixo
    }
    await depoisDoQuadro();
    const montados = cartazes(container);
    expect(montados).toContain(15 * 6);
    expect(montados[0]).toBe((15 - JANELA_TV) * 6);                                // depois do quadro, centrada no foco
  });

  it('lista curta (≤ 7 linhas) fica inteira, sem espaço vazio', async () => {
    const { container } = desenhar(40);
    await focarEsperar(container, 20);
    expect(cartazes(container)).toHaveLength(40);
    const grade = container.querySelector<HTMLElement>('[data-grade-tv]')!;
    expect(parseFloat(grade.style.paddingTop)).toBe(0);
    expect(parseFloat(grade.style.paddingBottom)).toBe(0);
  });

  it('a lista trocou por uma menor (filtro novo): a janela volta pra dentro dela', async () => {
    const { container, rerender } = desenhar(100);
    for (const linha of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await focarEsperar(container, linha * 6);
    rerender(
      <Grade itens={itens(20)} chave={m => `n-${m.id}`}>
        {m => <button data-cartaz={m.id}>{m.nome}</button>}
      </Grade>,
    );
    expect(cartazes(container)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});
