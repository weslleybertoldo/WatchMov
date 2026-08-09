import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Pencil, Check, Trash2, Play, DownloadCloud } from 'lucide-react';
import {
  useDownloadList, playDownloaded, removeDownload, clearDownloadsFor,
  movieKey, watchProgressOf, type DownloadMeta,
} from '@/lib/downloads';
import { Downloader, downloadsNative, fmtBytes, type DownloadItem } from '@/lib/downloader';
import { useMp4, mp4Native, convertToMp4, openMp4, cancelMp4 } from '@/lib/mp4Download';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAndroidBackButton } from '@/hooks/use-android-back';

interface TitleGroup {
  tmdbId: number; type: 'movie' | 'tv'; title: string; posterUrl?: string;
  keys: string[];
  episodes: { season: number; ep: number; key: string; stillUrl?: string }[];
}

function group(meta: Record<string, DownloadMeta>): TitleGroup[] {
  const map = new Map<number, TitleGroup>();
  for (const [key, m] of Object.entries(meta)) {
    let g = map.get(m.tmdbId);
    if (!g) { g = { tmdbId: m.tmdbId, type: m.type, title: m.title, posterUrl: m.posterUrl, keys: [], episodes: [] }; map.set(m.tmdbId, g); }
    g.keys.push(key);
    if (m.type === 'tv' && m.season != null && m.ep != null) g.episodes.push({ season: m.season, ep: m.ep, key, stillUrl: m.stillUrl });
  }
  map.forEach(g => g.episodes.sort((a, b) => a.season - b.season || a.ep - b.ep));
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// Barra de progresso / estado sobre a arte.
function Progress({ item }: { item?: DownloadItem }) {
  if (!item || item.state === 'completed' || item.state === 'removed') return null;
  if (item.state === 'failed') {
    return <div className="absolute bottom-0 inset-x-0 bg-black/70 px-1 py-0.5 text-[9px] text-destructive truncate">Falhou: {item.reason || 'erro'}</div>;
  }
  const p = item.percent >= 0 ? item.percent : null;
  return (
    <div className="absolute bottom-0 inset-x-0 bg-black/70 px-1.5 py-1">
      <div className="h-1 rounded bg-white/20 overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${p ?? 6}%` }} />
      </div>
      <p className="text-[9px] text-white/80 mt-0.5">{item.state === 'downloading' ? (p != null ? `${p}%` : 'baixando…') : item.state === 'queued' ? 'na fila…' : item.state}</p>
    </div>
  );
}

// Anel amarelo de download (mesmo desenho da grade de episódios): sem % conhecido,
// gira; com %, vai fechando.
function Ring({ percent }: { percent: number | null }) {
  const R = 9, C = 2 * Math.PI * R;
  return (
    <span className="relative inline-flex items-center justify-center w-[22px] h-[22px]">
      <svg viewBox="0 0 24 24" className={`absolute inset-0 w-full h-full -rotate-90 ${percent == null ? 'animate-spin' : ''}`}>
        <circle cx="12" cy="12" r={R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
        <circle cx="12" cy="12" r={R} fill="none" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - (percent ?? 25) / 100)} />
      </svg>
      <DownloadCloud className="w-3 h-3 text-yellow-400" />
    </span>
  );
}

// Formato do arquivo + conversão, no canto do item baixado:
//  • ".exo"  → só o cache do app (só o WatchMov lê)
//  • anel amarelo girando → convertendo pra MP4 (mesmo desenho do download)
//  • "MP4" verde → tem arquivo em Movies/WatchMov; toca abrir no WVC/VLC
function Mp4Btn({ dlKey, title }: { dlKey: string; title?: string }) {
  const mp4 = useMp4(dlKey);
  const [askCancel, setAskCancel] = useState(false);
  if (!mp4Native()) return null;
  const queued = mp4?.state === 'queued';
  const converting = mp4?.state === 'converting' || queued;
  const ready = mp4?.state === 'done';
  const R = 9, C = 2 * Math.PI * R;
  const pct = mp4 && mp4.percent >= 0 ? mp4.percent : null;
  const btn = (
    <button
      className="absolute top-0.5 left-0.5 z-20 rounded bg-black/70 px-1 py-0.5 text-[8px] leading-none font-semibold flex items-center gap-0.5"
      title={ready ? 'Abrir no Web Video Cast / VLC' : queued ? 'Na fila — começa quando a atual terminar' : converting ? 'Convertendo…' : 'Converter pra MP4 (abre em outros apps)'}
      onClick={ev => {
        ev.stopPropagation();
        // Tocar de novo enquanto converte = pedido de cancelar, mas só depois de
        // confirmar: perder 10 min de conversão por um toque errado seria cruel.
        if (converting) { setAskCancel(true); return; }
        if (ready) openMp4(dlKey, title); else convertToMp4(dlKey, title);
      }}>
      {converting ? (
        <span className="relative inline-flex items-center justify-center w-[18px] h-[18px]">
          <svg viewBox="0 0 24 24" className={`absolute inset-0 w-full h-full -rotate-90 ${pct == null ? 'animate-spin' : ''}`}>
            <circle cx="12" cy="12" r={R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
            <circle cx="12" cy="12" r={R} fill="none" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - (pct ?? 25) / 100)} />
          </svg>
        </span>
      ) : ready ? <span className="text-green-400">MP4</span>
        : <span className="text-white/70">.exo</span>}
    </button>
  );

  return (
    <>
      {btn}
      {/* O diálogo vai pra um portal, mas evento de portal no React sobe pela árvore
          de COMPONENTES, não pelo DOM: sem este wrapper, tocar no fundo escuro
          chegava no onClick do card e abria o reprodutor. */}
      <span onClick={ev => ev.stopPropagation()} onPointerDown={ev => ev.stopPropagation()}>
      <AlertDialog open={askCancel} onOpenChange={setAskCancel}>
        <AlertDialogContent onClick={ev => ev.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a conversão?</AlertDialogTitle>
            <AlertDialogDescription>
              {queued
                ? 'Este item sai da fila e não vira MP4. O download continua intacto.'
                : 'O que já foi convertido é descartado e você começa do zero depois. O download continua intacto.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar convertendo</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancelMp4(dlKey)}>Sim, cancelar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </span>
    </>
  );
}

function Poster({ meta, item, onClick, editing, badge, watched, progress, subtitle, size, busy }: {
  meta: { title: string; posterUrl?: string }; item?: DownloadItem;
  onClick: () => void; editing: boolean; badge?: string; watched?: boolean;
  progress?: { percent: number; label: string } | null; subtitle?: string; size?: string;
  busy?: DownloadItem;   // download rolando AGORA (o do filme ou o do episódio da série)
}) {
  return (
    <button onClick={onClick} className="relative block text-left">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-secondary">
        {meta.posterUrl
          ? <img src={meta.posterUrl} alt={meta.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs p-2 text-center">{meta.title}</div>}
        {!editing && item?.state === 'completed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 active:opacity-100">
            <Play className="w-8 h-8 text-white fill-current" />
          </div>
        )}
        {editing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="w-8 h-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"><Trash2 className="w-4 h-4" /></span>
          </div>
        )}
        {badge && <span className="absolute top-1 right-1 text-[9px] bg-black/70 text-white rounded px-1">{badge}</span>}
        {watched && (
          <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-green-500/90 flex items-center justify-center" title="Assistido">
            <Check className="w-3.5 h-3.5 text-white" />
          </span>
        )}
        <Progress item={item} />
        {/* Baixando: anel no canto + faixa com o % (série não tem "item" próprio,
            então o andamento vem do episódio que está na fila/baixando). */}
        {!editing && busy && (
          <>
            <span className="absolute top-1 left-1 z-10"><Ring percent={busy.percent >= 0 ? busy.percent : null} /></span>
            {!item && (
              <div className="absolute bottom-0 inset-x-0 bg-black/70 px-1.5 py-1">
                <div className="h-1 rounded bg-white/20 overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${busy.percent >= 0 ? busy.percent : 6}%` }} />
                </div>
                <p className="text-[9px] text-white/80 mt-0.5">{busy.state === 'downloading' ? (busy.percent >= 0 ? `${busy.percent}%` : 'baixando…') : 'na fila…'}</p>
              </div>
            )}
          </>
        )}
      </div>
      <p className="text-xs mt-1 line-clamp-1">{meta.title}</p>
      {size && <p className="text-[10px] text-muted-foreground">{size}</p>}
      {subtitle && <p className="text-[10px] text-green-400 truncate">{subtitle}</p>}
      {/* Barra + tempo assistido/total — mesmo formato do "Continuar assistindo". */}
      {progress && (
        <div className="mt-1">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{progress.label}</p>
        </div>
      )}
    </button>
  );
}

// Sub-tela: episódios baixados de uma série. Clicar reproduz; lápis → selecionar/excluir.
function SeriesEpisodes({ g, items, onBack }: { g: TitleGroup; items: Map<string, DownloadItem>; onBack: () => void }) {
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setSel(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const removeSel = () => { sel.forEach(k => removeDownload(k)); setSel(new Set()); setEditing(false); };
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-lg font-bold truncate">{g.title}</h1>
        </div>
        <Button variant={editing ? 'default' : 'outline'} size="icon" className="h-8 w-8" onClick={() => { setEditing(e => !e); setSel(new Set()); }}>
          {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
        </Button>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {g.episodes.map(e => {
          const item = items.get(e.key);
          const picked = sel.has(e.key);
          const done = item?.state === 'completed';
          const wp = watchProgressOf(e.key);
          return (
            // <div role="button">, não <button>: precisa aceitar o botão de converter
            // DENTRO (botão dentro de botão é HTML inválido) e, como filho direto do
            // grid, o div mantém o tamanho da célula — foi trocar isso por um wrapper
            // que a tela colapsou na v3.98.
            <div key={e.key} role="button" tabIndex={0}
              onClick={() => editing ? toggle(e.key) : (done ? playDownloaded(e.key) : undefined)}
              className={`relative aspect-square overflow-hidden rounded-lg flex flex-col items-center justify-center text-xs font-medium border transition cursor-pointer
                ${picked ? 'border-destructive bg-destructive/15 text-destructive'
                  : done ? 'border-green-400/40 bg-green-400/5 text-foreground'
                  : 'border-border bg-secondary/40 text-muted-foreground'}`}>
              {/* Frame do episódio (guardado no meta quando baixou → funciona offline). */}
              {e.stillUrl && (
                <img src={e.stillUrl} alt="" loading="lazy"
                  className={`absolute inset-0 w-full h-full object-cover ${wp?.watched ? 'opacity-25 grayscale' : 'opacity-40'}`} />
              )}
              <span className="relative z-10 text-[10px] text-muted-foreground">T{e.season}</span>
              <span className="relative z-10 text-sm">{e.ep}</span>
              {/* Em andamento: mesmo anel amarelo da grade de episódios do título,
                  em vez de um "43%" solto que passava despercebido. */}
              {!editing && item && (item.state === 'downloading' || item.state === 'queued' || item.state === 'restarting') && (
                <span className="absolute top-0.5 right-0.5 z-10"><Ring percent={item.percent >= 0 ? item.percent : null} /></span>
              )}
              {!editing && item && item.state !== 'completed' && (
                <span className="text-[9px] text-primary">{item.state === 'downloading' ? (item.percent >= 0 ? `${item.percent}%` : '…') : item.state === 'failed' ? 'falhou' : '…'}</span>
              )}
              {!editing && item?.state === 'completed' && (item.bytes ?? 0) > 0 && (
                <span className="text-[9px] text-muted-foreground">{fmtBytes(item.bytes)}</span>
              )}
              {editing && picked && (
                <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-sm bg-destructive flex items-center justify-center"><Check className="w-3 h-3 text-destructive-foreground" /></span>
              )}
              {!editing && wp?.watched && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-green-500/90 flex items-center justify-center" title="Assistido"><Check className="w-3 h-3 text-white" /></span>
              )}
              {!editing && wp && !wp.watched && (
                <>
                  <span className="absolute bottom-4 inset-x-1 h-0.5 rounded bg-white/15"><span className="block h-full bg-primary rounded" style={{ width: `${wp.percent}%` }} /></span>
                  <span className="absolute bottom-0.5 inset-x-0 text-[8px] text-muted-foreground text-center truncate px-0.5">{wp.label}</span>
                </>
              )}
              {!editing && done && <Mp4Btn dlKey={e.key} title={g.title} />}
            </div>
          );
        })}
      </div>
      {editing && (
        <Button variant="destructive" className="w-full gap-2" onClick={removeSel} disabled={sel.size === 0}>
          <Trash2 className="w-4 h-4" /> Excluir{sel.size > 0 ? ` (${sel.size})` : ''}
        </Button>
      )}
    </div>
  );
}

function Section({ title, groups, items, editing, onOpen, onDelete }: {
  title: string; groups: TitleGroup[]; items: Map<string, DownloadItem>; editing: boolean;
  onOpen: (g: TitleGroup) => void; onDelete: (g: TitleGroup) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {groups.map(g => {
          const item = g.type === 'movie' ? items.get(movieKey(g.tmdbId)) : undefined;
          const emAndamento = (s?: DownloadItem['state']) => s === 'downloading' || s === 'queued' || s === 'restarting';
          const dlCount = g.episodes.filter(e => emAndamento(items.get(e.key)?.state)).length;
          // Filme usa o próprio item; série mostra o episódio que está baixando agora.
          const busy = g.type === 'movie'
            ? (emAndamento(item?.state) ? item : undefined)
            : g.episodes.map(e => items.get(e.key)).find(d => emAndamento(d?.state));
          const badge = g.type === 'tv' ? `${g.episodes.length} ep${dlCount ? ` · ${dlCount}↓` : ''}` : undefined;
          // Filme: check se assistido. Série: check se TODOS os eps baixados foram vistos.
          const watched = g.type === 'movie'
            ? !!watchProgressOf(movieKey(g.tmdbId))?.watched
            : g.episodes.length > 0 && g.episodes.every(e => watchProgressOf(e.key)?.watched);
          // Barra + tempo (igual "Continuar assistindo"): filme = o próprio; série =
          // o episódio em andamento (último começado e não terminado).
          let progress = g.type === 'movie' ? watchProgressOf(movieKey(g.tmdbId)) : null;
          let subtitle: string | undefined;
          if (g.type === 'tv') {
            const cur = [...g.episodes].reverse().find(e => { const p = watchProgressOf(e.key); return p && !p.watched; });
            if (cur) { progress = watchProgressOf(cur.key); subtitle = `EP ${cur.ep} | Temporada ${cur.season}`; }
          }
          // Quanto ocupa no aparelho: filme = o próprio item; série = soma dos eps.
          const bytes = g.type === 'movie'
            ? (item?.bytes ?? 0)
            : g.episodes.reduce((acc, e) => acc + (items.get(e.key)?.bytes ?? 0), 0);
          return (
            <div key={g.tmdbId} className="relative">
              <Poster meta={g} item={item} editing={editing} badge={badge} watched={watched} busy={busy}
                progress={progress} subtitle={subtitle} size={bytes > 0 ? fmtBytes(bytes) : undefined}
                onClick={() => editing ? onDelete(g) : onOpen(g)} />
              {/* Série converte por EPISÓDIO (lá dentro), não pelo card do título. */}
              {g.type === 'movie' && !editing && item?.state === 'completed' && (
                <Mp4Btn dlKey={movieKey(g.tmdbId)} title={g.title} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DownloadView({ onBack }: { onBack: () => void }) {
  const { meta, items } = useDownloadList();
  const [editing, setEditing] = useState(false);
  const [openSeries, setOpenSeries] = useState<number | null>(null);

  // Voltar (botão ou gesto) DENTRO dos episódios fecha só a sub-tela — antes ele
  // caía direto no handler do Index, que fechava a aba inteira e devolvia o
  // usuário às Configurações (de onde a aba é aberta).
  useAndroidBackButton(() => {
    if (openSeries != null) { setOpenSeries(null); return true; }
    return false;
  });

  const [freeBytes, setFreeBytes] = useState(0);

  // Rede de segurança: o app já retoma os downloads interrompidos ao abrir, mas se
  // o usuário vem parar AQUI é porque quer ver o download andando — pede de novo.
  // Junto, lê o espaço livre do aparelho pro resumo do topo.
  useEffect(() => {
    if (!downloadsNative()) return;
    Downloader.resume().catch(() => {});
    Downloader.storage().then(s => setFreeBytes(s?.freeBytes ?? 0)).catch(() => {});
  }, []);

  // Quanto os downloads ocupam ao todo (soma o que o Media3 já gravou em disco).
  const totalBytes = [...items.values()].reduce((acc, i) => acc + (i.bytes ?? 0), 0);

  const groups = group(meta);
  const movies = groups.filter(g => g.type === 'movie');
  const series = groups.filter(g => g.type === 'tv');
  const empty = groups.length === 0;

  // A série aberta pode sumir (último episódio excluído). NÃO chamar setState no
  // render (React reclama e pode entrar em loop): mostra a lista de novo, com um
  // aviso, e o próprio clique em Voltar limpa o estado.
  const openedSeries = openSeries != null ? series.find(s => s.tmdbId === openSeries) : undefined;
  if (openedSeries) {
    return <SeriesEpisodes g={openedSeries} items={items} onBack={() => setOpenSeries(null)} />;
  }

  const openItem = (g: TitleGroup) => {
    if (g.type === 'tv') { setOpenSeries(g.tmdbId); return; }
    const item = items.get(movieKey(g.tmdbId));
    if (item?.state === 'completed') playDownloaded(movieKey(g.tmdbId));
  };
  const deleteItem = (g: TitleGroup) => clearDownloadsFor(g.tmdbId, g.type === 'movie');

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-bold">Download</h1>
        </div>
        {!empty && (
          <Button variant={editing ? 'default' : 'outline'} size="icon" className="h-8 w-8"
            title={editing ? 'Concluir' : 'Excluir downloads'} onClick={() => setEditing(e => !e)}>
            {editing ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </Button>
        )}
      </div>

      {!empty && (totalBytes > 0 || freeBytes > 0) && (
        <p className="text-xs text-muted-foreground -mt-4">
          Ocupando <span className="text-foreground font-medium">{fmtBytes(totalBytes)}</span>
          {freeBytes > 0 && <> · {fmtBytes(freeBytes)} livres no aparelho</>}
        </p>
      )}

      {empty ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nada baixado ainda. Abra um título, dê play e toque em ⤓ Baixar num link "Completo" (MASTER) — o vídeo fica disponível offline aqui.
        </p>
      ) : (
        <>
          <Section title="Filmes" groups={movies} items={items} editing={editing} onOpen={openItem} onDelete={deleteItem} />
          <Section title="Séries" groups={series} items={items} editing={editing} onOpen={openItem} onDelete={deleteItem} />
        </>
      )}
    </div>
  );
}
