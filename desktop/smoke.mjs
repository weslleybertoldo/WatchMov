// Smoke do app do Windows (Electron, pasta desktop/): abre o app de verdade e confere
//   1. a interface carregou com a origem do site e a ponte do Windows;
//   2. "Entrar com Google" abre o navegador do PC no endereço certo (volta por com.weslley.watchmov://login-callback);
//   3. a volta com erro mostra o motivo na tela de login (caso negativo);
//   4. a volta com a sessão (conta de teste) entra no app e mostra o Início com cartazes;
//   5. um título abre o player com o servidor (iframe).
// O link de volta chega como no Windows de verdade: uma 2ª cópia do app recebe o link e passa pra 1ª.
// Cenário "rede" (W1, desktop/rede.ts), depois de entrar com a conta de teste:
//   6. DNS próprio: o app alcança um servidor de vídeo que o DNS da operadora (Claro) recusa;
//   7. Ao Vivo: a lista do SuperFlix carrega (no navegador o CORS bloqueia);
//   8. cada fonte abre no iframe do player (print de cada uma);
//   9. propaganda de um servidor (janela nova e troca da página depois de um clique) é bloqueada, e um link de fora
//      pedido pela própria página vai pro navegador do PC.
// Uso (dentro de desktop/): node smoke.mjs [--exe <WatchMov.exe instalado>] [--saida smoke-prints] [--cenario base|rede]
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
const cenario = opcao('--cenario', 'base');
if (!['base', 'rede'].includes(cenario)) { console.error(`cenário desconhecido: ${cenario}`); process.exit(2); }
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
  const print = (nome) => w.screenshot({ path: path.join(saida, cenario === 'base' ? nome : `${cenario}-${nome}`) });
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

  if (cenario === 'base') await passo('Entrar com Google abre o navegador do PC no endereço certo', async () => {
    await botao.click();
    const url = new URL(await esperarAberto(1));
    if (!url.pathname.endsWith('/auth/v1/authorize')) throw new Error(`endereço ${url.pathname}`);
    if (url.searchParams.get('provider') !== 'google') throw new Error('provider não é google');
    if (url.searchParams.get('redirect_to') !== RETORNO) throw new Error(`redirect_to ${url.searchParams.get('redirect_to')}`);
    await print('02-conectando.png');
  });

  if (cenario === 'base') await passo('volta com erro mostra o motivo (caso negativo)', async () => {
    await mandarLink(`${RETORNO}#error=access_denied&error_description=Login+cancelado+no+Google`);
    await w.getByText('Login cancelado no Google').waitFor({ timeout: 20000 });
    await print('03-erro.png');
  });

  await passo('volta com a sessão entra e mostra o Início com cartazes', async () => {
    await botao.click();
    await esperarAberto(cenario === 'base' ? 2 : 1);
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

  if (cenario === 'base') await passo('um título abre o player com o servidor', async () => {
    await w.locator('[data-tv-hold]').first().click();   // a 1ª capa de uma fileira (MediaCard)
    const assistir = w.getByRole('button', { name: /^(Assistir|Continuar)$/ }).first();
    await assistir.waitFor({ timeout: 30000 });
    await print('05-detalhe.png');
    await assistir.click();
    await w.locator('iframe').first().waitFor({ state: 'attached', timeout: 45000 });
    await w.waitForTimeout(5000);
    await print('06-player.png');
  });
  if (cenario === 'rede') await cenarioRede(app, w, print);
} catch (e) {
  falhou = true;
  console.error(String(e?.stack ?? e));
} finally {
  await app.close().catch(() => undefined);
}

console.log(resultados.join('\n'));
console.log(`prints em ${saida}`);
process.exit(falhou ? 1 : 0);

// ---------------------------------------------------------------- cenário "rede" (W1)
async function cenarioRede(app, w, print) {
  const estadoRede = () => w.evaluate(() => window.wmDesktop.rede.estado());
  // O navegador do PC não abre no teste: o processo principal guarda o que abriria.
  await app.evaluate(({ shell }) => {
    globalThis.__wmExternos = [];
    shell.openExternal = async (url) => { globalThis.__wmExternos.push(url); };
  });
  const externos = () => app.evaluate(() => globalThis.__wmExternos);

  await passo('DNS próprio: alcança o servidor de vídeo que o DNS da operadora recusa', async () => {
    const r = await app.evaluate(async ({ net }) => {
      try {
        const resp = await net.fetch('https://edge1-madrid-sprintcdn.r66nv9ed.com/', { method: 'HEAD' });
        return { ok: true, status: resp.status };
      } catch (e) { return { ok: false, erro: String(e?.message ?? e) }; }
    });
    if (!r.ok) throw new Error(`não alcançou o servidor: ${r.erro}`);
    const est = await estadoRede();
    resultados.push(`ℹ️ servidor do sprintcdn respondeu HTTP ${r.status} · DNS: ${est.dns}`);
  });

  await passo('Ao Vivo: a lista do SuperFlix carrega no app', async () => {
    await w.evaluate(() => localStorage.removeItem('watchmov_livetv'));
    await w.locator('nav button', { hasText: /^Ao Vivo$/ }).first().click();
    await w.locator('button[data-canal="superflix"]').first().waitFor({ timeout: 45000 });
    const n = await w.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('watchmov_livetv') || 'null')?.list?.length ?? 0; } catch { return 0; }
    });
    const iptv = await w.locator('button[data-canal="iptv"]').count();
    if (n < 50) throw new Error(`só ${n} canais do SuperFlix`);
    resultados.push(`ℹ️ Ao Vivo: ${n} canais do SuperFlix + ${iptv} do iptv-org na tela`);
    await w.waitForTimeout(1500);
    await print('01-ao-vivo.png');
  });

  let fonteOk = null;   // a última fonte que carregou: o teste da propaganda usa o servidor dela
  let fonteAtual = null;
  await passo('cada fonte abre no iframe do player', async () => {
    await w.locator('nav button', { hasText: /^Início$/ }).first().click();
    await w.locator('[data-tv-hold]').first().waitFor({ timeout: 30000 });
    await w.locator('[data-tv-hold]').first().click();
    const assistir = w.getByRole('button', { name: /^(Assistir|Continuar)$/ }).first();
    await assistir.waitFor({ timeout: 30000 });
    await assistir.click();
    await w.locator('iframe').first().waitFor({ state: 'attached', timeout: 45000 });
    const trocar = w.locator('button[title="Trocar fonte"]').first();
    await trocar.click();
    const nomes = await w.getByRole('button', { name: /^Fonte \d+/ }).allInnerTexts();
    await trocar.click();
    if (nomes.length < 6) throw new Error(`só ${nomes.length} fontes no menu`);
    const falhas = [];
    for (const nome of nomes) {
      const n = nome.match(/^Fonte (\d+)/)[1];
      await trocar.click();
      await w.getByRole('button', { name: nome.trim() }).click();
      await w.waitForTimeout(1000);
      const iframe = await w.locator('iframe').first().elementHandle();
      const src = await iframe.getAttribute('src');
      const frame = await iframe.contentFrame();
      let info = { url: '', titulo: '', texto: '' };
      let lenta = false;
      try {
        await frame.waitForLoadState('domcontentloaded', { timeout: 30000 });
        await w.waitForTimeout(10000);   // o player do servidor monta depois do HTML
        info = await frame.evaluate(() => ({ url: location.href, titulo: document.title, texto: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 140) }));
      } catch (e) {
        info.url = frame?.url() ?? '';
        info.texto = String(e?.message ?? e).split('\n')[0];
        lenta = /Timeout/i.test(info.texto);
      }
      const erroDeRede = info.url.startsWith('chrome-error:') || /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT/i.test(info.texto);
      const bloqueado = /acesso bloqueado|access denied|forbidden/i.test(`${info.titulo} ${info.texto}`);
      // Servidor que não termina de carregar em 30 s: aviso, não falha (o da máquina do teste às vezes segura o
      // pedido; erro de rede, página de erro e bloqueio continuam falhando).
      const marca = erroDeRede || bloqueado ? '❌' : lenta ? '⚠️' : 'ℹ️';
      const resumo = lenta ? 'não terminou de carregar em 30 s' : `${info.url.slice(0, 70)} · "${info.titulo.slice(0, 40)}" · ${info.texto.slice(0, 80)}`;
      resultados.push(`${marca} Fonte ${n}: ${new URL(src).host} → ${resumo}`);
      if (erroDeRede || bloqueado) falhas.push(`Fonte ${n}`);
      await print(`02-fonte-${n}.png`);
      fonteAtual = nome.trim();
      if (!lenta && !erroDeRede && !bloqueado) fonteOk = fonteAtual;
    }
    if (!fonteOk) throw new Error('nenhuma fonte terminou de carregar');
    if (falhas.length) throw new Error(`não abriram: ${falhas.join(', ')}`);
  });

  await passo('propaganda do servidor não abre janela nem troca a página; link de fora da página vai pro PC', async () => {
    // Volta pra última fonte que carregou (o player remonta o iframe a cada troca de fonte).
    if (fonteAtual !== fonteOk) {
      await w.locator('button[title="Trocar fonte"]').first().click();
      await w.getByRole('button', { name: fonteOk }).click();
      await w.waitForTimeout(1000);
    }
    const iframe = await w.locator('iframe').first().elementHandle();
    const frame = await iframe.contentFrame();
    if (!frame) throw new Error(`sem o iframe da ${fonteOk}`);
    await frame.waitForLoadState('domcontentloaded', { timeout: 30000 });
    const antes = await estadoRede();
    // 1) janela nova pedida pelo servidor (sem e com clique)
    await frame.evaluate(() => { window.open('https://propaganda.invalid/janela-sem-clique'); });
    await frame.evaluate(() => {
      document.addEventListener('click', () => { window.open('https://propaganda.invalid/janela-com-clique'); }, { capture: true, once: true });
    });
    await frame.locator('body').click({ position: { x: 5, y: 5 }, force: true });
    await w.waitForTimeout(800);
    // 2) depois de um clique, o servidor tenta trocar a página do app inteira
    await frame.evaluate(() => {
      document.addEventListener('click', () => { window.top.location.href = 'https://propaganda.invalid/troca-a-pagina'; }, { capture: true, once: true });
    });
    await frame.locator('body').click({ position: { x: 5, y: 5 }, force: true });
    await w.waitForTimeout(1500);
    const depois = await estadoRede();
    const origem = await w.evaluate(() => location.origin);
    const esperada = new URL(process.env.WM_SITE ?? 'https://watchmovbr.vercel.app/').origin;
    if (origem !== esperada) throw new Error(`a página saiu do app: ${origem}`);
    const janelas = depois.janelasBloqueadas - antes.janelasBloqueadas;
    const navs = depois.navegacoesBloqueadas - antes.navegacoesBloqueadas;
    if (janelas < 2) throw new Error(`só ${janelas} janela(s) de propaganda bloqueada(s)`);
    if (navs < 1) throw new Error('a troca da página pelo servidor não passou pelo bloqueio');
    const abertas = (await externos()).filter((u) => u.includes('propaganda.invalid'));
    if (abertas.length) throw new Error(`propaganda foi pro navegador do PC: ${abertas.join(', ')}`);
    // 3) link de fora pedido pela própria página do app: navegador do PC
    await w.evaluate(() => { window.open('https://github.com/weslleybertoldo/WatchMov'); });
    await w.waitForTimeout(800);
    if (!(await externos()).includes('https://github.com/weslleybertoldo/WatchMov')) throw new Error('o link de fora da página não foi pro navegador do PC');
    resultados.push(`ℹ️ ${fonteOk}: bloqueadas ${janelas} janelas e ${navs} troca(s) da página (total do app: ${depois.janelasBloqueadas} janelas, ${depois.navegacoesBloqueadas} navegações; última: ${depois.ultimaBloqueada})`);
    await print('03-propaganda-bloqueada.png');
  });
}
