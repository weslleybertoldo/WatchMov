// Smoke do app do Windows (Electron, pasta desktop/): abre o app de verdade e confere
//   1. a interface carregou com a origem do site e a ponte do Windows;
//   2. "Entrar com Google" abre o navegador do PC no endereço certo (volta por com.weslley.watchmov://login-callback);
//   3. a volta com erro mostra o motivo na tela de login (caso negativo);
//   4. a volta com a sessão (conta de teste) entra no app e mostra o Início com cartazes;
//   5. um título abre o player com o servidor (iframe).
// O link de volta chega como no Windows de verdade: uma 2ª cópia do app recebe o link e passa pra 1ª.
// Uso (dentro de desktop/): node smoke.mjs [--exe <WatchMov.exe instalado>] [--saida smoke-prints]
// WM_SITE troca o site que o app abre (staging, ou o Vite local em desenvolvimento).
// Env: WM_SUPABASE_URL (ou VITE_SUPABASE_URL), WM_SUPABASE_ANON (ou VITE_SUPABASE_ANON_KEY), WM_SMOKE_EMAIL,
//      WM_SMOKE_SENHA — SÓ a conta de teste. Nada é gravado no banco (só login e leitura).
import { _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opcao = (nome, padrao) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : padrao; };
const exe = opcao('--exe');
const saida = path.resolve(opcao('--saida', 'smoke-prints'));
fs.mkdirSync(saida, { recursive: true });

const SB = process.env.WM_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.WM_SUPABASE_ANON ?? process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.WM_SMOKE_EMAIL;
const SENHA = process.env.WM_SMOKE_SENHA;
if (!SB || !ANON || !EMAIL || !SENHA) {
  console.error('faltam WM_SUPABASE_URL, WM_SUPABASE_ANON, WM_SMOKE_EMAIL ou WM_SMOKE_SENHA');
  process.exit(2);
}

const pastaDesktop = path.dirname(fileURLToPath(import.meta.url));
const binario = exe ?? createRequire(path.join(pastaDesktop, 'package.json'))('electron');
const argsApp = exe ? [] : [pastaDesktop];
const RETORNO = 'com.weslley.watchmov://login-callback';

const resultados = [];
const passo = async (nome, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    resultados.push(`✅ ${nome} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    resultados.push(`❌ ${nome}: ${String(e?.message ?? e).split('\n')[0]}`);
    throw e;
  }
};
// 2ª cópia do app com o link, como o Windows faz ao voltar do navegador: ela entrega o link à 1ª e sai.
const mandarLink = (link) => new Promise((ok) => {
  const p = spawn(binario, [...argsApp, link], { stdio: 'ignore' });
  const t = setTimeout(() => { p.kill(); ok(); }, 20000);
  p.on('exit', () => { clearTimeout(t); ok(); });
});

const app = await electron.launch({ executablePath: binario, args: argsApp, timeout: 90000 });
let falhou = false;
try {
  const w = await app.firstWindow({ timeout: 60000 });
  const print = (nome) => w.screenshot({ path: path.join(saida, nome) });
  // Começa sempre deslogado (o perfil do app guarda a sessão de uma rodada pra outra).
  await w.waitForLoadState('domcontentloaded');
  await w.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await w.reload();
  const versao = await app.evaluate(({ app: a }) => a.getVersion());
  resultados.push(`ℹ️ versão do app: ${versao}${exe ? ' (instalado)' : ' (desenvolvimento)'}`);

  // O navegador do PC não abre no teste: a ponte guarda o endereço que seria aberto.
  await app.evaluate(({ ipcMain }) => {
    globalThis.__wmAberto = [];
    ipcMain.removeHandler('wm:abrir-fora');
    ipcMain.handle('wm:abrir-fora', (_e, url) => { globalThis.__wmAberto.push(url); return true; });
  });
  const abertos = () => app.evaluate(() => globalThis.__wmAberto);
  const esperarAberto = async (n) => {
    for (let i = 0; i < 100; i++) { const a = await abertos(); if (a.length >= n) return a[n - 1]; await w.waitForTimeout(200); }
    throw new Error(`o app não pediu pra abrir o navegador (${n}ª vez)`);
  };
  const botao = w.getByRole('button', { name: /Entrar com Google/i });

  await passo('interface do site carregou com a ponte do Windows', async () => {
    await botao.waitFor({ timeout: 60000 });
    const info = await w.evaluate(() => ({ origem: location.origin, ponte: typeof window.wmDesktop }));
    const esperada = new URL(process.env.WM_SITE ?? 'https://watchmovbr.vercel.app/').origin;
    if (info.origem !== esperada) throw new Error(`origem ${info.origem}`);
    if (info.ponte !== 'object') throw new Error('sem window.wmDesktop');
    await print('01-login.png');
  });

  await passo('Entrar com Google abre o navegador do PC no endereço certo', async () => {
    await botao.click();
    const url = new URL(await esperarAberto(1));
    if (!url.pathname.endsWith('/auth/v1/authorize')) throw new Error(`endereço ${url.pathname}`);
    if (url.searchParams.get('provider') !== 'google') throw new Error('provider não é google');
    if (url.searchParams.get('redirect_to') !== RETORNO) throw new Error(`redirect_to ${url.searchParams.get('redirect_to')}`);
    await print('02-conectando.png');
  });

  await passo('volta com erro mostra o motivo (caso negativo)', async () => {
    await mandarLink(`${RETORNO}#error=access_denied&error_description=Login+cancelado+no+Google`);
    await w.getByText('Login cancelado no Google').waitFor({ timeout: 20000 });
    await print('03-erro.png');
  });

  await passo('volta com a sessão entra e mostra o Início com cartazes', async () => {
    await botao.click();
    await esperarAberto(2);
    const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: SENHA }),
    });
    const s = await r.json();
    if (!s.access_token) throw new Error(`login da conta de teste falhou (${r.status})`);
    await mandarLink(`${RETORNO}#access_token=${s.access_token}&expires_in=${s.expires_in}&refresh_token=${s.refresh_token}&token_type=bearer&type=`);
    await w.waitForFunction(() => document.querySelectorAll('img[src*="image.tmdb.org"]').length >= 6, null, { timeout: 60000 });
    await w.waitForTimeout(1500);
    await print('04-inicio.png');
  });

  await passo('um título abre o player com o servidor', async () => {
    await w.locator('[data-tv-hold]').first().click();   // a 1ª capa de uma fileira (MediaCard)
    const assistir = w.getByRole('button', { name: /^(Assistir|Continuar)$/ }).first();
    await assistir.waitFor({ timeout: 30000 });
    await print('05-detalhe.png');
    await assistir.click();
    await w.locator('iframe').first().waitFor({ state: 'attached', timeout: 45000 });
    await w.waitForTimeout(5000);
    await print('06-player.png');
  });
} catch (e) {
  falhou = true;
  console.error(String(e?.stack ?? e));
} finally {
  await app.close().catch(() => undefined);
}

console.log(resultados.join('\n'));
console.log(`prints em ${saida}`);
process.exit(falhou ? 1 : 0);
