import { describe, it, expect } from 'vitest';
import { shortReason, reasonPercent, tileReason } from './downloadReason';

const CHEIO = 'Servidor da fonte parou de responder · parou em 37% · abra a aba Download pra retomar de onde parou';

describe('downloadReason', () => {
  it('shortReason pega só o motivo', () => {
    expect(shortReason(CHEIO)).toBe('Servidor da fonte parou de responder');
  });
  it('shortReason sem separador devolve o texto inteiro; vazio vira "erro"', () => {
    expect(shortReason('java.net.SocketTimeoutException: Read timed out')).toBe('java.net.SocketTimeoutException: Read timed out');
    expect(shortReason('')).toBe('erro');
    expect(shortReason(undefined)).toBe('erro');
  });
  it('reasonPercent lê o "parou em N%"', () => {
    expect(reasonPercent(CHEIO)).toBe(37);
    expect(reasonPercent('Link expirou: abra o título de novo pra capturar outro · abra a aba Download pra retomar de onde parou')).toBeNull();
  });
  it('tileReason junta motivo e %', () => {
    expect(tileReason(CHEIO)).toBe('Servidor da fonte parou de responder (37%)');
    expect(tileReason('Download interrompido · abra a aba Download pra retomar de onde parou')).toBe('Download interrompido');
  });
});
