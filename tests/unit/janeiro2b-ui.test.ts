// @vitest-environment happy-dom
/**
 * App pronto pra janeiro 2 · PR B — as telas (componentes de verdade):
 *  - D5: ao escolher o material, o saldo disponível (catálogo + separado para esta OS − o que está na fila); passou do
 *    saldo, o aviso "Vai ficar negativo; o escritório será avisado." — e lança assim mesmo;
 *  - D4: "+ Legenda" nas fotos antes/depois do equipamento (sem sinal: vai para a fila); OS encerrada: sem o botão.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o: unknown) => true) }));
vi.mock("@/components/ui/avisos", () => ({ toast: avisos.toast, confirmar: avisos.confirmar }));
const cat = vi.hoisted(() => ({ produtos: [] as any[] }));
vi.mock("@/components/tecnico/contexto", () => ({
  useTecnico: () => ({ motor: { baixarLista: async () => ({ dados: { produtos: cat.produtos } }) } }),
  irPara: vi.fn(),
}));
vi.mock("@/components/tecnico/captura", async () => {
  const { createElement: h } = await import("react");
  return {
    BotaoFoto: (p: { rotulo?: string }) => h("button", { type: "button", "data-botao-foto": "" }, p.rotulo),
    Miniatura: (p: { alt: string }) => h("span", { "data-miniatura": p.alt }, p.alt),
    ObservacaoVoz: () => null,
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
async function clicar(el: Element | null) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); await esperar(); }); }
async function digitar(el: Element | null, v: string) {
  await act(async () => {
    const i = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(i, v);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    await esperar();
  });
}
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
beforeEach(() => { avisos.toast.mockClear(); cat.produtos = []; });
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; document.body.innerHTML = ""; });

const tela = (extra: Record<string, unknown> = {}) => ({
  atividade: { id: "a1", titulo: "Corretiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "os1", numero: "OS-2601", status: "EM_ANDAMENTO", clienteId: "c1", unidadeId: null },
  bloqueada: false, equipamentos: [], adicionais: [], materiais: [], conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null }, ...extra,
}) as any;

describe("D5: material sem saldo — mostra o saldo e deixa lançar com aviso", () => {
  async function abrirEEscolher(x: any, produtoId: string, registrar = vi.fn(async () => {})) {
    const { MateriaisUsados } = await import("@/components/tecnico/materiais");
    await montar(createElement(MateriaisUsados, { x, registrar }));
    await clicar($("[data-novo-material]"));
    await digitar($("[data-busca-material]"), "a");
    await clicar($(`[data-produto='${produtoId}']`));
    return registrar;
  }

  it("ao escolher: 'Saldo disponível' do catálogo; passou: o aviso, e o Lançar segue habilitado e grava", async () => {
    cat.produtos = [{ id: "pCabo", codigo: 115, nome: "Cabo PP 2,5 mm²", unidade: "m", saldo: 1 }];
    const registrar = await abrirEEscolher(tela(), "pCabo");
    expect(texto($("[data-saldo-material]"))).toBe("Saldo disponível: 1 m");
    expect($("[data-aviso-sem-saldo]")).toBeNull();
    await digitar($("[data-qtd-material]"), "3,5");
    expect($("[data-saldo-material]")).toBeNull();
    expect(texto($("[data-aviso-sem-saldo]"))).toBe("Saldo disponível: 1 m. Vai ficar negativo; o escritório será avisado.");
    expect($("[data-aviso-sem-saldo]")!.getAttribute("role")).toBe("status");
    expect(($("[data-salvar-material]") as HTMLButtonElement).disabled).toBe(false);
    await clicar($("[data-salvar-material]"));
    expect(registrar).toHaveBeenCalledTimes(1);
    expect((registrar.mock.calls[0] as any)[0][0]).toMatchObject({ tipo: "material", dados: { produtoId: "pCabo", quantidade: 3.5 } });
    expect(avisos.toast).toHaveBeenCalledWith("Material lançado. O escritório será avisado do estoque negativo.");
  });

  it("o separado para esta OS conta; o que está na fila do aparelho (ainda não enviado) desconta", async () => {
    cat.produtos = [{ id: "pGas", codigo: 101, nome: "Gás R-410A", unidade: "kg", saldo: 0 }];
    const fila = { id: null, clientId: "c-fila", produtoId: "pGas", descricao: "Gás R-410A", unidade: "kg", quantidade: 1, equipamentoId: null, meu: true, criadoPor: null, pendente: true };
    await abrirEEscolher(tela({ separado: { pGas: 4 }, materiais: [fila] }), "pGas");
    expect(texto($("[data-saldo-material]"))).toBe("Saldo disponível: 3 kg (4 kg separado para esta OS)");
    await digitar($("[data-qtd-material]"), "3");
    expect($("[data-aviso-sem-saldo]")).toBeNull();
    await digitar($("[data-qtd-material]"), "3,5");
    expect(texto($("[data-aviso-sem-saldo]"))).toBe("Saldo disponível: 3 kg. Vai ficar negativo; o escritório será avisado.");
  });

  it("produto que não controla estoque (ou Estoque desligado, ou catálogo antigo): nada de saldo nem aviso", async () => {
    cat.produtos = [{ id: "pServ", codigo: 300, nome: "Taxa de visita", unidade: "un", saldo: null }, { id: "pVelho", codigo: 1, nome: "Antigo", unidade: "un" }];
    await abrirEEscolher(tela(), "pServ");
    await digitar($("[data-qtd-material]"), "99");
    expect($("[data-saldo-material]")).toBeNull();
    expect($("[data-aviso-sem-saldo]")).toBeNull();
    await act(async () => root?.unmount()); caixa?.remove();
    await abrirEEscolher(tela(), "pVelho");
    await digitar($("[data-qtd-material]"), "99");
    expect($("[data-aviso-sem-saldo]")).toBeNull();
  });

  it("corrigir a quantidade de um material já enviado: o aviso olha só o que aumentou", async () => {
    cat.produtos = [{ id: "pCap", codigo: 104, nome: "Capacitor 35 µF", unidade: "un", saldo: 1 }];
    const linha = { id: "l1", clientId: "c1", produtoId: "pCap", descricao: "Capacitor 35 µF", unidade: "un", quantidade: 2, equipamentoId: null, meu: true, criadoPor: "João" };
    const { MateriaisUsados } = await import("@/components/tecnico/materiais");
    await montar(createElement(MateriaisUsados, { x: tela({ materiais: [linha] }), registrar: vi.fn(async () => {}) }));
    await clicar($("[data-material='c1']"));
    await act(async () => { await esperar(); });
    expect(texto($("[data-saldo-material]"))).toBe("Saldo disponível: 1 un");
    await digitar($("[data-qtd-material]"), "3"); // +1: cabe
    expect($("[data-aviso-sem-saldo]")).toBeNull();
    await digitar($("[data-qtd-material]"), "4"); // +2: passa
    expect(texto($("[data-aviso-sem-saldo]"))).toContain("Vai ficar negativo");
  });
});

describe("D4: legenda opcional nas fotos antes/depois", () => {
  const foto = (o: Record<string, unknown>) => ({ id: null, clientId: null, itemId: null, momento: "ANTES", legenda: null, ...o });
  const equip = (fotos: any[]) => ({
    vinculoId: "v1", feito: false, observacao: null, equipamento: { id: "eqA", titulo: "Split Sala 1", descricao: "Split", fabricante: null, tag: null, numeroSerie: null, local: null, unidade: null, ativo: true, tipo: null },
    itens: [], respostas: {}, fotos, formulario: null, faltas: { semResposta: [], semFoto: [], semObservacao: [], formulario: null }, completo: false,
  });
  async function abrir(fotos: any[], osStatus = "EM_ANDAMENTO", registrar = vi.fn(async () => {})) {
    const { TelaEquipamento } = await import("@/components/tecnico/equipamento");
    const e = equip(fotos);
    await montar(createElement(TelaEquipamento, { x: tela({ equipamentos: [e], os: { id: "os1", numero: "OS-2601", status: osStatus, clienteId: "c1", unidadeId: null } }), e, registrar } as any));
    return registrar;
  }

  it("cada foto antes/depois tem '+ Legenda' (alvo de 44 px); salvar grava a operação na fila e a legenda aparece", async () => {
    const registrar = await abrir([foto({ id: "f1" }), foto({ clientId: "c2", momento: "DEPOIS", pendente: true, local: "data:image/png;base64,AA" })]);
    const botoes = $$("[data-legenda-foto-equip]");
    expect(botoes.map(texto)).toEqual(["+ Legenda", "+ Legenda"]);
    expect(botoes.every((b) => b.className.includes("min-h-[44px]"))).toBe(true);
    await clicar(botoes[1]);
    await digitar($("[data-legenda-foto-input]"), "  Serpentina limpa ");
    await clicar($("[data-legenda-foto-salvar]"));
    expect(registrar).toHaveBeenCalledWith([{ tipo: "fotoLegenda", atividadeId: "a1", dados: { clientId: "c2", legenda: "Serpentina limpa" } }]);
    await act(async () => { await esperar(); });
    expect(avisos.toast).toHaveBeenCalledWith("Legenda salva.");
  });

  it("apagar a legenda escrita volta à do sistema; não mudou nada: não grava", async () => {
    const registrar = await abrir([foto({ id: "f1", legenda: "Antes da limpeza" })]);
    expect(texto($("[data-legenda-foto-equip]"))).toBe("Antes da limpeza");
    await clicar($("[data-legenda-foto-equip]"));
    await clicar($("[data-legenda-foto-salvar]"));
    expect(registrar).not.toHaveBeenCalled();
    await clicar($("[data-legenda-foto-equip]"));
    await digitar($("[data-legenda-foto-input]"), "");
    await clicar($("[data-legenda-foto-salvar]"));
    expect(registrar).toHaveBeenCalledWith([{ tipo: "fotoLegenda", atividadeId: "a1", dados: { id: "f1", legenda: "" } }]);
    await act(async () => { await esperar(); });
    expect(avisos.toast).toHaveBeenCalledWith("Legenda do sistema de volta.");
  });

  it("OS encerrada: sem o botão de legenda (a mesma regra das fotos do serviço)", async () => {
    await abrir([foto({ id: "f1" })], "CONCLUIDA");
    expect($("[data-legenda-foto-equip]")).toBeNull();
    expect($$("[data-miniatura]").length).toBe(1);
  });
});
