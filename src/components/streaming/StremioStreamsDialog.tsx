import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Browser } from '@capacitor/browser';
import { toast } from 'sonner';
import { Loader2, Play, Magnet, ExternalLink, Plus, Trash2, Settings2, RefreshCw, Languages } from 'lucide-react';
import {
  type StremioAddon, type StremioStream, type StremioTarget,
  loadAddons, saveAddons, fetchStreams, normalizeAddonUrl,
  buildMagnet, buildStremioDeepLink,
} from '@/lib/stremio';

interface SeasonInfo { number: number; totalEpisodes: number }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imdbId?: string;
  type: 'movie' | 'tv';
  seasons?: SeasonInfo[];      // só séries
  title?: string;
  onPlayUrl: (url: string, label: string, season?: number, episode?: number) => void;
  onPlayTorrent: (magnet: string, fileIdx: number | undefined, label: string, season?: number, episode?: number) => void;
}

export default function StremioStreamsDialog({ open, onOpenChange, imdbId, type, seasons, title, onPlayUrl, onPlayTorrent }: Props) {
  const isSeries = type === 'tv';
  const [addons, setAddons] = useState<StremioAddon[]>(() => loadAddons());
  const [streams, setStreams] = useState<StremioStream[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [season, setSeason] = useState(seasons?.[0]?.number ?? 1);
  const [episode, setEpisode] = useState(1);
  const [manage, setManage] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [onlyDubbed, setOnlyDubbed] = useState(true);

  const shown = onlyDubbed ? streams.filter(s => s.dubbed) : streams;
  const dubCount = streams.filter(s => s.dubbed).length;

  const target: StremioTarget = { imdbId, type, season: isSeries ? season : undefined, episode: isSeries ? episode : undefined };

  const search = useCallback(async () => {
    if (!imdbId) { setErrors(['Sem IMDB ID — o Stremio precisa do código IMDB deste título.']); setStreams([]); return; }
    setLoading(true); setErrors([]);
    const r = await fetchStreams(addons, { imdbId, type, season: isSeries ? season : undefined, episode: isSeries ? episode : undefined });
    setStreams(r.streams); setErrors(r.errors); setLoading(false);
  }, [addons, imdbId, type, isSeries, season, episode]);

  useEffect(() => { if (open) search(); }, [open, search]);

  const addAddon = () => {
    const url = normalizeAddonUrl(newUrl);
    if (!/^https:\/\//i.test(url)) { toast.error('URL inválida', { description: 'Cole a URL do addon (https://…/manifest.json).' }); return; }
    if (addons.some(a => normalizeAddonUrl(a.url) === url)) { toast.info('Addon já adicionado'); return; }
    let name = 'Addon';
    try { name = new URL(url).hostname.split('.')[0]; } catch { /* ignore */ }
    const next = [...addons, { name, url }];
    setAddons(next); saveAddons(next); setNewUrl('');
  };
  const removeAddon = (url: string) => {
    const next = addons.filter(a => a.url !== url);
    setAddons(next); saveAddons(next);
  };

  const onStreamClick = (s: StremioStream) => {
    const se = isSeries ? season : undefined;
    const ep = isSeries ? episode : undefined;
    const label = `${s.addon} ${s.quality ?? ''}`.trim();
    if (s.url) {
      onPlayUrl(s.url, label, se, ep);
    } else {
      // torrent → tenta tocar via WebTorrent dentro do app
      onPlayTorrent(buildMagnet(s), s.fileIdx, label, se, ep);
    }
    onOpenChange(false);
  };

  const openInStremio = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = buildStremioDeepLink(target);
    if (link) await Browser.open({ url: link });
  };

  const copyMagnet = async (e: React.MouseEvent, s: StremioStream) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(buildMagnet(s)); toast.success('Magnet copiado'); }
    catch { toast.error('Não foi possível copiar'); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-6">
            <span className="truncate">Stremio — {title || 'Opções de vídeo'}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Gerenciar addons" onClick={() => setManage(m => !m)}>
              <Settings2 className="w-4 h-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Filtro dublado */}
        <div className="flex items-center gap-2">
          <button onClick={() => setOnlyDubbed(v => !v)}
            className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 border transition ${onlyDubbed ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-muted border-border text-muted-foreground'}`}>
            <Languages className="w-3.5 h-3.5" /> Só dublado {onlyDubbed && dubCount > 0 ? `(${dubCount})` : ''}
          </button>
          <span className="text-[11px] text-muted-foreground">Ordenado por dublado · qualidade (4K › 1080p › 720p)</span>
        </div>

        {/* Séries: seletor temporada/episódio */}
        {isSeries && (
          <div className="flex items-center gap-2 text-sm">
            <select value={season} onChange={e => setSeason(Number(e.target.value))}
              className="bg-muted rounded-md px-2 py-1.5 text-foreground">
              {(seasons ?? [{ number: 1, totalEpisodes: 1 }]).map(s => <option key={s.number} value={s.number}>Temporada {s.number}</option>)}
            </select>
            <select value={episode} onChange={e => setEpisode(Number(e.target.value))}
              className="bg-muted rounded-md px-2 py-1.5 text-foreground">
              {Array.from({ length: seasons?.find(s => s.number === season)?.totalEpisodes ?? 1 }, (_, i) => i + 1)
                .map(ep => <option key={ep} value={ep}>Ep {ep}</option>)}
            </select>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={search} title="Buscar"><RefreshCw className="w-4 h-4" /></Button>
          </div>
        )}

        {/* Gerenciador de addons */}
        {manage && (
          <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/30">
            <p className="text-xs text-muted-foreground">Cole a URL de instalação do addon (com debrid configurado, devolve links que tocam aqui).</p>
            <div className="flex gap-2">
              <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://…/manifest.json" className="h-8 text-sm" />
              <Button size="sm" className="h-8 shrink-0" onClick={addAddon}><Plus className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-1">
              {addons.map(a => (
                <div key={a.url} className="flex items-center justify-between text-xs bg-background rounded px-2 py-1">
                  <span className="truncate flex-1">{a.name} <span className="text-muted-foreground">— {a.url}</span></span>
                  <button onClick={() => removeAddon(a.url)} className="text-destructive shrink-0 ml-2"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              {addons.length === 0 && <p className="text-xs text-muted-foreground">Nenhum addon. Adicione um acima.</p>}
            </div>
          </div>
        )}

        {/* Lista de streams */}
        <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Buscando opções…</div>
          ) : shown.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground space-y-1">
              <p>{onlyDubbed && streams.length > 0 ? 'Nenhuma opção dublada encontrada.' : 'Nenhuma opção encontrada.'}</p>
              {onlyDubbed && streams.length > 0 && <button onClick={() => setOnlyDubbed(false)} className="text-xs text-primary underline">Ver todas ({streams.length})</button>}
              {errors.map((er, i) => <p key={i} className="text-xs text-destructive">{er}</p>)}
            </div>
          ) : (
            <div className="space-y-2">
              {shown.map(s => (
                <button key={s.id} onClick={() => onStreamClick(s)}
                  className="w-full text-left rounded-lg border border-border bg-card hover:border-primary p-2.5 transition group">
                  <div className="flex items-start gap-2">
                    <Play className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <span className="text-sm font-medium text-foreground">{s.addon}</span>
                        {s.quality && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{s.quality}</Badge>}
                        {s.size && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{s.size}</Badge>}
                        {s.dubbed && <Badge className="text-[10px] px-1.5 py-0 bg-emerald-600">PT/Dub</Badge>}
                        {s.url ? <Badge className="text-[10px] px-1.5 py-0 bg-primary">Direto</Badge>
                               : <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-600/40">Torrent</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">{s.detail || s.filename}</p>
                      {!s.url && (
                        <div className="flex gap-3 mt-1.5 text-[11px]">
                          <span className="text-muted-foreground">Toca via WebTorrent</span>
                          <span onClick={openInStremio} className="flex items-center gap-1 text-primary hover:underline"><ExternalLink className="w-3 h-3" /> Stremio</span>
                          <span onClick={e => copyMagnet(e, s)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground"><Magnet className="w-3 h-3" /> Magnet</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
