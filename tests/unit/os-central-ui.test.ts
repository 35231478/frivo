// @vitest-environment happy-dom
/**
 * Central da OS — a tela de detalhe num DOM de verdade:
 *  - cabeçalho: status automático (pelos fatos), barra Aberta→…→Faturada, cliente/local, previsão
 *    no DIA certo (fuso de Brasília), números-chave (atividades, equipamentos, valor, pagamento);
 *  - 6 abas (antes 11), links antigos (?aba=prazos/orcamentos/…) caem na aba que as absorveu, e o
 *    SLA vive dentro de Atividades; "O que falta" leva à aba onde se resolve;
 *  - ajuste manual discreto (sem Cancelar, Concluir só com permissão), aviso quando diverge dos
 *    fatos com quem/quando e "Voltar ao automático"; sem permissão de editar, nada disso aparece;
 *  - prazo da atividade: chip de atraso, edição em dd/mm/aaaa que vai como AAAA-MM-DD.
 */
process.env.TZ = "America/Sao_Paulo";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([import("@/components/os/os-detalhe"), import("@/components/providers/permissoes-provider")]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear();
  respostas = {};
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T15:00:00Z") }); // 30/10 12h em Brasília
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function montar(os: any, abaInicial?: string, permissoes: Permissoes = permissoesTotais()) {
  const [{ OsDetalhe }, { PermissoesProvider }] = await Promise.all([import("@/components/os/os-detalhe"), import("@/components/providers/permissoes-provider")]);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(OsDetalhe, { os, abaInicial }) })); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const texto = (sel: string) => ($(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const abaAtiva = () => $("[data-aba][aria-current='true'], [data-aba][aria-current='page']")?.getAttribute("data-aba");
async function escolher(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}

const tec = { id: "t1", nome: "João Silva" };
const atividade = (id: string, extra: Record<string, unknown> = {}) => ({
  id, titulo: `Atividade ${id}`, status: "AGENDADA", dataAgendada: null, prazo: null, duracaoMin: null, observacao: null, resumo: null,
  tipoOs: null, tipoOsId: null, tecnicoId: "t1", tecnico: tec, equipe: null, tecnicosEquipe: [{ tecnico: tec }], veiculo: null, equipamentos: [], respostas: [], ...extra,
});
const fixture = (extra: Record<string, unknown> = {}) => ({
  id: "os1", numero: "OS-2026-0301", chamadoNumero: null, origem: "INTERNA", status: "AGENDADA", statusManual: false, prioridade: "ALTA",
  cliente: { id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" },
  unidade: { id: "un1", nome: "Bloco B", cidade: "Florianópolis", estado: "SC" }, unidadeId: "un1", contrato: null,
  responsavel: { id: "u1", nome: "Ana Gestora" }, criadoPor: { id: "u1", nome: "Ana Gestora" },
  criadoEm: "2026-10-20T13:00:00.000Z", previsaoConclusao: "2026-10-28T00:00:00.000Z", dataInicio: null, dataConclusao: null,
  descricao: "Manutenção corretiva nos splits do bloco B", observacoes: null,
  atividades: [
    atividade("a1", { status: "CONCLUIDA", equipamentos: [{ feito: true }, { feito: true }], resumo: "Filtros limpos" }),
    atividade("a2", { status: "EM_ANDAMENTO", prazo: "2026-10-27T00:00:00.000Z", equipamentos: [{ feito: true }, { feito: false }] }),
    atividade("a3", { status: "CANCELADA", prazo: "2026-10-01T00:00:00.000Z" }), // encerrada: prazo antigo não vira atraso
  ],
  itensOrcamento: [{ id: "io1", descricao: "Capacitor", quantidade: 1, valorUnitario: 200, valorTotal: 200 }],
  orcamentos: [{ orcamento: { id: "orc1", codigo: "ORC-0007", nome: "Troca de compressor", status: "APROVADO", totalGeral: 1000, criadoEm: "2026-10-21T13:00:00Z", validadeEm: null, tokenPublico: "tk" } }],
  medicoes: [], anexos: [], servicosAdicionais: [], prazos: [{ id: "p1", status: "ATRASADO" }],
  historico: [
    { id: "h1", acao: "Status automático", detalhes: "ABERTA → AGENDADA", criadoEm: "2026-10-20T13:00:00Z", usuario: { nome: "Ana Gestora" } },
  ],
  ...extra,
});

describe("cabeçalho-resumo da OS", () => {
  it("status pelos FATOS, barra de progresso, cliente/local, previsão no dia certo e números-chave", async () => {
    await montar(fixture());
    expect($("[data-cabecalho-os] h1")?.textContent).toBe("OS-2026-0301");
    // gravado AGENDADA, mas há atividade em andamento: mostra Em execução (sem ajuste manual)
    expect($("[data-status-os]")?.getAttribute("data-status-os")).toBe("EM_ANDAMENTO");
    expect(texto("[data-status-os]")).toBe("Em execução");
    expect($("[data-status-manual]")).toBeNull();
    expect($$("[data-barra-progresso] [data-etapa]").map((li) => [li.getAttribute("data-etapa"), li.getAttribute("data-estado")])).toEqual([
      ["ABERTA", "feito"], ["AGENDADA", "feito"], ["EM_ANDAMENTO", "atual"], ["CONCLUIDA", "futuro"], ["FATURADA", "futuro"],
    ]);
    expect(texto("[data-cliente-os]")).toBe("Hospital Santa Clara");
    expect(texto("[data-cabecalho-os]")).toContain("Bloco B — Florianópolis/SC");
    expect(texto("[data-cabecalho-os]")).toContain("Ana Gestora");
    // 28/10 (e não 27/10, o erro do fuso) e atrasada 2 dias em 30/10
    expect(texto("[data-prazo-os]")).toMatch(/^Previsão 28\/10\/2026\s*Atrasada 2 dias$/);
    expect($("[data-prazo-os]")?.getAttribute("data-prazo-os")).toBe("ATRASADO");
    expect(texto("[data-numero='atividades']")).toContain("1 de 2 concluídas"); // cancelada não conta
    expect(texto("[data-numero='equipamentos']")).toContain("3");
    expect(texto("[data-numero='valor']")).toMatch(/R\$\s?1\.200,00 · R\$\s?0,00/);
    expect($("[data-pagamento]")?.getAttribute("data-pagamento")).toBe("PREVISTO");
  });

  it("Faturada: concluída com medição e conta paga", async () => {
    await montar(fixture({
      status: "CONCLUIDA",
      atividades: [atividade("a1", { status: "CONCLUIDA", equipamentos: [{ feito: true }] })],
      medicoes: [{ id: "m1", numero: "MED-1", status: "APROVADA", valorTotal: 1200, criadoEm: "2026-10-29T13:00:00Z", tokenPublico: "t", contasReceber: [{ status: "RECEBIDO", dataVencimento: "2026-10-29T00:00:00Z", valor: 1200 }] }],
    }));
    expect($("[data-status-os]")?.getAttribute("data-status-os")).toBe("FATURADA");
    expect($$("[data-barra-progresso] [data-estado='feito']")).toHaveLength(4);
    expect($("[data-pagamento]")?.getAttribute("data-pagamento")).toBe("PAGO");
    expect(texto("[data-numero='valor']")).toMatch(/R\$\s?1\.200,00 · R\$\s?1\.200,00/);
  });

  it("ajuste manual atrás dos fatos: a barra mostra o ajustado (Aberta) e avisa", async () => {
    await montar(fixture({ status: "ABERTA", statusManual: true }));
    expect($("[data-status-os]")?.getAttribute("data-status-os")).toBe("ABERTA");
    expect($("[data-barra-progresso] [data-estado='atual']")?.getAttribute("data-etapa")).toBe("ABERTA");
    expect($("[data-aviso-manual]")).toBeTruthy();
  });

  it("depois do router.refresh() (nova OS do servidor) o cabeçalho acompanha", async () => {
    const os = fixture();
    await montar(os);
    expect($("[data-status-os]")?.getAttribute("data-status-os")).toBe("EM_ANDAMENTO");
    const { OsDetalhe } = await import("@/components/os/os-detalhe");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const nova = fixture({ status: "CONCLUIDA", atividades: [atividade("a1", { status: "CONCLUIDA", equipamentos: [{ feito: true }] })] });
    await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OsDetalhe, { os: nova }) })); });
    await esperar();
    expect($("[data-status-os]")?.getAttribute("data-status-os")).toBe("CONCLUIDA");
    expect($("[data-pendencia-os='faturar']")).toBeTruthy();
  });

  it("cancelada: faixa no lugar da barra e sem ajuste de status", async () => {
    await montar(fixture({ status: "CANCELADA" }));
    expect($("[data-barra-progresso]")).toBeNull();
    expect(texto("[data-cabecalho-os]")).toContain("OS inativada (cancelada)");
    expect($("[data-ajustar-status]")).toBeNull();
    expect($("[data-cartao='o-que-falta'] [data-pendencia-os]")).toBeNull();
  });
});

describe("abas consolidadas e O que falta", () => {
  it("6 abas; Resumo abre por padrão com o que falta (inclui SLA atrasado) e cada item leva à aba certa", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    await montar(fixture());
    expect($$("[data-aba]").map((b) => b.getAttribute("data-aba"))).toEqual(["resumo", "atividades", "comercial", "materiais", "financeiro", "relatorios"]);
    expect(abaAtiva()).toBe("resumo");
    expect($$("[data-pendencia-os]").map((b) => b.getAttribute("data-pendencia-os"))).toEqual(["atividade-atrasada", "os-atrasada", "sla-atrasado"]);
    // Prazos no Resumo: previsão da OS + atividade com prazo próprio
    expect($$("[data-cartao='prazos'] [data-linha-prazo]").map((l) => l.getAttribute("data-linha-prazo"))).toEqual(["ATRASADO", "ATRASADO"]);
    expect(texto("[data-ver-sla]")).toContain("SLA: 1 em andamento (1 atrasado)");
    await clicar($("[data-pendencia-os='sla-atrasado']"));
    expect(abaAtiva()).toBe("atividades");
    expect($("[data-secao-sla]")).toBeTruthy(); // a antiga aba Prazos vive aqui
    expect(chamadas.some((c) => c.metodo === "GET" && c.url === "/api/ordens/os1/prazos")).toBe(true); // com a gestão de SLA de antes
    expect(replace).toHaveBeenLastCalledWith(null, "", "?aba=atividades");
    await clicar($("[data-numero='pagamento']"));
    expect(abaAtiva()).toBe("financeiro");
    await clicar($("[data-numero='valor']"));
    expect(abaAtiva()).toBe("comercial");
    expect($("[data-secao-orcamentos]")).toBeTruthy();
    expect($("[data-secao-itens]")).toBeTruthy();
    await clicar($("[data-aba='resumo']"));
    expect(replace).toHaveBeenLastCalledWith(null, "", window.location.pathname);
  });

  it("links antigos: ?aba=prazos → Atividades; ?aba=orcamentos → Comercial; ?aba=anexos → Relatórios & Anexos; ?aba=historico → Resumo", async () => {
    for (const [antiga, nova, secao] of [["prazos", "atividades", "[data-secao-sla]"], ["orcamentos", "comercial", "[data-secao-itens]"], ["anexos", "relatorios", "[data-secao-anexos]"], ["historico", "resumo", "[data-cartao='historico']"]]) {
      await montar(fixture(), antiga);
      expect(abaAtiva()).toBe(nova);
      expect($(secao)).toBeTruthy();
      act(() => root.unmount()); caixa.remove();
    }
  });

  it("Atividades: chip de atraso no fuso certo e o formulário respondido marcado no cartão", async () => {
    await montar(fixture(), "atividades");
    expect($$("[data-prazo-atividade]").map((c) => [c.getAttribute("data-prazo-atividade"), c.textContent])).toEqual([["ATRASADO", "Atrasada 3 dias"]]);
    expect($$("[data-formulario-respondido]")).toHaveLength(1);
  });

  it("OS sem nada pendente mostra 'Nada pendente'", async () => {
    await montar(fixture({ status: "AGENDADA", previsaoConclusao: null, prazos: [], atividades: [atividade("a1", { dataAgendada: "2026-11-02T13:00:00Z" })] }));
    expect($("[data-status-os]")?.getAttribute("data-status-os")).toBe("AGENDADA");
    expect($("[data-nada-pendente]")).toBeTruthy();
  });
});

describe("status: ajuste manual discreto, aviso de divergência e volta ao automático", () => {
  it("ajuste manual vai como PUT {status}, sem Cancelar na lista e sem Concluída para quem não pode concluir", async () => {
    const p = permissoesTotais() as any;
    p.ordens = { ...p.ordens, concluir: false };
    respostas["PUT /api/ordens/os1"] = { status: 200, corpo: { id: "os1", status: "PAUSADA", statusManual: true } };
    await montar(fixture(), undefined, p);
    expect(texto("[data-ajustar-status]")).toBe("Status automático (Em execução) — ajustar à mão");
    await clicar($("[data-ajustar-status]"));
    const opcoes = [...($<HTMLSelectElement>("[data-painel-ajuste] select")!.options)].map((o) => o.value);
    expect(opcoes).not.toContain("CANCELADA");
    expect(opcoes).not.toContain("CONCLUIDA");
    expect(opcoes).toEqual(expect.arrayContaining(["ABERTA", "AGENDADA", "EM_ANDAMENTO", "PAUSADA", "AGUARDANDO_PECA"]));
    expect($("[data-painel-voltar-automatico]")).toBeNull(); // não está em manual
    await escolher($("[data-painel-ajuste] select"), "PAUSADA");
    await clicar($("[data-aplicar-ajuste]"));
    expect(chamadas.filter((c) => c.metodo === "PUT")).toEqual([{ url: "/api/ordens/os1", metodo: "PUT", corpo: { status: "PAUSADA" } }]);
    expect($("[data-status-manual]")).toBeTruthy();
    expect(texto("[data-status-os]")).toBe("Pausada");
    // Pausada ≠ fatos (Em execução)? Pausada é estágio Em execução, mas o gravado não corresponde → avisa
    expect($("[data-aviso-manual]")).toBeTruthy();
  });

  it("manual que diverge dos fatos AVISA com quem/quando; Voltar ao automático manda voltarAutomatico e some o aviso", async () => {
    respostas["PUT /api/ordens/os1"] = { status: 200, corpo: { id: "os1", status: "EM_ANDAMENTO", statusManual: false } };
    await montar(fixture({
      status: "AGUARDANDO_PECA", statusManual: true,
      historico: [{ id: "h2", acao: "Status ajustado manualmente", detalhes: "EM_ANDAMENTO → AGUARDANDO_PECA", criadoEm: "2026-10-29T18:30:00Z", usuario: { nome: "Carla Souza" } }],
    }));
    expect(texto("[data-status-os]")).toBe("Aguardando Peça");
    expect($("[data-status-manual]")).toBeTruthy();
    const aviso = texto("[data-aviso-manual]");
    expect(aviso).toContain("Aguardando Peça");
    expect(aviso).toContain("por Carla Souza em 29/10/2026 às 15:30");
    expect(aviso).toContain("Em execução");
    await clicar($("[data-voltar-automatico]"));
    expect(chamadas.filter((c) => c.metodo === "PUT").map((c) => c.corpo)).toEqual([{ voltarAutomatico: true }]);
    expect($("[data-aviso-manual]")).toBeNull();
    expect($("[data-status-manual]")).toBeNull();
    expect(texto("[data-status-os]")).toBe("Em execução");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("manual que CONFERE com os fatos não avisa, mas o painel oferece Voltar ao automático", async () => {
    respostas["PUT /api/ordens/os1"] = { status: 200, corpo: { id: "os1", status: "EM_ANDAMENTO", statusManual: false } };
    await montar(fixture({ status: "EM_ANDAMENTO", statusManual: true }));
    expect($("[data-aviso-manual]")).toBeNull();
    expect(texto("[data-ajustar-status]")).toBe("Status em ajuste manual — mudar");
    await clicar($("[data-ajustar-status]"));
    await clicar($("[data-painel-voltar-automatico]"));
    expect(chamadas.filter((c) => c.metodo === "PUT").map((c) => c.corpo)).toEqual([{ voltarAutomatico: true }]);
    expect($("[data-status-manual]")).toBeNull();
  });

  it("erro do servidor no ajuste não muda nada na tela", async () => {
    respostas["PUT /api/ordens/os1"] = { status: 422, corpo: { erro: "Trava" } };
    await montar(fixture());
    await clicar($("[data-ajustar-status]"));
    await escolher($("[data-painel-ajuste] select"), "CONCLUIDA");
    await clicar($("[data-aplicar-ajuste]"));
    expect($("[data-status-manual]")).toBeNull();
    expect($("[data-painel-ajuste]")).toBeTruthy();
  });

  it("sem permissão de editar a OS: sem Editar, sem ajuste e sem Voltar ao automático (o aviso ainda informa)", async () => {
    const p = permissoesTotais() as any;
    p.ordens = { ...p.ordens, editar: false };
    await montar(fixture({ status: "PAUSADA", statusManual: true }), undefined, p);
    expect($("[data-ajustar-status]")).toBeNull();
    expect($("a[href='/ordens/os1/editar']")).toBeNull();
    expect($("[data-aviso-manual]")).toBeTruthy();
    expect($("[data-voltar-automatico]")).toBeNull();
  });
});

describe("prazo da atividade", () => {
  it("editar mostra o prazo em dd/mm/aaaa e envia AAAA-MM-DD; a central é avisada (refresh)", async () => {
    respostas["PUT /api/ordens/os1/atividades/a2"] = { status: 200, corpo: { prazo: "2026-11-04T00:00:00.000Z" } };
    await montar(fixture(), "atividades");
    const cartoes = $$("[data-prazo-atividade]");
    expect(cartoes).toHaveLength(1);
    // abre o cartão da a2 e clica em editar
    const cabecalhoA2 = $$("button").find((b) => b.textContent?.includes("Atividade a2"));
    await clicar(cabecalhoA2);
    await clicar($("button[title='Editar atividade']"));
    const campo = $<HTMLInputElement>("input[aria-label='Prazo da atividade']");
    expect(campo?.value).toBe("27/10/2026");
    await digitar(campo, "04112026");
    await clicar($$("button").find((b) => b.textContent?.trim() === "Salvar"));
    const put = chamadas.find((c) => c.metodo === "PUT");
    expect(put?.url).toBe("/api/ordens/os1/atividades/a2");
    expect(put?.corpo.prazo).toBe("2026-11-04");
    expect(nav.refresh).toHaveBeenCalled();
    expect($$("[data-prazo-atividade]").map((c) => c.getAttribute("data-prazo-atividade"))).toEqual(["NO_PRAZO"]);
  });
});
