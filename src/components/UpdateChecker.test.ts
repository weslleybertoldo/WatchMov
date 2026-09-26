import { describe, it, expect } from "vitest";
import { isNewerVersion } from "./UpdateChecker";

describe("isNewerVersion", () => {
  it("detects minor bump", () => {
    expect(isNewerVersion("2.6", "2.5")).toBe(true);
  });
  it("detects patch bump", () => {
    expect(isNewerVersion("2.5.1", "2.5")).toBe(true);
  });
  it("returns false on equal", () => {
    expect(isNewerVersion("2.5", "2.5")).toBe(false);
  });
  // Renumeração (3.102 -> 3.2): quem manda é a DATA do release, senão o app fica
  // preso achando que está em dia só porque "3.2" é numericamente menor.
  it("accepts renumbered release when it is more recent", () => {
    expect(isNewerVersion("3.2", "3.102", "2026-08-09T01:00:00Z", "2026-08-08T20:00:00Z")).toBe(true);
  });
  it("refuses an older release even with a bigger number", () => {
    expect(isNewerVersion("3.102", "3.2", "2026-08-08T20:00:00Z", "2026-08-09T01:00:00Z")).toBe(false);
  });
  it("falls back to numbers without dates", () => {
    expect(isNewerVersion("3.3", "3.2")).toBe(true);
    expect(isNewerVersion("3.1", "3.2")).toBe(false);
  });
  it("ignores the v prefix and spaces", () => {
    expect(isNewerVersion(" v2.5 ", "2.5")).toBe(false);
  });
  it("returns false without a remote version", () => {
    expect(isNewerVersion("", "2.5")).toBe(false);
  });
});

import { checkErrorMessage } from "./UpdateChecker";

describe("checkErrorMessage — verificação falhou (nunca vira 'está atualizado')", () => {
  it("403 e 429 = limite da API do GitHub, com dica de esperar", () => {
    expect(checkErrorMessage(403)).toMatch(/minutos/i);
    expect(checkErrorMessage(429)).toMatch(/minutos/i);
  });
  it("5xx = falha do servidor", () => {
    expect(checkErrorMessage(500)).toMatch(/servidor/i);
    expect(checkErrorMessage(503)).toMatch(/servidor/i);
  });
  it("outro status = não consegui verificar", () => {
    expect(checkErrorMessage(404)).toMatch(/não consegui/i);
  });
  it("sem status (rede/DNS) = sem conexão", () => {
    expect(checkErrorMessage()).toMatch(/conex/i);
  });
});

import { permissionHint } from "./UpdateChecker";

describe("permissionHint — o que fazer depois de abrir as configurações", () => {
  it("Fire TV: aponta o item da tela que abre (Opções para desenvolvimento)", () => {
    expect(permissionHint(true, true)).toMatch(/Instalar aplicativos desconhecidos/);
    expect(permissionHint(true, true)).toMatch(/Tentar novamente/);
  });
  it("TV sem ser Fire TV: fala de apertar, não de tocar", () => {
    expect(permissionHint(true, false)).toMatch(/aperte/i);
    expect(permissionHint(true, false)).not.toMatch(/toque/i);
  });
  it("celular: texto de sempre", () => {
    expect(permissionHint(false, false)).toMatch(/toque em baixar novamente/);
  });
});
