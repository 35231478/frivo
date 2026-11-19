// @vitest-environment happy-dom
/**
 * Loja de Módulos — leva ESTOQUE, as telas num DOM de verdade. O que se prova é o PADRÃO DOS
 * CAMPOS-PONTE, que vale daqui em diante em cada leva:
 *
 *   o campo que pertence a um módulo DESLIGADO some da tela do núcleo — em vez de ficar órfão,
 *   vazio, oferecendo um cadastro que aquela empresa não tem; e o que é do NÚCLEO fica.
 *
 *  - Frota desligada: o veículo some do formulário de equipe, do colaborador e da execução da OS;
 *  - Estoque desligado: somem da OS a separação, a reserva e a devolução (ponte com o razão), e
 *    FICAM a lista de material e o consumo informado — o custo do material é da OS, não do módulo;
 *  - Compras desligado: o pedido que já existe continua à vista; o botão de criar some;
 *  - o menu perde os itens do Estoque e mantém o núcleo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModulosProvider } from "@/components/providers/modulos-provider";
import { permissoesTotais } from "@/lib/permissoes";
import { resumoSeparacao } from "@/lib/estoque/separacao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-auto-geocode", () => ({ useAutoGeocode: () => {} }));
vi.mock("@/components/ui/avisos", async (original) => ({
  ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true),
}));

let raiz: Root;
let caixa: HTMLDivElement;

const RESPOSTAS: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(RESPOSTAS)) delete RESPOSTAS[k];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const chave = Object.keys(RESPOSTAS).find((k) => String(url).startsWith(k));
    const corpo = chave ? RESPOSTAS[chave] : [];
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => raiz?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const tela = () => txt(document.body);

/** Monta com os dois providers da casa: o que o usuário PODE e o que a empresa TEM. */
async function montar(el: ReactElement, desligados: string[] = []) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); raiz = createRoot(caixa);
  await act(async () => {
    raiz.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(),
      children: createElement(ModulosProvider as any, { desligados }, el) }));
  });
  await esperar();
}

/* ═════════ Frota: o veículo some dos formulários do núcleo ═════════ */

describe("Frota desligada: o campo veículo some (não fica vazio e órfão)", () => {
  const VEICULOS = [
    { id: "v1", placa: "ABC1D23", modelo: "Saveiro", marca: "VW", status: "ATIVO", equipe: null },
    { id: "v2", placa: "XYZ9A88", modelo: "Strada", marca: "Fiat", status: "ATIVO", equipe: null },
  ];

  it("formulário de EQUIPE: com a Frota ligada o bloco aparece; desligada, some — e o resto do formulário fica", async () => {
    RESPOSTAS["/api/veiculos"] = VEICULOS;
    RESPOSTAS["/api/tecnicos"] = [];
    const { EquipeForm } = await import("@/components/forms/equipe-form");

    await montar(createElement(EquipeForm as any, {}), []);
    expect($("[data-veiculos-equipe]")).toBeTruthy();
    expect(tela()).toContain("Veículos da equipe");
    expect(tela()).toContain("Membros");

    act(() => raiz.unmount()); caixa.remove();
    await montar(createElement(EquipeForm as any, {}), ["veiculos"]);
    expect($("[data-veiculos-equipe]")).toBeNull();
    expect(tela()).not.toContain("Veículos da equipe");
    expect(tela()).toContain("Membros"); // o que é do núcleo continua
  });

  it("formulário de COLABORADOR: o seletor 'Veículo padrão' some com a Frota desligada", async () => {
    RESPOSTAS["/api/veiculos?resumo=1"] = VEICULOS;
    const { ColaboradorForm } = await import("@/components/forms/colaborador-form");

    await montar(createElement(ColaboradorForm as any, {}), []);
    expect($('[aria-label="Veículo padrão"]')).toBeTruthy();

    act(() => raiz.unmount()); caixa.remove();
    await montar(createElement(ColaboradorForm as any, {}), ["veiculos"]);
    expect($('[aria-label="Veículo padrão"]')).toBeNull();
    expect(tela()).not.toContain("Veículo padrão");
  });

  it("execução da OS: o seletor de veículo some, e quem executa (núcleo) continua", async () => {
    const { SeletorExecucao, VALOR_EXECUCAO_VAZIO } = await import("@/components/os/seletor-execucao");
    const opcoes: any = { tecnicos: [], equipes: [], veiculos: VEICULOS, carregando: false, adicionarTecnico: vi.fn(), marcarCompetencia: vi.fn() };
    const props: any = { opcoes, valor: VALOR_EXECUCAO_VAZIO, onChange: vi.fn() };

    await montar(createElement(SeletorExecucao as any, props), []);
    expect($("[data-seletor-veiculo]")).toBeTruthy();
    expect($("[data-seletor-execucao]")).toBeTruthy();

    act(() => raiz.unmount()); caixa.remove();
    await montar(createElement(SeletorExecucao as any, props), ["veiculos"]);
    expect($("[data-seletor-veiculo]")).toBeNull();
    expect($("[data-seletor-execucao]")).toBeTruthy(); // quem executa é do núcleo
  });
});

/* ═════════ Estoque: some a ponte com o razão, fica o material do serviço ═════════ */

describe("Estoque desligado na OS: some a ponte com o razão, fica o material do serviço", () => {
  const M = (id: string, descricao: string, quantidade: number, separada: number, extra: Record<string, unknown> = {}): any => ({
    id, produtoId: `p-${id}`, descricao, unidade: "un", quantidade, quantidadeSeparada: separada,
    quantidadeConsumida: 0, quantidadeDevolvida: 0, consumoInformado: false,
    estadoSeparacao: separada > 0 ? "SEPARADO" : null, item: "Instalação split", kitNome: null,
    separadoEm: separada > 0 ? "2026-11-07T12:00:00.000Z" : null, separadoPor: separada > 0 ? "Zé do Almoxarifado" : null,
    consumidoEm: null, consumidoPor: null, devolvidoEm: null, devolvidoPor: null, ...extra,
  });
  const MATERIAIS = [M("mGas", "Gás R410A", 3, 3), M("mCap", "Capacitor 35uF", 2, 0)];
  it("COM Estoque (o padrão de hoje): separação, atalhos e o contador 'Separado de' estão lá", async () => {
    const { OsSeparacao } = await import("@/components/os/os-separacao");
    await montar(createElement(OsSeparacao as any, { osId: "os1", materiais: MATERIAIS, resumo: resumoSeparacao(MATERIAIS), podeSeparar: true, podeConsumir: true }), []);
    expect($('[data-acao="ir-separar"]')).toBeTruthy();
    expect($("[data-resumo-separacao]")).toBeTruthy();
    expect($("[data-separado-de]")).toBeTruthy();
    expect($("[data-previsto-de]")).toBeNull();
  });

  it("SEM Estoque: separar, devolver e o estado da separação somem", async () => {
    const { OsSeparacao } = await import("@/components/os/os-separacao");
    await montar(createElement(OsSeparacao as any, { osId: "os1", materiais: MATERIAIS, resumo: resumoSeparacao(MATERIAIS), podeSeparar: true, podeConsumir: true, temEstoque: false }), ["estoque"]);
    expect($('[data-acao="ir-separar"]')).toBeNull();
    expect($('[data-acao="ir-devolver"]')).toBeNull();
    expect($("[data-resumo-separacao]")).toBeNull();
    expect($("[data-separado-de]")).toBeNull();
    expect(tela()).not.toContain("a separar");
    expect(tela()).not.toContain("reservad");
  });

  it("…e o MATERIAL do serviço fica: a lista, o previsto e o 'Informar consumo'", async () => {
    const { OsSeparacao } = await import("@/components/os/os-separacao");
    await montar(createElement(OsSeparacao as any, { osId: "os1", materiais: MATERIAIS, resumo: resumoSeparacao(MATERIAIS), podeSeparar: true, podeConsumir: true, temEstoque: false }), ["estoque"]);
    expect($$("[data-material-estado]")).toHaveLength(2);
    expect(tela()).toContain("Gás R410A");
    expect(tela()).toContain("Material da OS");
    expect($('[data-acao="informar-consumo"]')).toBeTruthy();
    expect($$("[data-previsto-de]")).toHaveLength(2);
  });

  it("sem Estoque, o consumo já vem preenchido com o PREVISTO do item (não há separação para herdar)", async () => {
    const { OsSeparacao } = await import("@/components/os/os-separacao");
    await montar(createElement(OsSeparacao as any, { osId: "os1", materiais: MATERIAIS, resumo: resumoSeparacao(MATERIAIS), podeSeparar: true, podeConsumir: true, temEstoque: false }), ["estoque"]);
    await act(async () => { $('[data-acao="informar-consumo"]')!.click(); });
    await esperar();
    const valores = $$("[data-consumir]").map((e) => (e as HTMLInputElement).value);
    expect(valores).toEqual(["3", "2"]); // o previsto de cada item
  });

  it("com Estoque, o consumo continua herdando o SEPARADO (nada mudou para quem usa o módulo)", async () => {
    const { OsSeparacao } = await import("@/components/os/os-separacao");
    await montar(createElement(OsSeparacao as any, { osId: "os1", materiais: MATERIAIS, resumo: resumoSeparacao(MATERIAIS), podeSeparar: true, podeConsumir: true }), []);
    await act(async () => { $('[data-acao="informar-consumo"]')!.click(); });
    await esperar();
    const valores = $$("[data-consumir]").map((e) => (e as HTMLInputElement).value);
    expect(valores).toEqual(["3", "0"]); // o que foi separado de cada um
  });
});

/* ═════════ Compras: o passado fica, o botão de criar some ═════════ */

describe("Compras desligado: o pedido que existe continua à vista; criar, não", () => {
  const PEDIDOS = [{ id: "pc1", numero: "PC-2026-0041", status: "SOLICITADO", itens: [{ id: "i1", descricao: "Gás R410A", quantidade: 2, unidade: "kg" }] }];

  it("ligado: lista e botão", async () => {
    RESPOSTAS["/api/pedidos-compra"] = PEDIDOS;
    const { ComprasSecao } = await import("@/components/compras/compras-secao");
    await montar(createElement(ComprasSecao as any, { ordemServicoId: "os1" }), []);
    expect(tela()).toContain("PC-2026-0041");
    expect($("[data-solicitar-compra]")).toBeTruthy();
  });

  it("desligado: a lista continua (desligar não apaga o passado) e o botão some", async () => {
    RESPOSTAS["/api/pedidos-compra"] = PEDIDOS;
    const { ComprasSecao } = await import("@/components/compras/compras-secao");
    await montar(createElement(ComprasSecao as any, { ordemServicoId: "os1" }), ["compras", "estoque"]);
    expect(tela()).toContain("PC-2026-0041");
    expect($("[data-solicitar-compra]")).toBeNull();
  });
});

/* ═════════ o menu ═════════ */

describe("O menu perde o Estoque e mantém o núcleo", () => {
  const sessao = () => ({ user: { id: "u1", name: "Gabi", email: "g@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), perfilNome: "Gestor", empresaNome: "Clima Total" } }) as any;
  const botoes = () => [...document.querySelectorAll("aside button")] as HTMLButtonElement[];
  const grupos = () => botoes().filter((b) => b.hasAttribute("aria-expanded") && !b.hasAttribute("aria-haspopup"));

  /** Abre cada grupo do acordeão e junta os endereços que o menu oferece. */
  async function itens(desligados: string[]) {
    const { Sidebar } = await import("@/components/layout/sidebar");
    await montar(createElement(Sidebar as any, { session: sessao(), variant: "desktop" }), desligados);
    const achados = new Set<string>();
    const juntar = () => [...document.querySelectorAll("aside a[href]")].forEach((a) => achados.add(a.getAttribute("href")!));
    juntar();
    for (let i = 0; i < grupos().length; i++) {
      const g = grupos()[i];
      await act(async () => { g.click(); });
      juntar();
    }
    return [...achados];
  }
  const tem = (lista: string[], prefixo: string) => lista.some((h) => h === prefixo || h.startsWith(prefixo + "/"));

  it("tudo ligado: o Estoque está no menu", async () => {
    const lista = await itens([]);
    expect(tem(lista, "/estoque")).toBe(true);
  });

  it("Estoque desligado (e Compras junto, pela dependência): os dois somem; o núcleo fica", async () => {
    act(() => raiz.unmount()); caixa.remove();
    const lista = await itens(["estoque", "compras"]);
    expect(tem(lista, "/estoque")).toBe(false);
    expect(tem(lista, "/compras")).toBe(false);
    for (const nucleo of ["/ordens", "/clientes", "/calendario", "/dashboard"]) {
      expect(tem(lista, nucleo), nucleo).toBe(true);
    }
    expect(tem(lista, "/veiculos")).toBe(true); // a Frota não tem nada com isso
  });
});
