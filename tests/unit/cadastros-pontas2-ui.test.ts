// @vitest-environment happy-dom
/**
 * PONTAS SOLTAS DE CADASTRO (leva 5) — as telas:
 *  - endereço e contato: inativar pelo botão padrão (com o impacto daquele local) e reativar pela seção
 *    "Inativos", que antes não existia;
 *  - veículo: "Inativo" no seletor de status mostra o impacto e pede o motivo, que vai junto no salvar;
 *  - OS: o modal próprio virou o botão padrão (inativar com o bloqueio antes, recusar, reabrir, aberto
 *    pelo seletor de status);
 *  - nota de compra: Descartar (com motivo) e volta para a lista.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/clientes", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});

let root: Root | null = null, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = (sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string, dentro: ParentNode = document) => [...dentro.querySelectorAll("button")].filter((b) => txt(b) === t).at(-1) ?? null;
const dialogo = () => $('[role="dialog"]');
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => [c[0], c[1] ?? "sucesso"]);
async function digitar(el: HTMLInputElement | HTMLTextAreaElement | null, valor: string) {
  expect(el, "campo").toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(sel: HTMLSelectElement | null, valor: string) {
  expect(sel, "seletor").toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, valor); sel!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}

async function montar(el: ReactElement, permissoes: Permissoes) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { Avisos } = await import("@/components/ui/avisos");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [createElement("div", { key: "tela" }, el), createElement(Avisos, { key: "avisos" })] })); });
  await esperar();
}

beforeAll(async () => {
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/providers/permissoes-provider"), () => import("@/components/forms/unidades-manager"),
    () => import("@/components/forms/contatos-manager"), () => import("@/components/forms/veiculo-form"),
    () => import("@/components/os/os-inativar"), () => import("@/components/compras/descartar-nota"),
  ]) await m();
}, 120_000);
beforeEach(async () => {
  chamadas.length = 0; respostas = {}; nav.refresh.mockClear(); nav.push.mockClear();
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).find((k) => { const [m, u] = k.split(" "); return m === metodo && url.split("?")[0] === u; });
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const EDITA_CLIENTES = montarPermissoes({ clientes: ["visualizar", "editar"] });

/* ───────── Endereços ───────── */
const un = (id: string, nome: string, extra: object = {}) => ({ id, nome, principal: false, ativo: true, clienteId: "cl1", empresaId: "e1", logradouro: "Rua das Palmeiras", numero: "120", cidade: "Campinas", estado: "SP", ...extra });

describe("endereços: inativar com o impacto do local e reativar pela seção Inativos", () => {
  async function abrir(permissoes: Permissoes = EDITA_CLIENTES) {
    const { UnidadesManager } = await import("@/components/forms/unidades-manager");
    await montar(createElement(UnidadesManager, {
      clienteId: "cl1",
      unidadesIniciais: [un("uM", "Matriz", { principal: true }), un("uL", "Loja Centro")] as any,
      inativosIniciais: [un("uD", "Depósito Antigo", { ativo: false, logradouro: "Av. Brasil", numero: "900" })] as any,
    }), permissoes);
  }
  const ativos = () => $$("button").map(txt).filter((t) => /^(Matriz|Loja Centro|Depósito Antigo|Quiosque)/.test(t));
  const expandir = (nome: string) => clicar($$("button").find((b) => txt(b).startsWith(nome)));

  it("inativar: o texto padrão (que agora promete reativar), os avisos do local e, confirmado, vai para Inativos", async () => {
    respostas["GET /api/unidades/uL/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: ["Está em 1 contrato ativo (CT-1): continua atendendo este local até ser alterado.", "Tem 1 OS em aberto (OS-9): segue normalmente."] } };
    respostas["DELETE /api/unidades/uL"] = { status: 200, corpo: { ok: true } };
    await abrir();
    await expandir("Loja Centro");
    await clicar($('[data-inativar-registro="inativar"]'));
    expect(chamadas.map((c) => `${c.metodo} ${c.url}`)).toContain("GET /api/unidades/uL/impacto");
    const d = dialogo()!;
    expect(txt(d)).toContain("Inativar endereço Loja Centro?");
    expect(txt(d)).toContain("Tem certeza? O endereço sai das listas e seletores; nada é apagado e pode ser reativado depois.");
    expect($$("[data-avisos] li", d).map(txt)).toEqual(["Está em 1 contrato ativo (CT-1): continua atendendo este local até ser alterado.", "Tem 1 OS em aberto (OS-9): segue normalmente."]);
    expect($("textarea", d)).toBeNull(); // endereço não pede motivo
    await clicar(botao("Sim, inativar", d));
    expect(gravacoes()).toEqual([{ url: "/api/unidades/uL", metodo: "DELETE", corpo: { motivo: "" } }]);
    expect(await toasts()).toEqual([["Endereço inativado.", "sucesso"]]);
    expect(ativos()).toEqual(["MatrizPrincipal"]);
    expect(txt($("[data-secao-inativos] > button"))).toBe("Inativos (2)");
  });

  it("o bloqueio aparece antes e trava o botão; o principal nem tem Inativar", async () => {
    respostas["GET /api/unidades/uL/impacto"] = { status: 200, corpo: { bloqueio: "Tem 1 equipamento ativo neste endereço: mova ou inative os equipamentos antes.", avisos: [] } };
    await abrir();
    await expandir("Matriz");
    expect($('[data-inativar-registro="inativar"]')).toBeNull();
    await expandir("Loja Centro");
    await clicar($('[data-inativar-registro="inativar"]'));
    expect(txt($("[data-bloqueio]"))).toBe("Tem 1 equipamento ativo neste endereço: mova ou inative os equipamentos antes.");
    expect((botao("Sim, inativar", dialogo()!) as HTMLButtonElement).disabled).toBe(true);
    expect(gravacoes()).toEqual([]);
  });

  it("reativar: a seção começa fechada; Reativar manda { ativo: true } e o endereço volta à lista", async () => {
    respostas["PATCH /api/unidades/uD"] = { status: 200, corpo: un("uD", "Depósito Antigo", { logradouro: "Av. Brasil", numero: "900" }) };
    await abrir();
    expect(txt($("[data-secao-inativos] > button"))).toBe("Inativos (1)");
    expect($("[data-inativo]")).toBeNull();
    await clicar($("[data-secao-inativos] > button"));
    expect(txt($('[data-inativo="uD"]'))).toContain("Depósito Antigo");
    expect(txt($('[data-inativo="uD"]'))).toContain("Av. Brasil, 900");
    await clicar($('[data-inativo="uD"] [data-inativar-registro="reativar"]'));
    expect(txt(dialogo())).toContain("Reativar endereço Depósito Antigo?");
    await clicar(botao("Reativar", dialogo()!));
    expect(gravacoes()).toEqual([{ url: "/api/unidades/uD", metodo: "PATCH", corpo: { ativo: true } }]);
    expect(await toasts()).toEqual([["Endereço reativado.", "sucesso"]]);
    expect(ativos()).toEqual(["MatrizPrincipal", "Depósito Antigo", "Loja Centro"]);
    expect($("[data-secao-inativos]")).toBeNull();
  });

  it("recusado: o endereço fica onde estava e o motivo aparece no modal", async () => {
    respostas["PATCH /api/unidades/uD"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await abrir();
    await clicar($("[data-secao-inativos] > button"));
    await clicar($('[data-inativo="uD"] [data-inativar-registro="reativar"]'));
    await clicar(botao("Reativar", dialogo()!));
    expect(txt(dialogo())).toContain("Sem permissão para esta ação");
    expect(await toasts()).toEqual([]);
    expect($('[data-inativo="uD"]')).toBeTruthy();
  });

  it("quem só vê clientes: nem Inativar nem Reativar", async () => {
    await abrir(montarPermissoes({ clientes: ["visualizar"] }));
    await expandir("Loja Centro");
    await clicar($("[data-secao-inativos] > button"));
    expect($("[data-inativar-registro]")).toBeNull();
  });
});

/* ───────── Contatos ───────── */
describe("contatos: inativar com o aviso do portal e reativar", () => {
  const ct = (id: string, nome: string, extra: object = {}) => ({ id, nome, cargo: null, tipo: "OUTRO", telefone: null, whatsapp: null, email: null, principal: false, ativo: true, ...extra });
  async function abrir() {
    const { ContatosManager } = await import("@/components/forms/contatos-manager");
    await montar(createElement(ContatosManager, {
      clienteId: "cl1", contatosIniciais: [ct("c1", "Marina Alves", { principal: true })] as any,
      inativosIniciais: [ct("c2", "Paulo Rezende", { ativo: false, cargo: "Ex-comprador" })] as any,
    }), EDITA_CLIENTES);
  }

  it("inativar avisa o portal; reativar devolve à lista", async () => {
    respostas["GET /api/clientes/cl1/contatos/c1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: ["Tem acesso ao Portal do Cliente: o acesso fica bloqueado enquanto estiver inativo."] } };
    respostas["DELETE /api/clientes/cl1/contatos/c1"] = { status: 200, corpo: { ok: true } };
    respostas["PATCH /api/clientes/cl1/contatos/c2"] = { status: 200, corpo: ct("c2", "Paulo Rezende", { cargo: "Comprador" }) };
    await abrir();
    await clicar($$("button").find((b) => txt(b).startsWith("Marina Alves")));
    await clicar($('[data-inativar-registro="inativar"]'));
    expect(txt(dialogo())).toContain("Inativar contato Marina Alves?");
    expect(txt($("[data-avisos]"))).toContain("Tem acesso ao Portal do Cliente");
    await clicar(botao("Sim, inativar", dialogo()!));
    expect(gravacoes()).toEqual([{ url: "/api/clientes/cl1/contatos/c1", metodo: "DELETE", corpo: { motivo: "" } }]);
    expect(txt(caixa)).toContain("Nenhum contato cadastrado.");

    await clicar($("[data-secao-inativos] > button"));
    expect($$("[data-inativo]").map((l) => l.getAttribute("data-inativo"))).toEqual(["c1", "c2"]);
    await clicar($('[data-inativo="c2"] [data-inativar-registro="reativar"]'));
    await clicar(botao("Reativar", dialogo()!));
    expect(gravacoes().at(-1)).toEqual({ url: "/api/clientes/cl1/contatos/c2", metodo: "PATCH", corpo: { ativo: true } });
    expect(txt(caixa)).toContain("Paulo Rezende");
    expect(txt(caixa)).toContain("Comprador");
    expect(await toasts()).toEqual([["Contato inativado.", "sucesso"], ["Contato reativado.", "sucesso"]]);
  });
});

/* ───────── Veículo ───────── */
describe("veículo: Inativo no formulário pede o motivo e mostra o impacto (como o botão)", () => {
  const INICIAL = { id: "v1", placa: "RTA4F21", marca: "Fiat", modelo: "Strada", tipo: "CARRO", status: "ATIVO", responsavelId: "", equipeId: "", fotos: [], fotosRotulos: [], documentos: [], checklists: [], manutencoes: [] };
  async function abrir(permissoes: Permissoes, inicial: object = INICIAL) {
    const { VeiculoForm } = await import("@/components/forms/veiculo-form");
    respostas["GET /api/tecnicos"] = { status: 200, corpo: [] };
    respostas["GET /api/equipes"] = { status: 200, corpo: [] };
    await montar(createElement(VeiculoForm, { initialData: inicial }), permissoes);
  }
  const seletor = () => [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "MANUTENCAO"))!;
  const opcoes = () => [...seletor().options].map((o) => o.value);

  it("sem Veículos › Excluir, a opção Inativo não aparece (a não ser que já esteja inativo)", async () => {
    await abrir(montarPermissoes({ veiculos: ["visualizar", "gerenciar"] }));
    expect(opcoes()).toEqual(["ATIVO", "MANUTENCAO"]);
    await act(async () => root?.unmount()); caixa.remove();
    await abrir(montarPermissoes({ veiculos: ["visualizar", "gerenciar"] }), { ...INICIAL, status: "INATIVO" });
    expect(opcoes()).toEqual(["ATIVO", "INATIVO", "MANUTENCAO"]);
    expect($("[data-aviso-inativacao]")).toBeNull(); // já inativo: não é "inativar"
  });

  it("escolher Inativo: o impacto aparece, o motivo vai junto no salvar", async () => {
    respostas["GET /api/veiculos/v1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: ["Responsável por 2 OS em aberto."] } };
    respostas["PUT /api/veiculos/v1"] = { status: 200, corpo: { id: "v1" } };
    await abrir(montarPermissoes({ veiculos: ["visualizar", "gerenciar", "excluir"] }));
    expect($("[data-aviso-inativacao]")).toBeNull();
    await escolher(seletor(), "INATIVO");
    expect(txt($("[data-aviso-inativacao]"))).toContain("Responsável por 2 OS em aberto.");
    await digitar($("[data-aviso-inativacao] textarea") as HTMLTextAreaElement, "Vendido");
    await clicar($("[data-salvar-veiculo]"));
    const put = gravacoes().find((g) => g.metodo === "PUT")!;
    expect([put.url, put.corpo.status, put.corpo.motivoInativacao]).toEqual(["/api/veiculos/v1", "INATIVO", "Vendido"]);
    // voltar para Ativo antes de salvar: o motivo não vai
    await act(async () => root?.unmount()); caixa.remove(); chamadas.length = 0;
    await abrir(montarPermissoes({ veiculos: ["visualizar", "gerenciar", "excluir"] }));
    await escolher(seletor(), "INATIVO");
    await escolher(seletor(), "MANUTENCAO");
    expect($("[data-aviso-inativacao]")).toBeNull();
    await clicar($("[data-salvar-veiculo]"));
    expect("motivoInativacao" in gravacoes().find((g) => g.metodo === "PUT")!.corpo).toBe(false);
  });
});

/* ───────── OS ───────── */
describe("OS: o modal de inativar é o botão padrão", () => {
  async function abrir(props: object, permissoes: Permissoes = permissoesTotais()) {
    const { OsInativarBotao } = await import("@/components/os/os-inativar");
    await montar(createElement(OsInativarBotao, { osId: "os1", numero: "OS-0101", status: "ABERTA", ...props } as any), permissoes);
  }

  it("inativar: o bloqueio da medição aparece antes e trava; sem bloqueio, DELETE com o motivo", async () => {
    respostas["GET /api/ordens/os1/impacto"] = { status: 200, corpo: { bloqueio: "Esta OS já está na medição MED-1 (financeiro). Cancele ou remova a OS da medição antes de inativá-la.", avisos: [] } };
    await abrir({});
    await clicar(botao("Inativar"));
    expect(txt(dialogo())).toContain("Inativar OS OS-0101?");
    expect(txt($("[data-bloqueio]"))).toContain("já está na medição MED-1");
    expect((botao("Sim, inativar", dialogo()!) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => root?.unmount()); caixa.remove(); document.body.innerHTML = "";

    const alterado = vi.fn();
    respostas["GET /api/ordens/os1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: [] } };
    respostas["DELETE /api/ordens/os1"] = { status: 200, corpo: { ok: true, status: "CANCELADA" } };
    await abrir({ onAlterado: alterado });
    await clicar(botao("Inativar"));
    expect(txt(dialogo())).toContain("Tem certeza? A OS fica Cancelada e sai das listas e do calendário; nada é apagado e pode ser reaberta depois.");
    await digitar($("textarea", dialogo()!) as HTMLTextAreaElement, "Aberta em duplicidade");
    await clicar(botao("Sim, inativar", dialogo()!));
    expect(gravacoes()).toEqual([{ url: "/api/ordens/os1", metodo: "DELETE", corpo: { motivo: "Aberta em duplicidade" } }]);
    expect(alterado).toHaveBeenCalledWith("CANCELADA");
    expect(await toasts()).toEqual([["OS inativada.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("reabrir: PUT { status: ABERTA } (com Ordens › Editar), sem consultar impacto", async () => {
    const alterado = vi.fn();
    respostas["PUT /api/ordens/os1"] = { status: 200, corpo: { id: "os1", status: "ABERTA" } };
    await abrir({ status: "CANCELADA", onAlterado: alterado }, montarPermissoes({ ordens: ["visualizar", "editar"] }));
    await clicar(botao("Reabrir"));
    expect(txt(dialogo())).toContain("Reabrir OS OS-0101?");
    await clicar(botao("Reabrir", dialogo()!));
    expect(chamadas).toEqual([{ url: "/api/ordens/os1", metodo: "PUT", corpo: { status: "ABERTA" } }]);
    expect(alterado).toHaveBeenCalledWith("ABERTA");
    expect(await toasts()).toEqual([["OS reaberta.", "sucesso"]]);
  });

  it("recusar a solicitação: { recusa: true } no corpo, textos próprios, sem atualizar a tela inteira", async () => {
    respostas["GET /api/ordens/os1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: [] } };
    respostas["DELETE /api/ordens/os1"] = { status: 200, corpo: { ok: true } };
    await abrir({ modo: "recusar", status: "AGUARDANDO_ATENDIMENTO" });
    await clicar(botao("Recusar"));
    expect(txt(dialogo())).toContain("Recusar a solicitação OS-0101?");
    await clicar(botao("Sim, recusar", dialogo()!));
    expect(gravacoes()).toEqual([{ url: "/api/ordens/os1", metodo: "DELETE", corpo: { recusa: true, motivo: "" } }]);
    expect(await toasts()).toEqual([["Solicitação recusada.", "sucesso"]]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("aberto pelo seletor de status (oculto): o modal abre sozinho; Voltar avisa quem abriu", async () => {
    const fechou = vi.fn();
    respostas["GET /api/ordens/os1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: [] } };
    await abrir({ variante: "oculto", abrirAoMontar: true, onFechar: fechou });
    expect(botao("Inativar")).toBeNull();
    expect(txt(dialogo())).toContain("Inativar OS OS-0101?");
    await clicar(botao("Voltar", dialogo()!));
    expect(dialogo()).toBeNull();
    expect(fechou).toHaveBeenCalledTimes(1);
    expect(gravacoes()).toEqual([]);
  });

  it("sem a permissão, nada aparece (nem aberto pelo seletor)", async () => {
    await abrir({ variante: "oculto", abrirAoMontar: true }, montarPermissoes({ ordens: ["visualizar", "editar"] }));
    expect(dialogo()).toBeNull();
    expect(chamadas).toEqual([]);
  });
});

/* ───────── Nota de compra ───────── */
describe("nota de compra: Descartar", () => {
  it("o modal padrão com motivo; confirmado, volta à lista; a recusa fica no modal", async () => {
    const { DescartarNota } = await import("@/components/compras/descartar-nota");
    respostas["GET /api/compras/notas/nf1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: [] } };
    respostas["DELETE /api/compras/notas/nf1"] = { status: 200, corpo: { ok: true } };
    await montar(createElement(DescartarNota, { id: "nf1", numero: "45120", serie: "1" }), montarPermissoes({ estoque: ["visualizar", "gerenciar"] }));
    await clicar(botao("Descartar"));
    const d = dialogo()!;
    expect(txt(d)).toContain("Descartar a NF 45120/1?");
    expect(txt(d)).toContain("A nota sai do sistema com os itens; fica registrado quem descartou, quando e por quê.");
    await digitar($("textarea", d) as HTMLTextAreaElement, "XML de outra filial");
    await clicar(botao("Sim, descartar", d));
    expect(gravacoes()).toEqual([{ url: "/api/compras/notas/nf1", metodo: "DELETE", corpo: { motivo: "XML de outra filial" } }]);
    expect(await toasts()).toEqual([["Nota descartada.", "sucesso"]]);
    expect(nav.push).toHaveBeenCalledWith("/estoque/notas");
  });

  it("sem Estoque › Gerenciar, não aparece", async () => {
    const { DescartarNota } = await import("@/components/compras/descartar-nota");
    await montar(createElement(DescartarNota, { id: "nf1", numero: "45120", serie: "1" }), montarPermissoes({ estoque: ["visualizar"] }));
    expect(botao("Descartar")).toBeNull();
  });
});
