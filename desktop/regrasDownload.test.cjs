// Testes das regras dos downloads do app do Windows (regrasDownload.ts, compilado em out/). Rodar: npm run testar.
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./out/regrasDownload.js');

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Português",LANGUAGE="pt-BR",DEFAULT=NO,URI="audio/pt.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"
360/index.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=90000,URI="iframes.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO="aud"
https://cdn.y/720/index.m3u8?token=a,b
#EXT-X-STREAM-INF:BANDWIDTH=1200000
sem-resolucao.m3u8
`;

test('master: variantes com altura e banda, I-FRAME de fora, URL relativa e absoluta', () => {
  const m = r.lerMaster(MASTER, 'https://cdn.x/filme/master.m3u8');
  assert.equal(m.variantes.length, 3);
  assert.deepEqual(m.variantes[0], { url: 'https://cdn.x/filme/360/index.m3u8', banda: 800000, altura: 360, audio: 'aud' });
  assert.equal(m.variantes[1].url, 'https://cdn.y/720/index.m3u8?token=a,b');
  assert.equal(m.variantes[2].altura, 0);
  assert.equal(m.midias.length, 2);
  assert.equal(m.midias[1].url, 'https://cdn.x/filme/audio/pt.m3u8');
});

test('escolhe a maior qualidade e o áudio em português (depois o padrão)', () => {
  const m = r.lerMaster(MASTER, 'https://cdn.x/filme/master.m3u8');
  const v = r.escolherVariante(m);
  assert.equal(v.altura, 720);
  assert.equal(r.escolherAudio(m, v).idioma, 'pt-BR');
  const semPt = { ...m, midias: m.midias.filter((x) => x.idioma !== 'pt-BR') };
  assert.equal(r.escolherAudio(semPt, v).nome, 'English');
  assert.equal(r.escolherAudio(m, { ...v, audio: undefined }), undefined);
  // Sem altura em nenhuma: a maior banda.
  assert.equal(r.escolherVariante({ variantes: [{ url: 'a', banda: 1, altura: 0 }, { url: 'b', banda: 9, altura: 0 }], midias: [] }).url, 'b');
});

const PEDACOS = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="/chaves/k1.key",IV=0x0000000000000000000000000000000A
#EXTINF:10.0,
seg-0.ts
#EXTINF:9.5,
seg-1.png
#EXT-X-KEY:METHOD=NONE
#EXT-X-DISCONTINUITY
#EXT-X-BYTERANGE:1000@0
#EXTINF:4,
tudo.ts
#EXT-X-BYTERANGE:500
#EXTINF:2,
tudo.ts
#EXT-X-ENDLIST
`;

test('lista de pedaços: duração, sequência, chave, faixa de bytes e descontinuidade', () => {
  const p = r.lerPlaylist(PEDACOS, 'https://cdn.x/v/index.m3u8');
  assert.equal(p.segmentos.length, 4);
  assert.equal(p.duracao, 25.5);
  assert.equal(p.sequencia, 7);
  assert.equal(p.fim, true);
  assert.equal(p.vod, true);
  assert.deepEqual(p.segmentos[0].chave, { metodo: 'AES-128', url: 'https://cdn.x/chaves/k1.key', iv: '0x0000000000000000000000000000000A' });
  assert.equal(p.segmentos[1].url, 'https://cdn.x/v/seg-1.png');
  assert.equal(p.segmentos[2].chave, undefined);
  assert.equal(p.segmentos[2].descontinuidade, true);
  assert.deepEqual(p.segmentos[2].faixa, { tamanho: 1000, inicio: 0 });
  assert.deepEqual(p.segmentos[3].faixa, { tamanho: 500, inicio: 1000 });   // sem @: continua de onde o anterior parou
});

test('lista local: mesma sequência, chave local com o IV, sem faixas, ENDLIST', () => {
  const p = r.lerPlaylist(PEDACOS, 'https://cdn.x/v/index.m3u8');
  const texto = r.playlistLocal(p, { segmento: (i) => `v-${i}.ts`, chave: () => 'v-chave.key', mapa: () => 'v-init.mp4' });
  assert.match(texto, /#EXT-X-MEDIA-SEQUENCE:7/);
  assert.match(texto, /#EXT-X-KEY:METHOD=AES-128,URI="v-chave.key",IV=0x0000000000000000000000000000000A\n#EXTINF:10.000,\nv-0.ts/);
  assert.match(texto, /#EXT-X-KEY:METHOD=NONE\n#EXT-X-DISCONTINUITY\n#EXTINF:4.000,\nv-2.ts/);
  assert.doesNotMatch(texto, /BYTERANGE/);
  assert.match(texto, /#EXT-X-ENDLIST\n$/);
  // fMP4: o init entra uma vez (e de novo só quando muda).
  const fmp4 = r.lerPlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\na.m4s\n#EXTINF:6,\nb.m4s\n#EXT-X-ENDLIST', 'https://c/x/i.m3u8');
  const t2 = r.playlistLocal(fmp4, { segmento: (i) => `s${i}.m4s`, chave: () => '', mapa: () => 'init.mp4' });
  assert.equal(t2.match(/#EXT-X-MAP/g).length, 1);
});

test('é lista HLS? é página no lugar do vídeo? já parece HLS pela URL?', () => {
  assert.equal(r.ehPlaylist('﻿  #EXTM3U\n'), true);
  assert.equal(r.ehPlaylist('\x00\x00\x00 ftypisom'), false);
  assert.equal(r.ehMaster(MASTER), true);
  assert.equal(r.ehMaster(PEDACOS), false);
  assert.equal(r.pareceHtml('<!DOCTYPE html><html>'), true);
  assert.equal(r.pareceHtml('{"error":"Assinatura inválida"}'), true);
  assert.equal(r.pareceHtml('\x00\x00\x00\x18ftypmp42'), false);
  assert.equal(r.pareceHls('https://x/master.txt'), true);
  assert.equal(r.pareceHls('https://x/v.mp4', 'video/mp4'), false);
  assert.equal(r.pareceHls('https://x/play?id=1', 'application/x-mpegURL'), true);
});

test('ffmpeg: junta sem recodificar; com áudio separado mapeia as duas listas', () => {
  const a = r.argsDoFfmpeg('v.m3u8', undefined, 'saida.part');
  assert.ok(a.join(' ').endsWith('-i v.m3u8 -map 0:v:0? -map 0:a? -c copy -movflags +faststart -f mp4 saida.part'), a.join(' '));
  assert.ok(a.includes('-allowed_extensions') && a.includes('file,crypto,data'));
  assert.equal(a[a.length - 1], 'saida.part');
  const b = r.argsDoFfmpeg('v.m3u8', 'a.m3u8', 'x');
  assert.equal(b.filter((x) => x === '-i').length, 2);
  assert.ok(b.join(' ').includes('-map 0:v:0? -map 1:a:0'));
  assert.equal(r.tempoDoFfmpeg('frame= 100 fps=0.0 q=-1.0 size= 1024kB time=00:01:02.50 bitrate='), 62.5);
  assert.equal(r.tempoDoFfmpeg('nada aqui'), null);
  assert.equal(r.duracaoDoFfmpeg('  Duration: 00:52:13.40, start: 0.000000'), 3133.4);
});

test('percentual, total da resposta e faixa pedida ao arquivo baixado', () => {
  assert.equal(r.percentual(50, 200), 25);
  assert.equal(r.percentual(199, 200), 99);
  assert.equal(r.percentual(5, 0), -1);
  assert.equal(r.totalDaResposta('bytes 100-199/5000', '100', 100), 5000);
  assert.equal(r.totalDaResposta(null, '900', 100), 1000);
  assert.equal(r.totalDaResposta(null, null, 0), -1);
  assert.deepEqual(r.faixaDoPedido('bytes=0-', 1000), { inicio: 0, fim: 999 });
  assert.deepEqual(r.faixaDoPedido('bytes=100-199', 1000), { inicio: 100, fim: 199 });
  assert.deepEqual(r.faixaDoPedido('bytes=900-5000', 1000), { inicio: 900, fim: 999 });
  assert.deepEqual(r.faixaDoPedido('bytes=-100', 1000), { inicio: 900, fim: 999 });
  assert.equal(r.faixaDoPedido('bytes=1000-', 1000), 'invalida');
  assert.equal(r.faixaDoPedido(null, 1000), null);
  assert.equal(r.faixaDoPedido('bytes=0-1,5-9', 1000), null);
});

test('chave do download e nome do arquivo no Windows', () => {
  assert.equal(r.chaveValida('m:1368337'), true);
  assert.equal(r.chaveValida('e:1399:1:1'), true);
  assert.equal(r.chaveValida('e:1399:1'), false);
  assert.equal(r.chaveValida('m:1; rm -rf'), false);
  assert.equal(r.nomeDoArquivo('A Odisseia', 'm:1368337'), 'A Odisseia.mp4');
  assert.equal(r.nomeDoArquivo('Game of Thrones', 'e:1399:1:1'), 'Game of Thrones — T1E1.mp4');
  assert.equal(r.nomeDoArquivo('Game of Thrones — T1 E1', 'e:1399:1:1'), 'Game of Thrones — T1 E1.mp4');
  assert.equal(r.nomeDoArquivo('Missão: Impossível / Acerto Final?', 'm:1'), 'Missão Impossível Acerto Final.mp4');
  assert.equal(r.nomeDoArquivo('', 'e:5:2:3'), 'Série 5 — T2E3.mp4');
  assert.equal(r.nomeDoArquivo('CON', 'm:9'), '_CON.mp4');
  assert.equal(r.nomeDoArquivo('Fim com ponto...', 'm:9'), 'Fim com ponto.mp4');
});

test('motivo da falha igual ao APK (DownloadFailure.java)', () => {
  assert.equal(r.motivoDaFalha(404), 'Link expirou: abra o título de novo pra capturar outro');
  assert.equal(r.motivoDaFalha(403), 'A fonte bloqueou o download: troque a fonte');
  assert.equal(r.motivoDaFalha(503), 'Servidor da fonte fora do ar');
  assert.equal(r.motivoDaFalha(418), 'Servidor da fonte respondeu erro 418');
  assert.equal(r.motivoDaFalha(0, 'net::ERR_INTERNET_DISCONNECTED'), 'Sem conexão com o servidor da fonte');
  assert.equal(r.motivoDaFalha(0, 'TimeoutError: The operation was aborted due to timeout'), 'Servidor da fonte parou de responder');
  assert.equal(r.motivoDaFalha(0, 'net::ERR_CONNECTION_RESET'), 'Conexão com a fonte caiu no meio');
  assert.equal(r.motivoDaFalha(0, 'ENOSPC: no space left on device'), 'Sem espaço no disco');
  assert.equal(r.descreverFalha('Servidor da fonte parou de responder', 37.4),
    'Servidor da fonte parou de responder · parou em 37% · abra a aba Download pra retomar de onde parou');
  assert.equal(r.descreverFalha('Link expirou', 0), 'Link expirou · abra a aba Download pra retomar de onde parou');
  assert.equal(r.falhaTemporaria(0), true);
  assert.equal(r.falhaTemporaria(503), true);
  assert.equal(r.falhaTemporaria(429), true);
  assert.equal(r.falhaTemporaria(404), false);
  assert.equal(r.falhaTemporaria(403), false);
});
