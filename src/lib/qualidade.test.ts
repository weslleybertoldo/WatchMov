import { describe, expect, it } from 'vitest';
import { classeDaImagem, qualidadeDaImagem } from './qualidade';

// 09/11/2026: o rótulo de qualidade é a classe da imagem (1920×804 = 1080p), não a altura crua ("804p").
// Os mesmos casos do QualidadeDaImagemTest.java (APK).
describe('qualidadeDaImagem', () => {
  it('filme de cinema sem as faixas pretas mostra a classe', () => {
    expect(qualidadeDaImagem(1920, 804)).toBe('1080p'); // Bad Boys: Até o Fim (2,39:1), Fonte 2 ABYS
    expect(qualidadeDaImagem(1920, 800)).toBe('1080p');
    expect(qualidadeDaImagem(1920, 696)).toBe('1080p'); // 2,76:1
    expect(qualidadeDaImagem(1280, 536)).toBe('720p');
    expect(qualidadeDaImagem(854, 356)).toBe('480p');
    expect(qualidadeDaImagem(3840, 1608)).toBe('2160p');
  });

  it('tamanhos padrão não mudam', () => {
    expect(qualidadeDaImagem(1920, 1080)).toBe('1080p');
    expect(qualidadeDaImagem(1280, 720)).toBe('720p');
    expect(qualidadeDaImagem(960, 540)).toBe('540p');
    expect(qualidadeDaImagem(854, 480)).toBe('480p');
    expect(qualidadeDaImagem(640, 360)).toBe('360p');
    expect(qualidadeDaImagem(426, 240)).toBe('240p');
    expect(qualidadeDaImagem(3840, 2160)).toBe('2160p');
    expect(qualidadeDaImagem(2560, 1440)).toBe('1440p');
  });

  it('4:3 e cinema digital', () => {
    expect(qualidadeDaImagem(960, 720)).toBe('720p');
    expect(qualidadeDaImagem(1440, 1080)).toBe('1080p');
    expect(qualidadeDaImagem(720, 576)).toBe('576p');
    expect(qualidadeDaImagem(640, 480)).toBe('480p');
    expect(qualidadeDaImagem(2048, 1080)).toBe('1080p'); // DCI 2K
    expect(qualidadeDaImagem(1998, 1080)).toBe('1080p');
    expect(qualidadeDaImagem(4096, 2160)).toBe('2160p'); // DCI 4K
  });

  it('cortes quebrados encaixam no degrau de perto; longe de todos fica a conta', () => {
    expect(qualidadeDaImagem(1916, 1036)).toBe('1080p');
    expect(qualidadeDaImagem(1904, 800)).toBe('1080p');
    expect(qualidadeDaImagem(1284, 722)).toBe('720p'); // Fonte 7 (Re:Zero) media 722p
    expect(qualidadeDaImagem(1778, 1000)).toBe('1000p');
  });

  it('vídeo em pé tem a mesma classe do deitado', () => {
    expect(qualidadeDaImagem(1080, 1920)).toBe('1080p');
    expect(qualidadeDaImagem(720, 1280)).toBe('720p');
  });

  it('sem largura usa só a altura; sem altura é vazio', () => {
    expect(qualidadeDaImagem(0, 804)).toBe('804p');
    expect(qualidadeDaImagem(undefined, 1080)).toBe('1080p');
    expect(qualidadeDaImagem(1920, 0)).toBe('');
    expect(qualidadeDaImagem(undefined, undefined)).toBe('');
    expect(classeDaImagem(-1, -1)).toBe(0);
    expect(classeDaImagem(Number.NaN, 720)).toBe(720);
  });
});
