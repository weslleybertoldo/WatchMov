import { describe, it, expect } from 'vitest';
import { mergeCaptured, synthesizeCompletos, withCompletos, synthParts, pickAutoOpen, isTrackOnly } from './capturedList';
import { streamKey, addStreams, getEntry, isEphemeralUrl } from './streamCache';
import type { SniffResult } from './streamSniffer';

describe('link EFÊMERO (/abyss/ da página oculta, 15/09/2026)', () => {
  const abys = 'http://127.0.0.1:8099/abyss/k3j9x2m1abcd/720p.mp4';
  it('mergeCaptured preserva a flag ephemeral na recaptura', () => {
    const out = mergeCaptured([{ url: abys, ephemeral: true, mime: 'video/mp4' }], { url: abys, quality: '720p' });
    expect(out).toHaveLength(1);
    expect(out[0].ephemeral).toBe(true);
    expect(out[0].quality).toBe('720p');
  });
  it('isEphemeralUrl reconhece o /abyss/ do proxy local e o pedaço /sora/ do Abyss', () => {
    expect(isEphemeralUrl(abys)).toBe(true);
    expect(isEphemeralUrl('http://127.0.0.1:8099/s?u=x')).toBe(false);
    expect(isEphemeralUrl('https://edge1-madrid-sprintcdn.r66nv9ed.com/hls2/master.m3u8')).toBe(false);
    expect(isEphemeralUrl(undefined)).toBe(false);
    // 25/09/2026: pedaço cifrado do Abyss também não persiste nem reabre
    expect(isEphemeralUrl('https://wbtqi2taq32.sssrr.org/sora/1165877930/aXlyYjV4d1FwWGNaQ3lr')).toBe(true);
    expect(isEphemeralUrl('https://cdn.x/filmes/sora/trailer.mp4')).toBe(false);
  });
  it('addStreams NUNCA persiste link efêmero (pela flag ou pela URL)', () => {
    localStorage.clear();
    addStreams([{ url: abys, ephemeral: true }], 999001, 'tv', 1, 1);
    addStreams([{ url: abys, quality: '720p' }], 999001, 'tv', 1, 1);   // onPlayerQuality manda só {url, quality}
    expect(getEntry(999001, 'tv', 1, 1)).toBeNull();
    addStreams([{ url: 'https://cdn.exemplo/master.m3u8', mime: 'application/vnd.apple.mpegurl' }], 999001, 'tv', 1, 1);
    expect(getEntry(999001, 'tv', 1, 1)?.streams.map(s => s.url)).toEqual(['https://cdn.exemplo/master.m3u8']);
  });
});

const master = (token: string, extra: Partial<SniffResult> = {}): SniffResult => ({
  url: `https://edge1-madrid-sprintcdn.r66nv9ed.com/hls2/02/11600/nd0f1xnmh0px_x/master.m3u8?t=${token}&s=1789411`,
  mime: 'application/vnd.apple.mpegurl',
  referer: 'https://f7hyg4q.org/',
  ...extra,
});

describe('mergeCaptured (dedup da lista "Links do vídeo")', () => {
  it('captura nova entra no fim da lista', () => {
    const a = master('aaa');
    const b: SniffResult = { url: 'https://rr1---sn-x.googlevideo.com/videoplayback?expire=1&id=abc', mime: 'video/mp4' };
    const out = mergeCaptured([a], b);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe(b);
  });

  it('recaptura da mesma chave atualiza a URL e MANTÉM headers/quality/provider que a nova não trouxe', () => {
    const first = master('aaa', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13; wv) Chrome/140.0.0.0 Mobile Safari/537.36', Origin: 'https://f7hyg4q.org' },
      quality: '1080p',
      provider: 'embedplayapi',
    });
    const again = master('bbb');                      // sniffer recapturou sem headers/quality
    const out = mergeCaptured([first], again);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain('t=bbb');
    expect(out[0].headers).toEqual(first.headers);
    expect(out[0].quality).toBe('1080p');
    expect(out[0].provider).toBe('embedplayapi');
    expect(out[0].referer).toBe('https://f7hyg4q.org/');
  });

  it('recaptura COM dados novos prevalece sobre os antigos', () => {
    const first = master('aaa', { quality: '720p', headers: { 'User-Agent': 'velho' } });
    const again = master('ccc', { quality: '1080p', headers: { 'User-Agent': 'novo' }, provider: 'superflix' });
    const out = mergeCaptured([first], again);
    expect(out[0].quality).toBe('1080p');
    expect(out[0].headers).toEqual({ 'User-Agent': 'novo' });
    expect(out[0].provider).toBe('superflix');
  });

  it('não mexe na lista original (imutável)', () => {
    const first = master('aaa', { quality: '480p' });
    const list = [first];
    const out = mergeCaptured(list, master('ddd'));
    expect(list[0]).toBe(first);
    expect(out).not.toBe(list);
  });
});

// Player do SuperFlix/Fembed (tráfego real gravado em 14/09/2026): duas playlists /m3/ do
// mesmo host e <ts>, só-vídeo e só-áudio; o master real (…/master.txt) é de um uso.
const H = 'https://xn--tckasiu6cvova0eb5fua2449g98vg.best';
const m3 = (sig: string, ts: string, tail: string, extra: Partial<SniffResult> = {}): SniffResult => ({
  url: `${H}/m3/${sig}/${ts}/${tail}`, mime: 'application/vnd.apple.mpegurl',
  referer: `${H}/video/088c2f0029c48fee1e3ae86422f`, provider: 'superflix', ...extra,
});
const md = (sig: string, ts: string, tail: string): SniffResult => ({
  url: `${H}/md/${sig}/${ts}/${tail}`, mime: 'application/vnd.apple.mpegurl', referer: `${H}/video/088c`, provider: 'fembed',
});

describe('synthesizeCompletos (COMPLETO sintetizado vídeo+áudio)', () => {
  it('par /m3/ + /m3/ do mesmo host vira 1 entrada synth:// com as duas playlists', () => {
    const v = m3('aixTTSqDphypw9bKh55SKg', '1789436175', 'bmxaTAAA', { headers: { Origin: H } });
    const a = m3('HffC_04lFmAU479hdZhRAg', '1789436175', 'bmxaTBBB');
    const out = synthesizeCompletos([v, a]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toMatch(/^synth:\/\/xn--tckasiu6cvova0eb5fua2449g98vg\.best\/[0-9a-f]+\?v=/);
    expect(out[0].synthetic).toBe(true);
    expect(out[0].mime).toContain('mpegurl');
    expect(out[0].provider).toBe('superflix');
    expect(out[0].referer).toBe(v.referer);
    expect(out[0].headers).toEqual({ Origin: H });
    expect(synthParts(out[0].url)).toEqual({ v: v.url, a: a.url });   // 1ª capturada = vídeo (o proxy confere)
    expect(isTrackOnly(out[0].url)).toBe(false);                       // vira COMPLETO, não faixa
  });

  it('/m3/ (vídeo) + /md/ (áudio): o /md/ vai sempre no "a", independente da ordem', () => {
    const a = md('s1', 't1', 'AUD'), v = m3('s2', 't1', 'VID');
    const out = synthesizeCompletos([a, v]);
    expect(out).toHaveLength(1);
    expect(synthParts(out[0].url)).toEqual({ v: v.url, a: a.url });
  });

  it('faixa sozinha, hosts diferentes ou 3 /m3/ com <ts> diferentes → nada', () => {
    expect(synthesizeCompletos([m3('s1', 't1', 'A')])).toEqual([]);
    const outro: SniffResult = { url: 'https://outro.host/m3/s9/t1/B', mime: 'application/vnd.apple.mpegurl' };
    expect(synthesizeCompletos([m3('s1', 't1', 'A'), outro])).toEqual([]);
    expect(synthesizeCompletos([m3('s1', 't1', 'A'), m3('s2', 't2', 'B'), m3('s3', 't3', 'C')])).toEqual([]);
    expect(synthesizeCompletos([master('x'), master('y')])).toEqual([]);
  });

  it('3+ /m3/ sem /md/: pareia pelo <ts> (mesmo carregamento do master)', () => {
    const out = synthesizeCompletos([m3('s1', 't1', 'A'), m3('s2', 't1', 'B'), m3('s3', 't2', 'C')]);
    expect(out).toHaveLength(1);
    expect(synthParts(out[0].url)).toEqual({ v: `${H}/m3/s1/t1/A`, a: `${H}/m3/s2/t1/B` });
  });

  it('rotação do <sig> mantém a CHAVE e usa as URLs mais recentes', () => {
    const v1 = m3('s1', 't1', 'AAA'), a1 = m3('s2', 't1', 'BBB');
    const v2 = m3('s3', 't2', 'AAA'), a2 = m3('s4', 't2', 'BBB');
    const out = synthesizeCompletos([v1, a1, v2, a2]);
    expect(out).toHaveLength(1);
    expect(synthParts(out[0].url)).toEqual({ v: v2.url, a: a2.url });
    expect(streamKey(out[0].url)).toBe(streamKey(synthesizeCompletos([v1, a1])[0].url));
    // a chave não depende da ordem em que as faixas chegaram
    expect(streamKey(out[0].url)).toBe(streamKey(synthesizeCompletos([a1, v1])[0].url));
  });

  it('withCompletos mescla na lista; recaptura do par ATUALIZA a entrada em vez de duplicar', () => {
    const v1 = m3('s1', 't1', 'AAA'), a1 = m3('s2', 't1', 'BBB');
    const l1 = withCompletos([v1, a1]);
    expect(l1).toHaveLength(3);
    expect(l1[2].synthetic).toBe(true);
    const v2 = m3('s3', 't2', 'AAA'), a2 = m3('s4', 't2', 'BBB');
    const l2 = withCompletos(mergeCaptured(mergeCaptured(l1, v2), a2));
    const synths = l2.filter(s => s.synthetic);
    expect(synths).toHaveLength(1);
    expect(synthParts(synths[0].url)).toEqual({ v: v2.url, a: a2.url });
    expect(l2.indexOf(synths[0])).toBe(2);   // ficou na mesma posição (mesmo "Link N")
  });
});

describe('pickAutoOpen (auto-abrir no reprodutor)', () => {
  it('escolhe o 1º COMPLETO/MASTER capturado ao vivo; faixa e link do cache não contam', () => {
    // veio do cache (outra chave; não está em fresh) — pode estar expirado, não dispara
    const cached: SniffResult = { url: 'https://rr1---sn-x.googlevideo.com/videoplayback?expire=1&id=abc', mime: 'video/mp4' };
    const track = m3('s1', 't1', 'A');
    const fresh = master('novo');
    const list = [cached, track, fresh];
    expect(pickAutoOpen(list, new Set([streamKey(track.url), streamKey(fresh.url)]))).toBe(fresh);
    expect(pickAutoOpen(list, new Set([streamKey(track.url)]))).toBeNull();
    expect(pickAutoOpen(list, new Set())).toBeNull();
    // recaptura do MESMO master (mesma chave, token novo) atualiza a entrada → ela vira fresca
    const merged = mergeCaptured([master('velho')], master('novo'));
    expect(pickAutoOpen(merged, new Set([streamKey(fresh.url)]))?.url).toContain('t=novo');
  });

  it('sintético só quando as DUAS playlists são frescas', () => {
    const v = m3('s1', 't1', 'AAA'), a = m3('s2', 't1', 'BBB');
    const list = withCompletos([v, a]);
    expect(pickAutoOpen(list, new Set([streamKey(v.url)]))).toBeNull();
    expect(pickAutoOpen(list, new Set([streamKey(v.url), streamKey(a.url)]))?.synthetic).toBe(true);
  });
});
