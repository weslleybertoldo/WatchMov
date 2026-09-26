// src/lib/resolver.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildClickScript, buildInjectScript, buildAbyssScript, buildOptionCycleScript, buildBloggerScript, RESOLVER_OPT_MS, CLICK_STEPS, CLICK_STEPS_ABYS, CLICK_STEPS_BYSE, CLICK_STEPS_F1, budgetFor, HOP_HOSTS, isHopHost, resolverEnabled, setResolverEnabled, resolverOnCooldown, resolverCooldownUntil, noteResolverResult, clearResolverCooldown, resolverSkipReason, COOLDOWN_MS, COOLDOWN_FAILS, ABYSS_PUMPS, usesAbys, ABYSS_LATE_MS, ABYSS_PIECE_TIMEOUT_MS, STEPS_REPEAT, DEAD_TEXTS } from './resolver';

describe('resolver oculto (regras puras)', () => {
  // __wmNoPlay: o motor ABYS marca o frame no ready — não pode vazar de um teste pro outro.
  beforeEach(() => { localStorage.clear(); delete (window as unknown as Record<string, unknown>).__wmNoPlay; });

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

  it('Fonte 5 (FS/HD): escolhe "Dublado", clica o 1º servidor e roda no motor Abyss (abyssplayer.com)', () => {
    expect(usesAbys('fshd')).toBe(true); expect(usesAbys('embedplayapi')).toBe(true); expect(usesAbys('embedmovies')).toBe(false);
    expect(budgetFor('fshd')).toBe(budgetFor('embedplayapi'));
    expect(buildAbyssScript('x')).toContain('abyssplayer');
    document.body.innerHTML = `<div class="player-options-audios">
      <div class="audio-selector active"><span class="audio-text">Legendado</span></div>
      <div class="audio-selector"><span class="audio-text">Dublado</span></div>
    </div>
    <div class="player-options-servers active">
      <div class="server-selector" data-server="126078">Abyss
        Boa velocidade e poucos anúncios.</div>
      <div class="server-selector" data-server="126090">Streamwish</div>
    </div>
    <div class="player-options-servers hidden"><div class="server-selector" data-server="1">Oculto</div></div>`;
    const aud = document.querySelectorAll('.audio-selector');
    aud[1].addEventListener('click', () => { aud[0].className = 'audio-selector'; aud[1].className = 'audio-selector active'; });
    const clicked: string[] = [];
    document.querySelectorAll('.server-selector').forEach(o => o.addEventListener('click', () => clicked.push(o.getAttribute('data-server') || '')));
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj;
    w.__wmInj = undefined;
    vi.useFakeTimers();
    try {
      new Function(buildOptionCycleScript().replace(/__OPT_K__/g, '1'))();
      expect(aud[1].className).toContain('active');   // 1º tick: escolheu Dublado
      expect(clicked).toEqual([]);
      vi.advanceTimersByTime(700);                     // 2º tick: lista os servidores do Dublado e clica o 1º
    } finally {
      vi.useRealTimers();
      console.log = origLog;
      w.__wmInj = prevInj;
      document.body.innerHTML = '';
    }
    expect(clicked).toEqual(['126078']);
    expect(logs).toContain('WMOPT|n=2|names=Abyss»Streamwish');
    expect(logs).toContain('WMOPT|click|k=1|name=Abyss');
  });

  it('ABYS: o pump roda vários laços em paralelo (1080p engasgava com 1 só)', () => {
    const s = buildAbyssScript('abc123');
    expect(ABYSS_PUMPS).toBeGreaterThanOrEqual(2);
    expect(s).toContain('PUMPS=' + ABYSS_PUMPS);
    expect(s).toContain('for(var w=0;w<PUMPS;w++)pump()');
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

  it('servidor escolhido (▣ Servidor do reprodutor) = "server-mode" mesmo vindo do cache: o chip mostra o Ligar', () => {
    const base = { enabled: true, cacheOpen: false, armed: true, cooldown: false, tried: false };
    expect(resolverSkipReason({ ...base, serverChosen: true })).toBe('server-mode');
    expect(resolverSkipReason({ ...base, serverChosen: true, cacheOpen: true, cooldown: true, tried: true })).toBe('server-mode');
    expect(resolverSkipReason({ ...base, serverChosen: true, enabled: false })).toBe('off');
    expect(resolverSkipReason({ ...base, serverChosen: false })).toBeNull();
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

  // ── v4.62 (Fonte 6: Blogger e Premium precisam entregar o link sozinhos) ──────────────
  it('v4.62: o ciclo enumera TODAS as opcoes (o playerflix esconde as de outro idioma) e pula superflixapi/Turnstile', () => {
    const s = buildOptionCycleScript();
    expect(() => new Function(s.replace(/__OPT_K__/g, '1'))).not.toThrow();
    expect(s).toContain('WMOPT|skip');
    expect(s).toContain('superflixapi.');
    expect(s).toContain('data-embed');
    expect(s).toContain('data-audio');
    // nao ha mais filtro de visibilidade na lista de opcoes (era ele que escondia 2 das 3)
    expect(s).toContain('os.push(ol[oi])');
    expect(s).not.toContain('if(vis(ol[oi]))');
  });

  it('v4.63: o ciclo ignora as opcoes NAO dubladas (data-audio en-us): so a dublada entra na lista e recebe o clique', () => {
    document.body.innerHTML = `<div id="optionList">
      <div class="option" data-audio="en-us" data-embed="https://www.blogger.com/video.g?token=EN" onclick="">
        <div>Blogger</div>
        <div><span>Sem anúncios</span></div>
      </div>
      <div class="option" data-audio="pt-br" data-embed="https://www.blogger.com/video.g?token=PT" style="display: none;">
        <div>Blogger</div>
        <div><span>Sem anúncios</span></div>
      </div>
      <div class="option" data-audio="en-us" data-embed="https://superflixapi.baby/serie/1/1/1">
        <div>Premium</div>
        <div><span>Com anúncios</span></div>
      </div>
    </div>`;
    const clicked: string[] = [];
    document.querySelectorAll('#optionList .option').forEach(o => o.addEventListener('click', () => clicked.push(o.getAttribute('data-audio') || '')));
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj;
    w.__wmInj = undefined;
    vi.useFakeTimers();
    try {
      new Function(buildOptionCycleScript().replace(/__OPT_K__/g, '1'))();
    } finally {
      vi.useRealTimers();
      console.log = origLog;
      w.__wmInj = prevInj;
      document.body.innerHTML = '';
    }
    // a lista reportada (e mostrada na tela) tem SO a dublada; as 2 en-us viram RESOLVER_OPTION_FILTER
    expect(logs).toContain('WMOPT|n=1|names=Blogger');
    expect(logs).toContain('WMOPT|filtered|nao-dublado=2|restou=1');
    expect(logs).toContain('WMOPT|click|k=1|name=Blogger');
    // o clique foi na opcao pt-br (mesmo escondida), nunca na legendada
    expect(clicked).toEqual(['pt-br']);
  });

  it('v4.63: titulo SO legendado = nenhuma opcao no ciclo (cai no clicador generico → "troque de fonte"), com o motivo logado', () => {
    document.body.innerHTML = `<div id="optionList">
      <div class="option" data-audio="en-us" data-embed="https://www.blogger.com/video.g?token=EN"><div>Blogger</div></div>
    </div>`;
    const clicked: string[] = [];
    document.querySelectorAll('#optionList .option').forEach(o => o.addEventListener('click', () => clicked.push('x')));
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj;
    w.__wmInj = undefined;
    vi.useFakeTimers();
    try {
      new Function(buildOptionCycleScript().replace(/__OPT_K__/g, '1'))();
    } finally {
      vi.useRealTimers();
      console.log = origLog;
      w.__wmInj = prevInj;
      document.body.innerHTML = '';
    }
    expect(logs).toContain('WMOPT|filtered|nao-dublado=1|restou=0');
    expect(logs.some(l => l.startsWith('WMOPT|n='))).toBe(false);
    expect(clicked).toEqual([]);
  });

  it('v4.64: Fonte 1 — le a lista REAL da embedplay.one (grupo Dublado), nomes curtos ABYS»BYSE»UPNS, legendado fora, clique no item K', () => {
    // DOM real da embedplay.one capturado por CDP no WebView (16/09/2026, Black Torch T1E1)
    document.body.innerHTML = `<div class="player_screen">
      <div class="select_language active" data-target="1">Dublado</div><div class="select_language" data-target="2">Legendado</div>
      <div class="players_select">
        <div class="players_select_items visible" data-target="1">
          <div class="player_select_item" data-id="274867"><div class="player_select_name">Opção 1 (ABYS)</div></div>
          <div class="player_select_item" data-id="274868"><div class="player_select_name">Opção 2 (BYSE)</div></div>
          <div class="player_select_item" data-id="274869"><div class="player_select_name">Opção 3 (UPNS)</div></div>
        </div>
        <div class="players_select_items" data-target="2">
          <div class="player_select_item" data-vidsrc="1" data-url="https://vidsrcme.su/embed/tv?tmdb=285993"><div class="player_select_name">Legendado (EUA)</div></div>
        </div>
      </div>
      <div class="changeOptions hidden">Mostrar Opções</div>
    </div>`;
    const clicked: string[] = [];
    document.querySelectorAll('.player_select_item').forEach(o => o.addEventListener('click', () => clicked.push(o.getAttribute('data-id') || o.getAttribute('data-url') || '')));
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj;
    w.__wmInj = undefined;
    vi.useFakeTimers();
    try {
      new Function(buildOptionCycleScript(CLICK_STEPS_F1).replace(/__OPT_K__/g, '2'))();
    } finally {
      vi.useRealTimers();
      console.log = origLog;
      w.__wmInj = prevInj;
      document.body.innerHTML = '';
    }
    expect(logs).toContain('WMOPT|n=3|names=ABYS»BYSE»UPNS');
    expect(logs).toContain('WMOPT|filtered|nao-dublado=1|restou=3');
    expect(logs).toContain('WMOPT|click|k=2|name=BYSE');
    expect(clicked).toEqual(['274868']);   // K=2 = BYSE; o vidsrc legendado nunca e clicado
  });

  it('v4.64: Fonte 1 com UMA opcao dublada (Dois Homens e Meio T3E20) mostra n=1 — nao inventa Byse', () => {
    document.body.innerHTML = `<div class="select_language active" data-target="1">Dublado</div><div class="select_language" data-target="2">Legendado</div>
      <div class="players_select_items visible" data-target="1"><div class="player_select_item" data-id="145658"><div class="player_select_name">Opção 1 (ABYS)</div></div></div>
      <div class="players_select_items" data-target="2"><div class="player_select_item" data-vidsrc="1" data-url="https://vidsrcme.su/x"><div class="player_select_name">Legendado (EUA)</div></div></div>`;
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj;
    w.__wmInj = undefined;
    vi.useFakeTimers();
    try {
      new Function(buildOptionCycleScript(CLICK_STEPS_F1).replace(/__OPT_K__/g, '1'))();
    } finally {
      vi.useRealTimers();
      console.log = origLog;
      w.__wmInj = prevInj;
      document.body.innerHTML = '';
    }
    expect(logs).toContain('WMOPT|n=1|names=ABYS');
    expect(logs).toContain('WMOPT|click|k=1|name=ABYS');
  });

  it('v4.64: CLICK_STEPS_F1 revela a lista mas NAO tem "text:Opção N" (a opcao vem da lista real)', () => {
    expect(CLICK_STEPS_F1[0]).toBe('text:Mostrar Opções');
    expect(CLICK_STEPS_F1.some(s => /Opção \d/.test(s))).toBe(false);
    expect(CLICK_STEPS_F1).toContain('.captcha-gate__play');   // Byse (f7hyg4q.org) continua pelo clicador generico
  });

  it('v4.62: buildBloggerScript faz hook de XHR/fetch e clica o player do Blogger', () => {
    const s = buildBloggerScript();
    expect(() => new Function(s)).not.toThrow();
    expect(s).toContain('XMLHttpRequest.prototype.send');
    expect(s).toContain('window.fetch=');
    expect(s).toContain('jsname=kpuEBe');
    expect(s).toContain('WMBLOG|');
  });

  it('v4.62: rodando o script, a resposta do batchexecute vira WMBLOG com itag 22 (720p) antes do 18 (360p)', () => {
    // Amostra REAL capturada por CDP no emulador (15/09/2026, Black Torch T1E1 pelo Blogger),
    // com os escapes & / = exatamente como chegam no responseText.
    const gv = (itag: string) =>
      'https://rr1---sn-oxunxg8pjvn-hj1z.googlevideo.com/videoplayback?expire\\u003d1789551462\\u0026ei\\u003dABC' +
      '\\u0026ip\\u003d187.65.18.77\\u0026id\\u003de57ac346a517d399\\u0026itag\\u003d' + itag +
      '\\u0026source\\u003dblogger\\u0026requiressl\\u003dyes\\u0026mime\\u003dvideo/mp4\\u0026sig\\u003dAE0s2JY';
    const body = ')]}\'\n\n10151\n[["wrb.fr","WcwnYd","[1,null,[[\\"' + gv('18') + '\\",[18]],[\\"' + gv('22') + '\\",[22]]]]"]]';

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
    type FakeXhr = { addEventListener: (e: string, cb: () => void) => void; responseText: string; readyState: number };
    const listeners: Array<() => void> = [];
    const fake = function (this: FakeXhr) { /* ctor */ } as unknown as { prototype: Record<string, unknown> };
    fake.prototype = {
      open() { /* noop */ },
      send() { /* noop */ },
      addEventListener(_e: string, cb: () => void) { listeners.push(cb); },
      responseText: body,
      readyState: 4,
    };
    const w = window as unknown as Record<string, unknown>;
    const prevXhr = w.XMLHttpRequest;
    const prevBlog = w.__wmBlog;
    w.XMLHttpRequest = fake;
    w.__wmBlog = undefined;
    try {
      new Function(buildBloggerScript())();
      const xhr = new (w.XMLHttpRequest as new () => FakeXhr)();
      xhr.open('POST', 'https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd');
      xhr.send();
      listeners.forEach(cb => cb());
    } finally {
      console.log = origLog;
      w.XMLHttpRequest = prevXhr;
      w.__wmBlog = prevBlog;
    }
    const blog = logs.filter(l => l.startsWith('WMBLOG|'));
    expect(blog.length).toBe(2);   // load + readystatechange disparam o mesmo leitor; o script deduplica por URL
    // maior qualidade primeiro: o auto-abrir do app pega o 1o link emitido
    expect(blog[0]).toContain('WMBLOG|q=720p|url=https://rr1---sn-oxunxg8pjvn-hj1z.googlevideo.com/videoplayback?');
    expect(blog[0]).toContain('itag=22');
    expect(blog[1]).toContain('WMBLOG|q=360p|url=');
    expect(blog[1]).toContain('itag=18');
    // os escapes do JSON tem de sumir (senao a URL nao toca)
    expect(blog[0]).not.toContain('\\u0026');
    expect(blog[0]).toContain('&source=blogger');
  });
  // ── 25/09/2026: Fonte 1 — BYSE (mais tempo), UPNS (play + vídeo apagado), ABYS (qualidade atrasada) ──
  // Roda o script do ciclo num DOM de frame de player; jsdom não mede layout → getBoundingClientRect falso (visível).
  const runCycle = (html: string, k: number, steps: () => void, before?: () => void) => {
    document.body.innerHTML = html;
    before?.();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj;
    w.__wmInj = undefined;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 50, top: 0, left: 0, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.useFakeTimers();
    try {
      new Function(buildOptionCycleScript(CLICK_STEPS_F1).replace(/__OPT_K__/g, String(k)))();
      steps();
    } finally {
      vi.useRealTimers();
      rect.mockRestore();
      console.log = origLog;
      w.__wmInj = prevInj;
      document.body.innerHTML = '';
    }
    return logs;
  };

  it('25/09: BYSE — o frame do player avisa progresso (com o K) e o gate é tocado 1×', () => {
    let gate = 0;
    const logs = runCycle(`<div class="video-page__player"><div class="captcha-gate"><button class="captcha-gate__play">play</button></div></div>`, 2, () => {
      vi.advanceTimersByTime(650 * 6);
    }, () => document.querySelector('.captcha-gate__play')!.addEventListener('click', () => gate++));
    expect(logs).toContain('WMOPT|progress|k=2|stage=player|host=localhost');
    expect(logs).toContain('WMOPT|progress|k=2|stage=play|host=localhost');
    expect(gate).toBe(1);   // o gate não tem repetição: 1 toque
    expect(logs.filter(l => l.startsWith('WMOPT|progress')).length).toBe(2);   // 1× por etapa
  });

  it('25/09: UPNS — toca o #player-button até 3×, com 3 s entre toques, só enquanto visível', () => {
    expect(STEPS_REPEAT['#player-button']).toBe(3);
    let toques = 0;
    runCycle(`<div id="player-button-container"><div id="player-button"></div></div>`, 2, () => {
      expect(toques).toBe(1);             // 1º toque já na 1ª volta (document pronto)
      vi.advanceTimersByTime(2000);       // < 3 s: não repete
      expect(toques).toBe(1);
      vi.advanceTimersByTime(20000);      // passa do intervalo várias vezes: para no 3º
    }, () => document.getElementById('player-button')!.addEventListener('click', () => toques++));
    expect(toques).toBe(3);
  });

  it('25/09: UPNS — "Video not found or deleted" depois do player = opção morta (1 recado, com o K)', () => {
    expect(DEAD_TEXTS).toContain('Video not found or deleted');
    const logs = runCycle(`<div id="player-button-container"><div id="player-button"></div></div>`, 3, () => {
      vi.advanceTimersByTime(650);
      document.body.innerHTML = '<div>Video not found or deleted</div>';   // a UPNS troca o player pelo aviso (404)
      vi.advanceTimersByTime(650 * 4);
    });
    expect(logs).toContain('WMOPT|progress|k=3|stage=player|host=localhost');
    expect(logs.filter(l => l === 'WMOPT|dead|k=3|reason=not-found').length).toBe(1);
  });

  it('25/09: página sem player (lista da embedplay.one) não avisa progresso nem opção morta', () => {
    const logs = runCycle(`<div>Video not found or deleted</div>`, 1, () => { vi.advanceTimersByTime(650 * 4); });
    expect(logs.some(l => l.startsWith('WMOPT|progress') || l.startsWith('WMOPT|dead'))).toBe(false);
  });

  // Motor ABYS com jwplayer/fetch/location falsos: mede as 3 qualidades com atrasos diferentes.
  const runAbyss = async (delays: Record<number, number>) => {
    const calls: string[] = [];
    const w = window as unknown as Record<string, unknown>;
    const prev = w.__wmAbys; w.__wmAbys = undefined;
    const origLog = console.log; console.log = () => {};
    const jw = () => ({ pause: () => {}, getPlaylistItem: () => ({ sources: [360, 720, 1080].map(q => ({ file: `https://cdn.teste/${q}p/v.mp4`, label: `${q}p` })) }) });
    const resp = (total: number) => ({ status: 206, type: 'basic', body: null, headers: { get: (h: string) => (h === 'content-range' ? `bytes 0-1023/${total}` : null) }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)) });
    const fakeFetch = (u: string) => {
      if (u.startsWith('http://127.0.0.1:8099/abyss/next')) return new Promise(() => {});   // pump parado: não interessa aqui
      if (u.startsWith('http://127.0.0.1:8099/')) { calls.push(decodeURIComponent(u)); return Promise.resolve({ status: 200, ok: true }); }
      const q = Number(/\/(\d+)p\//.exec(u)![1]);
      return new Promise(res => setTimeout(() => res(resp(q * 1000)), delays[q]));
    };
    vi.useFakeTimers();
    try {
      new Function('location', 'jwplayer', 'fetch', buildAbyssScript('sid1'))({ hostname: 'abysscdn.com' }, jw, fakeFetch);
      await vi.advanceTimersByTimeAsync(60000);
    } finally {
      vi.useRealTimers(); console.log = origLog; w.__wmAbys = prev;
    }
    return { ready: calls.filter(c => c.includes('/abyss/ready')), add: calls.filter(c => c.includes('/abyss/add')) };
  };

  it('25/09: ABYS — a qualidade atrasada não segura o filme: abre com as prontas e a atrasada vai por /abyss/add', async () => {
    expect(ABYSS_LATE_MS).toBe(10000);
    const { ready, add } = await runAbyss({ 360: 1000, 720: 5000, 1080: 30000 });
    expect(ready.length).toBe(1);
    expect(ready[0]).toContain('"q":360'); expect(ready[0]).toContain('"q":720'); expect(ready[0]).not.toContain('"q":1080');
    expect(add.length).toBe(1);
    expect(add[0]).toContain('"q":1080');
  });

  it('25/09: ABYS — as 3 prontas dentro da folga saem juntas no ready (sem add)', async () => {
    const { ready, add } = await runAbyss({ 360: 500, 720: 1500, 1080: 3000 });
    expect(ready.length).toBe(1);
    for (const q of [360, 720, 1080]) expect(ready[0]).toContain(`"q":${q}`);
    expect(add.length).toBe(0);
  });
  // Motor ABYS: 1 qualidade, o proxy pede o pedaço 0 no 1º /abyss/next; `piece` decide o que o SW faz com ele.
  const runPump = async (piece: (signal?: AbortSignal) => Promise<unknown>, ms: number) => {
    const nexts: string[] = [];
    const w = window as unknown as Record<string, unknown>;
    const prev = w.__wmAbys; w.__wmAbys = undefined;
    const origLog = console.log; console.log = () => {};
    const jw = () => ({ pause: () => {}, getPlaylistItem: () => ({ sources: [{ file: 'https://cdn.teste/1080p/v.mp4', label: '1080p' }] }) });
    const meta = { status: 206, type: 'basic', body: null, headers: { get: (h: string) => (h === 'content-range' ? 'bytes 0-1023/9999999' : null) }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)) };
    let deu = false;
    const fakeFetch = (u: string, o?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
      if (u.startsWith('http://127.0.0.1:8099/abyss/next')) {
        nexts.push(u);
        if (deu) return new Promise(() => {});
        deu = true;
        return Promise.resolve({ json: () => Promise.resolve({ q: 1080, off: 0, len: 2097152 }) });
      }
      if (u.startsWith('http://127.0.0.1:8099/')) return Promise.resolve({ status: 200, ok: true });
      if (o?.headers?.Range === 'bytes=0-1023') return Promise.resolve(meta);
      return piece(o?.signal);
    };
    vi.useFakeTimers();
    try {
      new Function('location', 'jwplayer', 'fetch', buildAbyssScript('sid1'))({ hostname: 'abysscdn.com' }, jw, fakeFetch);
      await vi.advanceTimersByTimeAsync(ms);
    } finally {
      vi.useRealTimers(); console.log = origLog; w.__wmAbys = prev;
    }
    return nexts;
  };

  it('25/09: ABYS — pedaço com erro no SW volta pro proxy na hora (rel=q:off), não fica 45 s "em voo"', async () => {
    const nexts = await runPump(() => Promise.reject(new TypeError('Failed to fetch')), 3000);
    expect(nexts.some(u => u.includes('&rel=1080:0'))).toBe(true);
  });

  it('25/09: ABYS — pedaço pendurado é abortado no tempo e solto (o laço não fica preso pra sempre)', async () => {
    expect(ABYSS_PIECE_TIMEOUT_MS).toBeLessThan(30000);   // o leitor (TV/ExoPlayer) desiste aos 30 s no proxy
    const pendura = (signal?: AbortSignal) => new Promise((_, rej) => { signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
    const antes = await runPump(pendura, ABYSS_PIECE_TIMEOUT_MS - 2000);
    expect(antes.some(u => u.includes('&rel='))).toBe(false);
    const depois = await runPump(pendura, ABYSS_PIECE_TIMEOUT_MS + 3000);
    expect(depois.some(u => u.includes('&rel=1080:0'))).toBe(true);
  });

  it('25/09: UPNS — pergunta à API se o vídeo existe; 404 = opção morta sem precisar do play', async () => {
    const logs: string[] = [];
    const origLog = console.log; console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj, prevUp = w.__wmUpns; w.__wmInj = undefined;
    const pedidos: string[] = [];
    const fakeFetch = (u: string) => { pedidos.push(u); return Promise.resolve({ status: 404 }); };
    const loc = { hostname: 'embedplayapiupn.upns.xyz', hash: '#epzlri', href: 'https://embedplayapiupn.upns.xyz/#epzlri' };
    vi.useFakeTimers();
    try {
      new Function('location', 'fetch', buildOptionCycleScript(CLICK_STEPS_F1).replace(/__OPT_K__/g, '2'))(loc, fakeFetch);
      await vi.advanceTimersByTimeAsync(100);
    } finally {
      vi.useRealTimers(); console.log = origLog; w.__wmInj = prevInj; w.__wmUpns = prevUp; document.body.innerHTML = '';
    }
    expect(pedidos.length).toBe(1);
    expect(pedidos[0]).toContain('/api/v1/video?id=epzlri&w=');
    expect(logs).toContain('WMOPT|probe|k=2|status=404');
    expect(logs).toContain('WMOPT|dead|k=2|reason=upns-404');
  });

  it('25/09: fora da UPNS não pergunta nada à API', async () => {
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj, prevUp = w.__wmUpns; w.__wmInj = undefined;
    const pedidos: string[] = [];
    const origLog = console.log; console.log = () => {};
    vi.useFakeTimers();
    try {
      new Function('location', 'fetch', buildOptionCycleScript(CLICK_STEPS_F1).replace(/__OPT_K__/g, '1'))({ hostname: 'www.embedplay.one', hash: '', href: 'https://www.embedplay.one/filme/tt1' }, (u: string) => { pedidos.push(u); return Promise.resolve({ status: 200 }); });
      await vi.advanceTimersByTimeAsync(100);
    } finally {
      vi.useRealTimers(); console.log = origLog; w.__wmInj = prevInj; w.__wmUpns = prevUp; document.body.innerHTML = '';
    }
    expect(pedidos.length).toBe(0);
  });

  // <video> falso (no jsdom o play/pause não existem de verdade): conta os play()/pause(). `teimoso` = segue tocando.
  const fakeVideo = (tocando: boolean, teimoso = false) => {
    document.body.innerHTML = '<video></video>';
    const v = document.querySelector('video') as HTMLVideoElement;
    const st = { paused: !tocando, plays: 0, pauses: 0 };
    Object.defineProperty(v, 'paused', { configurable: true, get: () => (teimoso ? false : st.paused) });
    v.play = () => { st.plays++; st.paused = false; return Promise.resolve(); };
    v.pause = () => { st.pauses++; st.paused = true; };
    return st;
  };

  it('26/09: a busca dá play mudo nos vídeos; com o motor pronto (window.__wmNoPlay) nenhum tick dá mais play', () => {
    const w = window as unknown as Record<string, unknown>;
    const prevInj = w.__wmInj;
    const origLog = console.log; console.log = () => {};
    const tickInject = () => {
      w.__wmInj = undefined;
      vi.useFakeTimers();
      try { new Function(buildInjectScript(CLICK_STEPS_ABYS))(); vi.advanceTimersByTime(650 * 5); } finally { vi.useRealTimers(); }
    };
    try {
      const semMarca = fakeVideo(false);
      new Function(buildClickScript())();
      expect(semMarca.plays).toBe(1);
      const semMarcaInj = fakeVideo(false);
      tickInject();
      expect(semMarcaInj.plays).toBeGreaterThanOrEqual(1);

      w.__wmNoPlay = 1;
      const click = fakeVideo(false);
      new Function(buildClickScript())();
      expect(click.plays).toBe(0);
      const inj = fakeVideo(false);
      tickInject();
      expect(inj.plays).toBe(0);
      const ciclo = fakeVideo(false);
      w.__wmInj = undefined;
      vi.useFakeTimers();
      try { new Function(buildOptionCycleScript().replace(/__OPT_K__/g, '1'))(); vi.advanceTimersByTime(650 * 5); } finally { vi.useRealTimers(); }
      expect(ciclo.plays).toBe(0);
    } finally {
      delete w.__wmNoPlay; w.__wmInj = prevInj; console.log = origLog; document.body.innerHTML = '';
    }
  });

  it('26/09: ABYS — no ready o motor marca window.__wmNoPlay e pausa o vídeo escondido de novo a cada volta do pump', async () => {
    const w = window as unknown as Record<string, unknown>;
    const v = fakeVideo(true, true);   // player teimoso: segue "tocando" mesmo depois do pause
    try {
      await runPump(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(2097152)) }), 5000);
      expect(w.__wmNoPlay).toBe(1);
      expect(v.pauses).toBeGreaterThanOrEqual(3);   // no ready + a cada volta do pump (os laços e a volta depois do pedaço)
    } finally {
      delete w.__wmNoPlay; document.body.innerHTML = '';
    }
  });
});
