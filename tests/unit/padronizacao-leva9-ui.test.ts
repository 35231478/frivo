// @vitest-environment happy-dom
/**
 * Leva 9 — Desempenho nas telas, num DOM de verdade: o que a leva mudou de comportamento.
 *
 *  - fechar e reabrir o mês avisam por toast, com o mês no texto; o erro do servidor fica no diálogo
 *    e a tela NÃO muda;
 *  - a revisão avisa por toast em cada decisão, e a exclusão passa pela confirmação da casa —
 *    recusar a confirmação não chama o servidor;
 *  - a folha de bônus é a tabela da casa: as mesmas linhas no desktop e nos cartões do celular, e o
 *    total do mês na faixa (não em rodapé de tabela);
 *  - a premiação avisa por toast e pergunta antes de excluir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/desempenho", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...resto }: any) => React.createElement("a", { href, ...resto }, children) };
});
const avisos = vi.hoisted(() => ({ toasts: [] as string[], confirmacoes: [] as { titulo?: string; mensagem: string }[], responder: true }));
vi.mock("@/components/ui/avisos", () => ({
  toast: (m: string) => { avisos.toasts.push(m); },
  confirmar: async (o: { titulo?: string; mensagem: string } | string) => {
    avisos.confirmacoes.push(typeof o === "string" ? { mensagem: o } : o);
    return avisos.responder;
  },
}));

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;

beforeEach(() => {
  pedidos = []; respostas = {};
  avisos.toasts = []; avisos.confirmacoes = []; avisos.responder = true;
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url: u, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${u}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const $ = <T extends Element = HTMLElement>(s: string) => (document.body.querySelector(s) as T | null);
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (sel: string) => { const el = $(sel); expect(el, sel).toBeTruthy(); await act(async () => { el!.click(); }); await esperar(); };
const digitar = async (sel: string, valor: string) => {
  const el = $(sel) as HTMLTextAreaElement; expect(el, sel).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
};
const responder = (chave: string, corpo: unknown, status = 200) => { respostas[chave] = { status, corpo }; };
const enviados = (metodo: string, parte = "") => pedidos.filter((p) => p.metodo === metodo && p.url.includes(parte));
/** Os toasts com o espaço do "R$" normalizado (formatarMoeda usa espaço fino). */
const toasts = () => avisos.toasts.map((t) => t.replace(/\u00a0/g, " "));

async function montar(elemento: ReturnType<typeof createElement>) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}

const MES = "2026-10";
const ATUAL = "2026-11";
const TUDO = { revisar: true, gerenciar: true };

const folha = (valor = 350) => ({
  linhas: [
    { tecnicoId: "t1", nome: "Ana Dias", perfil: "Preventiva", posicao: 1, escore: 100, faixa: "Ouro", valor },
    { tecnicoId: "t2", nome: "Bia Reis", perfil: "Preventiva", posicao: 2, escore: 85, faixa: "Prata", valor },
  ],
  total: valor * 2,
});
const resumoFechamento = (x: Record<string, unknown> = {}) => ({
  id: "f1", competencia: MES, versao: 1, situacao: "FECHADO", total: 700, fechadoEm: "2026-11-01T12:00:00Z", fechadoPor: "Gil Gestor",
  reabertoEm: null, reabertoPor: null, reaberturaMotivo: null, premios: [], ...x,
});
const previaAberta = (x: Record<string, unknown> = {}) => ({ competencia: MES, situacao: "ABERTO", bloqueio: null, avisos: [], folha: folha(), premios: [], fechamento: null, ...x });

async function abrirFechamento(mes: unknown = previaAberta(), historico: unknown[] = []) {
  responder(`GET /api/desempenho/fechamentos?mes=${MES}`, { mes, historico });
  const { FechamentoDesempenho } = await import("@/components/desempenho/fechamento-client");
  await montar(createElement(FechamentoDesempenho, { mesInicial: MES, mesAtual: ATUAL, pode: TUDO }));
}

describe("fechar e reabrir o mês avisam por toast", () => {
  it("fechar: o toast traz o mês e o total da folha; a tela recarrega", async () => {
    await abrirFechamento();
    await clicar("[data-fechar]");
    responder("POST /api/desempenho/fechamentos", { folha: folha(), premios: [] }, 201);
    await clicar("[data-confirmar-fechar]");
    expect(toasts()).toEqual(["outubro de 2026 fechado. Bônus: R$ 700,00."]);
    expect($("[data-modal-fechar]")).toBeNull();
  });

  it("fechar recusado pelo servidor: o erro fica no diálogo, sem toast e sem fechar a tela", async () => {
    await abrirFechamento();
    await clicar("[data-fechar]");
    responder("POST /api/desempenho/fechamentos", { erro: "Sem permissão para esta ação" }, 403);
    await clicar("[data-confirmar-fechar]");
    expect(texto($("[data-erro-fechar]"))).toBe("Sem permissão para esta ação");
    expect(avisos.toasts).toEqual([]);
    expect($("[data-modal-fechar]")).not.toBeNull();
  });

  it("reabrir: pede motivo, avisa por toast e diz que os valores voltam a ser projeção", async () => {
    await abrirFechamento({ ...previaAberta(), situacao: "FECHADO", fechamento: resumoFechamento() }, [resumoFechamento()]);
    await clicar("[data-reabrir]");
    await clicar("[data-confirmar-reabrir]"); // sem motivo: nem chama o servidor
    expect(enviados("POST")).toHaveLength(0);
    await digitar("[data-campo-motivo-reabertura]", "Avaliação lançada na OS errada");
    responder("POST /api/desempenho/fechamentos/f1/reabrir", resumoFechamento({ situacao: "REABERTO" }));
    await clicar("[data-confirmar-reabrir]");
    expect(avisos.toasts).toEqual(["outubro de 2026 reaberto: os valores voltam a ser projeção."]);
  });
});

describe("a folha de bônus é a tabela da casa", () => {
  it("as mesmas linhas na tabela e nos cartões, e o total do mês na faixa", async () => {
    await abrirFechamento();
    const naTabela = $$("[data-tabela-folha] [data-linha-folha]").map((l) => l.getAttribute("data-linha-folha"));
    const nosCartoes = $$("[data-folha-cartoes] [data-linha-folha]").map((l) => l.getAttribute("data-linha-folha"));
    expect(naTabela).toEqual(["Ana Dias", "Bia Reis"]);
    expect(nosCartoes).toEqual(naTabela);
    expect(texto($("[data-folha-resumo-barra]")).replace(/\u00a0/g, " ")).toBe("2 colaboradores · Total do mês R$ 700,00");
    // o total não está em rodapé de tabela: a casa não tem <tfoot>
    expect($("[data-tabela-folha] tfoot")).toBeNull();
  });

  it("um colaborador só: a faixa fala no singular", async () => {
    await abrirFechamento(previaAberta({ folha: { linhas: [folha().linhas[0]], total: 350 } }));
    expect(texto($("[data-folha-resumo-barra]")).replace(/\u00a0/g, " ")).toBe("1 colaborador · Total do mês R$ 350,00");
  });
});

describe("a revisão avisa e pergunta", () => {
  const item = (x: Record<string, unknown> = {}) => ({
    id: "pe1", tipo: "RECLAMACAO", situacao: "A_REVISAR", competencia: MES, dataFato: "2026-10-05T12:00:00Z", descricao: "Cliente ligou",
    tecnico: { id: "t1", nome: "Ana Dias" }, ordemServico: null, osRetorno: null, criadoPor: "Gil", motivo: null, revisadoPor: null, revisadoEm: null,
    manual: true, mesFechado: false, ...x,
  });
  const lista = (itens: unknown[]) => ({ itens, aRevisar: itens.length, colaboradores: [{ id: "t1", nome: "Ana Dias" }], ativo: true });

  async function abrirRevisao(itens: unknown[] = [item()]) {
    responder("GET /api/desempenho/penalidades?situacao=A_REVISAR", lista(itens));
    const { RevisaoDesempenho } = await import("@/components/desempenho/revisao-client");
    await montar(createElement(RevisaoDesempenho, { pode: TUDO }));
  }

  it("decidir que conta: toast com a palavra do escore", async () => {
    await abrirRevisao();
    await clicar("[data-conta]");
    await digitar("[data-campo-motivo]", "o defeito era do serviço anterior");
    responder("POST /api/desempenho/penalidades/pe1/decisao", { ok: true });
    await clicar("[data-confirmar-decisao]");
    expect(avisos.toasts).toEqual(["Decisão registrada: conta no escore."]);
  });

  it("excluir reclamação: a confirmação é a da casa, e recusar não chama o servidor", async () => {
    await abrirRevisao();
    avisos.responder = false;
    await clicar("[data-excluir]");
    expect(avisos.confirmacoes.at(-1)).toMatchObject({ titulo: "Excluir reclamação" });
    expect(avisos.confirmacoes.at(-1)?.mensagem).toContain("Ana Dias");
    expect(enviados("DELETE")).toHaveLength(0);

    avisos.responder = true;
    await clicar("[data-excluir]");
    expect(enviados("DELETE").map((p) => p.url)).toEqual(["/api/desempenho/penalidades/pe1"]);
    expect(avisos.toasts).toEqual(["Reclamação excluída."]);
  });

  it("erro do servidor ao excluir: fica na tela, sem toast", async () => {
    await abrirRevisao();
    responder("DELETE /api/desempenho/penalidades/pe1", { erro: "Sem permissão para esta ação" }, 403);
    await clicar("[data-excluir]");
    expect(texto($("[data-erro-revisao]"))).toBe("Sem permissão para esta ação");
    expect(avisos.toasts).toEqual([]);
  });
});

describe("a premiação avisa e pergunta", () => {
  const premiacao = { id: "pr1", titulo: "Kit de ferramentas", descricao: null, perfilId: null, perfil: null, competencia: MES, temImagem: false };

  async function abrirPremiacoes() {
    responder(`GET /api/desempenho/premiacoes?mes=${ATUAL}`, [premiacao]);
    const { PremiacoesDesempenho } = await import("@/components/desempenho/premiacoes-client");
    await montar(createElement(PremiacoesDesempenho, { mesAtual: ATUAL, pode: TUDO, perfis: [] }));
  }

  it("excluir: pergunta com o título do prêmio e avisa por toast", async () => {
    await abrirPremiacoes();
    await clicar("[data-excluir]");
    expect(avisos.confirmacoes.at(-1)?.mensagem).toContain("Kit de ferramentas");
    expect(enviados("DELETE").map((p) => p.url)).toEqual(["/api/desempenho/premiacoes/pr1"]);
    expect(avisos.toasts).toEqual(["Premiação excluída."]);
  });
});
