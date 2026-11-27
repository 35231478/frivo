// @vitest-environment happy-dom
/**
 * PONTAS SOLTAS DE CADASTRO (leva 4) — as telas:
 *  - a ficha do cliente (consulta e edição) inativa e reativa pelo botão padrão, com o mesmo texto da lista;
 *  - endereço e contato: "Inativar" (não "Excluir"), com o texto padrão (na leva 5, com reativação);
 *  - conta a pagar paga: sem "Cancelar conta" (nem no menu nem nos ícones da ficha);
 *  - colaborador: a opção "Inativo" do status só para quem pode inativar.
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
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => [c[0], c[1] ?? "sucesso"]);

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
    () => import("@/components/providers/permissoes-provider"), () => import("@/components/forms/cliente-form"),
    () => import("@/components/forms/unidades-manager"), () => import("@/components/forms/contatos-manager"),
    () => import("@/components/financeiro/conta-pagar-acoes"), () => import("@/components/forms/colaborador-form"),
  ]) await m();
}, 120_000);
beforeEach(async () => {
  chamadas.length = 0; respostas = {}; nav.refresh.mockClear();
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).find((k) => { const [m, u] = k.split(" "); return m === metodo && url.split("?")[0] === u; });
    const r = chave ? respostas[chave] : { status: 200, corpo: String(url).startsWith("/api/cadastros") ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

/* ───────── Ficha do cliente ───────── */

const CLIENTE: any = {
  id: "cl1", nome: "Comercial de Alimentos Silva Ltda", nomeFantasia: "Mercado do Zé", tipoPessoa: "JURIDICA", cpfCnpj: "44.555.666/0001-77",
  ativo: true, statusFinanceiro: "ADIMPLENTE", unidades: [], anexos: [], contatosCliente: [], interacoes: [], _count: { contratos: 0 },
};

describe("ficha do cliente: inativar e reativar pelo botão padrão", () => {
  async function ficha(consulta: boolean, permissoes: Permissoes, dados: any = CLIENTE) {
    const { ClienteForm } = await import("@/components/forms/cliente-form");
    await montar(createElement(ClienteForm, { initialData: dados, consulta } as any), permissoes);
  }
  const status = () => txt($("[data-status-cliente]"));

  for (const consulta of [true, false]) {
    it(`${consulta ? "consulta" : "edição"}: Inativar com o texto padrão e o que continua andando; confirmado, o selo vira Inativo`, async () => {
      respostas["GET /api/clientes/cl1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: ["Tem 1 contrato ativo (CT-L4-001): continua gerando OS e cobrança até o encerramento."] } };
      await ficha(consulta, permissoesTotais());
      expect(status()).toBe("Ativo");
      // o antigo seletor de status (com o texto próprio) saiu
      expect($('button[title="Mudar status do cliente"]')).toBeNull();
      await clicar($('[data-inativar-registro="inativar"]'));
      const d = $('[role="dialog"]')!;
      expect(txt(d)).toContain("Inativar cliente Mercado do Zé?");
      expect(txt(d)).toContain("Tem certeza? O cliente sai das listas e seletores; nada é apagado e pode ser reativado depois.");
      expect(txt($("[data-avisos]"))).toContain("Tem 1 contrato ativo (CT-L4-001)");
      // o modal vai para o <body> (portal): dentro do cabeçalho com desfoque da ficha, ele ficava preso
      // ao cabeçalho e cortado pela barra do topo (visto no navegador real)
      expect(caixa.contains(d)).toBe(false);
      expect(d.parentElement).toBe(document.body);
      await clicar(botao("Sim, inativar"));
      expect(gravacoes()).toEqual([{ url: "/api/clientes/cl1", metodo: "DELETE", corpo: { motivo: "" } }]);
      expect(await toasts()).toEqual([["Cliente inativado.", "sucesso"]]);
      expect(status()).toBe("Inativo");
      expect(nav.refresh).toHaveBeenCalled();
      // e o mesmo botão agora reativa
      expect($('[data-inativar-registro="reativar"]')).toBeTruthy();
    });
  }

  it("só visualizar: o status é só um selo, sem Inativar nem Reativar", async () => {
    await ficha(true, montarPermissoes({ clientes: ["visualizar"] }));
    expect(status()).toBe("Ativo");
    expect($("[data-inativar-registro]")).toBeNull();
  });

  it("cliente inativo: Reativar com editar; sem editar, nada", async () => {
    await ficha(true, montarPermissoes({ clientes: ["visualizar", "editar"] }), { ...CLIENTE, ativo: false });
    expect(status()).toBe("Inativo");
    await clicar($('[data-inativar-registro="reativar"]'));
    expect(txt($('[role="dialog"]'))).toContain("Reativar cliente Mercado do Zé?");
    await clicar(botao("Reativar", $('[role="dialog"]')!));
    expect(gravacoes()).toEqual([{ url: "/api/clientes/cl1", metodo: "PATCH", corpo: { ativo: true } }]);
    expect(status()).toBe("Ativo");
    await act(async () => root?.unmount()); caixa.remove();
    await ficha(true, montarPermissoes({ clientes: ["visualizar", "excluir"] }), { ...CLIENTE, ativo: false });
    expect($("[data-inativar-registro]")).toBeNull();
  });

  it("recusado pelo servidor: o selo não muda e o motivo aparece", async () => {
    respostas["GET /api/clientes/cl1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: [] } };
    respostas["DELETE /api/clientes/cl1"] = { status: 403, corpo: { erro: "Sem permissão" } };
    await ficha(false, permissoesTotais());
    await clicar($('[data-inativar-registro="inativar"]'));
    await clicar(botao("Sim, inativar"));
    expect(txt($('[role="dialog"]'))).toContain("Sem permissão");
    expect(status()).toBe("Ativo");
  });
});

/* ───────── Endereço e contato ───────── */

describe("endereço e contato: Inativar, com o texto padrão", () => {
  it("endereço: o botão diz Inativar; a confirmação é a padrão, sem prometer reativação; confirmado, sai da lista", async () => {
    const { UnidadesManager } = await import("@/components/forms/unidades-manager");
    const u = (id: string, nome: string, principal: boolean) => ({ id, nome, principal, logradouro: null, numero: null, complemento: null, bairro: null, cidade: "Osasco", estado: "SP", cep: null, telefone: null, observacoes: null, latitude: null, longitude: null });
    await montar(createElement(UnidadesManager, { clienteId: "cl1", unidadesIniciais: [u("u1", "Loja Centro", true), u("u2", "Depósito", false)] } as any), permissoesTotais());
    await clicar([...document.querySelectorAll("button")].find((b) => txt(b).startsWith("Depósito")));
    expect(botao("Excluir")).toBeNull();
    // Leva 5: o botão padrão dos cadastros, e o texto voltou a prometer a reativação (agora existe pela tela)
    expect(txt($('[data-inativar-registro="inativar"]'))).toBe("Inativar");
    await clicar($('[data-inativar-registro="inativar"]'));
    const d = $('[role="dialog"]')!;
    expect(txt(d)).toContain("Inativar endereço Depósito?");
    expect(txt(d)).toContain("Tem certeza? O endereço sai das listas e seletores; nada é apagado e pode ser reativado depois.");
    expect(txt(d)).toContain("Voltar");
    await clicar(botao("Sim, inativar", d));
    expect(gravacoes()).toEqual([{ url: "/api/unidades/u2", metodo: "DELETE", corpo: { motivo: "" } }]);
    expect([...document.querySelectorAll("button")].some((b) => txt(b).startsWith("Depósito"))).toBe(false);
  });

  it("contato: o mesmo texto; voltar não grava", async () => {
    const { ContatosManager } = await import("@/components/forms/contatos-manager");
    const c = { id: "k1", nome: "Marta Souza", cargo: "Compras", telefone: null, celular: null, email: "marta@x.com", principal: false, recebeOs: false, recebeFinanceiro: false, observacoes: null };
    await montar(createElement(ContatosManager, { clienteId: "cl1", contatosIniciais: [c] } as any), permissoesTotais());
    await clicar([...document.querySelectorAll("button")].find((b) => txt(b).includes("Marta Souza")));
    await clicar($('[data-inativar-registro="inativar"]'));
    const d = $('[role="dialog"]')!;
    expect(txt(d)).toContain("Inativar contato Marta Souza?");
    expect(txt(d)).toContain("Tem certeza? O contato sai das listas e seletores; nada é apagado e pode ser reativado depois.");
    await clicar(botao("Voltar", d));
    expect(gravacoes()).toEqual([]);
    expect(txt(caixa)).toContain("Marta Souza");
  });
});

/* ───────── Conta a pagar ───────── */

describe("conta a pagar paga: sem Cancelar", () => {
  const conta = { id: "cp1", numero: "CP-1", fornecedor: "Refrigeração Sul", valorTotal: 1000, valorPago: 1000, saldoRestante: 0, status: "PAGO_TOTAL", descricao: "Gás" };
  it("nos ícones da ficha e no ⋮ da lista; a conta em aberto continua com Cancelar", async () => {
    const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
    await montar(createElement(ContaPagarAcoes, { conta }), permissoesTotais());
    expect($("[data-cancelar-conta]")).toBeNull();
    expect($("[data-historico-pagamentos]")).toBeTruthy();
    await act(async () => root?.unmount()); caixa.remove();
    await montar(createElement(ContaPagarAcoes, { conta, menu: true }), permissoesTotais());
    await clicar($("[data-acao=menu]"));
    expect($$("[data-menu-acoes] [data-item]").map((e) => e.getAttribute("data-item"))).not.toContain("cancelar");
    await act(async () => root?.unmount()); caixa.remove();
    await montar(createElement(ContaPagarAcoes, { conta: { ...conta, status: "PENDENTE", valorPago: 0, saldoRestante: 1000 } }), permissoesTotais());
    expect($("[data-cancelar-conta]")).toBeTruthy();
  });
});

/* ───────── Colaborador ───────── */

describe("colaborador: a opção Inativo do status", () => {
  const opcoes = () => [...(document.querySelector('select[name="statusColaborador"]') as HTMLSelectElement).options].map((o) => o.textContent);
  const COLAB: any = { id: "t1", nome: "Carlos Oliveira", cpf: "123", telefone: "1", ativo: true, statusColaborador: "ATIVO", competencias: [], documentos: [] };
  it("quem pode inativar vê; quem só edita não vê; já inativo, a opção continua (o valor atual)", async () => {
    const { ColaboradorForm } = await import("@/components/forms/colaborador-form");
    await montar(createElement(ColaboradorForm, { initialData: COLAB } as any), montarPermissoes({ equipes: ["visualizar", "editar", "gerenciar", "excluir"] }));
    expect(opcoes()).toEqual(["Ativo", "Inativo", "Férias", "Afastado"]);
    await act(async () => root?.unmount()); caixa.remove();
    await montar(createElement(ColaboradorForm, { initialData: COLAB } as any), montarPermissoes({ equipes: ["visualizar", "editar", "gerenciar"] }));
    expect(opcoes()).toEqual(["Ativo", "Férias", "Afastado"]);
    await act(async () => root?.unmount()); caixa.remove();
    await montar(createElement(ColaboradorForm, { initialData: { ...COLAB, ativo: false, statusColaborador: "INATIVO" } } as any), montarPermissoes({ equipes: ["visualizar", "editar", "gerenciar"] }));
    expect(opcoes()).toEqual(["Ativo", "Inativo", "Férias", "Afastado"]);
  });
});
