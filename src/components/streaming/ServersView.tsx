import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Star } from 'lucide-react';
import { PROVIDERS, type Provider } from '@/lib/players';
import { useFavoriteServer, saveFavoriteServer, serverLabel } from '@/lib/favoriteServer';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

// Aba "Servidores" do Painel (abaixo de Download — pedido 07/09/2026): lista as
// fontes do Assistir e deixa marcar a FAVORITA, que passa a abrir por padrão
// (antes o padrão era fixo na Fonte 6). Tocar num servidor → popup de confirmação.
export default function ServersView({ onBack }: { onBack: () => void }) {
  const fav = useFavoriteServer();
  const [pending, setPending] = useState<Provider | null>(null);

  const confirm = () => {
    if (!pending) return;
    saveFavoriteServer(pending.id);
    toast.success(`${serverLabel(pending)} é o servidor favorito`, { description: 'Passa a abrir primeiro no Assistir.' });
    setPending(null);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="text-xl font-bold">Servidores</h1>
      </div>
      <p className="text-sm text-muted-foreground">O servidor favorito abre primeiro no Assistir. Toque em um pra marcar.</p>

      <div className="space-y-2">
        {PROVIDERS.map(p => {
          const isFav = p.id === fav;
          return (
            <button
              key={p.id}
              type="button"
              data-server={p.id}
              data-favorite={isFav ? '1' : undefined}
              onClick={() => { if (isFav) toast.info(`${serverLabel(p)} já é o favorito`); else setPending(p); }}
              className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${isFav ? 'border-primary bg-primary/10' : 'border-border/60 bg-card hover:bg-secondary'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-foreground">{p.name}</span>
              </span>
              {isFav ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                  <Star className="w-4 h-4 fill-current" /> Favorito
                </span>
              ) : (
                <Star className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>

      <AlertDialog open={!!pending} onOpenChange={o => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar servidor {pending ? serverLabel(pending) : ''} como favorito?</AlertDialogTitle>
            <AlertDialogDescription>Ele passa a abrir primeiro no Assistir.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
