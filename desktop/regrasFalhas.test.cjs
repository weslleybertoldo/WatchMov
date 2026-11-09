// Testes das quedas do app do Windows que vão pra aba Bugs (regrasFalhas.ts, compilado em out/). Rodar: npm run testar.
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./out/regrasFalhas.js');

test('janela que caiu vira a linha da aba Bugs; saída normal não', () => {
  assert.deepEqual(r.falhaDoProcesso('janela', { reason: 'crashed', exitCode: -1073741819 }, 10),
    { ts: 10, reason: 5, cause: 'A janela do app caiu (erro) · código -1073741819' });
  assert.deepEqual(r.falhaDoProcesso('janela', { reason: 'oom', exitCode: 0 }, 11),
    { ts: 11, reason: 3, cause: 'A janela do app caiu por falta de memória' });
  assert.equal(r.falhaDoProcesso('janela', { reason: 'clean-exit', exitCode: 0 }, 12), null);
  assert.equal(r.falhaDoProcesso('janela', {}, 12), null);
  assert.equal(r.falhaDoProcesso('janela', { reason: 'killed' }, 13).reason, 2);
  assert.equal(r.falhaDoProcesso('janela', { reason: 'abnormal-exit', exitCode: 1 }, 14).cause, 'A janela do app fechou (abnormal-exit) · código 1');
});

test('processo filho: GPU e auxiliar com o nome do serviço', () => {
  assert.equal(r.falhaDoProcesso('filho', { type: 'GPU', reason: 'crashed', exitCode: 5 }, 1).cause, 'Processo de vídeo (GPU) caiu (erro) · código 5');
  assert.equal(r.falhaDoProcesso('filho', { type: 'Utility', name: 'Audio Service', reason: 'crashed' }, 1).cause, 'Processo auxiliar (Audio Service) caiu (erro)');
  assert.equal(r.falhaDoProcesso('filho', { type: 'Zygote', reason: 'launch-failed' }, 1).cause, 'Processo Zygote não conseguiu abrir');
});

test('travou e erro solto do processo principal', () => {
  assert.deepEqual(r.falhaTravou(5), { ts: 5, reason: 6, cause: 'A janela do app travou (não respondeu)' });
  assert.equal(r.falhaDoErro(new TypeError('x is not a function\n    at a.js:1'), 6).cause, 'Erro no app: TypeError: x is not a function');
  assert.equal(r.falhaDoErro('texto', 6).reason, 4);
});

test('lista: mais velha primeiro, teto de 50, confirmar até um momento, arquivo estragado', () => {
  let l = [];
  for (let i = 60; i >= 1; i--) l = r.juntarFalha(l, { ts: i, reason: 4, cause: String(i) });
  assert.equal(l.length, r.MAX_FALHAS);
  assert.equal(l[0].ts, 11);
  assert.equal(l.at(-1).ts, 60);
  assert.deepEqual(r.confirmarAte(l, 58).map((f) => f.ts), [59, 60]);
  assert.deepEqual(r.lerFalhas('[{"ts":1,"reason":4,"cause":"a"},{"ts":"x"},null]'), [{ ts: 1, reason: 4, cause: 'a' }]);
  assert.deepEqual(r.lerFalhas('{"ts":1}'), []);
  assert.deepEqual(r.lerFalhas('não é json'), []);
});
