import type { SniffResult } from '@/lib/streamSniffer';
import { streamKey } from '@/lib/streamCache';

// Lista "Links do vídeo" do VideoPlayer: uma captura nova entra no fim; uma recaptura
// (mesma chave — o token da URL muda a cada play) ATUALIZA a entrada existente com a URL
// fresca, mantendo tudo que a nova não trouxe. Antes o dedup recriava o objeto só com
// url/mime/referer/provider e PERDIA `headers` e `quality`: os headers levam o UA real do
// WebView pro replay do proxy (googlevideo/Blogger prende a URL ao UA → 403 sem eles) e a
// quality some do rótulo (14/09/2026).
export function mergeCaptured(prev: SniffResult[], r: SniffResult): SniffResult[] {
  const key = streamKey(r.url);
  const idx = prev.findIndex(x => streamKey(x.url) === key);
  if (idx < 0) return [...prev, r];
  const cur = prev[idx];
  const copy = [...prev];
  copy[idx] = {
    ...cur,
    url: r.url,
    mime: r.mime || cur.mime,
    referer: r.referer || cur.referer,
    provider: r.provider || cur.provider,
    headers: r.headers || cur.headers,
    quality: r.quality || cur.quality,
  };
  return copy;
}
