import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// O estado de device.ts é do módulo (o aparelho não muda): cada teste importa de novo.
const native = { on: true };
const get = vi.fn();
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.on },
  registerPlugin: () => ({ get }),
}));

async function load() {
  vi.resetModules();
  return import("./device");
}

describe("device (TV ou celular)", () => {
  beforeEach(() => { native.on = true; get.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("celular por padrão, antes de perguntar ao nativo", async () => {
    const d = await load();
    expect(d.isTv()).toBe(false);
  });

  it("TV quando o nativo diz que é TV", async () => {
    get.mockResolvedValue({ tv: true });
    const d = await load();
    await d.initDevice();
    expect(d.isTv()).toBe(true);
  });

  it("celular quando o nativo diz que não é TV", async () => {
    get.mockResolvedValue({ tv: false });
    const d = await load();
    await d.initDevice();
    expect(d.isTv()).toBe(false);
  });

  it("no navegador nem pergunta (site na Vercel)", async () => {
    native.on = false;
    const d = await load();
    await d.initDevice();
    expect(get).not.toHaveBeenCalled();
    expect(d.isTv()).toBe(false);
  });

  it("nativo não respondeu no prazo: segue como celular (não trava a abertura)", async () => {
    vi.useFakeTimers();
    get.mockReturnValue(new Promise(() => {}));
    const d = await load();
    const p = d.initDevice(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(d.isTv()).toBe(false);
  });

  it("nativo falhou: segue como celular", async () => {
    get.mockRejectedValue(new Error("not implemented"));
    const d = await load();
    await d.initDevice();
    expect(d.isTv()).toBe(false);
  });

  it("Fire TV = TV da Amazon", async () => {
    get.mockResolvedValue({ tv: true, brand: "Amazon", model: "AFTSSS" });
    const d = await load();
    await d.initDevice();
    expect(d.isFireTv()).toBe(true);
    expect(d.tvDeviceInfo().name).toBe("Fire TV");
  });

  it("TV Android de outra marca não é Fire TV", async () => {
    get.mockResolvedValue({ tv: true, brand: "Amlogic", model: "t950s" });
    const d = await load();
    await d.initDevice();
    expect(d.isFireTv()).toBe(false);
    expect(d.tvDeviceInfo().name).toBe("TV Android");
  });
});
