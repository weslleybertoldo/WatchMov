import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createTvCode, pollTvCode, tvLinkFor, formatCode, type TvCode } from "@/lib/tvPair";

// Login da TV (Fire TV não tem navegador pro Google): mostra um QR + código; o celular logado
// aprova e a TV entra sozinha. Código novo quando vence (5 min) ou dá errado.
const POLL_MS = 2000;
const RETRY_MS = 5000;

export function TvLogin() {
  const [pair, setPair] = useState<TvCode | null>(null);
  const [qr, setQr] = useState("");
  const [status, setStatus] = useState<"loading" | "waiting" | "entering">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const [round, setRound] = useState(0);   // +1 = pedir código novo

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setStatus("loading");
    setPair(null);
    createTvCode()
      .then(async (p) => {
        const img = await QRCode.toDataURL(tvLinkFor(p.code), { margin: 1, width: 400, errorCorrectionLevel: "M" });
        if (!alive) return;
        setPair(p);
        setQr(img);
        setStatus("waiting");
      })
      .catch(() => {
        if (!alive) return;
        setMsg("Sem conexão com o servidor. Tentando de novo…");
        retry = setTimeout(() => setRound((r) => r + 1), RETRY_MS);
      });
    return () => { alive = false; clearTimeout(retry); };
  }, [round]);

  useEffect(() => {
    if (!pair || status !== "waiting") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive) return;
      if (Date.now() >= Date.parse(pair.expires_at)) { setRound((r) => r + 1); return; }
      const r = await pollTvCode(pair.code, pair.secret).catch(() => null);   // rede caiu: tenta no próximo
      if (!alive) return;
      if (r?.status === "approved") {
        setStatus("entering");
        const { error } = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: "magiclink" });
        // Deu certo: o AuthContext recebe a sessão e troca a tela sozinho.
        if (error && alive) { setMsg("Não deu pra entrar. Gerando outro código…"); setRound((x) => x + 1); }
        return;
      }
      if (r && r.status !== "pending") { setRound((x) => x + 1); return; }
      timer = setTimeout(tick, POLL_MS);
    };
    setMsg(null);
    timer = setTimeout(tick, POLL_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [pair, status]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-4xl flex items-center justify-between gap-10">
        <div className="flex-1 space-y-5">
          <img src="/logo.png" alt="WatchMov" className="w-36 rounded-xl" />
          <h1 className="text-3xl font-bold text-foreground">Entrar na TV</h1>
          <ol className="space-y-3 text-lg text-muted-foreground">
            <li><span className="font-bold text-primary">1.</span> No celular, aponte a câmera pro QR code.</li>
            <li><span className="font-bold text-primary">2.</span> Ou no app do celular: <b className="text-foreground">Painel → Entrar na TV</b> e digite o código.</li>
            <li><span className="font-bold text-primary">3.</span> Confirme no celular. A TV entra sozinha.</li>
          </ol>
          <p className="text-sm text-muted-foreground">O código muda a cada 5 minutos.</p>
        </div>
        <div className="flex flex-col items-center gap-4 shrink-0">
          <div className="w-64 h-64 rounded-2xl bg-white p-3 flex items-center justify-center">
            {pair && qr ? (
              <img src={qr} alt="QR code para entrar" className="w-full h-full" />
            ) : (
              <Loader2 className="w-10 h-10 animate-spin text-neutral-400" />
            )}
          </div>
          <p className="text-4xl font-mono font-bold tracking-[0.25em] text-foreground">
            {pair ? formatCode(pair.code) : "···-···"}
          </p>
          {status === "entering" && (
            <p className="text-base text-primary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Entrando…</p>
          )}
          {msg && <p className="text-sm text-destructive max-w-64 text-center">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
