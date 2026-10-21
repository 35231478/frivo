// @vitest-environment happy-dom
/**
 * Configurações › Impressão da OS — a tela num DOM de verdade (happy-dom), API simulada:
 *  - ligar/desligar a seção e escolher "Cliente vê" × "Só interno" muda os contadores das versões;
 *  - seção desligada trava a escolha de quem vê;
 *  - Salvar envia a config inteira; erro da API aparece; "Restaurar padrão" volta tudo;
 *  - sem permissão de gerenciar: tudo travado, sem Salvar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CONFIG_RELATORIO_PADRAO } from "@/lib/relatorio-os/config";

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: unknown };
const enviados: { url: string; metodo: string; corpo: any }[] = [];

beforeEach(() => {
  enviados.length = 0;
  resposta = { status: 200, corpo: {} };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    enviados.push({ url, metodo: String(init.method), corpo: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

async function montar(podeEditar = true, inicial = CONFIG_RELATORIO_PADRAO) {
  const { ImpressaoOsClient } = await import("@/components/config/impressao-os-client");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(ImpressaoOsClient, { inicial, podeEditar })); });
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const linha = (id: string) => $(`[data-secao="${id}"]`)!;
const chave = (id: string) => linha(id).querySelector('[role="switch"]') as HTMLButtonElement;
const quem = (id: string, q: "cliente" | "interno") => linha(id).querySelector(`[data-quem="${q}"]`) as HTMLButtonElement;
const contas = () => [$("[data-conta=cliente]")!.textContent, $("[data-conta=interna]")!.textContent];
const botao = (t: string) => [...caixa.querySelectorAll("button")].find((b) => b.textContent?.trim() === t) ?? null;

describe("tela Impressão da OS", () => {
  it("mudar quem vê e ligar/desligar atualiza os contadores; salvar envia tudo", async () => {
    await montar();
    expect(contas()).toEqual(["9", "11"]);
    expect(quem("tempos", "interno").getAttribute("aria-checked")).toBe("true");
    await clicar(quem("tempos", "cliente"));
    expect(contas()).toEqual(["10", "11"]);
    await clicar(quem("fotos", "interno"));
    expect(contas()).toEqual(["9", "11"]);
    await clicar(chave("equipe"));
    expect(chave("equipe").getAttribute("aria-checked")).toBe("false");
    expect(contas()).toEqual(["8", "10"]);
    expect(quem("equipe", "cliente").disabled).toBe(true); // desligada: escolha travada
    await clicar(botao("Salvar"));
    expect(enviados).toEqual([{ url: "/api/configuracoes/impressao-os", metodo: "PUT", corpo: {
      ...CONFIG_RELATORIO_PADRAO,
      tempos: { ativo: true, cliente: true }, fotos: { ativo: true, cliente: false }, equipe: { ativo: false, cliente: true },
    } }]);
    expect($('[role="status"]')!.textContent).toContain("Configuração salva.");
  });

  it("erro da API aparece; restaurar padrão volta tudo", async () => {
    await montar(true, { ...CONFIG_RELATORIO_PADRAO, fotos: { ativo: false, cliente: true } });
    expect(contas()).toEqual(["8", "10"]);
    resposta = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar(botao("Salvar"));
    expect($('[role="alert"]')!.textContent).toBe("Sem permissão para esta ação");
    await clicar(botao("Restaurar padrão"));
    expect(contas()).toEqual(["9", "11"]);
    expect($('[role="alert"]')).toBeNull();
  });

  it("sem permissão de gerenciar: tudo travado e sem Salvar", async () => {
    await montar(false);
    expect(chave("fotos").disabled).toBe(true);
    expect(quem("fotos", "interno").disabled).toBe(true);
    expect(botao("Salvar")).toBeNull();
    expect($("[data-somente-leitura]")).not.toBeNull();
    await clicar(chave("fotos"));
    expect(contas()).toEqual(["9", "11"]);
  });
});
