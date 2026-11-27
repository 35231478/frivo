// @vitest-environment happy-dom
/**
 * App de campo, leva 3 (PR B) — RELATÓRIO AO CLIENTE na TELA, num DOM de verdade:
 *  - app: concluída e sincronizada, "Enviar relatório pelo WhatsApp" (principal) e "Ver relatório (PDF)"; com a
 *    confirmação do cliente pendente, o WhatsApp vira secundário (um principal por vez); com gravação no aparelho,
 *    espera ("Relatório sai quando sincronizar", sem PDF incompleto); antes de concluir, nada;
 *  - página pública: materiais usados, a assinatura do cliente, um só botão principal (Baixar PDF) e o imprimir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { EnviarRelatorio } from "@/components/tecnico/relatorio-cliente";
import { AtividadeDocumento } from "@/components/relatorio/atividade-documento";
import { AcoesRelatorioAtividade } from "@/components/relatorio/acoes-relatorio-atividade";
import type { AceiteRetrato } from "@/lib/os/aceite";
import type { ExecucaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const REL = { link: "/relatorio/atividade/a1?t=TOKEN", empresa: "Polar Clima", osNumero: "OS-1301" };
const confirmado: AceiteRetrato = { situacao: "CONFIRMADO", nome: "Carla Mendes", confirmadoEm: "2026-11-27T15:00:00Z", osConcluida: true, ultimaDaOs: false };
const pendente: AceiteRetrato = { situacao: "PENDENTE", nome: null, confirmadoEm: null, osConcluida: true, ultimaDaOs: false };
const retrato = (x: Partial<RetratoAtividade> = {}) => ({ relatorio: REL, aceite: confirmado, whatsapp: "(11) 98765-4321", ...x }) as RetratoAtividade;
const tela = (status = "CONCLUIDA", x: Partial<ExecucaoTela> = {}) => ({ atividade: { id: "a1", titulo: "Preventiva", status, tipoOs: null }, ...x }) as ExecucaoTela;

let raiz: Root, el: HTMLElement;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); raiz = createRoot(el); });
afterEach(() => { act(() => raiz.unmount()); el.remove(); });
const montar = (r: RetratoAtividade, x: ExecucaoTela, aEnviar = 0) => act(() => raiz.render(createElement(EnviarRelatorio, { r, x, aEnviar })));
const q = (s: string) => el.querySelector<HTMLElement>(s);

describe("app: mandar o relatório ao cliente", () => {
  it("concluída e sincronizada: WhatsApp em destaque (com o número e a mensagem) e o PDF ao lado", () => {
    montar(retrato(), tela());
    expect(q("[data-enviar-relatorio]")!.getAttribute("data-enviar-relatorio")).toBe("pronto");
    const w = q("[data-whatsapp-relatorio]") as HTMLAnchorElement;
    expect(w.textContent).toContain("Enviar relatório pelo WhatsApp");
    expect(w.hasAttribute("data-principal")).toBe(true);
    expect(w.className).toContain("bg-success-600");
    const url = new URL(w.href);
    expect(url.origin + url.pathname).toBe("https://wa.me/5511987654321");
    const msg = url.searchParams.get("text")!;
    expect(msg).toBe(`Olá! Segue o relatório da visita técnica da Polar Clima (OS-1301): ${window.location.origin}/relatorio/atividade/a1?t=TOKEN`);
    expect(w.target).toBe("_blank");
    expect((q("[data-pdf-relatorio]") as HTMLAnchorElement).getAttribute("href")).toBe("/relatorio/atividade/a1/pdf?t=TOKEN");
    expect(q("[data-relatorio-aguardando]")).toBeNull();
  });

  it("confirmação do cliente pendente: ela é a principal; o WhatsApp fica secundário (contorno)", () => {
    montar(retrato({ aceite: pendente }), tela());
    const w = q("[data-whatsapp-relatorio]")!;
    expect(w.hasAttribute("data-principal")).toBe(false);
    expect(w.className).toContain("border-success-600");
    expect(w.className).not.toContain("bg-success-600");
  });

  it("depois que o cliente assina NESTE aparelho (ainda na fila), o WhatsApp volta a ser o principal", () => {
    montar(retrato({ aceite: pendente }), tela("CONCLUIDA", { aceiteLocal: { nome: "Carla Mendes", em: "2026-11-27T15:00:00Z" } }));
    expect(q("[data-whatsapp-relatorio]")!.hasAttribute("data-principal")).toBe(true);
  });

  it("com gravação desta OS no aparelho: espera a sincronização, sem link e sem PDF incompleto", () => {
    montar(retrato(), tela(), 2);
    expect(q("[data-enviar-relatorio]")!.getAttribute("data-enviar-relatorio")).toBe("aguardando");
    const b = q("[data-relatorio-aguardando]") as HTMLButtonElement;
    expect(b.textContent).toContain("Relatório sai quando sincronizar");
    expect(b.disabled).toBe(true);
    expect(q("[data-whatsapp-relatorio]")).toBeNull();
    expect(q("[data-pdf-relatorio]")).toBeNull();
  });

  it("sincronizou: o botão aparece sozinho (sem recarregar)", () => {
    montar(retrato(), tela(), 1);
    expect(q("[data-whatsapp-relatorio]")).toBeNull();
    montar(retrato(), tela(), 0);
    expect(q("[data-whatsapp-relatorio]")).not.toBeNull();
  });

  it("antes de concluir, ou sem relatório no retrato (retrato antigo), nada aparece", () => {
    montar(retrato(), tela("EM_ANDAMENTO"));
    expect(el.innerHTML).toBe("");
    montar(retrato({ relatorio: null }), tela());
    expect(el.innerHTML).toBe("");
    montar(retrato({ relatorio: undefined }), tela());
    expect(el.innerHTML).toBe("");
  });

  it("sem número do cliente, o WhatsApp abre para escolher o contato", () => {
    montar(retrato({ whatsapp: null } as Partial<RetratoAtividade>), tela());
    expect((q("[data-whatsapp-relatorio]") as HTMLAnchorElement).href.startsWith("https://wa.me/?text=")).toBe(true);
  });

  it("os botões têm alvo de toque de pelo menos 44 px (touch-target)", () => {
    montar(retrato(), tela());
    for (const s of ["[data-whatsapp-relatorio]", "[data-pdf-relatorio]"]) expect(q(s)!.className, s).toContain("touch-target");
  });
});

const empresa = { nome: "Polar Clima Ltda", nomeFantasia: "Polar Clima", cnpj: "12.345.678/0001-90", telefone: null, email: null, logo: null } as any;
const osDoc = { numero: "OS-1301", criadoEm: new Date("2026-11-20T12:00:00Z"), cliente: { nome: "Clínica Exemplo", nomeFantasia: null, cpfCnpj: "12345678000199" }, contrato: null } as any;
const doc = (x: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(AtividadeDocumento, {
  empresa, os: osDoc, numero: "REL-7", atividade: { titulo: "Preventiva mensal PMOC", tecnico: { nome: "Rafael Moura" }, tipoOs: null, respostas: [] } as any, equipamentos: [], ...x,
}));

describe("página pública do relatório da atividade", () => {
  it("materiais usados: descrição, equipamento e quantidade (sem valores)", () => {
    const html = doc({ materiais: [
      { id: "m1", descricao: "Fluido refrigerante R-410A", quantidade: 0.8, unidade: "kg", equipamento: "Split consultório 2" },
      { id: "m2", descricao: "Filtro de ar lavável", quantidade: 3, unidade: "un", equipamento: null },
    ] });
    const d = new DOMParser().parseFromString(html, "text/html");
    const itens = [...d.querySelectorAll("[data-material-relatorio]")].map((x) => x.textContent);
    expect(itens).toEqual(["Fluido refrigerante R-410A · Split consultório 20,8 kg", "Filtro de ar lavável3 un"]);
    expect(html).not.toMatch(/R\$/);
  });

  it("sem materiais, a seção não aparece", () => {
    expect(doc()).not.toContain("data-secao-materiais");
  });

  it("cliente que assinou no local: a assinatura, o nome e quando; confirmou pelo link: sem imagem", () => {
    const local = new DOMParser().parseFromString(doc({ aceite: { nome: "Carla Mendes", assinatura: "data:image/png;base64,AAA", confirmadoEm: new Date("2026-11-27T15:00:00Z"), noLocal: true } }), "text/html");
    expect(local.querySelector("[data-assinatura-atividade]")!.getAttribute("src")).toBe("data:image/png;base64,AAA");
    expect(local.querySelector("[data-aceite-atividade]")!.textContent).toMatch(/Carla Mendes.*Cliente · assinou no local em 27\/11\/2026 às \d\d:\d\d/);
    const link = new DOMParser().parseFromString(doc({ aceite: { nome: "Carla Mendes", assinatura: null, confirmadoEm: null, noLocal: false } }), "text/html");
    expect(link.querySelector("[data-assinatura-atividade]")).toBeNull();
    expect(link.querySelector("[data-aceite-atividade]")!.textContent).toContain("Cliente · confirmou pelo link");
    expect(doc()).not.toContain("data-aceite-atividade");
  });

  it("um só botão principal (Baixar PDF) e o imprimir secundário, que chama a impressão", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    act(() => raiz.render(createElement(AcoesRelatorioAtividade, { pdf: "/relatorio/atividade/a1/pdf?t=TOKEN" })));
    const baixar = q("[data-baixar-pdf]") as HTMLAnchorElement;
    expect(baixar.getAttribute("href")).toBe("/relatorio/atividade/a1/pdf?t=TOKEN");
    expect(baixar.className).toContain("bg-acento");
    const imprimir = q("[data-imprimir-relatorio]") as HTMLButtonElement;
    expect(imprimir.className).not.toContain("bg-acento");
    expect(q("[data-acoes-relatorio]")!.className).toContain("print-hide");
    act(() => imprimir.click());
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});
