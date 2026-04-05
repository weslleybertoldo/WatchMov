import { useState, useEffect, useRef } from "react";
import { Download, X, CheckCircle, RefreshCw } from "lucide-react";

const CURRENT_VERSION = __APP_VERSION__;
const RELEASES_URL = "https://api.github.com/repos/weslleybertoldo/show-tracker-pro/releases/latest";

interface VersionInfo {
  version: string;
  download_url: string;
}

function isNewerVersion(remote: string, local: string): boolean {
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
  const mountedRef = useRef(true);

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
            <a
              href={update.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-4 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Download size={14} />
              Baixar atualizacao
            </a>
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
