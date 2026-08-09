import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Tv, Copy, Smartphone, Layers, Check, Loader2, Subtitles, Maximize, Minimize, CheckSquare, Square, SkipForward, ChevronUp, Server, Sparkles, ListVideo, Download, Trash2, MoreVertical } from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import Hls from 'hls.js';
import { toast } from 'sonner';
import { PROVIDERS, type PlayerTarget } from '@/lib/players';
import { getTorrentStream, destroyTorrent } from '@/lib/torrentClient';
import { fetchSubtitles, srtUrlToVttBlob, type StremioSubtitle } from '@/lib/stremio';
import { watchStream, isNative, type SniffResult } from '@/lib/streamSniffer';
import { getEntry, addStreams, setChosen, setServerMode, setStreamPosition, streamKey, qualityFromUrl, removeStream } from '@/lib/streamCache';
import { playNative, loadNextNative, clearResumeNative, onPlayerProgress, onPlayerQuality, onPlayerWatched, onPlayerError, onPlayerNext } from '@/lib/nativePlayer';
import { listExternalApps, castToExternal, type ExternalApp } from '@/lib/externalCast';
import { enqueueDownload, removeDownload, isDownloaded, useDownloadItem, getDownloadMeta, movieKey, epKey } from '@/lib/downloads';
import { downloadAsMp4 } from '@/lib/mp4Download';
import { supabase } from '@/lib/supabase';

// Sinaliza (entre remounts) que o usuário veio do "Próximo ep" — o novo ep abre
// no reprodutor se já tiver link capturado.
let pendingNextInPlayer = false;

// VARIANTE/FAIXA (playlist de 1 rendition ou faixa isolada: /m3/ vídeo, /md/ áudio,
// index-fN-vN-aN) vs COMPLETO/MASTER (multivariante master.* ou arquivo full .mp4).
// Usado p/ rotular, agrupar em abas e escopar o auto-avanço/handoff.
const isTrackOnly = (u: string) => /\/m3\/|\/md\/|index-f\d|-v\d-a\d/i.test(u || '');

interface ScreenCastPlugin { openCast(): Promise<void>; }
const ScreenCast = registerPlugin<ScreenCastPlugin>('ScreenCast');

interface ImmersivePlugin { enter(): Promise<void>; exit(): Promise<void>; toggleOrientation(): Promise<void>; }
const Immersive = registerPlugin<ImmersivePlugin>('Immersive');

interface VideoPlayerProps {
  open: boolean;
  onClose: () => void;
  tmdbId?: number;
  imdbId?: string;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  posterUrl?: string;
  resumeAt?: number;          // segundos (só VidAPI usa)
  directUrl?: string;         // stream HTTP direto (Stremio) — toca em <video>, ignora provedores
  torrent?: { magnet: string; fileIdx?: number };  // WebTorrent (Stremio sem debrid)
  onProgress?: (seconds: number) => void;
  onCompleted?: () => void;
  watched?: boolean;               // assistido (episódio atual ou filme)
  onSetWatched?: (v: boolean) => void;  // define a marcação de assistido (true/false)
  onNext?: () => void;             // série: avança pro próximo episódio
}

export default function VideoPlayer(props: VideoPlayerProps) {
  const { open, onClose, tmdbId, imdbId, type, season, episode, title, posterUrl, resumeAt, directUrl, torrent, onProgress, onCompleted, watched, onSetWatched, onNext } = props;
  const lastSavedRef = useRef(0);
  const completedRef = useRef(false);
  const [castOpen, setCastOpen] = useState(false);
  const [extApps, setExtApps] = useState<ExternalApp[]>([]);   // players externos instalados (WVC/VLC/MX)
  const [sourceOpen, setSourceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);   // menu ⋮ (tela cheia / espelhar)
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Captura passiva (estilo Web Video Cast): o iframe do servidor toca normal e o
  // nativo observa o tráfego, ACUMULANDO todos os vídeos detectados (o usuário
  // escolhe qual — resolve anúncio/servidor interno). O escolhido toca no ExoPlayer
  // nativo e fica no cache (reabre direto + retoma de onde parou).
  const [capturedList, setCapturedList] = useState<SniffResult[]>([]);   // vídeos detectados
  const [pickerOpen, setPickerOpen] = useState(false);                   // lista pra escolher
  const [dlAsk, setDlAsk] = useState<SniffResult | null>(null);          // escolha do formato do download
  const [pickerTab, setPickerTab] = useState<'master' | 'faixa'>('master'); // aba do picker
  const [ownStream, setOwnStream] = useState<SniffResult | null>(null);  // escolhido
  const [preferIframe, setPreferIframe] = useState(false);               // ficar no servidor
  const playedRef = useRef(false);   // evita reabrir o ExoPlayer em loop
  // Espelho do stream atual: o listener de progresso precisa do valor NA HORA do
  // evento (a closure do state fica velha) pra descartar o progresso do ep anterior.
  const ownStreamRef = useRef<SniffResult | null>(null);
  useEffect(() => { ownStreamRef.current = ownStream; });
  // Player nativo ABERTO: o "Próximo episódio" entrega o link pra ele em vez de
  // abrir outra Activity (senão a sessão de espelhamento na TV se perde).
  const playerOpenRef = useRef(false);
  const awaitingNextRef = useRef(false);   // pediu o próximo ep (evento playerNext)
  // Episódio que está REALMENTE tocando no player (muda sem remontar o efeito) —
  // sem isso a posição final do último ep era gravada na chave do PRIMEIRO.
  const curEpRef = useRef<{ tmdbId?: number; type: 'movie' | 'tv'; season?: number; episode?: number }>({ tmdbId, type, season, episode });
  const onNextRef = useRef(onNext);
  useEffect(() => { onNextRef.current = onNext; });

  // Legendas (modo <video>: directUrl/torrent). Stremio OpenSubtitles → .srt → blob VTT.
  const [subsOpen, setSubsOpen] = useState(false);
  const [subList, setSubList] = useState<StremioSubtitle[]>([]);
  const [subVtt, setSubVtt] = useState<string | null>(null);   // blob URL ativo
  const [subId, setSubId] = useState<string | null>(null);     // legenda selecionada (null = off)

  // Modo torrent (WebTorrent): resolve a streamURL de forma assíncrona.
  const [tor, setTor] = useState<{ loading: boolean; url?: string; name?: string; playable?: boolean; id?: string; error?: string }>({ loading: false });
  useEffect(() => {
    if (!open || !torrent) return;
    let alive = true;
    let torrentId: string | undefined;
    setTor({ loading: true });
    getTorrentStream(torrent.magnet, torrent.fileIdx)
      .then(s => { if (alive) { torrentId = s.torrentId; setTor({ loading: false, url: s.url, name: s.name, playable: s.playable, id: s.torrentId }); } })
      .catch(e => { if (alive) setTor({ loading: false, error: e instanceof Error ? e.message : 'Falha ao carregar torrent' }); });
    return () => { alive = false; if (torrentId) destroyTorrent(torrentId); };
  }, [open, torrent]);

  // Buscar legendas PT só no modo <video> (directUrl/torrent) e com imdbId.
  useEffect(() => {
    if (!open || !(directUrl || torrent) || !imdbId) { setSubList([]); return; }
    let alive = true;
    fetchSubtitles({ imdbId, type, season, episode })
      .then(list => { if (alive) setSubList(list); })
      .catch(() => { if (alive) setSubList([]); });
    return () => { alive = false; };
  }, [open, directUrl, torrent, imdbId, type, season, episode]);

  // Trocar legenda ativa: baixa .srt → VTT blob; revoga o anterior.
  const pickSubtitle = async (s: StremioSubtitle | null) => {
    setSubsOpen(false);
    setSubVtt(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setSubId(s?.id ?? null);
    if (!s) return;
    try {
      const blob = await srtUrlToVttBlob(s.url);
      setSubVtt(blob);
    } catch {
      toast.error('Não consegui carregar essa legenda', { description: 'Tente outra opção.' });
      setSubId(null);
    }
  };

  // Cleanup do blob ao desmontar/fechar.
  useEffect(() => () => { setSubVtt(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); }, []);

  // Auto-oculta nossos controles após 4s (libera os controles do provedor embaixo).
  // Não esconde enquanto um dropdown (fonte/legenda) está aberto.
  useEffect(() => {
    if (!open || !fullscreen || !controlsVisible || sourceOpen || subsOpen) return;
    const t = setTimeout(() => setControlsVisible(false), 4000);
    return () => clearTimeout(t);
  }, [open, fullscreen, controlsVisible, sourceOpen, subsOpen]);

  // Ao fechar/desmontar o player, restaura orientação e barras do sistema.
  useEffect(() => {
    if (!open) return;
    return () => {
      if (Capacitor.isNativePlatform()) { Immersive.exit().catch(() => {}); }
      else if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
    };
  }, [open]);

  const target: PlayerTarget = { tmdbId, imdbId, type, season, episode };

  // Chave de download deste título/episódio (m:tmdbId / e:tmdbId:s:e). Se baixado,
  // o player nativo toca do cache (offline). O download é da MASTER escolhida.
  const dlKey = tmdbId == null ? null
    : (type === 'movie' ? movieKey(tmdbId)
      : (season != null && episode != null ? epKey(tmdbId, season, episode) : null));
  const dlItem = useDownloadItem(dlKey);
  const dlDone = dlItem?.state === 'completed';
  // O download é do EPISÓDIO (1 por chave), mas foi feito a partir de UM link — só
  // esse mostra o progresso; os outros seguem oferecendo "baixar".
  const dlUrl = dlKey ? getDownloadMeta()[dlKey]?.url : undefined;
  const isDlLink = (u: string) => !!dlUrl && streamKey(dlUrl) === streamKey(u);
  const available = PROVIDERS.filter(p => p.build(target));
  // Lembra a fonte escolhida por título (tmdbId+type). Não muda o padrão global.
  const srcKey = `watchmov_src_${tmdbId ?? imdbId}_${type}`;
  const [providerId, setProviderId] = useState(() => {
    try {
      const saved = localStorage.getItem(srcKey);
      if (saved && available.some(p => p.id === saved)) return saved;
    } catch { /* ignore */ }
    // Padrão = Fonte 2 (SuperFlix): mais estável que a 1 (os mirrors do EmbedPlayApi
    // caem com frequência). Cai na 1ª disponível se a 2 não existir pro título.
    return available.find(p => p.id === 'superflix')?.id ?? available[0]?.id ?? 'embedplayapi';
  });
  const provider = available.find(p => p.id === providerId) || available[0];

  const directMode = !!directUrl || !!torrent;

  // URL do embed do servidor (iframe, como hoje).
  let embedUrl: string | null = provider ? provider.build(target) : null;
  if (embedUrl && provider?.id === 'vidapi' && resumeAt && resumeAt > 0) {
    embedUrl += `&resumeAt=${Math.floor(resumeAt)}`;
  }

  // <video> HTML5 = só Stremio/torrent (directMode). O stream capturado nos
  // servidores toca no ExoPlayer nativo (headers Referer + buffer).
  const nativeOwn = isNative() && !!ownStream && !preferIframe && !directMode;
  const videoSrc = torrent ? (tor.url ?? null) : directUrl ? directUrl : null;
  const src: string | null = nativeOwn ? (ownStream?.url ?? null) : directMode ? videoSrc : embedUrl;

  // Ao abrir: carrega a lista salva; se há um último link escolhido, reabre nele
  // (ExoPlayer). O sniffer fica SEMPRE ativo no modo servidor, acumulando links
  // novos na lista salva (mesmo no meio do filme) — nunca perde os já achados.
  // (A) Auto-abrir do cache — SÓ ao abrir o TÍTULO (não depende de embedUrl, pra
  // trocar de provedor no servidor NÃO reabrir o reprodutor sozinho).
  useEffect(() => {
    if (!open) return;
    setPickerOpen(false); setPreferIframe(false); setOwnStream(null);
    playedRef.current = false;
    if (directMode || !isNative()) return;
    // Veio do "Próximo episódio": este ep começa do ZERO. Limpa a posição salva nos
    // DOIS stores (streamCache + SharedPreferences do player) — as versões antigas
    // gravavam o tempo do ep anterior na chave deste, e a TV abria em 0:50:19.
    if (awaitingNextRef.current) {
      setStreamPosition(0, tmdbId, type, season, episode);
      clearResumeNative(`${tmdbId ?? 0}:${type}:${season ?? 0}:${episode ?? 0}`);
    }
    const entry = getEntry(tmdbId, type, season, episode);
    // Só reabre no reprodutor se a última vez foi nele; senão fica no servidor.
    let toPlay: SniffResult | null = null;
    if (entry?.lastMode === 'native' && entry.chosenUrl) {
      const ck = streamKey(entry.chosenUrl);
      toPlay = (entry.streams ?? []).find(x => streamKey(x.url) === ck) || { url: entry.chosenUrl };
    } else if ((pendingNextInPlayer || awaitingNextRef.current) && entry?.streams?.length) {
      toPlay = entry.streams[0];        // veio do "Próximo" e o ep já tem link → reprodutor
    }
    if (toPlay) setOwnStream(toPlay);
    pendingNextInPlayer = false;
    // Player aberto esperando o próximo ep e este NÃO tem link capturado: avisa o
    // nativo na hora (sem url) pra ele cair no fluxo antigo em vez de esperar o
    // timeout — o app volta pro servidor e captura o link do ep novo.
    if (awaitingNextRef.current && !toPlay) loadNextNative({});
  }, [open, directMode, tmdbId, type, season, episode]);

  // "Próximo episódio" tocado DENTRO do player nativo: o player NÃO fecha mais —
  // avança o episódio aqui e devolve o link pra ele (a TV segue espelhando).
  // Assina UMA vez por abertura (via ref): se reassinasse a cada render, o handle
  // ainda não resolvido escaparia do cleanup e o listener duplicado PULARIA episódios.
  useEffect(() => {
    if (!open || !isNative()) return;
    let handle: { remove: () => void } | null = null;
    let dead = false;
    onPlayerNext?.(() => {
      if (awaitingNextRef.current) return;   // clique repetido: já estamos avançando
      awaitingNextRef.current = true;
      onNextRef.current?.();
    })?.then(h => { handle = h; if (dead) h.remove(); });
    return () => { dead = true; handle?.remove(); awaitingNextRef.current = false; };
  }, [open]);

  // (B) Lista salva + captura passiva — roda também ao trocar de provedor (embedUrl),
  // acumulando links sem mexer no que já está tocando/escolhido.
  useEffect(() => {
    if (!open || directMode || !embedUrl || !isNative()) { setCapturedList([]); return; }
    setCapturedList(getEntry(tmdbId, type, season, episode)?.streams ?? []);
    let alive = true;
    let stop = () => {};
    watchStream(r => {
      if (!alive) return;
      // dedup pela chave (token muda) — atualiza a URL fresca em vez de duplicar.
      setCapturedList(prev => {
        const key = streamKey(r.url);
        const idx = prev.findIndex(x => streamKey(x.url) === key);
        if (idx < 0) return [...prev, r];
        const copy = [...prev];
        copy[idx] = { url: r.url, mime: r.mime || copy[idx].mime, referer: r.referer || copy[idx].referer };
        return copy;
      });
      addStreams([r], tmdbId, type, season, episode);
    }).then(fn => { if (alive) stop = fn; else fn(); });
    return () => { alive = false; stop(); };
  }, [open, embedUrl, directMode, tmdbId, type, season, episode]);

  // Players externos instalados (pra oferecer no diálogo de cast).
  useEffect(() => {
    if (!open || !isNative()) return;
    listExternalApps().then(setExtApps).catch(() => {});
  }, [open]);

  // Escolhe um link → vira o "último aberto" (reabre nele) e toca no ExoPlayer.
  const chooseStream = (r: SniffResult) => {
    setPickerOpen(false); setPreferIframe(false);
    playedRef.current = false;
    addStreams([r], tmdbId, type, season, episode);
    setChosen(r.url, tmdbId, type, season, episode);
    setOwnStream(r);
  };

  // Baixa (offline) a MASTER escolhida deste título/ep. A master baixada vira a
  // "lembrada" (chosenUrl) → ao reabrir, o player toca do cache. Já baixado = remove.
  const toggleDownload = (r: SniffResult) => {
    if (!dlKey) return;
    if (dlItem && dlItem.state !== 'removed') { removeDownload(dlKey); toast.info('Download removido'); return; }
    // Fecha a lista de links antes: os dois modais ficam na mesma camada e o
    // "Como quer baixar?" nascia ATRÁS — parecia que o toque não fez nada.
    setPickerOpen(false);
    setDlAsk(r);   // pergunta o formato: padrão (Media3) ou MP4
  };

  // Download padrão: cache do Media3 (retoma sozinho, aba Download, play offline).
  const startStandardDownload = (r: SniffResult) => {
    if (!dlKey) return;
    addStreams([r], tmdbId, type, season, episode);
    setChosen(r.url, tmdbId, type, season, episode);
    enqueueDownload(dlKey, {
      url: r.url, referer: r.referer, mime: r.mime, title,
      tmdbId: tmdbId!, type, posterUrl, season, ep: episode,
    });
    toast.success('Baixando…', { description: 'Acompanhe na aba Download ou na notificação.' });
  };

  // Download em MP4: arquivo real em Movies/WatchMov que qualquer app abre (Web
  // Video Cast, VLC, galeria) e a TV toca. Não entra na aba Download nem retoma.
  const startMp4Download = (r: SniffResult) => {
    if (!dlKey) return;
    downloadAsMp4(dlKey, { url: r.url, referer: r.referer, mime: r.mime, title });
  };

  // Assistir pelo servidor (iframe): grava que a última vez foi no servidor
  // (ao reabrir o título abre o servidor, não o reprodutor).
  const goServer = () => {
    setPickerOpen(false);
    setOwnStream(null);
    setPreferIframe(true);
    playedRef.current = false;
    setServerMode(tmdbId, type, season, episode);
  };

  // Abre o ExoPlayer nativo pro stream escolhido (uma vez; [Continuar] reabre).
  useEffect(() => {
    if (!nativeOwn || !ownStream || playedRef.current) return;
    playedRef.current = true;
    const startMs = getEntry(tmdbId, type, season, episode)?.positionMs ?? 0;
    // Auto-avanço ESCOPADO: se escolheu um MASTER, só avança entre masters; se
    // escolheu uma faixa, só entre faixas (não mistura completo com só-áudio/só-vídeo).
    const group = capturedList.filter(s => isTrackOnly(s.url) === isTrackOnly(ownStream.url));
    const opts = {
      url: ownStream.url, referer: ownStream.referer, mime: ownStream.mime, title, startMs,
      offline: !!(dlKey && isDownloaded(dlKey) && streamKey(ownStream.url) === streamKey(getEntry(tmdbId, type, season, episode)?.chosenUrl || '')),
      downloaded: !!(dlKey && isDownloaded(dlKey)),   // indicador no topo (⤓ em destaque)
      urls: group.map(s => s.url), mimes: group.map(s => s.mime ?? ''),
      qualities: group.map(s => s.quality ?? ''), hasNext: !!onNext,
      key: `${tmdbId ?? 0}:${type}:${season ?? 0}:${episode ?? 0}`, watched: !!watched,
    };
    // Veio do "Próximo episódio" com o player JÁ ABERTO: entrega o link pro player
    // vivo (não abre outra Activity) — assim o espelhamento na TV não se perde.
    if (playerOpenRef.current) {
      curEpRef.current = { tmdbId, type, season, episode };
      awaitingNextRef.current = false;
      loadNextNative(opts);
      return;
    }
    playerOpenRef.current = true;
    curEpRef.current = { tmdbId, type, season, episode };
    playNative(opts).then(res => {
      playerOpenRef.current = false;
      const advanced = awaitingNextRef.current;   // já trocou de ep aqui no JS
      awaitingNextRef.current = false;
      if (!res) return;
      // O episódio que estava tocando ao fechar pode NÃO ser o que abriu o player
      // (troca in-place) → grava posição/link na chave do ep certo.
      const ep = curEpRef.current;
      // Estado final de "assistido" vem no resultado (o evento ao vivo se perde com o
      // WebView em background) → fonte da verdade ao fechar; garante mark E unmark.
      if (typeof res.watched === 'boolean') onSetWatched?.(res.watched);
      if (res.positionMs > 0) {
        setStreamPosition(res.positionMs, ep.tmdbId, ep.type, ep.season, ep.episode);
        onProgress?.(Math.floor(res.positionMs / 1000));
      }
      if (res.recapture) { setCapturedList([]); goServer(); return; }  // link expirou (403/410) → recaptura fresco
      if (res.server) { goServer(); return; }                 // botão Servidor → modo servidor
      // O player fechou pedindo o próximo ep. Se o JS JÁ tinha avançado (in-place que
      // não achou link), NÃO avança de novo — senão pularia um episódio.
      if (res.next) { if (!advanced) { pendingNextInPlayer = true; onNext?.(); } return; }
      if (res.url) setChosen(res.url, ep.tmdbId, ep.type, ep.season, ep.episode);   // guarda o link atual
      onClose();   // Voltar → fecha direto (volta pro detalhe), sem placeholder
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeOwn, ownStream]);

  const continueNative = () => { playedRef.current = false; setOwnStream(s => (s ? { ...s } : s)); };

  // Salva a posição que o ExoPlayer reporta a cada ~5s (retomar de onde parou).
  useEffect(() => {
    if (!open || directMode || !isNative()) return;
    let handle: { remove: () => void } | null = null;
    onPlayerProgress?.(({ url, positionMs, durationMs }) => {
      // Só salva se o progresso for DESTE episódio: ao avançar, o player ainda
      // reporta a posição do ep anterior por alguns instantes enquanto o React já
      // trocou season/episode — sem esse guard, o ep novo abria em 30/47min.
      const cur = ownStreamRef.current?.url;
      if (cur && url && streamKey(url) !== streamKey(cur)) return;
      if (positionMs > 0) setStreamPosition(positionMs, tmdbId, type, season, episode, durationMs);
    })?.then(h => { handle = h; });
    return () => { handle?.remove(); };
  }, [open, directMode, tmdbId, type, season, episode]);

  // "Assistido" reportado pelo player nativo (botão ou faltando 1 min pro fim).
  useEffect(() => {
    if (!open || !isNative() || !onSetWatched) return;
    let handle: { remove: () => void } | null = null;
    onPlayerWatched?.(({ watched: w }) => onSetWatched(w))?.then(h => { handle = h; });
    return () => { handle?.remove(); };
  }, [open, tmdbId, type, season, episode, onSetWatched]);

  // Aprende a resolução real do link (do ExoPlayer) e rotula na lista.
  useEffect(() => {
    if (!open || directMode || !isNative()) return;
    let handle: { remove: () => void } | null = null;
    onPlayerQuality?.(({ url, quality }) => {
      if (!quality) return;
      setCapturedList(prev => prev.map(s => streamKey(s.url) === streamKey(url) ? { ...s, quality } : s));
      addStreams([{ url, quality }], tmdbId, type, season, episode);
    })?.then(h => { handle = h; });
    return () => { handle?.remove(); };
  }, [open, directMode, tmdbId, type, season, episode]);

  // Registra no banco (aba "Bugs") todo erro de reprodução do player nativo, com o
  // motivo REAL (código/causa/HTTP) — pra entender por que os links não tocam.
  useEffect(() => {
    if (!open || directMode || !isNative()) return;
    let handle: { remove: () => void } | null = null;
    onPlayerError?.((e) => {
      // Tira da lista SÓ o que é morte permanente: expirado (403/410), muro
      // WebView-only (451) ou manifesto malformado (code 3002). 500/timeout/rede
      // são temporários → mantém (o auto-avanço só pula na hora).
      const permanent = e.httpCode === 403 || e.httpCode === 410 || e.httpCode === 451 || e.code === 3002;
      if (e.url && permanent) {
        removeStream(e.url, tmdbId, type, season, episode);
        setCapturedList(prev => prev.filter(s => streamKey(s.url) !== streamKey(e.url!)));
      }
      supabase.from('wm_playback_errors').insert({
        title: e.title ?? title ?? null,
        provider: providerId ?? null,
        url: e.url ?? null,
        referer: e.referer ?? null,
        mime: e.mime ?? null,
        error_code: typeof e.code === 'number' ? e.code : null,
        error_name: e.name ?? null,
        error_cause: e.cause ?? null,
        app_version: __APP_VERSION__,
        platform: 'android',
      }).then(({ error }) => { if (error) console.warn('[bugs] log falhou', error.message); });
    })?.then(h => { handle = h; });
    return () => { handle?.remove(); };
    // tmdbId/type/season/episode nas deps: o callback usa essas chaves pra remover o
    // link e registrar o erro — sem elas, trocar de episódio com o player aberto
    // gravava/removia no episódio ANTERIOR.
  }, [open, directMode, providerId, title, tmdbId, type, season, episode]);

  // <video> (Stremio/torrent): anexa a fonte (hls.js pra .m3u8; src direto pro resto).
  useEffect(() => {
    const v = videoRef.current;
    if (!open || !directMode || !videoSrc || !v) return;
    const isHls = /\.m3u8(\?|$)/i.test(videoSrc);
    let hls: Hls | null = null;
    if (isHls && !v.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(videoSrc);
      hls.attachMedia(v);
    } else {
      v.src = videoSrc;
    }
    return () => { if (hls) hls.destroy(); };
  }, [open, directMode, videoSrc]);

  useEffect(() => {
    if (!open) return;
    completedRef.current = false;
    lastSavedRef.current = resumeAt ?? 0;

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'PLAYER_EVENT' || !data.data) return;
      const { player_status, player_progress } = data.data as { player_status?: string; player_progress?: number };
      const secs = typeof player_progress === 'number' ? player_progress : 0;
      if (player_status === 'completed') {
        if (!completedRef.current) { completedRef.current = true; onCompleted?.(); }
        return;
      }
      if (secs > 0 && Math.abs(secs - lastSavedRef.current) >= 30) {
        lastSavedRef.current = secs;
        onProgress?.(secs);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, providerId, season, episode]);

  if (!open) return null;

  const qrUrl = src ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(src)}` : '';

  const tryCast = async () => {
    if (Capacitor.isNativePlatform()) {
      // Servidor = iframe cross-origin: não dá pra "cast" o vídeo (DLNA/Chromecast).
      // O caminho é ESPELHAR A TELA — a TV mostra a WebView tocando (a ideia original).
      try {
        await ScreenCast.openCast();
        toast.info('Espelhar tela', { description: 'Ative Espelhamento/Smart View e escolha sua TV — o vídeo do servidor aparece nela. Se a TV não listar, use o atalho "Transmitir/Smart View" nas configurações rápidas.' });
      } catch {
        toast.error('Abra pelas configurações rápidas', { description: 'Puxe a barra de cima e toque em Espelhar tela / Smart View / Transmitir, e escolha a TV.' });
      }
      return;
    }
    const w = window as unknown as { PresentationRequest?: new (urls: string[]) => { start: () => Promise<unknown> } };
    if (typeof w.PresentationRequest === 'function') {
      try { await new w.PresentationRequest([src!]).start(); toast.success('Transmitindo para a TV'); return; } catch { /* fallback */ }
    }
    setCastOpen(true);
  };

  // Player externo (WVC/VLC/MX): manda o link CAPTURADO (ou direto) + Referer.
  const castExt = async (app: ExternalApp) => {
    const s = ownStream || capturedList[0] || null;
    const url = s?.url || videoSrc || null;
    if (!url) { toast.error('Sem link direto ainda', { description: 'Dê play no servidor uma vez pra capturar o vídeo; depois abra no app externo.' }); return; }
    const mime = url.includes('.m3u8') || url.includes('/m3/') || url.includes('master') ? 'application/x-mpegURL' : url.includes('.mpd') ? 'application/dash+xml' : 'video/*';
    const ok = await castToExternal({ pkg: app.pkg, url, title, referer: s?.referer, ua: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', mime, subs: subVtt ? [subVtt] : undefined });
    if (ok) { setCastOpen(false); toast.success(`Enviado pro ${app.name}`); } else { toast.error(`Não consegui abrir no ${app.name}`); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(src!); toast.success('Link copiado', { description: 'Cole no navegador da sua TV LG.' }); }
    catch { toast.error('Não foi possível copiar', { description: src || '' }); }
  };

  const pickSource = (id: string) => {
    setProviderId(id);
    try { localStorage.setItem(srcKey, id); } catch { /* ignore */ }
    setSourceOpen(false);
    completedRef.current = false;
    lastSavedRef.current = 0;
  };

  // Tela cheia imersiva (oculta barras + entalhe). Nativo: plugin; web: Fullscreen API.
  const toggleFullscreen = async () => {
    const next = !fullscreen;
    setFullscreen(next);
    setControlsVisible(!next); // em tela cheia começa sem a barra; tap mostra
    if (Capacitor.isNativePlatform()) {
      try { await (next ? Immersive.enter() : Immersive.exit()); } catch { /* ignore */ }
      return;
    }
    try {
      if (next) await rootRef.current?.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* ignore */ }
  };

  return (
    <div ref={rootRef} className={`fixed inset-0 z-[60] bg-black animate-fade-in ${fullscreen ? '' : 'flex flex-col'}`}>
      {/* Em tela cheia (paisagem): faixa fina revela os controles ocultos. */}
      {fullscreen && !controlsVisible && (
        <button aria-hidden onClick={() => setControlsVisible(true)} className="absolute top-0 inset-x-0 h-12 z-10" />
      )}
      {/* Retrato: barra fixa no topo (vídeo abaixo, sem sobrepor controles do provedor).
          Tela cheia: overlay translúcido com auto-ocultar. */}
      <div className={fullscreen
        ? `absolute top-0 inset-x-0 z-20 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/90 via-black/70 to-transparent transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`
        : 'relative z-20 shrink-0 flex items-center justify-between px-3 py-2 bg-black/95'}>
        <span className="text-sm text-white/90 truncate flex-1">{title || 'Player'}</span>
        <div className="flex items-center gap-1 shrink-0">
          {/* Botão SEMPRE visível: lista de links capturados (escolher / servidor). */}
          {!directMode && (
            <Button variant="ghost" size="icon" className="relative h-9 w-9 text-white/80 hover:text-white hover:bg-white/10"
              title="Links do vídeo" onClick={() => setPickerOpen(true)}>
              <ListVideo className="w-5 h-5" />
              {capturedList.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{capturedList.length}</span>
              )}
            </Button>
          )}
          <div className="relative" hidden={directMode}>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Trocar fonte" onClick={() => setSourceOpen(o => !o)}>
              <Layers className="w-5 h-5" />
            </Button>
            {!directMode && sourceOpen && (
              <div className="fixed left-1/2 -translate-x-1/2 top-14 z-30 bg-card border border-border rounded-lg py-1 w-56 max-w-[90vw] shadow-xl">
                <p className="px-3 py-1 text-[10px] text-muted-foreground">Fontes (troque se estiver em inglês ou não carregar)</p>
                {available.map(p => (
                  <button key={p.id} onClick={() => pickSource(p.id)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-secondary">
                    {p.name}
                    {p.id === providerId && <Check className="w-4 h-4 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {directMode && (
            <div className="relative">
              <Button variant="ghost" size="icon" className={`h-9 w-9 hover:text-white hover:bg-white/10 ${subId ? 'text-primary' : 'text-white/80'}`} title="Legendas" onClick={() => setSubsOpen(o => !o)}>
                <Subtitles className="w-5 h-5" />
              </Button>
              {subsOpen && (
                <div className="absolute right-0 top-11 z-20 bg-card border border-border rounded-lg py-1 w-52 shadow-xl max-h-72 overflow-auto">
                  <p className="px-3 py-1 text-[10px] text-muted-foreground">Legendas {subList.length ? `(${subList.length})` : '— buscando/sem PT'}</p>
                  <button onClick={() => pickSubtitle(null)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-secondary">
                    Desligada {subId === null && <Check className="w-4 h-4 text-primary" />}
                  </button>
                  {subList.map(s => (
                    <button key={s.id} onClick={() => pickSubtitle(s)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-foreground hover:bg-secondary">
                      <span className="truncate">{s.label}</span>
                      {s.id === subId && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {onSetWatched && (
            <Button variant="ghost" size="icon" className={`h-9 w-9 hover:text-white hover:bg-white/10 ${watched ? 'text-primary' : 'text-white/80'}`} title={watched ? 'Assistido (toque pra desmarcar)' : 'Marcar como assistido'} onClick={() => onSetWatched(!watched)}>
              {watched ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
            </Button>
          )}
          {onNext && (
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Próximo episódio" onClick={onNext}>
              <SkipForward className="w-5 h-5" />
            </Button>
          )}
          {/* Tela cheia e espelhar saíram da barra (estava cheia demais) e viraram
              um menu ⋮ — as duas ações continuam a um toque de distância. */}
          <div className="relative">
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Mais opções" onClick={() => setMoreOpen(o => !o)}>
              <MoreVertical className="w-5 h-5" />
            </Button>
            {moreOpen && (
              <>
                <button aria-hidden className="fixed inset-0 z-20" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-11 z-30 bg-card border border-border rounded-lg py-1 w-52 shadow-xl">
                  <button onClick={() => { setMoreOpen(false); toggleFullscreen(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-secondary">
                    {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                  </button>
                  <button onClick={() => { setMoreOpen(false); tryCast(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-secondary">
                    <Tv className="w-4 h-4" /> Espelhar para TV
                  </button>
                </div>
              </>
            )}
          </div>
          {fullscreen && (
            <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" title="Ocultar controles" onClick={() => setControlsVisible(false)}>
              <ChevronUp className="w-5 h-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className={fullscreen ? 'absolute inset-0' : 'flex-1 min-h-0'}>
        {torrent && tor.loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/80 text-sm px-6 text-center">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p>Conectando a peers (WebTorrent)…</p>
            <p className="text-white/50 text-xs">Pode levar alguns segundos. Depende de seeders WebRTC disponíveis.</p>
          </div>
        ) : torrent && tor.error ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/80 text-sm px-6 text-center">
            <p className="text-amber-400">{tor.error}</p>
            <p className="text-white/50 text-xs">Torrents só tocam aqui com seeders WebRTC e formato MP4/WebM. Tente outra opção, ou abra no Stremio.</p>
          </div>
        ) : torrent && tor.url && tor.playable === false ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/80 text-sm px-6 text-center">
            <p className="text-amber-400">Formato não suportado no navegador: {tor.name}</p>
            <p className="text-white/50 text-xs">O navegador só decodifica MP4 (H.264) e WebM. Este arquivo (provável .mkv/.avi) não toca aqui — escolha uma opção MP4 ou abra no Stremio.</p>
          </div>
        ) : nativeOwn ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-white/80 text-sm px-6 text-center">
            <Sparkles className="w-8 h-8 text-primary" />
            <p className="text-white">Tocando no seu player</p>
            <p className="text-white/50 text-xs">Fechou o player? Use os botões abaixo.</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button size="sm" onClick={continueNative}>Continuar</Button>
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Trocar link</Button>
              <Button size="sm" variant="ghost" className="text-white/70" onClick={goServer}>Servidor</Button>
            </div>
          </div>
        ) : !src ? (
          <div className="w-full h-full flex items-center justify-center text-white/70 text-sm">Sem fonte disponível para este título.</div>
        ) : directMode ? (
          <video
            ref={videoRef}
            key={videoSrc ?? 'video'}
            className="w-full h-full bg-black"
            controls
            autoPlay
            playsInline
            onLoadedMetadata={e => {
              if (resumeAt && resumeAt > 0 && resumeAt < e.currentTarget.duration - 5) {
                e.currentTarget.currentTime = resumeAt;
              }
            }}
            onTimeUpdate={e => {
              const secs = Math.floor(e.currentTarget.currentTime);
              if (secs > 0 && Math.abs(secs - lastSavedRef.current) >= 30) { lastSavedRef.current = secs; onProgress?.(secs); }
              const dur = e.currentTarget.duration;
              if (dur > 60 && e.currentTarget.currentTime >= dur - 60 && !watched) onSetWatched?.(true);
            }}
            onEnded={() => { if (!completedRef.current) { completedRef.current = true; onCompleted?.(); } }}
          >
            {subVtt && <track kind="subtitles" src={subVtt} srcLang="pt" label="Português" default />}
          </video>
        ) : (
          <iframe
            key={src}
            src={src}
            title={title || 'VideoPlayer'}
            className="w-full h-full border-0"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="origin"
          />
        )}
      </div>

      {/* Banner: vídeo(s) capturado(s) em background enquanto assiste no servidor. */}
      {!directMode && !nativeOwn && !preferIframe && capturedList.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-30 w-[92%] max-w-md bg-card border border-primary/40 rounded-xl shadow-2xl p-3 flex items-center gap-3 animate-fade-in">
          <Sparkles className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">{capturedList.length === 1 ? 'Vídeo pronto no seu player' : `${capturedList.length} vídeos detectados`}</p>
            <p className="text-xs text-muted-foreground">Controles, buffer, espelhar e baixar offline.</p>
          </div>
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setPreferIframe(true)}>Servidor</Button>
          <Button size="sm" className="shrink-0" onClick={() => capturedList.length === 1 ? chooseStream(capturedList[0]) : setPickerOpen(true)}>
            {capturedList.length === 1 ? 'Reproduzir' : 'Escolher'}
          </Button>
        </div>
      )}

      {/* Formato do download: cache do Media3 (padrão) ou MP4 solto no aparelho. */}
      {dlAsk && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setDlAsk(null)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-border">
              <h3 className="font-semibold text-foreground text-sm">Como quer baixar?</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDlAsk(null)}><X className="w-4 h-4" /></Button>
            </div>
            <button onClick={() => { const r = dlAsk; setDlAsk(null); startStandardDownload(r); }}
              className="w-full text-left px-3 py-3 hover:bg-secondary border-b border-border/40">
              <p className="text-sm text-foreground flex items-center gap-2"><Download className="w-4 h-4 text-primary" /> Padrão (offline no app)</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Retoma sozinho se cair, aparece na aba Download e toca offline aqui. Outros apps não enxergam.</p>
            </button>
            <button onClick={() => { const r = dlAsk; setDlAsk(null); startMp4Download(r); }}
              className="w-full text-left px-3 py-3 hover:bg-secondary">
              <p className="text-sm text-foreground flex items-center gap-2"><Tv className="w-4 h-4 text-green-400" /> MP4 em Movies/WatchMov</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Arquivo que o Web Video Cast, VLC e a galeria abrem — é o que a TV toca. Segue com o app fechado; se parar no meio, recomeça do zero.</p>
            </button>
          </div>
        </div>
      )}

      {/* Lista de vídeos detectados (escolher qual reproduzir). */}
      {pickerOpen && (
        <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-md max-h-[70vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-border sticky top-0 bg-card">
              <h3 className="font-semibold text-foreground text-sm">Links do vídeo ({capturedList.length})</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPickerOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            <button onClick={goServer} className="w-full flex items-center gap-2 text-left px-3 py-2.5 hover:bg-secondary border-b border-border/40">
              <Server className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-foreground">Assistir pelo servidor</span>
            </button>
            {capturedList.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4 text-center">Nenhum link ainda. Dê play no servidor e aguarde — os links aparecem aqui.</p>
            ) : (() => {
              const masters = capturedList.filter(s => !isTrackOnly(s.url));
              const tracks = capturedList.filter(s => isTrackOnly(s.url));
              const hasBoth = masters.length > 0 && tracks.length > 0;
              const shown = !hasBoth ? capturedList : (pickerTab === 'master' ? masters : tracks);
              return (
                <>
                  {hasBoth && (
                    <div className="flex border-b border-border sticky top-[41px] bg-card z-10">
                      <button onClick={() => setPickerTab('master')} className={`flex-1 py-2 text-xs font-medium ${pickerTab === 'master' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}>Completos ({masters.length})</button>
                      <button onClick={() => setPickerTab('faixa')} className={`flex-1 py-2 text-xs font-medium ${pickerTab === 'faixa' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}>Faixas ({tracks.length})</button>
                    </div>
                  )}
                  {shown.map((s) => {
                    const gi = capturedList.indexOf(s) + 1;
                    const chosen = ownStream?.url === s.url;
                    const kind = s.mime?.includes('mpegurl') ? 'HLS' : s.mime?.includes('dash') ? 'DASH' : 'MP4';
                    const track = isTrackOnly(s.url);
                    return (
                      <div key={s.url} className="w-full flex items-center gap-1 px-3 py-2.5 hover:bg-secondary border-b border-border/40">
                        <button onClick={() => chooseStream(s)} className="flex-1 min-w-0 text-left flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground">
                              Link {gi} <span className="text-[10px] text-muted-foreground">({kind})</span>
                              <span className={`text-[10px] ml-1 font-semibold ${track ? 'text-amber-400' : 'text-green-400'}`}>{track ? 'FAIXA' : 'MASTER'}</span>
                              {(s.quality || qualityFromUrl(s.url)) && <span className="text-[10px] text-primary ml-1">{s.quality || qualityFromUrl(s.url)}</span>}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">{s.url}</p>
                          </div>
                          {chosen && <Check className="w-4 h-4 text-primary shrink-0" />}
                        </button>
                        {!track && dlKey && isNative() && (() => {
                          const mine = isDlLink(s.url);          // este link é o do download?
                          const busy = !!dlItem && dlItem.state !== 'removed';
                          if (busy && !mine) return null;         // outro link já está baixando
                          return (
                            <button onClick={(e) => { e.stopPropagation(); toggleDownload(s); }} className="shrink-0 w-9 h-9 flex items-center justify-center rounded hover:bg-background/60"
                              title={dlDone ? 'Baixado — toque pra remover' : 'Baixar (offline)'}>
                              {dlDone ? <Trash2 className="w-4 h-4 text-green-400" />
                                : dlItem?.state === 'downloading' ? <span className="text-[10px] font-semibold text-primary">{dlItem.percent >= 0 ? `${dlItem.percent}%` : '…'}</span>
                                : busy ? <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                : <Download className="w-4 h-4 text-muted-foreground" />}
                            </button>
                          );
                        })()}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {castOpen && (
        <div className="absolute inset-0 z-10 bg-black/80 flex items-end sm:items-center justify-center p-4" onClick={() => setCastOpen(false)}>
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><Tv className="w-4 h-4" /> Espelhar para TV</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCastOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> Espelhamento de tela (TV LG, Samsung etc.)</p>
              <p className="text-xs text-muted-foreground">No celular, abra <b>Espelhamento de tela</b> / <b>Smart View</b> e selecione sua TV LG. Depois volte aqui e dê play.</p>
            </div>
            {extApps.length > 0 && (
              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-xs text-muted-foreground">Abrir em app externo (casta pra TV melhor que DLNA):</p>
                <div className="grid grid-cols-2 gap-2">
                  {extApps.map(a => (
                    <Button key={a.id} variant="secondary" size="sm" onClick={() => castExt(a)}>{a.name}</Button>
                  ))}
                </div>
              </div>
            )}
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs text-muted-foreground">Ou abra direto no navegador da TV LG (webOS):</p>
              <div className="flex justify-center"><img src={qrUrl} alt="QR do link" className="rounded-lg bg-white p-1" width={160} height={160} /></div>
              <Button variant="outline" size="sm" className="w-full" onClick={copyLink}><Copy className="w-4 h-4 mr-1" /> Copiar link</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
