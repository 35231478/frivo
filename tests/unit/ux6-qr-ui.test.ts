// @vitest-environment happy-dom
/**
 * UX-6 "QR completo" — a página pública num DOM de verdade:
 *  - Y15: campos com LABEL de verdade e telefone com type=tel (teclado numérico no celular);
 *  - Y14: fechar ou alternar chamado↔orçamento NÃO descarta o rascunho; com o formulário
 *    aberto o botão do tipo ativo some (fica um chamado à ação só);
 *  - C2: dá para anexar foto (comprimida no navegador) e ela vai no POST;
 *  - Y17: a confirmação mostra o protocolo com botão COPIAR e diz o próximo passo;
 *  - G6: a tela de etiqueta não encontrada orienta em vez do 404 cru.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/imagem-cliente", () => ({
  FOTO_GALERIA: { ladoMax: 1280, qualidade: 0.8 },
  reduzirImagem: vi.fn(async () => ({ imagem: { dataUrl: "data:image/jpeg;base64,Zm90bw==", largura: 10, altura: 10, bytes: 4 } })),
}));

let root: Root; let caixa: HTMLDivElement;
const esperar = async (n = 4) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const digitar = async (el: Element | null, valor: string) => {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
  await act(async () => { el!.dispatchEvent(new Event("input", { bubbles: true })); });
};

async function montar(el: any) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const DADOS = {
  token: "tok-ux6",
  empresaNome: "Clima Total", logo: null, boasVindas: "", cor: "#0EA5E9",
  equipamento: { nome: "Daikin FTX", tipo: "Split", marca: "Daikin", modelo: "FTX", numeroSerie: null },
  localizacao: null, historico: [], historicoOculto: false, linkEquipe: null, proxima: null,
  botoes: { whatsapp: null, site: null, chamado: "form" as const, orcamento: "form" as const },
};

async function montarQr() {
  const { QrPublicoClient } = await import("@/components/public/qr-publico-client");
  await montar(createElement(QrPublicoClient, { dados: DADOS }));
}
const campo = (rotulo: string) =>
  $$("label").find((l) => l.textContent?.includes(rotulo))?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | undefined;

describe("UX-6: formulário do QR", () => {
  it("Y15: labels de verdade e telefone com type=tel", async () => {
    await montarQr();
    await clicar($("[data-abrir-chamado]"));
    expect(campo("Seu nome")).toBeTruthy();
    expect(campo("Descreva o problema")).toBeTruthy();
    const tel = campo("Telefone / WhatsApp") as HTMLInputElement;
    expect(tel.type).toBe("tel");
    expect((campo("E-mail") as HTMLInputElement).type).toBe("email");
  });

  it("Y14: rascunho sobrevive a fechar e a alternar o tipo; botão do tipo aberto some", async () => {
    await montarQr();
    await clicar($("[data-abrir-chamado]"));
    await digitar(campo("Descreva o problema")!, "Pingando água na recepção");
    await digitar(campo("Seu nome")!, "Visitante");
    // CTA único: com o form de chamado aberto, "Abrir chamado" some (sobra o Enviar do form)
    expect($("[data-abrir-chamado]")).toBeNull();
    expect($("[data-abrir-orcamento]")).not.toBeNull();

    // Fechar pelo X e reabrir: o texto continua lá
    await clicar($('[data-form-qr] button[aria-label="Fechar formulário"]'));
    expect($("[data-abrir-chamado]")).not.toBeNull();
    await clicar($("[data-abrir-chamado]"));
    expect((campo("Descreva o problema") as HTMLTextAreaElement).value).toBe("Pingando água na recepção");

    // Alternar para orçamento: campos comuns preservados, título muda
    await clicar($("[data-abrir-orcamento]"));
    expect((campo("Seu nome") as HTMLInputElement).value).toBe("Visitante");
    expect($("[data-form-qr]")!.textContent).toContain("Solicitar orçamento");
  });

  it("C2 + Y17: foto vai no POST; confirmação tem protocolo, botão copiar e o próximo passo", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ chamadoNumero: "CHM-2026-0042" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const escreveu: string[] = [];
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: async (t: string) => { escreveu.push(t); } } });

    await montarQr();
    await clicar($("[data-abrir-chamado]"));
    await digitar(campo("Seu nome")!, "Visitante");
    await digitar(campo("Descreva o problema")!, "Painel apitando sem parar");

    // Anexa uma foto (reduzirImagem mockada) e o thumbnail aparece
    const arquivo = $<HTMLInputElement>('[data-form-qr] input[type="file"]');
    expect(arquivo).toBeTruthy();
    const file = new File(["x"], "painel.jpg", { type: "image/jpeg" });
    Object.defineProperty(arquivo!, "files", { value: [file] });
    await act(async () => { arquivo!.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    expect($$("[data-foto-qr]")).toHaveLength(1);

    await clicar($$('[data-form-qr] button[type="submit"]').at(0));
    const corpo = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(corpo.fotos).toHaveLength(1);
    expect(corpo.fotos[0].conteudo).toContain("data:image/jpeg");

    // Confirmação que não é beco sem saída
    expect($("[data-protocolo]")!.textContent).toBe("CHM-2026-0042");
    expect($("[data-confirmacao-qr]")!.textContent).toContain("entra em contato");
    await clicar($("[data-copiar-protocolo]"));
    expect(escreveu).toEqual(["CHM-2026-0042"]);
  });
});

describe("UX-6 (G6): etiqueta não encontrada", () => {
  it("orienta a pessoa em vez do 404 cru", async () => {
    const { default: QrNaoEncontrado } = await import("@/app/(publico)/qr/[token]/not-found");
    await montar(createElement(QrNaoEncontrado));
    expect(caixa.textContent).toContain("Etiqueta não encontrada");
    expect(caixa.textContent).toContain("empresa responsável pela manutenção");
  });
});
