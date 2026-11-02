import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import MediaRow from './MediaRow';
import MediaCard from './MediaCard';
import type { MediaSummary } from '@/lib/tmdb';

vi.mock('@/lib/device', () => ({ isTv: () => false }));
// Cartaz de mentira que conta quantas vezes desenhou.
vi.mock('./MediaCard', () => ({ default: vi.fn(() => <div data-tv-card />) }));

const itens = (n: number): MediaSummary[] => Array.from({ length: n }, (_, i) => ({
  type: 'movie', tmdbId: 7000 + i, title: `Filme ${i}`, posterUrl: `https://image.tmdb.org/t/p/w342/m${i}.jpg`,
}));

// W2 do raio-x (02/11/2026): o Index redesenha por coisas que não têm a ver com a fileira (avisos, downloads, login) e
// passa funções novas a cada desenho (`() => …`): a fileira não redesenha nem as capas por isso.
describe('MediaRow — só redesenha quando os dados dela mudam', () => {
  const abrir = () => {};
  const lista = itens(4);
  const Pai = ({ n, items = lista, onOpen = abrir }: { n: number; items?: MediaSummary[]; onOpen?: (m: MediaSummary) => void }) => (
    <MediaRow title="Ação" items={items} onOpen={onOpen} onSeeAll={() => n} loader={() => Promise.resolve([])} />
  );

  it('funções novas a cada desenho do pai não redesenham a fileira', () => {
    const r = render(<Pai n={1} />);
    const desenhos = vi.mocked(MediaCard).mock.calls.length;
    expect(desenhos).toBe(4);
    r.rerender(<Pai n={2} />);
    r.rerender(<Pai n={3} />);
    expect(vi.mocked(MediaCard).mock.calls.length).toBe(desenhos);
  });

  it('lista nova ou onOpen novo redesenham', () => {
    vi.mocked(MediaCard).mockClear();
    const r = render(<Pai n={1} />);
    r.rerender(<Pai n={1} items={itens(4)} />);
    expect(vi.mocked(MediaCard).mock.calls.length).toBe(8);
    r.rerender(<Pai n={1} items={lista} onOpen={() => {}} />);
    expect(vi.mocked(MediaCard).mock.calls.length).toBeGreaterThan(8);
  });

  it('as capas recebem a ficha e a MESMA função de abrir (sem uma função nova por capa)', () => {
    vi.mocked(MediaCard).mockClear();
    render(<Pai n={1} />);
    const props = vi.mocked(MediaCard).mock.calls.map(c => c[0] as { media: MediaSummary; onOpen?: unknown; onClick?: unknown });
    expect(props.map(p => p.media.tmdbId)).toEqual([7000, 7001, 7002, 7003]);
    expect(new Set(props.map(p => p.onOpen))).toEqual(new Set([abrir]));
    expect(props.every(p => p.onClick === undefined)).toBe(true);
  });
});
