// @vitest-environment happy-dom
/**
 * Wizard premium da calculadora (DOM): uma pergunta por vez, a cena do projeto ao lado reage ao tipo/
 * tamanho, vários ambientes recomendam o conjunto (multisplit/VRF), e o CTA captura o lead via a server
 * action. Erro do servidor fica na tela (sem sucesso). WhatsApp monta o link wa.me.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const acao = vi.hoisted(() => ({ enviarLead: vi.fn(async (_d: unknown) => ({ ok: true, codigo: "ORC-9", orcamentoId: "o1", clienteId: "c1", empresaId: "e1" })) }));
vi.mock("@/app/(publico)/calculadora/acao", () => ({ enviarLead: acao.enviarLead }));

let root: Root; let caixa: HTMLDivElement;
type Comp = typeof import("@/components/publico/calculadora-wizard").CalculadoraWizard;
let CalculadoraWizard: Comp;
beforeAll(async () => { ({ CalculadoraWizard } = await import("@/components/publico/calculadora-wizard")); }, 120_000);
beforeEach(() => { acao.enviarLead.mockClear(); acao.enviarLead.mockResolvedValue({ ok: true, codigo: "ORC-9", orcamentoId: "o1", clienteId: "c1", empresaId: "e1" }); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
function montar(props: Partial<Parameters<Comp>[0]> = {}) { caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa); act(() => root.render(createElement(CalculadoraWizard, props))); }
async function digitar(sel: string, v: string) {
  const el = $(sel) as HTMLInputElement | null; expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
const clicar = async (sel: string) => { const el = $(sel); expect(el, sel).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const forma = () => $("[data-cena-projeto]")!.getAttribute("data-forma");

/** Passa pelas 6 perguntas de um ambiente com área informada. */
async function preencherAmbiente(area: string, tipoSel?: string) {
  if (tipoSel) await clicar(tipoSel);
  await clicar("[data-continuar]"); // tipo -> tamanho
  await digitar("[data-amb-area]", area);
  await clicar("[data-continuar]"); // tamanho -> pessoas
  await clicar("[data-continuar]"); // pessoas -> sol
  await clicar("[data-continuar]"); // sol -> aparelhos
  await clicar("[data-continuar]"); // aparelhos -> cobertura
  await clicar("[data-continuar]"); // cobertura -> resultado
}

describe("Wizard da calculadora", () => {
  it("uma pergunta por vez; a cena reage ao tamanho (pequeno=parede, grande=teto); exige área", async () => {
    montar();
    expect($("[data-pergunta=tipo]")).toBeTruthy();
    expect($("[data-pergunta=tamanho]")).toBeNull();
    expect(forma()).toBe("hi-wall");
    await clicar("[data-continuar]"); // tipo -> tamanho
    // sem área, não avança e mostra erro
    await clicar("[data-continuar]");
    expect(txt($("[data-erro-wizard]"))).toMatch(/Informe a área/);
    await digitar("[data-amb-area]", "12");
    expect(forma()).toBe("hi-wall"); // 12 m² quarto = 7200 -> 9000 -> hi-wall
  });

  it("ambiente grande → cena no teto (cassete)", async () => {
    montar();
    // tipo galpão
    const chips = $$("[data-pergunta=tipo] [aria-pressed]");
    const galpao = chips.find((c) => txt(c) === "Galpão")!;
    await act(async () => { galpao.click(); }); await esperar();
    await clicar("[data-continuar]");
    await digitar("[data-amb-area]", "60"); // 60×900 = 54000 -> cassete (teto)
    expect(forma()).toBe("cassete");
  });

  it("fluxo completo de 1 ambiente: resultado com BTU + equipamento + pré-orçamento, e captura o lead", async () => {
    montar({ whatsapp: "62999990000" });
    await preencherAmbiente("18", undefined); // quarto 18 m²
    expect($("[data-fase-resultado]")).toBeTruthy();
    expect(txt($("[data-btu='0']"))).toMatch(/BTU\/h/);
    expect(txt($("[data-equip='0']"))).toContain("Split Hi-Wall");
    expect($("[data-pre-orcamento]")).toBeTruthy();
    expect($<HTMLAnchorElement>("[data-cta-whatsapp]")!.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5562999990000\?text=/);

    await clicar("[data-cta-orcamento]"); // -> lead
    await clicar("[data-enviar-lead]"); // sem nome
    expect(txt($("[data-erro-lead]"))).toMatch(/nome completo/);
    await digitar("[data-contato-nome]", "Carla Mendes");
    await digitar("[data-contato-whatsapp]", "62988887777");
    await digitar("[data-contato-email]", "carla@ex.com");
    await clicar("[data-enviar-lead]");
    await esperar();
    expect(acao.enviarLead).toHaveBeenCalledTimes(1);
    const enviado = acao.enviarLead.mock.calls[0][0] as any;
    expect(enviado).toMatchObject({ nome: "Carla Mendes", tipoUso: "Residencial" });
    expect(enviado.ambientes).toHaveLength(1);
    expect($("[data-sucesso-lead]")).toBeTruthy();
    expect(txt($("[data-sucesso-lead]"))).toContain("ORC-9");
  });

  it("vários ambientes: a cena mostra o conjunto e recomenda multisplit; o lead leva todos os ambientes", async () => {
    montar();
    await preencherAmbiente("15");
    await clicar("[data-adicionar-ambiente]");
    await preencherAmbiente("18");
    await clicar("[data-adicionar-ambiente]");
    await preencherAmbiente("20");
    expect($$("[data-ambiente-res]")).toHaveLength(3);
    expect(txt($("[data-conjunto]"))).toMatch(/Multisplit/);
    expect(forma()).toBe("multisplit");
    await clicar("[data-cta-orcamento]");
    await digitar("[data-contato-nome]", "João Souza");
    await digitar("[data-contato-whatsapp]", "62988887777");
    await digitar("[data-contato-email]", "joao@ex.com");
    await clicar("[data-enviar-lead]");
    await esperar();
    expect((acao.enviarLead.mock.calls[0][0] as any).ambientes).toHaveLength(3);
  });

  it("erro do servidor fica na tela, sem sucesso (lead não some)", async () => {
    acao.enviarLead.mockResolvedValue({ ok: false, erro: "Nenhum usuário ativo para atribuir o lead." } as any);
    montar();
    await preencherAmbiente("18");
    await clicar("[data-cta-orcamento]");
    await digitar("[data-contato-nome]", "Ana Lima");
    await digitar("[data-contato-whatsapp]", "62988887777");
    await digitar("[data-contato-email]", "ana@ex.com");
    await clicar("[data-enviar-lead]");
    expect(txt($("[data-erro-lead]"))).toContain("Nenhum usuário ativo");
    expect($("[data-sucesso-lead]")).toBeNull();
  });
});
