// @vitest-environment happy-dom
/**
 * DESEMPENHO (PR 2 — pagar) nas telas, num DOM de verdade (as regras estão em desempenho-fechamento e o
 * servidor em desempenho-pg):
 *  - Fechamento: mês aberto = projeção; fechar pede a confirmação dos avisos; mês fechado = folha
 *    definitiva, exportar e reabrir (com motivo); premiação com o critério do desempate; histórico;
 *  - painel e ficha do mês fechado (selo, "Bônus fechado", premiação ganha); revisão travada;
 *  - app do técnico: a vista Desempenho (o dele: escore, composição, posição, bônus projetado/fechado),
 *    que só aparece na navegação de quem participa.
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
const reducao = vi.hoisted(() => ({ dataUrl: "data:image/jpeg;base64,QUJD" }));
vi.mock("@/lib/imagem-cliente", () => ({ reduzirImagem: vi.fn(async () => ({ imagem: { dataUrl: reducao.dataUrl, largura: 10, altura: 10, bytes: 3 }, qualidade: {} })) }));

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;

beforeEach(() => {
  pedidos = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url: u, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${u}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const $ = <T extends Element = HTMLElement>(s: string) => (document.body.querySelector(s) as T | null);
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | string | null | undefined) => { const alvo = typeof el === "string" ? $(el) : el; expect(alvo, String(el)).toBeTruthy(); await act(async () => { (alvo as HTMLElement).click(); }); await esperar(); };
async function digitar(alvo: string | Element, valor: string) {
  const el = (typeof alvo === "string" ? $(alvo) : alvo) as HTMLInputElement | HTMLTextAreaElement; expect(el, String(alvo)).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(seletor: string, valor: string) {
  const el = $(seletor) as HTMLSelectElement; expect(el, seletor).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montar(elemento: React.ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}
const enviados = (metodo: string, parte = "") => pedidos.filter((p) => p.metodo === metodo && p.url.includes(parte));
const responder = (chave: string, corpo: unknown, status = 200) => { respostas[chave] = { status, corpo }; };

const TUDO = { revisar: true, gerenciar: true };
const MES = "2026-10", ATUAL = "2026-11";
const reais = (el: Element | null) => texto(el).replace(/\s/g, " ");

const folha = (valorDaBia = 350) => ({ linhas: [
  { tecnicoId: "t1", nome: "Ana Dias", perfil: "Preventiva", posicao: 1, escore: 100, faixa: "Ouro", valor: 350 },
  { tecnicoId: "t2", nome: "Bia Reis", perfil: "Preventiva", posicao: 2, escore: 85, faixa: "Prata", valor: valorDaBia },
  { tecnicoId: "t9", nome: "Novato", perfil: "Corretiva", posicao: null, escore: null, faixa: null, valor: 0 },
], total: 350 + valorDaBia });
const premios = [
  { premiacaoId: "p1", titulo: "Kit de ferramentas", descricao: null, perfil: "Preventiva", ganhadores: [{ tecnicoId: "t1", nome: "Ana Dias", escore: 100 }], criterio: "PRAZO" },
  { premiacaoId: "p2", titulo: "Folga extra", descricao: null, perfil: null, ganhadores: [{ tecnicoId: "t3", nome: "Edu Prado", escore: 94 }, { tecnicoId: "t4", nome: "Rui Lima", escore: 94 }], criterio: "DIVIDIDO" },
  { premiacaoId: "p3", titulo: "Vale-jantar", descricao: null, perfil: "Instalação", ganhadores: [], criterio: null },
];
const resumo = (x: Record<string, unknown> = {}) => ({
  id: "f1", competencia: MES, versao: 1, situacao: "FECHADO", total: 700, fechadoEm: "2026-11-02T15:00:00Z", fechadoPor: "Gil Gestor",
  reabertoEm: null, reabertoPor: null, reaberturaMotivo: null, premios, ...x,
});
const aberto = (x: Record<string, unknown> = {}) => ({ competencia: MES, situacao: "ABERTO", bloqueio: null, avisos: [], folha: folha(), premios, fechamento: null, ...x });
const fechado = (x: Record<string, unknown> = {}) => ({ competencia: MES, situacao: "FECHADO", bloqueio: "Este mês já está fechado.", avisos: [], folha: folha(), premios, fechamento: resumo(), ...x });

/* ───────── fechamento ───────── */
describe("Fechamento do mês e folha de bônus", () => {
  async function abrir(mes: unknown = aberto(), historico: unknown[] = []) {
    responder(`GET /api/desempenho/fechamentos?mes=${MES}`, { mes, historico });
    const { FechamentoDesempenho } = await import("@/components/desempenho/fechamento-client");
    await montar(createElement(FechamentoDesempenho, { mesInicial: MES, mesAtual: ATUAL, pode: TUDO }));
  }

  it("mês ABERTO: a tela diz que é PROJEÇÃO; a folha traz perfil, posição, escore, faixa e o valor; o total soma", async () => {
    await abrir();
    expect($("[data-fechamento-desempenho]")?.getAttribute("data-situacao")).toBe("ABERTO");
    expect(texto($("[data-mes-aberto]"))).toContain("Os valores abaixo são projeção");
    expect($("[data-folha]")?.getAttribute("data-folha-definitiva")).toBe("nao");
    expect(texto($("[data-folha] thead"))).toContain("Bônus projetado");
    expect($$("[data-linha-folha]").map((l) => [...l.querySelectorAll("td")].map((c) => reais(c)).join("|"))).toEqual([
      "Ana Dias|Preventiva|1º|100,0%|Ouro|R$ 350,00", "Bia Reis|Preventiva|2º|85,0%|Prata|R$ 350,00", "Novato|Corretiva|—|—|—|R$ 0,00",
    ]);
    expect(reais($("[data-folha-total]"))).toBe("R$ 700,00");
    expect(texto($("[data-folha]"))).toContain("Pagamento, imposto e encargo são lançados no financeiro");
    expect($("[data-exportar]")).toBeNull(); // só mês fechado exporta
    expect($("[data-reabrir]")).toBeNull();
    expect(texto($("[data-historico-vazio]"))).toBe("Nenhum mês foi fechado ainda.");
  });

  it("PREMIAÇÃO: quem ganha e POR QUÊ (o critério do desempate); prêmio dividido tem aviso; sem ninguém acima da meta, sem ganhador", async () => {
    await abrir();
    const kit = $('[data-premiado="Kit de ferramentas"]')!;
    expect(texto(kit.querySelector("[data-ganhadores]"))).toBe("Ana Dias");
    expect(kit.getAttribute("data-criterio")).toBe("PRAZO");
    expect(texto(kit.querySelector("[data-texto-criterio]"))).toBe("Empate no escore, na avaliação e nas penalidades: desempatou quem teve mais atividades no prazo.");
    expect(kit.querySelector("[data-premio-dividido]")).toBeNull();
    const folga = $('[data-premiado="Folga extra"]')!;
    expect(texto(folga.querySelector("[data-ganhadores]"))).toBe("Edu Prado e Rui Lima");
    expect(texto(folga.querySelector("[data-premio-dividido]"))).toBe("Prêmio dividido");
    expect(texto(folga.querySelector("[data-texto-criterio]"))).toBe("Empate em todos os critérios: o prêmio é dividido.");
    expect(texto($('[data-premiado="Vale-jantar"] [data-sem-ganhador]'))).toBe("Ninguém acima da meta mínima: sem ganhador.");
    expect(texto($("[data-premiados]"))).toContain("Quem ganharia cada prêmio se o mês fechasse agora.");
  });

  it("FECHAR sem aviso: mostra colaboradores e total, e manda só o mês (ninguém manda valor)", async () => {
    await abrir();
    await clicar("[data-fechar]");
    expect(texto($("[data-fechar-colaboradores]"))).toBe("3");
    expect(reais($("[data-fechar-total]"))).toBe("R$ 700,00");
    expect($("[data-avisos-fechar]")).toBeNull();
    responder("POST /api/desempenho/fechamentos", {}, 201);
    await clicar("[data-confirmar-fechar]");
    expect(enviados("POST")).toEqual([{ url: "/api/desempenho/fechamentos", metodo: "POST", corpo: { competencia: MES } }]);
    expect($("[data-modal-fechar]")).toBeNull();
    expect(enviados("GET")).toHaveLength(2); // recarrega a tela
  });

  it("FECHAR com avisos: sem marcar a confirmação NÃO chama o servidor; marcada, manda 'ciente'; erro do servidor fica no diálogo", async () => {
    const avisos = ["O mês ainda não terminou. O que acontecer depois do fechamento não entra no escore nem no bônus.", "Há 2 itens a revisar neste mês. Sem revisão, eles não pesam no escore fechado."];
    await abrir(aberto({ avisos }));
    await clicar("[data-fechar]");
    expect($$("[data-avisos-fechar] li").map((l) => texto(l))).toEqual(avisos);
    await clicar("[data-confirmar-fechar]");
    expect(texto($("[data-erro-fechar]"))).toBe("Confirme os avisos para fechar o mês.");
    expect(enviados("POST")).toHaveLength(0);
    await clicar("[data-ciente]");
    expect($("[data-erro-fechar]")).toBeNull();
    responder("POST /api/desempenho/fechamentos", { erro: "Este mês já está fechado." }, 409);
    await clicar("[data-confirmar-fechar]");
    expect(enviados("POST")[0].corpo).toEqual({ competencia: MES, ciente: true });
    expect(texto($("[data-erro-fechar]"))).toBe("Este mês já está fechado.");
    expect($("[data-modal-fechar]")).toBeTruthy();
  });

  it("mês que não pode fechar (sem ninguém, mês futuro): o botão fica travado e a tela diz por quê", async () => {
    await abrir(aberto({ bloqueio: "Nenhum colaborador participa do Desempenho: não há o que fechar.", folha: { linhas: [], total: 0 }, premios: [] }));
    expect(($("[data-fechar]") as HTMLButtonElement).disabled).toBe(true);
    expect(texto($("[data-mes-aberto]"))).toBe("Nenhum colaborador participa do Desempenho: não há o que fechar.");
    expect(texto($("[data-folha-vazia]"))).toBe("Nenhum colaborador nesta folha.");
    expect($("[data-premiados]")).toBeNull();
  });

  it("mês FECHADO: quem fechou e quando; valores DEFINITIVOS; exportar a planilha daquele fechamento; sem botão de fechar", async () => {
    await abrir(fechado(), [resumo()]);
    expect($("[data-fechamento-desempenho]")?.getAttribute("data-situacao")).toBe("FECHADO");
    expect(texto($("[data-fechado-por]"))).toBe("Fechado em 02/11/2026 às 12:00 por Gil Gestor. Os valores são definitivos.");
    expect($("[data-folha]")?.getAttribute("data-folha-definitiva")).toBe("sim");
    expect(texto($("[data-folha] thead"))).not.toContain("projetado");
    expect($("[data-exportar]")?.getAttribute("href")).toBe("/api/desempenho/fechamentos/f1/exportar");
    expect($("[data-exportar]")?.hasAttribute("download")).toBe(true);
    expect($("[data-fechar]")).toBeNull();
    expect(texto($("[data-premiados]"))).toContain("Quem ganhou cada prêmio.");
    act(() => root.unmount()); caixa.remove();
    await abrir(fechado({ fechamento: resumo({ versao: 2 }) }));
    expect(texto($("[data-fechado-por]"))).toContain("· 2º fechamento do mês");
  });

  it("REABRIR pede MOTIVO antes de chamar o servidor; com motivo, manda e recarrega", async () => {
    await abrir(fechado());
    await clicar("[data-reabrir]");
    expect(texto($("[data-modal-reabrir]"))).toContain("O fechamento atual continua no histórico.");
    await clicar("[data-confirmar-reabrir]");
    expect(texto($("[data-erro-reabrir]"))).toBe("Explique por que o mês está sendo reaberto (mínimo 10 caracteres).");
    await digitar("[data-campo-motivo-reabertura]", "  curto  ");
    await clicar("[data-confirmar-reabrir]");
    expect(enviados("POST")).toHaveLength(0);
    await digitar("[data-campo-motivo-reabertura]", "Faltou revisar a ressalva da Bia");
    expect($("[data-erro-reabrir]")).toBeNull();
    await clicar("[data-confirmar-reabrir]");
    expect(enviados("POST")).toEqual([{ url: "/api/desempenho/fechamentos/f1/reabrir", metodo: "POST", corpo: { motivo: "Faltou revisar a ressalva da Bia" } }]);
    expect($("[data-modal-reabrir]")).toBeNull();
    expect(enviados("GET")).toHaveLength(2);
  });

  it("HISTÓRICO (só leitura): mês, versão, quem fechou, total, premiados — e a reabertura com quem, quando e por quê", async () => {
    const reaberto = resumo({ id: "f0", situacao: "REABERTO", total: 550, reabertoEm: "2026-11-03T15:00:00Z", reabertoPor: "Ana Admin", reaberturaMotivo: "Faltou revisar a ressalva" });
    await abrir(fechado({ fechamento: resumo({ id: "f1", versao: 2 }) }), [resumo({ id: "f1", versao: 2 }), reaberto]);
    const linhas = $$("[data-fechamento]");
    expect(linhas.map((l) => `${l.getAttribute("data-fechamento")}|v${l.getAttribute("data-versao")}|${l.getAttribute("data-situacao-fechamento")}|${reais(l.querySelector("[data-historico-total]"))}`)).toEqual([
      "2026-10|v2|FECHADO|R$ 700,00", "2026-10|v1|REABERTO|R$ 550,00",
    ]);
    expect(texto(linhas[0])).toContain("2º fechamento");
    expect(texto(linhas[0].querySelector("[data-historico-premiados]"))).toBe("Premiação: Kit de ferramentas — Ana Dias; Folga extra — Edu Prado e Rui Lima");
    expect(linhas[0].querySelector("[data-reabertura]")).toBeNull();
    expect(texto(linhas[1].querySelector("[data-reabertura]"))).toBe("Reaberto em 03/11/2026 por Ana Admin: Faltou revisar a ressalva");
    // O histórico não tem ação que mude nada: só "Ver folha"
    expect($$("[data-historico] button").map((b) => texto(b))).toEqual(["Ver folha", "Ver folha"]);
  });

  it("'Ver folha' de um fechamento antigo: busca AQUELA folha, mostra só leitura, avisa que foi reaberto e exporta aquele arquivo", async () => {
    const reaberto = resumo({ id: "f0", situacao: "REABERTO", total: 550 });
    await abrir(fechado(), [resumo(), reaberto]);
    responder("GET /api/desempenho/fechamentos/f0", { ...reaberto, folha: folha(200) });
    await clicar('[data-fechamento][data-situacao-fechamento="REABERTO"] [data-ver-folha]');
    expect(enviados("GET", "/fechamentos/f0").map((p) => p.url)).toEqual(["/api/desempenho/fechamentos/f0"]);
    const modal = $("[data-modal-folha-antiga]")!;
    expect(texto(modal)).toContain("Este fechamento foi reaberto e não vale mais.");
    expect(reais(modal.querySelector('[data-linha-folha="Bia Reis"] [data-folha-valor]'))).toBe("R$ 200,00");
    expect(reais(modal.querySelector("[data-folha-total]"))).toBe("R$ 550,00");
    expect(modal.querySelector("[data-exportar-antiga]")?.getAttribute("href")).toBe("/api/desempenho/fechamentos/f0/exportar");
    expect(modal.querySelector("[data-reabrir], [data-fechar], [data-confirmar-fechar]")).toBeNull();
    expect(pedidos.filter((p) => p.metodo !== "GET")).toHaveLength(0);
  });

  it("troca de mês pede a folha daquele mês; não avança além do mês corrente; erro do servidor aparece", async () => {
    await abrir();
    expect(($("[data-mes-seguinte]") as HTMLButtonElement).disabled).toBe(false);
    responder(`GET /api/desempenho/fechamentos?mes=${ATUAL}`, { erro: "Sem permissão para esta ação" }, 403);
    await clicar("[data-mes-seguinte]");
    expect(enviados("GET").map((p) => p.url)).toEqual([`/api/desempenho/fechamentos?mes=${MES}`, `/api/desempenho/fechamentos?mes=${ATUAL}`]);
    expect(texto($("[data-erro-fechamento]"))).toBe("Sem permissão para esta ação");
    expect(($("[data-mes-seguinte]") as HTMLButtonElement).disabled).toBe(true);
    expect($("[data-folha]")).toBeNull();
  });
});

/* ───────── o mês fechado nas outras telas ───────── */
describe("Mês fechado no painel, na ficha e na revisão", () => {
  const regra = { vigenteDesde: MES, pesoPrazo: 40, pesoRelatorio: 30, pesoAvaliacao: 30, exigirFotoAntesDepois: true, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70, faixas: [{ nome: "Ouro", minimo: 90, valor: 350 }] };
  const linha = (x: Record<string, unknown> = {}) => ({
    tecnicoId: "t1", nome: "Ana Dias", posicao: 1, escore: 100, base: 100, desconto: 0, atingiuMeta: true, faixa: "Ouro", composicao: [],
    penalidades: { retornos: 0, reclamacoes: 0, pontosRetorno: 0, pontosReclamacao: 0 }, bonus: 350, desempate: { mediaAvaliacao: 5, penalidades: 0, noPrazo: 3 }, ...x,
  });
  const selo = { id: "f1", versao: 1, fechadoEm: "2026-11-02T15:00:00Z", fechadoPor: "Gil Gestor" };

  it("painel: selo 'Mês fechado' com a data e quem fechou; mês aberto não tem selo", async () => {
    const painel = { ativo: true, competencia: MES, aRevisar: 0, semPerfil: 0, grupos: [{ perfil: { id: "p1", nome: "Preventiva", tipo: "TECNICO" }, regra, linhas: [linha()] }], equipes: [], premiacoes: [], fechamento: selo };
    responder(`GET /api/desempenho?mes=${MES}`, painel);
    const { PainelDesempenho } = await import("@/components/desempenho/painel-client");
    await montar(createElement(PainelDesempenho, { mesAtual: MES, pode: TUDO }));
    expect(texto($("[data-mes-fechado]"))).toBe("Mês fechado em 02/11/2026 por Gil Gestor. Escore, faixa e bônus são definitivos.");
    expect($$("[data-aba]").map((a) => a.getAttribute("data-aba"))).toContain("fechamento");
    act(() => root.unmount()); caixa.remove();
    responder(`GET /api/desempenho?mes=${MES}`, { ...painel, fechamento: null });
    await montar(createElement(PainelDesempenho, { mesAtual: MES, pode: { revisar: true, gerenciar: false } }));
    expect($("[data-mes-fechado]")).toBeNull();
    expect($$("[data-aba]").map((a) => a.getAttribute("data-aba"))).not.toContain("fechamento"); // a aba é de quem gerencia
  });

  it("ficha: mês fechado = 'Bônus fechado', definitivo, com a premiação ganha; mês aberto = 'Bônus projetado'", async () => {
    const ficha = { competencia: MES, tecnico: { id: "t1", nome: "Ana Dias" }, perfil: { id: "p1", nome: "Preventiva", tipo: "TECNICO" }, regra, linha: linha(), participantes: 2, penalidades: [], premiacoes: [], fechamento: selo, premiosGanhos: ["Kit de ferramentas", "Vale-jantar"] };
    responder(`GET /api/desempenho/colaboradores/t1?mes=${MES}`, ficha);
    const { FichaDesempenho } = await import("@/components/desempenho/ficha-client");
    await montar(createElement(FichaDesempenho, { tecnicoId: "t1", mesInicial: MES, mesAtual: ATUAL }));
    expect(texto($("[data-resumo-ficha]"))).toContain("Bônus fechado");
    expect(texto($("[data-resumo-ficha]"))).not.toContain("Bônus projetado");
    expect(texto($("[data-ficha-situacao-bonus]"))).toBe("Definitivo: mês fechado em 02/11/2026.");
    expect(reais($("[data-ficha-bonus]"))).toBe("R$ 350,00");
    expect(texto($("[data-premios-ganhos]"))).toBe("Ganhou a premiação do mês: Kit de ferramentas, Vale-jantar.");
    act(() => root.unmount()); caixa.remove();
    responder(`GET /api/desempenho/colaboradores/t1?mes=${MES}`, { ...ficha, fechamento: null, premiosGanhos: [] });
    await montar(createElement(FichaDesempenho, { tecnicoId: "t1", mesInicial: MES, mesAtual: ATUAL }));
    expect(texto($("[data-resumo-ficha]"))).toContain("Bônus projetado");
    expect($("[data-ficha-situacao-bonus]")?.getAttribute("data-ficha-situacao-bonus")).toBe("projetado");
    expect($("[data-premios-ganhos]")).toBeNull();
  });

  it("revisão: item de mês fechado não tem 'Conta / Não conta', 'Rever', editar nem excluir — a tela manda reabrir o mês", async () => {
    const item = (x: Record<string, unknown>) => ({
      id: "pe1", tipo: "RESSALVA", situacao: "A_REVISAR", descricao: "OS-1: ressalva", dataFato: "2026-10-10T15:00:00Z", competencia: MES, motivo: null, revisadoEm: null, revisadoPor: null,
      criadoPor: null, tecnico: { id: "t2", nome: "Bia Reis" }, ordemServico: null, osRetorno: null, manual: false, mesFechado: false, ...x,
    });
    responder("GET /api/desempenho/penalidades?situacao=A_REVISAR", { ativo: true, aRevisar: 1, colaboradores: [], itens: [
      item({ id: "fechadoA", mesFechado: true }), item({ id: "fechadoB", mesFechado: true, situacao: "CONTA", motivo: "Contou" }),
      item({ id: "fechadoC", mesFechado: true, tipo: "RECLAMACAO", manual: true }), item({ id: "abertoD", competencia: ATUAL }),
    ] });
    const { RevisaoDesempenho } = await import("@/components/desempenho/revisao-client");
    await montar(createElement(RevisaoDesempenho, { pode: TUDO }));
    for (const id of ["fechadoA", "fechadoB", "fechadoC"]) {
      expect(texto($(`[data-penalidade="${id}"] [data-mes-fechado-item]`)), id).toBe("Mês fechado: reabra para mudar.");
      expect($(`[data-penalidade="${id}"] [data-acoes-penalidade] button`), id).toBeNull();
    }
    expect($('[data-penalidade="abertoD"] [data-conta]')).toBeTruthy();
    expect($('[data-penalidade="abertoD"] [data-mes-fechado-item]')).toBeNull();
    expect(texto()).toContain("Retorno e ressalva sem nota entram aqui sozinhos.");
  });
});

/* ───────── app do técnico ───────── */
describe("App do técnico: a vista Desempenho", () => {
  const regra = { vigenteDesde: ATUAL, pesoPrazo: 40, pesoRelatorio: 30, pesoAvaliacao: 30, exigirFotoAntesDepois: true, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70, faixas: [{ nome: "Bronze", minimo: 70, valor: 100 }, { nome: "Ouro", minimo: 90, valor: 350 }] };
  const ficha = (x: Record<string, unknown> = {}) => ({
    competencia: ATUAL, tecnico: { id: "t2", nome: "Bia Reis" }, perfil: { id: "p1", nome: "Preventiva", tipo: "TECNICO" }, regra, participantes: 5,
    linha: {
      tecnicoId: "t2", nome: "Bia Reis", posicao: 2, escore: 83, base: 88, desconto: 5, atingiuMeta: true, faixa: "Bronze", bonus: 100,
      composicao: [
        { metrica: "prazo", peso: 40, valor: 75, pontos: 30, detalhe: "3 de 4 atividades" }, { metrica: "relatorio", peso: 30, valor: 100, pontos: 30, detalhe: "4 de 4 relatórios" },
        { metrica: "avaliacao", peso: 30, valor: 93.4, pontos: 28, detalhe: "média 4,7 em 3 avaliações" },
      ],
      penalidades: { retornos: 1, reclamacoes: 0, pontosRetorno: 5, pontosReclamacao: 0 }, desempate: { mediaAvaliacao: 4.67, penalidades: 1, noPrazo: 3 },
    },
    penalidades: [
      { id: "x1", tipo: "RETORNO", situacao: "CONTA", descricao: "OS-9 (corretiva) aberta 5 dias depois do serviço da OS-3", dataFato: "2026-11-10T15:00:00Z", motivo: "Faltou reaperto" },
      { id: "x2", tipo: "RESSALVA", situacao: "A_REVISAR", descricao: null, dataFato: "2026-11-11T15:00:00Z", motivo: null },
    ],
    premiacoes: [{ id: "pr1", titulo: "Caixa de som", descricao: "Para o maior escore", perfil: null, temImagem: true }], fechamento: null, premiosGanhos: [], ...x,
  });
  async function abrir(resposta: unknown = { participa: true, ficha: ficha() }, status = 200) {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    responder(`GET /api/tecnico/desempenho?mes=${ATUAL}`, resposta, status);
    const { DesempenhoTecnico } = await import("@/components/tecnico/desempenho");
    await montar(createElement(DesempenhoTecnico));
  }

  it("mês aberto: o escore DELE, a faixa, a posição no perfil e o bônus PROJETADO (a tela diz que pode mudar)", async () => {
    await abrir();
    expect(enviados("GET").map((p) => p.url)).toEqual([`/api/tecnico/desempenho?mes=${ATUAL}`]); // a rota não leva id de ninguém
    expect(texto($("[data-meu-escore]"))).toBe("83,0%");
    expect($("[data-resumo] [data-faixa]")?.getAttribute("data-faixa")).toBe("Bronze");
    expect(texto($("[data-minha-posicao]"))).toBe("2º de 5");
    expect($("[data-meu-bonus-situacao]")?.getAttribute("data-meu-bonus-situacao")).toBe("projetado");
    expect(texto($("[data-meu-bonus-situacao]"))).toContain("Bônus projetado");
    expect(reais($("[data-meu-bonus]"))).toBe("R$ 100,00");
    expect(texto($("[data-explica-bonus]"))).toBe("Projeção: muda até o escritório fechar o mês.");
    expect(texto($("[data-resumo]"))).toContain("Meta mínima: 70% · Bronze 70% · Ouro 90%");
    expect($("[data-premios-ganhos]")).toBeNull();
  });

  it("COMPOSIÇÃO com os números de cada métrica; a avaliação aparece como MÉDIA; penalidades só com tipo, data e situação", async () => {
    await abrir();
    expect($$("[data-minha-composicao] [data-metrica]").map((l) => `${texto(l.querySelector("[data-metrica-detalhe]"))}|${texto(l.querySelector("[data-metrica-valor]"))}|${texto(l.querySelector("[data-metrica-pontos]"))}`)).toEqual([
      "3 de 4 atividades · peso 40%|75,0%|30,0 pontos", "4 de 4 relatórios · peso 30%|100,0%|30,0 pontos", "média 4,7 em 3 avaliações · peso 30%|93,4%|28,0 pontos",
    ]);
    expect(texto($("[data-meu-desconto]"))).toBe("Penalidades que contaram: 1− 5,0 pontos");
    expect($$("[data-minha-penalidade]").map((p) => texto(p))).toEqual([
      "Retorno · 10/11/2026OS-9 (corretiva) aberta 5 dias depois do serviço da OS-3Conta", "Ressalva do cliente · 11/11/2026A revisar",
    ]);
    expect(texto($("[data-premio-em-disputa]"))).toContain("Caixa de som");
    expect($("[data-premio-imagem]")?.getAttribute("src")).toBe("/api/tecnico/desempenho/premiacoes/pr1/imagem"); // a rota do app, não a do painel
  });

  it("mês FECHADO: 'Bônus fechado', valor definitivo e a premiação conquistada; métrica sem medição aparece sem pontos", async () => {
    const semAvaliacao = ficha().linha.composicao.map((c: any) => (c.metrica === "avaliacao" ? { ...c, valor: null, pontos: null, detalhe: "sem avaliação no mês" } : c));
    await abrir({ participa: true, ficha: ficha({
      fechamento: { id: "f1", versao: 1, fechadoEm: "2026-12-02T15:00:00Z", fechadoPor: "Gil" }, premiosGanhos: ["Caixa de som"],
      linha: { ...ficha().linha, bonus: 350, faixa: "Ouro", escore: 95, desconto: 0, penalidades: { retornos: 0, reclamacoes: 0, pontosRetorno: 0, pontosReclamacao: 0 }, composicao: semAvaliacao }, penalidades: [],
    }) });
    expect(texto($("[data-meu-bonus-situacao]"))).toContain("Bônus fechado");
    expect($("[data-meu-bonus-situacao]")?.getAttribute("data-meu-bonus-situacao")).toBe("fechado");
    expect(reais($("[data-meu-bonus]"))).toBe("R$ 350,00");
    expect(texto($("[data-explica-bonus]"))).toBe("Mês fechado em 02/12/2026: o valor é definitivo.");
    expect(texto($("[data-premios-ganhos]"))).toBe("Premiação do mês conquistada: Caixa de som.");
    expect(texto($('[data-metrica="avaliacao"] [data-metrica-valor]'))).toBe("—");
    expect(texto($('[data-metrica="avaliacao"] [data-metrica-pontos]'))).toBe("sem pontos");
    expect(texto($("[data-meu-desconto]"))).toBe("Penalidades que contaram: 0sem desconto");
    expect($("[data-minhas-penalidades]")).toBeNull();
  });

  it("troca de mês busca o mês anterior; não avança além do mês corrente", async () => {
    await abrir();
    expect(($("[data-mes-seguinte]") as HTMLButtonElement).disabled).toBe(true);
    responder("GET /api/tecnico/desempenho?mes=2026-10", { participa: true, ficha: ficha({ competencia: "2026-10" }) });
    await clicar("[data-mes-anterior]");
    expect(enviados("GET").map((p) => p.url)).toEqual([`/api/tecnico/desempenho?mes=${ATUAL}`, "/api/tecnico/desempenho?mes=2026-10"]);
    expect(texto($("[data-resumo]"))).toContain("Escore de outubro de 2026");
  });

  it("quem não participa, perfil sem regra e falha de conexão: mensagem clara, sem tela quebrada", async () => {
    await abrir({ participa: false, ficha: null });
    expect(texto($("[data-nao-participa]"))).toContain("Sem desempenho para mostrar em novembro de 2026.");
    act(() => root.unmount()); caixa.remove();
    await abrir({ participa: true, ficha: ficha({ regra: null }) });
    expect(texto($("[data-sem-regra]"))).toBe("O perfil Preventiva ainda não tem regra neste mês: não há escore.");
    act(() => root.unmount()); caixa.remove();
    await abrir({ erro: "Não autorizado" }, 401);
    expect(texto($("[data-erro-desempenho]"))).toBe("Não foi possível carregar o desempenho.");
    act(() => root.unmount()); caixa.remove();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { DesempenhoTecnico } = await import("@/components/tecnico/desempenho");
    await montar(createElement(DesempenhoTecnico));
    expect(texto($("[data-erro-desempenho]"))).toBe("Sem conexão. O desempenho aparece quando o sinal voltar.");
  });
});
