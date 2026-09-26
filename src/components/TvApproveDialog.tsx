import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Loader2, Tv } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { isTv } from "@/lib/device";
import {
  approveTvCode, codeFromUrl, formatCode, normalizeCode, takePendingTvCode, TV_APPROVE_EVENT, TV_APPROVED_EVENT,
} from "@/lib/tvPair";

const LAUNCH_SEEN_KEY = "wm_tv_launch_seen";

// Celular logado aprova o login da TV. Abre por: QR lido pela câmera (App Link /tv?c= no app, ou o
// site guardou o código antes do login), ou o botão "Entrar na TV" do Painel (sem código = digitar).
export function TvApproveDialog() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [fromLink, setFromLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = (code: string | null) => {
    setTyped(code ? formatCode(code) : "");
    setFromLink(!!code);
    setError(null);
    setOpen(true);
  };

  useEffect(() => {
    if (isTv()) return;
    const pending = takePendingTvCode();
    if (pending) show(pending);
    const onReq = (e: Event) => show(normalizeCode((e as CustomEvent<{ code: string | null }>).detail?.code));
    window.addEventListener(TV_APPROVE_EVENT, onReq);
    let handle: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      // App aberto pelo QR (App Link): 1ª abertura vem no launch URL; com o app aberto, no appUrlOpen.
      App.getLaunchUrl().then((r) => {
        const url = r?.url;
        const code = codeFromUrl(url);
        if (!code || sessionStorage.getItem(LAUNCH_SEEN_KEY) === url) return;
        try { sessionStorage.setItem(LAUNCH_SEEN_KEY, url!); } catch { /* ignore */ }
        show(code);
      }).catch(() => {});
      App.addListener("appUrlOpen", ({ url }) => {
        const code = codeFromUrl(url);
        if (code) show(code);
      }).then((h) => { handle = h; }).catch(() => {});
    }
    return () => { window.removeEventListener(TV_APPROVE_EVENT, onReq); handle?.remove(); };
  }, []);

  if (isTv()) return null;
  const code = normalizeCode(typed);

  const confirm = async () => {
    if (!code) { setError("O código tem 6 letras/números, como aparece na TV."); return; }
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setBusy(false); setError("Entre no app primeiro."); return; }
    const r = await approveTvCode(code, token).catch(() => ({ ok: false as const, message: "Sem conexão. Tente de novo." }));
    setBusy(false);
    if ("message" in r) { setError(r.message); return; }
    setOpen(false);
    window.dispatchEvent(new Event(TV_APPROVED_EVENT));
    toast.success("Pronto! A TV entrou na sua conta.", { description: "Em alguns segundos ela abre o app." });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tv className="w-5 h-5 text-primary" /> Entrar na TV</DialogTitle>
          <DialogDescription>
            {fromLink
              ? <>A TV vai entrar com a sua conta{user?.email ? <> (<b>{user.email}</b>)</> : null}.</>
              : <>Digite o código que aparece na TV. Ela vai entrar com a sua conta{user?.email ? <> (<b>{user.email}</b>)</> : null}.</>}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={typed}
          onChange={(e) => { setTyped(e.target.value.toUpperCase()); setError(null); }}
          placeholder="ABC-DEF"
          maxLength={7}
          autoCapitalize="characters"
          autoComplete="off"
          className="text-center text-2xl font-mono tracking-[0.25em] h-14"
          readOnly={fromLink}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={confirm} disabled={busy || !code}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar na TV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
