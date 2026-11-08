// Mandar pra TV no app do Windows (W5): o que o APK faz com o DlnaCastPlugin.java, o ProxyServer.java (lan/rewrite) e
// o Chromecast do PlayerActivity.java, no processo principal do Electron. As decisões ficam em regrasCast.ts e
// regrasChromecast.ts (testadas sem Electron).
//   · Proxy na rede da casa: a TV busca o vídeo no PC (http://<IP do PC>:8099/t/<segredo>/s?u=…). O app refaz o pedido
//     com os cabeçalhos do link (Referer/Origin/token, os mesmos do player), reescreve o HLS (uma qualidade, áudio em
//     português) e repassa faixas de bytes. O baixado da W4 sai do disco. Só responde quem tem o segredo da abertura.
//   · DLNA: SSDP acha as TVs; SOAP manda tocar, pausar, buscar, parar e o volume (= DlnaCastPlugin).
//   · Chromecast: mDNS acha; CASTV2 (TLS 8009) abre o Default Media Receiver e manda a URL do proxy (= loadOnCast).
//   · Espelhar: abre o Transmitir do Windows (Win+K).
import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import { Readable } from 'node:stream';
import tls from 'node:tls';
import { ipcMain, net, session, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { cabecalhosPara, origemDoFrame } from './rede';
import { refererDoPedido, trocarCabecalho } from './regras';
import { ehPlaylist, faixaDoPedido, pareceHls } from './regrasDownload';
import {
  ALVOS_SSDP, AVT, CONTINUAR_A_PARTIR_MS, RCS, SSDP_ENDERECO, SSDP_PORTA, acaoSoap, chegouNoAlvo, erroSoap, formatoDosPedacos, hms,
  ipDaCasa, lerDescricao, lerEstado, lerPosicao, lerVolume, locationDaResposta, mSearch, nomeDoChromecast, pedidoAcao, pedidoBuscar,
  pedidoLerVolume, pedidoPosicao, pedidoSetUri, pedidoTransporte, pedidoVolume, reescreverParaTv, tvAbriuOVideo, urlDoProxy,
  type Interface, type Tv,
} from './regrasCast';
import {
  APP_PADRAO, EMISSOR, Leitor, NS_BATIDA, NS_CONEXAO, NS_MIDIA, NS_RECEPTOR, RECEPTOR, codificar, lerStatusMidia, lerStatusReceptor,
  pedidoLoad, type EstadoMidia, type Mensagem,
} from './regrasChromecast';

const PORTA_PREFERIDA = 8099;   // a mesma do ProxyServer do APK; ocupada → qualquer uma livre
const SEGREDO = randomBytes(12).toString('base64url');
let janelaDoApp: () => BrowserWindow | null = () => null;
let arquivoDoBaixado: (chave: string) => string | null = () => null;

// ── proxy na rede da casa ───────────────────────────────────────────────────────────────────────────────────────────

let servidor: http.Server | null = null;
let porta = 0;

function interfaces(): Interface[] {
  const out: Interface[] = [];
  for (const [nome, lista] of Object.entries(os.networkInterfaces())) {
    for (const i of lista ?? []) out.push({ nome, endereco: i.address, familia: i.family, interna: i.internal });
  }
  return out;
}

async function ligarProxy(): Promise<void> {
  if (servidor) return;
  const s = http.createServer((req, res) => {
    atender(req, res).catch((e) => {
      console.warn('[wm] cast proxy:', e instanceof Error ? e.message : e);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end();
    });
  });
  await new Promise<void>((ok) => {
    s.once('error', () => s.listen(0, '0.0.0.0', () => ok()));
    s.listen(PORTA_PREFERIDA, '0.0.0.0', () => ok());
  });
  servidor = s;
  porta = (s.address() as AddressInfo).port;
  console.log(`[wm] cast: proxy na porta ${porta}`);
}

function baseDoProxy(): string | null {
  const ip = ipDaCasa(interfaces());
  return ip && porta ? `http://${ip}:${porta}/t/${SEGREDO}` : null;
}

const CORS = { 'Access-Control-Allow-Origin': '*' };
const REPASSAR = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

async function atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://pc');
  const prefixo = `/t/${SEGREDO}`;
  if (!u.pathname.startsWith(`${prefixo}/`)) { res.writeHead(404); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const resto = u.pathname.slice(prefixo.length);
  if (resto === '/s') return repassar(req, res, u.searchParams);
  const m = /^\/arquivo\/([^/]+)$/.exec(resto);
  if (m) return servirBaixado(req, res, decodeURIComponent(m[1]));
  res.writeHead(404); res.end();
}

/** Cabeçalhos do pedido à fonte: os do link (os mesmos do player) + o Referer na política que o Chromium aceita no
 *  processo principal (= downloads.ts: endereço inteiro pra outro site ou https → http = pedido CANCELADO,
 *  net::ERR_BLOCKED_BY_CLIENT) e sem Origin. */
function cabecalhosDaFonte(alvo: string, referer: string | undefined): Record<string, string> {
  const h: Record<string, string> = { ...cabecalhosPara(alvo) };
  let nomeRef = Object.keys(h).find((k) => k.toLowerCase() === 'referer');
  if (!nomeRef && referer) { h.Referer = referer; nomeRef = 'Referer'; }
  if (nomeRef) {
    const ref = refererDoPedido(h[nomeRef], alvo);
    if (ref) h[nomeRef] = ref; else delete h[nomeRef];
  }
  trocarCabecalho(h, 'Origin', null);
  if (!Object.keys(h).some((k) => k.toLowerCase() === 'user-agent')) h['User-Agent'] = session.defaultSession.getUserAgent();
  return h;
}

/** Pedido da TV → o mesmo pedido à fonte, com os cabeçalhos do link (= ProxyServer.serve do APK). */
async function repassar(req: http.IncomingMessage, res: http.ServerResponse, p: URLSearchParams): Promise<void> {
  const alvo = p.get('u') ?? '';
  const referer = p.get('r') || undefined;
  const q = Number(p.get('q') || 0) || 0;
  if (!/^https?:\/\//i.test(alvo)) { res.writeHead(400); res.end(); return; }
  const h = cabecalhosDaFonte(alvo, referer);
  // Lista HLS vai sempre inteira e reescrita (a LG pede até a lista com Range: bytes=0-); o resto repassa a faixa.
  const pareceLista = pareceHls(alvo, '') || /\.txt(\?|#|$)/i.test(alvo);
  if (req.headers.range && !pareceLista) h.Range = String(req.headers.range);
  const parar = new AbortController();
  req.on('close', () => parar.abort());
  const resp = await net.fetch(alvo, { headers: h, redirect: 'follow', signal: parar.signal });
  const tipo = resp.headers.get('content-type') ?? '';
  // Lista HLS (pelo tipo, pelo nome ou pelo começo do conteúdo, como o master.txt das fontes): reescrita pra TV. Lido em
  // bytes: se não for lista (pedaço disfarçado de texto), vai do jeito que veio, sem virar texto.
  if (/mpegurl/i.test(tipo) || pareceLista || /text\/plain/i.test(tipo)) {
    const bruto = Buffer.from(await resp.arrayBuffer());
    const texto = bruto.subarray(0, 64).toString('utf8');
    if (ehPlaylist(texto)) {
      const base = resp.url || alvo;
      const proxiar = (abs: string) => `/t/${SEGREDO}/s?${new URLSearchParams({ u: abs, r: referer ?? '' }).toString()}`;
      const corpo = Buffer.from(reescreverParaTv(bruto.toString('utf8'), base, proxiar, q), 'utf8');
      res.writeHead(resp.ok ? 200 : resp.status, { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache', 'Content-Length': String(corpo.length) });
      res.end(req.method === 'HEAD' ? undefined : corpo);
      return;
    }
    const cabBruto: Record<string, string> = { ...CORS, 'Content-Length': String(bruto.length) };
    for (const k of ['content-type', 'content-range', 'accept-ranges']) { const v = resp.headers.get(k); if (v) cabBruto[k] = v; }
    res.writeHead(resp.status, cabBruto);
    res.end(req.method === 'HEAD' ? undefined : bruto);
    return;
  }
  const cab: Record<string, string> = { ...CORS };
  const codificado = !!resp.headers.get('content-encoding');
  for (const k of REPASSAR) {
    const v = resp.headers.get(k);
    if (v && !(codificado && k === 'content-length')) cab[k] = v;
  }
  // Pedaço que a fonte disfarça de imagem (alguns CDNs mandam o .ts como image/png): a TV recusa → vídeo.
  if (/^image\//i.test(cab['content-type'] ?? '') && /\.(ts|m4s|mp4)(\?|$)/i.test(alvo)) cab['content-type'] = 'video/mp2t';
  if (resp.status === 206 && !cab['accept-ranges']) cab['accept-ranges'] = 'bytes';
  res.writeHead(resp.status, cab);
  if (req.method === 'HEAD' || !resp.body) { res.end(); return; }
  Readable.fromWeb(resp.body as unknown as import('node:stream/web').ReadableStream).pipe(res);
}

/** O baixado da W4 (Vídeos\WatchMov) pra TV, com faixas de bytes (a TV avança pedindo pedaços do arquivo). */
async function servirBaixado(req: http.IncomingMessage, res: http.ServerResponse, chave: string): Promise<void> {
  const arquivo = arquivoDoBaixado(chave);
  const st = arquivo ? await fs.promises.stat(arquivo).catch(() => null) : null;
  if (!arquivo || !st) { res.writeHead(404); res.end(); return; }
  const total = st.size;
  const faixa = faixaDoPedido(req.headers.range ? String(req.headers.range) : null, total);
  if (faixa === 'invalida') { res.writeHead(416, { ...CORS, 'Content-Range': `bytes */${total}` }); res.end(); return; }
  const inicio = faixa?.inicio ?? 0, fim = faixa?.fim ?? total - 1;
  res.writeHead(faixa ? 206 : 200, {
    ...CORS, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(fim - inicio + 1),
    ...(faixa ? { 'Content-Range': `bytes ${inicio}-${fim}/${total}` } : {}),
    // DLNA: a TV aceita avançar por bytes (OP=01), como no contentFeatures do APK
    'contentFeatures.dlna.org': 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000',
    'transferMode.dlna.org': 'Streaming',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(arquivo, { start: inicio, end: fim }).pipe(res);
}

// ── descoberta ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TvAchada { id: string; tipo: 'dlna' | 'chromecast'; nome: string; ip: string }
const dlnaAchadas = new Map<string, Tv>();
const ccAchados = new Map<string, { nome: string; ip: string; porta: number }>();

async function descrever(location: string): Promise<Tv | null> {
  try {
    const r = await net.fetch(location, { signal: AbortSignal.timeout(4000) });
    return r.ok ? lerDescricao(await r.text(), location) : null;
  } catch { return null; }
}

/** SSDP como o APK: 4 tipos, 2 rodadas, multicast E broadcast (roteador que bloqueia multicast), pela placa da casa. */
async function procurarDlna(ms: number): Promise<void> {
  const ip = ipDaCasa(interfaces());
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const vistos = new Set<string>();
  const descricoes: Promise<void>[] = [];
  sock.on('message', (msg) => {
    const loc = locationDaResposta(msg.toString('utf8'));
    if (!loc || vistos.has(loc)) return;
    vistos.add(loc);
    descricoes.push(descrever(loc).then((tv) => { if (tv) dlnaAchadas.set(tv.controle, tv); }));
  });
  sock.on('error', (e) => console.warn('[wm] cast ssdp:', e.message));
  await new Promise<void>((ok) => sock.bind({ port: 0, address: ip ?? undefined }, () => ok()));
  try { sock.setBroadcast(true); sock.setMulticastTTL(4); if (ip) sock.setMulticastInterface(ip); } catch { /* segue */ }
  // Teste (smoke): uma TV de mentira num endereço fixo, além do grupo (o runner do CI pode não ter o SSDP do Windows livre).
  const extra = (process.env.WM_SSDP_EXTRA ?? '').split(':');
  const destinos: Array<[string, number]> = [[SSDP_ENDERECO, SSDP_PORTA], ['255.255.255.255', SSDP_PORTA]];
  if (extra.length === 2 && extra[0] && Number(extra[1])) destinos.push([extra[0], Number(extra[1])]);
  for (let rodada = 0; rodada < 2; rodada++) {
    for (const st of ALVOS_SSDP) for (const [h, p] of destinos) sock.send(mSearch(st), p, h, () => undefined);
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, ms));
  try { sock.close(); } catch { /* já fechou */ }
  await Promise.race([Promise.allSettled(descricoes), new Promise((r) => setTimeout(r, 4000))]);
}

interface RegistroMdns { name: string; type: string; data?: unknown }
interface RespostaMdns { answers?: RegistroMdns[]; additionals?: RegistroMdns[] }
interface Mdns {
  on(evento: 'response', cb: (r: RespostaMdns) => void): void;
  on(evento: 'error', cb: (e: Error) => void): void;
  query(q: { questions: Array<{ name: string; type: string }> }): void;
  destroy(): void;
}

/** mDNS do Chromecast (_googlecast._tcp.local): pergunta PTR e lê SRV/TXT/A das respostas. */
async function procurarChromecast(ms: number): Promise<void> {
  // multicast-dns (MIT, JS puro). Falhou ao carregar ou ao abrir a porta 5353 (outro programa) → sem Chromecast, sem erro.
  let m: Mdns;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- carregado só aqui: falhou → segue sem Chromecast
    const criar = require('multicast-dns') as (o: Record<string, unknown>) => Mdns;
    const ip = ipDaCasa(interfaces());
    m = criar({ interface: ip ?? undefined, reuseAddr: true });
  } catch (e) { console.warn('[wm] cast mdns:', e instanceof Error ? e.message : e); return; }
  const servicos = new Map<string, { nome?: string; alvo?: string; porta?: number }>();
  const ips = new Map<string, string>();
  m.on('response', (resp: RespostaMdns) => {
    for (const r of [...(resp.answers ?? []), ...(resp.additionals ?? [])]) {
      if (r.type === 'PTR' && r.name === '_googlecast._tcp.local') servicos.set(String(r.data), servicos.get(String(r.data)) ?? {});
      else if (r.type === 'SRV') {
        const s = servicos.get(r.name) ?? {};
        const d = (r.data ?? {}) as { target?: string; port?: number };
        s.alvo = d.target; s.porta = d.port; servicos.set(r.name, s);
      } else if (r.type === 'TXT') {
        const s = servicos.get(r.name) ?? {};
        const txt = (Array.isArray(r.data) ? r.data : [r.data]).map((b) => String(b instanceof Buffer ? b.toString('utf8') : b));
        s.nome = nomeDoChromecast(txt); servicos.set(r.name, s);
      } else if (r.type === 'A') ips.set(r.name, String(r.data));
    }
  });
  m.on('error', (e: Error) => console.warn('[wm] cast mdns:', e.message));
  m.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] });
  setTimeout(() => m.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] }), 1000);
  await new Promise((r) => setTimeout(r, ms));
  m.destroy();
  for (const [inst, s] of servicos) {
    const ipCc = s.alvo ? ips.get(s.alvo) : undefined;
    if (ipCc) ccAchados.set(inst, { nome: s.nome ?? 'Chromecast', ip: ipCc, porta: s.porta ?? 8009 });
  }
}

async function procurar(): Promise<TvAchada[]> {
  dlnaAchadas.clear(); ccAchados.clear();
  await Promise.all([procurarDlna(4000), procurarChromecast(4000)]);
  const out: TvAchada[] = [];
  for (const [id, c] of ccAchados) out.push({ id: `cc:${id}`, tipo: 'chromecast', nome: c.nome, ip: c.ip });
  for (const [id, t] of dlnaAchadas) out.push({ id: `dlna:${id}`, tipo: 'dlna', nome: t.nome, ip: t.ip });
  console.log(`[wm] cast: ${out.length} TV(s): ${out.map((t) => `${t.nome}@${t.ip}`).join(', ') || 'nenhuma'}`);
  return out;
}

// ── DLNA ────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function soap(url: string, servico: string, acao: string, corpo: string, ms = 8000): Promise<string> {
  const r = await net.fetch(url, {
    method: 'POST', body: corpo, signal: AbortSignal.timeout(ms),
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: acaoSoap(servico, acao) },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${acao}: ${erroSoap(texto) ?? `HTTP ${r.status}`}`);
  return texto;
}

// ── Chromecast (CASTV2) ─────────────────────────────────────────────────────────────────────────────────────────────

class SessaoChromecast {
  private leitor = new Leitor();
  private pedidos = new Map<number, (d: Record<string, unknown>) => void>();
  private proximoId = 1;
  private batida: NodeJS.Timeout | null = null;
  transporte: string | null = null;
  sessaoMidia: number | null = null;
  ultimo: EstadoMidia | null = null;
  aoStatus: (e: EstadoMidia) => void = () => undefined;
  aoFechar: () => void = () => undefined;

  private constructor(private sock: tls.TLSSocket) {
    sock.on('data', (b: Buffer) => { try { for (const m of this.leitor.empurrar(b)) this.receber(m); } catch (e) { console.warn('[wm] chromecast:', e); sock.destroy(); } });
    sock.on('close', () => { if (this.batida) clearInterval(this.batida); this.aoFechar(); });
    sock.on('error', (e) => console.warn('[wm] chromecast:', e.message));
  }

  static conectar(ip: string, porta: number): Promise<SessaoChromecast> {
    return new Promise((ok, falha) => {
      // O Chromecast usa certificado próprio (sem cadeia pública): igual a todo emissor, sem conferir a cadeia.
      const sock = tls.connect({ host: ip, port: porta, rejectUnauthorized: false, timeout: 8000 }, () => {
        const s = new SessaoChromecast(sock);
        s.enviar(RECEPTOR, NS_CONEXAO, { type: 'CONNECT' });
        s.batida = setInterval(() => s.enviar(RECEPTOR, NS_BATIDA, { type: 'PING' }), 5000);
        ok(s);
      });
      sock.once('error', falha);
      sock.once('timeout', () => { sock.destroy(); falha(new Error('o Chromecast não respondeu')); });
    });
  }

  enviar(destino: string, ns: string, dados: Record<string, unknown>): void {
    this.sock.write(codificar({ origem: EMISSOR, destino, ns, dados }));
  }

  pedir(destino: string, ns: string, dados: Record<string, unknown>, ms = 10000): Promise<Record<string, unknown>> {
    const requestId = this.proximoId++;
    return new Promise((ok, falha) => {
      const t = setTimeout(() => { this.pedidos.delete(requestId); falha(new Error(`${String(dados.type)}: o Chromecast não respondeu`)); }, ms);
      this.pedidos.set(requestId, (d) => { clearTimeout(t); ok(d); });
      this.enviar(destino, ns, { ...dados, requestId });
    });
  }

  private receber(m: Mensagem): void {
    const d = m.dados;
    if (m.ns === NS_BATIDA && d.type === 'PING') { this.enviar(m.origem, NS_BATIDA, { type: 'PONG' }); return; }
    if (m.ns === NS_CONEXAO && d.type === 'CLOSE' && m.origem === this.transporte) { this.sock.destroy(); return; }
    const st = lerStatusMidia(d);
    if (st) { if (st.sessao !== null) this.sessaoMidia = st.sessao; this.ultimo = st; this.aoStatus(st); }
    const id = typeof d.requestId === 'number' ? d.requestId : 0;
    const cb = id ? this.pedidos.get(id) : undefined;
    if (cb) { this.pedidos.delete(id); cb(d); }
  }

  async abrir(): Promise<void> {
    const r = await this.pedir(RECEPTOR, NS_RECEPTOR, { type: 'LAUNCH', appId: APP_PADRAO }, 20000);
    let st = lerStatusReceptor(r);
    for (let i = 0; i < 10 && !st?.transporte; i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      st = lerStatusReceptor(await this.pedir(RECEPTOR, NS_RECEPTOR, { type: 'GET_STATUS' }));
    }
    if (!st?.transporte) throw new Error('o Chromecast não abriu o player');
    this.transporte = st.transporte;
    this.enviar(this.transporte, NS_CONEXAO, { type: 'CONNECT' });
  }

  async carregar(load: Record<string, unknown>): Promise<void> {
    const r = await this.pedir(this.transporte!, NS_MIDIA, load, 30000);
    if (r.type === 'LOAD_FAILED' || r.type === 'LOAD_CANCELLED' || r.type === 'INVALID_REQUEST') throw new Error(`o Chromecast recusou o vídeo (${String(r.type)})`);
  }

  async midia(tipo: 'PLAY' | 'PAUSE' | 'STOP' | 'SEEK' | 'GET_STATUS', extra: Record<string, unknown> = {}): Promise<void> {
    if (!this.transporte) return;
    await this.pedir(this.transporte, NS_MIDIA, { type: tipo, mediaSessionId: this.sessaoMidia ?? undefined, ...extra }).catch(() => undefined);
  }

  async volume(nivel: number): Promise<void> {
    await this.pedir(RECEPTOR, NS_RECEPTOR, { type: 'SET_VOLUME', volume: { level: Math.max(0, Math.min(1, nivel / 100)) } }).catch(() => undefined);
  }

  fechar(): void {
    try { if (this.transporte) this.enviar(this.transporte, NS_CONEXAO, { type: 'CLOSE' }); } catch { /* já fechou */ }
    try { this.enviar(RECEPTOR, NS_RECEPTOR, { type: 'STOP', requestId: this.proximoId++ }); } catch { /* idem */ }
    if (this.batida) clearInterval(this.batida);
    setTimeout(() => this.sock.destroy(), 300);
  }
}

// ── transmitindo ────────────────────────────────────────────────────────────────────────────────────────────────────

type AtualDlna = { tipo: 'dlna'; nome: string; tv: Tv; duracaoLocalMs: number; tocou: boolean; buscou: boolean };
type Atual = AtualDlna | { tipo: 'chromecast'; nome: string; cc: SessaoChromecast; tocou: boolean };
let atual: Atual | null = null;
let acompanhar: NodeJS.Timeout | null = null;

export interface PedidoEnviar { id: string; url: string; referer?: string; mime?: string; titulo?: string; posicaoMs?: number; duracaoMs?: number; q?: number; chave?: string }
export interface EstadoCast { tv: string | null; tipo?: 'dlna' | 'chromecast'; estado: 'tocando' | 'pausado' | 'carregando' | 'parado'; posicaoMs: number; duracaoMs: number; volume?: number }

function avisar(evento: string, dados: unknown): void {
  const j = janelaDoApp();
  if (j && !j.isDestroyed()) j.webContents.send('wm:cast', evento, dados);
}

async function estadoAgora(): Promise<EstadoCast> {
  const a = atual;
  if (!a) return { tv: null, estado: 'parado', posicaoMs: 0, duracaoMs: 0 };
  if (a.tipo === 'dlna') {
    const [pos, tr, vol] = await Promise.all([
      soap(a.tv.controle, AVT, 'GetPositionInfo', pedidoPosicao(), 4000).then(lerPosicao).catch(() => null),
      soap(a.tv.controle, AVT, 'GetTransportInfo', pedidoTransporte(), 4000).then(lerEstado).catch(() => ''),
      a.tv.render ? soap(a.tv.render, RCS, 'GetVolume', pedidoLerVolume(), 4000).then(lerVolume).catch(() => null) : Promise.resolve(null),
    ]);
    const estado = tr === 'PLAYING' ? 'tocando' : tr === 'PAUSED_PLAYBACK' ? 'pausado' : tr === 'TRANSITIONING' ? 'carregando' : 'parado';
    if (estado === 'tocando') a.tocou = true;
    // A TV às vezes devolve a duração errada (= CastLocal.duracao): o PC sabe a do vídeo; a da TV só sem a do PC.
    const duracaoMs = a.duracaoLocalMs || pos?.duracaoMs || 0;
    return { tv: a.nome, tipo: 'dlna', estado, posicaoMs: pos?.posicaoMs ?? 0, duracaoMs, volume: vol ?? undefined };
  }
  const st = a.cc.ultimo;
  const estado = !st ? 'carregando' : st.estado === 'PLAYING' ? 'tocando' : st.estado === 'PAUSED' ? 'pausado' : st.estado === 'BUFFERING' ? 'carregando' : 'parado';
  if (estado === 'tocando') a.tocou = true;
  return { tv: a.nome, tipo: 'chromecast', estado, posicaoMs: st?.posicaoMs ?? 0, duracaoMs: st?.duracaoMs ?? 0, volume: st?.volume };
}

function comecarAcompanhar(): void {
  if (acompanhar) clearInterval(acompanhar);
  let ultimaPos = 0;
  acompanhar = setInterval(async () => {
    const a = atual;
    if (!a) return;
    if (a.tipo === 'chromecast') await a.cc.midia('GET_STATUS');
    const e = await estadoAgora();
    if (atual !== a) return;
    avisar('estado', e);
    // Fim: parou depois de ter tocado, perto do fim (ou o Chromecast disse FINISHED) → o site pede o próximo.
    const perto = e.duracaoMs > 0 && Math.max(e.posicaoMs, ultimaPos) >= e.duracaoMs - 5000;
    const terminou = a.tipo === 'chromecast' ? a.cc.ultimo?.motivoParada === 'FINISHED' : e.estado === 'parado' && a.tocou && perto;
    if (a.tipo === 'chromecast' && a.cc.ultimo?.motivoParada === 'ERROR') { avisar('erro', { motivo: 'O Chromecast não conseguiu tocar este vídeo (formato ou rede).' }); await parar(false); return; }
    if (terminou) { avisar('fim', {}); await parar(false); return; }
    if (e.posicaoMs > 0) ultimaPos = e.posicaoMs;
  }, 1000);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Continua na TV de onde o PC estava (= PlayerActivity.seekWithRetry do APK): espera a TV abrir o vídeo (até ~15 s;
 *  antes disso o Seek é recusado ou ignorado e ela começava do zero) e insiste até a posição que a TV informa bater
 *  com o alvo. Para se a transmissão mudou (outro vídeo, parou) ou se ele já mexeu na barra. */
async function continuarDeOndeParou(a: AtualDlna, alvoMs: number): Promise<void> {
  const vale = () => atual === a && !a.buscou;
  for (let i = 0; i < 15 && vale(); i++) {
    const estado = await soap(a.tv.controle, AVT, 'GetTransportInfo', pedidoTransporte(), 4000).then(lerEstado).catch(() => '');
    if (tvAbriuOVideo(estado)) break;
    await esperar(1000);
  }
  for (let i = 0; i < 6; i++) {
    await esperar(i === 0 ? 500 : 1800);
    if (!vale()) return;
    if (!(await soap(a.tv.controle, AVT, 'Seek', pedidoBuscar(alvoMs), 6000).then(() => true).catch(() => false))) continue;
    const pos = await soap(a.tv.controle, AVT, 'GetPositionInfo', pedidoPosicao(), 4000).then(lerPosicao).catch(() => null);
    if (pos && chegouNoAlvo(pos.posicaoMs, alvoMs)) { console.log(`[wm] cast: continuou em ${hms(alvoMs)} (tentativa ${i + 1})`); return; }
  }
  if (!vale()) return;
  console.warn(`[wm] cast: a TV não aceitou continuar em ${hms(alvoMs)}`);
  avisar('aviso', { motivo: 'A TV não aceitou continuar de onde parou: use a barra pra ajustar.' });
}

async function enviar(o: PedidoEnviar): Promise<{ ok: boolean; erro?: string }> {
  try {
    await ligarProxy();
    const base = baseDoProxy();
    if (!base) return { ok: false, erro: 'O PC não está numa rede da casa (Wi-Fi ou cabo): a TV não alcança o vídeo.' };
    const titulo = o.titulo || 'WatchMov';
    const baixado = o.chave && arquivoDoBaixado(o.chave) ? o.chave : null;
    const url = baixado ? `${base}/arquivo/${encodeURIComponent(baixado)}` : urlDoProxy(base, o.url, o.referer, o.q ?? 0);
    const hls = !baixado && pareceHls(o.url, o.mime);
    if (atual) await parar(false);
    if (o.id.startsWith('dlna:')) {
      const tv = dlnaAchadas.get(o.id.slice(5));
      if (!tv) return { ok: false, erro: 'A TV sumiu da rede: procure de novo.' };
      // A LG sonda o link antes de responder o SetAVTransportURI: frio, estourava o tempo (= ProxyServer.prewarm).
      if (!baixado) await net.fetch(o.url, { headers: cabecalhosDaFonte(o.url, o.referer), signal: AbortSignal.timeout(8000) }).then((r) => r.arrayBuffer()).catch(() => undefined);
      await soap(tv.controle, AVT, 'Stop', pedidoAcao('Stop'), 5000).catch(() => undefined);
      await soap(tv.controle, AVT, 'SetAVTransportURI', pedidoSetUri(url, titulo), 20000);
      await soap(tv.controle, AVT, 'Play', pedidoAcao('Play'), 10000);
      const a: AtualDlna = { tipo: 'dlna', nome: tv.nome, tv, duracaoLocalMs: o.duracaoMs ?? 0, tocou: false, buscou: false };
      atual = a;
      const pos = o.posicaoMs ?? 0;
      if (pos > CONTINUAR_A_PARTIR_MS) void continuarDeOndeParou(a, pos);
    } else if (o.id.startsWith('cc:')) {
      const c = ccAchados.get(o.id.slice(3));
      if (!c) return { ok: false, erro: 'O Chromecast sumiu da rede: procure de novo.' };
      const cc = await SessaoChromecast.conectar(c.ip, c.porta);
      try {
        await cc.abrir();
        let formato: 'ts' | 'fmp4' | undefined;
        if (hls) formato = await formatoDoHls(url);
        await cc.carregar(pedidoLoad({ url, hls, formato, titulo, posicaoMs: o.posicaoMs ?? 0, requestId: 0 }));
      } catch (e) { cc.fechar(); throw e; }
      const a: Atual = { tipo: 'chromecast', nome: c.nome, cc, tocou: false };
      cc.aoFechar = () => { if (atual === a) { atual = null; avisar('parou', {}); } };
      atual = a;
    } else return { ok: false, erro: 'TV desconhecida.' };
    comecarAcompanhar();
    console.log(`[wm] cast: tocando em ${atual?.nome} (${atual?.tipo}) ${url.replace(SEGREDO, '…')}`);
    return { ok: true };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.warn('[wm] cast enviar:', erro);
    return { ok: false, erro };
  }
}

/** TS ou fMP4: lê a lista (pelo próprio proxy, já reescrita) e, se for master, a variante que a TV vai tocar. */
async function formatoDoHls(urlProxy: string): Promise<'ts' | 'fmp4'> {
  try {
    const lista = await (await net.fetch(urlProxy, { signal: AbortSignal.timeout(8000) })).text();
    const variante = /^#EXT-X-STREAM-INF[^\n]*\n([^\n#]+)/m.exec(lista)?.[1]?.trim();
    if (!variante) return formatoDosPedacos(lista);
    const abs = new URL(variante, urlProxy).toString();
    return formatoDosPedacos(await (await net.fetch(abs, { signal: AbortSignal.timeout(8000) })).text());
  } catch { return 'ts'; }
}

async function controle(acao: string, valor?: number): Promise<boolean> {
  const a = atual;
  if (!a) return false;
  try {
    if (a.tipo === 'dlna') {
      if (acao === 'pausar') await soap(a.tv.controle, AVT, 'Pause', pedidoAcao('Pause'));
      else if (acao === 'continuar') await soap(a.tv.controle, AVT, 'Play', pedidoAcao('Play'));
      else if (acao === 'buscar' && typeof valor === 'number') { a.buscou = true; await soap(a.tv.controle, AVT, 'Seek', pedidoBuscar(valor)); }
      else if (acao === 'volume' && typeof valor === 'number' && a.tv.render) await soap(a.tv.render, RCS, 'SetVolume', pedidoVolume(valor));
      else return false;
    } else {
      if (acao === 'pausar') await a.cc.midia('PAUSE');
      else if (acao === 'continuar') await a.cc.midia('PLAY');
      else if (acao === 'buscar' && typeof valor === 'number') await a.cc.midia('SEEK', { currentTime: Math.max(0, valor / 1000) });
      else if (acao === 'volume' && typeof valor === 'number') await a.cc.volume(valor);
      else return false;
    }
    return true;
  } catch (e) {
    console.warn('[wm] cast controle:', e instanceof Error ? e.message : e);
    return false;
  }
}

/** Para de transmitir. `avisarSite` = o pedido veio do processo (fim/erro já avisaram). Devolve onde a TV estava. */
async function parar(avisarSite = true): Promise<{ posicaoMs: number }> {
  const a = atual;
  if (!a) return { posicaoMs: 0 };
  const e = await estadoAgora().catch(() => null);
  atual = null;
  if (acompanhar) { clearInterval(acompanhar); acompanhar = null; }
  if (a.tipo === 'dlna') await soap(a.tv.controle, AVT, 'Stop', pedidoAcao('Stop'), 5000).catch(() => undefined);
  else a.cc.fechar();
  if (avisarSite) avisar('parou', {});
  return { posicaoMs: e?.posicaoMs ?? 0 };
}

/** Liga o "mandar pra TV". `baixado(chave)` = caminho do .mp4 da W4 (ou null). */
export function ligarCast(origemApp: string, janela: () => BrowserWindow | null, baixado: (chave: string) => string | null): void {
  janelaDoApp = janela;
  arquivoDoBaixado = baixado;
  const daPagina = (e: IpcMainInvokeEvent) => origemDoFrame(e.senderFrame) === origemApp;
  ipcMain.handle('wm:cast-procurar', (e) => (daPagina(e) ? procurar() : []));
  ipcMain.handle('wm:cast-enviar', (e, o: PedidoEnviar) => (daPagina(e) && o && typeof o.id === 'string' && typeof o.url === 'string' ? enviar(o) : { ok: false }));
  ipcMain.handle('wm:cast-controle', (e, acao: unknown, valor: unknown) => (daPagina(e) && typeof acao === 'string' ? controle(acao, typeof valor === 'number' ? valor : undefined) : false));
  ipcMain.handle('wm:cast-estado', (e) => (daPagina(e) ? estadoAgora() : null));
  ipcMain.handle('wm:cast-parar', (e) => (daPagina(e) ? parar() : { posicaoMs: 0 }));
  ipcMain.handle('wm:cast-espelhar', async (e) => {
    if (!daPagina(e)) return false;
    // Transmitir do Windows (o mesmo painel do Win+K).
    return shell.openExternal('ms-settings-connectabledevices:devicediscovery').then(() => true).catch(() => false);
  });
}

/** App fechando: a TV para (senão fica tocando do PC que sumiu) e o proxy fecha. */
export async function pararCast(): Promise<void> {
  await parar(false).catch(() => undefined);
  servidor?.close();
}
