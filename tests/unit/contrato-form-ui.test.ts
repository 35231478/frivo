// @vitest-environment happy-dom
/**
 * Formulário de contrato (contrato-form.tsx real, num DOM de verdade). Prova:
 *  - 5 abas, nesta ordem, cada uma com os campos certos; o que saiu (NFS-e, itens inclusos,
 *    visitas, RT na NFS-e) não aparece em lugar nenhum; Tipo/Periodicidade/ajuste de dia não útil
 *    ficam em "Mais opções";
 *  - descrição dos serviços com limite (maxLength 1000) e contador "x/1000";
 *  - 1º local = endereço do cliente: vem preenchido, tem excluir, não duplica (usa o local que já
 *    existe), e é criado ao salvar; sem permissão de criar endereço, não sugere um novo;
 *  - salvar não manda os campos que saíram; tipo e periodicidade vão com o padrão.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";

const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp,
  usePathname: () => "/contratos/novo",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: () => {}, refresh: () => {} }),
}));

type Resp = unknown | ((init?: RequestInit) => unknown);
let rotas: Record<string, Resp> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const CLIENTE = { id: "c1", nome: "Hotel Mirante", endereco: "Rua A", numero: "10", bairro: "Centro", cidade: "Belo Horizonte", estado: "MG", cep: "30140-000" };

let root: Root;
let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const painel = (id: string) => $(`[data-painel-contrato="${id}"]`)!;
const visivel = (id: string) => !painel(id).hasAttribute("hidden");

async function montar(permissoes: Permissoes = permissoesTotais(), initialData?: any) {
  const { ContratoForm } = await import("@/components/forms/contrato-form");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(ContratoForm, { initialData }) }));
  });
  await flush();
}
async function clicar(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
}
async function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}
const aba = (id: string) => clicar($(`[data-aba-contrato="${id}"]`));

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  nav.sp = new URLSearchParams("clienteId=c1");
  nav.push = [];
  chamadas.length = 0;
  rotas = {
    "GET /api/clientes": [{ id: "c1", nome: "Hotel Mirante" }],
    "GET /api/clientes/c1": CLIENTE,
    "GET /api/unidades?clienteId=c1": [],
    "GET /api/tecnicos?tipo=RESPONSAVEL_TECNICO": [],
    "GET /api/tipos-os": [],
    "GET /api/tecnicos": [],
    "POST /api/unidades": (init?: RequestInit) => ({ id: "u-novo", ...JSON.parse(String(init?.body)) }),
    "POST /api/contratos": { id: "ct-novo" },
  };
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = String(u);
    chamadas.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    const r = rotas[`${metodo} ${url}`];
    if (r === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(typeof r === "function" ? (r as any)(init) : r), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  caixa?.remove();
});

// ═════════════════════════ Abas e campos ═════════════════════════
describe("5 abas com os campos certos", () => {
  it("as 5 abas, nesta ordem; a 1ª aberta", async () => {
    await montar();
    expect($$("[data-aba-contrato]").map((b) => b.textContent?.trim())).toEqual([
      "Contrato", "Escopo e locais", "Recorrência de OS", "Responsável técnico e documentos", "Gestão",
    ]);
    expect(visivel("contrato")).toBe(true);
    expect(["escopo", "recorrencia", "rt", "gestao"].some(visivel)).toBe(false);
  });

  it("aba Contrato: cliente, número (+gerar), status, vigência, valores, faturamento, vencimento; o resto em “Mais opções”", async () => {
    await montar();
    const t = painel("contrato").textContent!;
    for (const campo of ["Cliente", "Número do contrato", "Gerar automático", "Status", "Início da vigência", "Fim da vigência", "Valor mensal", "Valor total", "Dia de faturamento", "Tipo de vencimento", "Mais opções"])
      expect(t).toContain(campo);
    // Recolhidos
    expect($('select[name="tipo"]')).toBeNull();
    expect($('select[name="periodicidade"]')).toBeNull();
    expect(t).not.toContain("Sábados, domingos e feriados");
    await clicar($("[data-mais-opcoes]"));
    expect($('select[name="tipo"]')).toBeTruthy();
    expect($<HTMLSelectElement>('select[name="tipo"]')!.value).toBe("MANUTENCAO_PREVENTIVA");
    expect($<HTMLSelectElement>('select[name="periodicidade"]')!.value).toBe("MENSAL");
    expect(painel("contrato").textContent).toContain("Sábados, domingos e feriados");
  });

  it("periodicidade: o texto diz a verdade (a cobrança sai todo mês) e o detalhe fica na ⓘ, fora de botão", async () => {
    await montar();
    await clicar($("[data-mais-opcoes]"));
    const campo = $<HTMLSelectElement>('select[name="periodicidade"]')!.closest("div")!.parentElement!;
    expect(campo.textContent).toContain("Hoje a cobrança sai todo mês");
    expect(document.body.textContent).not.toContain("De quantos em quantos meses");
    const dica = campo.querySelector<HTMLButtonElement>('button[aria-label*="Periodicidade de cobrança"]')!;
    expect(dica).toBeTruthy();
    expect(dica.parentElement!.closest("button, a")).toBeNull();
    const balao = document.getElementById(dica.getAttribute("aria-describedby")!)!;
    expect(balao.textContent).toContain("saem uma por mês, pelo valor mensal");
    expect(balao.textContent).toContain("ainda não muda o intervalo da cobrança");
  });

  it("cada aba mostra o seu conteúdo", async () => {
    await montar();
    await aba("escopo");
    expect(visivel("escopo") && !visivel("contrato")).toBe(true);
    expect(painel("escopo").textContent).toContain("Descrição dos serviços");
    expect(painel("escopo").textContent).toContain("Locais cobertos");
    await aba("recorrencia");
    expect(painel("recorrencia").textContent).toContain("Recorrência de OS por local");
    await aba("rt");
    const rt = painel("rt").textContent!;
    for (const c of ["Responsável técnico", "Número ART", "Vencimento da ART", "PDF/relatório da OS", "Contrato assinado e anexos"]) expect(rt).toContain(c);
    await aba("gestao");
    const g = painel("gestao").textContent!;
    for (const c of ["Reajuste automático", "Alertas de vencimento", "Renovação automática", "Observações", "Histórico de status"]) expect(g).toContain(c);
  });

  it("o que saiu não aparece em lugar nenhum (NFS-e, itens inclusos, visitas, RT na NFS-e)", async () => {
    await montar();
    await clicar($("[data-mais-opcoes]"));
    const tudo = caixa.textContent!;
    for (const fora of ["NFS-e", "NFSe", "Itens inclusos", "Outros itens inclusos", "visitas", "Período das visitas", "período de referência", "Configurações da NFS-e"])
      expect(tudo).not.toContain(fora);
    expect(chamadas.some((c) => c.url.startsWith("/api/servicos"))).toBe(false);
  });
});

// ═════════════════════════ Descrição com limite ═════════════════════════
describe("descrição dos serviços: limite e contador", () => {
  it("maxLength 1000 e contador “x/1000” acompanhando", async () => {
    await montar();
    await aba("escopo");
    const campo = $<HTMLTextAreaElement>("[data-descricao-servicos]")!;
    expect(campo.maxLength).toBe(1000);
    expect($("[data-contador-descricao]")!.textContent).toBe("0/1000");
    await digitar(campo, "Manutenção preventiva");
    expect($("[data-contador-descricao]")!.textContent).toBe("21/1000");
    await digitar(campo, "x".repeat(1000));
    expect($("[data-contador-descricao]")!.textContent).toBe("1000/1000");
  });
});

// ═════════════════════════ 1º local = endereço do cliente ═════════════════════════
describe("1º local coberto vem do cadastro do cliente", () => {
  it("cliente com endereço e sem local igual: vem preenchido, com excluir; salvar cria o local e liga ao contrato", async () => {
    await montar();
    await aba("escopo");
    const pend = $("[data-local-pendente]")!;
    expect(pend).toBeTruthy();
    expect(pend.textContent).toContain("Rua A, 10, Centro, Belo Horizonte, MG");
    expect($('[data-excluir-local="pendente"]')).toBeTruthy();
    // Salvar: cria o local (uma vez) e manda o id no contrato; nada de campo que saiu
    await digitar($<HTMLInputElement>('input[aria-label="Início da vigência"]')!, "01/11/2026"); // campo pt-BR
    await clicar($$("button").find((b) => b.textContent?.trim() === "Salvar")!);
    const criarLocal = chamadas.filter((c) => c.metodo === "POST" && c.url === "/api/unidades");
    expect(criarLocal).toHaveLength(1);
    expect(criarLocal[0].corpo).toMatchObject({ clienteId: "c1", logradouro: "Rua A", numero: "10", cidade: "Belo Horizonte", principal: true });
    const post = chamadas.find((c) => c.metodo === "POST" && c.url === "/api/contratos")!;
    expect(post.corpo.unidadeIds).toEqual(["u-novo"]);
    expect(post.corpo).toMatchObject({ tipo: "MANUTENCAO_PREVENTIVA", periodicidade: "MENSAL", clienteId: "c1" });
    for (const k of ["servicosNFSeIds", "descricaoNFSe", "itensInclusos", "qtdVisitas", "periodoVisitas", "exibirRTNFSe", "adicionarPeriodoRef"]) expect(post.corpo).not.toHaveProperty(k);
  });

  it("excluir o local sugerido: some, não volta e não é criado ao salvar", async () => {
    await montar();
    await aba("escopo");
    await clicar($('[data-excluir-local="pendente"]'));
    expect($("[data-local-pendente]")).toBeNull();
    expect(painel("escopo").textContent).toContain("Nenhum local coberto ainda.");
    await digitar($<HTMLInputElement>('input[aria-label="Início da vigência"]')!, "01/11/2026"); // campo pt-BR
    await clicar($$("button").find((b) => b.textContent?.trim() === "Salvar")!);
    expect(chamadas.some((c) => c.metodo === "POST" && c.url === "/api/unidades")).toBe(false);
    expect(chamadas.find((c) => c.metodo === "POST" && c.url === "/api/contratos")!.corpo.unidadeIds).toEqual([]);
  });

  it("não duplica: se o cliente já tem um local com esse endereço, é ele que entra (com excluir)", async () => {
    rotas["GET /api/unidades?clienteId=c1"] = [
      { id: "u-filial", nome: "Filial", logradouro: "Rua B", numero: "5" },
      { id: "u-matriz", nome: "Matriz", logradouro: "RUA A", numero: "10", ativo: true },
    ];
    await montar();
    await aba("escopo");
    expect($("[data-local-pendente]")).toBeNull();
    expect($$("[data-local]").map((e) => e.getAttribute("data-local"))).toEqual(["u-matriz"]);
    expect($('[data-adicionar-local="u-filial"]')).toBeTruthy();
    await clicar($('[data-excluir-local="u-matriz"]'));
    expect($$("[data-local]")).toHaveLength(0);
    expect($('[data-adicionar-local="u-matriz"]')).toBeTruthy();
  });

  it("cliente sem endereço: nada é sugerido", async () => {
    rotas["GET /api/clientes/c1"] = { id: "c1", nome: "Hotel Mirante", endereco: null, cidade: null };
    await montar();
    await aba("escopo");
    expect($("[data-local-pendente]")).toBeNull();
    expect($$("[data-local]")).toHaveLength(0);
  });

  it("contrato que já tem locais: não mexe", async () => {
    rotas["GET /api/unidades?clienteId=c1"] = [{ id: "u-filial", nome: "Filial", logradouro: "Rua B", numero: "5" }];
    nav.sp = new URLSearchParams();
    await montar(permissoesTotais(), {
      id: "ct1", clienteId: "c1", numero: "CT-1", tipo: "LOCACAO", status: "ATIVO", periodicidade: "TRIMESTRAL", dataInicio: new Date("2026-01-01"),
      unidades: [{ unidade: { id: "u-filial", nome: "Filial", logradouro: "Rua B", numero: "5" } }], anexos: [], reajustes: [], historicoStatus: [], recorrenciasLocais: [],
    });
    await aba("escopo");
    expect($("[data-local-pendente]")).toBeNull();
    expect($$("[data-local]").map((e) => e.getAttribute("data-local"))).toEqual(["u-filial"]);
    // Tipo e periodicidade do contrato existente são mantidos
    await aba("contrato");
    await clicar($("[data-mais-opcoes]"));
    expect($<HTMLSelectElement>('select[name="tipo"]')!.value).toBe("LOCACAO");
    expect($<HTMLSelectElement>('select[name="periodicidade"]')!.value).toBe("TRIMESTRAL");
  });

  it("sem permissão de cadastrar endereço: não sugere local novo (só o que já existe)", async () => {
    await montar({ ...permissoesVazias(), contratos: { visualizar: true }, clientes: { visualizar: true } });
    await aba("escopo");
    expect($("[data-local-pendente]")).toBeNull();
  });
});
