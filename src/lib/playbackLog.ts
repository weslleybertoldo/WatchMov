import { supabase } from '@/lib/supabase';
import { onPlayerError, type PlayerErrorEvent } from '@/lib/nativePlayer';

// Registro dos erros/diagnósticos do player nativo na aba Bugs (wm_playback_errors).
//
// ⚠️ POR QUE ISTO É GLOBAL: o listener de `playerError` morava SÓ dentro do
// VideoPlayer, atrás de `if (!open) return`. Episódio BAIXADO não monta o
// VideoPlayer (playEpisode desvia pro playDownloaded, que abre o player nativo
// direto), então TODO `reportError` daquele caminho caía no vazio: nem erro de
// reprodução, nem os diagnósticos de cast que a gente usa pra investigar. Pior que
// perder o log: fazia a aba vazia PARECER "não deu erro" quando na verdade ninguém
// estava ouvindo. Aqui o registro passa a valer pra qualquer caminho que abra o
// player. A lógica de LISTA (remover link morto, auto-avanço) segue no VideoPlayer,
// que é quem tem o picker — este módulo só grava.

let ligado = false;

// Provedor da fonte em uso, publicado pelo VideoPlayer. O player nativo não sabe
// disso (é escolha do JS) e o caminho do baixado não tem provedor — fica null.
let providerAtual: string | null = null;
export function setLogProvider(p: string | null) { providerAtual = p; }

export function logPlaybackError(e: PlayerErrorEvent) {
  supabase.from('wm_playback_errors').insert({
    title: e.title ?? null,
    provider: providerAtual,
    url: e.url ?? null,
    referer: e.referer ?? null,
    mime: e.mime ?? null,
    error_code: typeof e.code === 'number' ? e.code : null,
    error_name: e.name ?? null,
    error_cause: e.cause ?? null,
    app_version: __APP_VERSION__,
    platform: 'android',
  }).then(({ error }) => { if (error) console.warn('[bugs] log falhou', error.message); });
}

/** Liga o registro no boot — idempotente, igual ao startMp4Listener. */
export function startPlaybackErrorLog() {
  if (ligado) return;
  ligado = true;
  onPlayerError?.(logPlaybackError)?.catch(() => { ligado = false; });
}
