import { useState, useEffect, useRef } from "react";
import { Download, X, CheckCircle, RefreshCw } from "lucide-react";
import { downloadAndInstall } from "@/lib/apkUpdater";

const CURRENT_VERSION = __APP_VERSION__;
const RELEASES_URL = "https://api.github.com/repos/weslleybertoldo/WatchMov/releases/latest";

interface VersionInfo {
  version: string;
  download_url: string;
}

export function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split(".").map(Number);
  const l = local.split(".").map(Number);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

export default function UpdateChecker() {
  const [update, setUpdate] = useState<VersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [justChecked, setJustChecked] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [needsPerm, setNeedsPerm] = useState(false);
  const mountedRef = useRef(true);

  const handleDownload = async () => {
    if (!update) return;
    setNeedsPerm(false);
    setProgress(0);
    try {
      const res = await downloadAndInstall(update.download_url, (p) => {
        if (mountedRef.current) setProgress(p);
      });
      if (res === "permission" && mountedRef.current) setNeedsPerm(true);
      // Reseta a barra: se cancelar a tela "Instalar?", o botão reaparece.
      if (mountedRef.current) setProgress(null);
    } catch {
      if (mountedRef.current) setProgress(null);
    }
  };

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const checkUpdate = async () => {
    setChecking(true);
    setJustChecked(false);
    try {
      const res = await fetch(RELEASES_URL, { cache: "no-store" });
      if (!res.ok) return;
      const release = await res.json();

      const remoteVersion = (release.tag_name || "").replace(/^v/, "");
      if (!remoteVersion || !mountedRef.current) return;

      if (isNewerVersion(remoteVersion, CURRENT_VERSION)) {
        const apkAsset = (release.assets || []).find(
          (a: { name: string }) => a.name.endsWith(".apk")
        );
        setUpdate({
          version: remoteVersion,
          download_url: apkAsset?.browser_download_url || release.html_url,
        });
        setDismissed(false);
      } else {
        setUpdate(null);
        setJustChecked(true);
        setTimeout(() => {
          if (mountedRef.current) setJustChecked(false);
        }, 3000);
      }
    } catch {
      // sem internet
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  };

  useEffect(() => {
    checkUpdate();
  }, []);

  if (update && !dismissed) {
    return (
      <>
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md">
          <div className="bg-card border border-blue-300 dark:border-blue-700 rounded-xl p-4 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium">Nova versao disponivel!</p>
                <p className="text-xs text-muted-foreground mt-1">
                  v{CURRENT_VERSION} → v{update.version}
                </p>
              </div>
              <button onClick={() => setDismissed(true)} className="p-1 text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            {progress !== null ? (
              <div className="mt-3">
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  {progress < 100 ? `Baixando ${progress}%` : "Abrindo instalador..."}
                </p>
              </div>
            ) : (
              <>
                {needsPerm && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Permita "instalar apps desconhecidos" para o WatchMov nas
                    configuracoes que abriram, depois toque em baixar novamente.
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleDownload}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-4 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  <Download size={14} />
                  {needsPerm ? "Tentar novamente" : "Baixar atualizacao"}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-xs text-blue-600">v{update.version} disponivel</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-3.5 w-3.5 text-green-600" />
        <span className="text-xs text-muted-foreground">
          v{CURRENT_VERSION}
          {justChecked && <span className="text-green-600 ml-1">— Versao atual!</span>}
        </span>
      </div>
      <button
        onClick={checkUpdate}
        disabled={checking}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
        {checking ? "Verificando..." : "Verificar"}
      </button>
    </div>
  );
}

export { CURRENT_VERSION };
