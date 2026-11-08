// @vitest-environment happy-dom
/**
 * Calculadora de BTU pública (DOM de verdade): calcula ao digitar a área, valida o contato com
 * mensagem clara, e no "Solicitar orçamento" chama a server action e mostra o sucesso com o código.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const acao = vi.hoisted(() => ({ enviarLead: vi.fn(async (_d: unknown) => ({ ok: true, codigo: "ORC-9", orcamentoId: "o1", clienteId: "c1", empresaId: "e1" })) }));
vi.mock("@/app/(publico)/calculadora/acao", () => ({ enviarLead: acao.enviarLead }));

let root: Root; let caixa: HTMLDivElement;
type Comp = typeof import("@/components/publico/calculadora-btu").CalculadoraBtu;
let CalculadoraBtu: Comp;
beforeAll(async () => { ({ CalculadoraBtu } = await import("@/components/publico/calculadora-btu")); }, 120_000);
beforeEach(() => { acao.enviarLead.mockClear(); acao.enviarLead.mockResolvedValue({ ok: true, codigo: "ORC-9", orcamentoId: "o1", clienteId: "c1", empresaId: "e1" }); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
function montar() { caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa); act(() => root.render(createElement(CalculadoraBtu))); }
async function digitar(sel: string, v: string) {
  const el = $(sel) as HTMLInputElement | HTMLTextAreaElement | null; expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
const clicar = async (sel: string) => { const el = $(sel); expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

describe("Calculadora de BTU (pública)", () => {
  it("calcula o BTU ao digitar a área e soma o pré-orçamento", async () => {
    montar();
    expect($("[data-amb-resultado='0']")).toBeNull(); // sem área, sem resultado
    await digitar("[data-amb-area]", "20");
    expect(txt($("[data-amb-resultado='0']"))).toMatch(/12\.000 BTU\/h/); // 20m² quarto, 2 pessoas = 12000
    expect($("[data-pre-orcamento]")).not.toBeNull();
  });

  it("valida o contato com mensagem clara e só envia quando está tudo certo", async () => {
    montar();
    await digitar("[data-amb-area]", "20");
    await clicar("[data-solicitar-orcamento]");
    expect(txt($("[data-erro-lead]"))).toBe("Informe seu nome completo.");
    expect(acao.enviarLead).not.toHaveBeenCalled();

    await digitar("[data-contato-nome]", "Maria Silva");
    await clicar("[data-solicitar-orcamento]");
    expect(txt($("[data-erro-lead]"))).toMatch(/WhatsApp com DDD/);

    await digitar("[data-contato-whatsapp]", "62999887766");
    await clicar("[data-solicitar-orcamento]");
    expect(txt($("[data-erro-lead]"))).toMatch(/e-mail válido/);

    await digitar("[data-contato-email]", "maria@ex.com");
    await digitar("[data-contato-cidade]", "Goiânia");
    await clicar("[data-solicitar-orcamento]");
    await esperar();
    expect(acao.enviarLead).toHaveBeenCalledTimes(1);
    const enviado = acao.enviarLead.mock.calls[0][0] as any;
    expect(enviado).toMatchObject({ nome: "Maria Silva", whatsapp: "62999887766", email: "maria@ex.com", cidade: "Goiânia", tipoUso: "Residencial" });
    expect(enviado.ambientes[0]).toMatchObject({ btuRecomendado: 12000 });
    // sucesso com o código
    expect($("[data-sucesso-lead]")).not.toBeNull();
    expect(txt($("[data-sucesso-lead]"))).toContain("ORC-9");
  });

  it("sem área preenchida: pede a área e não envia", async () => {
    montar();
    await digitar("[data-contato-nome]", "Maria Silva");
    await digitar("[data-contato-whatsapp]", "62999887766");
    await digitar("[data-contato-email]", "maria@ex.com");
    await clicar("[data-solicitar-orcamento]");
    expect(txt($("[data-erro-lead]"))).toMatch(/Preencha a área/);
    expect(acao.enviarLead).not.toHaveBeenCalled();
  });

  it("erro do servidor fica na tela, sem mostrar sucesso (lead não perdido em silêncio)", async () => {
    acao.enviarLead.mockResolvedValue({ ok: false, erro: "Nenhum usuário ativo para atribuir o lead." } as any);
    montar();
    await digitar("[data-amb-area]", "15");
    await digitar("[data-contato-nome]", "João Souza");
    await digitar("[data-contato-whatsapp]", "62988776655");
    await digitar("[data-contato-email]", "joao@ex.com");
    await clicar("[data-solicitar-orcamento]");
    expect(txt($("[data-erro-lead]"))).toBe("Nenhum usuário ativo para atribuir o lead.");
    expect($("[data-sucesso-lead]")).toBeNull();
  });
});
