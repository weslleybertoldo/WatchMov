// Painel "Episódios" do player nativo (pedido dele 06/11/2026: "na barra inferior … a opção de abrir os EPS no caso de
// séries … o foco abre no EP atual e aparecem os assistidos … e os próximos eps").
//
// Com o player na frente a página do app fica CONGELADA (medido no emulador em 06/11/2026: os pedidos do player só
// eram respondidos nos primeiros segundos). Então o app manda JÁ NA ABERTURA o que só ele sabe — por temporada: total
// de episódios, duração padrão, assistidos e o progresso de quem parou no meio — e o player busca sozinho na TMDB o
// nome, o frame e a data de cada episódio (EpisodiosDados.java lê este JSON).

export interface TemporadaDoPlayer { n: number; total: number; min?: number; vistos: number[]; pct: Record<string, number> }
export interface SerieDoPlayer { tmdb: number; chave: string; temporadas: TemporadaDoPlayer[] }

export interface DadosDaSerie {
  tmdbId: number;
  chave: string;   // chave v3 da TMDB (a mesma do app)
  // As temporadas da série na TMDB (details.seasons): viram as pílulas T1 T2 … e dão o total de episódios.
  temporadas: { number: number; totalEpisodes: number; episodeDuration?: number }[];
  vistos: (temporada: number) => number[];                                        // assistidos da temporada
  posicoes: Record<string, { positionMs: number; durationMs?: number }>;       // "temporada:ep" → onde parou
}

export function montarSerie(a: DadosDaSerie): SerieDoPlayer {
  return {
    tmdb: a.tmdbId,
    chave: a.chave,
    temporadas: a.temporadas.map(t => {
      const vistos = a.vistos(t.number);
      const pct: Record<string, number> = {};
      for (const [k, p] of Object.entries(a.posicoes)) {
        const [s, ep] = k.split(':').map(Number);
        if (s !== t.number || !ep || vistos.includes(ep) || !p.durationMs || p.positionMs <= 0) continue;
        const v = Math.min(100, Math.round((p.positionMs / p.durationMs) * 100));
        if (v > 0) pct[String(ep)] = v;   // barra só de quem parou no meio (a mesma regra da página da série)
      }
      return { n: t.number, total: t.totalEpisodes, min: t.episodeDuration || undefined, vistos, pct };
    }),
  };
}
