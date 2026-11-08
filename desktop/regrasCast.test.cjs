// Testes das regras do "mandar pra TV" do app do Windows (regrasCast.ts, compilado em out/). Rodar: npm run testar.
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./out/regrasCast.js');

test('M-SEARCH no formato do APK e LOCATION da resposta', () => {
  const m = r.mSearch('urn:schemas-upnp-org:device:MediaRenderer:1');
  assert.match(m, /^M-SEARCH \* HTTP\/1\.1\r\n/);
  assert.match(m, /HOST: 239\.255\.255\.250:1900\r\n/);
  assert.match(m, /MAN: "ssdp:discover"\r\n/);
  assert.match(m, /ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n$/);
  assert.equal(r.locationDaResposta('HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nlocation: http://192.168.31.40:1393/desc.xml\r\nST: upnp:rootdevice\r\n\r\n'), 'http://192.168.31.40:1393/desc.xml');
  assert.equal(r.locationDaResposta('HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\n\r\n'), null);
  assert.equal(r.locationDaResposta('LOCATION: file:///etc/passwd\r\n'), null);
});

const DESC = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>
<deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>[LG] webOS TV &amp; Sala</friendlyName>
<serviceList>
<service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><controlURL>/cm/control</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/AVTransport/control?a=1&amp;b=2</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>http://192.168.31.40:1393/rc</controlURL></service>
</serviceList></device></root>`;

test('descrição da TV: nome, controle do AVTransport (relativo → absoluto) e do volume', () => {
  const tv = r.lerDescricao(DESC, 'http://192.168.31.40:1393/desc.xml');
  assert.deepEqual(tv, {
    nome: '[LG] webOS TV & Sala',
    controle: 'http://192.168.31.40:1393/AVTransport/control?a=1&b=2',
    render: 'http://192.168.31.40:1393/rc',
    location: 'http://192.168.31.40:1393/desc.xml',
    ip: '192.168.31.40',
  });
  assert.equal(r.lerDescricao('<root><friendlyName>Impressora</friendlyName></root>', 'http://1.2.3.4/x.xml'), null, 'sem AVTransport não é TV');
});

test('SetAVTransportURI com protocolInfo e escape duplo do DIDL', () => {
  const url = 'http://192.168.31.10:8099/t/abc/s?u=https%3A%2F%2Fcdn.x%2Fa.m3u8&r=&ap=pt';
  const env = r.pedidoSetUri(url, 'Filme <1> & 2');
  assert.match(env, /<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">/);
  assert.ok(env.includes(`<CurrentURI>${url.replace(/&/g, '&amp;')}</CurrentURI>`));
  // dentro do metadata: o DIDL inteiro escapado de novo (o & da URL vira &amp;amp;)
  assert.ok(env.includes('&lt;res protocolInfo=&quot;http-get:*:video/mp4:DLNA.ORG_OP=01;'));
  assert.ok(env.includes('ap=pt'.replace('ap', 'r=&amp;amp;ap')));
  assert.ok(env.includes('Filme &amp;lt;1&amp;gt; &amp;amp; 2'));
  assert.equal(r.acaoSoap(r.AVT, 'Play'), '"urn:schemas-upnp-org:service:AVTransport:1#Play"');
});

test('Play/Pause/Stop/Seek/volume', () => {
  assert.match(r.pedidoAcao('Play'), /<u:Play [^>]+><InstanceID>0<\/InstanceID><Speed>1<\/Speed><\/u:Play>/);
  assert.match(r.pedidoAcao('Pause'), /<u:Pause [^>]+><InstanceID>0<\/InstanceID><\/u:Pause>/);
  assert.match(r.pedidoBuscar(3723000), /<Unit>REL_TIME<\/Unit><Target>1:02:03<\/Target>/);
  assert.match(r.pedidoVolume(140), /RenderingControl:1"><InstanceID>0<\/InstanceID><Channel>Master<\/Channel><DesiredVolume>100<\/DesiredVolume>/);
  assert.match(r.pedidoVolume(-3), /<DesiredVolume>0<\/DesiredVolume>/);
});

test('tempo da TV: hms e lerTempo (com fração e lixo)', () => {
  assert.equal(r.hms(0), '0:00:00');
  assert.equal(r.hms(59999), '0:00:59');
  assert.equal(r.hms(3723000), '1:02:03');
  assert.equal(r.lerTempo('1:02:03'), 3723000);
  assert.equal(r.lerTempo('01:02:03.500'), 3723500);
  assert.equal(r.lerTempo('NOT_IMPLEMENTED'), 0);
  assert.equal(r.lerTempo(null), 0);
});

test('respostas da TV: posição, estado, volume e erro', () => {
  const pos = '<s:Envelope><s:Body><u:GetPositionInfoResponse><Track>1</Track><TrackDuration>0:52:10</TrackDuration>'
    + '<TrackURI>http://192.168.31.10:8099/s?u=a&amp;r=b</TrackURI><RelTime>0:10:05</RelTime></u:GetPositionInfoResponse></s:Body></s:Envelope>';
  assert.deepEqual(r.lerPosicao(pos), { posicaoMs: 605000, duracaoMs: 3130000, uri: 'http://192.168.31.10:8099/s?u=a&r=b' });
  assert.equal(r.lerEstado('<CurrentTransportState>PAUSED_PLAYBACK</CurrentTransportState>'), 'PAUSED_PLAYBACK');
  assert.equal(r.lerVolume('<CurrentVolume>17</CurrentVolume>'), 17);
  assert.equal(r.lerVolume('<CurrentVolume></CurrentVolume>'), null);
  assert.equal(r.erroSoap('<UPnPError><errorCode>701</errorCode><errorDescription>Transition not available</errorDescription></UPnPError>'), '701 Transition not available');
  assert.equal(r.erroSoap('<ok/>'), null);
});

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Português",LANGUAGE="pt-BR",DEFAULT=NO,URI="audio/pt.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud"
360/index.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=90000,URI="iframes.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO="aud"
https://cdn.y/720/index.m3u8?token=a,b
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="aud"
1080/index.m3u8
`;
const px = (u) => `/s?u=${encodeURIComponent(u)}`;

test('master pra TV: uma variante (a maior), sem I-FRAME, só o áudio em português como padrão', () => {
  const out = r.reescreverParaTv(MASTER, 'https://cdn.x/f/master.m3u8', px);
  const linhas = out.split('\n').filter(Boolean);
  assert.equal(linhas.filter((l) => l.startsWith('#EXT-X-STREAM-INF')).length, 1);
  assert.ok(out.includes('RESOLUTION=1920x1080'));
  assert.ok(out.includes(px('https://cdn.x/f/1080/index.m3u8')));
  assert.ok(!out.includes('360/index') && !out.includes('cdn.y') && !out.includes('I-FRAME'));
  assert.ok(!out.includes('English'));
  assert.match(out, /LANGUAGE="pt-BR",DEFAULT=YES,URI="\/s\?u=https%3A%2F%2Fcdn\.x%2Ff%2Faudio%2Fpt\.m3u8",AUTOSELECT=YES/);
});

test('master pra TV com qualidade escolhida (q=720) e sem português (fica tudo, endereços pelo proxy)', () => {
  const out = r.reescreverParaTv(MASTER, 'https://cdn.x/f/master.m3u8', px, 720);
  assert.ok(out.includes('RESOLUTION=1280x720') && !out.includes('1920x1080'));
  assert.ok(out.includes(px('https://cdn.y/720/index.m3u8?token=a,b')));
  const semPt = MASTER.replace(/^#EXT-X-MEDIA:.*Português.*$/m, '');
  const out2 = r.reescreverParaTv(semPt, 'https://cdn.x/f/master.m3u8', px);
  assert.ok(out2.includes('English') && out2.includes('DEFAULT=YES'));
});

test('lista de pedaços: pedaço, chave e init pelo proxy (relativo → absoluto)', () => {
  const lista = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg1.m4s\n#EXTINF:4,\nhttps://o.x/seg2.m4s\n#EXT-X-ENDLIST';
  const out = r.reescreverParaTv(lista, 'https://cdn.x/f/v/index.m3u8', px);
  assert.ok(out.includes(`URI="${px('https://cdn.x/f/v/key.bin')}",IV=0x1`));
  assert.ok(out.includes(`URI="${px('https://cdn.x/f/v/init.mp4')}"`));
  assert.ok(out.includes(px('https://cdn.x/f/v/seg1.m4s')) && out.includes(px('https://o.x/seg2.m4s')));
  assert.ok(out.endsWith('#EXT-X-ENDLIST'));
  assert.equal(r.formatoDosPedacos(lista), 'fmp4');
  assert.equal(r.formatoDosPedacos('#EXTM3U\n#EXTINF:4,\na.ts\n'), 'ts');
});

test('variante da TV: a maior até q; tudo acima de q → a menor; empate → mais banda', () => {
  const v = [{ altura: 360, banda: 1 }, { altura: 720, banda: 2 }, { altura: 720, banda: 3 }, { altura: 1080, banda: 4 }];
  assert.equal(r.varianteDaTv(v), 3);
  assert.equal(r.varianteDaTv(v, 720), 2);
  assert.equal(r.varianteDaTv(v, 240), 0);
  assert.equal(r.varianteDaTv([]), -1);
});

test('URL do proxy com o link, o referer, ap=pt e a qualidade', () => {
  const u = new URL(r.urlDoProxy('http://192.168.31.10:8099/t/abc', 'https://cdn.x/a.m3u8?x=1&y=2', 'https://fonte.x/', 720));
  assert.equal(u.pathname, '/t/abc/s');
  assert.equal(u.searchParams.get('u'), 'https://cdn.x/a.m3u8?x=1&y=2');
  assert.equal(u.searchParams.get('r'), 'https://fonte.x/');
  assert.equal(u.searchParams.get('ap'), 'pt');
  assert.equal(u.searchParams.get('q'), '720');
  assert.equal(new URL(r.urlDoProxy('http://h:1/t/x', 'https://a/b', undefined)).searchParams.has('q'), false);
});

test('IP do PC na rede da casa: placa de verdade, fora WSL/VirtualBox/Tailscale', () => {
  const ifs = [
    { nome: 'vEthernet (WSL)', endereco: '172.22.208.1', familia: 'IPv4', interna: false },
    { nome: 'Tailscale', endereco: '100.64.1.2', familia: 'IPv4', interna: false },
    { nome: 'VirtualBox Host-Only Network', endereco: '192.168.56.1', familia: 'IPv4', interna: false },
    { nome: 'Loopback Pseudo-Interface 1', endereco: '127.0.0.1', familia: 'IPv4', interna: true },
    { nome: 'Wi-Fi', endereco: '192.168.31.10', familia: 'IPv4', interna: false },
    { nome: 'Wi-Fi', endereco: 'fe80::1', familia: 'IPv6', interna: false },
  ];
  assert.equal(r.ipDaCasa(ifs), '192.168.31.10');
  assert.equal(r.ipDaCasa([{ nome: 'Ethernet', endereco: '10.1.0.5', familia: 4, interna: false }]), '10.1.0.5');
  assert.equal(r.ipDaCasa([ifs[0]]), '172.22.208.1', 'só a virtual: usa ela (melhor que nada)');
  assert.equal(r.ipDaCasa([]), null);
});

test('nome do Chromecast pelo TXT do mDNS e tipo do LOAD', () => {
  assert.equal(r.nomeDoChromecast(['id=abc', 'md=Chromecast', 'fn=Sala de estar']), 'Sala de estar');
  assert.equal(r.nomeDoChromecast(['md=Google TV']), 'Google TV');
  assert.equal(r.nomeDoChromecast([]), 'Chromecast');
  assert.equal(r.tipoParaTv(true), 'application/x-mpegURL');
  assert.equal(r.tipoParaTv(false), 'video/mp4');
});

test('continuar na TV de onde o PC estava: só depois que a TV abriu o vídeo e conferindo a posição', () => {
  assert.equal(r.CONTINUAR_A_PARTIR_MS, 5000);
  assert.equal(r.tvAbriuOVideo('PLAYING'), true);
  assert.equal(r.tvAbriuOVideo('PAUSED_PLAYBACK'), true);
  for (const e of ['TRANSITIONING', 'STOPPED', 'NO_MEDIA_PRESENT', '']) assert.equal(r.tvAbriuOVideo(e), false, e);
  assert.equal(r.chegouNoAlvo(2_879_000, 2_879_000), true);
  assert.equal(r.chegouNoAlvo(2_890_000, 2_879_000), true);    // a TV já andou uns segundos
  assert.equal(r.chegouNoAlvo(2_000, 2_879_000), false);       // começou do zero: o Seek não pegou
  assert.equal(r.chegouNoAlvo(2_900_000, 2_879_000), false);   // 21 s longe
});
