// @vitest-environment happy-dom
/**
 * D1 — PAUSAR / IMPEDIMENTO nas telas (componentes de verdade): o botão só na atividade em andamento; o modal com os
 * motivos da empresa (motivo obrigatório; "Outro" pede o texto); a faixa "Pausada — motivo — há X" com Retomar e,
 * no impedimento, "Encerrar a visita: não concluída" (com confirmação). E o escritório: OS, lista, Pendências,
 * relatório interno (o cliente nunca vê).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o: unknown) => true) }));
vi.mock("@/components/ui/avisos", () => ({ toast: avisos.toast, confirmar: avisos.confirmar }));
const lerArq = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
// A câmera do app depende do contexto do aparelho: aqui, um botão que "tira" uma foto fictícia
vi.mock("@/components/tecnico/captura", async () => {
  const { createElement: h } = await import("react");
  return {
    BotaoFoto: (p: { onFoto: (d: string) => void; rotulo?: string }) => h("button", { type: "button", "data-botao-foto": "", onClick: () => p.onFoto("data:image/jpeg;base64,Zm90bw==") }, p.rotulo),
    Miniatura: (p: { alt: string; onRemover?: () => void }) => h("button", { type: "button", "data-miniatura": p.alt, onClick: p.onRemover }, p.alt),
  };
});

let root: Root | null = null;
let caixa: HTMLDivElement | null = null;
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const esperar = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root!.render(el); });
  await act(async () => { await esperar(); });
}
async function clicar(el: Element | null) { await act(async () => { (el as HTMLElement).click(); await esperar(); }); }
async function digitar(el: Element | null, v: string) {
  await act(async () => {
    const i = el as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(i, v);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar();
  });
}
beforeEach(() => { avisos.confirmar.mockReset(); avisos.confirmar.mockImplementation(async () => true); avisos.toast.mockClear(); });
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; document.body.innerHTML = ""; });

const MOTIVOS = [
  { id: "m1", nome: "Falta de peça/material", tipo: "IMPEDIMENTO", pedeTexto: false },
  { id: "m6", nome: "Almoço/intervalo", tipo: "INTERVALO", pedeTexto: false },
  { id: "m7", nome: "Outro", tipo: "IMPEDIMENTO", pedeTexto: true },
] as const;
const tela = (extra: Record<string, unknown> = {}) => ({ atividade: { id: "a1", titulo: "Visita", status: "EM_ANDAMENTO", tipoOs: null }, bloqueada: false, equipamentos: [], adicionais: [], ...extra }) as any;

describe("app: pausar", () => {
  it("o botão só aparece em andamento, sem pausa aberta e sem só-leitura", async () => {
    const { BotaoPausar } = await import("@/components/tecnico/pausa");
    for (const [x, aparece] of [[tela(), true], [tela({ atividade: { id: "a1", titulo: "", status: "AGENDADA", tipoOs: null } }), false], [tela({ pausa: { clientId: "c", motivo: "x", impedimento: true, inicio: new Date().toISOString() } }), false], [tela({ bloqueada: true }), false]] as const) {
      await montar(createElement(BotaoPausar, { r: { motivosPausa: MOTIVOS } as any, x, registrar: vi.fn() }));
      expect(!!$("[data-pausar]")).toBe(aparece);
      await act(async () => root?.unmount()); caixa?.remove();
    }
  });

  it("modal: motivo obrigatório (diz o que falta); escolher e pausar grava a operação com o motivo do cadastro", async () => {
    const { BotaoPausar } = await import("@/components/tecnico/pausa");
    const registrar = vi.fn(async () => {});
    await montar(createElement(BotaoPausar, { r: { motivosPausa: MOTIVOS } as any, x: tela(), registrar }));
    await clicar($("[data-pausar]"));
    const opcoes = $$("[data-motivo-pausa]");
    expect(opcoes.map((b) => b.getAttribute("data-motivo-pausa"))).toEqual(["Falta de peça/material", "Almoço/intervalo", "Outro"]);
    expect(opcoes.every((b) => b.className.includes("min-h-[48px]"))).toBe(true);
    expect($("[data-motivo-pausa='Almoço/intervalo']")!.textContent).toContain("Intervalo");
    expect($("[data-motivo-pausa='Falta de peça/material']")!.textContent).toContain("Avisa o escritório");
    expect(($("[data-confirmar-pausa]") as HTMLButtonElement).disabled).toBe(true);
    expect($("[data-falta-pausa]")!.textContent).toBe("Escolha o motivo da pausa.");
    await clicar($("[data-motivo-pausa='Falta de peça/material']"));
    expect($("[data-motivo-pausa='Falta de peça/material']")!.getAttribute("aria-checked")).toBe("true");
    await digitar($("[data-observacao-pausar]"), "peça chega amanhã");
    await clicar($("[data-confirmar-pausa]"));
    expect(registrar).toHaveBeenCalledTimes(1);
    const [ops] = registrar.mock.calls[0] as unknown as [any[]];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ tipo: "pausar", atividadeId: "a1", dados: { motivoId: "m1", motivo: "Falta de peça/material", impedimento: true, observacao: "peça chega amanhã" } });
    expect(ops[0].dados.clientId).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(avisos.toast).toHaveBeenCalledWith("Atividade pausada. O escritório vai ser avisado.");
    expect($("[data-modal-pausar]")).toBeNull(); // fechou
  });

  it("'Outro' pede o texto antes de pausar; intervalo não 'avisa o escritório'", async () => {
    const { BotaoPausar } = await import("@/components/tecnico/pausa");
    const registrar = vi.fn(async () => {});
    await montar(createElement(BotaoPausar, { r: { motivosPausa: MOTIVOS } as any, x: tela(), registrar }));
    await clicar($("[data-pausar]"));
    await clicar($("[data-motivo-pausa='Outro']"));
    expect($("[data-falta-pausa]")!.textContent).toBe("Escreva o motivo (pelo menos 3 letras).");
    expect(($("[data-confirmar-pausa]") as HTMLButtonElement).disabled).toBe(true);
    await digitar($("[data-observacao-pausar]"), "Portão trancado");
    expect($("[data-falta-pausa]")).toBeNull();
    await clicar($("[data-motivo-pausa='Almoço/intervalo']"));
    // foto opcional: vai para as fotos do serviço, com a legenda da pausa (um jeito só)
    expect($("[data-botao-foto]")!.textContent).toBe("Foto (opcional)");
    await clicar($("[data-botao-foto]"));
    expect($("[data-miniatura='foto da pausa']")).not.toBeNull();
    await clicar($("[data-confirmar-pausa]"));
    const [ops] = registrar.mock.calls[0] as unknown as [any[]];
    expect(ops[0].dados).toMatchObject({ motivo: "Almoço/intervalo", impedimento: false, observacao: "Portão trancado" });
    expect(ops[1]).toMatchObject({ tipo: "fotoOs", atividadeId: "a1", dados: { dataUrl: "data:image/jpeg;base64,Zm90bw==", equipamentoId: null, legenda: "Pausa — Almoço/intervalo" } });
    expect(ops[1].dados.clientId).not.toBe(ops[0].dados.clientId);
    expect(avisos.toast).toHaveBeenCalledWith("Atividade pausada.");
  });

  it("retrato antigo (sem a lista): os padrões, mandados sem id (o servidor confere pelo nome)", async () => {
    const { motivosDoRetrato } = await import("@/components/tecnico/pausa");
    const ms = motivosDoRetrato({} as any);
    expect(ms).toHaveLength(7);
    expect(ms[0]).toEqual({ id: "padrao:Falta de peça/material", nome: "Falta de peça/material", tipo: "IMPEDIMENTO", pedeTexto: false });
    expect(motivosDoRetrato({ motivosPausa: MOTIVOS } as any)).toBe(MOTIVOS);
    const { BotaoPausar } = await import("@/components/tecnico/pausa");
    const registrar = vi.fn(async () => {});
    await montar(createElement(BotaoPausar, { r: {} as any, x: tela(), registrar }));
    await clicar($("[data-pausar]"));
    await clicar($("[data-motivo-pausa='Cliente ausente']"));
    await clicar($("[data-confirmar-pausa]"));
    expect((registrar.mock.calls[0] as unknown as [any[]])[0][0].dados).toMatchObject({ motivoId: null, motivo: "Cliente ausente", impedimento: true });
  });
});

describe("app: pausada", () => {
  const pausa = (impedimento: boolean) => ({ clientId: "c9", motivo: impedimento ? "Falta de peça/material" : "Almoço/intervalo", impedimento, inicio: new Date(Date.now() - 125 * 60_000).toISOString(), observacao: "peça amanhã" });

  it("faixa: motivo e há quanto tempo; Retomar grava; impedimento: 'O escritório foi avisado'", async () => {
    const { FaixaPausa } = await import("@/components/tecnico/pausa");
    const registrar = vi.fn(async () => {});
    await montar(createElement(FaixaPausa, { x: tela({ pausa: pausa(true) }), registrar }));
    expect($("[data-texto-pausada]")!.textContent).toBe("Pausada — Falta de peça/material — há 2 h 5 min");
    expect($("[data-observacao-pausa]")!.textContent).toBe("peça amanhã");
    expect($("[data-pausada]")!.getAttribute("data-pausada")).toBe("impedimento");
    expect(document.body.textContent).toContain("O escritório foi avisado.");
    await clicar($("[data-retomar]"));
    expect(registrar).toHaveBeenCalledWith([{ tipo: "retomar", atividadeId: "a1", dados: { pausaClientId: "c9" } }]);
  });

  it("impedimento: encerrar pergunta antes; Cancelar não grava; confirmar grava 'naoConcluida'. Intervalo: sem encerrar", async () => {
    const { FaixaPausa } = await import("@/components/tecnico/pausa");
    const registrar = vi.fn(async () => {});
    await montar(createElement(FaixaPausa, { x: tela({ pausa: pausa(true) }), registrar }));
    avisos.confirmar.mockImplementation(async () => false);
    await clicar($("[data-encerrar-nao-concluida]"));
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: "Encerrar a visita como não concluída?", perigo: true }));
    expect(registrar).not.toHaveBeenCalled();
    avisos.confirmar.mockImplementation(async () => true);
    await clicar($("[data-encerrar-nao-concluida]"));
    expect(registrar).toHaveBeenCalledWith([{ tipo: "naoConcluida", atividadeId: "a1", dados: { pausaClientId: "c9" } }]);
    await act(async () => root?.unmount()); caixa?.remove();
    await montar(createElement(FaixaPausa, { x: tela({ pausa: pausa(false) }), registrar: vi.fn() }));
    expect($("[data-encerrar-nao-concluida]")).toBeNull();
    expect($("[data-pausada]")!.getAttribute("data-pausada")).toBe("intervalo");
    expect(document.body.textContent).not.toContain("O escritório foi avisado.");
  });

  it("encerrada como não concluída: a faixa diz que o escritório vai reagendar; sem pausa, nada", async () => {
    const { FaixaPausa } = await import("@/components/tecnico/pausa");
    await montar(createElement(FaixaPausa, { x: tela({ naoConcluida: { motivo: "Cliente ausente", em: new Date().toISOString() } }), registrar: vi.fn() }));
    expect($("[data-visita-nao-concluida]")!.textContent).toBe("Visita encerrada como não concluída (Cliente ausente). O escritório vai reagendar.");
    await act(async () => root?.unmount()); caixa?.remove();
    await montar(createElement(FaixaPausa, { x: tela(), registrar: vi.fn() }));
    expect(caixa!.innerHTML).toBe("");
  });
});

describe("telas: onde a pausa aparece", () => {
  it("app: a faixa na OS e no equipamento; o botão Pausar na OS; pausada, o Concluir some e a 'esquecida' não aparece", () => {
    const ex = lerArq("components/tecnico/execucao.tsx");
    expect(ex).toContain("<FaixaPausa x={x} registrar={registrar} />");
    expect(ex).toContain("{!so && <BotaoPausar r={r} x={x} registrar={registrar} />}");
    expect(ex).toContain("{!so && !x.pausa && (");
    expect(ex).toContain("{!x.pausa && <FaixaAndamento s={andamento} />}");
    expect(ex).toContain('const st = x.pausa && x.atividade.status === "EM_ANDAMENTO" ? { rotulo: "Pausada"');
    expect(lerArq("components/tecnico/equipamento.tsx")).toContain("<FaixaPausa x={x} registrar={registrar} />");
    expect(lerArq("components/tecnico/meu-dia.tsx")).toContain("pausaDoCartao(c.atividadeId, c.pausa, fila)");
  });
  it("escritório: OS e lista mostram 'Pausada — motivo — há X'; Pendências e sino; relatório só na versão interna", () => {
    expect(lerArq("components/os/os-atividades.tsx")).toContain("{textoPausada(p, new Date())}");
    expect(lerArq("components/ordens/ordens-lista-client.tsx")).toContain("{os.pausa && <StatusPill");
    const pend = lerArq("lib/alertas/pendencias.ts");
    expect(pend).toContain('rotulo: "Atividades pausadas por impedimento"');
    expect(pend).toContain('rotulo: "Visitas não concluídas (reagendar)"');
    expect(lerArq("components/layout/header.tsx")).toContain('{doPainel("impedimentosAbertos")}');
    const doc = lerArq("components/relatorio/relatorio-os-documento.tsx");
    expect(doc).toContain('{versao === "interna" && d.pausas.length > 0 && (');
    // o relatório de atividade (o do cliente, PDF e WhatsApp) não lê pausas
    expect(lerArq("lib/relatorio-atividade-pdf.ts")).not.toMatch(/pausa/i);
  });
});
