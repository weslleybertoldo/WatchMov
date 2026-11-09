// Sino no app do Windows (W6, plano 07/11/2026; D9 e D12). O PC não tem o FCM do Android: com o app aberto (ou
// minimizado), ele mesmo confere na TMDB os títulos com o sino ligado, com a MESMA regra da edge notify-releases
// (episódio ou estreia entre hoje−2 dias e hoje, no fuso de São Paulo), e avisa pelo Windows (Notification) + central de
// avisos, como o pushNotificationReceived do APK. Clicar no aviso abre o título (o mesmo onPushOpen do Index.tsx).
// A última chave avisada por título fica no PC: não repete. Navegador e APK nunca rodam isto (só com window.wmDesktop).
import { addNotice } from '@/lib/appNotices';
import { desktop } from '@/lib/desktop';
import { getLancamento, type LancamentoTmdb } from '@/lib/tmdb';

export interface SubAviso { tmdbId: number; type: 'movie' | 'tv' }
export interface Aviso { chave: string; titulo: string; corpo: string }

/** Igual à edge: o cron é diário e pode falhar; aceitar os últimos 2 dias repesca, e a chave impede repetir. */
export const DIAS_DE_TOLERANCIA = 2;
/** 1ª conferência depois de abrir (a tela assenta antes) e depois de hora em hora. */
export const PRIMEIRA_MS = 60_000;
export const INTERVALO_MS = 60 * 60_000;
const CHAVE_LOCAL = 'wm_aviso_desktop';

/** "2026-11-08" no fuso de São Paulo (= todaySP da edge). */
export const hojeSP = (agora = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);

/** `n` dias antes de "AAAA-MM-DD" (= daysAgoSP da edge). */
export function diasAntes(base: string, n: number): string {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** A regra da edge notify-releases: série → o episódio mais recente que já saiu dentro da janela; filme → estreia na
 *  janela. Nada novo → null. */
export function avisoDoTitulo(tipo: 'movie' | 'tv', l: LancamentoTmdb, hoje: string): Aviso | null {
  const inicio = diasAntes(hoje, DIAS_DE_TOLERANCIA);
  if (tipo === 'tv') {
    const ep = (l.episodios ?? [])
      .filter((e) => e.air_date && e.air_date <= hoje && e.air_date >= inicio)
      .sort((a, b) => (a.air_date < b.air_date ? 1 : -1))[0];
    if (!ep) return null;
    return {
      chave: `s${ep.season_number}e${ep.episode_number}`,
      titulo: l.titulo || 'Novo episódio',
      corpo: `Episódio novo disponível: T${ep.season_number} E${ep.episode_number}${ep.name ? ` — ${ep.name}` : ''}`,
    };
  }
  if (l.estreia && l.estreia <= hoje && l.estreia >= inicio) return { chave: 'released', titulo: l.titulo || 'Estreia', corpo: 'Já disponível — pode assistir.' };
  return null;
}

const idLocal = (s: SubAviso) => `${s.type}:${s.tmdbId}`;
function lerAvisados(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '{}') as Record<string, string>; } catch { return {}; }
}
function gravarAvisados(m: Record<string, string>) {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(m)); } catch { /* cota cheia: no pior caso repete */ }
}

const aoAbrir = new Set<(d: SubAviso) => void>();
/** Clique no aviso do Windows → abre o título (registrado pelo onPushOpen). */
export function aoAbrirAvisoDesktop(cb: (d: SubAviso) => void): void { aoAbrir.add(cb); }

/** Mostra o aviso: Windows (Notification; o atalho do instalador tem o AUMID do app) + central de avisos. */
export function mostrarAviso(a: Aviso, sub: SubAviso): void {
  addNotice({ kind: 'release', title: a.titulo, body: a.corpo });
  try {
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return;
    const n = new Notification(a.titulo, { body: a.corpo, tag: `wm-${idLocal(sub)}-${a.chave}` });
    n.onclick = () => {
      void desktop?.focar?.();
      aoAbrir.forEach((cb) => cb(sub));
    };
  } catch (e) { console.warn('[sino] aviso do Windows falhou', e); }
}

/** Uma conferência: cada título com o sino ligado na TMDB; o que é novo (e ainda não avisado neste PC) avisa. */
export async function conferirAvisos(subs: SubAviso[], hoje = hojeSP()): Promise<number> {
  const avisados = lerAvisados();
  let novos = 0;
  for (const s of subs) {
    let l: LancamentoTmdb;
    try { l = await getLancamento(s.tmdbId, s.type); } catch { continue; }   // TMDB fora: tenta na próxima hora
    const a = avisoDoTitulo(s.type, l, hoje);
    if (!a || avisados[idLocal(s)] === a.chave) continue;
    avisados[idLocal(s)] = a.chave;
    gravarAvisados(avisados);
    mostrarAviso(a, s);
    novos++;
  }
  return novos;
}

let ligado = false;
/** Liga o sino do PC (idempotente): 1 min depois de abrir e de hora em hora, enquanto o app estiver aberto. */
export function ligarAvisosDesktop(subsLigados: () => SubAviso[], recarregar: () => Promise<void>): void {
  if (ligado || !desktop) return;
  ligado = true;
  const rodar = async () => {
    await recarregar().catch(() => {});
    await conferirAvisos(subsLigados()).catch((e) => console.warn('[sino] conferência falhou', e));
  };
  window.setTimeout(() => { void rodar(); window.setInterval(() => void rodar(), INTERVALO_MS); }, PRIMEIRA_MS);
  // Teste do app instalado (smoke `fim`): o mesmo caminho do aviso, com o texto do "?force" da edge.
  (window as unknown as { wmAvisoTeste?: () => void }).wmAvisoTeste = () =>
    mostrarAviso({ chave: 'teste', titulo: 'WatchMov', corpo: 'Teste de notificação — está funcionando.' }, { tmdbId: 1399, type: 'tv' });
}
