// Player completo do app do Windows (W3, plano 07/11/2026) — o mesmo player do APK (PlayerActivity.java), em React:
// barra própria, links, servidor, episódios, próximo episódio com a contagem de 10 s, assistido, pular abertura/resumo,
// qualidade/áudio/legenda (faixas do hls.js), velocidade, tela, teclado e as teclas de mídia do Windows
// (navigator.mediaSession). Quem abre é a ponte (playerDesktop.ts); o resultado e os eventos são os do APK, então o
// VideoPlayer.tsx não muda. As regras (sem DOM, com teste) ficam em playerDesktopRegras.ts.
//
// Regra deste arquivo: o motor (funções chamadas pelos ouvintes do <video>, do hls.js e do teclado, ligados UMA vez na
// montagem) lê só refs; o estado do React serve só pra desenhar.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type HlsT from 'hls.js';
import {
  Check, ChevronLeft, ChevronRight, ListVideo, Loader2, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Server,
  Settings, SkipForward, Volume2, VolumeX, X,
} from 'lucide-react';
import { desktop } from '@/lib/desktop';
import type { SerieDoPlayer } from '@/lib/episodiosPlayer';
import {
  cabecalhosDaReproducao, ehHls, loaderPeloApp, type OpcoesPlayer, type PropsPlayerDesktop, type ResultadoPlayer,
} from '@/lib/playerDesktop';
import {
  AJUSTES_DA_TELA, Contagem, SEM_MARCAS, VELOCIDADES, acaoDaTecla, audioQueComeca, chaveDeSerie, chegouNoAssistido,
  deveRecapturar, episodioDaChave, episodiosDaTemporada, estreiaDoEpisodio, fimDoPulo, idiomaEhPt, inicioDaContagem,
  juntarMarcas, legendaQueLiga, linkVencido, marcasDaIntroDb, marcasDaTheIntroDb, naJanelaDaContagem, niveisDeQualidade,
  pontoDoAssistido, proximoLinkAposFalha, proximoMarcaAssistido, rotuloDaFaixa, rotuloDaVelocidade, rotuloDoLink,
  serieDoPlayer, servidoresDoPlayer, tempo, tipoDoPulo, urlIntroDb, urlTemporadaTmdb, urlTheIntroDb, volumeSalvo,
  type AcaoDaTecla, type EpisodioDaLista, type Marcas,
} from '@/lib/playerDesktopRegras';

type Painel = null | 'ajustes' | 'qualidade' | 'audio' | 'legenda' | 'links' | 'servidor' | 'episodios';
interface Faixa { indice: number; rotulo: string }
interface Falha { code: number; name: string; cause: string; httpCode?: number }

const CHAVE_VOLUME = 'watchmov_player_volume';
const CHAVE_MUDO = 'watchmov_player_mudo';
const ESPERA_PROXIMO_MS = 9_000;        // = PlayerActivity.nextTimeout: o app não respondeu → fecha pedindo o próximo
const ESCONDER_CONTROLES_MS = 3_000;
const ACOES_DE_MIDIA: MediaSessionAction[] = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack'];

const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const duracaoDe = (v: HTMLVideoElement) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : 0);
const posicaoDe = (v: HTMLVideoElement) => Math.max(0, Math.round(v.currentTime * 1000));
function bufferAte(v: HTMLVideoElement): number {
  const b = v.buffered;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) return b.end(i) * 1000;
  return 0;
}

export function PlayerDesktop({ opts, emitir, temOuvinte, controle, aoFechar }: PropsPlayerDesktop) {
  const raizRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsT | null>(null);
  const epRef = useRef<OpcoesPlayer>(opts);                               // o episódio que está tocando
  const linkRef = useRef<{ url: string; mime?: string }>({ url: opts.url, mime: opts.mime });
  const fechadoRef = useRef(false);
  const tentadosRef = useRef(new Set<string>());                         // links que já falharam neste episódio
  const erroTratadoRef = useRef(false);                                  // o erro do link atual já foi tratado
  const jaTocouRef = useRef(false);                                      // o link atual chegou a tocar
  const recuperouRef = useRef(false);                                    // o hls.js já tentou se recuperar de erro de mídia
  const inicioMp4Ref = useRef(0);                                        // posição inicial do mp4 (o HLS usa o startPosition)
  const inicioDoLinkRef = useRef(0);                                     // de onde o link atual tem que começar
  const assistidoRef = useRef(!!opts.watched);
  const desmarcouRef = useRef(false);                                    // desmarcou de propósito: o automático não remarca
  const aguardandoRef = useRef(false);                                   // pediu o próximo e espera o loadNext do app
  const marcasRef = useRef<Marcas>(SEM_MARCAS);
  const chaveMarcasRef = useRef<string | undefined>(undefined);
  const contagemRef = useRef(new Contagem());
  const contagemNaTelaRef = useRef(false);
  const painelRef = useRef<Painel>(null);
  const legendaEscolhidaRef = useRef(false);                             // escolheu a legenda à mão: a regra não troca mais
  const qualidadeRef = useRef('');
  const timersRef = useRef(new Set<number>());
  const esperaProximoRef = useRef<number | null>(null);
  const esconderRef = useRef<number | null>(null);
  const cliqueRef = useRef<number | null>(null);
  const posSessaoRef = useRef(0);

  const [ep, setEp] = useState<OpcoesPlayer>(opts);
  const [linkAtual, setLinkAtual] = useState(opts.url);
  const [tocando, setTocando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [posMs, setPosMs] = useState(0);
  const [durMs, setDurMs] = useState(0);
  const [bufferMs, setBufferMs] = useState(0);
  const [aoVivo, setAoVivo] = useState(false);
  const [volume, setVolume] = useState(1);
  const [mudo, setMudo] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  const [controles, setControles] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [painel, setPainel] = useState<Painel>(null);
  const [assistido, setAssistido] = useState(!!opts.watched);
  const [pulo, setPulo] = useState<'abertura' | 'resumo' | null>(null);
  const [contagemSeg, setContagemSeg] = useState<number | null>(null);
  const [niveis, setNiveis] = useState<Faixa[]>([]);
  const [nivel, setNivel] = useState(-1);
  const [altura, setAltura] = useState(0);
  const [audios, setAudios] = useState<Faixa[]>([]);
  const [audio, setAudio] = useState(-1);
  const [legendas, setLegendas] = useState<Faixa[]>([]);
  const [legenda, setLegenda] = useState(-1);
  const [velocidade, setVelocidade] = useState(1);
  const [ajuste, setAjuste] = useState(0);

  // ── motor ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  function agendar(fn: () => void, ms: number) {
    const id = window.setTimeout(() => { timersRef.current.delete(id); if (!fechadoRef.current) fn(); }, ms);
    timersRef.current.add(id);
  }

  function mudarPainel(p: Painel) {
    painelRef.current = p;
    setPainel(p);
    if (p) setControles(true);
    else mostrarControles();
  }

  function mostrarControles() {
    setControles(true);
    if (esconderRef.current) window.clearTimeout(esconderRef.current);
    esconderRef.current = window.setTimeout(() => {
      esconderRef.current = null;
      const v = videoRef.current;
      if (v && !v.paused && !painelRef.current && !contagemNaTelaRef.current) setControles(false);
    }, ESCONDER_CONTROLES_MS);
  }

  // Onde o vídeo está — ou, com o link ainda sem tocar, de onde ele tinha que começar: trocar de link zera o <video>,
  // e o link seguinte (ou o link novo do app) tem que continuar do mesmo tempo (= o getCurrentPosition do ExoPlayer).
  function posicaoAtual(): number {
    const v = videoRef.current;
    const p = v ? posicaoDe(v) : 0;
    return jaTocouRef.current ? p : Math.max(p, inicioDoLinkRef.current);
  }

  function emitirProgresso() {
    const v = videoRef.current;
    if (!v) return;
    const positionMs = posicaoDe(v);
    if (positionMs <= 0) return;
    const d = duracaoDe(v);
    emitir('playerProgress', { url: linkRef.current.url, positionMs, durationMs: d ? Math.round(d) : undefined });
  }

  function emitirQualidade() {
    const v = videoRef.current;
    if (!v?.videoHeight) return;
    setAltura(v.videoHeight);
    const q = `${v.videoHeight}p`;
    if (q === qualidadeRef.current) return;
    qualidadeRef.current = q;
    emitir('playerQuality', { url: linkRef.current.url, quality: q });
  }

  function marcarAssistido(w: boolean) {
    if (assistidoRef.current === w) return;
    assistidoRef.current = w;
    setAssistido(w);
    emitir('playerWatched', { watched: w, key: epRef.current.key });   // sempre com a chave do episódio que toca
  }

  // Toca um link do episódio a partir de `inicioMs` (troca de link e próximo episódio passam por aqui).
  function tocarLink(url: string, mime: string | undefined, inicioMs: number) {
    const v = videoRef.current;
    if (!v || fechadoRef.current) return;
    try { hlsRef.current?.destroy(); } catch { /* já destruído */ }
    hlsRef.current = null;
    erroTratadoRef.current = false;
    jaTocouRef.current = false;
    recuperouRef.current = false;
    qualidadeRef.current = '';
    legendaEscolhidaRef.current = false;
    linkRef.current = { url, mime };
    setLinkAtual(url);
    setCarregando(true);
    setNiveis([]); setNivel(-1); setAltura(0);
    setAudios([]); setAudio(-1);
    setLegendas([]); setLegenda(-1);
    void desktop?.rede?.reproducao?.(cabecalhosDaReproducao(epRef.current));
    const inicio = inicioMs > 0 ? inicioMs / 1000 : 0;
    inicioDoLinkRef.current = Math.max(0, Math.round(inicioMs));
    inicioMp4Ref.current = 0;
    console.info(`[wm-player] tocando ${ehHls(url, mime) ? 'HLS' : 'MP4'} desde ${tempo(inicioMs)}: ${url.slice(0, 90)}`);
    // Sempre pelo hls.js quando é HLS: o Chromium diz que toca HLS sozinho (canPlayType) e falha com o master.txt das
    // fontes (erro 4, visto em 07/11/2026). O hls.js lê o conteúdo, não a extensão.
    if (ehHls(url, mime)) {
      v.removeAttribute('src');
      v.load();
      import('hls.js').then(({ default: Hls }) => {
        if (fechadoRef.current || linkRef.current.url !== url) return;
        if (!Hls.isSupported()) { inicioMp4Ref.current = inicio; v.src = url; return; }
        const via = desktop?.rede?.videoPeloApp;
        const h = new Hls({
          startPosition: inicio > 0 ? inicio : -1,
          // Sem worker: a CSP do site (worker-src 'self') barra o worker que o hls.js cria por blob:.
          enableWorker: false,
          // Transmissão ao vivo com duração infinita (sem isso vinha a janela de ~40 s): a barra mostra "AO VIVO".
          liveDurationInfinity: true,
          ...(via ? { loader: loaderPeloApp(Hls, (u) => via(u)) } : {}),
        });
        hlsRef.current = h;
        h.on(Hls.Events.MANIFEST_PARSED, () => {
          setNiveis(niveisDeQualidade(h.levels).map(({ indice, rotulo }) => ({ indice, rotulo })));
          void v.play().catch(() => undefined);
        });
        h.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => setAltura(h.levels[d.level]?.height ?? 0));
        h.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => aplicarAudios(h));
        h.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => aplicarLegendas(h));
        h.on(Hls.Events.ERROR, (_e, d) => {
          if (!d.fatal || hlsRef.current !== h) return;
          // Erro de mídia: o hls.js se recupera uma vez (o recomendado por ele) antes de contar como falha do link.
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recuperouRef.current) { recuperouRef.current = true; h.recoverMediaError(); return; }
          falhou({ code: 0, name: `HLS_${String(d.type).toUpperCase()}`, cause: String(d.details), httpCode: d.response?.code });
        });
        h.loadSource(url);
        h.attachMedia(v);
      }).catch(() => { if (!fechadoRef.current && linkRef.current.url === url) { inicioMp4Ref.current = inicio; v.src = url; } });
    } else {
      inicioMp4Ref.current = inicio;
      v.src = url;
      void v.play().catch(() => undefined);
    }
  }

  function aplicarAudios(h: HlsT) {
    const faixas = h.audioTracks.map((t) => ({ lang: t.lang, name: t.name, default: t.default }));
    setAudios(faixas.map((f, i) => ({ indice: i, rotulo: rotuloDaFaixa(f, i) })));
    const i = audioQueComeca(faixas);
    if (i >= 0 && i !== h.audioTrack) h.audioTrack = i;
    setAudio(i >= 0 ? i : h.audioTrack);
  }

  function aplicarLegendas(h: HlsT) {
    const faixas = h.subtitleTracks.map((t) => ({ lang: t.lang, name: t.name, forced: t.forced, default: t.default }));
    setLegendas(faixas.map((f, i) => ({ indice: i, rotulo: rotuloDaFaixa(f, i) })));
    if (legendaEscolhidaRef.current) return;
    const a = h.audioTracks[h.audioTrack];
    // Sem saber a língua do áudio, conta como português: só a forçada liga (legenda a mais num dublado incomoda mais).
    const i = legendaQueLiga(faixas, a ? idiomaEhPt(a.lang, a.name) : true);
    h.subtitleTrack = i;
    h.subtitleDisplay = i >= 0;
    setLegenda(i);
  }

  // O <video> não diz o código HTTP de um mp4 que falhou: um pedido curto pelo app (o mesmo caminho do HLS) descobre.
  async function statusDoLink(url: string): Promise<number | undefined> {
    const via = desktop?.rede?.videoPeloApp;
    if (!via) return undefined;
    try {
      const r = await fetch(via(url), { headers: { Range: 'bytes=0-1' }, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
      try { await r.body?.cancel(); } catch { /* já fechado */ }
      return r.status;
    } catch {
      return undefined;
    }
  }

  async function erroDoVideo() {
    const v = videoRef.current;
    const { url, mime } = linkRef.current;
    if (!v?.error || fechadoRef.current || ehHls(url, mime)) return;   // erro do HLS chega pelo hls.js
    const { code, message } = v.error;
    const httpCode = await statusDoLink(url);
    if (fechadoRef.current || linkRef.current.url !== url) return;
    falhou({ code, name: 'DESKTOP_MEDIA_ERROR', cause: message || `código ${code}`, httpCode });
  }

  // = PlayerActivity.onPlayerError: registra, tenta o próximo link da lista, senão pede link novo ao app, senão avisa.
  function falhou(f: Falha) {
    const e = epRef.current;
    const { url, mime } = linkRef.current;
    console.warn(`[wm-player] erro ${f.name} http=${f.httpCode ?? '-'} ${f.cause.slice(0, 80)} · ${url.slice(0, 80)}`);
    emitir('playerError', { url, code: f.code, httpCode: f.httpCode, name: f.name, cause: f.cause, mime, referer: e.referer, title: e.title });
    if (erroTratadoRef.current || fechadoRef.current) return;
    erroTratadoRef.current = true;
    const posErro = posicaoAtual();   // o próximo link é o MESMO vídeo: continua daqui, não do 0
    tentadosRef.current.add(url);
    const urls = e.urls ?? [];
    const i = urls.indexOf(url);
    const agora = Date.now();
    const prox = proximoLinkAposFalha(urls, i, tentadosRef.current, agora);
    const qual = urls.length > 1 ? `O link ${i >= 0 ? i + 1 : '?'} de ${urls.length}` : 'O link';
    if (prox >= 0) {
      setAviso(`${qual} falhou. Tentando o link ${prox + 1} de ${urls.length}…`);
      agendar(() => tocarLink(urls[prox], e.mimes?.[prox] || undefined, posErro), 700);
    } else if (!e.offline && deveRecapturar(f.httpCode, linkVencido(url, agora), jaTocouRef.current)) {
      // Venceu ou caiu no meio e não sobrou outro: o app pega um link NOVO pelo resolvedor e reabre nesta posição.
      setAviso('Aguarde, pegando um link novo…');
      agendar(() => fechar({ recapture: true }), 900);
    } else {
      setCarregando(false);
      setAviso(`${qual} falhou. Nenhum link tocou: troque de servidor${urls.length > 1 ? ' ou de link (⚙ › Links)' : ''}.`);
    }
  }

  function limparSessaoDeMidia() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    for (const a of ACOES_DE_MIDIA) { try { ms.setActionHandler(a, null); } catch { /* ação que o navegador não tem */ } }
    try { ms.metadata = null; ms.playbackState = 'none'; } catch { /* sem sessão de mídia */ }
  }

  // Teclas de mídia do teclado e o quadro de mídia do Windows (= MediaNotificationService.java).
  function atualizarSessaoDeMidia() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const e = epRef.current;
    try { ms.metadata = new MediaMetadata({ title: e.title || 'WatchMov', artist: e.fonte || 'WatchMov', album: 'WatchMov' }); } catch { /* */ }
    const acoes: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => { void videoRef.current?.play().catch(() => undefined); }],
      ['pause', () => videoRef.current?.pause()],
      ['seekbackward', () => pular(-10_000)],
      ['seekforward', () => pular(10_000)],
      ['seekto', (d) => { const v = videoRef.current; if (v && d.seekTime != null) v.currentTime = d.seekTime; }],
      ['nexttrack', e.hasNext ? () => botaoProximo() : null],
    ];
    for (const [a, f] of acoes) { try { ms.setActionHandler(a, f); } catch { /* ação que o navegador não tem */ } }
  }

  function posicaoDaSessao() {
    const v = videoRef.current;
    if (!v || !('mediaSession' in navigator) || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const agora = performance.now();
    if (agora - posSessaoRef.current < 1_000) return;
    posSessaoRef.current = agora;
    try { navigator.mediaSession.setPositionState({ duration: v.duration, position: Math.min(v.currentTime, v.duration), playbackRate: v.playbackRate || 1 }); } catch { /* */ }
  }

  // Para tudo o que é deste player (idempotente: o fechar e a desmontagem chamam).
  function desligar() {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current.clear();
    for (const r of [esperaProximoRef, esconderRef, cliqueRef]) { if (r.current) window.clearTimeout(r.current); r.current = null; }
    try { hlsRef.current?.destroy(); } catch { /* já destruído */ }
    hlsRef.current = null;
    const v = videoRef.current;
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    limparSessaoDeMidia();
  }

  function fechar(extra: Partial<ResultadoPlayer> = {}) {
    if (fechadoRef.current) return;
    const positionMs = posicaoAtual();
    if (jaTocouRef.current && positionMs > 0) emitirProgresso();
    fechadoRef.current = true;
    desligar();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    const motivo = Object.entries(extra).filter(([, val]) => val !== undefined && val !== false).map(([k, val]) => (val === true ? k : `${k}=${val}`)).join(' ');
    console.info(`[wm-player] fechou em ${tempo(positionMs)}${motivo ? ` (${motivo})` : ''}`);
    aoFechar({ positionMs, url: linkRef.current.url, watched: assistidoRef.current, watchedKey: epRef.current.key, ...extra });
  }

  // Marcas do episódio: TheIntroDB (pelo TMDB) + IntroDB (pelo IMDb da série), as 2 ao mesmo tempo; cada resposta que
  // chega já vale e a outra completa (= PlayerActivity.carregarMarcas). Sem mapa, erro ou sem internet = vazio.
  function carregarMarcas(chave: string | undefined, imdbId: string | undefined) {
    marcasRef.current = SEM_MARCAS;
    chaveMarcasRef.current = chave;
    const serie = chaveDeSerie(chave);
    if (!serie) return;
    let deTheIntroDb: Marcas = SEM_MARCAS;
    let deIntroDb: Marcas = SEM_MARCAS;
    const buscar = (url: string, ehIntroDb: boolean) => {
      fetch(url, { signal: AbortSignal.timeout(10_000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j: unknown) => {
          if (fechadoRef.current || chaveMarcasRef.current !== chave) return;
          if (ehIntroDb) deIntroDb = marcasDaIntroDb(j); else deTheIntroDb = marcasDaTheIntroDb(j);
          const m = juntarMarcas(deTheIntroDb, deIntroDb);
          marcasRef.current = m;
          console.info(`[wm-player] marcas ${chave} (${ehIntroDb ? 'IntroDB' : 'TheIntroDB'}): abertura ${m.abertura.length} · resumo ${m.resumo.length} · créditos ${m.creditos.length}`);
        });
    };
    buscar(urlTheIntroDb(serie), false);
    const u = urlIntroDb(imdbId ?? '', serie);
    if (u) buscar(u, true);
  }

  function mostrarContagem(seg: number | null) {
    contagemNaTelaRef.current = seg !== null;
    setContagemSeg(seg);
    if (seg !== null) { setPulo(null); setControles(true); }
  }

  // 2×/s (= PlayerActivity.atualizarMarcas): "Pular", contagem do próximo e o assistido faltando 1 min.
  function tiqueDasMarcas() {
    const v = videoRef.current;
    if (!v || fechadoRef.current) return;
    const pos = v.currentTime * 1000;
    const dur = duracaoDe(v);
    if (dur > 0 && !assistidoRef.current && !desmarcouRef.current && chegouNoAssistido(pos, dur)) marcarAssistido(true);
    setPulo(dur > 0 && !contagemNaTelaRef.current ? tipoDoPulo(marcasRef.current, pos) : null);
    if (!epRef.current.hasNext || aguardandoRef.current || dur <= 0) { if (contagemNaTelaRef.current) mostrarContagem(null); return; }
    const c = contagemRef.current;
    switch (c.tique(pos, inicioDaContagem(marcasRef.current, dur), !v.paused && !v.ended, v.ended, performance.now())) {
      case 'mostrar':
      case 'atualizar': mostrarContagem(c.segundos()); break;
      case 'esconder': mostrarContagem(null); break;
      case 'pular': irProximo(); break;
      default:
    }
  }

  // Pede o próximo episódio ao app SEM fechar (= requestNext): ele responde com loadNext; sem resposta em 9 s, fecha
  // devolvendo `next` (o app abre o próximo pelo servidor/resolvedor, como antes).
  function pedirProximo() {
    if (aguardandoRef.current || fechadoRef.current) return;
    const v = videoRef.current;
    // Pedir o próximo faltando até 2 min marca o atual (desmarcado à mão fica).
    if (v && !assistidoRef.current && !desmarcouRef.current && proximoMarcaAssistido(marcasRef.current, v.currentTime * 1000, duracaoDe(v))) marcarAssistido(true);
    emitirProgresso();   // a posição do episódio que sai, na chave dele
    if (!temOuvinte('playerNext')) { fechar({ next: true }); return; }
    aguardandoRef.current = true;
    setAviso('Carregando próximo episódio…');
    console.info('[wm-player] pediu o próximo episódio');
    if (esperaProximoRef.current) window.clearTimeout(esperaProximoRef.current);
    esperaProximoRef.current = window.setTimeout(() => {
      esperaProximoRef.current = null;
      if (!aguardandoRef.current) return;
      aguardandoRef.current = false;
      fechar({ next: true });
    }, ESPERA_PROXIMO_MS);
    emitir('playerNext', { auto: false });
  }

  // Zerou a contagem, "Assistir agora" ou ⏭ no fim: pausa, marca assistido (mesmo se desmarcou antes) e vai.
  function irProximo() {
    contagemRef.current.pularAgora();
    mostrarContagem(null);
    videoRef.current?.pause();
    desmarcouRef.current = false;
    marcarAssistido(true);
    pedirProximo();
  }

  function botaoProximo() {
    if (!epRef.current.hasNext) return;
    const v = videoRef.current;
    if (v && naJanelaDaContagem(marcasRef.current, v.currentTime * 1000, duracaoDe(v))) irProximo();
    else pedirProximo();
  }

  function cancelarProximo() {
    contagemRef.current.cancelar();
    mostrarContagem(null);
  }

  // loadNext do app (= loadNextInPlace): o próximo episódio toca neste mesmo player, do zero.
  function carregarProximo(o: Partial<OpcoesPlayer>): boolean {
    if (fechadoRef.current) return false;
    if (esperaProximoRef.current) { window.clearTimeout(esperaProximoRef.current); esperaProximoRef.current = null; }
    if (!aguardandoRef.current) return true;   // = APK: player aberto responde ok e ignora
    aguardandoRef.current = false;
    setAviso(null);
    if (!o.url) { fechar({ next: true }); return true; }   // o app não achou link: fecha e ele abre pelo servidor
    const novo: OpcoesPlayer = { ...epRef.current, ...o, url: o.url, startMs: 0 };
    epRef.current = novo;
    setEp(novo);
    assistidoRef.current = !!o.watched;
    setAssistido(!!o.watched);
    desmarcouRef.current = false;
    contagemRef.current = new Contagem();
    mostrarContagem(null);
    setPulo(null);
    tentadosRef.current = new Set();
    mudarPainel(null);
    console.info(`[wm-player] próximo episódio no mesmo player: ${novo.key ?? '?'}`);
    carregarMarcas(novo.key, novo.imdbId);
    atualizarSessaoDeMidia();
    tocarLink(novo.url, novo.mime, 0);   // avançar = começar do zero (nunca herda o tempo do anterior)
    return true;
  }

  // = toggleWatched: marca e pula (com próximo, pro ponto da contagem, que abre na hora) ou desmarca.
  function botaoAssistido() {
    const v = videoRef.current;
    if (assistidoRef.current) { desmarcouRef.current = true; marcarAssistido(false); return; }
    marcarAssistido(true);
    if (!v) return;
    const comContagem = !!epRef.current.hasNext && !aguardandoRef.current;
    const alvo = pontoDoAssistido(marcasRef.current, v.currentTime * 1000, duracaoDe(v), comContagem);
    if (alvo >= 0) v.currentTime = alvo / 1000;
    if (comContagem) {
      void v.play().catch(() => undefined);
      contagemRef.current.rearmar();
      tiqueDasMarcas();
    }
  }

  function pularTrecho() {
    const v = videoRef.current;
    if (!v) return;
    const fim = fimDoPulo(marcasRef.current, posicaoDe(v));
    if (fim > 0) v.currentTime = fim / 1000;
    setPulo(null);
  }

  function pular(deltaMs: number) {
    const v = videoRef.current;
    if (!v) return;
    const fim = Number.isFinite(v.duration) ? v.duration : Number.POSITIVE_INFINITY;
    v.currentTime = Math.min(fim, Math.max(0, v.currentTime + deltaMs / 1000));
  }

  function alternarPlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play().catch(() => undefined);
    else v.pause();
  }

  function mudarVolume(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.volume = Math.min(1, Math.max(0, Math.round((v.volume + delta) * 100) / 100));
  }

  function alternarTelaCheia() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void raizRef.current?.requestFullscreen().catch(() => undefined);
  }

  function executar(acao: AcaoDaTecla) {
    switch (acao) {
      case 'play-pausa': alternarPlay(); break;
      case 'voltar': pular(-10_000); break;
      case 'avancar': pular(10_000); break;
      case 'volume+': mudarVolume(0.1); break;
      case 'volume-': mudarVolume(-0.1); break;
      case 'mudo': if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; break;
      case 'tela-cheia': alternarTelaCheia(); break;
      case 'proximo': botaoProximo(); break;
      case 'fechar': fechar(); break;
      default:
    }
  }

  function botaoServidor() {
    if (!servidoresDoPlayer(epRef.current.servidores).length) { fechar({ server: true }); return; }
    mudarPainel(painelRef.current === 'servidor' ? null : 'servidor');
  }

  function escolherLink(i: number) {
    const e = epRef.current;
    const u = e.urls?.[i];
    const v = videoRef.current;
    mudarPainel(null);
    if (!u || !v || u === linkRef.current.url) return;
    setAviso(null);
    tocarLink(u, e.mimes?.[i] || undefined, posicaoAtual());   // continua no mesmo tempo
  }

  function escolherNivel(i: number) {
    const h = hlsRef.current;
    mudarPainel(null);
    if (!h) return;
    h.currentLevel = i;   // -1 = automático
    setNivel(i);
  }

  function escolherAudio(i: number) {
    const h = hlsRef.current;
    mudarPainel(null);
    if (!h) return;
    h.audioTrack = i;
    setAudio(i);
    aplicarLegendas(h);   // a legenda "padrão" depende da língua do áudio (se ele não escolheu uma à mão)
  }

  function escolherLegenda(i: number) {
    const h = hlsRef.current;
    mudarPainel(null);
    if (!h) return;
    legendaEscolhidaRef.current = true;
    h.subtitleTrack = i;
    h.subtitleDisplay = i >= 0;
    setLegenda(i);
  }

  function escolherEpisodio(t: number, e: number, visto: boolean) {
    const atual = episodioDaChave(epRef.current.key);
    if (atual && atual.temporada === t && atual.episodio === e) { mudarPainel(null); return; }
    fechar({ episodio: `${t}:${e}`, episodioVisto: visto });   // o app abre esse episódio e volta pro player sozinho
  }

  function ciclarVelocidade() {
    const v = videoRef.current;
    if (!v) return;
    const lista: readonly number[] = VELOCIDADES;
    v.playbackRate = lista[(lista.indexOf(v.playbackRate) + 1) % lista.length];
  }

  // Clique no vídeo: tocar/pausar; duplo clique: tela cheia (o clique simples espera pra não pausar no duplo).
  function cliqueNoVideo() {
    if (painelRef.current) { mudarPainel(null); return; }
    if (cliqueRef.current) return;
    cliqueRef.current = window.setTimeout(() => { cliqueRef.current = null; alternarPlay(); }, 220);
  }
  function duploCliqueNoVideo() {
    if (cliqueRef.current) { window.clearTimeout(cliqueRef.current); cliqueRef.current = null; }
    alternarTelaCheia();
  }

  // ── montagem: ouvintes ligados uma vez ────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    v.volume = volumeSalvo(ler(CHAVE_VOLUME));
    v.muted = ler(CHAVE_MUDO) === '1';
    setVolume(v.volume);
    setMudo(v.muted);
    const ouvir = (evento: keyof HTMLMediaElementEventMap, fn: () => void) => {
      v.addEventListener(evento, fn);
      return () => v.removeEventListener(evento, fn);
    };
    const duracao = () => { setDurMs(duracaoDe(v)); setAoVivo(v.duration === Number.POSITIVE_INFINITY); };
    const soltar = [
      ouvir('loadedmetadata', () => {
        duracao();
        if (inicioMp4Ref.current > 0 && v.currentTime < 1) v.currentTime = inicioMp4Ref.current;
        inicioMp4Ref.current = 0;
        emitirQualidade();
      }),
      ouvir('durationchange', duracao),
      ouvir('resize', emitirQualidade),
      ouvir('timeupdate', () => { setPosMs(posicaoDe(v)); posicaoDaSessao(); }),
      ouvir('progress', () => setBufferMs(bufferAte(v))),
      ouvir('play', () => { setTocando(true); try { navigator.mediaSession.playbackState = 'playing'; } catch { /* */ } }),
      ouvir('playing', () => {
        setTocando(true);
        setCarregando(false);
        jaTocouRef.current = true;
        if (!aguardandoRef.current) setAviso(null);
      }),
      ouvir('pause', () => { setTocando(false); setControles(true); try { navigator.mediaSession.playbackState = 'paused'; } catch { /* */ } }),
      ouvir('waiting', () => setCarregando(true)),
      ouvir('canplay', () => setCarregando(false)),
      ouvir('seeking', () => setPosMs(posicaoDe(v))),
      ouvir('seeked', () => { setCarregando(false); setPosMs(posicaoDe(v)); }),
      ouvir('ended', () => { setTocando(false); setControles(true); tiqueDasMarcas(); }),
      ouvir('error', () => { void erroDoVideo(); }),
      ouvir('volumechange', () => {
        setVolume(v.volume);
        setMudo(v.muted);
        gravar(CHAVE_VOLUME, String(v.volume));
        gravar(CHAVE_MUDO, v.muted ? '1' : '0');
      }),
      ouvir('ratechange', () => setVelocidade(v.playbackRate)),
    ];
    const tela = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', tela);
    const parar = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    const tecla = (e: KeyboardEvent) => {
      if (fechadoRef.current) return;
      // As teclas de mídia do teclado chegam pela mediaSession (senão cada toque contava 2 vezes).
      if (e.key.startsWith('Media') && 'mediaSession' in navigator) return;
      const cheia = !!document.fullscreenElement;
      if (e.key === 'Escape' && !cheia) {
        if (painelRef.current) { parar(e); mudarPainel(null); return; }           // Esc fecha o painel antes
        if (contagemNaTelaRef.current) { parar(e); cancelarProximo(); return; }   // …e a contagem
      }
      const acao = acaoDaTecla(e, cheia);
      if (!acao || (acao === 'proximo' && !epRef.current.hasNext)) return;
      parar(e);
      mostrarControles();
      executar(acao);
    };
    window.addEventListener('keydown', tecla, true);
    const relogioProgresso = window.setInterval(() => { if (!v.paused && !v.ended) emitirProgresso(); }, 5_000);
    const relogioMarcas = window.setInterval(tiqueDasMarcas, 500);
    controle.fechar = () => fechar();
    controle.carregarProximo = carregarProximo;
    atualizarSessaoDeMidia();
    carregarMarcas(opts.key, opts.imdbId);
    tocarLink(opts.url, opts.mime, opts.startMs ?? 0);
    mostrarControles();
    return () => {
      for (const s of soltar) s();
      document.removeEventListener('fullscreenchange', tela);
      window.removeEventListener('keydown', tecla, true);
      window.clearInterval(relogioProgresso);
      window.clearInterval(relogioMarcas);
      controle.fechar = undefined;
      controle.carregarProximo = undefined;
      desligar();
    };
    // Uma vez só: o motor lê refs (ver a regra no topo do arquivo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── tela ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  const serie = useMemo(() => serieDoPlayer(ep.episodios), [ep.episodios]);
  const servidores = useMemo(() => servidoresDoPlayer(ep.servidores), [ep.servidores]);
  const epAtual = episodioDaChave(ep.key);
  const urls = ep.urls ?? [];
  const pct = durMs > 0 ? Math.min(100, (posMs / durMs) * 100) : 0;
  const pctBuffer = durMs > 0 ? Math.min(100, (bufferMs / durMs) * 100) : 0;
  const rotuloQualidade = nivel === -1 ? (altura ? `Auto (${altura}p)` : 'Auto') : niveis.find((n) => n.indice === nivel)?.rotulo ?? 'Auto';
  const visivel = controles || !tocando;
  const esmaecer = `transition-opacity duration-300 ${visivel ? 'opacity-100' : 'pointer-events-none opacity-0'}`;
  const trilha = '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white';

  return (
    <div
      ref={raizRef}
      data-player-desktop=""
      data-chave={ep.key ?? ''}
      data-link={linkAtual.slice(0, 120)}
      className="absolute inset-0 select-none overflow-hidden bg-black text-white"
      style={{ cursor: visivel ? 'default' : 'none' }}
      onMouseMove={mostrarControles}
      onMouseDown={mostrarControles}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full"
        style={{ objectFit: AJUSTES_DA_TELA[ajuste].fit }}
        onClick={cliqueNoVideo}
        onDoubleClick={duploCliqueNoVideo}
      />

      {carregando && !aviso && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="h-12 w-12 animate-spin text-white/80" />
        </div>
      )}
      {aviso && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6">
          <span data-aviso="" className="max-w-xl rounded-xl bg-black/75 px-4 py-2.5 text-center text-sm leading-relaxed">{aviso}</span>
        </div>
      )}

      {/* topo: título, de onde vem e fechar */}
      <div className={`absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/85 to-transparent px-5 pb-10 pt-4 ${esmaecer}`}>
        <div className="min-w-0 flex-1">
          <div data-titulo="" className="truncate text-base font-semibold drop-shadow">{ep.title}</div>
          {(ep.fonte || ep.downloaded) && (
            <div className="truncate text-xs text-white/65">{[ep.fonte, ep.downloaded ? 'Baixado' : ''].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        <BotaoIcone rotulo="Fechar o player (Esc)" acao="fechar" onClick={() => fechar()}><X className="h-5 w-5" /></BotaoIcone>
      </div>

      {/* Pular abertura/resumo (sem "+1 min" nem "Cancelar", pedido dele 06/11/2026) */}
      {pulo && contagemSeg === null && (
        <button
          type="button"
          data-acao="pular"
          onClick={(e) => { e.stopPropagation(); pularTrecho(); }}
          className="absolute bottom-32 right-8 z-20 rounded-full border border-white/30 bg-black/70 px-5 py-2.5 text-sm font-semibold shadow-lg backdrop-blur transition hover:bg-white hover:text-black"
        >
          {pulo === 'resumo' ? 'Pular resumo' : 'Pular abertura'}
        </button>
      )}

      {/* contagem do próximo episódio (= o cartão do APK) */}
      {contagemSeg !== null && (
        <div data-contagem="" className="absolute bottom-32 right-8 z-20 rounded-2xl border border-white/20 bg-[#15121D]/95 px-5 py-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="text-lg font-bold">Próximo episódio em {contagemSeg} s</div>
          <div className="mt-3 flex gap-2">
            <button type="button" data-acao="assistir-agora" onClick={irProximo} className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500">
              ▶ Assistir agora
            </button>
            <button type="button" data-acao="cancelar-proximo" onClick={cancelarProximo} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* barra de baixo */}
      <div className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-5 pb-4 pt-14 ${esmaecer}`} onClick={(e) => e.stopPropagation()}>
        {aoVivo ? (
          <div className="mb-1 flex items-center gap-2 text-xs font-bold tracking-wide"><span className="h-2 w-2 rounded-full bg-red-500" />AO VIVO</div>
        ) : (
          <input
            type="range"
            aria-label="Linha do tempo"
            data-acao="linha-do-tempo"
            min={0}
            max={Math.max(1, Math.round(durMs))}
            step={1000}
            value={Math.min(posMs, Math.round(durMs))}
            onChange={(e) => { const v = videoRef.current; if (v) v.currentTime = Number(e.target.value) / 1000; }}
            className={`h-1 w-full cursor-pointer appearance-none rounded-full ${trilha}`}
            style={{ background: `linear-gradient(to right, #8b5cf6 ${pct}%, rgba(255,255,255,.45) ${pct}%, rgba(255,255,255,.45) ${Math.max(pct, pctBuffer)}%, rgba(255,255,255,.18) ${Math.max(pct, pctBuffer)}%)` }}
          />
        )}
        <div className="mt-2 flex items-center gap-1">
          <BotaoIcone rotulo={tocando ? 'Pausar (espaço)' : 'Tocar (espaço)'} acao="play" onClick={alternarPlay}>
            {tocando ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </BotaoIcone>
          {!aoVivo && <BotaoIcone rotulo="Voltar 10 s (←)" acao="voltar" onClick={() => pular(-10_000)}><RotateCcw className="h-5 w-5" /></BotaoIcone>}
          {!aoVivo && <BotaoIcone rotulo="Avançar 10 s (→)" acao="avancar" onClick={() => pular(10_000)}><RotateCw className="h-5 w-5" /></BotaoIcone>}
          <BotaoIcone rotulo={mudo ? 'Tirar o mudo (M)' : 'Mudo (M)'} acao="mudo" onClick={() => executar('mudo')}>
            {mudo || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </BotaoIcone>
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.05}
            value={mudo ? 0 : volume}
            onChange={(e) => { const v = videoRef.current; if (v) { v.muted = false; v.volume = Number(e.target.value); } }}
            className={`mr-2 h-1 w-24 cursor-pointer appearance-none rounded-full ${trilha}`}
            style={{ background: `linear-gradient(to right, #fff ${(mudo ? 0 : volume) * 100}%, rgba(255,255,255,.25) ${(mudo ? 0 : volume) * 100}%)` }}
          />
          {!aoVivo && <span data-tempo="" className="text-sm tabular-nums text-white/80">{tempo(posMs)} / {tempo(durMs)}</span>}
          <div className="flex-1" />
          {!aoVivo && ep.key && (
            <button
              type="button"
              data-acao="assistido"
              aria-pressed={assistido}
              onClick={botaoAssistido}
              className={`mr-1 rounded-full px-3 py-1.5 text-sm font-medium transition hover:bg-white/15 ${assistido ? 'text-green-400' : 'text-white/70'}`}
            >
              {assistido ? '✓ Assistido' : 'Não assistido'}
            </button>
          )}
          {serie && (
            <BotaoIcone rotulo="Episódios" acao="episodios" ativo={painel === 'episodios'} onClick={() => mudarPainel(painel === 'episodios' ? null : 'episodios')}>
              <ListVideo className="h-5 w-5" />
            </BotaoIcone>
          )}
          {!aoVivo && ep.key && (
            <BotaoIcone rotulo="Servidor" acao="servidor" ativo={painel === 'servidor'} onClick={botaoServidor}><Server className="h-5 w-5" /></BotaoIcone>
          )}
          {ep.hasNext && (
            <BotaoIcone rotulo="Próximo episódio (N)" acao="proximo" onClick={botaoProximo}><SkipForward className="h-5 w-5" /></BotaoIcone>
          )}
          <BotaoIcone rotulo="Ajustes" acao="ajustes" ativo={painel !== null && painel !== 'episodios' && painel !== 'servidor'} onClick={() => mudarPainel(painel ? null : 'ajustes')}>
            <Settings className="h-5 w-5" />
          </BotaoIcone>
          <BotaoIcone rotulo={telaCheia ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'} acao="tela-cheia" onClick={alternarTelaCheia}>
            {telaCheia ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </BotaoIcone>
        </div>
      </div>

      {painel === 'ajustes' && (
        <Caixa titulo="Ajustes" aoFechar={() => mudarPainel(null)}>
          <Linha rotulo="Velocidade" valor={rotuloDaVelocidade(velocidade)} acao="velocidade" onClick={ciclarVelocidade} />
          <Linha rotulo="Tela" valor={AJUSTES_DA_TELA[ajuste].rotulo} acao="tela" onClick={() => setAjuste((a) => (a + 1) % AJUSTES_DA_TELA.length)} />
          {niveis.length > 2 && <Linha rotulo="Qualidade" valor={rotuloQualidade} seta acao="qualidade" onClick={() => mudarPainel('qualidade')} />}
          {audios.length > 1 && <Linha rotulo="Áudio" valor={audios.find((a) => a.indice === audio)?.rotulo} seta acao="audio" onClick={() => mudarPainel('audio')} />}
          {legendas.length > 0 && (
            <Linha rotulo="Legenda" valor={legenda >= 0 ? legendas.find((l) => l.indice === legenda)?.rotulo : 'Desligada'} seta acao="legenda" onClick={() => mudarPainel('legenda')} />
          )}
          {urls.length > 1 && <Linha rotulo="Links" valor={`${urls.length} links`} seta acao="links" onClick={() => mudarPainel('links')} />}
        </Caixa>
      )}
      {painel === 'qualidade' && (
        <Caixa titulo="Qualidade" voltar={() => mudarPainel('ajustes')} aoFechar={() => mudarPainel(null)}>
          {niveis.map((n) => <Linha key={n.indice} rotulo={n.indice === -1 && altura ? `Auto (${altura}p)` : n.rotulo} marcado={n.indice === nivel} onClick={() => escolherNivel(n.indice)} />)}
        </Caixa>
      )}
      {painel === 'audio' && (
        <Caixa titulo="Áudio" voltar={() => mudarPainel('ajustes')} aoFechar={() => mudarPainel(null)}>
          {audios.map((a) => <Linha key={a.indice} rotulo={a.rotulo} marcado={a.indice === audio} onClick={() => escolherAudio(a.indice)} />)}
        </Caixa>
      )}
      {painel === 'legenda' && (
        <Caixa titulo="Legenda" voltar={() => mudarPainel('ajustes')} aoFechar={() => mudarPainel(null)}>
          <Linha rotulo="Desligada" marcado={legenda < 0} onClick={() => escolherLegenda(-1)} />
          {legendas.map((l) => <Linha key={l.indice} rotulo={l.rotulo} marcado={l.indice === legenda} onClick={() => escolherLegenda(l.indice)} />)}
        </Caixa>
      )}
      {painel === 'links' && (
        <Caixa titulo="Links" voltar={() => mudarPainel('ajustes')} aoFechar={() => mudarPainel(null)}>
          {urls.map((u, i) => (
            <Linha key={`${i}-${u}`} rotulo={rotuloDoLink(i, u, ep.mimes?.[i], ep.qualities?.[i])} marcado={u === linkAtual} acao={`link-${i + 1}`} onClick={() => escolherLink(i)} />
          ))}
        </Caixa>
      )}
      {painel === 'servidor' && (
        <Caixa titulo="Servidor" aoFechar={() => mudarPainel(null)}>
          <Linha rotulo="Abrir servidores" acao="abrir-servidores" onClick={() => fechar({ server: true })} />
          {servidores.map((s) => (
            <Linha key={s.id} rotulo={s.rotulo} marcado={s.id === ep.servidorAtual} acao={`servidor-${s.id}`} onClick={() => fechar({ serverId: s.id })} />
          ))}
        </Caixa>
      )}
      {painel === 'episodios' && serie && (
        <PainelEpisodios serie={serie} atual={epAtual} aoEscolher={escolherEpisodio} aoFechar={() => mudarPainel(null)} />
      )}
    </div>
  );
}

// ── peças da tela ───────────────────────────────────────────────────────────────────────────────────────────────────

function BotaoIcone({ rotulo, acao, ativo, onClick, children }: { rotulo: string; acao: string; ativo?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      data-acao={acao}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${ativo ? 'bg-white/15' : ''}`}
    >
      {children}
    </button>
  );
}

function Caixa({ titulo, voltar, aoFechar, larga, children }: { titulo: string; voltar?: () => void; aoFechar: () => void; larga?: boolean; children: ReactNode }) {
  return (
    <div
      data-painel={titulo}
      onClick={(e) => e.stopPropagation()}
      className={`absolute bottom-24 right-4 z-30 flex max-h-[calc(100%-11rem)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#15121D]/95 shadow-2xl backdrop-blur ${larga ? 'w-[min(560px,calc(100%-2rem))]' : 'w-80'}`}
    >
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-2">
        {voltar && (
          <button type="button" aria-label="Voltar" onClick={voltar} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><ChevronLeft className="h-5 w-5" /></button>
        )}
        <span className={`flex-1 text-sm font-semibold ${voltar ? '' : 'pl-2'}`}>{titulo}</span>
        <button type="button" aria-label="Fechar" onClick={aoFechar} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      <div className="overflow-y-auto p-1.5">{children}</div>
    </div>
  );
}

function Linha({ rotulo, valor, marcado, seta, acao, onClick }: { rotulo: string; valor?: string; marcado?: boolean; seta?: boolean; acao?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-acao={acao}
      aria-pressed={marcado}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
    >
      <span className="grid w-4 shrink-0 place-items-center">{marcado && <Check className="h-4 w-4 text-violet-400" />}</span>
      <span className="flex-1 truncate">{rotulo}</span>
      {valor && <span className="max-w-[45%] truncate text-xs text-white/60">{valor}</span>}
      {seta && <ChevronRight className="h-4 w-4 shrink-0 text-white/50" />}
    </button>
  );
}

// Painel "Episódios" (= EpisodiosPainel.java): temporadas, nome/imagem/data pela TMDB, assistidos e onde parou, que o
// app manda na abertura. Abre no episódio que está tocando; escolher outro fecha o player e o app abre esse.
function PainelEpisodios({ serie, atual, aoEscolher, aoFechar }: {
  serie: SerieDoPlayer;
  atual: { temporada: number; episodio: number } | null;
  aoEscolher: (temporada: number, episodio: number, visto: boolean) => void;
  aoFechar: () => void;
}) {
  const [temporada, setTemporada] = useState(() =>
    atual && serie.temporadas.some((t) => t.n === atual.temporada) ? atual.temporada : serie.temporadas[0].n);
  const [listas, setListas] = useState<Record<number, EpisodioDaLista[]>>({});
  const listaRef = useRef<HTMLDivElement>(null);
  const t = serie.temporadas.find((x) => x.n === temporada) ?? serie.temporadas[0];
  const pronta = listas[t.n];

  useEffect(() => {
    if (pronta || !serie.chave) return undefined;
    let vivo = true;
    fetch(urlTemporadaTmdb(serie.tmdb, t.n, serie.chave), { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: unknown) => { if (vivo) setListas((m) => ({ ...m, [t.n]: episodiosDaTemporada(j, t.total) })); });
    return () => { vivo = false; };
  }, [t.n, t.total, pronta, serie.chave, serie.tmdb]);

  // Abre com o episódio que toca no meio da lista (= o foco no EP atual do APK).
  useEffect(() => {
    if (!atual || atual.temporada !== t.n) return;
    listaRef.current?.querySelector<HTMLElement>('[data-atual]')?.scrollIntoView({ block: 'center' });
  }, [atual, t.n, pronta]);

  const eps = pronta ?? episodiosDaTemporada(null, t.total);
  const hoje = new Date();
  return (
    <Caixa titulo="Episódios" larga aoFechar={aoFechar}>
      {serie.temporadas.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-1.5 pb-2 pt-1">
          {serie.temporadas.map((x) => (
            <button
              key={x.n}
              type="button"
              data-temporada={x.n}
              onClick={() => setTemporada(x.n)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${x.n === t.n ? 'bg-violet-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}
            >
              T{x.n}
            </button>
          ))}
        </div>
      )}
      <div ref={listaRef} className="flex flex-col gap-1">
        {eps.map((e) => {
          const visto = t.vistos.includes(e.n);
          const parou = t.pct[String(e.n)];
          const ehAtual = !!atual && atual.temporada === t.n && atual.episodio === e.n;
          const estreia = estreiaDoEpisodio(e.data, hoje);
          const minutos = e.minutos ?? t.min;
          return (
            <button
              key={e.n}
              type="button"
              data-episodio={`${t.n}:${e.n}`}
              {...(ehAtual ? { 'data-atual': '' } : {})}
              onClick={() => aoEscolher(t.n, e.n, visto)}
              className={`flex items-center gap-3 rounded-xl p-2 text-left transition hover:bg-white/10 ${ehAtual ? 'bg-violet-600/25 ring-1 ring-violet-400/60' : ''}`}
            >
              <div className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-white/10">
                {e.imagem && <img src={e.imagem} alt="" loading="lazy" className="h-full w-full object-cover" />}
                {parou ? (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50"><div className="h-full bg-violet-500" style={{ width: `${parou}%` }} /></div>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.n}. {e.nome}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/55">
                  {ehAtual && <span className="text-violet-300">Tocando</span>}
                  {visto && <span className="text-green-400">✓ Assistido</span>}
                  {estreia && <span>{estreia}</span>}
                  {minutos ? <span>{minutos} min</span> : null}
                </div>
              </div>
            </button>
          );
        })}
        {!pronta && serie.chave && (
          <div className="grid place-items-center py-2"><Loader2 className="h-4 w-4 animate-spin text-white/50" /></div>
        )}
      </div>
    </Caixa>
  );
}
