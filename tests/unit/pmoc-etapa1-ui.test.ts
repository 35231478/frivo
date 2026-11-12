// @vitest-environment happy-dom
/**
 * PMOC — Etapa 1 (cadastro base): as regras puras e as telas num DOM de verdade.
 *  - status exibido: Rascunho (manual) · Vigente / Expirado (calculados pela data, fuso de Brasília);
 *    "vence em N dias" a partir de 30 dias; o dia da expiração ainda vale;
 *  - o selo, nos tons do sistema de design (texto sempre presente);
 *  - editor: Identificação e Equipamentos AVAC; as abas das próximas etapas ficam DESABILITADAS
 *    (cronograma, planejamento, ocorrências, recomendações e anexos não são desta etapa);
 *  - publicar: a tela diz o que falta antes de chamar o servidor;
 *  - RBAC do módulo `pmoc`: a matriz de permissões, a rota, o menu e o que cada um vê na tela.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { ACOES_LABEL, PRESETS, SECOES, moduloDaRota, montarPermissoes, permissoesTotais, pode, type Permissoes } from "@/lib/permissoes";
import { DESCRICAO_PADRAO_PMOC, DIAS_AVISO_VENCIMENTO, dataBR, filtroStatusPmoc, hojeISO, pendenciasPublicacao, pmocSchema, situacaoPmoc } from "@/lib/pmoc";
import { ehTecnicoPuro, emModoTecnico, destinoModoTecnico } from "@/lib/tecnico/modo";
import type { PmocDados } from "@/components/pmoc/pmoc-editor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), caminho: "/pmoc" }));
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navegacao.refresh, push: navegacao.push, replace: vi.fn() }), usePathname: () => navegacao.caminho, useSearchParams: () => new URLSearchParams() }));

const RAIZ = path.resolve(__dirname, "../..");
// 12:00 em Brasília de 12/11/2026
const AGORA = new Date("2026-11-12T15:00:00.000Z");
const pub = (dataInicio: string, dataExpiracao: string) => ({ status: "PUBLICADO", dataInicio, dataExpiracao });

/* ═════════ regras puras ═════════ */
describe("PMOC: status exibido (calculado pela data)", () => {
  it("não publicado é sempre Rascunho, qualquer que seja a data", () => {
    for (const fim of ["2020-01-01", "2026-11-12", "2030-01-01"]) expect(situacaoPmoc({ status: "RASCUNHO", dataInicio: "2019-01-01", dataExpiracao: fim }, AGORA)).toEqual({ status: "RASCUNHO", diasParaExpirar: null, vencendo: false, aIniciar: false });
  });

  it("publicado: Vigente até o dia da expiração (inclusive); Expirado a partir do dia seguinte", () => {
    expect(situacaoPmoc(pub("2026-01-01", "2026-11-12"), AGORA)).toMatchObject({ status: "VIGENTE", diasParaExpirar: 0, vencendo: true });
    expect(situacaoPmoc(pub("2026-01-01", "2026-11-13"), AGORA)).toMatchObject({ status: "VIGENTE", diasParaExpirar: 1 });
    expect(situacaoPmoc(pub("2025-01-01", "2026-11-11"), AGORA)).toEqual({ status: "EXPIRADO", diasParaExpirar: -1, vencendo: false, aIniciar: false });
  });

  it(`"vencendo" liga com ${DIAS_AVISO_VENCIMENTO} dias ou menos; com 31, ainda não`, () => {
    expect(DIAS_AVISO_VENCIMENTO).toBe(30);
    expect(situacaoPmoc(pub("2026-01-01", "2026-12-12"), AGORA)).toMatchObject({ status: "VIGENTE", diasParaExpirar: 30, vencendo: true });
    expect(situacaoPmoc(pub("2026-01-01", "2026-12-13"), AGORA)).toMatchObject({ status: "VIGENTE", diasParaExpirar: 31, vencendo: false });
  });

  it("o dia vira à meia-noite de BRASÍLIA, não de Greenwich: 23:30 em Brasília ainda é o dia da expiração", () => {
    const tarde = new Date("2026-11-13T02:30:00.000Z"); // 23:30 de 12/11 em Brasília
    expect(hojeISO(tarde)).toBe("2026-11-12");
    expect(situacaoPmoc(pub("2026-01-01", "2026-11-12"), tarde).status).toBe("VIGENTE");
    expect(situacaoPmoc(pub("2026-01-01", "2026-11-12"), new Date("2026-11-13T03:00:00.000Z")).status).toBe("EXPIRADO"); // 00:00 de 13/11
  });

  it("publicado com início no futuro: Vigente, marcado como 'a iniciar'", () => {
    expect(situacaoPmoc(pub("2026-12-01", "2027-11-30"), AGORA)).toMatchObject({ status: "VIGENTE", aIniciar: true });
    expect(situacaoPmoc(pub("2026-11-12", "2027-11-11"), AGORA)).toMatchObject({ status: "VIGENTE", aIniciar: false });
  });

  it("data gravada como DATE (meia-noite UTC) não desloca o dia na tela", () => {
    expect(dataBR(new Date("2026-03-01T00:00:00.000Z"))).toBe("01/03/2026");
    expect(dataBR("2026-03-01")).toBe("01/03/2026");
    expect(dataBR(null)).toBe("—");
  });

  it("o filtro da lista usa as mesmas fronteiras do selo", () => {
    const hoje = new Date("2026-11-12T00:00:00.000Z");
    expect(filtroStatusPmoc("RASCUNHO", AGORA)).toEqual({ status: "RASCUNHO" });
    expect(filtroStatusPmoc("VIGENTE", AGORA)).toEqual({ status: "PUBLICADO", dataExpiracao: { gte: hoje } });
    expect(filtroStatusPmoc("EXPIRADO", AGORA)).toEqual({ status: "PUBLICADO", dataExpiracao: { lt: hoje } });
    expect(filtroStatusPmoc("", AGORA)).toBeNull();
    expect(filtroStatusPmoc("QUALQUER", AGORA)).toBeNull();
  });

  it("para publicar: nome do RT, CREA, nº da ART e ao menos 1 equipamento — só espaços não vale", () => {
    expect(pendenciasPublicacao({}, 0)).toEqual(["nome do Responsável Técnico", "registro CREA do Responsável Técnico", "número da ART", "pelo menos 1 equipamento coberto"]);
    expect(pendenciasPublicacao({ rtNome: " ", rtCrea: "SP-1", artNumero: "123" }, 1)).toEqual(["nome do Responsável Técnico"]);
    expect(pendenciasPublicacao({ rtNome: "Eng. Paula", rtCrea: "SP-1", artNumero: "123" }, 1)).toEqual([]);
  });

  it("o texto padrão cita a base legal; o formulário recusa expiração que não vem depois do início", () => {
    for (const norma of ["Lei Federal nº 13.589/2018", "Portaria nº 3.523/GM/MS", "RE nº 09/2003", "NBR 13971", "NBR 16401"]) expect(DESCRICAO_PADRAO_PMOC).toContain(norma);
    const ok = { nome: "PMOC 2026", clienteId: "c1", unidadeId: "u1", dataInicio: "2026-01-01", dataExpiracao: "2026-12-31" };
    expect(pmocSchema.safeParse(ok).success).toBe(true);
    expect(pmocSchema.safeParse({ ...ok, dataExpiracao: "2026-01-01" }).error?.issues[0].message).toBe("A data de expiração deve ser depois da data de início.");
    expect(pmocSchema.safeParse({ ...ok, status: "VIGENTE" }).success).toBe(false); // Vigente/Expirado não são status que se grava
  });
});

/* ═════════ RBAC do módulo ═════════ */
describe("PMOC: permissões do módulo", () => {
  it("a matriz de permissões tem o módulo PMOC (Operação) com visualizar, criar, editar e excluir", () => {
    const operacao = SECOES.find((s) => s.id === "operacao")!;
    const pmoc = operacao.modulos.find((m) => m.id === "pmoc")!;
    expect(pmoc).toEqual({ id: "pmoc", label: "PMOC", icone: "FileBadge", acoes: ["visualizar", "criar", "editar", "excluir"] });
    expect(pmoc.acoes.map((a) => ACOES_LABEL[a])).toEqual(["Visualizar", "Criar", "Editar", "Excluir"]);
    // Fica logo depois de Equipamentos, como no menu
    expect(operacao.modulos.map((m) => m.id).indexOf("pmoc")).toBe(operacao.modulos.map((m) => m.id).indexOf("equipamentos") + 1);
    // O editor de perfil conhece o ícone (senão a linha do módulo quebraria a tela)
    expect(fs.readFileSync(path.join(RAIZ, "components/cadastros/editores/editor-perfil.tsx"), "utf8")).toMatch(/const ICONES: Record<IconeModulo, LucideIcon> = \{[^}]*\bFileBadge\b/);
  });

  it("as telas /pmoc, /pmoc/novo e /pmoc/<id> são do módulo pmoc (o middleware barra quem não o tem)", () => {
    for (const rota of ["/pmoc", "/pmoc/novo", "/pmoc/cmuvnvcjv000f7abcdefghijk"]) expect(moduloDaRota(rota)).toBe("pmoc");
  });

  it("perfis padrão: Administrador tudo; Supervisor vê, cria e edita (não exclui); Financeiro, Técnico e Auxiliar não têm o módulo", () => {
    const acoes = (p: Permissoes, role = "OPERADOR") => (["visualizar", "criar", "editar", "excluir"] as const).filter((a) => pode(p, "pmoc", a, role));
    expect(acoes(PRESETS.ADMINISTRADOR)).toEqual(["visualizar", "criar", "editar", "excluir"]);
    expect(acoes(montarPermissoes({}), "ADMIN")).toEqual(["visualizar", "criar", "editar", "excluir"]);
    expect(acoes(PRESETS.SUPERVISOR)).toEqual(["visualizar", "criar", "editar"]);
    for (const sem of [PRESETS.FINANCEIRO, PRESETS.TECNICO, PRESETS.AUXILIAR, PRESETS.PERSONALIZADO]) expect(acoes(sem)).toEqual([]);
  });

  it("o técnico do app continua confinado ao app: PMOC é do painel, e o perfil de Técnico não ganhou o módulo", () => {
    expect(PRESETS.TECNICO.pmoc?.visualizar ?? false).toBe(false);
    expect(emModoTecnico({ role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" })).toBe(true);
    expect(destinoModoTecnico("/pmoc")).toBe("/tecnico?aviso=restrito");
    // Dar PMOC a um perfil de campo (sem o papel TECNICO) é permissão A MAIS: ele sai do modo app e vê o painel
    const comPmoc = { ...PRESETS.TECNICO, pmoc: { visualizar: true } };
    expect(ehTecnicoPuro("OPERADOR", PRESETS.TECNICO)).toBe(true);
    expect(ehTecnicoPuro("OPERADOR", comPmoc)).toBe(false);
  });
});

/* ═════════ telas ═════════ */
let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  navegacao.push.mockClear(); navegacao.refresh.mockClear(); navegacao.caminho = "/pmoc";
  pedidos = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: [] };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.unstubAllGlobals(); vi.useRealTimers(); });

const $ = <T extends Element = HTMLElement>(s: string) => caixa.querySelector(s) as T | null;
const $$ = (s: string) => [...caixa.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = caixa) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (rotulo: string) => $$("button").find((b) => texto(b) === rotulo || b.getAttribute("aria-label") === rotulo || b.getAttribute("title") === rotulo);
async function montar(elemento: React.ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}

const equip = (id: string, extra: Record<string, unknown> = {}) => ({ id, nome: null, marca: "LG", modelo: "S4", patrimonio: null, tipo: "AR_CONDICIONADO_SPLIT", capacidade: null, setor: null, localizacao: null, ativo: true, unidadeId: "u1", tipoEquipamento: null, unidade: { nome: "Matriz" }, ...extra });
const Q1 = equip("q1", { nome: "Split da recepção", patrimonio: "TAG-001", capacidade: "48000", setor: "Térreo", localizacao: "Recepção", tipoEquipamento: { nome: "Split Piso Teto" } });
const plano = (extra: Partial<PmocDados> = {}): PmocDados => ({
  id: "p1", nome: "PMOC 2026 — Hospital", descricao: "Texto", clienteId: "c1", unidadeId: "u1", dataInicio: "2026-01-01", dataExpiracao: "2026-12-31",
  status: "RASCUNHO", responsavelTecnicoId: null, rtNome: null, rtCrea: null, artNumero: null, artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null, ativo: true,
  cliente: { id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }, unidade: { id: "u1", nome: "Matriz", cidade: "São Paulo", estado: "SP" },
  equipamentos: [], ...extra,
});
async function abrirEditor(props: Record<string, unknown> = {}, permissoes: Permissoes = permissoesTotais()) {
  const [{ PmocEditor }, { PermissoesProvider }] = await Promise.all([import("@/components/pmoc/pmoc-editor"), import("@/components/providers/permissoes-provider")]);
  await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(PmocEditor, props) }));
}

describe("PMOC: selo de status", () => {
  const selo = async (p: { status: string; dataInicio: string; dataExpiracao: string }, detalhe = true) => {
    const { PmocStatusSelo } = await import("@/components/pmoc/pmoc-status-selo");
    if (root) { act(() => root.unmount()); caixa.remove(); }
    await montar(createElement(PmocStatusSelo, { pmoc: p, detalhe }));
    const el = $("[data-status-pmoc]")!;
    return { status: el.getAttribute("data-status-pmoc"), tom: el.getAttribute("data-tom"), texto: texto(el), classe: el.className };
  };

  it("cada situação com o seu tom e o seu texto: a cor reforça, a palavra diz", async () => {
    expect(await selo({ status: "RASCUNHO", dataInicio: "2026-01-01", dataExpiracao: "2026-12-31" })).toMatchObject({ status: "RASCUNHO", tom: "previsto", texto: "Rascunho · não publicado" });
    expect(await selo(pub("2026-01-01", "2027-06-30"))).toMatchObject({ status: "VIGENTE", tom: "ok", texto: "Vigente · até 30/06/2027" });
    expect(await selo(pub("2026-01-01", "2026-11-22"))).toMatchObject({ status: "VIGENTE", tom: "atencao", texto: "Vigente · vence em 10 dias" });
    expect(await selo(pub("2026-01-01", "2026-11-13"))).toMatchObject({ tom: "atencao", texto: "Vigente · vence em 1 dia" });
    expect(await selo(pub("2026-01-01", "2026-11-12"))).toMatchObject({ tom: "atencao", texto: "Vigente · vence hoje" });
    expect(await selo(pub("2025-01-01", "2026-10-31"))).toMatchObject({ status: "EXPIRADO", tom: "atrasado", texto: "Expirado · desde 31/10/2026" });
    expect(await selo(pub("2027-01-01", "2027-12-31"))).toMatchObject({ status: "VIGENTE", tom: "ok", texto: "Vigente · a partir de 01/01/2027" });
    expect((await selo(pub("2026-01-01", "2027-06-30"), false)).texto).toBe("Vigente"); // na lista: só a palavra
  });

  it("usa os tons de status do sistema de design (nada de cor solta do Tailwind)", async () => {
    expect((await selo(pub("2026-01-01", "2027-06-30"))).classe).toContain("bg-ok-claro text-ok-texto");
    expect((await selo(pub("2025-01-01", "2026-10-31"))).classe).toContain("bg-atrasado-claro text-atrasado-texto");
    expect((await selo({ status: "RASCUNHO", dataInicio: "2026-01-01", dataExpiracao: "2026-12-31" })).classe).toContain("bg-previsto-claro text-previsto-texto");
  });
});

describe("PMOC: editor (Identificação e Equipamentos AVAC)", () => {
  it("novo plano: texto legal padrão, vigência de 1 ano a partir de hoje (dd/mm/aaaa) e a aba de equipamentos só depois de salvar", async () => {
    await abrirEditor();
    expect(texto($("h1"))).toBe("Novo PMOC");
    expect(($("textarea[aria-label='Descrição']") as HTMLTextAreaElement).value).toBe(DESCRICAO_PADRAO_PMOC);
    expect($$("input[data-input-data]").map((i) => [(i as HTMLInputElement).getAttribute("aria-label"), (i as HTMLInputElement).value])).toEqual([["Data de início", "12/11/2026"], ["Data de expiração", "11/11/2027"]]);
    const abas = $$("[role=tablist] > button").map((b) => ({ rotulo: texto(b).replace(/ em breve$/, ""), desabilitada: (b as HTMLButtonElement).disabled, futura: b.hasAttribute("data-aba-futura") }));
    expect(abas.slice(0, 3)).toEqual([{ rotulo: "Identificação", desabilitada: false, futura: false }, { rotulo: "Equipamentos AVAC", desabilitada: true, futura: false }, { rotulo: "Cronograma", desabilitada: true, futura: false }]);
    expect(botao("Criar PMOC")).toBeTruthy();
    expect(botao("Publicar")).toBeUndefined(); // só existe depois de salvo
  });

  it("escopo: Planejamento, Ocorrências, Recomendações e Anexos aparecem como 'em breve', DESABILITADAS (o Cronograma chegou na Etapa 2)", async () => {
    await abrirEditor({ inicial: plano() });
    const futuras = $$("[data-aba-futura]");
    expect(futuras.map((b) => texto(b))).toEqual(["Planejamento em breve", "Ocorrências em breve", "Recomendações em breve", "Anexos em breve"]);
    for (const b of futuras) expect((b as HTMLButtonElement).disabled).toBe(true);
    // Etapa 3: documento em PDF, aviso de vencimento, envio ao cliente e histórico entraram — cada um na sua rota
    expect(fs.readdirSync(path.join(RAIZ, "app/api/pmocs/[id]")).sort()).toEqual(["art", "aviso", "copia", "cronograma", "documento", "enviar", "equipamentos", "historico", "impacto", "route.ts"]);
    // O cronograma (regras e geração de OS) continua sem saber de envio nem de PDF
    const fonte = ["components/pmoc/pmoc-cronograma.tsx", "lib/pmoc-cronograma.ts", "lib/pmoc-cronograma-server.ts", "lib/pmoc-cronograma-rotas.ts"]
      .map((f) => fs.readFileSync(path.join(RAIZ, f), "utf8")).join("\n");
    expect(fonte).not.toMatch(/whatsapp|pdf-lib|enviarEmail|notifica/i);
  });

  it("criar: envia a identificação, nasce Rascunho e abre a aba de equipamentos do plano novo", async () => {
    respostas["POST /api/pmocs"] = { status: 201, corpo: { id: "novo1" } };
    await abrirEditor();
    await clicar(botao("Criar PMOC"));
    const post = pedidos.find((p) => p.metodo === "POST")!;
    expect(post.url).toBe("/api/pmocs");
    expect(post.corpo).toMatchObject({ status: "RASCUNHO", dataInicio: "2026-11-12", dataExpiracao: "2027-11-11", descricao: DESCRICAO_PADRAO_PMOC, responsavelTecnicoId: null });
    expect(navegacao.push).toHaveBeenCalledWith("/pmoc/novo1?aba=equipamentos&criado=1");
  });

  it("o servidor recusou: a mensagem dele aparece na tela e nada navega", async () => {
    respostas["POST /api/pmocs"] = { status: 400, corpo: { erro: "Selecione o cliente." } };
    await abrirEditor();
    await clicar(botao("Criar PMOC"));
    expect(texto($("[data-msg='erro']"))).toBe("Selecione o cliente.");
    expect(navegacao.push).not.toHaveBeenCalled();
  });

  it("publicar sem RT, ART e equipamento: a tela diz o que falta e NÃO chama o servidor", async () => {
    await abrirEditor({ inicial: plano() });
    await clicar(botao("Publicar"));
    expect(texto($("[data-msg='erro']"))).toBe("Para publicar, falta: nome do Responsável Técnico, registro CREA do Responsável Técnico, número da ART, pelo menos 1 equipamento coberto.");
    expect(pedidos.filter((p) => p.metodo === "PUT")).toEqual([]);
  });

  it("publicar com tudo preenchido: salva como PUBLICADO e o selo vira Vigente; depois dá para voltar para rascunho", async () => {
    const pronto = plano({ rtNome: "Eng. Paula", rtCrea: "SP-1", artNumero: "123", equipamentos: [{ id: "v1", equipamento: Q1 as any }] });
    respostas["PUT /api/pmocs/p1"] = { status: 200, corpo: { ...pronto, status: "PUBLICADO" } };
    await abrirEditor({ inicial: pronto });
    expect($("[data-status-pmoc]")!.getAttribute("data-status-pmoc")).toBe("RASCUNHO");
    await clicar(botao("Publicar"));
    expect(pedidos.find((p) => p.metodo === "PUT")!.corpo).toMatchObject({ status: "PUBLICADO", rtNome: "Eng. Paula", rtCrea: "SP-1", artNumero: "123" });
    expect($("[data-status-pmoc]")!.getAttribute("data-status-pmoc")).toBe("VIGENTE");
    expect(texto($("[data-msg='ok']"))).toBe("PMOC publicado.");
    expect(botao("Publicar")).toBeUndefined();
    expect(botao("Voltar para rascunho")).toBeTruthy();
  });

  it("equipamentos cobertos: TAG, equipamento, tipo, capacidade e ambiente, do cadastro real; sugere os da unidade", async () => {
    const outro = equip("q2", { patrimonio: "TAG-002" });
    const deOutraUnidade = equip("q3", { patrimonio: "TAG-003", unidadeId: "u9", unidade: { nome: "Anexo" } });
    respostas["GET /api/equipamentos?clienteId=c1"] = { status: 200, corpo: [Q1, outro, deOutraUnidade] };
    await abrirEditor({ inicial: plano({ equipamentos: [{ id: "v1", equipamento: Q1 as any }] }), abaInicial: "equipamentos" });
    const linha = $$("[data-coberto='q1'] td").map((td) => texto(td));
    expect(linha.slice(0, 5)).toEqual(["TAG-001", "Split da recepção", "Split Piso Teto", "48.000 BTU/h", "Térreo › Recepção"]);
    // Sugestão: só os da unidade do plano que ainda não estão nele; os de outra unidade aparecem ao pedir
    expect($$("[data-candidato]").map((c) => c.getAttribute("data-candidato"))).toEqual(["q2"]);
    await clicar($("[data-sugestoes] input[type=checkbox]:not([data-candidato] input)"));
    expect($$("[data-candidato]").map((c) => c.getAttribute("data-candidato"))).toEqual(["q2", "q3"]);
    expect(texto($("[data-candidato='q3']"))).toContain("(Anexo)");
  });

  it("adicionar e excluir do plano chamam as rotas certas e a tela mostra o que o servidor devolveu", async () => {
    const outro = equip("q2", { patrimonio: "TAG-002" });
    respostas["GET /api/equipamentos?clienteId=c1"] = { status: 200, corpo: [Q1, outro] };
    const comUm = plano({ equipamentos: [{ id: "v1", equipamento: Q1 as any }] });
    respostas["POST /api/pmocs/p1/equipamentos"] = { status: 200, corpo: { ...comUm, equipamentos: [...comUm.equipamentos, { id: "v2", equipamento: outro }] } };
    respostas["DELETE /api/pmocs/p1/equipamentos?equipamentoId=q1"] = { status: 409, corpo: { erro: "Um PMOC publicado precisa de pelo menos 1 equipamento. Volte para Rascunho antes de excluir o último." } };
    await abrirEditor({ inicial: comUm, abaInicial: "equipamentos" });
    await clicar(botao("Adicionar todos desta unidade (1)"));
    expect(pedidos.find((p) => p.metodo === "POST")).toMatchObject({ url: "/api/pmocs/p1/equipamentos", corpo: { equipamentoIds: ["q2"] } });
    expect($$("[data-coberto]").map((l) => l.getAttribute("data-coberto"))).toEqual(["q1", "q2"]);
    await clicar($("[data-coberto='q1'] button[title='Excluir do PMOC']"));
    expect(texto($("[data-msg='erro']"))).toContain("precisa de pelo menos 1 equipamento");
    expect($$("[data-coberto]")).toHaveLength(2); // o servidor recusou: nada some da tela
  });

  it("quem só visualiza: campos travados, sem Salvar, Publicar, Criar cópia, Inativar nem a área de adicionar equipamentos", async () => {
    respostas["GET /api/equipamentos?clienteId=c1"] = { status: 200, corpo: [Q1] };
    await abrirEditor({ inicial: plano({ equipamentos: [{ id: "v1", equipamento: Q1 as any }] }) }, montarPermissoes({ pmoc: ["visualizar"] }));
    expect(($("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    for (const rotulo of ["Salvar", "Publicar", "Criar cópia", "Inativar"]) expect(botao(rotulo), rotulo).toBeUndefined();
    // "Enviar ART" continua desenhado, mas dentro do bloco travado: o navegador não deixa clicar
    expect(botao("Enviar ART")!.closest("fieldset")!.disabled).toBe(true);
    expect($$("input[data-input-data]").every((i) => (i as HTMLInputElement).disabled)).toBe(true);
    await clicar($$("[role=tab]").find((b) => texto(b).startsWith("Equipamentos AVAC")));
    expect($$("[data-coberto]")).toHaveLength(1);
    expect($("[data-sugestoes]")).toBeNull();
    expect($("button[title='Excluir do PMOC']")).toBeNull();
    expect(pedidos.some((p) => p.url.startsWith("/api/equipamentos"))).toBe(false);
  });

  it("cada permissão libera o seu botão: criar → Criar cópia; editar → Salvar e Publicar; excluir → Inativar", async () => {
    const ver = async (...acoes: ("criar" | "editar" | "excluir")[]) => {
      if (root) { act(() => root.unmount()); caixa.remove(); }
      await abrirEditor({ inicial: plano() }, montarPermissoes({ pmoc: ["visualizar", ...acoes] }));
      return ["Salvar", "Publicar", "Criar cópia", "Inativar"].filter((r) => botao(r));
    };
    expect(await ver("criar")).toEqual(["Criar cópia"]);
    expect(await ver("editar")).toEqual(["Salvar", "Publicar"]);
    expect(await ver("excluir")).toEqual(["Inativar"]);
    expect(await ver("criar", "editar", "excluir")).toEqual(["Salvar", "Publicar", "Criar cópia", "Inativar"]);
  });

  it("plano inativo: aviso, edição travada e o botão vira Reativar", async () => {
    await abrirEditor({ inicial: plano({ ativo: false }) });
    expect(texto($("[data-aviso-inativo]"))).toContain("Este PMOC está inativo");
    expect(($("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(botao("Salvar")).toBeUndefined();
    expect(botao("Publicar")).toBeUndefined();
    expect(botao("Reativar")).toBeTruthy();
  });
});

describe("PMOC: menu e cabeçalho", () => {
  const equipamentos = async (permissoes: Permissoes, role = "OPERADOR") => {
    const { Sidebar } = await import("@/components/layout/sidebar");
    if (root) { act(() => root.unmount()); caixa.remove(); }
    await montar(createElement(Sidebar, { session: { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role, permissoes } } as any }));
    const grupo = $$("button[aria-expanded]").find((b) => texto(b) === "Equipamentos");
    if (grupo && grupo.getAttribute("aria-expanded") !== "true") await clicar(grupo);
    return $$("nav a").map((a) => a.getAttribute("href"));
  };

  it("o item 'PMOC' fica no grupo Equipamentos e só aparece para quem tem pmoc › visualizar", async () => {
    expect(await equipamentos(permissoesTotais())).toEqual(expect.arrayContaining(["/equipamentos", "/qrcodes", "/pmoc"]));
    expect(await equipamentos(PRESETS.SUPERVISOR)).toContain("/pmoc");
    expect(await equipamentos(montarPermissoes({}), "ADMIN")).toContain("/pmoc");
    expect(await equipamentos(montarPermissoes({ equipamentos: ["visualizar"], pmoc: ["visualizar"] }))).toContain("/pmoc");
    for (const sem of [PRESETS.TECNICO, PRESETS.AUXILIAR, montarPermissoes({ equipamentos: ["visualizar", "criar", "editar", "excluir"], qrcodes: ["visualizar"] })]) {
      const links = await equipamentos(sem);
      expect(links).toContain("/equipamentos"); // o grupo abriu: o que falta é só o PMOC
      expect(links).not.toContain("/pmoc");
    }
  });

  it("o caminho do topo mostra 'PMOC' e 'Detalhes' (não o id cru do plano)", async () => {
    const { gerarBreadcrumb } = await import("@/components/layout/header");
    expect(gerarBreadcrumb("/pmoc/cmuvnvcjv000f7abcdefghijk").map((i) => i.label)).toEqual(["PMOC", "Detalhes"]);
    expect(gerarBreadcrumb("/pmoc/novo").map((i) => i.label)).toEqual(["PMOC", "Novo"]);
  });
});
