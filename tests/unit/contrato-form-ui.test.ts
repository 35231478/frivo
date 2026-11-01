// @vitest-environment happy-dom
/**
 * Formulário de contrato (contrato-form.tsx real, num DOM de verdade). Prova:
 *  - 5 abas, nesta ordem, cada uma com os campos certos; o que saiu (NFS-e, itens inclusos,
 *    visitas, RT na NFS-e) não aparece em lugar nenhum; Tipo, ajuste de dia não útil e período na nota
 *    ficam em "Mais opções"; a cobrança (periodicidade) fica à vista (PR3-A);
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
const sp = (t: string) => t.replace(/\u00a0/g, " ");

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
    "GET /api/cadastros/servicos?ativo=todos": [
      { id: "s1", nome: "Manutenção preventiva", ativo: true }, { id: "s2", nome: "Consultoria", ativo: true }, { id: "s9", nome: "Antigo", ativo: false },
    ],
    "GET /api/contratos/previa-cobranca?servicoId=s1&valor=1000": {
      servico: { id: "s1", nome: "Manutenção preventiva", codigo: "MANU01", ativo: true }, bruto: 1000, total: 65, liquido: 935, pendenciasNfse: [],
      linhas: [{ chave: "iss", rotulo: "ISS retido", aliquota: 5, valor: 50 }, { chave: "ir", rotulo: "IR", aliquota: 1.5, valor: 15 }],
    },
    "GET /api/contratos/previa-cobranca?servicoId=s2&valor=1000": {
      servico: { id: "s2", nome: "Consultoria", codigo: "CONS01", ativo: true }, bruto: 1000, total: 0, liquido: 1000, linhas: [], pendenciasNfse: ["Código do serviço (LC 116)"],
    },
    "GET /api/contratos/previa-cobranca?servicoId=s9&valor=1000": {
      servico: { id: "s9", nome: "Antigo", codigo: null, ativo: false }, bruto: 1000, total: 0, liquido: 1000, linhas: [], pendenciasNfse: [],
    },
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
    // À vista: a cobrança (PR3-A). Recolhidos: tipo, ajuste e período na nota
    expect($<HTMLSelectElement>('select[name="periodicidade"]')!.value).toBe("MENSAL");
    expect($('select[name="tipo"]')).toBeNull();
    expect($('select[name="nfseReferencia"]')).toBeNull();
    expect(t).not.toContain("Sábados, domingos e feriados");
    await clicar($("[data-mais-opcoes]"));
    expect($('select[name="tipo"]')).toBeTruthy();
    expect($<HTMLSelectElement>('select[name="tipo"]')!.value).toBe("MANUTENCAO_PREVENTIVA");
    expect($<HTMLSelectElement>('select[name="nfseReferencia"]')!.value).toBe("CORRENTE");
    expect(painel("contrato").textContent).toContain("Sábados, domingos e feriados");
  });

  it("cobrança: só mensal…anual; o detalhe fica na ⓘ, fora de botão", async () => {
    await montar();
    const sel = $<HTMLSelectElement>('select[name="periodicidade"]')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Mensal", "Bimestral", "Trimestral", "Semestral", "Anual"]);
    const campo = sel.closest("div")!.parentElement!;
    const dica = campo.querySelector<HTMLButtonElement>('button[aria-label*="Cobrança"]')!;
    expect(dica).toBeTruthy();
    expect(dica.parentElement!.closest("button, a")).toBeNull();
    expect(document.getElementById(dica.getAttribute("aria-describedby")!)!.textContent).toContain("o valor de cada cobrança, sem multiplicar");
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
    expect($<HTMLSelectElement>('select[name="periodicidade"]')!.value).toBe("TRIMESTRAL");
    await clicar($("[data-mais-opcoes]"));
    expect($<HTMLSelectElement>('select[name="tipo"]')!.value).toBe("LOCACAO");
  });

  it("sem permissão de cadastrar endereço: não sugere local novo (só o que já existe)", async () => {
    await montar({ ...permissoesVazias(), contratos: { visualizar: true }, clientes: { visualizar: true } });
    await aba("escopo");
    expect($("[data-local-pendente]")).toBeNull();
  });
});

// ═════════════════════════ Serviço padrão + prévia da cobrança (PR2) ═════════════════════════
describe("serviço da nota e prévia: cobrança − retenções = cobrado", () => {
  const esperar = async (ms = 300) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
  const seletor = () => $<HTMLSelectElement>('[data-servico-padrao] select[name="servicoId"]')!;
  const escolher = async (v: string) => {
    await act(async () => { seletor().value = v; seletor().dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
  };
  const previas = () => chamadas.filter((c) => c.url.startsWith("/api/contratos/previa-cobranca"));
  const editar = (extra: Record<string, unknown> = {}) => ({
    id: "ct1", clienteId: "c1", numero: "CT-1", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", periodicidade: "MENSAL",
    dataInicio: new Date("2026-11-01"), valorMensal: 1000, unidades: [], anexos: [], reajustes: [], historicoStatus: [], recorrenciasLocais: [], ...extra,
  });

  it("sem serviço: aviso curto + ⓘ (fora de botão) dizendo que definir libera a emissão automática; nada é calculado", async () => {
    await montar();
    expect(painel("contrato").textContent).toContain("Serviço da nota");
    expect(seletor().value).toBe("");
    expect([...seletor().options].map((o) => o.textContent)).toEqual(expect.arrayContaining(["Sem serviço padrão", "Manutenção preventiva", "Consultoria"]));
    expect([...seletor().options].some((o) => o.textContent?.startsWith("Antigo"))).toBe(false); // inativo não é escolha nova
    const aviso = $("[data-sem-servico]")!;
    expect(aviso.textContent).toContain("Sem serviço padrão, a nota da mensalidade fica pendente até alguém escolher o serviço.");
    const dica = aviso.querySelector<HTMLButtonElement>('button[aria-label*="Serviço padrão"]')!;
    expect(dica.parentElement!.closest("button, a")).toBeNull();
    expect(document.getElementById(dica.getAttribute("aria-describedby")!)!.textContent).toContain("libera a emissão automática");
    expect(previas()).toHaveLength(0);
  });

  it("com serviço que retém: “Cobrança R$ 1.000,00 − retenções R$ 65,00 = cobrado R$ 935,00” e o detalhe; salvar manda o serviço", async () => {
    nav.sp = new URLSearchParams();
    rotas["PUT /api/contratos/ct1"] = { id: "ct1" };
    await montar(permissoesTotais(), editar({ servicoId: "s1" }));
    await esperar();
    expect(seletor().value).toBe("s1");
    const p = $("[data-previa-cobranca]")!;
    expect(p.textContent!.replace(/\s+/g, " ")).toContain("Cobrança R$ 1.000,00 − retenções R$ 65,00 = cobrado R$ 935,00");
    expect($("[data-previa-retencoes]")!.textContent!.replace(/\s/g, " ")).toBe("ISS retido 5% (−R$ 50,00) · IR 1,5% (−R$ 15,00)");
    expect($("[data-sem-servico]")).toBeNull();
    // Trocar para um serviço sem retenção e sem código: "Sem retenção" + o que falta, com link
    await escolher("s2");
    expect($("[data-previa-cobranca]")!.textContent!.replace(/\s/g, " ")).toContain("Sem retenção: cobrado R$ 1.000,00");
    expect($("[data-previa-retencoes]")).toBeNull();
    const falta = $("[data-previa-pendencias]")!;
    expect(falta.textContent).toContain("Para a nota sair, falta no serviço: Código do serviço (LC 116).");
    expect(falta.querySelector("a")!.getAttribute("href")).toBe("/configuracoes/servicos");
    // Tirar o serviço: volta o aviso; salvar manda servicoId nulo (o servidor grava "sem serviço")
    await escolher("");
    expect($("[data-sem-servico]")).toBeTruthy();
    await clicar($$("button").find((b) => b.textContent?.trim() === "Salvar")!);
    const put = chamadas.find((c) => c.metodo === "PUT" && c.url === "/api/contratos/ct1")!;
    expect(put.corpo.servicoId).toBeNull();
  });

  it("serviço inativo já gravado continua no contrato (com aviso); valor vazio pede o valor; erro do servidor aparece", async () => {
    nav.sp = new URLSearchParams();
    await montar(permissoesTotais(), editar({ servicoId: "s9" }));
    await esperar();
    expect(seletor().value).toBe("s9");
    expect($("[data-servico-inativo]")!.textContent).toBe("Este serviço está inativo. Ele continua valendo neste contrato.");
    await digitar($<HTMLInputElement>('input[name="valorMensal"]')!, "");
    await esperar();
    expect($("[data-previa-sem-valor]")!.textContent).toBe("Informe o valor mensal para ver quanto entra de fato.");
    // Valor zero também não calcula (não há cobrança)
    await digitar($<HTMLInputElement>('input[name="valorMensal"]')!, "0");
    await esperar();
    expect($("[data-previa-sem-valor]")).toBeTruthy();
    expect(previas().some((c) => c.url.endsWith("valor=0"))).toBe(false);
    await digitar($<HTMLInputElement>('input[name="valorMensal"]')!, "777");
    await esperar();
    expect($("[data-previa-erro]")!.textContent).toBe("Não foi possível calcular a prévia.");
  });

  it("contrato novo: escolher o serviço já entra no POST", async () => {
    await montar();
    await escolher("s1");
    await digitar($<HTMLInputElement>('input[aria-label="Início da vigência"]')!, "01/11/2026");
    await clicar($$("button").find((b) => b.textContent?.trim() === "Salvar")!);
    expect(chamadas.find((c) => c.metodo === "POST" && c.url === "/api/contratos")!.corpo.servicoId).toBe("s1");
  });
});

// ═════════════════════════ PR3-A: cobrança e faturamento automático ═════════════════════════
describe("PR3-A: cobrança a cada N meses e faturamento automático", () => {
  const editarCt = (extra: Record<string, unknown> = {}) => ({
    id: "ct1", clienteId: "c1", numero: "CT-1", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", periodicidade: "MENSAL",
    dataInicio: new Date("2026-09-01T00:00:00"), dataFim: new Date("2027-08-31T00:00:00"), valorMensal: 900,
    unidades: [], anexos: [], reajustes: [], historicoStatus: [], recorrenciasLocais: [], ...extra,
  });
  const escolherCobranca = async (v: string) => {
    const sel = $<HTMLSelectElement>('select[name="periodicidade"]')!;
    await act(async () => { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
  };
  const sw = (rotulo: string) => $$('button[role="switch"]').find((b) => document.getElementById(b.getAttribute("aria-labelledby")!)?.textContent === rotulo) as HTMLButtonElement;
  const salvar = async () => {
    await clicar($$("button").find((b) => b.textContent?.trim() === "Salvar")!);
    return chamadas.find((c) => c.metodo === "PUT" && c.url === "/api/contratos/ct1")!.corpo;
  };

  it("mensal: “Valor mensal” e total = 12 meses; trimestral: “Valor da cobrança”, “R$ 900,00 · a cada 3 meses” e total = 4 cobranças", async () => {
    nav.sp = new URLSearchParams();
    await montar(permissoesTotais(), editarCt());
    const p = painel("contrato");
    expect(p.textContent).toContain("Valor mensal (R$)");
    expect(sp($("[data-valor-total]")!.textContent!)).toBe("R$ 10.800,00");
    await escolherCobranca("TRIMESTRAL");
    expect(p.textContent).not.toContain("Valor mensal (R$)");
    expect(p.textContent).toContain("Valor da cobrança (R$)");
    expect(sp(p.textContent!)).toContain("R$ 900,00 · a cada 3 meses");
    expect(sp($("[data-valor-total]")!.textContent!)).toBe("R$ 3.600,00(4 cobranças)");
    await escolherCobranca("ANUAL");
    expect(sp(p.textContent!)).toContain("R$ 900,00 · por ano");
    expect(sp($("[data-valor-total]")!.textContent!)).toBe("R$ 900,00(1 cobrança)");
    rotas["PUT /api/contratos/ct1"] = { id: "ct1" };
    expect((await salvar()).periodicidade).toBe("ANUAL");
  });

  it("contrato antigo semanal/quinzenal abre como mensal (o seletor não oferece os dois)", async () => {
    nav.sp = new URLSearchParams();
    await montar(permissoesTotais(), editarCt({ periodicidade: "QUINZENAL" }));
    expect($<HTMLSelectElement>('select[name="periodicidade"]')!.value).toBe("MENSAL");
  });

  it("sem Financeiro › Medições: as chaves aparecem travadas, com o porquê; o salvar não mexe nelas", async () => {
    nav.sp = new URLSearchParams();
    rotas["PUT /api/contratos/ct1"] = { id: "ct1" };
    await montar({ ...permissoesVazias(), contratos: { visualizar: true, editar: true }, clientes: { visualizar: true } }, editarCt({ faturamentoAutomatico: true }));
    expect(sw("Faturamento automático").disabled).toBe(true);
    expect(sw("Faturamento automático").getAttribute("aria-checked")).toBe("true");
    expect(sw("Aprovar sem esperar o cliente").disabled).toBe(true);
    expect($("[data-automacao-sem-permissao]")!.textContent).toBe("Só quem tem a permissão Financeiro › Medições liga o faturamento automático.");
    await clicar(sw("Faturamento automático"));
    expect(sw("Faturamento automático").getAttribute("aria-checked")).toBe("true");
    const corpo = await salvar();
    expect([corpo.faturamentoAutomatico, corpo.aprovacaoAutomatica]).toEqual([true, false]); // o mesmo que estava gravado
  });

  it("com a permissão: liga o automático, libera a aprovação automática; desligar o automático desliga a aprovação; ⓘ fora de botão; período na nota vai junto", async () => {
    nav.sp = new URLSearchParams();
    rotas["PUT /api/contratos/ct1"] = { id: "ct1" };
    await montar(permissoesTotais(), editarCt());
    expect($("[data-automacao-sem-permissao]")).toBeNull();
    expect(sw("Aprovar sem esperar o cliente").disabled).toBe(true); // só com o automático ligado
    await clicar(sw("Faturamento automático"));
    expect(sw("Faturamento automático").getAttribute("aria-checked")).toBe("true");
    expect($("[data-automacao]")!.textContent).toContain("A medição sai sozinha no dia de faturamento, por mês.");
    expect(sw("Aprovar sem esperar o cliente").disabled).toBe(false);
    await clicar(sw("Aprovar sem esperar o cliente"));
    for (const rotulo of ["Faturamento automático", "Aprovar sem esperar o cliente"]) {
      const dica = $(`[data-automacao] button[aria-label*="${rotulo}"]`)!;
      expect(dica.parentElement!.closest("button, a")).toBeNull();
    }
    const dicaAuto = $<HTMLButtonElement>('[data-automacao] button[aria-label*="Faturamento automático"]')!;
    expect(document.getElementById(dicaAuto.getAttribute("aria-describedby")!)!.textContent).toContain("tenta de novo nos 2 dias seguintes e depois avisa no sino");
    await clicar($("[data-mais-opcoes]"));
    const ref = $<HTMLSelectElement>('select[name="nfseReferencia"]')!;
    await act(async () => { ref.value = "ANTERIOR"; ref.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    let corpo = await salvar();
    expect([corpo.faturamentoAutomatico, corpo.aprovacaoAutomatica, corpo.nfseReferencia]).toEqual([true, true, "ANTERIOR"]);
    chamadas.length = 0;
    await clicar(sw("Faturamento automático"));
    expect(sw("Aprovar sem esperar o cliente").getAttribute("aria-checked")).toBe("false");
    corpo = await salvar();
    expect([corpo.faturamentoAutomatico, corpo.aprovacaoAutomatica]).toEqual([false, false]);
  });
});
