// Preload da janela ESCONDIDA do resolvedor (captura.ts), que roda em TODO frame (nodeIntegrationInSubFrames), antes
// da página: pede ao processo principal o script do site com a opção atual e roda no mundo da página. É o
// addDocumentStartJavaScript do Android (ResolverPlugin.java). A janela do app não usa este preload.
import { ipcRenderer, webFrame } from 'electron';

try {
  const script: unknown = ipcRenderer.sendSync('wm:captura-script');
  if (typeof script === 'string' && script) {
    webFrame.executeJavaScript(script)
      .catch((e: unknown) => ipcRenderer.send('wm:captura-frame', location.href, `erro ${String(e).slice(0, 80)}`));
  } else ipcRenderer.send('wm:captura-frame', location.href, 'sem script');
} catch { /* janela fechando */ }
