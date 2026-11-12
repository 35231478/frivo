// @vitest-environment happy-dom
/**
 * Página "App do colaborador" (Equipes): as 8 chaves em 3 seções, os sub-itens da marca d'água que
 * aparecem só com ela ligada, e o salvar que manda as colunas app* para /api/configuracoes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

let root: Root; let caixa: HTMLDivElement;
let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  fetchFalso = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchFalso);
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const $ = <T extends Element = HTMLElement>(s: string) => caixa.querySelector(s) as T | null;
const $$ = (s: string) => [...caixa.querySelectorAll(s)] as HTMLElement[];
const esperar = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
/** O switch (role=switch) do toggle cujo rótulo contém o texto. */
const switchDe = (texto: string): HTMLButtonElement | null => ($$("label").find((l) => l.textContent?.includes(texto))?.querySelector("button[role=switch]") ?? null) as HTMLButtonElement | null;

async function montar(inicial = CONFIG_APP_PADRAO) {
  const { AppColaboradorClient } = await import("@/components/equipes/app-colaborador-client");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(AppColaboradorClient, { inicial })); });
  await esperar();
}

describe("Página App do colaborador", () => {
  it("as 3 seções e os 8 toggles principais estão na tela", async () => {
    await montar();
    expect(caixa.textContent).toContain("Privacidade e comercial");
    expect(caixa.textContent).toContain("Execução e prova");
    expect(caixa.textContent).toContain("Dispositivo");
    for (const rotulo of [
      "Exibir dados do cliente no app", "Exibir contatos do cliente no app", "Esconder valor de produtos e serviços",
      "Marca d'água nas fotos", "Exigir localização ativa para usar o app", "Foto somente pela câmera",
      "Campo de conclusão obrigatório", "Apenas um dispositivo ativo por colaborador",
    ]) expect(switchDe(rotulo), rotulo).toBeTruthy();
  });

  it("os sub-itens da marca d'água só aparecem com ela ligada", async () => {
    await montar(); // marcaDagua ligada por padrão
    expect($("[data-marca-dagua-itens]")).not.toBeNull();
    expect($("[data-marca-dagua-itens]")!.textContent).toContain("Data e hora");
    expect(switchDe("Identificador da OS")).toBeTruthy();
    await clicar(switchDe("Marca d'água nas fotos")); // desliga
    expect($("[data-marca-dagua-itens]")).toBeNull();
  });

  it("Salvar manda as colunas app* para /api/configuracoes (PUT), com a mudança feita", async () => {
    await montar();
    await clicar(switchDe("Esconder valor de produtos e serviços")); // true → false
    await clicar(switchDe("Foto somente pela câmera")); // false → true
    await clicar($("[data-salvar]"));
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe("/api/configuracoes");
    expect(init.method).toBe("PUT");
    const corpo = JSON.parse(init.body);
    expect(corpo).toMatchObject({ appEsconderValores: false, appFotoSomenteCamera: true, appUmDispositivo: true, appExibirDadosCliente: true });
    // só colunas app* no corpo (não vaza id/empresaId)
    expect(Object.keys(corpo).every((k) => k.startsWith("app"))).toBe(true);
    expect($("[data-sucesso]")).not.toBeNull();
    expect(refresh).toHaveBeenCalled();
  });
});
