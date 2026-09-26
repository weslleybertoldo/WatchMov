import { describe, it, expect } from 'vitest';
import { pickNext, type Box } from './tvNav';

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });

// Duas fileiras de cartazes (100x150, 12 de espaço) + "Ver tudo" no canto da 2ª fileira.
const fileira1 = [0, 1, 2, 3].map(i => box(i * 112, 300, 100, 150));
const verTudo = box(900, 470, 60, 20);
const fileira2 = [0, 1, 2, 3].map(i => box(i * 112, 500, 100, 150));

describe('pickNext', () => {
  it('↓ vai pro cartaz logo abaixo, não pro "Ver tudo" mais perto no eixo', () => {
    const cands = [verTudo, ...fileira2];
    expect(pickNext(fileira1[1], cands, 'down')).toBe(2); // fileira2[1]
  });

  it('→ e ← andam na mesma fileira', () => {
    const cands = [...fileira1, ...fileira2];
    expect(pickNext(fileira1[1], cands, 'right')).toBe(2);
    expect(pickNext(fileira1[1], cands, 'left')).toBe(0);
  });

  it('→ no fim da fileira não pula pra outra fileira', () => {
    const cands = [...fileira1.slice(0, 3), ...fileira2];
    expect(pickNext(fileira1[3], cands, 'right')).toBe(-1);
  });

  it('↑ do 1º cartaz vai pro destaque largo em cima', () => {
    const hero = box(0, 60, 960, 220);
    const cabecalho = [box(200, 10, 60, 30), box(300, 10, 60, 30)];
    expect(pickNext(fileira1[0], [...cabecalho, hero], 'up')).toBe(2);
  });

  it('↑ do destaque (bem mais largo) vai pro 1º item do cabeçalho', () => {
    const hero = box(0, 60, 960, 220);
    const cabecalho = [box(450, 10, 60, 30), box(100, 10, 60, 30), box(800, 10, 60, 30)];
    expect(pickNext(hero, cabecalho, 'up')).toBe(1);
  });

  it('↓ do destaque cai no 1º cartaz da fileira, não no do meio', () => {
    const hero = box(0, 60, 960, 220);
    expect(pickNext(hero, fileira1, 'down')).toBe(0);
  });

  it('sem nada na direção devolve -1', () => {
    expect(pickNext(fileira2[0], fileira1, 'down')).toBe(-1);
    expect(pickNext(fileira1[0], fileira2, 'up')).toBe(-1);
  });

  it('item sobreposto (centro abaixo) entra quando não há nenhum inteiro abaixo', () => {
    const atual = box(0, 0, 100, 100);
    const sobreposto = box(0, 60, 100, 100); // começa antes do fim do atual
    expect(pickNext(atual, [sobreposto], 'down')).toBe(0);
  });

  it('grade: ↓ escolhe a coluna alinhada', () => {
    const grade = [0, 1, 2].flatMap(l => [0, 1, 2].map(c => box(c * 120, l * 200, 100, 180)));
    expect(pickNext(grade[1], grade, 'down')).toBe(4);
    expect(pickNext(grade[4], grade, 'up')).toBe(1);
    expect(pickNext(grade[4], grade, 'right')).toBe(5);
  });
});
