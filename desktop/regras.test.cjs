// Testes das regras da rede do app do Windows (regras.ts, compilado em out/). Rodar: npm run testar (dentro de desktop/).
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./out/regras.js');

const APP = 'https://watchmovbr.vercel.app';

test('mídia: playlist, segmento, master.txt, /m3/ e /md/ do EmbedPlay', () => {
  for (const u of [
    'https://cdn.x/hls/master.m3u8?t=1', 'https://cdn.x/seg-12.ts', 'https://cdn.x/v/arquivo.mp4#t=10',
    'https://cdn.x/stream/master.txt', 'https://cdn.x/m3/abc', 'https://cdn.x/md/abc', 'https://cdn.x/a/playlist.php',
    'https://cdn.x/legenda.vtt', 'https://cdn.x/chave.key',
  ]) assert.equal(r.ehMidia(u), true, u);
  for (const u of ['https://cdn.x/logo.png', 'https://api.themoviedb.org/3/movie/1', 'https://cdn.x/app.js', 'https://cdn.x/tsx'])
    assert.equal(r.ehMidia(u), false, u);
});

test('CORS: mídia, listas do Ao Vivo e hosts com cabeçalhos guardados', () => {
  const vazio = new Map();
  assert.equal(r.precisaCors('https://superflixapi.pro/lista?category=canais&format=json', vazio), true);
  assert.equal(r.precisaCors('https://iptv-org.github.io/iptv/countries/br.m3u', vazio), true);
  assert.equal(r.precisaCors('https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1', vazio), true);
  assert.equal(r.precisaCors('https://api.introdb.app/outra', vazio), false);
  assert.equal(r.precisaCors('https://superflixapi.pro/filme/1', vazio), false);
  assert.equal(r.precisaCors('https://nnvwpgpvzysvyntdrtay.supabase.co/rest/v1/x', vazio), false);
  assert.equal(r.precisaCors('https://edge1.cdn.x/seg/abc.jpg', new Map([['edge1.cdn.x', {}]])), true);
});

test('trocarCabecalho não duplica em outra caixa e apaga com null', () => {
  const h = { 'access-control-allow-origin': ['*'], 'Content-Type': ['x'] };
  r.trocarCabecalho(h, 'Access-Control-Allow-Origin', [APP]);
  assert.deepEqual(h, { 'Content-Type': ['x'], 'Access-Control-Allow-Origin': [APP] });
  r.trocarCabecalho(h, 'content-type', null);
  assert.deepEqual(h, { 'Access-Control-Allow-Origin': [APP] });
});

test('cabeçalhos guardados: sem o nome do app, sem os da própria rede, só texto', () => {
  const g = r.cabecalhosGuardaveis({
    Referer: 'https://embedplay.one/filme/1', 'X-Requested-With': 'com.weslley.watchmov', Host: 'a', 'Content-Length': '9',
    'x-token': 'abc', ruim: 3, 'nome com espaço': 'x',
  });
  assert.deepEqual(g, { Referer: 'https://embedplay.one/filme/1', 'x-token': 'abc' });
  assert.deepEqual(r.cabecalhosGuardaveis(null), {});
});

test('aplicarCabecalhos: troca Referer/Origin do app pelos do servidor, Origin sai do Referer', () => {
  const pedido = { Referer: `${APP}/`, Origin: APP, Accept: '*/*', 'x-requested-with': 'com.weslley.watchmov' };
  r.aplicarCabecalhos(pedido, { referer: 'https://www.embedplay.one/filme/1368337' });
  assert.deepEqual(pedido, { Accept: '*/*', referer: 'https://www.embedplay.one/filme/1368337', Origin: 'https://www.embedplay.one' });
  const comOrigem = { Origin: APP };
  r.aplicarCabecalhos(comOrigem, { Referer: 'https://a.x/p', Origin: 'https://b.x' });
  assert.deepEqual(comOrigem, { Origin: 'https://b.x', Referer: 'https://a.x/p' });
});

test('CSP: só o connect-src e o frame-src ganham https:, o resto fica igual', () => {
  const csp = "default-src 'self'; script-src 'self'; connect-src 'self' https://superflixapi.pro; frame-src 'self' https://superflixapi.fun; frame-ancestors 'none'";
  assert.equal(r.cspDoApp(csp), "default-src 'self'; script-src 'self'; connect-src 'self' https://superflixapi.pro https:; frame-src 'self' https://superflixapi.fun https:; frame-ancestors 'none'");
  assert.equal(r.cspDoApp("connect-src 'self' https:; frame-src *"), "connect-src 'self' https:; frame-src *");
  assert.equal(r.cspDoApp("default-src 'self'"), "default-src 'self'");
  assert.equal(r.cspDoApp("frame-src-elem x; script-src 'self'"), "frame-src-elem x; script-src 'self'");
});

test('janela nova: só a página do app abre (no navegador do PC); iframe de servidor = propaganda', () => {
  assert.equal(r.destinoDaJanela('https://github.com/x', APP, APP), 'fora');
  assert.equal(r.destinoDaJanela('https://propaganda.x/', 'https://embedplay.one', APP), 'bloquear');
  assert.equal(r.destinoDaJanela('https://propaganda.x/', null, APP), 'bloquear');
  assert.equal(r.destinoDaJanela('javascript:alert(1)', APP, APP), 'bloquear');
});

test('navegação da janela: fica no app, link de fora da página vai pro PC, iframe trocando a página = bloqueado', () => {
  assert.equal(r.destinoDaNavegacao(`${APP}/?x=1`, APP, 'https://embedplay.one'), 'app');
  assert.equal(r.destinoDaNavegacao('https://github.com/', APP, APP), 'fora');
  assert.equal(r.destinoDaNavegacao('https://propaganda.x/', APP, 'https://f7hyg4q.org'), 'bloquear');
  assert.equal(r.destinoDaNavegacao('https://propaganda.x/', APP, null), 'bloquear');
  assert.equal(r.destinoDaNavegacao('file:///C:/x', APP, APP), 'bloquear');
});

test('origemDe e hostDe', () => {
  assert.equal(r.origemDe('https://watchmovbr.vercel.app/x?y'), APP);
  assert.equal(r.origemDe('about:blank'), null);
  assert.equal(r.origemDe(''), null);
  assert.equal(r.hostDe('https://EDGE1.cdn.x:8443/a'), 'edge1.cdn.x:8443');
  assert.equal(r.hostDe('nada'), null);
});

test('vídeo pelo app: só http/https de fora da rede local, endereço no parâmetro u', () => {
  const K = 'chave-da-abertura';
  const via = (u, k = K) => `wm-video://v/?t=${k}&u=${encodeURIComponent(u)}`;
  assert.equal(r.ESQUEMA_VIDEO, 'wm-video');
  const seg = 'https://embedvip.xyz/p/VYxDI8YrHm-6o80ZV.js';
  assert.equal(r.alvoDoVideo(via(seg), K), seg);
  assert.equal(r.alvoDoVideo(via('https://embedplayer2.xyz/cdn/hls/abc/master.txt?t=1&x=a%20b'), K), 'https://embedplayer2.xyz/cdn/hls/abc/master.txt?t=1&x=a%20b');
  assert.equal(r.alvoDoVideo(via('http://cdn.exemplo.com/v.mp4'), K), 'http://cdn.exemplo.com/v.mp4');
  // sem a chave da página do app (um iframe de servidor tentando usar o esquema): nada
  assert.equal(r.alvoDoVideo(via(seg, 'outra'), K), null);
  assert.equal(r.alvoDoVideo(`wm-video://v/?u=${encodeURIComponent(seg)}`, K), null);
  assert.equal(r.alvoDoVideo(via(seg, ''), ''), null);
  for (const local of ['http://127.0.0.1:8094/', 'http://localhost/x', 'http://192.168.31.1/', 'http://10.0.0.2/', 'http://172.20.1.1/',
    'http://169.254.169.254/latest', 'http://[::1]:80/', 'http://roteador.local/', 'http://0.0.0.0/']) {
    assert.equal(r.alvoDoVideo(via(local), K), null, local);
  }
  assert.equal(r.alvoDoVideo(via('file:///etc/passwd'), K), null);
  assert.equal(r.alvoDoVideo(via('javascript:alert(1)'), K), null);
  assert.equal(r.alvoDoVideo(`wm-video://v/?t=${K}`, K), null);
  assert.equal(r.alvoDoVideo(`https://x.com/?t=${K}&u=${encodeURIComponent(seg)}`, K), null);
  assert.equal(r.enderecoLocal('172.32.0.1'), false);
  assert.equal(r.enderecoLocal('embedvip.xyz'), false);
});

test('referer do pedido do vídeo: a política do navegador (só a origem pra outro site), senão o Chromium cancela', () => {
  const player = 'https://112234152.xyz/player/index.php?data=0ed59365c9661717a5809aba12f64c5c';
  // pedaço em outro servidor (Fonte 3): só a origem, como o iframe manda
  assert.equal(r.refererDoPedido(player, 'https://venom.00000410.xyz/cdn/down/abc/index.json/seg-1-v1-a1.jpg'), 'https://112234152.xyz/');
  // playlist no mesmo site: o endereço todo
  assert.equal(r.refererDoPedido(player, 'https://112234152.xyz/hls/abc/master.txt'), player);
  // já era só a origem (Fontes 1, 2, 4, 7): não muda
  assert.equal(r.refererDoPedido('https://embedplayer2.xyz/', 'https://embedvip2.xyz/a/0001.js'), 'https://embedplayer2.xyz/');
  // sem âncora e sem usuário/senha no mesmo site
  assert.equal(r.refererDoPedido('https://u:s@cdn.x/p/a?b=1#c', 'https://cdn.x/v.m3u8'), 'https://cdn.x/p/a?b=1');
  // de https pra http e referer que não é http(s): sem Referer
  assert.equal(r.refererDoPedido('https://cdn.x/p', 'http://cdn.y/v.ts'), null);
  assert.equal(r.refererDoPedido('about:blank', 'https://cdn.y/v.ts'), null);
  assert.equal(r.refererDoPedido('lixo', 'https://cdn.y/v.ts'), null);
  // http pra http de outro site: só a origem
  assert.equal(r.refererDoPedido('http://a.x/p?q=1', 'http://b.x/v.ts'), 'http://a.x/');
});

test('arquivo baixado pelo esquema do vídeo (W4): só wm-video://arquivo/…', () => {
  assert.equal(r.ehArquivoBaixado('wm-video://arquivo/?t=x&k=m:1'), true);
  assert.equal(r.ehArquivoBaixado('wm-video://v/?t=x&u=https%3A%2F%2Fcdn.x%2Fa.m3u8'), false);
  assert.equal(r.ehArquivoBaixado('https://arquivo/?k=m:1'), false);
  assert.equal(r.ehArquivoBaixado('lixo'), false);
  // O caminho da internet nunca serve arquivo do disco.
  assert.equal(r.alvoDoVideo('wm-video://arquivo/?t=k&k=m:1', 'k'), null);
});
