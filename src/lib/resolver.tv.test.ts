import { describe, it, expect, vi } from 'vitest';

// Na TV (box de 1 GB / Fire TV Stick) o motor ABYS roda com 2 laços em vez de 3.
vi.mock('./device', () => ({ isTv: () => true }));

describe('motor ABYS na TV', () => {
  it('usa 2 laços', async () => {
    const { buildAbyssScript, abyssPumps, ABYSS_PUMPS } = await import('./resolver');
    expect(abyssPumps()).toBe(2);
    expect(ABYSS_PUMPS).toBe(3);
    expect(buildAbyssScript('sid1')).toContain('PUMPS=2');
  });
});
