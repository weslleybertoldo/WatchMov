// Downloads do app do Windows (W4) = DownloaderPlugin.java do APK, no processo principal do Electron. A interface é a
// mesma do plugin (src/lib/downloader.ts: enqueue/remove/list/resume/storage + o evento downloadChanged), então a aba
// Download, o ⤓ dos links e o "tocar o baixado" do site funcionam sem mudar (src/lib/desktopPlugins.ts faz a ponte).
// Cada título vira UM arquivo .mp4 em Vídeos\WatchMov, que qualquer player do PC abre:
//   · mp4 direto: um pedido só; se o app fechar ou a conexão cair, continua de onde parou (Range);
//   · HLS: pedaço por pedaço numa pasta do app (continua do pedaço onde parou) e no fim o ffmpeg junta tudo sem
//     recodificar (D8 do plano). Os cabeçalhos são os do link (Referer/Origin/token que o player usou).
// As decisões ficam em regrasDownload.ts (testadas sem Electron). Testes: WM_DL_PASTA troca a pasta, WM_DL_KBPS limita
// a velocidade (pra dar tempo de fechar o app no meio) e WM_FFMPEG troca o ffmpeg.
import { app, ipcMain, net, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpegStatic from 'ffmpeg-static';
import { refererDoPedido, trocarCabecalho, enderecoLocal } from './regras';
import {
  argsDoFfmpeg, chaveValida, descreverFalha, duracaoDoFfmpeg, ehMaster, ehPlaylist, escolherAudio, escolherVariante,
  faixaDoPedido, falhaTemporaria, idDoMapa, lerMaster, lerPlaylist, motivoDaFalha, nomeDoArquivo, pareceHls, pareceHtml,
  percentual, playlistLocal, tempoDoFfmpeg, totalDaResposta, type Faixa, type Playlist,
} from './regrasDownload';
import { aoPedirArquivo, cabecalhosPara, origemDoFrame } from './rede';

type Estado = 'queued' | 'downloading' | 'completed' | 'failed' | 'stopped' | 'removed';

interface Registro {
  key: string; url: string; referer?: string; mime?: string; title?: string;
  cabecalhos: Record<string, string>;   // os do link na hora do pedido (o app pode fechar antes de terminar)
  arquivo: string;                      // .mp4 final
  tipo?: 'mp4' | 'hls';
  state: Estado; percent: number; bytes: number; reason?: string;
  tentativas: number;                   // novas tentativas automáticas desde a última falha temporária
  criado: number;
}

interface Plano { video: Playlist; audio?: Playlist; altura?: number }

/** O que vai pra página (= DownloadItem de src/lib/downloader.ts). */
interface Item { key: string; state: Estado; percent: number; bytes?: number; reason?: string; title?: string; uri?: string }

class ErroHttp extends Error { constructor(readonly status: number, url: string) { super(`HTTP ${status} em ${url.slice(0, 90)}`); } }
/** Falha com o motivo já pronto pra aba Download. */
class ErroFonte extends Error {}

const registros = new Map<string, Registro>();
let arquivoRegistro = '';
let gravarDepois: NodeJS.Timeout | null = null;
let janelaDoApp: () => BrowserWindow | null = () => null;
let ativo: { key: string; parar: AbortController; fim: Promise<void>; ffmpeg?: ChildProcess } | null = null;
let fechando = false;
const ultimoAviso = new Map<string, { quando: number; estado: Estado }>();
const novasTentativas = new Map<string, NodeJS.Timeout>();
const ESPERAS = [30_000, 120_000, 600_000];   // novas tentativas sozinhas em falha temporária (= scheduleAutoRetry)
const LIMITE_KBPS = Number(process.env.WM_DL_KBPS) || 0;

const pastaFinal = (): string => process.env.WM_DL_PASTA || path.join(app.getPath('videos'), 'WatchMov');
// Uma pasta por pedido (chave + quando foi pedido): trocar o link de um título não mistura os pedaços dos dois.
const pastaDosPedacos = (r: Registro): string =>
  path.join(app.getPath('userData'), 'baixando', createHash('sha1').update(`${r.key}|${r.criado}`).digest('hex').slice(0, 12));

/** Mensagem do erro, olhando a causa: o fim do prazo chega como "aborted" com o motivo de verdade na causa. */
const mensagemDe = (e: unknown): string => {
  const x = e as { message?: string; cause?: { message?: string } } | undefined;
  return String(x?.cause?.message ?? x?.message ?? e);
};

function caminhoDoFfmpeg(): string {
  const p = process.env.WM_FFMPEG || ffmpegStatic || '';
  // Instalado, o binário fica fora do app.asar (electron-builder.yml, asarUnpack): de dentro do .asar não executa.
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

const uriDo = (r: Registro): string =>
  `wm-video://arquivo/?k=${encodeURIComponent(r.key)}&u=${encodeURIComponent(r.url)}${r.referer ? `&r=${encodeURIComponent(r.referer)}` : ''}`;

const item = (r: Registro): Item => ({
  key: r.key, state: r.state, percent: r.percent, bytes: r.bytes, title: r.title, uri: uriDo(r),
  ...(r.reason ? { reason: r.reason } : {}),
});

function emitir(evento: string, dados: unknown): void {
  const w = janelaDoApp();
  if (w && !w.isDestroyed()) w.webContents.send('wm:downloads', evento, dados);
}

/** downloadChanged: na hora quando muda o estado; o progresso no máximo a cada 0,4 s. */
function avisar(r: Registro, forcar = false): void {
  const antes = ultimoAviso.get(r.key);
  const agora = Date.now();
  if (!forcar && antes && antes.estado === r.state && agora - antes.quando < 400) return;
  ultimoAviso.set(r.key, { quando: agora, estado: r.state });
  emitir('downloadChanged', item(r));
}

function gravar(agora = false): void {
  if (!arquivoRegistro) return;
  const escrever = () => {
    gravarDepois = null;
    try {
      const tmp = `${arquivoRegistro}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...registros.values()], null, 1));
      fs.renameSync(tmp, arquivoRegistro);
    } catch (e) { console.warn('[wm] downloads: não gravou o registro:', String(e).slice(0, 160)); }
  };
  if (agora) { if (gravarDepois) clearTimeout(gravarDepois); escrever(); return; }
  if (!gravarDepois) gravarDepois = setTimeout(escrever, 1000);
}

function carregar(): void {
  try {
    const lista = JSON.parse(fs.readFileSync(arquivoRegistro, 'utf8')) as Registro[];
    for (const r of lista) {
      if (!chaveValida(r?.key) || typeof r.url !== 'string' || typeof r.arquivo !== 'string') continue;
      // Ficou pela metade (o app fechou baixando): volta pra fila e continua sozinho. Falhou: espera o "retomar".
      if (r.state === 'downloading') r.state = 'queued';
      r.tentativas = 0;
      registros.set(r.key, r);
    }
  } catch { /* 1ª vez: sem registro */ }
}

/** Nome livre na pasta (o de outro download ou um arquivo dele com o mesmo nome ganha " (2)"). */
function arquivoLivre(nome: string): string {
  const pasta = pastaFinal();
  const usados = new Set([...registros.values()].map((r) => r.arquivo.toLowerCase()));
  const ext = path.extname(nome);
  const base = nome.slice(0, -ext.length);
  for (let n = 1; ; n++) {
    const p = path.join(pasta, n === 1 ? nome : `${base} (${n})${ext}`);
    if (!usados.has(p.toLowerCase()) && !fs.existsSync(p) && !fs.existsSync(`${p}.part`)) return p;
  }
}

const esperar = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, nao) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); nao(signal.reason ?? new Error('abortado')); }, { once: true });
});

/** Sinal que cai se o servidor ficar `ms` sem mandar nada (o pedido inteiro pode demorar horas num filme). */
function vigia(pai: AbortSignal, ms: number) {
  const ctl = new AbortController();
  const parar = () => ctl.abort(pai.reason);
  if (pai.aborted) parar(); else pai.addEventListener('abort', parar, { once: true });
  const estourar = () => ctl.abort(new Error(`timeout: o servidor da fonte parou de responder (${ms / 1000} s)`));
  let t = setTimeout(estourar, ms);
  return {
    signal: ctl.signal,
    mexeu() { clearTimeout(t); t = setTimeout(estourar, ms); },
    fim() { clearTimeout(t); pai.removeEventListener('abort', parar); },
  };
}

/** Pedido com os cabeçalhos do link: o Referer no formato que o Chromium aceita pra esse endereço e sem Origin (igual
 *  ao vídeo do player, rede.ts). Resposta que não é 2xx vira ErroHttp com o status. */
async function pedir(r: Registro, url: string, extra: Record<string, string>, signal: AbortSignal): Promise<Response> {
  const cab: Record<string, string> = { ...r.cabecalhos };
  const nomeRef = Object.keys(cab).find((k) => k.toLowerCase() === 'referer');
  if (nomeRef) {
    const ref = refererDoPedido(cab[nomeRef], url);
    if (ref) cab[nomeRef] = ref; else delete cab[nomeRef];
  }
  trocarCabecalho(cab, 'Origin', null);
  Object.assign(cab, extra);
  const resp = await net.fetch(url, { headers: cab, bypassCustomProtocolHandlers: true, cache: 'no-store', signal, redirect: 'follow' });
  if (!resp.ok) {
    try { await resp.body?.cancel(); } catch { /* já fechado */ }
    throw new ErroHttp(resp.status, url);
  }
  return resp;
}

async function lerTexto(r: Registro, url: string, signal: AbortSignal): Promise<string> {
  return comTentativas(signal, async () => {
    const v = vigia(signal, 30_000);
    try { return await (await pedir(r, url, {}, v.signal)).text(); } finally { v.fim(); }
  });
}

/** Até 4 tentativas com espera crescente em falha temporária (sem resposta, 5xx, 408, 429); link morto sai na hora. */
async function comTentativas<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  for (let n = 0; ; n++) {
    try { return await fn(); } catch (e) {
      if (signal.aborted || e instanceof ErroFonte || n >= 3) throw e;
      const http = e instanceof ErroHttp ? e.status : 0;
      if (!falhaTemporaria(http)) throw e;
      await esperar([1000, 3000, 8000][n], signal);
    }
  }
}

/** Limite de velocidade só pros testes (WM_DL_KBPS): espera o tempo que esses bytes levariam. */
const limitar = (bytes: number, signal: AbortSignal) => (LIMITE_KBPS > 0 ? esperar((bytes / 1024 / LIMITE_KBPS) * 1000, signal) : Promise.resolve());

async function descobrirTipo(r: Registro, signal: AbortSignal): Promise<'mp4' | 'hls'> {
  if (pareceHls(r.url, r.mime)) return 'hls';
  // Pela resposta: as fontes mandam HLS com nome e tipo de tudo (playlist.php, /m3/…), então lê o começo.
  return comTentativas(signal, async () => {
    const v = vigia(signal, 30_000);
    try {
      const resp = await pedir(r, r.url, { Range: 'bytes=0-4095' }, v.signal);
      const leitor = resp.body?.getReader();
      let inicio = Buffer.alloc(0);
      while (leitor && inicio.length < 4096) {
        const { done, value } = await leitor.read();
        if (done) break;
        inicio = Buffer.concat([inicio, Buffer.from(value)]);
      }
      await leitor?.cancel().catch(() => undefined);
      const texto = inicio.subarray(0, 4096).toString('utf8');
      if (ehPlaylist(texto)) return 'hls';
      if (pareceHtml(texto)) throw new ErroFonte('A fonte respondeu uma página no lugar do vídeo: abra o título de novo');
      return 'mp4';
    } finally { v.fim(); }
  });
}

function progresso(r: Registro, bytes: number, percent: number): void {
  r.bytes = bytes;
  r.percent = Math.min(99, percent);   // 100 só com o arquivo final no lugar
  avisar(r);
  gravar();
}

async function baixarMp4(r: Registro, signal: AbortSignal): Promise<void> {
  const parte = `${r.arquivo}.part`;
  let tinha = (await fsp.stat(parte).catch(() => null))?.size ?? 0;
  const abrir = () => comTentativas(signal, async () => {
    const v = vigia(signal, 45_000);
    try { return { resp: await pedir(r, r.url, tinha > 0 ? { Range: `bytes=${tinha}-` } : {}, v.signal), v }; }
    catch (e) { v.fim(); throw e; }
  });
  let aberto: Awaited<ReturnType<typeof abrir>>;
  try { aberto = await abrir(); } catch (e) {
    // 416 com parte no disco: o app fechou com o arquivo inteiro baixado e sem trocar o nome. Recomeça (não dá pra
    // conferir o tamanho certo sem a resposta).
    if (!(e instanceof ErroHttp && e.status === 416 && tinha > 0)) throw e;
    tinha = 0;
    aberto = await abrir();
  }
  const { resp, v } = aberto;
  try {
    if (tinha > 0 && resp.status !== 206) {
      console.log(`[wm] download ${r.key}: a fonte não continua do meio, recomeça do 0`);
      tinha = 0;
    } else if (tinha > 0) console.log(`[wm] download ${r.key}: continua de ${(tinha / 1048576).toFixed(1)} MB`);
    const total = totalDaResposta(resp.headers.get('content-range'), resp.headers.get('content-length'), tinha);
    let bytes = tinha;
    const conta = new Transform({
      transform(pedaco: Buffer, _c, feito) {
        v.mexeu();
        if (bytes === 0 && pareceHtml(pedaco.subarray(0, 256).toString('utf8'))) {
          feito(new ErroFonte('A fonte respondeu uma página no lugar do vídeo: abra o título de novo'));
          return;
        }
        bytes += pedaco.length;
        progresso(r, bytes, percentual(bytes, total));
        limitar(pedaco.length, signal).then(() => feito(null, pedaco), feito);
      },
    });
    if (!resp.body) throw new ErroFonte('A fonte respondeu sem o vídeo');
    await pipeline(Readable.fromWeb(resp.body as import('node:stream/web').ReadableStream), conta,
      fs.createWriteStream(parte, { flags: tinha > 0 ? 'a' : 'w' }), { signal: v.signal });
    if (total > 0 && bytes < total) throw new Error('unexpected end: conexão com a fonte caiu no meio');
    if (bytes === 0) throw new ErroFonte('A fonte respondeu um arquivo vazio');
    await fsp.rename(parte, r.arquivo);
  } finally { v.fim(); }
}

/** Baixa um pedaço (ou a chave/o init) pra `destino`, inteiro ou a faixa de bytes; grava em .part e troca o nome no
 *  fim, então arquivo com o nome final = pedaço completo (é assim que o "continuar" sabe onde parou). */
async function baixarPedaco(r: Registro, url: string, faixa: Faixa | undefined, destino: string, signal: AbortSignal): Promise<number> {
  return comTentativas(signal, async () => {
    const v = vigia(signal, 60_000);
    try {
      const resp = await pedir(r, url, faixa ? { Range: `bytes=${faixa.inicio}-${faixa.inicio + faixa.tamanho - 1}` } : {}, v.signal);
      let corpo = Buffer.from(await resp.arrayBuffer());
      // Servidor que ignora o Range manda o arquivo inteiro: recorta a faixa aqui.
      if (faixa && resp.status === 200 && corpo.length > faixa.tamanho) corpo = corpo.subarray(faixa.inicio, faixa.inicio + faixa.tamanho);
      if (!corpo.length) throw new Error('unexpected end: pedaço vazio');
      if (pareceHtml(corpo.subarray(0, 256).toString('utf8'))) throw new ErroFonte('A fonte respondeu uma página no lugar de um pedaço do vídeo: abra o título de novo');
      await fsp.writeFile(`${destino}.part`, corpo);
      await fsp.rename(`${destino}.part`, destino);
      await limitar(corpo.length, signal);
      return corpo.length;
    } finally { v.fim(); }
  });
}

async function montarPlano(r: Registro, signal: AbortSignal): Promise<Plano> {
  const texto = await lerTexto(r, r.url, signal);
  if (!ehPlaylist(texto)) {
    throw new ErroFonte(pareceHtml(texto) ? 'A fonte respondeu uma página no lugar do vídeo: abra o título de novo' : 'O link não é uma lista de vídeo (HLS)');
  }
  let plano: Plano;
  if (ehMaster(texto)) {
    const m = lerMaster(texto, r.url);
    const v = escolherVariante(m);
    if (!v) throw new ErroFonte('A lista do vídeo veio vazia');
    const a = escolherAudio(m, v);
    plano = { video: lerPlaylist(await lerTexto(r, v.url, signal), v.url), altura: v.altura || undefined };
    if (a?.url) plano.audio = lerPlaylist(await lerTexto(r, a.url, signal), a.url);
    console.log(`[wm] download ${r.key}: HLS ${v.altura ? `${v.altura}p` : `${Math.round(v.banda / 1000)} kbps`} com ${plano.video.segmentos.length} pedaços${a?.url ? ` + áudio separado (${a.idioma ?? a.nome ?? '?'})` : ''}`);
  } else {
    plano = { video: lerPlaylist(texto, r.url) };
    console.log(`[wm] download ${r.key}: HLS com ${plano.video.segmentos.length} pedaços`);
  }
  if (!plano.video.segmentos.length) throw new ErroFonte('A lista do vídeo veio vazia');
  if (!plano.video.fim && !plano.video.vod) throw new ErroFonte('Transmissão ao vivo não dá pra baixar');
  return plano;
}

const hash8 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8);

async function baixarHls(r: Registro, signal: AbortSignal): Promise<void> {
  const pasta = pastaDosPedacos(r);
  await fsp.mkdir(pasta, { recursive: true });
  const arqPlano = path.join(pasta, 'plano.json');
  let plano = await fsp.readFile(arqPlano, 'utf8').then((t) => JSON.parse(t) as Plano).catch(() => null);
  if (plano) console.log(`[wm] download ${r.key}: continua o HLS (${plano.video.segmentos.length} pedaços)`);
  else {
    plano = await montarPlano(r, signal);
    await fsp.writeFile(arqPlano, JSON.stringify(plano));
  }
  const faixas: Array<[string, Playlist]> = [['v', plano.video], ...(plano.audio ? [['a', plano.audio] as [string, Playlist]] : [])];
  const total = faixas.reduce((s, [, pl]) => s + (pl.duracao || pl.segmentos.length), 0);
  const ext = (pl: Playlist) => (pl.segmentos.some((s) => s.mapa) ? 'm4s' : 'ts');
  const nomeSeg = (p: string, pl: Playlist, i: number) => `${p}-${String(i).padStart(5, '0')}.${ext(pl)}`;
  let feito = 0, bytes = 0, jaTinha = 0;
  for (const [p, pl] of faixas) {
    for (let i = 0; i < pl.segmentos.length; i++) {
      const st = await fsp.stat(path.join(pasta, nomeSeg(p, pl, i))).catch(() => null);
      if (st) { feito += pl.segmentos[i].duracao || 1; bytes += st.size; jaTinha++; }
    }
  }
  if (jaTinha) console.log(`[wm] download ${r.key}: ${jaTinha} pedaços já baixados (${percentual(feito, total)}%), continua do seguinte`);
  progresso(r, bytes, percentual(feito, total));
  for (const [p, pl] of faixas) {
    // Chaves (AES-128) e init do fMP4 primeiro: são poucos e sem eles os pedaços não abrem.
    for (const url of new Set(pl.segmentos.map((s) => s.chave?.url).filter((u): u is string => !!u))) {
      const destino = path.join(pasta, `${p}-chave-${hash8(url)}.key`);
      if (!fs.existsSync(destino)) await baixarPedaco(r, url, undefined, destino, signal);
    }
    const mapas = new Map(pl.segmentos.filter((s) => s.mapa).map((s) => [idDoMapa(s.mapa!), s.mapa!]));
    for (const [id, m] of mapas) {
      const destino = path.join(pasta, `${p}-init-${hash8(id)}.mp4`);
      if (!fs.existsSync(destino)) await baixarPedaco(r, m.url, m.faixa, destino, signal);
    }
    for (let i = 0; i < pl.segmentos.length; i++) {
      const destino = path.join(pasta, nomeSeg(p, pl, i));
      if (fs.existsSync(destino)) continue;
      bytes += await baixarPedaco(r, pl.segmentos[i].url, pl.segmentos[i].faixa, destino, signal);
      feito += pl.segmentos[i].duracao || 1;
      progresso(r, bytes, percentual(feito, total));
    }
    await fsp.writeFile(path.join(pasta, `${p}.m3u8`), playlistLocal(pl, {
      segmento: (i) => nomeSeg(p, pl, i),
      chave: (url) => `${p}-chave-${hash8(url)}.key`,
      mapa: (id) => `${p}-init-${hash8(id)}.mp4`,
    }));
  }
  await juntar(r, pasta, !!plano.audio, plano.video.duracao, signal);
  await fsp.rm(pasta, { recursive: true, force: true });
}

/** ffmpeg junta os pedaços num .mp4 (sem recodificar), direto na pasta final. */
async function juntar(r: Registro, pasta: string, comAudio: boolean, duracao: number, signal: AbortSignal): Promise<void> {
  const exe = caminhoDoFfmpeg();
  if (!exe || !fs.existsSync(exe)) throw new ErroFonte('O ffmpeg do app não foi encontrado: reinstale o WatchMov');
  const saida = `${r.arquivo}.part`;
  const t0 = Date.now();
  await new Promise<void>((ok, nao) => {
    const p = spawn(exe, argsDoFfmpeg('v.m3u8', comAudio ? 'a.m3u8' : undefined, saida), { cwd: pasta, windowsHide: true });
    if (ativo?.key === r.key) ativo.ffmpeg = p;
    const fimDoLog: string[] = [];
    let resto = '';
    p.stderr.on('data', (d: Buffer) => {
      const linhas = (resto + d.toString()).split(/[\r\n]+/);
      resto = linhas.pop() ?? '';
      for (const l of linhas) {
        if (!l.trim()) continue;
        fimDoLog.push(l.trim());
        if (fimDoLog.length > 8) fimDoLog.shift();
        const t = tempoDoFfmpeg(l);
        if (t !== null && duracao > 0 && r.state === 'downloading') avisar(r);   // segue em 99% juntando
      }
    });
    const abortar = () => { try { p.kill(); } catch { /* já saiu */ } };
    signal.addEventListener('abort', abortar, { once: true });
    p.on('error', (e) => { signal.removeEventListener('abort', abortar); nao(e); });
    p.on('close', (codigo) => {
      signal.removeEventListener('abort', abortar);
      if (signal.aborted) return nao(signal.reason ?? new Error('abortado'));
      if (codigo === 0) return ok();
      console.warn(`[wm] download ${r.key}: ffmpeg saiu com ${codigo}: ${fimDoLog.join(' | ').slice(0, 600)}`);
      nao(new ErroFonte('Não deu pra juntar os pedaços do vídeo num arquivo · tente outro link'));
    });
  });
  const st = await fsp.stat(saida).catch(() => null);
  if (!st?.size) throw new ErroFonte('Não deu pra juntar os pedaços do vídeo num arquivo · tente outro link');
  await fsp.rename(saida, r.arquivo);
  console.log(`[wm] download ${r.key}: juntado em ${((Date.now() - t0) / 1000).toFixed(1)} s (${(st.size / 1048576).toFixed(1)} MB)`);
}

/** Duração do arquivo pronto (ffmpeg -i), só pro registro do teste. */
function duracaoDoArquivo(arquivo: string): Promise<number | null> {
  return new Promise((ok) => {
    const exe = caminhoDoFfmpeg();
    if (!exe || !fs.existsSync(exe)) return ok(null);
    const p = spawn(exe, ['-hide_banner', '-nostdin', '-i', arquivo], { windowsHide: true });
    let d: number | null = null;
    p.stderr.on('data', (b: Buffer) => { for (const l of b.toString().split(/\r?\n/)) d = d ?? duracaoDoFfmpeg(l); });
    p.on('close', () => ok(d));
    p.on('error', () => ok(null));
  });
}

function agendarNovaTentativa(r: Registro, http: number): void {
  if (!falhaTemporaria(http) || r.tentativas >= ESPERAS.length) return;
  const espera = ESPERAS[r.tentativas++];
  const t = setTimeout(() => {
    novasTentativas.delete(r.key);
    if (registros.get(r.key) !== r || r.state !== 'failed') return;
    console.log(`[wm] download ${r.key}: nova tentativa sozinha (${r.tentativas}ª)`);
    r.state = 'queued'; avisar(r, true); gravar(); proximo();
  }, espera);
  novasTentativas.set(r.key, t);
}

async function rodar(r: Registro): Promise<void> {
  const ctl = new AbortController();
  let terminou!: () => void;
  ativo = { key: r.key, parar: ctl, fim: new Promise<void>((ok) => { terminou = ok; }) };
  r.state = 'downloading'; r.reason = undefined;
  avisar(r, true); gravar();
  const t0 = Date.now();
  try {
    await fsp.mkdir(pastaFinal(), { recursive: true });
    if (!r.tipo) { r.tipo = await descobrirTipo(r, ctl.signal); gravar(); }
    if (r.tipo === 'hls') await baixarHls(r, ctl.signal); else await baixarMp4(r, ctl.signal);
    const st = await fsp.stat(r.arquivo);
    r.state = 'completed'; r.percent = 100; r.bytes = st.size; r.tentativas = 0;
    avisar(r, true);
    const dur = await duracaoDoArquivo(r.arquivo);
    console.log(`[wm] download ${r.key}: PRONTO em ${((Date.now() - t0) / 1000).toFixed(1)} s · ${(st.size / 1048576).toFixed(1)} MB${dur ? ` · ${Math.floor(dur / 60)} min ${Math.round(dur % 60)} s` : ''} · ${path.basename(r.arquivo)}`);
  } catch (e) {
    if (ctl.signal.aborted) {
      // Removido (quem removeu cuida do resto) ou o app fechando (fica na fila e continua na próxima abertura).
      if (registros.get(r.key) === r && r.state === 'downloading') r.state = 'queued';
    } else {
      const http = e instanceof ErroHttp ? e.status : 0;
      const motivo = e instanceof ErroFonte ? e.message : motivoDaFalha(http, mensagemDe(e));
      r.state = 'failed';
      r.reason = descreverFalha(motivo, r.percent);
      console.warn(`[wm] download ${r.key}: falhou em ${r.percent}%: ${mensagemDe(e).slice(0, 200)} → "${motivo}"`);
      avisar(r, true);
      agendarNovaTentativa(r, e instanceof ErroFonte ? 400 : http);
    }
  } finally {
    ativo = null;
    terminou();
    gravar();
    if (!fechando) proximo();
  }
}

/** Um download por vez, na ordem em que foram pedidos (o próximo começa quando um termina). */
function proximo(): void {
  if (ativo || fechando) return;
  const r = [...registros.values()].filter((x) => x.state === 'queued').sort((a, b) => a.criado - b.criado)[0];
  if (r) void rodar(r);
}

async function enfileirar(o: unknown): Promise<boolean> {
  const p = (o ?? {}) as Record<string, unknown>;
  if (!chaveValida(p.key) || typeof p.url !== 'string') return false;
  let alvo: URL;
  try { alvo = new URL(p.url); } catch { return false; }
  if ((alvo.protocol !== 'https:' && alvo.protocol !== 'http:') || enderecoLocal(alvo.hostname)) return false;
  const texto = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 2000) : undefined);
  const existente = registros.get(p.key);
  if (existente && existente.url === p.url) {
    // O mesmo link de novo: falhou ou parou → continua de onde parou; o resto (na fila, baixando, pronto) fica.
    if (existente.state === 'failed' || existente.state === 'stopped') { existente.state = 'queued'; existente.tentativas = 0; gravar(); }
    avisar(existente, true); proximo();
    return true;
  }
  if (existente) await remover(existente.key, false);   // outro link do mesmo título: começa de novo com ele
  const referer = texto(p.referer);
  const cabecalhos = { ...cabecalhosPara(p.url) };
  if (referer) trocarCabecalho(cabecalhos, 'Referer', referer);
  const title = texto(p.title)?.slice(0, 200);
  const r: Registro = {
    key: p.key, url: p.url, referer, mime: texto(p.mime), title, cabecalhos,
    arquivo: arquivoLivre(nomeDoArquivo(title, p.key)),
    state: 'queued', percent: 0, bytes: 0, tentativas: 0, criado: Date.now(),
  };
  registros.set(r.key, r);
  console.log(`[wm] download ${r.key}: na fila → ${path.basename(r.arquivo)}`);
  avisar(r, true); gravar(); proximo();
  return true;
}

async function remover(key: unknown, avisarRemovido = true): Promise<boolean> {
  if (!chaveValida(key)) return false;
  const r = registros.get(key);
  if (!r) return false;
  registros.delete(key);
  const t = novasTentativas.get(key);
  if (t) { clearTimeout(t); novasTentativas.delete(key); }
  if (ativo?.key === key) { ativo.parar.abort(new Error('removido')); await ativo.fim.catch(() => undefined); }
  // Excluir é excluir (= o APK): o .mp4 e os pedaços saem do PC.
  for (const p of [r.arquivo, `${r.arquivo}.part`]) await fsp.rm(p, { force: true }).catch(() => undefined);
  await fsp.rm(pastaDosPedacos(r), { recursive: true, force: true }).catch(() => undefined);
  gravar();
  console.log(`[wm] download ${key}: removido`);
  if (avisarRemovido) emitir('downloadChanged', { key, state: 'removed', percent: 0 } satisfies Item);
  proximo();
  return true;
}

/** = Downloader.resume(): o que falhou ou parou volta pra fila (continua de onde parou). */
function retomar(): boolean {
  let n = 0;
  for (const r of registros.values()) {
    if (r.state !== 'failed' && r.state !== 'stopped') continue;
    const t = novasTentativas.get(r.key);
    if (t) { clearTimeout(t); novasTentativas.delete(r.key); }
    r.state = 'queued'; r.tentativas = 0; n++;
    avisar(r, true);
  }
  if (n) { console.log(`[wm] downloads: ${n} voltaram pra fila`); gravar(); }
  proximo();
  return true;
}

async function espaco(): Promise<{ freeBytes: number; totalBytes: number }> {
  try {
    await fsp.mkdir(pastaFinal(), { recursive: true });
    const s = await fsp.statfs(pastaFinal());
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch { return { freeBytes: 0, totalBytes: 0 }; }
}

const CORS_DO_ARQUIVO: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, Accept-Ranges',
};

/** O arquivo baixado pro player do app (wm-video://arquivo/?k=…, a chave do esquema já conferida em rede.ts), com
 *  faixas de bytes: o player busca por partes ao avançar e ao abrir no meio. */
async function servirArquivo(pedido: Request): Promise<Response> {
  const k = new URL(pedido.url).searchParams.get('k');
  const r = k ? registros.get(k) : undefined;
  const st = r?.state === 'completed' ? await fsp.stat(r.arquivo).catch(() => null) : null;
  if (!r || !st) return new Response(null, { status: 404, headers: CORS_DO_ARQUIVO });
  const total = st.size;
  const faixa = faixaDoPedido(pedido.headers.get('range'), total);
  if (faixa === 'invalida') return new Response(null, { status: 416, headers: { ...CORS_DO_ARQUIVO, 'Content-Range': `bytes */${total}` } });
  const inicio = faixa?.inicio ?? 0, fim = faixa?.fim ?? total - 1;
  const h: Record<string, string> = {
    ...CORS_DO_ARQUIVO, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(fim - inicio + 1),
    ...(faixa ? { 'Content-Range': `bytes ${inicio}-${fim}/${total}` } : {}),
  };
  if (pedido.method === 'HEAD') return new Response(null, { status: faixa ? 206 : 200, headers: h });
  const corpo = Readable.toWeb(fs.createReadStream(r.arquivo, { start: inicio, end: fim })) as unknown as ReadableStream;
  return new Response(corpo, { status: faixa ? 206 : 200, headers: h });
}

/** Liga os downloads. Chamar depois do `ready` e do ligarRede (o esquema do vídeo é dele). */
export function ligarDownloads(origemApp: string, janela: () => BrowserWindow | null): void {
  janelaDoApp = janela;
  arquivoRegistro = path.join(app.getPath('userData'), 'downloads.json');
  carregar();
  aoPedirArquivo(servirArquivo);
  const daPagina = (e: IpcMainInvokeEvent) => origemDoFrame(e.senderFrame) === origemApp;
  ipcMain.handle('wm:dl-enfileirar', (e, o: unknown) => daPagina(e) && enfileirar(o));
  ipcMain.handle('wm:dl-remover', (e, k: unknown) => (daPagina(e) ? remover(k) : false));
  ipcMain.handle('wm:dl-lista', (e) => (daPagina(e) ? [...registros.values()].map(item) : []));
  ipcMain.handle('wm:dl-retomar', (e) => daPagina(e) && retomar());
  ipcMain.handle('wm:dl-espaco', (e) => (daPagina(e) ? espaco() : { freeBytes: 0, totalBytes: 0 }));
  const naFila = [...registros.values()].filter((r) => r.state === 'queued').length;
  if (naFila) console.log(`[wm] downloads: ${naFila} pela metade, continuam em 3 s`);
  setTimeout(proximo, 3000);
}

/** App fechando: para o que está baixando sem perder o que já veio (continua na próxima abertura). */
export function pararDownloads(): void {
  fechando = true;
  for (const t of novasTentativas.values()) clearTimeout(t);
  if (ativo) {
    const r = registros.get(ativo.key);
    if (r?.state === 'downloading') r.state = 'queued';
    ativo.parar.abort(new Error('app fechando'));
    try { ativo.ffmpeg?.kill(); } catch { /* já saiu */ }
  }
  gravar(true);
}
