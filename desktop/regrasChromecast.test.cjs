// Testes do protocolo do Chromecast (regrasChromecast.ts, compilado em out/). Rodar: npm run testar.
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./out/regrasChromecast.js');

test('codifica e decodifica um CastMessage (ida e volta), com o tamanho na frente', () => {
  const m = { origem: c.EMISSOR, destino: c.RECEPTOR, ns: c.NS_RECEPTOR, dados: { type: 'LAUNCH', appId: c.APP_PADRAO, requestId: 1 } };
  const q = c.codificar(m);
  assert.equal(q.readUInt32BE(0), q.length - 4);
  assert.deepEqual(c.decodificarCorpo(q.subarray(4)), m);
});

test('bytes conferidos com o protobuf de verdade (campos 1..6 na ordem, varint e strings)', () => {
  const q = c.codificar({ origem: 'a', destino: 'b', ns: 'n', dados: {} });
  // 08 00 | 12 01 'a' | 1a 01 'b' | 22 01 'n' | 28 00 | 32 02 '{}'
  assert.deepEqual([...q.subarray(4)], [0x08, 0x00, 0x12, 0x01, 0x61, 0x1a, 0x01, 0x62, 0x22, 0x01, 0x6e, 0x28, 0x00, 0x32, 0x02, 0x7b, 0x7d]);
});

test('texto longo (> 127 bytes: tamanho em 2 bytes de varint) e acento', () => {
  const titulo = 'É'.repeat(100);
  const q = c.codificar({ origem: c.EMISSOR, destino: 'web-5', ns: c.NS_MIDIA, dados: { titulo } });
  assert.equal(c.decodificarCorpo(q.subarray(4)).dados.titulo, titulo);
});

test('leitor junta quadros picados e devolve vários de uma vez', () => {
  const a = c.codificar({ origem: 'receiver-0', destino: 'sender-0', ns: c.NS_BATIDA, dados: { type: 'PING' } });
  const b = c.codificar({ origem: 'receiver-0', destino: 'sender-0', ns: c.NS_RECEPTOR, dados: { type: 'RECEIVER_STATUS' } });
  const tudo = Buffer.concat([a, b]);
  const l = new c.Leitor();
  assert.deepEqual(l.empurrar(tudo.subarray(0, 3)), []);
  assert.deepEqual(l.empurrar(tudo.subarray(3, a.length + 5)).map((m) => m.dados.type), ['PING']);
  assert.deepEqual(l.empurrar(tudo.subarray(a.length + 5)).map((m) => m.dados.type), ['RECEIVER_STATUS']);
  assert.throws(() => new c.Leitor().empurrar(Buffer.from([0x00, 0x10, 0x00, 0x00])), /não é Chromecast/);
});

test('LOAD como o loadOnCast: HLS com formato dos pedaços, posição em segundos, mp4 sem formato', () => {
  const h = c.pedidoLoad({ url: 'http://192.168.31.10:8099/t/x/s?u=a', hls: true, formato: 'fmp4', titulo: 'GoT T1E1', posicaoMs: 61500, requestId: 7 });
  assert.equal(h.type, 'LOAD');
  assert.equal(h.media.contentType, 'application/x-mpegURL');
  assert.equal(h.media.streamType, 'BUFFERED');
  assert.equal(h.media.hlsSegmentFormat, 'fmp4');
  assert.equal(h.media.hlsVideoSegmentFormat, 'fmp4');
  assert.equal(h.currentTime, 61.5);
  assert.equal(h.autoplay, true);
  const m = c.pedidoLoad({ url: 'http://x/a.mp4', hls: false, titulo: '', posicaoMs: -5, requestId: 8 });
  assert.equal(m.media.contentType, 'video/mp4');
  assert.equal(m.media.hlsSegmentFormat, undefined);
  assert.equal(m.media.metadata.title, 'WatchMov');
  assert.equal(m.currentTime, 0);
  assert.equal(c.pedidoLoad({ url: 'u', hls: true, titulo: 't', posicaoMs: 0, requestId: 1 }).media.hlsVideoSegmentFormat, 'mpeg2_ts');
});

test('MEDIA_STATUS e RECEIVER_STATUS', () => {
  assert.deepEqual(c.lerStatusMidia({ type: 'MEDIA_STATUS', status: [{ mediaSessionId: 3, playerState: 'PLAYING', currentTime: 12.25, media: { duration: 3130 }, volume: { level: 0.5 } }] }),
    { sessao: 3, estado: 'PLAYING', posicaoMs: 12250, duracaoMs: 3130000, motivoParada: undefined, volume: 50 });
  assert.equal(c.lerStatusMidia({ type: 'MEDIA_STATUS', status: [{ mediaSessionId: 3, playerState: 'IDLE', idleReason: 'ERROR' }] }).motivoParada, 'ERROR');
  assert.equal(c.lerStatusMidia({ type: 'MEDIA_STATUS', status: [] }).estado, 'IDLE');
  assert.equal(c.lerStatusMidia({ type: 'PONG' }), null);
  assert.deepEqual(c.lerStatusReceptor({ type: 'RECEIVER_STATUS', status: { applications: [{ appId: 'E8C28D3C' }, { appId: 'CC1AD845', transportId: 'web-9' }], volume: { level: 0.3 } } }),
    { transporte: 'web-9', volume: 30 });
  assert.deepEqual(c.lerStatusReceptor({ type: 'RECEIVER_STATUS', status: {} }), { transporte: null, volume: undefined });
});
