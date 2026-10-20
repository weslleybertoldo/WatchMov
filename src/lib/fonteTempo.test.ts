import { describe, it, expect } from 'vitest';
import { textoDaBusca, lerBusca, tempoDasFontes, fmtTempo, BUSCA_TEMPO } from './fonteTempo';

const linha = (cause: string, name = BUSCA_TEMPO) => ({ error_name: name, error_cause: cause });

describe('tempo de cada fonte (item 16)', () => {
  it('o texto do registro vai e volta (fonte, resultado e ms)', () => {
    const t = textoDaBusca({ fonte: '4 · Pomfy', resultado: 'achou', ms: 31234.4, extra: 'opcao=Servidor 1 aparelho=tv' });
    expect(t).toBe('fonte=4 · Pomfy resultado=achou ms=31234 opcao=Servidor 1 aparelho=tv');
    expect(lerBusca(t)).toEqual({ fonte: '4 · Pomfy', resultado: 'achou', ms: 31234 });
    expect(lerBusca('reason=f4-indisponivel')).toBeNull();
    expect(lerBusca(null)).toBeNull();
  });

  it('resume por fonte: achou (mediana), não tem e estourou; a mais rápida primeiro, a que nunca achou no fim', () => {
    const rows = [
      linha('fonte=4 · Pomfy resultado=achou ms=30000'),
      linha('fonte=4 · Pomfy resultado=achou ms=40000'),
      linha('fonte=4 · Pomfy resultado=nao-tem ms=1500 motivo=f4-indisponivel'),
      linha('fonte=1 · EmbedMovies resultado=achou ms=12000'),
      linha('fonte=2 · EmbedPlay resultado=estourou ms=90000'),
      linha('fonte=2 · EmbedPlay resultado=nao-tem ms=900'),
      linha('reason=x', 'RESOLVER_SEM_TITULO'),   // outro registro: não entra
    ];
    expect(tempoDasFontes(rows)).toEqual([
      { fonte: '1 · EmbedMovies', achou: 1, naoTem: 0, estourou: 0, medianaAchouMs: 12000 },
      { fonte: '4 · Pomfy', achou: 2, naoTem: 1, estourou: 0, medianaAchouMs: 35000 },
      { fonte: '2 · EmbedPlay', achou: 0, naoTem: 1, estourou: 1, medianaAchouMs: null },
    ]);
    expect(tempoDasFontes([])).toEqual([]);
  });

  it('tempo legível', () => {
    expect(fmtTempo(1500)).toBe('2 s');
    expect(fmtTempo(31200)).toBe('31 s');
    expect(fmtTempo(65000)).toBe('1 min 05 s');
  });
});
