import { describe, it, expect } from 'vitest';
import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { telaSobDemanda } from './telaSobDemanda';

// W1 do raio-x (02/11/2026): tela fora do JS da abertura, que baixa ao abrir (ou antes, no ocioso).
function Pagina({ nome }: { nome: string }) {
  return <p>pagina {nome}</p>;
}

describe('telaSobDemanda', () => {
  it('sem preparar: mostra o carregando e depois a tela', async () => {
    let soltar: (m: { default: typeof Pagina }) => void = () => {};
    const Tela = telaSobDemanda<{ nome: string }>(() => new Promise((r) => { soltar = r; }));
    render(<Suspense fallback={<p>carregando</p>}><Tela nome="a" /></Suspense>);
    expect(screen.getByText('carregando')).toBeTruthy();
    await act(async () => { soltar({ default: Pagina }); });
    expect(screen.getByText('pagina a')).toBeTruthy();
  });

  it('já preparada: aparece direto, sem passar pelo carregando', async () => {
    let chamadas = 0;
    const Tela = telaSobDemanda<{ nome: string }>(() => { chamadas++; return Promise.resolve({ default: Pagina }); });
    await Tela.preparar();
    await Tela.preparar();                        // não baixa duas vezes
    expect(chamadas).toBe(1);
    render(<Suspense fallback={<p>carregando</p>}><Tela nome="b" /></Suspense>);
    expect(screen.queryByText('carregando')).toBeNull();
    expect(screen.getByText('pagina b')).toBeTruthy();
  });

  it('falhou ao baixar: a próxima tentativa baixa de novo', async () => {
    let chamadas = 0;
    const Tela = telaSobDemanda<{ nome: string }>(() => {
      chamadas++;
      return chamadas === 1 ? Promise.reject(new Error('rede')) : Promise.resolve({ default: Pagina });
    });
    await expect(Tela.preparar()).rejects.toThrow('rede');
    await Tela.preparar();
    expect(chamadas).toBe(2);
  });
});
