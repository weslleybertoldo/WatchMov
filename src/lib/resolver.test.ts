// src/lib/resolver.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildClickScript, buildInjectScript, buildAbyssScript, buildOptionCycleScript, buildBloggerScript, RESOLVER_OPT_MS, CLICK_STEPS, CLICK_STEPS_ABYS, CLICK_STEPS_BYSE, budgetFor, HOP_HOSTS, isHopHost, resolverEnabled, setResolverEnabled, resolverOnCooldown, resolverCooldownUntil, noteResolverResult, clearResolverCooldown, resolverSkipReason, COOLDOWN_MS, COOLDOWN_FAILS } from './resolver';

describe('resolver oculto (regras puras)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('ABYS: pump só no frame abysscdn, fala com o proxy local, lê sources e faz fallback pra Byse', () => {
    const s = buildAbyssScript('abc123');
    expect(() => new Function(s)).not.toThrow();
    for (const k of ['abysscdn', 'abyss/progress', 'abyss/ready', 'abyss/next', 'abyss/push', 'getPlaylistItem', 'content-range', '"abc123"', '127.0.0.1:8099', 'WMABYS']) expect(s).toContain(k);
    const inj = buildInjectScript(CLICK_STEPS_ABYS, s);
    expect(() => new Function(inj)).not.toThrow();
    expect(inj).toContain('text:Opção 1'); expect(inj).not.toContain('text:Opção 2'); expect(inj.endsWith(s)).toBe(true);
    expect(buildInjectScript(CLICK_STEPS_BYSE)).toContain('text:Opção 2');
    expect(buildInjectScript(CLICK_STEPS_BYSE)).not.toContain('WMABYS');
    expect(budgetFor('embedplayapi')).toBe(90000); expect(budgetFor('embedmovies')).toBe(45000);
  });

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

  it('v4.57: buildOptionCycleScript cicla #optionList por indice K, loga WMOPT e cai no generico sem opcoes', () => {
    const s = buildOptionCycleScript();
    expect(s).toContain('__OPT_K__');
    expect(() => new Function(s)).not.toThrow();
    expect(() => new Function(s.replace(/__OPT_K__/g, '2'))).not.toThrow();
    expect(s).toContain('#optionList .option');
    expect(s).toContain('WMOPT|n=');
    expect(s).toContain('WMOPT|click');
    expect(s).toContain('__wmInj');
    expect(s).toContain('v.muted=true');
    for (const st of CLICK_STEPS) expect(s).toContain(st);
  });

  it('v4.57: RESOLVER_OPT_MS = 30 s por opcao', () => {
    expect(RESOLVER_OPT_MS).toBe(30000);
  });

  it('v4.58: buildBloggerScript le a config do player (itag 18) e loga WMBLOG, sem regex', () => {
    const s = buildBloggerScript();
    expect(() => new Function(s)).not.toThrow();
    expect(s).toContain('WMBLOG|');
    expect(s).toContain('VIDEO_CONFIG');
    expect(s).toContain('ytInitialPlayerResponse');
    expect(s).toContain('__wmBlog');
    expect(s).toContain('googlevideo');
  });
});
