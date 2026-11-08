// Regras dos downloads do app do Windows (W4), sem Electron: testadas em regrasDownload.test.cjs (npm run testar).
// O motor (downloads.ts) baixa o link que o player toca e grava UM arquivo .mp4 em Vídeos\WatchMov:
//   · mp4 direto: um pedido só, continuando de onde parou (Range) se o app fechar ou a conexão cair;
//   · HLS (.m3u8): pedaço por pedaço numa pasta temporária (continua do pedaço onde parou) e no fim o ffmpeg junta
//     tudo num .mp4 sem recodificar (D8 do plano: "-c copy").
// Os motivos de falha são os do APK (DownloadFailure.java), pra aba Download falar igual nos dois.

export interface Faixa { tamanho: number; inicio: number }
export interface Chave { metodo: string; url?: string; iv?: string }
export interface Mapa { url: string; faixa?: Faixa }
export interface Segmento { url: string; duracao: number; faixa?: Faixa; chave?: Chave; mapa?: Mapa; descontinuidade?: boolean }
export interface Playlist { segmentos: Segmento[]; duracao: number; fim: boolean; vod: boolean; sequencia: number; alvo: number }
export interface Variante { url: string; banda: number; altura: number; audio?: string }
export interface Midia { tipo: string; grupo: string; nome?: string; idioma?: string; padrao: boolean; url?: string }
export interface Master { variantes: Variante[]; midias: Midia[] }

/** Atributos de uma linha do HLS (`BANDWIDTH=1,CODECS="a,b",URI="x"`). */
export function atributos(texto: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  return out;
}

const absoluto = (url: string, base: string): string => new URL(url, base).toString();

/** O texto é uma lista HLS (master ou de pedaços)? Lê o conteúdo, não a extensão (o master.txt das fontes). */
export const ehPlaylist = (texto: string): boolean => texto.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U');
export const ehMaster = (texto: string): boolean => /#EXT-X-STREAM-INF:/i.test(texto);

/** A fonte mandou uma página no lugar do vídeo (bloqueio, captcha, link vencido que cai no site). */
export const pareceHtml = (inicio: string): boolean => /^\s*(?:<!doctype html|<html|<head|<body|<\?xml|\{\s*"error")/i.test(inicio);

/** Pela URL e pelo tipo, já dá pra saber que é HLS (= ehHls do player, src/lib/playerDesktop.ts). */
export const pareceHls = (url: string, mime?: string): boolean =>
  (mime ?? '').toLowerCase().includes('mpegurl') || /\.m3u8(\?|#|$)|master\.txt(\?|#|$)/i.test(url);

export function lerMaster(texto: string, base: string): Master {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim());
  const variantes: Variante[] = [];
  const midias: Midia[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.startsWith('#EXT-X-STREAM-INF:')) {
      const a = atributos(l.slice(18));
      let j = i + 1;
      while (j < linhas.length && (!linhas[j] || linhas[j].startsWith('#'))) j++;
      if (j >= linhas.length) break;
      const res = /(\d+)\s*x\s*(\d+)/i.exec(a.RESOLUTION ?? '');
      variantes.push({ url: absoluto(linhas[j], base), banda: Number(a.BANDWIDTH ?? a['AVERAGE-BANDWIDTH'] ?? 0) || 0, altura: res ? Number(res[2]) : 0, audio: a.AUDIO || undefined });
      i = j;
    } else if (l.startsWith('#EXT-X-MEDIA:')) {
      const a = atributos(l.slice(13));
      midias.push({
        tipo: (a.TYPE ?? '').toUpperCase(), grupo: a['GROUP-ID'] ?? '', nome: a.NAME, idioma: a.LANGUAGE,
        padrao: /^yes$/i.test(a.DEFAULT ?? ''), url: a.URI ? absoluto(a.URI, base) : undefined,
      });
    }
  }
  return { variantes, midias };
}

/** A melhor qualidade (maior altura; empate ou sem altura, maior banda) — a mesma que o player abre no Auto. */
export function escolherVariante(m: Master): Variante | undefined {
  return [...m.variantes].sort((a, b) => b.altura - a.altura || b.banda - a.banda)[0];
}

const ehPortugues = (m: Midia): boolean => /^pt\b|^pt-|^por\b/i.test(m.idioma ?? '') || /portugu|dublad|\bpt-?br\b/i.test(m.nome ?? '');

/** Áudio separado da variante (EXT-X-MEDIA com URI): português primeiro (como o player), depois o padrão. Sem URI = o
 *  áudio já vem dentro dos pedaços do vídeo. */
export function escolherAudio(m: Master, v: Variante): Midia | undefined {
  if (!v.audio) return undefined;
  const doGrupo = m.midias.filter((x) => x.tipo === 'AUDIO' && x.grupo === v.audio && x.url);
  return doGrupo.find(ehPortugues) ?? doGrupo.find((x) => x.padrao) ?? doGrupo[0];
}

export function lerPlaylist(texto: string, base: string): Playlist {
  const segmentos: Segmento[] = [];
  let duracao = 0, fim = false, vod = false, sequencia = 0, alvo = 0;
  let durAtual = 0, desc = false;
  let faixaAtual: { tamanho: number; inicio: number | null } | undefined;
  let chave: Chave | undefined;
  let mapa: Mapa | undefined;
  const fimPorUrl = new Map<string, number>();   // BYTERANGE sem início: continua de onde o anterior do mesmo arquivo parou
  for (const linha of texto.split(/\r?\n/)) {
    const l = linha.trim();
    if (!l) continue;
    if (l.startsWith('#EXTINF:')) durAtual = parseFloat(l.slice(8)) || 0;
    else if (l.startsWith('#EXT-X-BYTERANGE:')) {
      const [n, o] = l.slice(17).split('@');
      faixaAtual = { tamanho: Number(n), inicio: o !== undefined ? Number(o) : null };
    } else if (l.startsWith('#EXT-X-KEY:')) {
      const a = atributos(l.slice(11));
      const metodo = (a.METHOD ?? 'NONE').toUpperCase();
      chave = metodo === 'NONE' ? undefined : { metodo, url: a.URI ? absoluto(a.URI, base) : undefined, iv: a.IV || undefined };
    } else if (l.startsWith('#EXT-X-MAP:')) {
      const a = atributos(l.slice(11));
      let faixa: Faixa | undefined;
      if (a.BYTERANGE) { const [n, o] = a.BYTERANGE.split('@'); faixa = { tamanho: Number(n), inicio: Number(o ?? 0) }; }
      mapa = a.URI ? { url: absoluto(a.URI, base), faixa } : undefined;
    } else if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequencia = Number(l.slice(22)) || 0;
    else if (l.startsWith('#EXT-X-TARGETDURATION:')) alvo = Number(l.slice(22)) || 0;
    else if (l.startsWith('#EXT-X-PLAYLIST-TYPE:')) vod = /VOD/i.test(l);
    else if (l === '#EXT-X-ENDLIST') fim = true;
    else if (l === '#EXT-X-DISCONTINUITY') desc = true;
    else if (!l.startsWith('#')) {
      const url = absoluto(l, base);
      let faixa: Faixa | undefined;
      if (faixaAtual) {
        const inicio = faixaAtual.inicio ?? fimPorUrl.get(url) ?? 0;
        faixa = { tamanho: faixaAtual.tamanho, inicio };
        fimPorUrl.set(url, inicio + faixaAtual.tamanho);
      }
      const s: Segmento = { url, duracao: durAtual };
      if (faixa) s.faixa = faixa;
      if (chave) s.chave = chave;
      if (mapa) s.mapa = mapa;
      if (desc) s.descontinuidade = true;
      segmentos.push(s);
      duracao += durAtual;
      durAtual = 0; faixaAtual = undefined; desc = false;
    }
  }
  return { segmentos, duracao, fim, vod, sequencia, alvo };
}

/** Identidade de um "mapa" (init do fMP4): o mesmo arquivo com outra faixa de bytes é outro init. */
export const idDoMapa = (m: Mapa): string => `${m.url}#${m.faixa ? `${m.faixa.inicio}+${m.faixa.tamanho}` : ''}`;

/** Lista pros arquivos já no disco (o ffmpeg junta a partir dela). Mantém a sequência e as chaves na mesma ordem: sem
 *  IV explícito, o IV de cada pedaço é o número dele (regra do HLS), então tem que bater com a lista original. */
export function playlistLocal(pl: Playlist, nomes: { segmento: (i: number) => string; chave: (url: string) => string; mapa: (id: string) => string }): string {
  const maior = pl.segmentos.reduce((m, s) => Math.max(m, s.duracao), 0);
  const out = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(Math.max(pl.alvo, maior)))}`,
    `#EXT-X-MEDIA-SEQUENCE:${pl.sequencia}`, '#EXT-X-PLAYLIST-TYPE:VOD'];
  let chaveAnterior = '', mapaAnterior = '';
  pl.segmentos.forEach((s, i) => {
    const ch = s.chave ? `${s.chave.metodo}|${s.chave.url ?? ''}|${s.chave.iv ?? ''}` : '';
    if (ch !== chaveAnterior) {
      out.push(s.chave
        ? `#EXT-X-KEY:METHOD=${s.chave.metodo}${s.chave.url ? `,URI="${nomes.chave(s.chave.url)}"` : ''}${s.chave.iv ? `,IV=${s.chave.iv}` : ''}`
        : '#EXT-X-KEY:METHOD=NONE');
      chaveAnterior = ch;
    }
    const mp = s.mapa ? idDoMapa(s.mapa) : '';
    if (mp && mp !== mapaAnterior) { out.push(`#EXT-X-MAP:URI="${nomes.mapa(mp)}"`); mapaAnterior = mp; }
    if (s.descontinuidade) out.push('#EXT-X-DISCONTINUITY');
    out.push(`#EXTINF:${s.duracao.toFixed(3)},`, nomes.segmento(i));
  });
  out.push('#EXT-X-ENDLIST', '');
  return out.join('\n');
}

/** Argumentos do ffmpeg que junta os pedaços num .mp4 sem recodificar (vídeo da 1ª lista; áudio da 2ª, se houver). */
export function argsDoFfmpeg(video: string, audio: string | undefined, saida: string): string[] {
  const entrada = (p: string) => ['-allowed_extensions', 'ALL', '-protocol_whitelist', 'file,crypto,data', '-i', p];
  return ['-hide_banner', '-nostdin', '-y', '-loglevel', 'info', ...entrada(video), ...(audio ? entrada(audio) : []),
    '-map', '0:v:0?', ...(audio ? ['-map', '1:a:0'] : ['-map', '0:a?']), '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', saida];
}

/** Segundos do "time=00:12:34.56" que o ffmpeg escreve enquanto trabalha (null se a linha não tem). */
export function tempoDoFfmpeg(linha: string): number | null {
  const m = /time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(linha);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** "Duration: 00:52:13.40" do ffmpeg (null se a linha não tem). */
export function duracaoDoFfmpeg(linha: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(linha);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** 0–100 (100 só quando terminou de verdade: quem chama segura em 99 até o arquivo final existir). -1 = sem total. */
export function percentual(feito: number, total: number): number {
  if (!(total > 0)) return -1;
  return Math.max(0, Math.min(100, Math.floor((feito / total) * 100)));
}

/** Tamanho total pelo Content-Range ("bytes 100-199/5000" → 5000) ou pelo Content-Length + o que já tinha. -1 = não diz. */
export function totalDaResposta(contentRange: string | null, contentLength: string | null, jaTinha: number): number {
  const m = /\/(\d+)\s*$/.exec(contentRange ?? '');
  if (m) return Number(m[1]);
  const n = Number(contentLength);
  return contentLength !== null && Number.isFinite(n) && n >= 0 ? n + jaTinha : -1;
}

/** Faixa de bytes pedida ao arquivo baixado (o player busca por partes ao avançar). null = arquivo inteiro (200). */
export function faixaDoPedido(cabecalho: string | null, total: number): { inicio: number; fim: number } | null | 'invalida' {
  if (!cabecalho) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(cabecalho.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let inicio: number, fim: number;
  if (!m[1]) {
    const n = Number(m[2]);
    if (n === 0) return 'invalida';
    inicio = Math.max(0, total - n); fim = total - 1;
  } else {
    inicio = Number(m[1]);
    fim = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
  }
  if (inicio >= total || inicio > fim) return 'invalida';
  return { inicio, fim };
}

/** Chave do download (downloads.ts do site): m:<tmdb> ou e:<tmdb>:<temporada>:<episódio>. */
export const chaveValida = (k: unknown): k is string => typeof k === 'string' && /^(?:m:\d+|e:\d+:\d+:\d+)$/.test(k);

/** Nome do arquivo no Windows: "Game of Thrones — T1E1.mp4" (sem os caracteres que o Windows recusa). */
export function nomeDoArquivo(titulo: string | undefined, chave: string): string {
  const p = chave.split(':');
  let base = (titulo ?? '').trim();
  if (!base) base = p[0] === 'm' ? `Filme ${p[1]}` : `Série ${p[1]}`;
  if (p[0] === 'e' && p.length >= 4 && !/\bT\d+\s*E\d+\b/i.test(base)) base = `${base} — T${p[2]}E${p[3]}`;
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (base.length > 120) base = base.slice(0, 120).trim().replace(/[. ]+$/, '');
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `_${base}`;
  return `${base || 'WatchMov'}.mp4`;
}

/** Falha que costuma passar sozinha (= DownloadFailure.isTemporaryStatus): sem resposta, 5xx, 408 ou 429. */
export const falhaTemporaria = (http: number): boolean => http <= 0 || http >= 500 || http === 408 || http === 429;

/** Frase curta do motivo (= DownloadFailure.motivo). `http` = status da resposta que derrubou (0 = sem resposta). */
export function motivoDaFalha(http: number, erro?: string): string {
  if (http === 404 || http === 410) return 'Link expirou: abra o título de novo pra capturar outro';
  if (http === 403 || http === 451) return 'A fonte bloqueou o download: troque a fonte';
  if (http === 504 || http === 408) return 'Servidor da fonte demorou demais pra responder';
  if (http === 502 || http === 503) return 'Servidor da fonte fora do ar';
  if (http >= 400) return `Servidor da fonte respondeu erro ${http}`;
  const e = (erro ?? '').toLowerCase();
  if (/enospc|no space|espaço/.test(e)) return 'Sem espaço no disco';
  if (/timed? ?out|timeout|parou de responder/.test(e)) return 'Servidor da fonte parou de responder';
  if (/name_not_resolved|name_resolution|enotfound|internet_disconnected|address_unreachable|network_changed|network_access_denied/.test(e)) return 'Sem conexão com o servidor da fonte';
  if (/connection_refused|econnrefused/.test(e)) return 'Servidor da fonte recusou a conexão';
  if (/connection_reset|econnreset|connection_closed|connection_aborted|unexpected end|premature|broken pipe|caiu no meio|incomplete_chunked|content_length_mismatch/.test(e)) return 'Conexão com a fonte caiu no meio';
  return erro ? `Falha: ${erro.replace(/^error:\s*/i, '').slice(0, 90)}` : 'Download interrompido';
}

/** "Servidor da fonte parou de responder · parou em 37% · abra a aba Download pra retomar de onde parou". */
export function descreverFalha(motivo: string, percent: number): string {
  const onde = percent > 0 && percent < 100 ? ` · parou em ${Math.round(percent)}%` : '';
  return `${motivo}${onde} · abra a aba Download pra retomar de onde parou`;
}
