import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initDevice, isTv } from "./lib/device";
import { startTvNav } from "./lib/tvNav";
import { capturePendingTvCode } from "./lib/tvPair";

// Site aberto pelo QR da TV (/tv?c=…): guarda o código antes do login e volta o endereço pra raiz.
capturePendingTvCode();

// App do Windows (W4): guarda a interface pra abrir sem internet e assistir o que baixou (public/sw-desktop.js). No
// navegador e no APK nada disso roda. A versão no endereço faz o app guardar a interface nova a cada build.
if ((window as unknown as { wmDesktop?: { downloads?: unknown } }).wmDesktop?.downloads && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(`/sw-desktop.js?v=${encodeURIComponent(__BUILD_DATE__)}`).catch((e) => console.warn("[wm] sw:", e));
}

// Antes do 1º render: na TV (Fire TV / Android TV) já muda o que aparece na primeira tela.
// Na TV as setas do controle levam o foco (tvNav) e o item focado ganha destaque (html.tv no CSS).
initDevice().then(() => {
  if (isTv()) {
    document.documentElement.classList.add("tv");
    startTvNav();
  }
  createRoot(document.getElementById("root")!).render(<App />);
});
