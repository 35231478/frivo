// @vitest-environment happy-dom
/**
 * Leva 2 — I14: o formulário de chamado do portal COMPRIME as fotos (reduzirImagem) antes de
 * enviar — uma foto de celular com vários MB vira um JPEG reduzido, e é o reduzido que vai no POST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/imagem-cliente", () => ({
  FOTO_GALERIA: { ladoMax: 1280, qualidade: 0.8 },
  reduzirImagem: vi.fn(async () => ({ imagem: { dataUrl: "data:image/jpeg;base64,REDUZIDA", largura: 10, altura: 10, bytes: 42 }, qualidade: "BOA" })),
}));

const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

let caixa: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  caixa = document.createElement("div"); document.body.appendChild(caixa);
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

describe("I14 — chamado-form comprime as fotos antes de enviar", () => {
  it("usa reduzirImagem e envia o data URL reduzido, não o arquivo original", async () => {
    const { ChamadoForm } = await import("@/components/portal/chamado-form");
    const { reduzirImagem } = await import("@/lib/imagem-cliente");

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "os-x" }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    root = createRoot(caixa);
    await act(async () => { root.render(createElement(ChamadoForm, { unidades: [], equipamentos: [], tiposProblema: [] })); });

    const input = caixa.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array(1024)], "foto-celular.jpg", { type: "image/jpeg" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(reduzirImagem).toHaveBeenCalled();

    const textarea = caixa.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set;
      setter?.call(textarea, "Problema no equipamento da sala 2");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => { caixa.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();

    expect(fetchMock).toHaveBeenCalled();
    const corpo = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(corpo.fotos).toHaveLength(1);
    expect(corpo.fotos[0].conteudo).toBe("data:image/jpeg;base64,REDUZIDA"); // o reduzido, não o original
    expect(corpo.fotos[0].tamanho).toBe(42);
  });
});
