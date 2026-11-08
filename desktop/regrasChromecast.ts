// Protocolo do Chromecast (CASTV2) sem biblioteca, pro app do Windows (W5): testado em regrasChromecast.test.cjs.
// A conversa com o aparelho é TLS na porta 8009; cada mensagem = 4 bytes de tamanho (big-endian) + um CastMessage em
// protobuf. O CastMessage só tem 7 campos (cast_channel.proto do Chromium), então o protobuf vai à mão:
//   1 protocol_version (varint, 0 = CASTV2_1_0) · 2 source_id · 3 destination_id · 4 namespace (strings)
//   5 payload_type (varint, 0 = STRING) · 6 payload_utf8 (string, JSON) · 7 payload_binary (bytes, não usado)
// O resto é JSON: CONNECT no canal, PING/PONG a cada 5 s, LAUNCH do Default Media Receiver (CC1AD845), LOAD da mídia
// com a URL do proxy (como o loadOnCast do PlayerActivity.java) e PLAY/PAUSE/SEEK/STOP/GET_STATUS.

export const NS_CONEXAO = 'urn:x-cast:com.google.cast.tp.connection';
export const NS_BATIDA = 'urn:x-cast:com.google.cast.tp.heartbeat';
export const NS_RECEPTOR = 'urn:x-cast:com.google.cast.receiver';
export const NS_MIDIA = 'urn:x-cast:com.google.cast.media';
export const APP_PADRAO = 'CC1AD845';   // Default Media Receiver
export const EMISSOR = 'sender-0';
export const RECEPTOR = 'receiver-0';

export interface Mensagem { origem: string; destino: string; ns: string; dados: Record<string, unknown> }

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return out;
}

function campoTexto(numero: number, texto: string): number[] {
  const b = Buffer.from(texto, 'utf8');
  return [...varint((numero << 3) | 2), ...varint(b.length), ...b];
}

/** Mensagem → quadro pronto pro socket (tamanho + protobuf). */
export function codificar(m: Mensagem): Buffer {
  const corpo = Buffer.from([
    ...varint((1 << 3) | 0), 0,                     // protocol_version = CASTV2_1_0
    ...campoTexto(2, m.origem),
    ...campoTexto(3, m.destino),
    ...campoTexto(4, m.ns),
    ...varint((5 << 3) | 0), 0,                     // payload_type = STRING
    ...campoTexto(6, JSON.stringify(m.dados)),
  ]);
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(corpo.length, 0);
  return Buffer.concat([tamanho, corpo]);
}

function lerVarint(b: Buffer, i: number): [number, number] {
  let v = 0, desloc = 0, p = i;
  for (;;) {
    if (p >= b.length) throw new Error('varint cortado');
    const x = b[p++];
    v += (x & 0x7f) * 2 ** desloc;
    if (!(x & 0x80)) break;
    desloc += 7;
    if (desloc > 49) throw new Error('varint grande demais');
  }
  return [v, p];
}

/** Protobuf de UM CastMessage → mensagem. payload_binary e campos desconhecidos são pulados. */
export function decodificarCorpo(b: Buffer): Mensagem {
  const m: Mensagem = { origem: '', destino: '', ns: '', dados: {} };
  let i = 0;
  while (i < b.length) {
    const [chave, j] = lerVarint(b, i); i = j;
    const numero = Math.floor(chave / 8), tipo = chave & 7;
    if (tipo === 0) { const [, k] = lerVarint(b, i); i = k; continue; }
    if (tipo === 2) {
      const [tam, k] = lerVarint(b, i); i = k;
      if (i + tam > b.length) throw new Error('campo cortado');
      const v = b.subarray(i, i + tam); i += tam;
      if (numero === 2) m.origem = v.toString('utf8');
      else if (numero === 3) m.destino = v.toString('utf8');
      else if (numero === 4) m.ns = v.toString('utf8');
      else if (numero === 6) { try { m.dados = JSON.parse(v.toString('utf8')); } catch { m.dados = {}; } }
      continue;
    }
    if (tipo === 5) { i += 4; continue; }
    if (tipo === 1) { i += 8; continue; }
    throw new Error(`tipo de campo ${tipo} não suportado`);
  }
  return m;
}

/** Junta os pedaços que chegam do socket e devolve as mensagens completas (o resto fica pra próxima). */
export class Leitor {
  private resto = Buffer.alloc(0);
  empurrar(pedaco: Buffer): Mensagem[] {
    this.resto = Buffer.concat([this.resto, pedaco]);
    const out: Mensagem[] = [];
    while (this.resto.length >= 4) {
      const tam = this.resto.readUInt32BE(0);
      if (tam > 64 * 1024) throw new Error(`mensagem de ${tam} bytes: não é Chromecast`);
      if (this.resto.length < 4 + tam) break;
      out.push(decodificarCorpo(this.resto.subarray(4, 4 + tam)));
      this.resto = this.resto.subarray(4 + tam);
    }
    return out;
  }
}

/** LOAD da mídia (= MediaInfo do loadOnCast): BUFFERED, autoplay, começa de onde o PC estava; HLS com o formato dos
 *  pedaços (o Default Media Receiver fica com a tela preta se vier errado). */
export function pedidoLoad(o: { url: string; hls: boolean; formato?: 'ts' | 'fmp4'; titulo: string; posicaoMs: number; requestId: number; capa?: string }) {
  const media: Record<string, unknown> = {
    contentId: o.url,
    contentType: o.hls ? 'application/x-mpegURL' : 'video/mp4',
    streamType: 'BUFFERED',
    metadata: { metadataType: 0, title: o.titulo || 'WatchMov', ...(o.capa ? { images: [{ url: o.capa }] } : {}) },
  };
  if (o.hls) {
    media.hlsSegmentFormat = o.formato === 'fmp4' ? 'fmp4' : 'ts';
    media.hlsVideoSegmentFormat = o.formato === 'fmp4' ? 'fmp4' : 'mpeg2_ts';
  }
  return { type: 'LOAD', requestId: o.requestId, media, autoplay: true, currentTime: Math.max(0, o.posicaoMs / 1000) };
}

export interface EstadoMidia { sessao: number | null; estado: string; posicaoMs: number; duracaoMs: number; motivoParada?: string; volume?: number }

/** MEDIA_STATUS → sessão da mídia, PLAYING/PAUSED/BUFFERING/IDLE, posição e duração; IDLE com idleReason ERROR = o
 *  aparelho não conseguiu tocar (formato/rede). */
export function lerStatusMidia(dados: Record<string, unknown>): EstadoMidia | null {
  if (dados.type !== 'MEDIA_STATUS') return null;
  const s = (Array.isArray(dados.status) ? dados.status[0] : null) as Record<string, unknown> | null;
  if (!s) return { sessao: null, estado: 'IDLE', posicaoMs: 0, duracaoMs: 0 };
  const media = (s.media ?? {}) as Record<string, unknown>;
  const vol = (s.volume ?? {}) as Record<string, unknown>;
  return {
    sessao: typeof s.mediaSessionId === 'number' ? s.mediaSessionId : null,
    estado: String(s.playerState ?? 'IDLE'),
    posicaoMs: Math.round(Number(s.currentTime ?? 0) * 1000),
    duracaoMs: Math.round(Number(media.duration ?? 0) * 1000),
    motivoParada: s.idleReason ? String(s.idleReason) : undefined,
    volume: typeof vol.level === 'number' ? Math.round(vol.level * 100) : undefined,
  };
}

/** RECEIVER_STATUS → o canal (transportId) do Default Media Receiver aberto, e o volume do aparelho. */
export function lerStatusReceptor(dados: Record<string, unknown>): { transporte: string | null; volume?: number } | null {
  if (dados.type !== 'RECEIVER_STATUS') return null;
  const st = (dados.status ?? {}) as Record<string, unknown>;
  const apps = Array.isArray(st.applications) ? (st.applications as Record<string, unknown>[]) : [];
  const app = apps.find((a) => a.appId === APP_PADRAO);
  const vol = (st.volume ?? {}) as Record<string, unknown>;
  return { transporte: app && typeof app.transportId === 'string' ? app.transportId : null, volume: typeof vol.level === 'number' ? Math.round(vol.level * 100) : undefined };
}
