import { describe, it, expect } from 'vitest';
import {
  marcasDaTheIntroDb, marcasDaIntroDb, juntarMarcas, chaveDeSerie, urlTheIntroDb, urlIntroDb, tipoDoPulo, fimDoPulo,
  inicioDaContagem, naJanelaDaContagem, proximoMarcaAssistido, chegouNoAssistido, pontoDoAssistido, acaoDaTecla,
  niveisDeQualidade, audioQueComeca, legendaQueLiga, servidoresDoPlayer, SEM_MARCAS, rotuloDaFaixa, proximoLinkAposFalha,
  deveRecapturar, qualidadeDaUrl, rotuloDoLink, Contagem, serieDoPlayer, episodioDaChave, urlTemporadaTmdb,
  episodiosDaTemporada, estreiaDoEpisodio, tempo, rotuloDaVelocidade, volumeSalvo,
} from './playerDesktopRegras';

const MIN = 60_000;

describe('marcas', () => {
  it('TheIntroDB: listas; início nulo = do começo, fim nulo = até o fim; trecho torto sai', () => {
    const m = marcasDaTheIntroDb({
      intro: [{ start_ms: null, end_ms: 90_000 }],
      recap: [{ start_ms: 5_000, end_ms: 5_000 }, { start_ms: 'x', end_ms: 9 }],
      credits: [{ start_ms: 20 * MIN, end_ms: null }],
    });
    expect(m).toEqual({ abertura: [[0, 90_000]], resumo: [], creditos: [[20 * MIN, -1]] });
    expect(marcasDaTheIntroDb(null)).toEqual(SEM_MARCAS);
  });

  it('IntroDB: um objeto por trecho e os créditos se chamam outro; a TheIntroDB vale e a IntroDB completa', () => {
    const intro = marcasDaIntroDb({ intro: { start_ms: 1_000, end_ms: 80_000 }, recap: null, outro: { start_ms: 21 * MIN, end_ms: 22 * MIN } });
    expect(intro).toEqual({ abertura: [[1_000, 80_000]], resumo: [], creditos: [[21 * MIN, 22 * MIN]] });
    const the = marcasDaTheIntroDb({ intro: [{ start_ms: 0, end_ms: 90_000 }], recap: [], credits: [] });
    expect(juntarMarcas(the, intro)).toEqual({ abertura: [[0, 90_000]], resumo: [], creditos: [[21 * MIN, 22 * MIN]] });
  });

  it('chave da série e endereços das 2 bases (filme = sem marcas)', () => {
    expect(chaveDeSerie('65942:tv:1:5')).toEqual([65942, 1, 5]);
    expect(chaveDeSerie('1368337:movie:0:0')).toBeNull();
    expect(chaveDeSerie(undefined)).toBeNull();
    expect(urlTheIntroDb([65942, 1, 5])).toBe('https://api.theintrodb.org/v3/media?tmdb_id=65942&season=1&episode=5');
    expect(urlIntroDb('tt5607616', [65942, 1, 5])).toBe('https://api.introdb.app/segments?imdb_id=tt5607616&season=1&episode=5');
    expect(urlIntroDb('', [65942, 1, 5])).toBeNull();
  });

  it('"Pular" só dentro do trecho com fim conhecido e some no último segundo', () => {
    const m = { abertura: [[60_000, 150_000]], resumo: [[0, 30_000]], creditos: [] } as typeof SEM_MARCAS;
    expect(tipoDoPulo(m, 10_000)).toBe('resumo');
    expect(fimDoPulo(m, 10_000)).toBe(30_000);
    expect(tipoDoPulo(m, 100_000)).toBe('abertura');
    expect(fimDoPulo(m, 100_000)).toBe(150_000);
    expect(tipoDoPulo(m, 149_500)).toBeNull();      // último segundo
    expect(tipoDoPulo(m, 45_000)).toBeNull();
    expect(tipoDoPulo({ ...SEM_MARCAS, abertura: [[0, -1]] }, 5_000)).toBeNull();   // sem fim = não pula
  });
});

describe('contagem do próximo e assistido (= PlayerMarcas.java)', () => {
  const dur = 24 * MIN;
  it('contagem: créditos mapeados depois da metade; senão faltando 40 s; vídeo curto = nenhuma', () => {
    expect(inicioDaContagem({ ...SEM_MARCAS, creditos: [[22 * MIN, -1]] }, dur)).toBe(22 * MIN);
    expect(inicioDaContagem({ ...SEM_MARCAS, creditos: [[5 * MIN, 6 * MIN]] }, dur)).toBe(dur - 40_000);   // antes da metade
    expect(inicioDaContagem(SEM_MARCAS, dur)).toBe(dur - 40_000);
    expect(inicioDaContagem(SEM_MARCAS, 70_000)).toBe(-1);
    expect(naJanelaDaContagem(SEM_MARCAS, dur - 30_000, dur)).toBe(true);
    expect(naJanelaDaContagem(SEM_MARCAS, dur - 50_000, dur)).toBe(false);
  });

  it('pedir o próximo marca assistido na contagem ou faltando até 2 min', () => {
    expect(proximoMarcaAssistido(SEM_MARCAS, dur - 110_000, dur)).toBe(true);
    expect(proximoMarcaAssistido(SEM_MARCAS, dur - 130_000, dur)).toBe(false);
  });

  it('assistido sozinho faltando 1 min; o botão pula pra contagem (com próximo) ou pra faltar 1 min', () => {
    expect(chegouNoAssistido(dur - 59_000, dur)).toBe(true);
    expect(chegouNoAssistido(dur - 61_000, dur)).toBe(false);
    expect(pontoDoAssistido(SEM_MARCAS, 5 * MIN, dur, true)).toBe(dur - 40_000);
    expect(pontoDoAssistido(SEM_MARCAS, 5 * MIN, dur, false)).toBe(dur - 60_000);
    expect(pontoDoAssistido(SEM_MARCAS, dur - 10_000, dur, false)).toBe(-1);   // nunca volta
  });
});

describe('teclado', () => {
  it('atalhos do player', () => {
    expect(acaoDaTecla({ key: ' ' }, false)).toBe('play-pausa');
    expect(acaoDaTecla({ key: 'ArrowLeft' }, false)).toBe('voltar');
    expect(acaoDaTecla({ key: 'ArrowRight' }, true)).toBe('avancar');
    expect(acaoDaTecla({ key: 'ArrowUp' }, false)).toBe('volume+');
    expect(acaoDaTecla({ key: 'f' }, false)).toBe('tela-cheia');
    expect(acaoDaTecla({ key: 'N' }, false)).toBe('proximo');
    expect(acaoDaTecla({ key: 'm' }, false)).toBe('mudo');
  });
  it('Esc fecha só fora da tela cheia; com Ctrl/Alt não é atalho', () => {
    expect(acaoDaTecla({ key: 'Escape' }, false)).toBe('fechar');
    expect(acaoDaTecla({ key: 'Escape' }, true)).toBeNull();
    expect(acaoDaTecla({ key: 'f', ctrlKey: true }, false)).toBeNull();
    expect(acaoDaTecla({ key: 'x' }, false)).toBeNull();
  });
});

describe('faixas', () => {
  it('qualidade: Auto + alturas da maior pra menor, sem repetir', () => {
    expect(niveisDeQualidade([{ height: 480 }, { height: 1080 }, { height: 720 }, { height: 720 }, {}])).toEqual([
      { indice: -1, rotulo: 'Auto' }, { indice: 1, rotulo: '1080p' }, { indice: 2, rotulo: '720p' }, { indice: 0, rotulo: '480p' },
    ]);
  });
  it('áudio: português primeiro; sem ele, a padrão', () => {
    expect(audioQueComeca([{ lang: 'en', default: true }, { lang: 'pt-BR' }])).toBe(1);
    expect(audioQueComeca([{ lang: 'en' }, { name: 'Dublado' }])).toBe(1);
    expect(audioQueComeca([{ lang: 'ja' }, { lang: 'en', default: true }])).toBe(1);
    expect(audioQueComeca([])).toBe(-1);
  });
  it('legenda: a forçada sempre; a padrão só com áudio em outra língua', () => {
    const faixas = [{ lang: 'en', default: true }, { lang: 'pt', forced: true }, { lang: 'pt' }];
    expect(legendaQueLiga(faixas, true)).toBe(1);
    expect(legendaQueLiga([{ lang: 'en', default: true }, { lang: 'pt' }], true)).toBe(-1);
    expect(legendaQueLiga([{ lang: 'en', default: true }, { lang: 'pt' }], false)).toBe(1);
  });
});

describe('servidores, links e recaptura', () => {
  it('popup do servidor = PlayerServidores.java: só "id|rótulo" completo, sem repetir id', () => {
    expect(servidoresDoPlayer(['embedmovies|1 · EmbedMovies', 'megaembed|', '|nada', 'pomfy', 'embedmovies|outra', 'f7|7 · MegaEmbed'])).toEqual([
      { id: 'embedmovies', rotulo: '1 · EmbedMovies' }, { id: 'f7', rotulo: '7 · MegaEmbed' },
    ]);
    expect(servidoresDoPlayer(undefined)).toEqual([]);
  });

  it('link que falhou: segue PRA FRENTE, pula tentados e vencidos; acabou = -1', () => {
    const agora = Date.UTC(2026, 10, 8, 7, 0, 0);
    const vencido = `https://x.y/v.mp4?expires=${Math.floor((agora - 60_000) / 1000)}`;
    const urls = ['a', 'b', vencido, 'd'];
    expect(proximoLinkAposFalha(urls, 0, new Set(['a']), agora)).toBe(1);
    expect(proximoLinkAposFalha(urls, 1, new Set(['a', 'b']), agora)).toBe(3);   // o 3 venceu
    expect(proximoLinkAposFalha(urls, 3, new Set(['d']), agora)).toBe(-1);       // não volta pro 1
    expect(proximoLinkAposFalha(urls, -1, new Set(['zz']), agora)).toBe(0);      // fora da lista = do início
    expect(proximoLinkAposFalha(undefined, -1, new Set(), agora)).toBe(-1);
  });

  it('link novo (= LinkExpiry.shouldRecapture): morreu ou caiu no meio; nunca tocou por formato = não', () => {
    expect(deveRecapturar(403, false, false)).toBe(true);
    expect(deveRecapturar(404, false, false)).toBe(true);
    expect(deveRecapturar(410, false, false)).toBe(true);
    expect(deveRecapturar(undefined, true, false)).toBe(true);   // prazo da URL
    expect(deveRecapturar(500, false, false)).toBe(false);       // nunca tocou
    expect(deveRecapturar(500, false, true)).toBe(true);
    expect(deveRecapturar(0, false, true)).toBe(true);           // rede caiu no meio
    expect(deveRecapturar(429, false, true)).toBe(true);
    expect(deveRecapturar(200, false, true)).toBe(false);        // tocou e o arquivo é que é torto
  });

  it('rótulo do link e qualidade tirada do endereço', () => {
    expect(rotuloDoLink(0, 'https://x/master.m3u8', 'application/vnd.apple.mpegurl', '720p')).toBe('Link 1 (HLS) 720p');
    expect(rotuloDoLink(1, 'https://x/cdn/master.txt', '', '')).toBe('Link 2 (HLS)');
    expect(rotuloDoLink(2, 'https://x/filme_1080p.mp4')).toBe('Link 3 (MP4) 1080p');
    expect(qualidadeDaUrl('https://x/720/abc.mp4')).toBe('');
    expect(qualidadeDaUrl('https://x/480p/abc.mp4')).toBe('480p');
  });

  it('nome da faixa', () => {
    expect(rotuloDaFaixa({ name: 'Português', lang: 'pt' }, 0)).toBe('Português');
    expect(rotuloDaFaixa({ lang: 'en', forced: true }, 1)).toBe('en (forçada)');
    expect(rotuloDaFaixa({}, 2)).toBe('Faixa 3');
  });
});

describe('contagem do próximo (= PlayerMarcas.Contagem)', () => {
  const ini = 20 * MIN;
  it('aparece no início, desconta só tocando e pula no zero', () => {
    const c = new Contagem();
    expect(c.tique(ini - 5_000, ini, true, false, 0)).toBe('nada');
    expect(c.tique(ini, ini, true, false, 1_000)).toBe('mostrar');
    expect(c.segundos()).toBe(10);
    expect(c.tique(ini + 500, ini, true, false, 1_500)).toBe('atualizar');
    expect(c.segundos()).toBe(10);                                          // 9,5 s mostra 10
    expect(c.tique(ini + 600, ini, false, false, 6_000)).toBe('atualizar');  // pausado não desconta
    expect(c.restanteMs).toBe(9_500);
    expect(c.tique(ini + 10_000, ini, true, false, 15_600)).toBe('pular');
    expect(c.tique(ini + 10_500, ini, true, false, 16_000)).toBe('nada');   // dispara 1 vez só
  });

  it('cancelar some até voltar pra antes do início; vídeo acabou = pula na hora; sem início = nada', () => {
    const c = new Contagem();
    c.tique(ini, ini, true, false, 0);
    c.cancelar();
    expect(c.tique(ini + 1_000, ini, true, false, 1_000)).toBe('nada');
    expect(c.tique(ini - 3_000, ini, true, false, 2_000)).toBe('nada');      // voltou: rearmou
    expect(c.tique(ini, ini, true, false, 3_000)).toBe('mostrar');
    const fim = new Contagem();
    expect(fim.tique(ini + 30_000, ini, false, true, 0)).toBe('pular');
    expect(new Contagem().tique(5_000, -1, true, false, 0)).toBe('nada');
  });

  it('rearmar (botão Assistido) reabre depois de cancelar', () => {
    const c = new Contagem();
    c.tique(ini, ini, true, false, 0);
    c.cancelar();
    c.rearmar();
    expect(c.tique(ini + 100, ini, true, false, 100)).toBe('mostrar');
  });
});

describe('painel de episódios', () => {
  it('JSON do app → série; torto ou sem temporada = null', () => {
    const s = serieDoPlayer(JSON.stringify({ tmdb: 65942, chave: 'k', temporadas: [{ n: 1, total: 25, vistos: [1], pct: {} }, { n: 2, total: 0, vistos: [], pct: {} }] }));
    expect(s?.temporadas.map((t) => t.n)).toEqual([1]);
    expect(serieDoPlayer('{')).toBeNull();
    expect(serieDoPlayer(undefined)).toBeNull();
    expect(serieDoPlayer(JSON.stringify({ tmdb: 1, chave: 'k', temporadas: [] }))).toBeNull();
  });

  it('episódio da chave e endereço da temporada na TMDB', () => {
    expect(episodioDaChave('65942:tv:1:5')).toEqual({ temporada: 1, episodio: 5 });
    expect(episodioDaChave('1:movie:0:0')).toBeNull();
    expect(urlTemporadaTmdb(65942, 2, 'a b')).toBe('https://api.themoviedb.org/3/tv/65942/season/2?api_key=a%20b&language=pt-BR');
  });

  it('lista da temporada: nome, imagem e data da TMDB; o que faltar vira "Episódio N"', () => {
    const l = episodiosDaTemporada({ episodes: [
      { episode_number: 1, name: 'Começo', still_path: '/a.jpg', air_date: '2016-04-04', runtime: 49 },
      { episode_number: 3, name: ' ', air_date: 'x' },
    ] }, 3);
    expect(l).toEqual([
      { n: 1, nome: 'Começo', imagem: 'https://image.tmdb.org/t/p/w300/a.jpg', data: '2016-04-04', minutos: 49 },
      { n: 2, nome: 'Episódio 2', imagem: undefined, data: undefined, minutos: undefined },
      { n: 3, nome: 'Episódio 3', imagem: undefined, data: undefined, minutos: undefined },
    ]);
    expect(episodiosDaTemporada(null, 2).map((e) => e.nome)).toEqual(['Episódio 1', 'Episódio 2']);
  });

  it('"Estreia" só pra episódio que ainda não saiu', () => {
    const hoje = new Date(2026, 10, 8, 23, 0);
    expect(estreiaDoEpisodio('2026-11-21', hoje)).toBe('Estreia 21/11');
    expect(estreiaDoEpisodio('2026-11-08', hoje)).toBe('');
    expect(estreiaDoEpisodio(undefined, hoje)).toBe('');
  });
});

describe('barra', () => {
  it('tempo, velocidade e volume salvo', () => {
    expect(tempo(0)).toBe('0:00');
    expect(tempo(65_400)).toBe('1:05');
    expect(tempo(3_723_000)).toBe('1:02:03');
    expect(tempo(Number.NaN)).toBe('0:00');
    expect(rotuloDaVelocidade(1)).toBe('Normal');
    expect(rotuloDaVelocidade(1.25)).toBe('1,25x');
    expect(volumeSalvo(null)).toBe(1);
    expect(volumeSalvo('0.35')).toBe(0.35);
    expect(volumeSalvo('7')).toBe(1);
    expect(volumeSalvo('abc')).toBe(1);
  });
});
