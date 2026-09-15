// src/lib/resolver.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildClickScript, buildInjectScript, CLICK_STEPS, HOP_HOSTS, isHopHost, resolverEnabled, setResolverEnabled, resolverOnCooldown, resolverCooldownUntil, noteResolverResult, clearResolverCooldown, resolverSkipReason, COOLDOWN_MS, COOLDOWN_FAILS } from './resolver';

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

  it('pausa: 3 timeouts seguidos → 2 h sem tentar (por fonte); sucesso zera; janela expira', () => {
    const t0 = 1_000_000;
    expect(COOLDOWN_FAILS).toBe(3); expect(COOLDOWN_MS).toBe(2 * 60 * 60 * 1000);
    expect(resolverOnCooldown('superflix', t0)).toBe(false);
    noteResolverResult('superflix', false, t0);
    noteResolverResult('superflix', false, t0 + 1000);
    expect(resolverOnCooldown('superflix', t0 + 2000)).toBe(false);          // 2 ainda não pausa
    noteResolverResult('superflix', false, t0 + 2000);
    expect(resolverOnCooldown('superflix', t0 + 3000)).toBe(true);
    expect(resolverCooldownUntil('superflix', t0 + 3000)).toBe(t0 + 2000 + COOLDOWN_MS);
    expect(resolverOnCooldown('embedmovies', t0 + 3000)).toBe(false);
    expect(resolverCooldownUntil('embedmovies', t0 + 3000)).toBe(0);
    expect(resolverOnCooldown('superflix', t0 + 2000 + COOLDOWN_MS + 1)).toBe(false);
    noteResolverResult('superflix', true, t0 + 4000);
    expect(resolverOnCooldown('superflix', t0 + 5000)).toBe(false);
  });

  it('falha antiga (fora da janela) recomeça a contagem', () => {
    const t0 = 5_000_000;
    noteResolverResult('fembed', false, t0);
    noteResolverResult('fembed', false, t0 + COOLDOWN_MS + 10);
    noteResolverResult('fembed', false, t0 + COOLDOWN_MS + 20);
    expect(resolverOnCooldown('fembed', t0 + COOLDOWN_MS + 30)).toBe(false);
  });

  it('pausa de OUTRA versão (ou sem versão, v4.52–4.54) não vale; "Tentar agora" limpa', () => {
    const now = Date.now();
    localStorage.setItem('watchmov_resolver_fails', JSON.stringify({ embedplayapi: { n: 9, ts: now, v: '4.52' }, embedmovies: { n: 9, ts: now } }));
    expect(resolverOnCooldown('embedplayapi', now)).toBe(false);
    expect(resolverOnCooldown('embedmovies', now)).toBe(false);
    for (let i = 0; i < 3; i++) noteResolverResult('embedplayapi', false, now + i);
    expect(resolverOnCooldown('embedplayapi', now + 10)).toBe(true);
    clearResolverCooldown('embedplayapi');
    expect(resolverOnCooldown('embedplayapi', now + 10)).toBe(false);
  });

  it('motivo de não rodar: prioridade off > cache > servidor > pausa > já tentou', () => {
    const base = { enabled: true, cacheOpen: false, armed: true, cooldown: false, tried: false };
    expect(resolverSkipReason(base)).toBeNull();
    expect(resolverSkipReason({ ...base, enabled: false, cooldown: true })).toBe('off');
    expect(resolverSkipReason({ ...base, cacheOpen: true, armed: false })).toBe('cache');
    expect(resolverSkipReason({ ...base, armed: false, cooldown: true })).toBe('server-mode');
    expect(resolverSkipReason({ ...base, cooldown: true, tried: true })).toBe('cooldown');
    expect(resolverSkipReason({ ...base, tried: true })).toBe('tried');
  });
});
