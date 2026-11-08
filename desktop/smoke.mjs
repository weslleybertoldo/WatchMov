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
// Cenário "player" (W3, src/components/desktop/PlayerDesktop.tsx): uma série abre sozinha no player do app e passa
// pela barra própria, teclado, Ajustes, Links, Episódios, Pular abertura, Assistido + contagem, Próximo e Esc.
// Cenário "player-links" (só com o site local do Vite): link recusado → o seguinte sozinho, Qualidade, Links e o
// pedido de link novo, com um vídeo de teste de 5 qualidades.
// Cenário "downloads" (W4, desktop/downloads.ts), com vídeos públicos de teste: um mp4 baixa inteiro; um HLS baixa
// pedaço por pedaço, o app fecha no meio e, aberto de novo, continua de onde parou; os dois viram .mp4 com a duração
// certa; a aba Download toca o baixado do disco; sem internet o app abre a cópia guardada e toca; excluir apaga.
// Uso (dentro de desktop/): node smoke.mjs [--exe <WatchMov.exe instalado>] [--saida smoke-prints] [--cenario base|rede|captura|player|player-links|downloads]
// WM_SITE troca o site que o app abre (staging, ou o Vite local em desenvolvimento).
// Env: WM_SUPABASE_URL (ou VITE_SUPABASE_URL), WM_SUPABASE_ANON (ou VITE_SUPABASE_ANON_KEY), WM_SMOKE_EMAIL,
//      WM_SMOKE_SENHA — SÓ a conta de teste. Nada é gravado no banco (só login e leitura).
import { _electron as electron } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opcao = (nome, padrao) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : padrao; };
const exe = opcao('--exe');
const saida = path.resolve(opcao('--saida', 'smoke-prints'));
const cenario = opcao('--cenario', 'base');
if (!['base', 'rede', 'captura', 'player', 'player-links', 'downloads'].includes(cenario)) { console.error(`cenário desconhecido: ${cenario}`); process.exit(2); }
fs.mkdirSync(saida, { recursive: true });
// Downloads: pasta própria do teste e velocidade limitada (dá tempo de fechar o app no meio do HLS).
if (cenario === 'downloads') {
  process.env.WM_DL_PASTA ??= path.join(saida, 'baixados');
  process.env.WM_DL_KBPS ??= '1200';
  fs.rmSync(process.env.WM_DL_PASTA, { recursive: true, force: true });
}

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
// Registros do processo principal ([wm] …) entram na saída do teste: é o diagnóstico da captura e da rede.
const registros = [];
const ouvirRegistros = (a) => {
  for (const fluxo of [a.process().stdout, a.process().stderr]) fluxo?.on('data', (d) => { for (const l of String(d).split('\n')) if (l.includes('[wm]')) { console.log(l.trim()); registros.push(l.trim()); } });
};
ouvirRegistros(app);
let appDeNovo = null;   // o cenário downloads fecha o app e abre de novo
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

  if (cenario === 'base') await passo('um título abre o player (do servidor; com a W2, o do app também vale)', async () => {
    await abrirSozinho(w, false);   // a base testa o player do servidor; o abrir sozinho é o cenário captura
    await w.locator('[data-tv-hold]').first().click();   // a 1ª capa de uma fileira (MediaCard)
    const assistir = w.getByRole('button', { name: /^(Assistir|Continuar)$/ }).first();
    await assistir.waitFor({ timeout: 30000 });
    await print('05-detalhe.png');
    await assistir.click();
    // Sem o abrir sozinho o servidor abre no iframe; se a captura pegar o link do iframe, o player do app abre por cima.
    await w.locator('iframe, [data-wm-player-desktop] video').first().waitFor({ state: 'attached', timeout: 45000 });
    await w.waitForTimeout(5000);
    await print('06-player.png');
  });
  if (cenario === 'rede') await cenarioRede(app, w, print);
  if (cenario === 'captura') await cenarioCaptura(app, w, print);
  if (cenario === 'player') await cenarioPlayer(w, print);
  if (cenario === 'player-links') await cenarioPlayerLinks(w, print);
  if (cenario === 'downloads') await cenarioDownloads(app, w, print);
} catch (e) {
  falhou = true;
  console.error(String(e?.stack ?? e));
} finally {
  await app.close().catch(() => undefined);
  await appDeNovo?.close().catch(() => undefined);
}

console.log(resultados.join('\n'));
console.log(`prints em ${saida}`);
process.exit(falhou ? 1 : 0);

// ---------------------------------------------------------------- cenário "rede" (W1)
// Liga/desliga o abrir sozinho (a mesma chave do botão da aba Servidores, resolver.ts: 'watchmov_resolver').
async function abrirSozinho(w, ligar) {
  await w.evaluate((v) => localStorage.setItem('watchmov_resolver', v), ligar ? '1' : '0');
}

// "Assistiu pelo servidor" no 1º título (streamCache.ts: setServerMode, lastMode 'server'): o site abre o servidor e
// não joga pro player do app quando a captura pega o link do iframe (auto-abrir desarmado), como quando ele escolhe
// o servidor. Sem isso o laço das fontes perdia o iframe (08/11/2026: a Fonte 1 abriu sozinha no player do app).
async function servidorNoPrimeiroCartaz(w) {
  const chave = await w.locator('[data-tv-hold]').first().getAttribute('data-tv-key');   // "movie-1233413"
  const m = /^(movie|tv)-(\d+)$/.exec(chave ?? '');
  if (!m) return;
  await w.evaluate(([tipo, id]) => {
    const d = JSON.parse(localStorage.getItem('watchmov_streamcache') || '{}');
    for (const [t, e] of [[0, 0], [1, 1]]) {
      const k = `${id}:${tipo}:${t}:${e}`;
      d[k] = { ...(d[k] || { streams: [] }), lastMode: 'server', ts: Date.now() };
    }
    localStorage.setItem('watchmov_streamcache', JSON.stringify(d));
  }, [m[1], m[2]]);
}

// Com a W2 a captura também olha o iframe do servidor e, se pegar o link, o player do app abre por cima: fecha.
async function fecharPlayerDoApp(w) {
  if (await w.locator('[data-wm-player-desktop]').count()) {
    await w.keyboard.press('Escape');
    await w.locator('[data-wm-player-desktop]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  }
}

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
    await abrirSozinho(w, false);   // o laço testa o iframe de cada fonte (W1); o abrir sozinho é o cenário captura
    await w.locator('nav button', { hasText: /^Início$/ }).first().click();
    await w.locator('[data-tv-hold]').first().waitFor({ timeout: 30000 });
    await servidorNoPrimeiroCartaz(w);
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
      await fecharPlayerDoApp(w);
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
    await fecharPlayerDoApp(w);
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

// W2 (abrir sozinho): o título abre, a janela escondida acha o vídeo e ele toca sozinho no player do app.
async function cenarioCaptura(app, w, print) {
  // WM_FONTE = id da fonte (src/lib/players.ts) que o título abre (vira a favorita); sem = a padrão do site.
  // WM_ABA = aba do 1º título (ex. "Séries": abre um episódio); sem = o 1º título do Início.
  // WM_BUSCA = nome do título (abre o 1º resultado da busca): a ordem das abas muda todo dia e nem toda fonte tem o
  // 1º título (08/11/2026: a Fonte 3 não tinha a série do topo e respondia 404, igual no Android).
  const fonte = process.env.WM_FONTE;
  const aba = process.env.WM_ABA;
  const busca = process.env.WM_BUSCA;
  const rotulo = [fonte, aba, busca].filter(Boolean).join(' · ');
  const sufixo = rotulo ? `-${rotulo.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : '';
  await passo(`o título abre sozinho no player do app (captura + resolvedor)${rotulo ? ` [${rotulo}]` : ''}`, async () => {
    await abrirSozinho(w, true);   // o perfil do app guarda o localStorage: a base e a rede deixam desligado
    // Sem o "assistiu pelo servidor" da rede e sem link guardado: o título passa pelo resolvedor de verdade.
    await w.evaluate(() => localStorage.removeItem('watchmov_streamcache'));
    if (fonte) await w.evaluate((f) => localStorage.setItem('watchmov_fav_server', f), fonte);
    if (aba) {
      await w.locator('nav button', { hasText: new RegExp(`^${aba}$`) }).first().click();
      try { await w.locator('[data-tv-hold]:visible').first().waitFor({ timeout: 30000 }); }
      catch (e) { await print(`01-aba${sufixo}.png`); throw e; }
      await w.waitForTimeout(1500);
    }
    if (busca) {
      await w.locator('button[title="Buscar"]').first().click();
      const campo = w.getByPlaceholder('Buscar filmes, séries e animes...');
      await campo.waitFor({ timeout: 15000 });
      await campo.fill(busca);
      await campo.press('Enter');   // a busca do site só roda no Enter (SearchView.tsx)
      try { await w.locator('[data-tv-hold]:visible').first().waitFor({ timeout: 30000 }); }
      catch (e) { await print(`01-busca${sufixo}.png`); throw e; }
      await w.waitForTimeout(2500);   // a busca termina de chegar (o 1º cartaz pode ser de uma resposta parcial)
    }
    await w.locator('[data-tv-hold]:visible').first().click();
    const assistir = w.getByRole('button', { name: /^(Assistir|Continuar)$/ }).first();
    try { await assistir.waitFor({ timeout: 30000 }); }
    catch (e) { await print(`01-sem-assistir${sufixo}.png`); throw e; }
    await assistir.click();
    const video = w.locator('[data-wm-player-desktop] video');
    try { await video.waitFor({ state: 'attached', timeout: 150000 }); }
    catch (e) { await print(`01-sem-player${sufixo}.png`); throw e; }
    const erros = [];
    w.on('console', (m) => { const t = m.text(); if (/hls|media|video|erro|error|403|404/i.test(t)) erros.push(t.slice(0, 160)); });
    try {
      await w.waitForFunction(() => {
        const v = document.querySelector('[data-wm-player-desktop] video');
        return !!v && v.currentTime > 1 && v.readyState >= 2;
      }, null, { timeout: 90000 });
    } catch (e) {
      const estado = await w.evaluate(() => { const v = document.querySelector('[data-wm-player-desktop] video'); return v ? `rs=${v.readyState} ns=${v.networkState} t=${v.currentTime} err=${v.error?.code ?? '-'} src=${(v.currentSrc || '').slice(0, 50)}` : 'sem video'; });
      resultados.push(`ℹ️ player: ${estado}`);
      for (const t of erros.slice(0, 8)) resultados.push(`ℹ️ console: ${t}`);
      await print(`01-player-parado${sufixo}.png`);
      throw e;
    }
    // Alguns segundos a mais antes do print: o começo do episódio costuma ser tela preta (Fonte 3, 08/11/2026).
    await w.waitForFunction(() => (document.querySelector('[data-wm-player-desktop] video')?.currentTime ?? 0) > 6,
      null, { timeout: 15000 }).catch(() => undefined);
    const info = await w.evaluate(() => {
      const v = document.querySelector('[data-wm-player-desktop] video');
      return { t: v.currentTime.toFixed(1), h: v.videoHeight, src: (v.currentSrc || '').slice(0, 60) };
    });
    resultados.push(`ℹ️ tocando no player do app: ${info.t} s, ${info.h}p, ${info.src}`);
    await print(`01-player-do-app${sufixo}.png`);
  });
  await passo('fechar o player volta pro app e guarda onde parou', async () => {
    await w.keyboard.press('Escape');
    await w.locator('[data-wm-player-desktop]').waitFor({ state: 'detached', timeout: 10000 });
    await w.waitForTimeout(1500);
    await print(`02-fechou${sufixo}.png`);
  });
}

// W3 (player do app): uma série com marca de abertura na TheIntroDB (Game of Thrones; WM_BUSCA troca) abre sozinha no
// player do app; confere a barra própria, o teclado, os Ajustes (velocidade), os Links, o painel de Episódios (nomes da
// TMDB), o "Pular abertura", o Assistido abrindo a contagem do próximo, o Próximo episódio (no mesmo player ou
// reabrindo pelo resolvedor) e o Esc guardando onde parou. Grava no banco só o que o app grava ao assistir (a conta de
// teste); o Assistido é marcado e desmarcado em seguida.
async function cenarioPlayer(w, print) {
  const busca = process.env.WM_BUSCA || 'Game of Thrones';
  const video = w.locator('[data-wm-player-desktop] video');
  const estado = () => w.evaluate(() => {
    const v = document.querySelector('[data-wm-player-desktop] video');
    const r = document.querySelector('[data-player-desktop]');
    return v ? { t: v.currentTime, dur: v.duration, pausado: v.paused, h: v.videoHeight, taxa: v.playbackRate,
      chave: r?.getAttribute('data-chave') ?? '', link: r?.getAttribute('data-link') ?? '' } : null;
  });
  const tocando = (min = 1, timeout = 90000) => w.waitForFunction((m) => {
    const v = document.querySelector('[data-wm-player-desktop] video');
    return !!v && v.currentTime > m && v.readyState >= 2 && !v.paused;
  }, min, { timeout });
  const irPara = (s) => w.evaluate((x) => { document.querySelector('[data-wm-player-desktop] video').currentTime = x; }, s);
  const botao = (acao) => w.locator(`[data-wm-player-desktop] [data-acao="${acao}"]`).first();
  // A barra some com o mouse parado: mexe o mouse antes de cada clique nela.
  const mexer = async () => { await w.mouse.move(400, 300); await w.mouse.move(420, 320); await w.waitForTimeout(250); };
  const logs = [];
  w.on('console', (m) => { const t = m.text(); if (t.includes('[wm-player]')) logs.push(t.slice(0, 200)); });
  const ultimosLogs = (n = 8) => { for (const l of logs.slice(-n)) resultados.push(`ℹ️ ${l}`); };
  let chave = '';

  await passo(`a série abre sozinha no player do app [${busca}]`, async () => {
    await abrirSozinho(w, true);
    await w.evaluate(() => localStorage.removeItem('watchmov_streamcache'));
    await w.locator('button[title="Buscar"]').first().click();
    const campo = w.getByPlaceholder('Buscar filmes, séries e animes...');
    await campo.waitFor({ timeout: 15000 });
    await campo.fill(busca);
    await campo.press('Enter');
    const cartaz = w.locator('[data-tv-hold][data-tv-key^="tv-"]:visible').first();
    await cartaz.waitFor({ timeout: 30000 });
    await w.waitForTimeout(2500);   // a busca termina de chegar (o 1º cartaz pode ser de uma resposta parcial)
    await cartaz.click();
    const assistir = w.getByRole('button', { name: /^(Assistir|Continuar)$/ }).first();
    await assistir.waitFor({ timeout: 30000 });
    await assistir.click();
    try {
      await video.waitFor({ state: 'attached', timeout: 150000 });
      await tocando(1);
    } catch (e) { await print('01-sem-player.png'); ultimosLogs(); throw e; }
    const s = await estado();
    chave = s.chave;
    if (!/^\d+:tv:\d+:\d+$/.test(chave)) throw new Error(`chave do episódio estranha: "${chave}"`);
    resultados.push(`ℹ️ tocando ${chave}: ${s.t.toFixed(1)} s, ${s.h}p, ${s.link.slice(0, 60)}`);
    await mexer();
    await print('01-player.png');
  });

  await passo('barra própria e teclado (espaço, ←/→)', async () => {
    await mexer();
    for (const a of ['play', 'voltar', 'avancar', 'linha-do-tempo', 'ajustes', 'tela-cheia', 'episodios', 'servidor', 'proximo', 'assistido', 'fechar']) {
      if (!(await botao(a).isVisible())) throw new Error(`a barra não tem o botão "${a}"`);
    }
    await w.keyboard.press('Space');
    await w.waitForFunction(() => document.querySelector('[data-wm-player-desktop] video')?.paused === true, null, { timeout: 5000 });
    await w.keyboard.press('Space');
    await w.waitForFunction(() => document.querySelector('[data-wm-player-desktop] video')?.paused === false, null, { timeout: 5000 });
    const antes = (await estado()).t;
    await w.keyboard.press('ArrowRight');
    const depois = (await estado()).t;
    if (depois - antes < 8) throw new Error(`→ não avançou 10 s (${antes.toFixed(1)} → ${depois.toFixed(1)})`);
    await w.keyboard.press('ArrowLeft');
    const voltou = (await estado()).t;
    if (depois - voltou < 8) throw new Error(`← não voltou 10 s (${depois.toFixed(1)} → ${voltou.toFixed(1)})`);
    await tocando(voltou + 0.5, 30000);
    await mexer();
    await print('02-barra.png');
  });

  await passo('Ajustes: velocidade, tela e os links', async () => {
    await mexer();
    await botao('ajustes').click();
    const painel = w.locator('[data-painel="Ajustes"]');
    await painel.waitFor({ timeout: 5000 });
    await botao('velocidade').click();
    if ((await estado()).taxa !== 1.25) throw new Error(`velocidade ${(await estado()).taxa} depois de 1 toque`);
    await print('03-ajustes.png');
    for (let i = 0; i < 4; i++) await botao('velocidade').click();   // 1,5 · 2 · 0,5 · 1
    if ((await estado()).taxa !== 1) throw new Error('a velocidade não voltou pro normal');
    if (await botao('links').isVisible()) {
      await botao('links').click();
      const linhas = w.locator('[data-painel="Links"] [data-acao^="link-"]');
      const n = await linhas.count();
      await print('04-links.png');
      const atual = await w.locator('[data-painel="Links"] [aria-pressed="true"]').getAttribute('data-acao');
      const outro = (await linhas.evaluateAll((els) => els.map((e) => e.getAttribute('data-acao')))).find((x) => x !== atual);
      const s0 = await estado();
      await w.locator(`[data-painel="Links"] [data-acao="${outro}"]`).click();
      await w.waitForFunction((l) => document.querySelector('[data-player-desktop]')?.getAttribute('data-link') !== l, s0.link, { timeout: 10000 });
      try {
        await tocando(Math.max(0, s0.t - 15), 60000);
        const s1 = await estado();
        resultados.push(`ℹ️ ${n} links; trocou do ${atual} pro ${outro}: ${s0.t.toFixed(0)} s → ${s1.t.toFixed(0)} s (mesmo tempo), ${s1.h}p`);
      } catch {
        resultados.push(`⚠️ ${n} links; o ${outro} não tocou em 60 s (o player tenta o seguinte sozinho)`);
        await tocando(1, 60000);
      }
    } else {
      resultados.push('ℹ️ só 1 link neste episódio (sem a lista de Links)');
      await w.keyboard.press('Escape');
    }
    await w.locator('[data-painel]').waitFor({ state: 'detached', timeout: 5000 }).catch(async () => { await w.keyboard.press('Escape'); });
    if (!(await w.locator('[data-wm-player-desktop]').count())) throw new Error('o Esc com o painel aberto fechou o player');
  });

  await passo('Servidor: popup com "Abrir servidores" e o ✓ no servidor atual', async () => {
    await mexer();
    await botao('servidor').click();
    const painel = w.locator('[data-painel="Servidor"]');
    await painel.waitFor({ timeout: 5000 });
    const linhas = await painel.locator('button[data-acao]').allInnerTexts();
    if (!/Abrir servidores/.test(linhas[0] ?? '')) throw new Error(`1ª linha: "${linhas[0]}"`);
    const atual = await painel.locator('[aria-pressed="true"]').allInnerTexts();
    if (atual.length !== 1) throw new Error(`${atual.length} servidores marcados como o atual`);
    resultados.push(`ℹ️ popup do servidor: ${linhas.length - 1} servidores; atual: ${atual[0].trim()}`);
    await print('04-servidor.png');
    await w.keyboard.press('Escape');
    await painel.waitFor({ state: 'detached', timeout: 5000 });
  });

  await passo('Episódios: a temporada com os nomes da TMDB, aberta no episódio que toca', async () => {
    await mexer();
    await botao('episodios').click();
    const painel = w.locator('[data-painel="Episódios"]');
    await painel.waitFor({ timeout: 5000 });
    const [, , t, e] = chave.split(':');
    await painel.locator(`[data-episodio="${t}:${e}"][data-atual]`).waitFor({ timeout: 5000 });
    // O nome vem da TMDB (sem ela fica "Episódio N").
    await w.waitForFunction(() => {
      const b = document.querySelector('[data-painel="Episódios"] [data-episodio]');
      return !!b && !/^\s*\d+\.\s*Episódio \d+/.test(b.textContent || '');
    }, null, { timeout: 15000 });
    const n = await painel.locator('[data-episodio]').count();
    const primeiro = (await painel.locator('[data-episodio]').first().innerText()).split('\n')[0];
    resultados.push(`ℹ️ painel de episódios: ${n} episódios na T${t}; o 1º: "${primeiro}"`);
    await print('05-episodios.png');
    await w.keyboard.press('Escape');
    await painel.waitFor({ state: 'detached', timeout: 5000 });
  });

  await passo('Pular abertura aparece na abertura e leva pro fim dela (TheIntroDB)', async () => {
    const [tmdb, , t, e] = chave.split(':');
    const r = await fetch(`https://api.theintrodb.org/v3/media?tmdb_id=${tmdb}&season=${t}&episode=${e}`).then((x) => x.json()).catch(() => null);
    const intro = (r?.intro ?? []).find((x) => x && x.end_ms);
    if (!intro) { resultados.push(`ℹ️ ${chave} sem abertura na TheIntroDB: o Pular não tem o que mostrar`); return; }
    const ini = (intro.start_ms ?? 0) / 1000, fim = intro.end_ms / 1000;
    await irPara(ini + 3);
    const pular = botao('pular');
    try { await pular.waitFor({ state: 'visible', timeout: 15000 }); }
    catch (err) { await print('06-sem-pular.png'); ultimosLogs(); throw err; }
    await w.waitForTimeout(800);
    await print('06-pular.png');
    const texto = await pular.innerText();
    await pular.click();
    await w.waitForFunction((f) => (document.querySelector('[data-wm-player-desktop] video')?.currentTime ?? 0) >= f - 1.5, fim, { timeout: 5000 });
    resultados.push(`ℹ️ abertura ${ini.toFixed(0)}–${fim.toFixed(0)} s: "${texto}" levou pra ${(await estado()).t.toFixed(0)} s`);
  });

  await passo('Assistido pula pra contagem do próximo; Cancelar some; desmarcar volta', async () => {
    await mexer();
    const assistido = botao('assistido');
    const marcadoAntes = await assistido.getAttribute('aria-pressed');
    if (marcadoAntes === 'true') { await assistido.click(); await w.waitForTimeout(500); await mexer(); }   // começa desmarcado
    await assistido.click();
    await w.waitForFunction(() => document.querySelector('[data-wm-player-desktop] [data-acao="assistido"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    const contagem = w.locator('[data-wm-player-desktop] [data-contagem]');
    try { await contagem.waitFor({ state: 'visible', timeout: 20000 }); }
    catch (err) { await print('07-sem-contagem.png'); ultimosLogs(); throw err; }
    const s = await estado();
    resultados.push(`ℹ️ Assistido levou pra ${Math.floor(s.t / 60)}:${String(Math.floor(s.t % 60)).padStart(2, '0')} de ${Math.floor(s.dur / 60)} min: "${(await contagem.innerText()).split('\n')[0]}"`);
    await print('07-contagem.png');
    await botao('cancelar-proximo').click();
    await contagem.waitFor({ state: 'detached', timeout: 5000 });
    await mexer();
    await assistido.click();
    await w.waitForFunction(() => document.querySelector('[data-wm-player-desktop] [data-acao="assistido"]')?.getAttribute('aria-pressed') === 'false', null, { timeout: 5000 });
  });

  await passo('Próximo episódio toca o seguinte', async () => {
    const [tmdb, , t, e] = chave.split(':');
    const seguinte = `${tmdb}:tv:${t}:${Number(e) + 1}`;
    await irPara(120);   // longe do fim: pedir o próximo aqui não marca o atual como assistido
    await w.waitForTimeout(1000);
    await mexer();
    await botao('proximo').click();
    try {
      await w.waitForFunction((c) => {
        const r = document.querySelector('[data-player-desktop]');
        const v = document.querySelector('[data-wm-player-desktop] video');
        return r?.getAttribute('data-chave') === c && !!v && v.currentTime > 1 && v.readyState >= 2;
      }, seguinte, { timeout: 180000 });
    } catch (err) { await print('08-sem-proximo.png'); ultimosLogs(); throw err; }
    const s = await estado();
    const caminho = logs.some((l) => l.includes('próximo episódio no mesmo player')) ? 'no mesmo player' : 'reabriu pelo resolvedor';
    resultados.push(`ℹ️ próximo: ${seguinte} tocando ${s.t.toFixed(1)} s, ${s.h}p (${caminho})`);
    chave = seguinte;
    await mexer();
    await print('08-proximo.png');
  });

  await passo('Esc fecha e guarda onde parou', async () => {
    await tocando(3, 30000);
    const t0 = (await estado()).t;
    await w.keyboard.press('Escape');
    await w.locator('[data-wm-player-desktop]').waitFor({ state: 'detached', timeout: 10000 });
    await w.waitForTimeout(1500);
    const pos = await w.evaluate((c) => {
      try { return JSON.parse(localStorage.getItem('watchmov_streamcache') || '{}')[c]?.positionMs ?? 0; } catch { return 0; }
    }, chave);
    if (!(pos > 0)) throw new Error(`a posição de ${chave} não ficou guardada`);
    resultados.push(`ℹ️ fechou em ${t0.toFixed(1)} s; guardado ${(pos / 1000).toFixed(1)} s em ${chave}`);
    await print('09-fechou.png');
  });

  // Canal do iptv-org (link direto) toca no player do app, sem linha do tempo. A lista começa pelos do SuperFlix
  // (iframe) e mostra 60 por página: busca pelo nome (WM_CANAL troca; canal de terceiro cai sem aviso: tenta os 3 e,
  // nenhum tocando, só avisa).
  await passo('Ao Vivo: canal com link direto toca no player do app', async () => {
    await w.reload();
    const aoVivo = w.locator('nav button', { hasText: /^Ao Vivo$/ }).first();
    await aoVivo.waitFor({ timeout: 60000 });
    await aoVivo.click();
    await w.locator('button[data-canal]:visible').first().waitFor({ timeout: 45000 });
    const campo = w.getByPlaceholder('Buscar canal...');
    const nomes = (process.env.WM_CANAL || 'Rede Minas|Cultura|ConecTV').split('|');
    for (const nome of nomes) {
      await campo.fill(nome);
      const canal = w.locator('button[data-canal="iptv"]:visible').first();
      try { await canal.waitFor({ timeout: 10000 }); } catch { resultados.push(`ℹ️ Ao Vivo: "${nome}" não está na lista do iptv-org`); continue; }
      const rotulo = (await canal.innerText()).split('\n')[0].trim();
      await canal.click();
      try {
        await w.locator('[data-wm-player-desktop] video').waitFor({ state: 'attached', timeout: 10000 });
        await tocando(1, 30000);
        const semLinha = !(await w.locator('[data-wm-player-desktop] [data-acao="linha-do-tempo"]').count());
        const s = await estado();
        resultados.push(`ℹ️ Ao Vivo: "${rotulo}" tocando ${s.t.toFixed(1)} s, ${s.h}p${semLinha ? ', sem linha do tempo (ao vivo)' : ''}`);
        await mexer();
        await print('10-ao-vivo.png');
        await w.keyboard.press('Escape');
        await w.locator('[data-wm-player-desktop]').waitFor({ state: 'detached', timeout: 10000 });
        return;
      } catch {
        resultados.push(`ℹ️ Ao Vivo: "${rotulo}" não tocou em 30 s`);
        if (await w.locator('[data-wm-player-desktop]').count()) {
          await w.keyboard.press('Escape');
          await w.locator('[data-wm-player-desktop]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
        }
      }
    }
    resultados.push(`⚠️ Ao Vivo: nenhum dos canais (${nomes.join(', ')}) tocou (canais de terceiro)`);
  });
}

// Só com o site local (Vite: o teste importa o nativePlayer.ts do site): abre o player direto, sem fonte de terceiro,
// com 2 links — o 1º recusado (endereço local: o app responde 403) e o 2º um HLS de teste com 5 qualidades — e confere
// a troca sozinha pro link 2, o menu de Qualidade, a lista de Links e o pedido de link novo (recapture) quando nenhum
// link toca. O registro desses erros na aba Bugs é segurado aqui (não grava nada no banco).
async function cenarioPlayerLinks(w, print) {
  const BOM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  const RUIM = 'https://127.0.0.1:9/quebrado/master.m3u8';
  const RUIM2 = 'https://127.0.0.2:9/quebrado/master.m3u8';
  const HLS = 'application/vnd.apple.mpegurl';
  await w.route('**/rest/v1/wm_playback_errors**', (r) => r.fulfill({ status: 201, body: '' }));
  const abrir = (urls) => w.evaluate(([lista, mime]) => {
    window.__wmRes = null;
    import('/src/lib/nativePlayer.ts')
      .then((m) => m.playNative({ url: lista[0], mime, title: 'Teste de links', key: '1:movie:0:0', urls: lista,
        mimes: lista.map(() => mime), qualities: lista.map(() => ''), fonte: 'Teste', servidores: [], startMs: 0 }))
      .then((r) => { window.__wmRes = r ?? { nulo: true }; }, (e) => { window.__wmRes = { erro: String(e) }; });
  }, [urls, HLS]);
  const resultado = async (ms) => {
    await w.waitForFunction(() => window.__wmRes !== null, null, { timeout: ms });
    return w.evaluate(() => window.__wmRes);
  };
  const botao = (acao) => w.locator(`[data-wm-player-desktop] [data-acao="${acao}"]`).first();
  const mexer = async () => { await w.mouse.move(400, 300); await w.mouse.move(420, 320); await w.waitForTimeout(250); };

  await passo('link 1 recusado: o player passa sozinho pro link 2', async () => {
    if (!(await w.evaluate(() => location.hostname === '127.0.0.1' || location.hostname === 'localhost'))) {
      throw new Error('cenário só com o site local (WM_SITE=http://127.0.0.1:8094/)');
    }
    await abrir([RUIM, BOM]);
    const aviso = w.locator('[data-wm-player-desktop] [data-aviso]');
    await aviso.waitFor({ timeout: 20000 });
    const texto = await aviso.innerText();
    if (!/link 1 de 2 falhou.*link 2 de 2/i.test(texto)) throw new Error(`aviso: "${texto}"`);
    await w.waitForFunction((b) => document.querySelector('[data-player-desktop]')?.getAttribute('data-link') === b, BOM, { timeout: 20000 });
    await w.waitForFunction(() => { const v = document.querySelector('[data-wm-player-desktop] video'); return !!v && v.currentTime > 2 && !v.paused; }, null, { timeout: 45000 });
    resultados.push(`ℹ️ aviso na troca: "${texto}"`);
    await mexer();
    await print('01-link-2.png');
  });

  await passo('Qualidade: Auto + 5 alturas; escolher 288p troca o vídeo', async () => {
    await mexer();
    await botao('ajustes').click();
    await botao('qualidade').waitFor({ timeout: 5000 });
    await botao('qualidade').click();
    const painel = w.locator('[data-painel="Qualidade"]');
    await painel.waitFor({ timeout: 5000 });
    const linhas = (await painel.locator('button[aria-pressed]').allInnerTexts()).map((x) => x.trim());
    if (linhas.length !== 6 || !/^Auto/.test(linhas[0])) throw new Error(`linhas: ${linhas.join(' | ')}`);
    await print('02-qualidade.png');
    await painel.getByRole('button', { name: /^288p$/ }).click();
    await w.waitForFunction(() => document.querySelector('[data-wm-player-desktop] video')?.videoHeight === 288, null, { timeout: 30000 });
    resultados.push(`ℹ️ qualidade: ${linhas.join(' · ')} → tocando 288p`);
  });

  await passo('Links: o ✓ no link que toca; voltar pro 1 (recusado) volta pro 2 sozinho', async () => {
    await mexer();
    await botao('ajustes').click();
    await botao('links').click();
    const painel = w.locator('[data-painel="Links"]');
    await painel.waitFor({ timeout: 5000 });
    const marcado = await painel.locator('[aria-pressed="true"]').getAttribute('data-acao');
    if (marcado !== 'link-2') throw new Error(`✓ em ${marcado}`);
    await print('03-links.png');
    await painel.locator('[data-acao="link-1"]').click();
    await w.waitForFunction((b) => document.querySelector('[data-player-desktop]')?.getAttribute('data-link') === b, BOM, { timeout: 20000 });
    await w.waitForFunction(() => { const v = document.querySelector('[data-wm-player-desktop] video'); return !!v && v.readyState >= 2 && !v.paused; }, null, { timeout: 45000 });
    const t = await w.evaluate(() => document.querySelector('[data-wm-player-desktop] video').currentTime);
    resultados.push(`ℹ️ link 1 de novo → recusado → link 2 em ${t.toFixed(1)} s (o mesmo tempo)`);
    await w.keyboard.press('Escape');
    const r = await resultado(10000);
    if (!(r.positionMs > 0) || r.url !== BOM || r.watched !== false) throw new Error(`resultado ao fechar: ${JSON.stringify(r)}`);
    resultados.push(`ℹ️ Esc: positionMs=${r.positionMs} url=link 2 watched=${r.watched} watchedKey=${r.watchedKey}`);
  });

  await passo('nenhum link toca: pede link novo ao app (recapture)', async () => {
    await abrir([RUIM, RUIM2]);
    const r = await resultado(30000);
    if (r.recapture !== true) throw new Error(`resultado: ${JSON.stringify(r)}`);
    resultados.push(`ℹ️ 2 links recusados → fechou com recapture=true (o app pega link novo pelo resolvedor)`);
  });
  await w.unroute('**/rest/v1/wm_playback_errors**');
}

// ---------------------------------------------------------------- cenário "downloads" (W4)
// Vídeos públicos de teste (não são das fontes): o trailer do Sintel (mp4, 4 MB, W3C) e o Big Buck Bunny em HLS (240p,
// 64 pedaços, ~18 MB, Mux). As chaves são os ids deles na TMDB: a aba Download mostra a capa de verdade.

// Duração do arquivo pelo ffmpeg do próprio app (desktop/node_modules/ffmpeg-static; WM_FFMPEG troca, como no app).
function duracaoDoArquivo(arquivo) {
  const ffmpeg = process.env.WM_FFMPEG || createRequire(path.join(pastaDesktop, 'package.json'))('ffmpeg-static');
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', arquivo], { encoding: 'utf8' });
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(r.stderr ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

async function abrirAbaDownload(w) {
  const painel = w.locator('button[title="Painel"]');
  await painel.waitFor({ timeout: 30000 });
  await painel.click();
  await w.getByRole('button', { name: /^Download$/ }).click();
  await w.getByText(/Ocupando|Nenhum download|Download/i).first().waitFor({ timeout: 15000 });
}

async function tocarDaAba(w, titulo) {
  await w.locator('button').filter({ has: w.locator(`img[alt="${titulo}"]`) }).or(w.getByRole('button', { name: titulo })).first().click();
  await w.waitForFunction(() => (document.querySelector('[data-player-desktop]')?.getAttribute('data-link') ?? '').startsWith('wm-video://arquivo/'), null, { timeout: 20000 });
  await w.waitForFunction(() => { const v = document.querySelector('[data-wm-player-desktop] video'); return !!v && v.currentTime > 2 && !v.paused; }, null, { timeout: 30000 });
  await w.mouse.move(500, 300); await w.mouse.move(520, 320);
  await w.waitForTimeout(600);
}

async function fecharPlayer(w) {
  await w.keyboard.press('Escape');
  await w.locator('[data-wm-player-desktop]').waitFor({ state: 'detached', timeout: 10000 });
}

async function cenarioDownloads(app, w, print) {
  if (process.env.WM_DL_REAL) return cenarioDownloadReal(w, print);
  const DL_MP4 = { key: 'm:45745', url: 'https://media.w3.org/2010/05/sintel/trailer.mp4', title: 'Sintel (trailer de teste)', nome: 'Sintel (trailer de teste).mp4', dur: 52 };
  const DL_HLS = {
    key: 'm:10378', url: 'https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_ld_7.m3u8', mime: 'application/vnd.apple.mpegurl',
    title: 'Big Buck Bunny (teste)', nome: 'Big Buck Bunny (teste).mp4', dur: 634,
  };
  const pasta = process.env.WM_DL_PASTA;
  const ponte = (pg) => (fn, ...a) => pg.evaluate(([f, args]) => window.wmDesktop.downloads[f](...args), [fn, a]);
  let dl = ponte(w);
  const esperar = async (pg, k, cond, ms, rotulo) => {
    const t0 = Date.now();
    let it;
    while (Date.now() - t0 < ms) {
      it = (await pg.evaluate(() => window.wmDesktop.downloads.lista())).find((x) => x.key === k);
      if (it && cond(it)) return it;
      if (it?.state === 'failed') throw new Error(`${rotulo}: falhou — ${it.reason}`);
      await pg.waitForTimeout(400);
    }
    throw new Error(`${rotulo}: não chegou a tempo (${JSON.stringify(it ?? null)})`);
  };

  await passo('o app tem a ponte de downloads', async () => {
    if (!(await w.evaluate(() => typeof window.wmDesktop?.downloads?.enfileirar === 'function'))) throw new Error('sem a ponte de downloads (app velho?)');
    for (const k of [DL_MP4.key, DL_HLS.key]) await dl('remover', k);   // sobra de uma rodada anterior
    resultados.push(`ℹ️ pasta dos downloads: ${pasta} · limite do teste ${process.env.WM_DL_KBPS} KB/s`);
  });

  await passo('mp4: baixa inteiro e vira um .mp4 com a duração certa', async () => {
    if (!(await dl('enfileirar', { key: DL_MP4.key, url: DL_MP4.url, title: DL_MP4.title }))) throw new Error('o app recusou o pedido');
    const it = await esperar(w, DL_MP4.key, (x) => x.state === 'completed', 120000, 'mp4');
    const d = duracaoDoArquivo(path.join(pasta, DL_MP4.nome));
    if (d === null || Math.abs(d - DL_MP4.dur) > 3) throw new Error(`duração do arquivo: ${d}`);
    resultados.push(`ℹ️ mp4: ${(it.bytes / 1048576).toFixed(1)} MB, ${d.toFixed(1)} s`);
  });

  let parouEm = 0;
  await passo('HLS: baixa pedaço por pedaço (aba Download com o progresso)', async () => {
    if (!(await dl('enfileirar', { key: DL_HLS.key, url: DL_HLS.url, title: DL_HLS.title, mime: DL_HLS.mime }))) throw new Error('o app recusou o pedido');
    await abrirAbaDownload(w);
    const it = await esperar(w, DL_HLS.key, (x) => x.state === 'downloading' && x.percent >= 30, 180000, 'HLS 30%');
    parouEm = it.percent;
    await w.waitForTimeout(800);
    await print('01-baixando.png');
  });

  await app.close();   // = o PC fechou o app no meio do download
  const de = registros.length;
  appDeNovo = await electron.launch({ executablePath: binario, args: argsApp, timeout: 90000 });
  ouvirRegistros(appDeNovo);
  const w2 = await appDeNovo.firstWindow({ timeout: 60000 });
  const print2 = (nome) => w2.screenshot({ path: path.join(saida, `downloads-${nome}`) });
  dl = ponte(w2);

  await passo('HLS: aberto de novo, continua de onde parou (não recomeça do 0)', async () => {
    await w2.waitForLoadState('domcontentloaded');
    const it = await esperar(w2, DL_HLS.key, (x) => x.state === 'downloading' || x.state === 'completed', 60000, 'HLS de volta');
    if (it.percent < parouEm - 5) throw new Error(`voltou em ${it.percent}% (tinha parado em ${parouEm}%)`);
    const continuou = registros.slice(de).find((l) => /pedaços já baixados/.test(l));
    if (!continuou) throw new Error('o app não disse que continuou dos pedaços já baixados');
    resultados.push(`ℹ️ parou em ${parouEm}% · ${continuou.replace(/^.*download m:\d+: /, '')}`);
    const fim = await esperar(w2, DL_HLS.key, (x) => x.state === 'completed', 300000, 'HLS completo');
    const d = duracaoDoArquivo(path.join(pasta, DL_HLS.nome));
    if (d === null || Math.abs(d - DL_HLS.dur) > 3) throw new Error(`duração do arquivo: ${d}`);
    resultados.push(`ℹ️ HLS: ${(fim.bytes / 1048576).toFixed(1)} MB, ${d.toFixed(1)} s (${Math.floor(d / 60)} min ${Math.round(d % 60)} s)`);
  });

  await passo('aba Download: os dois prontos; o baixado toca no player do app, do disco', async () => {
    await w2.locator('button[title="Painel"]').waitFor({ timeout: 60000 });
    await abrirAbaDownload(w2);
    await w2.waitForTimeout(1500);   // capas da TMDB
    await print2('02-aba.png');
    await tocarDaAba(w2, DL_HLS.title);
    await print2('03-tocando-do-disco.png');
    await fecharPlayer(w2);
  });

  await passo('sem internet: o app abre a cópia guardada e toca o baixado', async () => {
    // A cópia é do service worker do app (public/sw-desktop.js): espera ele terminar de guardar a interface.
    await w2.waitForFunction(async () => {
      const k = (await caches.keys()).find((x) => x.startsWith('wm-desktop-'));
      return !!k && !!(await (await caches.open(k)).match('/'));
    }, null, { timeout: 60000, polling: 1000 });
    await w2.context().setOffline(true);   // = cabo/Wi-Fi fora: a página não alcança o site
    await w2.reload().catch(() => undefined);
    try { await w2.waitForURL(/[?&]offline=1/, { timeout: 30000, waitUntil: 'domcontentloaded' }); } catch (e) {
      await print2('04-sem-internet-falhou.png').catch(() => undefined);
      throw new Error(`o app não abriu a cópia sem internet (endereço: ${w2.url()}): ${String(e?.message ?? e).split('\n')[0]}`);
    }
    await abrirAbaDownload(w2);
    await w2.waitForTimeout(1000);
    await print2('04-sem-internet.png');
    await tocarDaAba(w2, DL_MP4.title);
    await print2('05-tocando-sem-internet.png');
    await fecharPlayer(w2);
    await w2.context().setOffline(false);
  });

  await passo('excluir tira o download da aba e apaga o arquivo do PC', async () => {
    for (const k of [DL_MP4.key, DL_HLS.key]) await dl('remover', k);
    const sobrou = fs.existsSync(pasta) ? fs.readdirSync(pasta) : [];
    if (sobrou.length) throw new Error(`ficou na pasta: ${sobrou.join(', ')}`);
    if ((await dl('lista')).some((x) => x.key === DL_MP4.key || x.key === DL_HLS.key)) throw new Error('ainda na lista');
  });
}


// Fora do CI (WM_DL_REAL=<busca>, ex. "Game of Thrones"; WM_DL_KBPS=0): um episódio de verdade, de uma fonte, pelo
// "Download" do ⚙ do player do app — prova que os cabeçalhos do link e a CDN da fonte funcionam no download.
async function cenarioDownloadReal(w, print) {
  const busca = process.env.WM_DL_REAL;
  const minutos = Number(process.env.WM_DL_REAL_MIN) || 40;
  const pasta = process.env.WM_DL_PASTA;
  const botao = (acao) => w.locator(`[data-wm-player-desktop] [data-acao="${acao}"]`).first();
  const mexer = async () => { await w.mouse.move(400, 300); await w.mouse.move(420, 320); await w.waitForTimeout(250); };
  let chave = '', dlKey = '';
  await passo(`fonte de verdade: o episódio abre sozinho no player do app [${busca}]`, async () => {
    await abrirSozinho(w, true);
    await w.evaluate(() => localStorage.removeItem('watchmov_streamcache'));
    await w.locator('button[title="Buscar"]').first().click();
    const campo = w.getByPlaceholder('Buscar filmes, séries e animes...');
    await campo.waitFor({ timeout: 15000 });
    await campo.fill(busca);
    await campo.press('Enter');
    const cartaz = w.locator('[data-tv-hold][data-tv-key^="tv-"]:visible').first();
    await cartaz.waitFor({ timeout: 30000 });
    await w.waitForTimeout(2500);
    await cartaz.click();
    await w.getByRole('button', { name: /^(Assistir|Continuar)$/ }).first().click();
    await w.waitForFunction(() => { const v = document.querySelector('[data-wm-player-desktop] video'); return !!v && v.currentTime > 1 && !v.paused; }, null, { timeout: 150000 });
    const r = await w.evaluate(() => { const e = document.querySelector('[data-player-desktop]'); return { chave: e?.getAttribute('data-chave') ?? '', link: e?.getAttribute('data-link') ?? '' }; });
    chave = r.chave;
    const p = chave.split(':');
    dlKey = `e:${p[0]}:${p[2]}:${p[3]}`;
    for (const k of [dlKey]) await w.evaluate((x) => window.wmDesktop.downloads.remover(x), k);
    resultados.push(`ℹ️ tocando ${chave} · ${r.link.slice(0, 80)}`);
  });
  await passo('⚙ › Download pede o download do link que está tocando', async () => {
    await mexer();
    await botao('ajustes').click();
    await botao('baixar').click();
    await w.waitForTimeout(1500);
    await mexer();
    await print('real-01-pedido.png');
    await w.keyboard.press('Escape');   // fecha os Ajustes
    await w.keyboard.press('Escape');   // fecha o player (o download segue no processo principal)
  });
  await passo(`o episódio baixa inteiro (até ${minutos} min) e vira .mp4`, async () => {
    const t0 = Date.now();
    let it, ultimo = -1;
    while (Date.now() - t0 < minutos * 60000) {
      it = (await w.evaluate(() => window.wmDesktop.downloads.lista())).find((x) => x.key === dlKey);
      if (it?.state === 'completed') break;
      if (it?.state === 'failed') throw new Error(`falhou: ${it.reason}`);
      const minuto = Math.floor((Date.now() - t0) / 60000);
      if (minuto !== ultimo) { ultimo = minuto; console.log(`[teste] ${minuto} min: ${it?.state} ${it?.percent}% ${((it?.bytes ?? 0) / 1048576).toFixed(0)} MB`); }
      await w.waitForTimeout(2000);
    }
    if (it?.state !== 'completed') throw new Error(`não terminou em ${minutos} min (${JSON.stringify(it)})`);
    const arquivo = fs.readdirSync(pasta).find((f) => f.endsWith('.mp4'));
    const d = arquivo ? duracaoDoArquivo(path.join(pasta, arquivo)) : null;
    if (!d || d < 15 * 60) throw new Error(`duração estranha: ${d} (${arquivo})`);
    resultados.push(`ℹ️ ${arquivo}: ${(it.bytes / 1048576).toFixed(0)} MB, ${Math.floor(d / 60)} min ${Math.round(d % 60)} s, em ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  });
  await passo('a aba Download toca o episódio baixado, do disco', async () => {
    await abrirAbaDownload(w);
    await w.waitForTimeout(1500);
    await print('real-02-aba.png');
  });
}
