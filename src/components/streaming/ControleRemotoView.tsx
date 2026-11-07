import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, FastForward, House, Loader2,
  Pause, Play, Plus, RefreshCw, Rewind, SkipBack, SkipForward, SquarePlus, Tv, Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import IconeControle from '@/components/streaming/IconeControle';
import { supabase } from '@/lib/supabase';
import { listTvDevices, type TvDevice } from '@/lib/tvPair';
import { mandarControle, newCmdId, type CtlCmd, type TeclaControle, type TocandoNaTv } from '@/lib/tvRemote';
import { estadoDoWidget, fixarWidget, guardarTvNoWidget, prepararWidget } from '@/lib/widgetControle';

// Controle remoto (pedido dele 07/11/2026, fotos aprovadas): Painel → Controle remoto → escolhe uma das TVs conectadas
// (as do "Entrar na TV") → controle com setas, OK (segurar = menu do título), Voltar, Início, ⏪ ⏯ ⏩ e os episódios.
// Cada toque vai pelo canal da conta (tvRemote, evento 'ctl'); a TV só atende com o WatchMov aberto na frente.
// O widget da tela inicial (widgetControle) fica com a mesma TV e a mesma lista.

export const ULTIMA_TV = 'wm_controle_tv';   // a última TV usada no app (o widget guarda a dele no nativo)
const SEGURAR_OK_MS = 600;
const PING_MS = 5000;

async function sessao() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

function lembrarTv(tv: TvDevice) {
  try { localStorage.setItem(ULTIMA_TV, JSON.stringify({ session_id: tv.session_id, name: tv.name })); } catch { /* sem storage */ }
}

function tempo(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

interface Props {
  tv: TvDevice | null;
  onEscolherTv: (tv: TvDevice | null) => void;
  onBack: () => void;
  onConectarTv: () => void;
}

export default function ControleRemotoView({ tv, onEscolherTv, onBack, onConectarTv }: Props) {
  if (tv) return <Controle tv={tv} onTrocar={() => onEscolherTv(null)} />;
  return <EscolherTv onEscolher={(t) => { lembrarTv(t); void guardarTvNoWidget(t); onEscolherTv(t); }} onBack={onBack} onConectarTv={onConectarTv} />;
}

type Situacao = 'verificando' | 'aberta' | 'fechada';

function EscolherTv({ onEscolher, onBack, onConectarTv }: { onEscolher: (tv: TvDevice) => void; onBack: () => void; onConectarTv: () => void }) {
  const [tvs, setTvs] = useState<TvDevice[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<Record<string, Situacao>>({});

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const s = await sessao();
      if (!s) return;
      try {
        const lista = await listTvDevices(s.access_token);
        if (!vivo) return;
        setTvs(lista);
        void prepararWidget(s.access_token, lista);
        setSituacao(Object.fromEntries(lista.map(t => [t.session_id, 'verificando' as Situacao])));
        // Bolinha verde: pergunta a cada TV se o WatchMov está aberto nela agora.
        await Promise.all(lista.map(async (t) => {
          const r = await mandarControle(s.user.id, { id: newCmdId(), to: t.session_id, action: 'ping' });
          if (vivo) setSituacao(st => ({ ...st, [t.session_id]: r.result === 'ok' ? 'aberta' : 'fechada' }));
        }));
      } catch {
        if (!vivo) return;
        setErro('Não deu pra carregar as TVs. Tente de novo.');
        setTvs(t => t ?? []);
      }
    })();
    return () => { vivo = false; };
  }, []);

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Voltar"><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold">Controle remoto</h1>
      </div>

      {tvs === null ? (
        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : tvs.length === 0 && !erro ? (
        <div className="flex flex-col items-center text-center gap-3 py-10">
          <div className="w-16 h-16 rounded-full bg-card border border-border/60 flex items-center justify-center">
            <IconeControle className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="font-semibold text-foreground">Nenhuma TV conectada</p>
          <p className="text-sm text-muted-foreground max-w-xs">Conecte a TV primeiro: abra o WatchMov nela e digite o código aqui no celular.</p>
          <Button className="gap-2 h-11 mt-2 px-6" onClick={onConectarTv}><Tv className="w-4 h-4" /> Conectar uma TV</Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Escolha a TV que você quer controlar</h2>
            {tvs.map((d) => {
              const st = situacao[d.session_id] ?? 'verificando';
              return (
                <button key={d.session_id} data-controle-tv={d.session_id} onClick={() => onEscolher(d)}
                  className="toque w-full text-left bg-card border border-border/60 rounded-xl p-4 flex items-center gap-3">
                  <Tv className={`w-6 h-6 shrink-0 ${st === 'aberta' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{d.name}{d.model ? <span className="text-muted-foreground font-normal"> · {d.model}</span> : null}</p>
                    {st === 'aberta' ? (
                      <p className="text-xs text-emerald-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /> WatchMov aberto agora</p>
                    ) : st === 'fechada' ? (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5"><span className="w-2 h-2 rounded-full border border-muted-foreground" /> Desligada ou com o WatchMov fechado</p>
                    ) : (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Verificando…</p>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                </button>
              );
            })}
            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </div>
          <Button variant="ghost" className="w-full gap-2 h-11 text-muted-foreground" onClick={onConectarTv}><Plus className="w-4 h-4" /> Conectar outra TV</Button>
          <p className="text-xs text-muted-foreground text-center">O controle mexe no WatchMov da TV. Ele precisa estar aberto nela.</p>
        </>
      )}
    </div>
  );
}

type Estado = 'conectando' | 'conectada' | 'sem-resposta';

function Tecla({ children, rotulo, aria, onPress, larga = false }: { children: ReactNode; rotulo?: string; aria?: string; onPress: () => void; larga?: boolean }) {
  return (
    <button onClick={onPress} aria-label={aria ?? rotulo}
      className={`toque ${larga ? 'flex-1 h-14 rounded-2xl gap-2' : 'h-16 w-16 rounded-full flex-col gap-0.5'} flex items-center justify-center
        bg-secondary text-foreground border border-border/60 active:scale-95 active:bg-primary/25 transition select-none`}>
      {children}
      {rotulo && <span className={larga ? 'text-sm font-medium' : 'text-[10px] text-muted-foreground'}>{rotulo}</span>}
    </button>
  );
}

function TeclaEp({ children, rotulo, onPress }: { children: ReactNode; rotulo: string; onPress: () => void }) {
  return (
    <button onClick={onPress} aria-label={rotulo}
      className="toque flex-1 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 bg-secondary text-foreground border border-border/60 active:scale-95 active:bg-primary/25 transition select-none">
      {children}
      <span className="text-xs font-medium">{rotulo}</span>
    </button>
  );
}

function Controle({ tv, onTrocar }: { tv: TvDevice; onTrocar: () => void }) {
  const [estado, setEstado] = useState<Estado>('conectando');
  const [tocando, setTocando] = useState<TocandoNaTv | null>(null);
  const estadoRef = useRef<Estado>('conectando');
  const falhas = useRef(0);
  const uid = useRef<string | null>(null);

  const mudar = (e: Estado) => { estadoRef.current = e; setEstado(e); };

  // Manda e lê a resposta. Uma falha solta não derruba (a rede do celular oscila): "não respondeu" só na 2ª seguida,
  // ou já na 1ª quando ainda estava conectando.
  const enviar = useCallback(async (cmd: { action: 'key'; key: TeclaControle } | { action: 'ping' }) => {
    uid.current = uid.current ?? (await sessao())?.user.id ?? null;
    if (!uid.current) return;
    const r = await mandarControle(uid.current, { id: newCmdId(), to: tv.session_id, ...cmd } as CtlCmd);
    if (r.result === 'ok') {
      falhas.current = 0;
      mudar('conectada');
      if (r.tocando !== undefined) setTocando(r.tocando);
    } else if (estadoRef.current === 'conectando' || ++falhas.current >= 2) {
      mudar('sem-resposta');
    }
  }, [tv.session_id]);

  useEffect(() => { void enviar({ action: 'ping' }); }, [enviar]);
  // Pergunta a cada 5 s (faixa "Tocando na TV"); no "não respondeu" segue perguntando e volta sozinho quando a TV
  // responder (uma troca de episódio deixava o aviso na tela com a TV já funcionando).
  useEffect(() => {
    if (estado === 'conectando') return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void enviar({ action: 'ping' }); }, PING_MS);
    return () => clearInterval(t);
  }, [estado, enviar]);

  const tentarDeNovo = () => { falhas.current = 0; mudar('conectando'); void enviar({ action: 'ping' }); };
  const tecla = (key: TeclaControle) => () => { void enviar({ action: 'key', key }); };

  // OK: tocar = OK; segurar = menu do título (o mesmo "segurar o OK" do controle da TV).
  const segurando = useRef<{ timer: ReturnType<typeof setTimeout>; disparou: boolean } | null>(null);
  const okApertou = () => {
    const s = { disparou: false, timer: setTimeout(() => { s.disparou = true; void enviar({ action: 'key', key: 'ok-hold' }); }, SEGURAR_OK_MS) };
    segurando.current = s;
  };
  const okSoltou = () => {
    const s = segurando.current;
    segurando.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    if (!s.disparou) void enviar({ action: 'key', key: 'ok' });
  };
  const okCancelou = () => { if (segurando.current) clearTimeout(segurando.current.timer); segurando.current = null; };
  useEffect(() => () => okCancelou(), []);

  // "Adicionar à tela inicial": só no celular com launcher que aceita e enquanto ainda não tem o widget lá.
  const [podeFixar, setPodeFixar] = useState(false);
  useEffect(() => {
    let vivo = true;
    void estadoDoWidget().then(e => { if (vivo) setPodeFixar(!!e?.suportaFixar && e.widgets === 0); });
    return () => { vivo = false; };
  }, []);
  const fixar = () => { setPodeFixar(false); void fixarWidget(); };

  const off = estado === 'sem-resposta' ? 'opacity-35 pointer-events-none' : '';
  const seta = 'toque absolute w-20 h-20 flex items-center justify-center text-foreground/90 active:text-primary select-none';

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-y-auto" data-controle-remoto>
      <header className="h-14 px-2 flex items-center gap-1 border-b border-border/50 shrink-0">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onTrocar} aria-label="Voltar"><ArrowLeft className="w-5 h-5" /></Button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight truncate">{tv.name}</p>
          {estado === 'conectada' ? (
            <p className="text-[11px] text-emerald-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Conectada</p>
          ) : estado === 'sem-resposta' ? (
            <p className="text-[11px] text-amber-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Sem resposta</p>
          ) : (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Conectando…</p>
          )}
        </div>
        <Button variant="ghost" className="h-9 px-3 text-primary text-sm" onClick={onTrocar}>Trocar TV</Button>
      </header>

      {estado === 'conectada' && tocando && (
        <div className="mx-4 mt-3 rounded-xl bg-card border border-border/60 p-2.5 flex items-center gap-3" data-tocando>
          {tocando.posterUrl
            ? <img src={tocando.posterUrl} alt="" className="w-9 aspect-[2/3] rounded object-cover shrink-0" />
            : <div className="w-9 aspect-[2/3] rounded bg-muted flex items-center justify-center shrink-0"><Tv className="w-4 h-4 text-muted-foreground" /></div>}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-primary font-medium">Tocando na TV</p>
            <p className="text-sm font-medium text-foreground truncate">{tocando.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {[tocando.season ? `Temporada ${tocando.season}` : '', tocando.episode ? `EP ${tocando.episode}` : '',
                tocando.positionMs != null ? `${tempo(tocando.positionMs)}${tocando.durationMs ? ` / ${tempo(tocando.durationMs)}` : ''}` : '']
                .filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-4">
        {estado === 'sem-resposta' && (
          <div className="w-full max-w-sm rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 space-y-3">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">A {tv.name} não respondeu</p>
                <p className="text-sm text-muted-foreground mt-0.5">Abra o WatchMov na TV e toque em Tentar de novo.</p>
              </div>
            </div>
            <Button className="w-full gap-2 h-10" onClick={tentarDeNovo}><RefreshCw className="w-4 h-4" /> Tentar de novo</Button>
          </div>
        )}

        <div className={`relative w-64 h-64 rounded-full bg-card border border-border/70 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] ${off}`}>
          <button className={`${seta} left-1/2 -translate-x-1/2 top-2`} onClick={tecla('up')} aria-label="Cima"><ChevronUp className="w-9 h-9" /></button>
          <button className={`${seta} left-1/2 -translate-x-1/2 bottom-2`} onClick={tecla('down')} aria-label="Baixo"><ChevronDown className="w-9 h-9" /></button>
          <button className={`${seta} top-1/2 -translate-y-1/2 left-2`} onClick={tecla('left')} aria-label="Esquerda"><ChevronLeft className="w-9 h-9" /></button>
          <button className={`${seta} top-1/2 -translate-y-1/2 right-2`} onClick={tecla('right')} aria-label="Direita"><ChevronRight className="w-9 h-9" /></button>
          <button aria-label="OK"
            onPointerDown={okApertou} onPointerUp={okSoltou} onPointerLeave={okCancelou} onPointerCancel={okCancelou}
            onContextMenu={(e) => e.preventDefault()}
            className="toque absolute inset-0 m-auto w-24 h-24 rounded-full bg-primary text-primary-foreground text-xl font-bold shadow-[0_0_30px_-4px_hsl(var(--primary)/0.7)] flex items-center justify-center active:scale-95 transition select-none [-webkit-touch-callout:none]">
            OK
          </button>
        </div>
        <p className={`text-xs text-muted-foreground -mt-2 ${off}`}>Segure o OK pra abrir o menu do título</p>

        <div className={`w-full max-w-sm flex gap-3 ${off}`}>
          <Tecla larga rotulo="Voltar" onPress={tecla('back')}><Undo2 className="w-5 h-5" /></Tecla>
          <Tecla larga rotulo="Início" onPress={tecla('home')}><House className="w-5 h-5" /></Tecla>
        </div>
        <div className={`w-full max-w-sm flex items-center justify-between px-4 ${off}`}>
          <Tecla rotulo="10 s" aria="Voltar 10 s" onPress={tecla('rew')}><Rewind className="w-5 h-5" /></Tecla>
          <button onClick={tecla('playpause')} aria-label="Play/pausa"
            className="toque h-[4.5rem] w-[4.5rem] rounded-full bg-secondary border border-border/60 flex items-center justify-center gap-0.5 active:scale-95 active:bg-primary/25 transition select-none">
            <Play className="w-5 h-5 fill-current" /><Pause className="w-5 h-5 fill-current" />
          </button>
          <Tecla rotulo="10 s" aria="Avançar 10 s" onPress={tecla('ff')}><FastForward className="w-5 h-5" /></Tecla>
        </div>
        <div className={`w-full max-w-sm flex gap-3 ${off}`}>
          <TeclaEp rotulo="Ep. anterior" onPress={tecla('prev-ep')}><SkipBack className="w-5 h-5" /></TeclaEp>
          <TeclaEp rotulo="Assistido" onPress={tecla('watched')}><CircleCheck className="w-5 h-5" /></TeclaEp>
          <TeclaEp rotulo="Próximo ep." onPress={tecla('next-ep')}><SkipForward className="w-5 h-5" /></TeclaEp>
        </div>
        {podeFixar && (
          <button onClick={fixar} className="toque flex items-center gap-2 text-sm text-primary py-1 select-none">
            <SquarePlus className="w-4 h-4" /> Adicionar o controle à tela inicial
          </button>
        )}
      </div>
    </div>
  );
}
