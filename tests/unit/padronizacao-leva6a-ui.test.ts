// @vitest-environment happy-dom
/**
 * PADRONIZAÇÃO — LEVA 6A: as telas de CONTRATO montadas de verdade (DOM real, API simulada).
 *
 * PRIORIDADE Nº 1 — o que grava só aparece para quem pode:
 *  - "Novo contrato" na lista só com Contratos › criar;
 *  - a ficha do contrato abre em SOMENTE LEITURA para quem só tem Contratos › visualizar: sem
 *    Salvar, sem menu de status e com os campos desabilitados (o PUT exigiria Contratos › editar);
 *  - "Gerar OS" do relatório só para quem a rota aceita (Ordens › criar OU Contratos › editar);
 *    quando o servidor recusa, a tela NÃO muda (nenhuma OS aparece) e o motivo vai no toast;
 *  - aplicar/adiar/dispensar reajuste só com Contratos › editar.
 *
 * PADRÃO: instrução no ⓘ do título (não em parágrafo), TabelaPro nas listas, toast da casa,
 * cadastro rápido + editar no contexto nos seletores do formulário.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => "/contratos", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast), confirmar: vi.fn(async () => true) };
});

let root: Root, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as T | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string | RegExp, dentro: ParentNode = document) =>
  [...dentro.querySelectorAll("button")].filter((b) => (typeof t === "string" ? txt(b) === t : t.test(txt(b)))).at(-1) ?? null;

async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { Avisos } = await import("@/components/ui/avisos");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [createElement(Avisos, { key: "avisos" }), createElement("div", { key: "tela" }, el)] }));
  });
  await esperar();
}
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => [c[0], c[1] ?? "sucesso"]);
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));
/** O texto do ⓘ do título (o painel que o botão de ajuda descreve) */
const dica = (rotulo: string) => {
  const b = $(`[data-dica][aria-label="Ajuda: ${rotulo}"]`);
  return b ? txt(document.getElementById(b.getAttribute("aria-describedby") ?? "")) : null;
};
const RECUSA = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };

beforeAll(async () => {
  // Avisos primeiro e sozinho: importar em paralelo cria duas cópias do módulo simulado
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/providers/permissoes-provider"),
    () => import("@/components/acoes-massa/selecao"),
    () => import("@/components/contratos/contratos-lista-client"),
    () => import("@/components/contratos/relatorio-contratos-client"),
    () => import("@/components/contratos/reajustes-view"),
    () => import("@/components/forms/contrato-form"),
    () => import("@/components/forms/recorrencia-locais"),
    () => import("@/components/cadastro-rapido/definicoes"),
  ]) await m();
}, 180_000);

beforeEach(async () => {
  chamadas.length = 0; respostas = {}; nav.refresh.mockClear(); nav.push.mockClear(); nav.replace.mockClear();
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    const r = respostas[`${metodo} ${url}`] ?? respostas[`${metodo} ${url.split("?")[0]}`] ?? { status: 200, corpo: [] };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

/* ═════════ /contratos — a lista ═════════ */

const contrato = (extra: Record<string, unknown> = {}) => ({
  id: "ct1", numero: "CT-18", cliente: "Hospital Santa Clara", clienteLogo: null, periodicidade: "MENSAL",
  valorMensal: 1200, dataInicio: "2025-01-10T00:00:00.000Z", dataFim: "2026-01-10T00:00:00.000Z",
  status: "ATIVO", vencido: false, vencendo: false, proximaOs: null, ...extra,
});
async function abrirLista(permissoes: Permissoes, contratos = [contrato()]) {
  const { ContratosListaClient } = await import("@/components/contratos/contratos-lista-client");
  const { SelecaoMassaProvider } = await import("@/components/acoes-massa/selecao");
  // a página embrulha a lista no provedor da seleção em massa — o teste monta a tela inteira
  await montar(createElement(SelecaoMassaProvider, {
    entidade: "contratos", idsPagina: contratos.map((c) => c.id), total: contratos.length,
    children: createElement(ContratosListaClient, {
      contratos: contratos as any, total: contratos.length, pagina: 1, porPagina: 25, somaMensalFiltrada: 1200,
      resumo: { ativos: 1, valorMensalTotal: 1200, valorAnualTotal: 14400, vencendo: 0, vencidos: 0 }, opcoesClientes: [],
    }),
  }), permissoes);
}

describe("Leva 6A — /contratos: lista no padrão e permissão no botão", () => {
  it("com Contratos › criar o botão aparece; sem a permissão, não há caminho para o formulário", async () => {
    await abrirLista(montarPermissoes({ contratos: ["visualizar", "criar"] }));
    expect($("[data-novo-contrato]")).toBeTruthy();
    act(() => root.unmount()); caixa.remove();

    await abrirLista(montarPermissoes({ contratos: ["visualizar"] }));
    expect($("[data-novo-contrato]")).toBeNull();
    // e o resto da tela continua: a lista e o relatório seguem acessíveis
    expect($("[data-tabela-contratos]")).toBeTruthy();
    expect($$("a").some((a) => a.getAttribute("href") === "/contratos/relatorio")).toBe(true);
  });

  it("a tabela é a TabelaPro (colunas escolhíveis) e os totais ficam na faixa de cima", async () => {
    await abrirLista(permissoesTotais());
    expect($("[data-tabela-contratos]")).toBeTruthy();
    expect($("[data-colunas-menu]"), "o botão Colunas da TabelaPro").toBeTruthy();
    expect($("[data-contrato='ct1']")).toBeTruthy();

    const faixa = txt($("[data-colunas-menu]")!.closest("div")!.parentElement);
    expect(faixa).toContain("1 contrato filtrado");
    expect(faixa).toContain("/mês");
    expect(faixa).toContain("/ano");

    // esconder uma coluna pelo menu é preferência do usuário (vai para a rota de preferências)
    await clicar($("[data-colunas-menu]"));
    await clicar($("[data-coluna-opcao='ano']"));
    // a chave da preferência é a da tela: trocá-la faria o usuário perder o ajuste que já tinha
    expect(chamadas.some((c) => c.url.split("?")[0] === "/api/preferencias/tabela:contratos")).toBe(true);
  });

  it("a instrução da tela fica no ⓘ do título, não num parágrafo acima da lista", async () => {
    await abrirLista(permissoesTotais());
    const ajuda = dica("Contratos");
    expect(ajuda).toContain("o valor é o de CADA cobrança");
    expect(ajuda).toContain("Reajustes a aplicar");
    expect($("h1")!.textContent).toContain("Contratos");
  });

  it("lista vazia usa o componente da casa e fala da busca", async () => {
    await abrirLista(permissoesTotais(), []);
    expect($("[data-lista-vazia]")).toBeTruthy();
    expect(txt($("[data-lista-vazia]"))).toContain("Nenhum contrato encontrado");
    expect($("[data-tabela-contratos]")).toBeNull();
  });

  it("no celular há um cartão por contrato (a tabela é só do desktop)", async () => {
    await abrirLista(permissoesTotais());
    expect($("[data-cartoes]")).toBeTruthy();
    expect($("[data-cartao='ct1']")).toBeTruthy();
    expect($("[data-cartoes]")!.className).toContain("md:hidden");
  });

  it("o contador fala português: 1 contrato, 2 contratos", async () => {
    await abrirLista(permissoesTotais(), [contrato(), contrato({ id: "ct2", numero: "CT-19" })]);
    expect(txt($("[data-contador]"))).toContain("2 contratos");
    act(() => root.unmount()); caixa.remove();
    await abrirLista(permissoesTotais());
    expect(txt($("[data-contador]"))).toContain("1 contrato");
    expect(txt($("[data-contador]"))).not.toContain("1 contratos");
  });
});

/* ═════════ /contratos/relatorio — "Gerar OS" ═════════ */

const itemRelatorio = (extra: Record<string, unknown> = {}) => ({
  contratoId: "ct1", numero: "CT-18", cliente: "Hospital Santa Clara", clienteId: "c1", periodicidade: "MENSAL",
  valorMensal: 1200, statusMes: "PENDENTE" as const, progresso: 0, dataAgendada: "2026-03-10T00:00:00.000Z",
  os: null, ultimaManutencao: null, ...extra,
});
async function abrirRelatorio(permissoes: Permissoes, itens = [itemRelatorio()]) {
  const { RelatorioContratosClient } = await import("@/components/contratos/relatorio-contratos-client");
  await montar(createElement(RelatorioContratosClient, { mes: 3, ano: 2026, itens: itens as any, tecnicos: [], clientes: [] }), permissoes);
  await clicar(botao(/CT-18/)); // abre o contrato (o botão "Gerar OS" vive no detalhe)
}

describe("Leva 6A — /contratos/relatorio: Gerar OS com a permissão da rota", () => {
  it("quem pode abrir OS vê o botão; quem não pode (nem Ordens › criar, nem Contratos › editar) não vê", async () => {
    await abrirRelatorio(montarPermissoes({ ordens: ["criar"] }));
    expect($("[data-gerar-os='ct1']")).toBeTruthy();
    act(() => root.unmount()); caixa.remove();

    await abrirRelatorio(montarPermissoes({ contratos: ["editar"] }));
    expect($("[data-gerar-os='ct1']"), "Contratos › editar também abre OS do contrato").toBeTruthy();
    act(() => root.unmount()); caixa.remove();

    await abrirRelatorio(montarPermissoes({ contratos: ["visualizar"] }));
    expect($("[data-gerar-os='ct1']")).toBeNull();
    expect(txt($("[data-previa-recorrencia]"))).toBe(""); // nada de prévia aqui: é outra tela
  });

  it("gerou: toast da casa e a tela se atualiza pelo servidor", async () => {
    respostas["POST /api/contratos/ct1/gerar-os"] = { status: 200, corpo: { id: "os9", numero: "OS-2001" } };
    await abrirRelatorio(montarPermissoes({ ordens: ["criar"] }));
    await clicar($("[data-gerar-os='ct1']"));
    expect(gravacoes()).toEqual([{ url: "/api/contratos/ct1/gerar-os", metodo: "POST", corpo: { ano: 2026, mes: 3 } }]);
    expect((await toasts()).map((t) => t[1])).toEqual(["sucesso"]);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("o servidor recusou (403): o motivo aparece no toast e NENHUMA OS entra na tela", async () => {
    respostas["POST /api/contratos/ct1/gerar-os"] = RECUSA;
    await abrirRelatorio(montarPermissoes({ ordens: ["criar"] }));
    await clicar($("[data-gerar-os='ct1']"));
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect($("[data-gerar-os='ct1']"), "o botão continua lá: nada mudou").toBeTruthy();
    expect($$("a").some((a) => (a.getAttribute("href") ?? "").startsWith("/ordens/"))).toBe(false);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("a instrução do relatório fica no ⓘ do título", async () => {
    await abrirRelatorio(permissoesTotais());
    expect(dica("Relatório de manutenções")).toContain("uma linha por contrato".replace("u", "U"));
  });
});

/* ═════════ /contratos/reajustes — decidir só com Contratos › editar ═════════ */

const linhaReajuste = (extra: Record<string, unknown> = {}) => ({
  contratoId: "ct1", numero: "CT-18", cliente: "Hospital Santa Clara", situacao: "PENDENTE" as const,
  aniversario: { ano: 2026, mes: 3 }, percentual: 5, valorAtual: 1200, valorNovo: 1260, adiadoAte: null, ...extra,
});
async function abrirReajustes(permissoes: Permissoes, linhas = [linhaReajuste()]) {
  const { ReajustesView } = await import("@/components/contratos/reajustes-view");
  await montar(createElement(ReajustesView, { linhas: linhas as any }), permissoes);
}

describe("Leva 6A — /contratos/reajustes: a decisão é de quem edita contrato", () => {
  it("com Contratos › editar: aplicar, adiar e dispensar na linha", async () => {
    await abrirReajustes(montarPermissoes({ contratos: ["visualizar", "editar"] }));
    expect($("[data-aplicar='ct1']")).toBeTruthy();
    expect($("[data-adiar='ct1']")).toBeTruthy();
    expect($("[data-dispensar='ct1']")).toBeTruthy();
    expect($("[data-sem-permissao='ct1']")).toBeNull();
  });

  it("sem a permissão: nenhum botão de decisão, e a tela diz de quem é a decisão", async () => {
    await abrirReajustes(montarPermissoes({ contratos: ["visualizar"] }));
    expect($("[data-aplicar='ct1']")).toBeNull();
    expect($("[data-adiar='ct1']")).toBeNull();
    expect($("[data-dispensar='ct1']")).toBeNull();
    expect(txt($("[data-sem-permissao='ct1']"))).toBe("Quem cuida de contratos decide");
    // continua sendo informação útil: o de-para do valor segue na linha
    expect(txt($("[data-valor-novo]"))).toContain("1.260");
  });

  it("aplicar confirma antes e manda o valor esperado (ninguém reajusta por engano)", async () => {
    respostas["POST /api/contratos/ct1/reajuste"] = { status: 200, corpo: { texto: "Reajuste aplicado." } };
    await abrirReajustes(montarPermissoes({ contratos: ["editar"] }));
    await clicar($("[data-aplicar='ct1']"));
    const { confirmar } = await import("@/components/ui/avisos");
    expect(vi.mocked(confirmar)).toHaveBeenCalled();
    expect(gravacoes()).toEqual([{ url: "/api/contratos/ct1/reajuste", metodo: "POST", corpo: { ano: 2026, acao: "APLICAR", valorEsperado: 1200 } }]);
    expect(await toasts()).toEqual([["Reajuste aplicado.", "sucesso"]]);
  });

  it("o servidor recusou: toast de erro e a linha fica como estava", async () => {
    respostas["POST /api/contratos/ct1/reajuste"] = RECUSA;
    await abrirReajustes(montarPermissoes({ contratos: ["editar"] }));
    await clicar($("[data-adiar='ct1']"));
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(txt($("[data-situacao]"))).toBe("Para aplicar");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("a lista é a TabelaPro, com cartões no celular", async () => {
    await abrirReajustes(permissoesTotais());
    expect($("[data-reajustes-lista]")).toBeTruthy();
    expect($("[data-colunas-menu]")).toBeTruthy();
    expect($$("[data-linha-reajuste='ct1']").length, "linha da tabela + cartão do celular").toBe(2);
  });

  it("'vem chegando' não oferece decisão nenhuma: diz de quando vale", async () => {
    await abrirReajustes(permissoesTotais(), [linhaReajuste({ situacao: "EM_BREVE" })]);
    expect($("[data-aplicar='ct1']")).toBeNull();
    expect(txt($("[data-linha-reajuste='ct1']"))).toContain("Aplica a partir de");
  });
});

/* ═════════ a ficha do contrato: somente leitura × edição ═════════ */

const contratoFicha = (extra: Record<string, unknown> = {}) => ({
  id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-18", tipo: "MANUTENCAO", status: "ATIVO",
  periodicidade: "MENSAL", valorMensal: 1200, valorTotal: 14400, dataInicio: new Date("2025-01-10"),
  dataFim: new Date("2026-01-10"), responsavelTecnicoId: "rt1", unidades: [], anexos: [], reajustes: [],
  historicoStatus: [], recorrenciasLocais: [], ...extra,
});
async function abrirFicha(permissoes: Permissoes, somenteLeitura: boolean) {
  const { ContratoForm } = await import("@/components/forms/contrato-form");
  await montar(createElement(ContratoForm, { initialData: contratoFicha() as any, somenteLeitura }), permissoes);
}

describe("Leva 6A — a ficha do contrato: quem só visualiza não encontra caminho que o servidor recuse", () => {
  it("somente leitura: sem Salvar, sem menu de status, campos desabilitados e o motivo na tela", async () => {
    await abrirFicha(montarPermissoes({ contratos: ["visualizar"] }), true);
    expect(botao("Salvar")).toBeNull();
    expect(botao(/Salvar e continuar|Continuar/)).toBeNull();
    expect(botao("Voltar"), "o caminho de volta continua").toBeTruthy();
    expect(txt($("[data-somente-leitura]"))).toContain("Contratos › editar");
    expect($<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
    // o status aparece, mas como informação: não há menu para mudá-lo
    expect(botao(/Mudar status/)).toBeNull();
    expect($("[title='Mudar status do contrato']")).toBeNull();
  });

  it("com Contratos › editar: Salvar e o menu de status voltam, e os campos respondem", async () => {
    await abrirFicha(permissoesTotais(), false);
    expect(botao("Salvar")).toBeTruthy();
    expect($("[title='Mudar status do contrato']")).toBeTruthy();
    expect($("[data-somente-leitura]")).toBeNull();
    expect($<HTMLFieldSetElement>("fieldset")!.disabled).toBe(false);
    expect($<HTMLInputElement>("[data-valor-cobranca]")!.value).toBe("1200");
  });

  it("o cliente escolhido pode ser editado no contexto (sem sair do contrato)", async () => {
    respostas["GET /api/clientes"] = { status: 200, corpo: [{ id: "c1", nome: "Hospital Santa Clara", cpfCnpj: "1", ativo: true }] };
    await abrirFicha(permissoesTotais(), false);
    const painel = $("[data-painel-contrato='contrato']")!;
    expect($("[data-select-com-edicao]", painel), "o seletor de cliente vem com o lápis").toBeTruthy();
    const lapis = $("[data-editar-no-contexto]", painel);
    expect(lapis!.getAttribute("aria-label")).toBe("Editar o cliente selecionado");

    // abre o painel de edição e lê os valores do cadastro do cliente (sem sair da ficha)
    respostas["GET /api/clientes/c1"] = { status: 200, corpo: { id: "c1", telefone: "(11) 3000-0000", celular: "", email: "contato@sc.com" } };
    await clicar(lapis);
    expect(chamadas.some((c) => c.url === "/api/clientes/c1" && c.metodo === "GET")).toBe(true);
    expect(nav.push, "nada de mandar a pessoa para outra tela").not.toHaveBeenCalled();
  });

  it("o responsável técnico é cadastro rápido com edição no contexto: o select nativo saiu", async () => {
    respostas["GET /api/tecnicos?tipo=RESPONSAVEL_TECNICO"] = { status: 200, corpo: [{ id: "rt1", nome: "Eng. Marina Alves", crea: "5012345-D/SP" }] };
    await abrirFicha(permissoesTotais(), false);
    await clicar($("[data-aba-contrato='rt']"));
    const painel = $("[data-painel-contrato='rt']")!;
    expect($$("select", painel).some((s) => s.getAttribute("name") === "responsavelTecnicoId"), "não há mais select nativo de RT").toBe(false);
    expect($("[data-select-com-edicao]", painel), "o RT vem com o lápis de editar no contexto").toBeTruthy();
    expect($("[data-editar-no-contexto]", painel)!.getAttribute("aria-label")).toBe("Editar o responsável técnico selecionado");
    expect(txt(painel)).toContain("Responsável técnico");
    await clicar($("[data-select-com-edicao] button", painel));
    expect(txt(painel)).toContain("CREA 5012345-D/SP");
    expect(botao(/Novo responsável técnico/, painel), "cadastrar sem sair do contrato").toBeTruthy();
  });
});
