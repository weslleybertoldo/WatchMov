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
