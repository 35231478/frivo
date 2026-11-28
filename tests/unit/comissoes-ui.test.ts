// @vitest-environment happy-dom
/**
 * COM-1 — as telas, num DOM de verdade:
 *  - o vendedor do orçamento: travado; "Trocar" só com a permissão; o diálogo exige pessoa e motivo e manda o PATCH;
 *  - Configurações › Comissões: as regras em linhas (com a descrição), o exemplo da precedência, a nova regra (campos
 *    conforme o tipo; Executor/Responsável ainda desligados), o erro do servidor, desativar e a configuração;
 *  - Meu perfil: a aba Comissões só aparece quando a empresa usa comissão; o extrato tem só valores de comissão;
 *  - a folha do mês: com comissão na empresa, as colunas Comissão e Total; sem, como sempre foi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const roteador = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => roteador, usePathname: () => "/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...resto }: any) => React.createElement("a", { href, ...resto }, children) };
});
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, update: vi.fn(async () => null) }) }));
vi.mock("@/components/ui/avisos", async (o) => ({ ...(await o<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));
vi.mock("@/components/push/notificacoes-aparelho", () => ({ NotificacoesAparelho: () => null }));

let raiz: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};

beforeEach(() => {
  chamadas.length = 0; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url: String(url), metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && String(url).startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  caixa = document.createElement("div"); document.body.appendChild(caixa);
});
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement) { raiz = createRoot(caixa); await act(async () => { raiz!.render(el); }); await esperar(); }
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el, "campo").toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el, "seletor").toBeTruthy();
  await act(async () => { (el as HTMLSelectElement).value = v; el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
const botao = (t: string) => [...document.querySelectorAll("button")].find((b) => texto(b) === t);

describe("vendedor do orçamento", () => {
  const VENDEDOR = { id: "uV", nome: "Vitor Vendas" };
  const OPCOES = [VENDEDOR, { id: "uP", nome: "Paula Pessoa" }];
  const abrir = async (podeTrocar: boolean) => {
    const { VendedorDoOrcamento } = await import("@/components/orcamento/vendedor-orcamento");
    await montar(createElement(VendedorDoOrcamento, { orcamentoId: "o1", vendedor: VENDEDOR, podeTrocar, opcoes: podeTrocar ? OPCOES : [] }));
  };

  it("travado: mostra o vendedor com o cadeado; sem a permissão não há 'Trocar'", async () => {
    await abrir(false);
    expect(texto($("[data-vendedor-orcamento]"))).toMatch(/^Vendedor:/);
    expect(texto($("[data-vendedor-nome]"))).toBe("Vitor Vendas");
    expect($("[aria-label='Travado']")).toBeTruthy();
    expect($("[data-trocar-vendedor]")).toBeNull();
  });

  it("com a permissão: o diálogo exige a pessoa (sem o atual) e o motivo; manda o PATCH e atualiza a tela; erro do servidor aparece", async () => {
    await abrir(true);
    await clicar($("[data-trocar-vendedor]"));
    const opcoes = $$("[data-novo-vendedor] option").map((o) => o.textContent);
    expect(opcoes).toEqual(["Escolha a pessoa", "Paula Pessoa"]);
    const confirmar = $<HTMLButtonElement>("[data-confirmar-vendedor]")!;
    expect(confirmar.disabled).toBe(true);
    await escolher($("[data-novo-vendedor]"), "uP");
    await digitar($("[data-motivo-vendedor]"), "abc");
    expect(confirmar.disabled).toBe(true); // motivo curto
    // O servidor recusa (comissão já liberada): a mensagem aparece e nada recarrega
    respostas["PATCH /api/orcamentos/o1/vendedor"] = { status: 409, corpo: { erro: "Este orçamento já tem comissão liberada." } };
    await digitar($("[data-motivo-vendedor]"), "Carteira nova");
    await clicar(confirmar);
    expect(texto($("[role='alert']"))).toBe("Este orçamento já tem comissão liberada.");
    expect(roteador.refresh).not.toHaveBeenCalled();
    respostas["PATCH /api/orcamentos/o1/vendedor"] = { status: 200, corpo: { vendedor: { id: "uP", nome: "Paula Pessoa" } } };
    await clicar(confirmar);
    expect(chamadas.filter((c) => c.metodo === "PATCH").at(-1)).toEqual({ url: "/api/orcamentos/o1/vendedor", metodo: "PATCH", corpo: { vendedorId: "uP", motivo: "Carteira nova" } });
    expect(roteador.refresh).toHaveBeenCalled();
  });
});

describe("Configurações › Comissões", () => {
  const regra = (x: Record<string, unknown>) => ({ quemTipo: "TODOS", usuarioId: null, cargoId: null, papel: "VENDEDOR", sobreTipo: "TODOS_SERVICOS", categoria: null, servicoId: null, base: "PERC_VENDA", valor: 2, ativo: true, nomes: { pessoa: null, cargo: null, servico: null }, ...x });
  const DADOS = {
    regras: [
      regra({ id: "r1" }),
      regra({ id: "r2", quemTipo: "CARGO", cargoId: "cg", sobreTipo: "CATEGORIA", categoria: "Instalação", valor: 5, nomes: { pessoa: null, cargo: "Vendedores", servico: null } }),
      regra({ id: "r3", sobreTipo: "PECAS", base: "FIXO_ITEM", valor: 10, ativo: false }),
    ],
    config: { quando: "RECEBIMENTO", liquidaImpostos: false },
    opcoes: { pessoas: [{ id: "uA", nome: "Ana" }], cargos: [{ id: "cg", nome: "Vendedores" }], servicos: [{ id: "s1", nome: "Limpeza" }], categorias: ["Instalação", "Manutenção"] },
  };
  const abrir = async (dados: any = DADOS) => {
    const { ComissoesClient } = await import("@/components/config/comissoes-client");
    await montar(createElement(ComissoesClient, { inicial: dados }));
  };

  it("as regras em linhas (descrição + resumo), o exemplo da precedência e a regra desativada marcada", async () => {
    await abrir();
    expect($$("[data-regra]").map((l) => texto(l.querySelector("p")))).toEqual([
      "Todos · Todos os serviços · 2% da venda", "Vendedores (cargo) · Instalação (categoria) · 5% da venda", "Todos · Peças · R$ 10,00 por item",
    ]);
    expect(texto($("[data-regra='r3']"))).toContain("Desativada");
    expect($$("[data-ordem-precedencia] li").map((l) => texto(l))).toEqual([
      "1. Pessoa + um serviço", "2. Cargo + um serviço", "3. Pessoa + categoria", "4. Cargo + categoria", "5. Pessoa + todos os serviços (o fixo)", "6. Cargo + todos os serviços",
    ]);
    expect(texto($("[data-exemplo-precedencia]"))).toContain("Ana tem 7% fixo");
  });

  it("empresa sem regra: o aviso de que nada de comissão aparece", async () => {
    await abrir({ ...DADOS, regras: [] });
    expect(texto($("[data-sem-regras]"))).toMatch(/Sem regra, ninguém ganha comissão/);
  });

  it("nova regra: campos conforme o tipo; Executor e Responsável ainda desligados; manda o POST; erro do servidor no diálogo", async () => {
    await abrir();
    await clicar($("[data-nova-regra]"));
    expect($("[data-campo-cargo]")).toBeNull();
    const papeis = $$<HTMLOptionElement>("[data-campo-papel] option").map((o) => [o.textContent, o.disabled]);
    expect(papeis).toEqual([["Vendedor", false], ["Executor (em breve)", true], ["Responsável (em breve)", true]]);
    await escolher($("[data-campo-quem]"), "CARGO");
    await escolher($("[data-campo-cargo]"), "cg");
    await escolher($("[data-campo-sobre]"), "SERVICO");
    await escolher($("[data-campo-servico]"), "s1");
    await escolher($("[data-campo-base]"), "PERC_LUCRO");
    expect(texto($("[data-form-regra]"))).toContain("Calculado no servidor com o custo");
    await digitar($("[data-campo-valor]"), "7,5");
    respostas["POST /api/comissoes/regras"] = { status: 409, corpo: { erro: "Já existe uma regra ativa para a mesma pessoa/cargo e o mesmo alvo. Edite a que existe." } };
    await clicar($("[data-salvar-regra]"));
    expect(texto($("[data-erro-regra]"))).toMatch(/Já existe uma regra/);
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ quemTipo: "CARGO", usuarioId: null, cargoId: "cg", papel: "VENDEDOR", sobreTipo: "SERVICO", categoria: null, servicoId: "s1", base: "PERC_LUCRO", valor: 7.5 });
  });

  it("desativar uma regra manda o PATCH com ativo=false e recarrega; a configuração só salva com mudança", async () => {
    respostas["GET /api/comissoes"] = { status: 200, corpo: DADOS };
    await abrir();
    await clicar($("[data-regra='r1'] [data-alternar-regra]"));
    expect(chamadas.find((c) => c.metodo === "PATCH")).toMatchObject({ url: "/api/comissoes/regras/r1", corpo: { ativo: false, quemTipo: "TODOS", valor: 2 } });
    expect(chamadas.some((c) => c.metodo === "GET" && c.url === "/api/comissoes")).toBe(true);
    const salvar = $<HTMLButtonElement>("[data-salvar-config-comissao]")!;
    expect(salvar.disabled).toBe(true);
    await escolher($("[data-comissao-quando]"), "CONCLUSAO_OS");
    expect(salvar.disabled).toBe(false);
    await clicar(salvar);
    expect(chamadas.find((c) => c.metodo === "PUT")).toEqual({ url: "/api/comissoes", metodo: "PUT", corpo: { quando: "CONCLUSAO_OS", liquidaImpostos: false } });
  });
});

describe("Meu perfil — Minhas comissões", () => {
  const initial = { nome: "Vitor Vendas", email: "v@ficticio.test", telefone: "", avatar: null, empresaNome: "Clima Fictícia", perfilNome: null, cargo: "Operador", ultimoAcesso: null };
  const EXTRATO = {
    ativo: true, totais: { prevista: 30, liberada: 20, paga: 50 },
    vendas: [{ orcamentoId: "o1", codigo: "ORC-1", nome: "Instalação fictícia", cliente: "Hospital Fictício", osNumero: "OS-7", prevista: 30, liberada: 20, paga: 50, itens: [{ descricao: "Instalação split", regra: "Vendedores (cargo) · Instalação (categoria) · 5% do lucro", valor: 100 }] }],
  };

  it("empresa sem comissão: nada de aba Comissões", async () => {
    respostas["GET /api/perfil/comissoes"] = { status: 200, corpo: { ativo: false } };
    const { PerfilClient } = await import("@/components/perfil/perfil-client");
    await montar(createElement(PerfilClient, { initial }));
    expect($$("[data-aba]").map((b) => b.textContent)).toEqual(["Dados", "Segurança"]);
  });

  it("com comissão: a aba aparece; ?aba=comissoes abre nela; o extrato (prevista/liberada/paga) sem custo nem base", async () => {
    respostas["GET /api/perfil/comissoes?so=ativo"] = { status: 200, corpo: { ativo: true } };
    respostas["GET /api/perfil/comissoes"] = { status: 200, corpo: EXTRATO };
    const { PerfilClient } = await import("@/components/perfil/perfil-client");
    await montar(createElement(PerfilClient, { initial, abaPedida: "comissoes" }));
    expect($$("[data-aba]").map((b) => b.textContent)).toEqual(["Dados", "Segurança", "Comissões"]);
    expect($("[data-aba='comissoes']")!.getAttribute("aria-current")).toBe("page");
    expect($$("[data-total]").map((t) => [...t.querySelectorAll("p")].map((x) => texto(x).replace(/\s/g, " ")).join(" "))).toEqual(["Prevista R$ 30,00", "Liberada R$ 20,00", "Paga R$ 50,00"]);
    expect(texto($("[data-venda-comissao='o1']"))).toContain("ORC-1 · Instalação fictícia");
    await clicar($("[data-venda-comissao='o1'] button"));
    expect(texto($("[data-itens-comissao]"))).toContain("5% do lucro");
    expect(texto($("[data-minhas-comissoes]"))).not.toMatch(/custo|margem/i);
  });
});

describe("folha do mês com comissões", () => {
  const folha = (comissao = true) => ({
    linhas: [
      { tecnicoId: "t1", nome: "Ana Dias", perfil: "Preventiva", posicao: 1, escore: 90, faixa: "Ouro", valor: 300, ...(comissao ? { usuarioId: "uA", comissao: 50 } : {}) },
      ...(comissao ? [{ tecnicoId: null, usuarioId: "uZ", nome: "Zé Vendas", perfil: "Comissão", posicao: null, escore: null, faixa: null, valor: 0, comissao: 20 }] : []),
    ],
    total: 300, ...(comissao ? { totalComissao: 70 } : {}),
  });
  const abrir = async (comissoes: boolean) => {
    respostas["GET /api/desempenho/fechamentos?mes=2026-10"] = { status: 200, corpo: { mes: { competencia: "2026-10", situacao: "ABERTO", bloqueio: null, avisos: [], folha: folha(comissoes), premios: [], fechamento: null, comissoes, bonus: true }, historico: [] } };
    const { FechamentoDesempenho } = await import("@/components/desempenho/fechamento-client");
    await montar(createElement(FechamentoDesempenho, { mesInicial: "2026-10", mesAtual: "2026-11", pode: { revisar: true, gerenciar: true } }));
  };

  it("com comissão: 'Folha de bônus e comissões', colunas Comissão e Total, total geral; quem só tem comissão aparece", async () => {
    await abrir(true);
    expect(texto($("[data-folha] h2"))).toContain("Folha de bônus e comissões");
    expect(texto($("[data-tabela-folha] thead"))).toMatch(/Comissão.*Total/);
    expect($$("[data-tabela-folha] [data-linha-folha]").map((l) => [texto(l.querySelector("[data-folha-nome]")), texto(l.querySelector("[data-folha-comissao]")), texto(l.querySelector("[data-folha-total-linha]"))].join("|").replace(/\s/g, " ")))
      .toEqual(["Ana Dias|R$ 50,00|R$ 350,00", "Zé Vendas|R$ 20,00|R$ 20,00"]);
    expect(texto($("[data-folha-total]")).replace(/\s/g, " ")).toBe("R$ 370,00");
    // O diálogo de fechar mostra o total de comissões e avisa das contas a pagar
    await clicar($("[data-fechar]"));
    expect(texto($("[data-fechar-total-comissao]")).replace(/\s/g, " ")).toBe("R$ 70,00");
    expect(texto($("[data-fechar-contas]"))).toMatch(/conta a pagar/);
  });

  it("comissões do mês por data de emissão ou de recebimento: abre na vista da configuração; trocar pede a outra; diz o que o fechamento paga", async () => {
    const relatorio = (vista: string, valor: number) => ({
      competencia: "2026-10", vista, quando: "RECEBIMENTO", total: valor,
      pessoas: [{ usuarioId: "uA", nome: "Ana Dias", valor, vendas: [{ orcamentoId: "o1", codigo: "ORC-1", nome: "Venda fictícia", cliente: "Cliente Fictício", data: "2026-10-12T12:00:00.000Z", valor }] }],
    });
    respostas["GET /api/comissoes/relatorio?mes=2026-10"] = { status: 200, corpo: relatorio("RECEBIMENTO", 5) };
    respostas["GET /api/comissoes/relatorio?mes=2026-10&vista=EMISSAO"] = { status: 200, corpo: relatorio("EMISSAO", 50) };
    await abrir(true);
    const sec = () => $("[data-relatorio-comissoes]")!;
    expect(sec().querySelector("[data-aba='RECEBIMENTO']")!.getAttribute("aria-current")).toBe("page");
    expect(texto(sec().querySelector("[data-paga-por]"))).toBe("O fechamento paga por data de recebimento.");
    expect(texto(sec().querySelector("[data-relatorio-total]")).replace(/\s/g, " ")).toBe("R$ 5,00");
    await clicar(sec().querySelector("[data-aba='EMISSAO']"));
    expect(chamadas.some((c) => c.url === "/api/comissoes/relatorio?mes=2026-10&vista=EMISSAO")).toBe(true);
    expect(texto(sec().querySelector("[data-relatorio-total]")).replace(/\s/g, " ")).toBe("R$ 50,00");
    await clicar(sec().querySelector("[data-relatorio-pessoa='uA'] button"));
    expect(texto(sec().querySelector("[data-relatorio-vendas]"))).toContain("ORC-1 · Venda fictícia");
  });

  it("sem comissão na empresa: a folha de bônus como sempre foi (sem as colunas novas)", async () => {
    await abrir(false);
    expect(texto($("[data-folha] h2"))).toBe("Folha de bônus");
    expect(texto($("[data-tabela-folha] thead"))).not.toMatch(/Comissão/);
    expect($("[data-folha-total-comissao]")).toBeNull();
  });
});
