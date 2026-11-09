import { describe, it, expect, beforeEach } from 'vitest';
import { ehEscritaNoBanco, comecouEscrita, terminouEscrita, escritasDoBanco, zerarEscritas } from './escritasBanco';

beforeEach(() => zerarEscritas());

describe('escritasBanco — gravações no banco em andamento', () => {
  it('só método de escrita nos endereços do PostgREST conta', () => {
    const rest = 'https://x.supabase.co/rest/v1/wm_items?id=eq.1';
    expect(ehEscritaNoBanco(rest, 'PATCH')).toBe(true);
    expect(ehEscritaNoBanco(rest, 'post')).toBe(true);
    expect(ehEscritaNoBanco(rest, 'DELETE')).toBe(true);
    expect(ehEscritaNoBanco(rest, 'GET')).toBe(false);
    expect(ehEscritaNoBanco(rest, 'HEAD')).toBe(false);
    expect(ehEscritaNoBanco(rest)).toBe(false);                                   // sem método = GET
    expect(ehEscritaNoBanco('https://x.supabase.co/auth/v1/token', 'POST')).toBe(false);
    expect(ehEscritaNoBanco('https://x.supabase.co/functions/v1/tv-pair', 'POST')).toBe(false);
  });

  it('conta as que estão no ar e o total que já começou', () => {
    comecouEscrita(); comecouEscrita();
    expect(escritasDoBanco()).toEqual({ emVoo: 2, total: 2 });
    terminouEscrita();
    expect(escritasDoBanco()).toEqual({ emVoo: 1, total: 2 });
    terminouEscrita(); terminouEscrita();                                         // nunca fica negativo
    expect(escritasDoBanco()).toEqual({ emVoo: 0, total: 2 });
  });
});
