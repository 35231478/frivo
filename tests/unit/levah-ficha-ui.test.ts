// @vitest-environment happy-dom
/**
 * Leva H — Ficha do cliente profissional, na tela:
 *  - cabeçalho: voltar, nome e só os sinais que importam; "Inadimplente" só com atraso (link só para quem vê o
 *    contas a receber); o botão único "Novo ▾" na consulta; na edição, só Cancelar / Salvar;
 *  - abas Dados · Endereços · Histórico · Atendimento · Comunicação · Portal · Anexos (links antigos de
 *    "Relacionamento" abrem o Histórico);
 *  - histórico automático: carrega ao abrir a aba, filtra por tipo, agrupa por mês, diz quando não há nada;
 *  - endereço principal: o Consultar do CNPJ preenche só os campos vazios; o CEP completo busca a rua;
 *  - endereços (locais): quem não edita o cliente só vê a lista; no cliente novo, o principal vem do cadastro;
 *  - "exigir endereço" da empresa: o endereço principal atende (vira o local Principal ao salvar).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[], replace: [] as string[] }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<typeof import("@/components/ui/avisos")>()), toast: () => {} }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp, usePathname: () => "/",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: (u: string) => nav.replace.push(u), refresh: () => {}, back: () => {} }),
}));

let rotas: Record<string, { status?: number; corpo: unknown }> = {};
let chamadas: { metodo: string; url: string; corpo?: any }[] = [];
let root: Root; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = <T extends Element = HTMLElement>(sel: string, base: ParentNode = caixa) => base.querySelector(sel) as T | null;
const $$ = (sel: string, base: ParentNode = caixa) => [...base.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); }
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
}
const valor = (nome: string) => ($(`[name="${nome}"]`) as HTMLInputElement | null)?.value;

async function montar(props: Record<string, unknown>, permissoes: Permissoes = permissoesTotais(), role = "OPERADOR") {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role, permissoes, children: createElement(ClienteForm, props as any) })); });
  await flush();
}

beforeEach(() => {
  nav.sp = new URLSearchParams(); nav.push = []; nav.replace = [];
  rotas = {}; chamadas = [];
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = String(u);
    chamadas.push({ metodo, url, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = rotas[`${metodo} ${url}`];
    return new Response(JSON.stringify(r?.corpo ?? (url.includes("/historico") ? { eventos: [] } : {})), { status: r?.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); document.body.innerHTML = ""; });

const CLIENTE: any = {
  id: "cl1", nome: "Hospital Santa Luzia Ltda", nomeFantasia: "Santa Luzia", tipoPessoa: "JURIDICA", cpfCnpj: "11222333000181",
  ativo: true, statusFinanceiro: "ADIMPLENTE", logo: null, cidade: "São Paulo", estado: "SP",
  unidades: [
    { id: "u1", nome: "Matriz", principal: true, ativo: true, logradouro: "Rua das Acácias", numero: "250", bairro: "Jardim", cidade: "São Paulo", estado: "SP" },
    { id: "u2", nome: "Anexo", principal: false, ativo: true, logradouro: "Rua dos Ipês", numero: "80", cidade: "São Paulo", estado: "SP" },
  ],
  anexos: [], contatosCliente: [], unidadesInativas: [], contatosInativos: [], _count: { contratos: 0 },
};

describe("cabeçalho da ficha: só o que importa", () => {
  it("nome (fantasia), razão social · CNPJ · cidade, e nenhum sinal quando está tudo em dia", async () => {
    await montar({ initialData: CLIENTE, consulta: true, valorEmAtraso: 0, totalProximos30Dias: 0 });
    expect(txt($("[data-titulo-cliente]"))).toBe("Santa Luzia");
    expect(txt($("[data-subtitulo-cliente]"))).toBe("Hospital Santa Luzia Ltda · 11.222.333/0001-81 · São Paulo/SP");
    expect($("[data-sinais-cliente]")).toBeNull();
    // o antigo selo "Adimplente"/"Sem contratos"/"Ativo" não aparece
    expect(txt($("[data-cabecalho-cliente]"))).not.toMatch(/Adimplente|Sem contratos|\bAtivo\b|Sem histórico/);
    expect($("[data-voltar-cliente]")!.getAttribute("href")).toBe("/clientes");
  });

  it("sem nome fantasia (ou igual à razão social), a razão social não se repete no subtítulo", async () => {
    await montar({ initialData: { ...CLIENTE, nomeFantasia: "Hospital Santa Luzia Ltda" }, consulta: true });
    expect(txt($("[data-titulo-cliente]"))).toBe("Hospital Santa Luzia Ltda");
    expect(txt($("[data-subtitulo-cliente]"))).toBe("11.222.333/0001-81 · São Paulo/SP");
    await act(async () => root.unmount()); caixa.remove();
    await montar({ initialData: { ...CLIENTE, nomeFantasia: null }, consulta: true });
    expect(txt($("[data-subtitulo-cliente]"))).toBe("11.222.333/0001-81 · São Paulo/SP");
  });

  it("inadimplente com o valor; contratos e a receber só com valor; link às vencidas só com o contas a receber", async () => {
    const dados = { ...CLIENTE, _count: { contratos: 2 } };
    await montar({ initialData: dados, consulta: true, valorEmAtraso: 2950, totalProximos30Dias: 1200 }, montarPermissoes({ clientes: ["visualizar"], financeiro: ["contasReceber"] }));
    expect($$("[data-sinal]").map((s) => [s.getAttribute("data-sinal"), txt(s)])).toEqual([
      ["inadimplente", "Inadimplente · R$ 2.950,00 em atraso"],
      ["contratos", "2 contratos ativos"],
      ["aReceber", "A receber em 30 dias · R$ 1.200,00"],
    ]);
    expect($('[data-sinal="inadimplente"]')!.closest("a")!.getAttribute("href")).toBe("/financeiro/contas-receber?clienteId=cl1&card=VENCIDO&periodo=todos");
    await act(async () => root.unmount()); caixa.remove();
    await montar({ initialData: dados, consulta: true, valorEmAtraso: 2950 }, montarPermissoes({ clientes: ["visualizar"] }));
    expect($('[data-sinal="inadimplente"]')!.closest("a")).toBeNull(); // sem o financeiro: o aviso, sem o link
  });

  it("consulta: Editar mantém a aba; Inativar à vista; sem permissão de editar, nem Editar", async () => {
    nav.sp = new URLSearchParams();
    await montar({ initialData: CLIENTE, consulta: true, abaInicial: "enderecos" });
    expect($("[data-editar-cliente]")!.getAttribute("href")).toBe("/clientes/cl1/editar?aba=enderecos");
    expect($('[data-inativar-registro="inativar"]')).toBeTruthy();
    await act(async () => root.unmount()); caixa.remove();
    await montar({ initialData: CLIENTE, consulta: true }, montarPermissoes({ clientes: ["visualizar"] }));
    expect($("[data-editar-cliente]")).toBeNull();
    expect($("[data-inativar-registro]")).toBeNull();
  });

  it("edição: Cancelar / Salvar e continuar / Salvar no topo; nada de barra repetida embaixo; voltar leva à ficha na mesma aba", async () => {
    await montar({ initialData: CLIENTE, abaInicial: "enderecos" });
    const acoes = $("[data-acoes-cliente]")!;
    expect($$("button", acoes).map(txt)).toEqual(["Cancelar", "Salvar e continuarContinuar", "Salvar"]);
    expect($$("button").filter((b) => txt(b) === "Salvar").length).toBe(1);
    expect($("[data-menu-novo]")).toBeNull();
    expect($("[data-voltar-cliente]")!.getAttribute("href")).toBe("/clientes/cl1?aba=enderecos");
    await clicar($$("button", acoes)[0]);
    expect(nav.push).toEqual(["/clientes/cl1?aba=enderecos"]);
  });

  it("cliente novo: título \"Novo cliente\", sem Histórico/Atendimento/Comunicação (só existem depois de salvar)", async () => {
    await montar({ abaInicial: "historico" }); // pedir uma aba que o novo não tem: abre em Dados
    expect($('[data-aba="geral"]')!.getAttribute("aria-selected")).toBe("true");
    expect(txt($("[data-titulo-cliente]"))).toBe("Novo cliente");
    expect($$("[data-abas-cliente] button").map(txt)).toEqual(["Dados", "Endereços", "Portal", "Anexos"]);
    expect($("[data-voltar-cliente]")!.getAttribute("href")).toBe("/clientes");
  });

  it("o \"Novo ▾\" abre no <body> com os itens do perfil, cada um com o cliente já escolhido", async () => {
    await montar({ initialData: CLIENTE, consulta: true }, montarPermissoes({ clientes: ["visualizar"], orcamentos: ["criar"], contratos: ["criar"] }));
    await clicar($("[data-menu-novo]"));
    const menu = document.querySelector("[data-menu-acoes]")!;
    expect(caixa.contains(menu)).toBe(false);
    expect([...menu.querySelectorAll("[data-item]")].map((a) => [txt(a), a.getAttribute("href")])).toEqual([
      ["Orçamento", "/orcamentos/novo?clienteId=cl1"],
      ["Contrato", "/contratos/novo?clienteId=cl1"],
    ]);
  });
});

describe("abas e histórico automático", () => {
  const EVENTOS = [
    { id: "a", tipo: "os", titulo: "OS OS-9 criada", detalhe: "Preventiva", quando: "2026-11-20T12:00:00Z", href: "/ordens/o9", autor: "Ana" },
    { id: "b", tipo: "portal", titulo: "Cliente abriu o orçamento ORC-1", quando: "2026-11-02T12:00:00Z", href: "/orcamentos/x" },
    { id: "c", tipo: "nota", titulo: "Ligação", detalhe: "Pediu visita", quando: "2026-10-15T12:00:00Z", autor: "Ana" },
    { id: "d", tipo: "os", titulo: "OS OS-8 concluída", quando: "2026-10-01T12:00:00Z" },
  ];

  it("?aba=relacionamento (link antigo) abre o Histórico; ele só busca ao abrir a aba", async () => {
    rotas["GET /api/clientes/cl1/historico"] = { corpo: { eventos: EVENTOS } };
    await montar({ initialData: CLIENTE, consulta: true, abaInicial: "relacionamento" });
    expect($('[data-aba="historico"]')!.getAttribute("aria-selected")).toBe("true");
    expect(chamadas.filter((c) => c.url.includes("/historico")).length).toBe(1);
    await act(async () => root.unmount()); caixa.remove();
    chamadas = [];
    await montar({ initialData: CLIENTE, consulta: true });
    expect(chamadas.filter((c) => c.url.includes("/historico")).length).toBe(0);
    await clicar($('[data-aba="historico"]'));
    expect(chamadas.filter((c) => c.url.includes("/historico")).length).toBe(1);
    await clicar($('[data-aba="geral"]'));
    await clicar($('[data-aba="historico"]'));
    expect(chamadas.filter((c) => c.url.includes("/historico")).length).toBe(1); // não busca de novo
  });

  it("linha do tempo por mês; filtro por tipo com contagem; o título leva ao registro; autor e detalhe juntos", async () => {
    rotas["GET /api/clientes/cl1/historico"] = { corpo: { eventos: EVENTOS } };
    await montar({ initialData: CLIENTE, consulta: true, abaInicial: "historico" });
    expect($$("[data-filtro]").map((b) => [b.getAttribute("data-filtro"), txt(b)])).toEqual([
      ["todos", "Tudo4"], ["os", "Ordens de serviço2"], ["portal", "Ações do cliente1"], ["nota", "Notas1"],
    ]);
    expect($$("[data-mes]").map((s) => [s.getAttribute("data-mes"), txt(s.querySelector("h3"))])).toEqual([["2026-11", "Novembro de 2026"], ["2026-10", "Outubro de 2026"]]);
    const primeiro = $("[data-evento]")!;
    expect($("a[data-evento-titulo]", primeiro)!.getAttribute("href")).toBe("/ordens/o9");
    expect(txt(primeiro)).toContain("Preventiva · por Ana");
    await clicar($('[data-filtro="os"]'));
    expect($('[data-filtro="os"]')!.getAttribute("aria-pressed")).toBe("true");
    expect($$("[data-evento-titulo]").map(txt)).toEqual(["OS OS-9 criada", "OS OS-8 concluída"]);
    expect($$("p[data-evento-titulo]").map(txt)).toEqual(["OS OS-8 concluída"]); // sem link: texto
    await clicar($('[data-filtro="todos"]'));
    expect($$("[data-evento]").length).toBe(4);
  });

  it("um tipo só: sem a fila de filtros; nada registrado: diz isso; falha: pede para recarregar", async () => {
    rotas["GET /api/clientes/cl1/historico"] = { corpo: { eventos: [EVENTOS[0]] } };
    await montar({ initialData: CLIENTE, consulta: true, abaInicial: "historico" });
    expect($("[data-filtro-historico]")).toBeNull();
    expect($$("[data-evento]").length).toBe(1);
    await act(async () => root.unmount()); caixa.remove();
    rotas["GET /api/clientes/cl1/historico"] = { corpo: { eventos: [] } };
    await montar({ initialData: CLIENTE, consulta: true, abaInicial: "historico" });
    expect(txt($("[data-historico-vazio]"))).toBe("Nada registrado ainda para este cliente.");
    await act(async () => root.unmount()); caixa.remove();
    rotas["GET /api/clientes/cl1/historico"] = { status: 500, corpo: {} };
    await montar({ initialData: CLIENTE, consulta: true, abaInicial: "historico" });
    expect($("[data-historico-erro]")).toBeTruthy();
  });

  it("sem \"Registrar interação\" nem a aba Relacionamento", async () => {
    await montar({ initialData: CLIENTE });
    expect(txt(caixa)).not.toContain("Registrar interação");
    expect($$("[data-abas-cliente] button").map(txt)).not.toContain("Relacionamento");
  });
});

describe("endereço principal: CNPJ e CEP", () => {
  const CNPJ = { nome: "Termofrio Engenharia Ltda", endereco: "Avenida Central", numero: "1000", complemento: "Sala 2", bairro: "Setor Central", cidade: "Goiânia", estado: "GO", cep: "74000-000" };

  it("na edição, o Consultar preenche só os campos vazios do endereço (o que já tinha fica)", async () => {
    rotas["GET /api/cnpj/11222333000181"] = { corpo: CNPJ };
    await montar({ initialData: { ...CLIENTE, endereco: "Rua Velha", numero: "5", cidade: "", estado: "" } });
    await clicar($("[data-consultar-cnpj]"));
    expect([valor("endereco"), valor("numero"), valor("complemento"), valor("bairro"), valor("cidade"), valor("estado"), valor("cep")])
      .toEqual(["Rua Velha", "5", "Sala 2", "Setor Central", "Goiânia", "GO", "74000-000"]);
  });

  it("CEP completo: formata, busca uma vez e preenche rua, bairro, cidade e UF", async () => {
    rotas["GET https://viacep.com.br/ws/01310100/json/"] = { corpo: { logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP", complemento: "" } };
    await montar({});
    await digitar($('input[name="cep"]'), "0131010");
    expect(chamadas.some((c) => c.url.includes("viacep"))).toBe(false); // incompleto: não busca
    await digitar($('input[name="cep"]'), "01310100");
    expect(valor("cep")).toBe("01310-100");
    expect([valor("endereco"), valor("bairro"), valor("cidade"), valor("estado")]).toEqual(["Avenida Paulista", "Bela Vista", "São Paulo", "SP"]);
    expect(chamadas.filter((c) => c.url.includes("viacep")).length).toBe(1);
    await digitar($('input[name="cep"]'), "01310-10"); // apaga um dígito e volta ao mesmo CEP: não busca outra vez
    await digitar($('input[name="cep"]'), "01310-100");
    expect(chamadas.filter((c) => c.url.includes("viacep")).length).toBe(1);
  });

  it("cliente que já tem CEP: abrir a edição não dispara busca", async () => {
    await montar({ initialData: { ...CLIENTE, cep: "01310-100" } });
    await digitar($('input[name="cep"]'), "01310-10");
    await digitar($('input[name="cep"]'), "01310-100");
    expect(chamadas.some((c) => c.url.includes("viacep"))).toBe(false);
  });
});

describe("endereços (locais de atendimento)", () => {
  it("na consulta, quem edita o cliente adiciona, edita e inativa daqui; quem só vê, só a lista", async () => {
    await montar({ initialData: CLIENTE, consulta: true, abaInicial: "enderecos" });
    expect($$("[data-endereco]").map((li) => li.getAttribute("data-endereco"))).toEqual(["u1", "u2"]);
    expect($("[data-novo-endereco]")).toBeTruthy();
    expect($('[data-editar-endereco="u2"]')).toBeTruthy();
    await act(async () => root.unmount()); caixa.remove();
    await montar({ initialData: CLIENTE, consulta: true, abaInicial: "enderecos" }, montarPermissoes({ clientes: ["visualizar"] }));
    expect($$("[data-endereco]").length).toBe(2);
    expect($("[data-novo-endereco]")).toBeNull();
    expect($("[data-editar-endereco]")).toBeNull();
    expect(txt($('[data-endereco="u1"]'))).toContain("Rua das Acácias, 250 · Jardim · São Paulo/SP");
  });

  it("cliente novo com endereço principal: o aviso do local Principal, e os locais extras entram sem selo Principal", async () => {
    await montar({ abaInicial: "enderecos" });
    expect($("[data-principal-automatico]")).toBeNull();
    await digitar($('input[name="cidade"]'), "Goiânia");
    expect(txt($("[data-principal-automatico]"))).toBe("O endereço principal vira o local “Principal” ao salvar.");
    await clicar($("[data-novo-endereco]"));
    expect((caixa.querySelector('input[placeholder="Ex: Matriz, Filial, Depósito"]') as HTMLInputElement).value).toBe("");
  });

  it("\"exigir endereço\" da empresa: sem endereço principal nem local, não salva; com o principal, salva", async () => {
    rotas["GET /api/configuracoes"] = { corpo: { clienteExigirUnidade: true } };
    rotas["POST /api/clientes"] = { status: 201, corpo: { id: "novo" } };
    await montar({});
    await digitar($('input[name="cpfCnpj"]'), "11.222.333/0001-81");
    await digitar($('input[name="nome"]'), "Clínica Nova");
    await clicar($("[data-salvar-cliente]"));
    expect(txt($('[role="alert"]'))).toBe("Preencha o endereço principal ou adicione um local de atendimento (configuração da empresa).");
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    await digitar($('input[name="endereco"]'), "Rua A");
    await clicar($("[data-salvar-cliente]"));
    const post = chamadas.find((c) => c.metodo === "POST" && c.url === "/api/clientes")!;
    expect(post.corpo).toMatchObject({ endereco: "Rua A", unidades: [] });
    expect(nav.push).toEqual(["/clientes/novo?criado=1"]);
  });

  it("Salvar e continuar no cliente novo segue na edição dele", async () => {
    rotas["POST /api/clientes"] = { status: 201, corpo: { id: "novo" } };
    await montar({});
    await digitar($('input[name="cpfCnpj"]'), "11.222.333/0001-81");
    await digitar($('input[name="nome"]'), "Clínica Nova");
    await clicar($("[data-salvar-continuar]"));
    expect(nav.push).toEqual(["/clientes/novo/editar?criado=1"]);
  });
});

describe("chegando com ?criado=1", () => {
  it("na ficha (consulta) a URL limpa volta para a ficha; na edição, para a edição", async () => {
    nav.sp = new URLSearchParams("criado=1");
    await montar({ initialData: CLIENTE, consulta: true });
    expect(nav.replace).toEqual(["/clientes/cl1"]);
    await act(async () => root.unmount()); caixa.remove();
    nav.replace = [];
    await montar({ initialData: CLIENTE });
    expect(nav.replace).toEqual(["/clientes/cl1/editar"]);
  });
});
