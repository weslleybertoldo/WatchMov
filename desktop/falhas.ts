// Quedas do app do Windows na aba Bugs (W6, plano 07/11/2026) = o AppExitLog.java do APK. O processo que cai não grava a
// própria linha: o processo principal anota em userData/falhas.json e a interface manda pra aba Bugs (logAppExits do
// playbackLog.ts) no boot seguinte ou quando a janela volta. Anota a janela que caiu (e a recarrega), processo filho que
// caiu (GPU, áudio, rede…), a janela travada e erro solto do processo principal. As regras ficam em regrasFalhas.ts.
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { origemDoFrame } from './rede';
import { confirmarAte, falhaDoErro, falhaDoProcesso, falhaTravou, juntarFalha, lerFalhas, type Falha } from './regrasFalhas';

let arquivo = '';
let falhas: Falha[] = [];

function gravar(): void {
  try { fs.writeFileSync(arquivo, JSON.stringify(falhas)); } catch (e) { console.warn('[wm] falhas: não gravou', e); }
}

function anotar(f: Falha | null): void {
  if (!f) return;
  console.warn(`[wm] falha: ${f.cause}`);
  falhas = juntarFalha(falhas, f);
  gravar();
}

/** Liga as anotações. Chamar antes do `ready` (pega erro solto do começo); a janela entra por `vigiarJanela`. */
export function ligarFalhas(origemApp: string): void {
  arquivo = path.join(app.getPath('userData'), 'falhas.json');
  try { falhas = lerFalhas(fs.readFileSync(arquivo, 'utf8')); } catch { falhas = []; }
  process.on('uncaughtException', (e) => anotar(falhaDoErro(e, Date.now())));
  process.on('unhandledRejection', (e) => anotar(falhaDoErro(e, Date.now())));
  app.on('child-process-gone', (_e, d) => anotar(falhaDoProcesso('filho', d, Date.now())));
  const daPagina = (e: IpcMainInvokeEvent) => origemDoFrame(e.senderFrame) === origemApp;
  ipcMain.handle('wm:falhas-pendentes', (e) => (daPagina(e) ? falhas : []));
  ipcMain.handle('wm:falhas-confirmar', (e, ts: unknown) => {
    if (!daPagina(e) || typeof ts !== 'number') return false;
    falhas = confirmarAte(falhas, ts);
    gravar();
    return true;
  });
}

/** A janela do app: caiu → anota e recarrega (o app volta sozinho, e a queda chega na aba Bugs); travou → anota. */
export function vigiarJanela(janela: BrowserWindow): void {
  let travouEm = 0;
  janela.webContents.on('render-process-gone', (_e, d) => {
    const f = falhaDoProcesso('janela', d, Date.now());
    anotar(f);
    if (f && !janela.isDestroyed()) setTimeout(() => { if (!janela.isDestroyed()) janela.webContents.reload(); }, 500);
  });
  janela.on('unresponsive', () => {
    // Uma anotação por travada (o Windows repete o aviso enquanto ela não volta).
    if (Date.now() - travouEm < 60_000) return;
    travouEm = Date.now();
    anotar(falhaTravou(travouEm));
  });
}
