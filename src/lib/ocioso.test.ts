import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// W4 das quedas na Fire TV (01/11/2026): fila do tempo ocioso — uma tarefa por vez, na ordem, e dá pra desistir.
describe('naFilaDoOcioso', () => {
  let ociosos: { cb: IdleRequestCallback; opts?: IdleRequestOptions }[];
  const rodarOcioso = () => ociosos.shift()!.cb({ didTimeout: false, timeRemaining: () => 10 } as IdleDeadline);

  beforeEach(() => {
    vi.resetModules();   // estado da fila é do módulo: cada teste começa com ela vazia
    ociosos = [];
    vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback, opts?: IdleRequestOptions) => { ociosos.push({ cb, opts }); return ociosos.length; });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('roda uma tarefa por ocioso, na ordem de chegada, com prazo', async () => {
    const { naFilaDoOcioso, PRAZO_OCIOSO_MS } = await import('./ocioso');
    const feitas: string[] = [];
    naFilaDoOcioso(() => feitas.push('a'));
    naFilaDoOcioso(() => feitas.push('b'));
    naFilaDoOcioso(() => feitas.push('c'));
    expect(ociosos).toHaveLength(1);                      // só um ocioso pedido por vez
    expect(ociosos[0].opts?.timeout).toBe(PRAZO_OCIOSO_MS);
    rodarOcioso();
    expect(feitas).toEqual(['a']);
    expect(ociosos).toHaveLength(1);                      // a próxima pediu o seu
    rodarOcioso();
    rodarOcioso();
    expect(feitas).toEqual(['a', 'b', 'c']);
    expect(ociosos).toHaveLength(0);
  });

  it('desistir tira a tarefa da fila; a fila segue com as outras', async () => {
    const { naFilaDoOcioso } = await import('./ocioso');
    const feitas: string[] = [];
    naFilaDoOcioso(() => feitas.push('a'));
    const desistir = naFilaDoOcioso(() => feitas.push('b'));
    naFilaDoOcioso(() => feitas.push('c'));
    desistir();
    rodarOcioso();
    rodarOcioso();
    expect(feitas).toEqual(['a', 'c']);
    expect(ociosos).toHaveLength(0);
  });

  it('tarefa que quebra não trava a fila', async () => {
    const { naFilaDoOcioso } = await import('./ocioso');
    const feitas: string[] = [];
    naFilaDoOcioso(() => { throw new Error('x'); });
    naFilaDoOcioso(() => feitas.push('b'));
    expect(() => rodarOcioso()).toThrow('x');
    rodarOcioso();
    expect(feitas).toEqual(['b']);
  });

  it('sem requestIdleCallback usa um setTimeout curto', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    const { naFilaDoOcioso } = await import('./ocioso');
    const feitas: string[] = [];
    naFilaDoOcioso(() => feitas.push('a'));
    naFilaDoOcioso(() => feitas.push('b'));
    vi.advanceTimersByTime(50);
    expect(feitas).toEqual(['a']);
    vi.advanceTimersByTime(50);
    expect(feitas).toEqual(['a', 'b']);
  });
});

// W1 do raio-x (02/11/2026): o que pode esperar a abertura espera a tela assentar e ainda vai pra fila do ocioso.
describe('depoisDeAssentar', () => {
  let ociosos: IdleRequestCallback[];
  beforeEach(() => {
    vi.resetModules();
    ociosos = [];
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => { ociosos.push(cb); return ociosos.length; });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('espera o tempo de assentar e depois o ocioso', async () => {
    const { depoisDeAssentar, ESPERA_ASSENTAR_MS } = await import('./ocioso');
    const feitas: string[] = [];
    depoisDeAssentar(() => feitas.push('a'));
    vi.advanceTimersByTime(ESPERA_ASSENTAR_MS - 1);
    expect(ociosos).toHaveLength(0);                    // ainda não pediu o ocioso
    vi.advanceTimersByTime(1);
    expect(ociosos).toHaveLength(1);
    expect(feitas).toEqual([]);
    ociosos.shift()!({ didTimeout: false, timeRemaining: () => 10 } as IdleDeadline);
    expect(feitas).toEqual(['a']);
  });

  it('desistir antes (ou já na fila) não roda', async () => {
    const { depoisDeAssentar } = await import('./ocioso');
    const feitas: string[] = [];
    const antes = depoisDeAssentar(() => feitas.push('antes'), 100);
    const naFila = depoisDeAssentar(() => feitas.push('na fila'), 100);
    antes();
    vi.advanceTimersByTime(100);
    naFila();
    while (ociosos.length) ociosos.shift()!({ didTimeout: false, timeRemaining: () => 10 } as IdleDeadline);
    expect(feitas).toEqual([]);
  });
});
