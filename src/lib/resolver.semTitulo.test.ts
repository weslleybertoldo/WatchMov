// src/lib/resolver.semTitulo.test.ts — "esta fonte não tem o título" em 1–2 s e o pulo pra próxima (20/10/2026).
// Os sinais vêm das páginas reais salvas no estudo de 19/10/2026 (Ultimato, Link Click T1E1, Breaking Bad T1E1 e T9E99).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildSemTituloScript, proximaFonte, AUTO_PULO } from './resolver';

type Win = Window & { __wmSem?: unknown; fetch: typeof fetch };

// Roda o script como o WebView roda em cada frame: `location` do frame, DOM do frame e os ticks de 650 ms.
async function rodar(host: string, montar: () => void, depois?: () => Promise<void> | void): Promise<string[]> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => { logs.push(String(a[0])); };
  vi.useFakeTimers();
  try {
    montar();
    new Function('location', buildSemTituloScript())({ hostname: host, href: `https://${host}/x` });
    await vi.advanceTimersByTimeAsync(700);
    if (depois) await depois();
    await vi.advanceTimersByTimeAsync(700);
  } finally {
    vi.useRealTimers();
    console.log = origLog;
  }
  return logs.filter(l => l.startsWith('WMOPT|none'));
}

describe('não tem o título (sinais por fonte)', () => {
  let fetchOrig: typeof fetch;
  beforeEach(() => { delete (window as Win).__wmSem; fetchOrig = (window as Win).fetch; document.title = ''; document.body.innerHTML = ''; });
  afterEach(() => { (window as Win).fetch = fetchOrig; document.title = ''; document.body.innerHTML = ''; });

  it('o script é JS válido e avisa uma vez só, com o motivo e o host', async () => {
    expect(() => new Function(buildSemTituloScript())).not.toThrow();
    const logs = await rodar('embedplayapi.top', () => {
      document.body.innerHTML = '<div class="movie-not-found"><h3>Filme ou episódio não encontrado</h3></div>';
    });
    expect(logs).toEqual(['WMOPT|none|reason=f2-nao-encontrado|host=embedplayapi.top']);
  });

  it('Fonte 2: página do título (existe) não avisa nada', async () => {
    const logs = await rodar('embedplayapi.top', () => {
      document.title = 'Assistir Vingadores: Ultimato - 2019 Online';
      document.body.innerHTML = '<div class="frame"><iframe id="ve-iframe"></iframe></div><div class="error">Ocorreu um erro.</div>';
    });
    expect(logs).toEqual([]);
  });

  it('Fonte 2: só o título "movie not found" já basta', async () => {
    const logs = await rodar('embedplayapi.top', () => { document.title = 'Assistir movie not found Online'; document.body.innerHTML = '<div></div>'; });
    expect(logs).toEqual(['WMOPT|none|reason=f2-nao-encontrado|host=embedplayapi.top']);
  });

  it('Fonte 3: "FSHD — 404" = não tem; filme que existe não avisa', async () => {
    expect(await rodar('fshd.link', () => { document.title = 'FSHD — 404'; document.body.innerHTML = '<div></div>'; }))
      .toEqual(['WMOPT|none|reason=f3-404|host=fshd.link']);
    delete (window as Win).__wmSem;
    expect(await rodar('fshd.link', () => { document.title = 'FSHD — Filme Vingadores: Ultimato'; document.body.innerHTML = '<div class="audio-selector">Dublado</div>'; }))
      .toEqual([]);
    delete (window as Win).__wmSem;
    // Filme com "404" no nome não é a página de erro.
    expect(await rodar('fshd.link', () => { document.title = 'FSHD — Filme Erro 404'; document.body.innerHTML = '<div></div>'; }))
      .toEqual([]);
  });

  it('Fonte 3: episódio inexistente cai na página da série sem episódio marcado = não tem; episódio que existe vem marcado', async () => {
    const serie = (ativo: boolean) => `<div class="seasonOption ${ativo ? 'active' : ''}" data-season="1">1</div>
      <div class="episodeSelector ${ativo ? 'visible' : ''}" data-season="1">
        <div class="episodeOption ${ativo ? 'active' : ''}" data-contentid="22628">Ep 1</div>
        <div class="episodeOption" data-contentid="22629">Ep 2</div>
      </div>`;
    expect(await rodar('fshd.link', () => { document.title = 'FSHD — Série Breaking Bad'; document.body.innerHTML = serie(false); }))
      .toEqual(['WMOPT|none|reason=f3-sem-episodio|host=fshd.link']);
    delete (window as Win).__wmSem;
    expect(await rodar('fshd.link', () => { document.title = 'FSHD — Série Breaking Bad'; document.body.innerHTML = serie(true); }))
      .toEqual([]);
  });

  it('Fonte 4: `const available=false` (botão "Em breve") = não tem; available=true não avisa', async () => {
    const pagina = (v: boolean) => `<button id="btn">Assistir</button><script>let checked=false; const available=${v}; const encodingStatus=null;
      if(!available){btnText.textContent="Em breve";btn.disabled=true;}</script>`;
    expect(await rodar('api.pomfy.stream', () => { document.body.innerHTML = pagina(false); }))
      .toEqual(['WMOPT|none|reason=f4-indisponivel|host=api.pomfy.stream']);
    delete (window as Win).__wmSem;
    expect(await rodar('api.pomfy.stream', () => { document.body.innerHTML = pagina(true); })).toEqual([]);
  });

  // A playerflix (dentro da Fonte 1) pede a lista ao /inc/Ajax.php por fetch: o script lê a resposta.
  const ajax = (corpo: unknown) => async () => {
    await (window as Win).fetch('https://playerflix.ink/inc/Ajax.php?type=serie&id=1396&season=9&episode=99', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  };
  const fakeFetch = (corpo: unknown) => {
    (window as Win).fetch = (() => Promise.resolve({ clone: () => ({ text: () => Promise.resolve(JSON.stringify(corpo)) }) })) as unknown as typeof fetch;
  };

  it('Fonte 1: lista só com opção legendada / Premium (superflixapi) = não tem', async () => {
    const soEn = { status: true, data: { options: [{ embed: 'https://superflixapi.quest/serie/1396/9/99', lang: 'en-us', label: 'Premium', budget: 'danger' }] } };
    expect(await rodar('playerflix.ink', () => fakeFetch(soEn), ajax(soEn)))
      .toEqual(['WMOPT|none|reason=f1-sem-dublado|host=playerflix.ink']);
    delete (window as Win).__wmSem;
    const soPremiumPt = { status: true, data: { options: [{ embed: 'https://superflixapi.quest/filme/1', lang: 'pt-br', label: 'Premium', budget: 'danger' }] } };
    expect(await rodar('playerflix.ink', () => fakeFetch(soPremiumPt), ajax(soPremiumPt)))
      .toEqual(['WMOPT|none|reason=f1-sem-dublado|host=playerflix.ink']);
  });

  it('Fonte 1: lista com opção dublada (WatchPlay / Blogger pt-br) não avisa', async () => {
    const ultimato = { status: true, data: { options: [
      { embed: 'https://v1.watchplay.shop/movie/299534', lang: 'pt-br', label: 'WatchPlay', budget: 'success' },
      { embed: 'https://superflixapi.quest/filme/299534', lang: 'pt-br', label: 'Premium', budget: 'danger' },
    ] } };
    expect(await rodar('playerflix.ink', () => fakeFetch(ultimato), ajax(ultimato))).toEqual([]);
    delete (window as Win).__wmSem;
    const linkClick = { status: true, data: { options: [
      { embed: 'https://www.blogger.com/video.g?token=EN', lang: 'en-us', label: 'Blogger', budget: 'success' },
      { embed: 'https://www.blogger.com/video.g?token=PT', lang: 'pt-br', label: 'Blogger', budget: 'success' },
    ] } };
    expect(await rodar('playerflix.ink', () => fakeFetch(linkClick), ajax(linkClick))).toEqual([]);
  });

  it('Fonte 1: status false = não tem; resposta de formato desconhecido não decide nada', async () => {
    expect(await rodar('playerflix.ink', () => fakeFetch({ status: false }), ajax({ status: false })))
      .toEqual(['WMOPT|none|reason=f1-vazio|host=playerflix.ink']);
    delete (window as Win).__wmSem;
    expect(await rodar('playerflix.ink', () => fakeFetch({ ok: 1 }), ajax({ ok: 1 }))).toEqual([]);
  });

  it('outros frames (myembed.biz, Byse, anúncio) não avisam nada', async () => {
    for (const h of ['myembed.biz', 'n1mwq.org', 'superflixapi.monster']) {
      delete (window as Win).__wmSem;
      expect(await rodar(h, () => { document.title = 'FSHD — 404'; document.body.innerHTML = '<div class="movie-not-found"></div><script>const available=false;</script>'; })).toEqual([]);
    }
  });
});

describe('pulo automático pra próxima fonte', () => {
  const ordem = ['embedmovies', 'embedplayapi', 'fshd', 'pomfy', 'superflix', 'warezcdn', 'megaembed'];

  it('as Fontes 1 a 4 e a 7 entram no pulo (a 5 e a 6 ficam atrás da Cloudflare)', () => {
    expect(AUTO_PULO).toEqual(['embedmovies', 'embedplayapi', 'fshd', 'pomfy', 'megaembed']);
  });

  it('segue a ordem da tela e dá a volta: 4 → 7 → 1 → 2 → 3', () => {
    const fora = new Set<string>();
    expect(proximaFonte(ordem, 'pomfy', fora)).toBe('megaembed');   // a 5 e a 6 não entram
    fora.add('pomfy');
    expect(proximaFonte(ordem, 'megaembed', fora)).toBe('embedmovies');
    fora.add('megaembed');
    expect(proximaFonte(ordem, 'embedmovies', fora)).toBe('embedplayapi');
    fora.add('embedmovies');
    expect(proximaFonte(ordem, 'embedplayapi', fora)).toBe('fshd');
    fora.add('embedplayapi');
    expect(proximaFonte(ordem, 'fshd', fora)).toBeNull();   // as 5 disseram que não têm
  });

  it('pula a que já disse "não tem", a que está em pausa e a que não existe pro título (Fonte 3 sem IMDb)', () => {
    expect(proximaFonte(ordem, 'embedmovies', new Set(['embedplayapi']))).toBe('fshd');
    expect(proximaFonte(ordem, 'embedmovies', new Set(), id => id === 'embedplayapi')).toBe('fshd');
    const semImdb = ordem.filter(id => id !== 'fshd');
    expect(proximaFonte(semImdb, 'embedplayapi', new Set())).toBe('pomfy');
  });

  it('começando fora do pulo (Fonte 5 escolhida na mão) tenta a 1', () => {
    expect(proximaFonte(ordem, 'superflix', new Set(['superflix']))).toBe('embedmovies');
  });
});
