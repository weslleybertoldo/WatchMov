// Testes das regras da captura do link e do resolvedor (regrasCaptura.ts, compilado em out/), as mesmas decisões do
// StreamSnifferPlugin.java, do ResolverPlugin.java e do OptionMsg.java. Rodar: npm run testar (dentro de desktop/).
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./out/regrasCaptura.js');

test('bloqueio: aposta, anúncio e rastreador nunca são o vídeo; a janela escondida nem carrega os que quebram a página', () => {
  assert.equal(r.bloqueado('https://ads.doubleclick.net/x.mp4'), true);
  assert.equal(r.bloqueado('https://cdn.exemplo.com/v/master.m3u8'), false);
  assert.equal(r.derrubar('https://cdn.jsdelivr.net/npm/disable-devtool@1'), true);
  assert.equal(r.derrubar('https://www.googletagmanager.com/gtag/js'), true);
  assert.equal(r.derrubar('https://cdn.neutra.com/creatives/banner.mp4'), true);
  assert.equal(r.derrubar('https://embedplayer2.xyz/video/abc'), false);
});

test('não é conteúdo: pré-roll, pedaço cifrado do Abyss e trailer do YouTube', () => {
  assert.equal(r.naoEConteudo('https://c.bannerflow.net/v.mp4'), true);
  assert.equal(r.naoEConteudo('https://x.abyss.to/sora/123/abc'), true);
  assert.equal(r.naoEConteudo('https://rr1.googlevideo.com/videoplayback?source=youtube&id=1'), true);
  assert.equal(r.naoEConteudo('https://rr1.googlevideo.com/videoplayback?source=blogger&id=1'), false);
});

test('parece vídeo: playlist e arquivo sim; segmento, init e pedaço não', () => {
  assert.equal(r.pareceVideo('https://cdn.x.com/hls/master.m3u8?t=1'), true);
  assert.equal(r.pareceVideo('https://cdn.x.com/filme.mp4'), true);
  assert.equal(r.pareceVideo('https://cdn.x.com/a.mpd'), true);
  assert.equal(r.pareceVideo('https://cdn.x.com/hls/seg-12-v1.ts'), false);
  assert.equal(r.pareceVideo('https://cdn.x.com/hls/init-v1.mp4'), false);
  assert.equal(r.pareceVideo('https://cdn.x.com/hls/chunk_3.m4s'), false);
  assert.equal(r.pareceVideo('https://ads.doubleclick.net/x.mp4'), false);
  assert.equal(r.pareceVideo('https://cdn.x.com/pagina.html'), false);
});

test('sonda: recurso óbvio e pedaço não valem a pena; o master.txt sem extensão de recurso vale', () => {
  for (const u of ['https://embedvip.xyz/p/abc.js', 'https://embedvip2.xyz/p/abc.css', 'https://embedvip3.xyz/p/abc.woff',
    'https://x.com/a.png', 'https://x.com/seg-1.ts', 'blob:https://x.com/1', 'https://x.com/api.php']) {
    assert.equal(r.pularSonda(u), true, u);
  }
  assert.equal(r.pularSonda('https://embedplayer2.xyz/cdn/hls/03989f/master.txt'), false);
  assert.equal(r.pularSonda('https://embedplayer2.xyz/m3/Vk10QmhK'), false);
});

test('tipo do vídeo: pelo endereço, pelo Content-Type e pelo começo do arquivo', () => {
  assert.equal(r.mimeDe('https://x.com/master.txt'), 'application/vnd.apple.mpegurl');
  assert.equal(r.mimeDe('https://x.com/a.m3u8'), 'application/vnd.apple.mpegurl');
  assert.equal(r.mimeDe('https://x.com/a.mpd'), 'application/dash+xml');
  assert.equal(r.mimeDe('https://x.com/a.mp4'), 'video/mp4');
  assert.equal(r.tipoDeVideo('application/vnd.apple.mpegurl'), true);
  assert.equal(r.tipoDeVideo('video/mp4'), true);
  assert.equal(r.tipoDeVideo('text/html'), false);
  assert.equal(r.tipoDeVideo(null), false);
  assert.equal(r.mimePeloComeco('text/plain;charset=UTF-8', '#EXTM3U\n#EXT-X-VERSION:3'), 'application/vnd.apple.mpegurl');
  assert.equal(r.mimePeloComeco('application/octet-stream', '\0\0\0\x18ftypmp42'), 'video/mp4');
  assert.equal(r.mimePeloComeco('application/javascript', '#EXTM3U'), null);
  assert.equal(r.mimePeloComeco('text/html', '<html>'), null);
});

test('cabeçalhos do link: repete Referer/Origin/cookie; nunca sec-*, Range nem os da própria rede', () => {
  const h = r.cabecalhosDoLink({
    Referer: 'https://embedplayer2.xyz/video/1', Origin: 'https://embedplayer2.xyz', Cookie: 'a=1', 'User-Agent': 'UA',
    'sec-ch-ua': '"Chromium"', 'Sec-Fetch-Mode': 'cors', Range: 'bytes=0-', Host: 'x', 'Accept-Encoding': 'gzip',
  });
  assert.deepEqual(h, { Referer: 'https://embedplayer2.xyz/video/1', Origin: 'https://embedplayer2.xyz', Cookie: 'a=1', 'User-Agent': 'UA' });
  assert.deepEqual(r.cabecalhosDoLink(undefined), {});
  assert.equal(r.cabecalho({ referer: 'https://a/' }, 'Referer'), 'https://a/');
  assert.equal(r.cabecalho({}, 'Referer'), undefined);
});

test('qualidade do master: a maior altura anunciada', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=276000,RESOLUTION=640x360\n/m3/a\n#EXT-X-STREAM-INF:BANDWIDTH=2048000,RESOLUTION=1280x720\n/m3/b';
  assert.equal(r.qualidadeDoMaster(master), '720p');
  assert.equal(r.qualidadeDoMaster('#EXTM3U\n#EXTINF:2,\na.ts'), '');
});

test('recados WMOPT: campos e k', () => {
  assert.equal(r.campo('k=2|stage=player|host=x.com', 'stage'), 'player');
  assert.equal(r.campo('k=2|stage=player', 'host'), undefined);
  assert.equal(r.kDoRecado('k=3|stage=media'), 3);
  assert.equal(r.kDoRecado('stage=media'), -1);
});

test('navegação da janela escondida: mesmo site ou host de hop; propaganda e esquema estranho não', () => {
  assert.equal(r.mesmoSite('www.embedplay.one', 'embedplay.one'), true);
  assert.equal(r.mesmoSite('a.x.com', 'b.y.com'), false);
  assert.equal(r.navegacaoPermitida('https://www.myembed.biz/filme/1', 'https://myembed.biz/x', []), true);
  assert.equal(r.navegacaoPermitida('https://propaganda.com/', 'https://myembed.biz/x', []), false);
  assert.equal(r.navegacaoPermitida('https://cdn.hop.net/a', 'https://myembed.biz/x', ['hop.net']), true);
  assert.equal(r.navegacaoPermitida('intent://abrir', 'https://myembed.biz/x', []), false);
  assert.equal(r.navegacaoPermitida('nada', 'https://myembed.biz/x', []), false);
});

test('página com iframe: o endereço vai escapado', () => {
  const p = r.paginaComIframe('https://pomfy.online/v/1?a=1&b="2"');
  assert.match(p, /<iframe src="https:\/\/pomfy\.online\/v\/1\?a=1&amp;b=&quot;2&quot;"/);
  assert.doesNotMatch(p, /b="2"/);
});

test('clique de verdade: ponto na escala da janela; recado torto = null', () => {
  assert.deepEqual(r.pontoDoClique('WMCFTAP|100|50|200|100', 1280, 720), { x: 640, y: 360 });
  assert.deepEqual(r.pontoDoClique('WMCLICK|0|0|10|10', 1280, 720), { x: 0, y: 0 });
  assert.equal(r.pontoDoClique('WMCFTAP|300|50|200|100', 1280, 720), null);
  assert.equal(r.pontoDoClique('WMCFTAP|1|1|0|0', 1280, 720), null);
  assert.equal(r.pontoDoClique('WMOPT|k=1', 1280, 720), null);
});
