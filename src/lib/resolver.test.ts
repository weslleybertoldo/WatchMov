// src/lib/resolver.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildClickScript, buildInjectScript, CLICK_STEPS, HOP_HOSTS, isHopHost, resolverEnabled, setResolverEnabled, resolverOnCooldown, noteResolverResult, COOLDOWN_MS } from './resolver';

describe('resolver oculto (regras puras)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('clickScript é JS válido, leva os passos na ordem e muta os vídeos', () => {
    const s = buildClickScript();
    expect(() => new Function(s)).not.toThrow();
    for (const st of CLICK_STEPS) expect(s).toContain(st);
    expect(s.indexOf('Mostrar Op')).toBeLessThan(s.indexOf('Opção 2'));
    expect(s.indexOf('.option')).toBeLessThan(s.indexOf('.captcha-gate__play'));
    expect(s).toContain('v.muted=true');
  });

  it('injectScript é JS válido, roda em todo frame, clica o gate da Byse e muta vídeos', () => {
    const s = buildInjectScript();
    expect(() => new Function(s)).not.toThrow();
    expect(s).toContain('.captcha-gate__play');
    expect(s).toContain('text:Opção 2');
    expect(s).toContain('__wmInj');
    expect(s).toContain('setInterval');
    expect(s).toContain('v.muted=true');
  });

  it('hop só pros hosts conhecidos (e subdomínios)', () => {
    expect(isHopHost('playerflix.ink')).toBe(true);
    expect(isHopHost('www.embedplay.one')).toBe(true);
    expect(isHopHost('f7hyg4q.org')).toBe(true);
    expect(isHopHost('xn--tckasiu6cvova0eb5fua2449g98vg.best')).toBe(false);   // SuperFlix toca sozinho no iframe
    expect(isHopHost('blogger.com')).toBe(false);
    expect(isHopHost(null)).toBe(false);
    expect(HOP_HOSTS).toHaveLength(3);
  });

  it('toggle: ligado por padrão; desligar/ligar persiste', () => {
    expect(resolverEnabled()).toBe(true);
    setResolverEnabled(false); expect(resolverEnabled()).toBe(false);
    setResolverEnabled(true); expect(resolverEnabled()).toBe(true);
  });

  it('cooldown: 2 timeouts seguidos → 24 h sem tentar (por fonte); sucesso zera; janela expira', () => {
    const t0 = 1_000_000;
    expect(resolverOnCooldown('superflix', t0)).toBe(false);
    noteResolverResult('superflix', false, t0);
    expect(resolverOnCooldown('superflix', t0 + 1000)).toBe(false);
    noteResolverResult('superflix', false, t0 + 2000);
    expect(resolverOnCooldown('superflix', t0 + 3000)).toBe(true);
    expect(resolverOnCooldown('embedmovies', t0 + 3000)).toBe(false);
    expect(resolverOnCooldown('superflix', t0 + 2000 + COOLDOWN_MS + 1)).toBe(false);
    noteResolverResult('superflix', true, t0 + 4000);
    expect(resolverOnCooldown('superflix', t0 + 5000)).toBe(false);
  });

  it('falha antiga (fora da janela) recomeça a contagem', () => {
    const t0 = 5_000_000;
    noteResolverResult('fembed', false, t0);
    noteResolverResult('fembed', false, t0 + COOLDOWN_MS + 10);
    expect(resolverOnCooldown('fembed', t0 + COOLDOWN_MS + 20)).toBe(false);
  });
});
