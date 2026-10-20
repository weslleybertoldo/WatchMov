// src/lib/pomfy.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROVIDERS, PROVIDER_HOSTS, rotuloDaFonte } from './players';
import { budgetFor, buildOptionCycleScript, clickStepsFor, wrapsIframe, CLICK_STEPS, CLICK_STEPS_POMFY, IFRAME_PROVIDERS, RESOLVER_BUDGET_ABYS_MS, RESOLVER_BUDGET_MS } from './resolver';

// 19/10/2026: Pomfy (api.pomfy.stream) como Fonte 4 — dublado + original no mesmo HLS; só abre dentro de iframe.
describe('Fonte 4 (Pomfy)', () => {
  it('entra como Fonte 4; SuperFlix vira 5 e WarezCDN 6 (ids iguais)', () => {
    expect(PROVIDERS.map(p => p.id)).toEqual(['embedmovies', 'embedplayapi', 'fshd', 'pomfy', 'superflix', 'warezcdn']);
    expect(rotuloDaFonte('pomfy')).toBe('4 · Pomfy');
    expect(rotuloDaFonte('superflix')).toBe('5 · SuperFlix');
    expect(rotuloDaFonte('warezcdn')).toBe('6 · WarezCDN');
  });

  it('monta a URL pelo TMDB id (filme e episódio); sem TMDB não aparece', () => {
    const p = PROVIDERS.find(x => x.id === 'pomfy')!;
    expect(p.build({ type: 'movie', tmdbId: 299534 })).toBe('https://api.pomfy.stream/filme/299534');
    expect(p.build({ type: 'tv', tmdbId: 95350, season: 1, episode: 2 })).toBe('https://api.pomfy.stream/serie/95350/1/2');
    expect(p.build({ type: 'tv', tmdbId: 100088 })).toBe('https://api.pomfy.stream/serie/100088/1/1');
    expect(p.build({ type: 'movie', imdbId: 'tt4154796' })).toBeNull();
  });

  it('o modo Servidor da web pode abrir a Pomfy (frame-src do vercel.json)', () => {
    expect(PROVIDER_HOSTS).toContain('https://api.pomfy.stream');
    const frameSrc = /frame-src ([^;]+);/.exec(readFileSync('vercel.json', 'utf8'))?.[1] ?? '';
    expect(frameSrc.split(' ')).toContain('https://api.pomfy.stream');
  });

  it('só a Pomfy abre dentro de iframe; os passos dela são Assistir → Servidor 1 → gate da Byse', () => {
    expect(IFRAME_PROVIDERS).toEqual(['pomfy']);
    expect(wrapsIframe('pomfy')).toBe(true);
    expect(wrapsIframe('embedmovies')).toBe(false);
    expect(wrapsIframe(undefined)).toBe(false);
    expect(clickStepsFor('pomfy')).toBe(CLICK_STEPS_POMFY);
    expect(clickStepsFor('embedmovies')).toBe(CLICK_STEPS);
    expect(CLICK_STEPS_POMFY.slice(0, 2)).toEqual(['text:Assistir', 'text:Servidor 1']);
    expect(CLICK_STEPS_POMFY).toContain('.captcha-gate__play');
  });

  it('3 páginas até o vídeo (~44 s no emulador) → prazo de 90 s, igual ao ABYS; as outras seguem com 45 s', () => {
    expect(budgetFor('pomfy')).toBe(RESOLVER_BUDGET_ABYS_MS);
    expect(budgetFor('embedmovies')).toBe(RESOLVER_BUDGET_MS);
  });

  it('na página da Pomfy clica "Assistir", depois o "Servidor 1" — nunca o 2 ("Em breve")', () => {
    document.body.innerHTML = '<div class="hero"><h1>Vingadores: Ultimato</h1><p>Após os eventos devastadores…</p>'
      + '<button id="assistir">Assistir</button></div>'
      + '<div id="modal" hidden><h2>Escolha o servidor</h2><p>Se um servidor não funcionar, tente o outro.</p>'
      + '<button id="s1"><span>Servidor 1</span><small>Mais rápido e com boa qualidade</small><em>Disponível</em></button>'
      + '<button id="s2"><span>Servidor 2</span><small>Lento, mas com ótima qualidade</small><em>Em breve</em></button></div>';
    const cliques: string[] = [];
    document.getElementById('assistir')!.addEventListener('click', () => { cliques.push('assistir'); document.getElementById('modal')!.removeAttribute('hidden'); });
    document.getElementById('s1')!.addEventListener('click', () => cliques.push('servidor 1'));
    document.getElementById('s2')!.addEventListener('click', () => cliques.push('servidor 2'));
    // jsdom não mede layout: visível = fora do modal escondido.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const w = this.closest('[hidden]') ? 0 : 100;
      return { width: w, height: w / 2, top: 0, left: 0, right: w, bottom: w / 2, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const win = window as unknown as Record<string, unknown>;
    const prevInj = win.__wmInj;
    win.__wmInj = undefined;
    vi.useFakeTimers();
    try {
      new Function(buildOptionCycleScript(CLICK_STEPS_POMFY).replace(/__OPT_K__/g, '1'))();
      expect(cliques).toEqual(['assistir']);              // 1ª volta: o modal ainda está escondido
      vi.advanceTimersByTime(650);
      expect(cliques).toEqual(['assistir', 'servidor 1']);
      vi.advanceTimersByTime(650 * 10);
      expect(cliques).toEqual(['assistir', 'servidor 1']);   // cada passo 1× por página
    } finally {
      vi.useRealTimers();
      rect.mockRestore();
      win.__wmInj = prevInj;
      document.body.innerHTML = '';
    }
  });
});
