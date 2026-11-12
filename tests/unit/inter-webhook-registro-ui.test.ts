// @vitest-environment happy-dom
/**
 * Tela do Inter — ao gerar a URL do webhook, o resultado do registro automático no Inter
 * aparece com clareza: sucesso (caixa verde "registrada no Inter") ou PENDÊNCIA (caixa
 * vermelha com o motivo exato devolvido pelo servidor). A URL continua sendo exibida
 * uma única vez nos dois casos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

const GET_PADRAO = {
  ativo: true, ambiente: "SANDBOX", clientId: "cid", contaCorrente: "", pixChave: "",
  temClientSecret: true, temCertificado: true, temChavePrivada: true, temWebhookSecret: false,
};

let caixa: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  caixa = document.createElement("div"); document.body.appendChild(caixa);
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

async function montarEGerar(respostaPut: Record<string, unknown>) {
  const { InterConfigClient } = await import("@/components/config/inter-config-client");
  const fetchMock = vi.fn(async (_url: any, init?: any) => {
    const corpo = init?.method === "PUT" ? respostaPut : GET_PADRAO;
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);

  root = createRoot(caixa);
  await act(async () => { root.render(createElement(InterConfigClient)); });
  await flush();
  const botao = caixa.querySelector("[data-gerar-webhook]") as HTMLButtonElement;
  await act(async () => { botao.click(); });
  await flush();
}

describe("Inter — resultado do registro automático do webhook na tela", () => {
  it("registro OK: mostra a URL e a confirmação 'registrada no Inter', sem aviso de pendência", async () => {
    await montarEGerar({ ok: true, webhookUrl: "https://app.x/api/webhooks/inter?token=abc", registradoNoInter: true, registroPendente: null });

    expect(caixa.querySelector("[data-webhook-url]")?.textContent).toContain("token=abc");
    expect(caixa.querySelector("[data-webhook-registrado]")?.textContent).toContain("registrada no Inter");
    expect(caixa.querySelector("[data-webhook-pendente]")).toBeNull();
  });

  it("registro FALHOU: mostra a URL e o aviso de pendência com o MOTIVO devolvido pelo servidor", async () => {
    await montarEGerar({
      ok: true, webhookUrl: "https://app.x/api/webhooks/inter?token=def",
      registradoNoInter: false, registroPendente: "Falha ao configurar webhook (401): credencial inválida",
    });

    expect(caixa.querySelector("[data-webhook-url]")?.textContent).toContain("token=def");
    const pendente = caixa.querySelector("[data-webhook-pendente]");
    expect(pendente?.textContent).toContain("PENDENTE");
    expect(pendente?.textContent).toContain("Falha ao configurar webhook (401): credencial inválida");
    expect(caixa.querySelector("[data-webhook-registrado]")).toBeNull();
  });

  it("pré-condição faltando: o motivo nomeia o que falta (ex.: integração desativada)", async () => {
    await montarEGerar({
      ok: true, webhookUrl: "https://app.x/api/webhooks/inter?token=ghi",
      registradoNoInter: false, registroPendente: "a integração está desativada",
    });
    expect(caixa.querySelector("[data-webhook-pendente]")?.textContent).toContain("a integração está desativada");
  });
});
