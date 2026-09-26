import { describe, it, expect } from 'vitest';
import { inicioDaSetinha, pickNext, type Box } from './tvNav';

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

// Servidor na TV: barra do topo (52 de altura, o Ligar ao lado dos Links) e a página do servidor logo abaixo.
describe('inicioDaSetinha', () => {
  const ligar = box(700, 8, 60, 36);
  const pagina = box(0, 52, 912, 461);

  it('nasce 32 abaixo do topo da página, no meio do botão, e sai no topo da página', () => {
    expect(inicioDaSetinha(ligar, pagina)).toEqual({ x: 730, y: 84, exitY: 52 });
  });

  it('botão por cima da página → nasce 32 abaixo dele e ainda sai no topo da página', () => {
    expect(inicioDaSetinha(box(390, 56, 180, 32), pagina)).toEqual({ x: 480, y: 120, exitY: 52 });
  });

  it('botão na ponta → a setinha fica dentro da página', () => {
    expect(inicioDaSetinha(box(-20, 8, 20, 36), pagina)?.x).toBe(8);
  });

  it('sem página abaixo do botão → não liga', () => {
    expect(inicioDaSetinha(box(390, 500, 180, 32), pagina)).toBeNull();
    expect(inicioDaSetinha(ligar, box(0, 52, 30, 461))).toBeNull();
  });
});
