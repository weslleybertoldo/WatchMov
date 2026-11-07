// Prova da atualização automática no app INSTALADO na versão anterior: ele acha a versão nova no latest.yml da
// release, baixa e instala ao sair, o mesmo caminho do PC dele (main.ts: checkForUpdatesAndNotify).
// Uso (dentro de desktop/): node atualizacao.mjs --exe <WatchMov.exe> --espera 5.21.0
// Roda no job windows do build-apk.yml (ci-atualizacao.ps1), depois que o .exe e o latest.yml novos estão na release.
import { _electron as electron } from '@playwright/test';

const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const exe = opcao('--exe');
const espera = opcao('--espera');
if (!exe || !espera) { console.error('uso: node atualizacao.mjs --exe <WatchMov.exe> --espera <versão>'); process.exit(2); }

const app = await electron.launch({ executablePath: exe, args: [], timeout: 90000 });
let ok = false;
try {
  await app.firstWindow({ timeout: 60000 });
  // O mesmo atualizador que o app usa (electron-updater de dentro do app.asar).
  const verificar = () => app.evaluate(async ({ app: a }) => {
    const exigir = process.mainModule?.require?.bind(process.mainModule)
      ?? process.getBuiltinModule('module').createRequire(`${a.getAppPath()}/out/main.js`);
    const { autoUpdater } = exigir('electron-updater');
    const r = await autoUpdater.checkForUpdates();
    const baixado = r?.downloadPromise ? await r.downloadPromise : null;
    return { atual: a.getVersion(), achou: r?.updateInfo?.version ?? null, baixado };
  });
  // O endereço releases/latest/download pode levar alguns segundos pra apontar pra release nova.
  let r = null;
  for (let i = 1; i <= 6; i++) {
    try { r = await verificar(); } catch (e) { r = { erro: String(e?.message ?? e).split('\n')[0] }; }
    console.log(`tentativa ${i}: ${JSON.stringify(r)}`);
    if (r?.achou === espera && r.baixado?.length) break;
    await new Promise((ok) => setTimeout(ok, 15000));
  }
  if (r?.achou !== espera) throw new Error(`o app ${r?.atual ?? '?'} não achou a ${espera} (achou ${r?.achou ?? 'nada'})`);
  if (!r.baixado?.length) throw new Error('achou a versão nova mas não baixou o instalador');
  console.log(`✅ a ${r.atual} achou e baixou a ${espera}: ${r.baixado.join(', ')}`);
  // Instala: o app fecha e o instalador da versão nova roda em silêncio (o mesmo do "instala ao fechar").
  await app.evaluate(({ app: a }) => {
    const exigir = process.mainModule?.require?.bind(process.mainModule)
      ?? process.getBuiltinModule('module').createRequire(`${a.getAppPath()}/out/main.js`);
    setTimeout(() => exigir('electron-updater').autoUpdater.quitAndInstall(true, false), 300);
  }).catch(() => undefined);
  await app.waitForEvent('close', { timeout: 60000 }).catch(() => undefined);
  ok = true;
} catch (e) {
  console.error(String(e?.stack ?? e));
} finally {
  await app.close().catch(() => undefined);
}
process.exit(ok ? 0 : 1);
