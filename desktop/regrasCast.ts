// Regras do "mandar pra TV" do app do Windows (W5), sem Electron: testadas em regrasCast.test.cjs (npm run testar).
// Mesmo caminho do APK (DlnaCastPlugin.java, ProxyServer.java e o loadOnCast do PlayerActivity.java):
//   · a TV não alcança o link da fonte sozinha (Referer/token, gzip, HLS com várias faixas) → ela busca o vídeo no
//     PC, por um proxy na rede da casa (cast.ts), que refaz o pedido com os cabeçalhos do link e reescreve o HLS;
//   · DLNA: SSDP (M-SEARCH) acha as TVs, o XML da TV dá o endereço de controle, e o SOAP manda tocar/pausar/buscar;
//   · Chromecast: mDNS (_googlecast._tcp) acha, o Default Media Receiver toca a URL do proxy.

import { atributos } from './regrasDownload';

// ---------------------------------------------------------------------------------------------------------------
// SSDP / descrição da TV (= DlnaCastPlugin.discoverSync + describe)

export const SSDP_ENDERECO = '239.255.255.250';
export const SSDP_PORTA = 1900;
export const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
export const RCS = 'urn:schemas-upnp-org:service:RenderingControl:1';
/** Nem toda TV responde ao tipo específico: o APK pergunta por estes quatro, duas vezes, por multicast E broadcast. */
export const ALVOS_SSDP = ['ssdp:all', 'urn:schemas-upnp-org:device:MediaRenderer:1', AVT, 'upnp:rootdevice'];

export function mSearch(st: string): string {
  return `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ENDERECO}:${SSDP_PORTA}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`;
}

/** Resposta (ou NOTIFY) do SSDP → o endereço do XML da TV. null = sem LOCATION http(s). */
export function locationDaResposta(texto: string): string | null {
  const m = /^LOCATION:\s*(\S+)\s*$/im.exec(texto);
  return m && /^https?:\/\//i.test(m[1]) ? m[1] : null;
}

export interface Tv { nome: string; controle: string; render?: string; location: string; ip: string }

const tag = (xml: string, nome: string): string | null => {
  const m = new RegExp(`<(?:[\\w-]+:)?${nome}>([\\s\\S]*?)</(?:[\\w-]+:)?${nome}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
};

const desescapar = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** XML da TV → nome e endereços de controle (AVTransport obrigatório; RenderingControl = volume). null = não toca vídeo. */
export function lerDescricao(xml: string, location: string): Tv | null {
  if (!/AVTransport/i.test(xml)) return null;
  let controle: string | undefined;
  let render: string | undefined;
  for (const bloco of xml.split(/<service>/i).slice(1)) {
    const url = tag(bloco, 'controlURL');
    if (!url) continue;
    if (!controle && /AVTransport/i.test(bloco)) controle = new URL(desescapar(url), location).toString();
    else if (!render && /RenderingControl/i.test(bloco)) render = new URL(desescapar(url), location).toString();
  }
  if (!controle) return null;
  const nome = desescapar(tag(xml, 'friendlyName') || 'TV');
  return { nome, controle, render, location, ip: new URL(location).hostname };
}

// ---------------------------------------------------------------------------------------------------------------
// SOAP (= DlnaCastPlugin.castSync / controlSync / seekSync / getPositionSync)

export const escXml = (s: string | undefined | null): string =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** protocolInfo que a LG e a Samsung aceitam (sem ele a TV ignora o SetAVTransportURI). OP=01 = busca por bytes. */
export const PROTOCOLO_DLNA = 'http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';

export function didl(url: string, titulo: string): string {
  return '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
    + 'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1">'
    + `<dc:title>${escXml(titulo)}</dc:title><res protocolInfo="${PROTOCOLO_DLNA}">${escXml(url)}</res>`
    + '<upnp:class>object.item.videoItem</upnp:class></item></DIDL-Lite>';
}

export function envelope(servico: string, acao: string, interno: string): string {
  return '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
    + 's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
    + `<u:${acao} xmlns:u="${servico}">${interno}</u:${acao}></s:Body></s:Envelope>`;
}

/** SetAVTransportURI: o DIDL vai escapado DE NOVO dentro do CurrentURIMetaData (escape duplo, como no APK: com escape
 *  simples a TV desescapa uma vez, sobra `&` cru no DIDL de dentro e ela responde "Invalid Args" (402)). */
export function pedidoSetUri(url: string, titulo: string): string {
  return envelope(AVT, 'SetAVTransportURI',
    `<InstanceID>0</InstanceID><CurrentURI>${escXml(url)}</CurrentURI><CurrentURIMetaData>${escXml(didl(url, titulo))}</CurrentURIMetaData>`);
}

export type AcaoTv = 'Play' | 'Pause' | 'Stop';
export const pedidoAcao = (acao: AcaoTv): string =>
  envelope(AVT, acao, acao === 'Play' ? '<InstanceID>0</InstanceID><Speed>1</Speed>' : '<InstanceID>0</InstanceID>');
export const pedidoBuscar = (ms: number): string =>
  envelope(AVT, 'Seek', `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${hms(ms)}</Target>`);
export const pedidoPosicao = (): string => envelope(AVT, 'GetPositionInfo', '<InstanceID>0</InstanceID>');
export const pedidoTransporte = (): string => envelope(AVT, 'GetTransportInfo', '<InstanceID>0</InstanceID>');
export const pedidoVolume = (vol: number): string =>
  envelope(RCS, 'SetVolume', `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${Math.max(0, Math.min(100, Math.round(vol)))}</DesiredVolume>`);
export const pedidoLerVolume = (): string => envelope(RCS, 'GetVolume', '<InstanceID>0</InstanceID><Channel>Master</Channel>');
export const acaoSoap = (servico: string, acao: string): string => `"${servico}#${acao}"`;

/** 3723000 → "1:02:03" (o REL_TIME da TV). */
export function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** "1:02:03" / "01:02:03.500" → ms. "NOT_IMPLEMENTED" ou vazio → 0. */
export function lerTempo(t: string | null | undefined): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec((t ?? '').trim());
  if (!m) return 0;
  return ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000) + (m[4] ? Math.round(+`0.${m[4]}` * 1000) : 0);
}

/** Resposta do GetPositionInfo → posição e duração (ms). A TV às vezes manda a duração errada: quem decide é o cast.ts. */
export function lerPosicao(xml: string): { posicaoMs: number; duracaoMs: number; uri: string } {
  return { posicaoMs: lerTempo(tag(xml, 'RelTime')), duracaoMs: lerTempo(tag(xml, 'TrackDuration')), uri: desescapar(tag(xml, 'TrackURI') ?? '') };
}

/** Resposta do GetTransportInfo → PLAYING / PAUSED_PLAYBACK / STOPPED / TRANSITIONING / NO_MEDIA_PRESENT. */
export const lerEstado = (xml: string): string => (tag(xml, 'CurrentTransportState') ?? '').toUpperCase();

// Continuar na TV de onde o PC estava (= PlayerActivity.seekWithRetry do APK). Um Seek logo depois do Play é recusado
// ou ignorado em várias TVs (ainda estão abrindo o vídeo) e a TV começava do zero com o celular em 47:59.
/** Só vale continuar passado o começo (igual ao APK: abaixo disso a TV começa do zero mesmo). */
export const CONTINUAR_A_PARTIR_MS = 5000;
/** A TV já abriu o vídeo: antes disso o Seek é recusado ou ignorado. */
export const tvAbriuOVideo = (estado: string): boolean => estado === 'PLAYING' || estado === 'PAUSED_PLAYBACK';
/** O Seek "pegou": a posição que a TV informa ficou a menos de 20 s do alvo (a TV arredonda e ainda carrega). */
export const chegouNoAlvo = (posicaoMs: number, alvoMs: number): boolean => Math.abs(posicaoMs - alvoMs) < 20000;

export const lerVolume = (xml: string): number | null => {
  const v = tag(xml, 'CurrentVolume');
  return v !== null && /^\d+$/.test(v) ? +v : null;
};

/** Erro do SOAP (HTTP 500 com <UPnPError>) → texto curto pro aviso ("701 Transition not available"). */
export function erroSoap(xml: string): string | null {
  const codigo = tag(xml, 'errorCode');
  if (!codigo) return null;
  const desc = tag(xml, 'errorDescription');
  return desc ? `${codigo} ${desc}` : codigo;
}

// ---------------------------------------------------------------------------------------------------------------
// Proxy na rede da casa (= ProxyServer.lan + rewrite)

/** Endereço que a TV pede ao PC. `token` = segredo da sessão do app (sem ele o proxy não responde: só quem recebeu o
 *  link do app usa). `q` = altura escolhida (0 = a maior). */
export function urlDoProxy(base: string, url: string, referer: string | undefined, q = 0): string {
  const p = new URLSearchParams({ u: url, r: referer ?? '', ap: 'pt' });
  if (q > 0) p.set('q', String(q));
  return `${base}/s?${p.toString()}`;
}

const PT_AUDIO = /TYPE=AUDIO[^\n]*(LANGUAGE="(pt|por|pt-br)|NAME="[^"]*(portug|português|brasil|dub))/i;

/** Variante que a TV recebe: a TV não troca de qualidade sozinha (pegava a 1ª do master, às vezes a 360p). Com `q`,
 *  a mais alta até `q` (senão a mais baixa); sem, a mais alta. Empate de altura: a de mais banda. */
export function varianteDaTv(variantes: { altura: number; banda: number }[], q = 0): number {
  if (!variantes.length) return -1;
  let melhor = -1;
  variantes.forEach((v, i) => {
    if (q > 0 && v.altura > q) return;
    const b = melhor >= 0 ? variantes[melhor] : null;
    if (!b || v.altura > b.altura || (v.altura === b.altura && v.banda > b.banda)) melhor = i;
  });
  if (melhor >= 0) return melhor;
  // tudo acima de q: a menor
  return variantes.reduce((m, v, i, a) => (v.altura < a[m].altura ? i : m), 0);
}

/** Reescreve o HLS pra TV: todo endereço (pedaço, lista, chave, init) passa pelo proxy; no master fica UMA variante,
 *  sai o I-FRAME, e, quando existe áudio em português, só ele fica (as TVs DLNA ignoram a faixa alternativa e tocavam
 *  o inglês) marcado como padrão. */
export function reescreverParaTv(texto: string, base: string, proxiar: (absoluta: string) => string, q = 0): string {
  const linhas = texto.split(/\r?\n/);
  const temPt = PT_AUDIO.test(texto);
  const variantes: { linha: number; altura: number; banda: number }[] = [];
  linhas.forEach((l, i) => {
    const t = l.trim();
    if (/^#EXT-X-STREAM-INF:/i.test(t)) {
      const a = atributos(t.slice(t.indexOf(':') + 1));
      const res = /(\d+)x(\d+)/.exec(a.RESOLUTION ?? '');
      variantes.push({ linha: i, altura: res ? +res[2] : 0, banda: +(a.BANDWIDTH ?? 0) || 0 });
    }
  });
  const fica = variantes.length ? variantes[varianteDaTv(variantes, q)].linha : -1;
  const abs = (u: string): string => { try { return new URL(u, base).toString(); } catch { return u; } };
  const out: string[] = [];
  let pularUri = false;
  linhas.forEach((l, i) => {
    const t = l.trim();
    if (!t) { out.push(l); return; }
    if (t.startsWith('#')) {
      if (/^#EXT-X-I-FRAME-STREAM-INF/i.test(t)) return;
      if (/^#EXT-X-STREAM-INF/i.test(t) && fica >= 0 && i !== fica) { pularUri = true; return; }
      const audio = /^#EXT-X-MEDIA:/i.test(t) && /TYPE=AUDIO/i.test(t);
      if (audio && temPt && !PT_AUDIO.test(t)) return;
      let nova = t.replace(/URI="([^"]+)"/i, (_x, u: string) => `URI="${proxiar(abs(u))}"`);
      if (audio && temPt) {
        nova = /DEFAULT=(YES|NO)/i.test(nova) ? nova.replace(/DEFAULT=(YES|NO)/i, 'DEFAULT=YES') : `${nova},DEFAULT=YES`;
        nova = /AUTOSELECT=(YES|NO)/i.test(nova) ? nova.replace(/AUTOSELECT=(YES|NO)/i, 'AUTOSELECT=YES') : `${nova},AUTOSELECT=YES`;
      }
      out.push(nova);
      return;
    }
    if (pularUri) { pularUri = false; return; }
    out.push(proxiar(abs(t)));
  });
  return out.join('\n');
}

/** TS ou fMP4 (o Default Media Receiver do Chromecast fica com a tela preta se o formato vier errado). */
export const formatoDosPedacos = (lista: string): 'fmp4' | 'ts' =>
  /#EXT-X-MAP|\.m4s(\?|$)|\.mp4(\?|$)/im.test(lista) ? 'fmp4' : 'ts';

/** contentType do LOAD do Chromecast. */
export const tipoParaTv = (hls: boolean): string => (hls ? 'application/x-mpegURL' : 'video/mp4');

// ---------------------------------------------------------------------------------------------------------------
// IP do PC na rede da casa (a TV busca o vídeo nele)

export interface Interface { nome: string; endereco: string; familia: string | number; interna: boolean }

const PRIVADO = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|tailscale|zerotier|loopback|vpn|tap|tun|bluetooth/i;

/** O IPv4 privado da placa de verdade (Wi-Fi/Ethernet), fora as virtuais (WSL, VirtualBox, Tailscale…). */
export function ipDaCasa(interfaces: Interface[]): string | null {
  const ok = interfaces.filter((i) => (i.familia === 'IPv4' || i.familia === 4) && !i.interna && PRIVADO.test(i.endereco));
  const reais = ok.filter((i) => !VIRTUAL.test(i.nome));
  const ordem = (i: Interface): number => (/wi-?fi|wlan|wireless/i.test(i.nome) ? 0 : /ethernet|eth|en\d/i.test(i.nome) ? 1 : 2);
  const lista = (reais.length ? reais : ok).sort((a, b) => ordem(a) - ordem(b) || (a.endereco.startsWith('192.168.') ? -1 : 1));
  return lista[0]?.endereco ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Chromecast (mDNS)

/** TXT do _googlecast._tcp ("fn=Sala", "md=Chromecast") → nome pra lista. */
export function nomeDoChromecast(txt: string[]): string {
  const campos = Object.fromEntries(txt.map((t) => { const k = t.indexOf('='); return k > 0 ? [t.slice(0, k), t.slice(k + 1)] : [t, '']; }));
  return campos.fn || campos.md || 'Chromecast';
}
