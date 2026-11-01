// src/lib/abysNaTv.test.ts — 01/11/2026 (quedas na Fire TV): na TV a qualidade AV1 do motor ABYS fica de fora.
import { describe, it, expect, vi, afterEach } from 'vitest';

const estado = vi.hoisted(() => ({ tv: true }));
vi.mock('./device', () => ({ isTv: () => estado.tv }));

import { buildAbyssScript } from './resolver';

describe('motor ABYS: AV1 fora na TV (01/11/2026)', () => {
  afterEach(() => { estado.tv = true; });

  it('na TV o script marca TV=1, detecta av01 e avisa a opção morta quando só tem AV1', () => {
    const s = buildAbyssScript('sid1');
    expect(s).toContain('TV=1');
    expect(s).toContain("t.indexOf('av01')>=0&&!/avc1|hvc1|hev1/.test(t)");
    expect(s).toContain('!(TV&&s.av1)');
    expect(s).toContain('WMOPT|dead|k=__OPT_K__|reason=av1-tv');
  });

  it('no celular TV=0 (AV1 segue valendo)', () => {
    estado.tv = false;
    expect(buildAbyssScript('sid1')).toContain('TV=0');
  });

  it('o script do motor continua sendo JS válido', () => {
    expect(() => new Function(buildAbyssScript('sid1'))).not.toThrow();
  });
});
