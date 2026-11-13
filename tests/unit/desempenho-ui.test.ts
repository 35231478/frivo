// @vitest-environment happy-dom
/**
 * DESEMPENHO nas telas, num DOM de verdade (as regras estão em desempenho-regras e o servidor em
 * desempenho-pg):
 *  - painel: ranking por perfil, sem valor em reais; avisos e abas conforme a permissão; troca de mês;
 *  - ficha: a composição com os números; o bônus só aparece quando o servidor manda o valor;
 *  - a revisar: "Conta" / "Não conta" pedem motivo ANTES de chamar o servidor; rever; reclamação à mão
 *    com editar e excluir (as detectadas não têm esses botões);
 *  - premiação: cadastro, edição e exclusão só para quem gerencia;
 *  - configuração: regra do perfil (soma dos pesos, vigência, faixas), participantes, ajustes, link da TV;
 *  - modo TV: atualiza sozinho e não tem valor em reais.
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
const SO_VER = { revisar: false, gerenciar: false };
const MES = "2026-11";

const regra = (valor: number | null = null) => ({
  vigenteDesde: MES, pesoPrazo: 40, pesoRelatorio: 30, pesoAvaliacao: 30, exigirFotoAntesDepois: true, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70,
  faixas: [{ nome: "Bronze", minimo: 70, valor: valor && 100 }, { nome: "Prata", minimo: 80, valor: valor && 200 }, { nome: "Ouro", minimo: 90, valor: valor && 350 }],
});
const composicao = [
  { metrica: "prazo", peso: 40, valor: 75, pontos: 30, detalhe: "3 de 4 atividades" },
  { metrica: "relatorio", peso: 30, valor: 100, pontos: 30, detalhe: "4 de 4 relatórios" },
  { metrica: "avaliacao", peso: 30, valor: null, pontos: null, detalhe: "sem avaliação no mês" },
];
const linha = (x: Record<string, unknown> = {}) => ({
  tecnicoId: "t1", nome: "Ana Dias", posicao: 1, escore: 88, base: 88, desconto: 0, atingiuMeta: true, faixa: "Prata", composicao,
  penalidades: { retornos: 0, reclamacoes: 0, pontosRetorno: 0, pontosReclamacao: 0 }, bonus: null, ...x,
});
const painel = (x: Record<string, unknown> = {}) => ({
  ativo: true, competencia: MES, aRevisar: 3, semPerfil: 2,
  grupos: [
    { perfil: { id: "p1", nome: "Preventiva", tipo: "TECNICO" }, regra: regra(), linhas: [linha(), linha({ tecnicoId: "t2", nome: "Bia Reis", posicao: 2, escore: 66, faixa: null, atingiuMeta: false }), linha({ tecnicoId: "t9", nome: "Novato", posicao: null, escore: null, faixa: null, atingiuMeta: false })] },
    { perfil: { id: "p2", nome: "Instalação", tipo: "TECNICO" }, regra: null, linhas: [] },
  ],
  equipes: [{ id: "eq1", nome: "Equipe Alfa", cor: "#0EA5E9", lider: "Carlos", escore: 87, participantes: 2, medidos: 2 }, { id: "eq2", nome: "Equipe Beta", cor: "#111", lider: null, escore: null, participantes: 0, medidos: 0 }],
  premiacoes: [{ id: "pr1", titulo: "Kit de ferramentas", descricao: "Para o 1º lugar", perfil: "Preventiva", temImagem: true }], ...x,
});

/* ───────── painel ───────── */
describe("Painel Desempenho", () => {
  async function abrir(pode = TUDO, dados: unknown = painel()) {
    responder(`GET /api/desempenho?mes=${MES}`, dados);
    const { PainelDesempenho } = await import("@/components/desempenho/painel-client");
    await montar(createElement(PainelDesempenho, { mesAtual: MES, pode }));
  }

  it("ranking por perfil: posição, nome, escore e faixa — e a ficha de cada um a um clique", async () => {
    await abrir();
    const linhas = $$('[data-ranking="Preventiva"] [data-linha-ranking]');
    expect(linhas.map((l) => `${l.getAttribute("data-posicao")}|${l.getAttribute("data-linha-ranking")}|${texto(l.querySelector("[data-escore]"))}|${l.querySelector("[data-faixa]")?.getAttribute("data-faixa")}`))
      .toEqual(["1|Ana Dias|88,0%|Prata", "2|Bia Reis|66,0%|abaixo-da-meta", "|Novato|—|sem-medicao"]);
    expect(linhas[0].querySelector("a")?.getAttribute("href")).toBe(`/desempenho/colaborador/t1?mes=${MES}`);
    expect(texto($('[data-ranking="Preventiva"] [data-resumo-regra]'))).toBe("Meta mínima 70% · Bronze a partir de 70% · Prata a partir de 80% · Ouro a partir de 90%");
    expect(texto($('[data-ranking="Instalação"]'))).toContain("Sem regra em vigor neste mês");
    expect(texto($('[data-ranking="Instalação"] [data-ranking-vazio]'))).toBe("Nenhum colaborador neste perfil.");
  });

  it("o painel NUNCA mostra valor em reais; prêmio em disputa e resumo por equipe aparecem", async () => {
    await abrir(TUDO, painel({ grupos: [{ perfil: { id: "p1", nome: "Preventiva", tipo: "TECNICO" }, regra: regra(1), linhas: [linha({ bonus: 200 })] }] }));
    expect(texto()).not.toContain("R$");
    expect(texto()).not.toContain("200");
    expect(texto($("[data-premio-em-disputa]"))).toContain("Kit de ferramentas");
    expect(texto($("[data-premio-disputa]"))).toBe("Disputa do perfil Preventiva");
    expect($("[data-premio-imagem]")?.getAttribute("src")).toBe("/api/desempenho/premiacoes/pr1/imagem");
    expect(texto($('[data-equipe="Equipe Alfa"]'))).toContain("Líder: Carlos");
    expect(texto($('[data-equipe="Equipe Alfa"] [data-equipe-escore]'))).toBe("87,0%");
    expect(texto($('[data-equipe="Equipe Beta"]'))).toContain("Nenhum membro no Desempenho");
    expect(texto($('[data-equipe="Equipe Beta"] [data-equipe-escore]'))).toBe("—");
  });

  it("avisos e abas seguem a permissão: quem só visualiza não vê 'A revisar', 'Configuração' nem os avisos de gestão", async () => {
    await abrir(TUDO);
    expect($$("[data-aba]").map((a) => a.getAttribute("data-aba"))).toEqual(["painel", "revisao", "premiacoes", "fechamento", "configuracao"]);
    expect(texto($("[data-aviso-revisar]"))).toBe("3 itens esperam a revisão. Só pesa depois de revisado.");
    expect(texto($("[data-aviso-sem-perfil]"))).toBe("2 colaboradores ativos estão fora do ranking (sem perfil).");
    expect(texto($("[data-selo-revisar]"))).toBe("3");
    act(() => root.unmount()); caixa.remove();
    await abrir(SO_VER);
    expect($$("[data-aba]").map((a) => a.getAttribute("data-aba"))).toEqual(["painel", "premiacoes"]);
    expect($("[data-avisos-desempenho]")).toBeNull();
    expect($('[data-ranking="Instalação"] a')).toBeNull(); // sem o atalho "Definir a regra"
  });

  it("singular nos avisos; sem nada a revisar e todos com perfil, não há aviso", async () => {
    await abrir(TUDO, painel({ aRevisar: 1, semPerfil: 1 }));
    expect(texto($("[data-aviso-revisar]"))).toBe("1 item espera a revisão. Só pesa depois de revisado.");
    expect(texto($("[data-aviso-sem-perfil]"))).toBe("1 colaborador ativo está fora do ranking (sem perfil).");
    act(() => root.unmount()); caixa.remove();
    await abrir(TUDO, painel({ aRevisar: 0, semPerfil: 0 }));
    expect($("[data-avisos-desempenho]")).toBeNull();
    expect($("[data-selo-revisar]")).toBeNull();
  });

  it("módulo ainda não configurado: explica e leva à configuração só quem pode configurar", async () => {
    await abrir(TUDO, { ativo: false });
    expect(texto($("[data-desempenho-inativo]"))).toContain("O Desempenho ainda não foi configurado.");
    expect($("[data-ir-configurar]")?.getAttribute("href")).toBe("/desempenho/configuracao");
    expect($("[data-ranking]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await abrir(SO_VER, { ativo: false });
    expect($("[data-ir-configurar]")).toBeNull();
    expect(texto($("[data-desempenho-inativo]"))).toContain("Desempenho › Gerenciar");
  });

  it("troca de mês: pede o mês anterior ao servidor; não avança além do mês corrente; erro do servidor aparece", async () => {
    await abrir();
    expect(texto($("[data-mes-rotulo]"))).toBe("novembro de 2026");
    expect(($("[data-mes-seguinte]") as HTMLButtonElement).disabled).toBe(true);
    responder("GET /api/desempenho?mes=2026-10", { erro: "Falhou aqui" }, 500);
    await clicar("[data-mes-anterior]");
    expect(enviados("GET").map((p) => p.url)).toEqual([`/api/desempenho?mes=${MES}`, "/api/desempenho?mes=2026-10"]);
    expect(texto($("[data-mes-rotulo]"))).toBe("outubro de 2026");
    expect(texto($("[data-erro-painel]"))).toBe("Falhou aqui");
    expect(($("[data-mes-seguinte]") as HTMLButtonElement).disabled).toBe(false);
    await clicar("[data-mes-seguinte]");
    expect(enviados("GET")).toHaveLength(3);
    expect($("[data-erro-painel]")).toBeNull();
  });
});

/* ───────── ficha ───────── */
describe("Ficha do colaborador", () => {
  const ficha = (x: Record<string, unknown> = {}) => ({
    competencia: MES, tecnico: { id: "t1", nome: "Ana Dias" }, perfil: { id: "p1", nome: "Preventiva", tipo: "TECNICO" }, regra: regra(1), linha: linha({ bonus: 200 }), participantes: 2,
    penalidades: [], premiacoes: [], fechamento: null, premiosGanhos: [], ...x,
  });
  async function abrir(dados: unknown = ficha(), status = 200) {
    responder(`GET /api/desempenho/colaboradores/t1?mes=${MES}`, dados, status);
    const { FichaDesempenho } = await import("@/components/desempenho/ficha-client");
    await montar(createElement(FichaDesempenho, { tecnicoId: "t1", mesInicial: MES, mesAtual: MES }));
  }

  it("escore, posição, faixa e a COMPOSIÇÃO com os números de cada métrica (sem medição aparece como traço, não zero)", async () => {
    await abrir();
    expect(texto($("[data-ficha-nome]"))).toBe("Ana Dias");
    expect(texto($("[data-ficha-perfil]"))).toBe("Preventiva · Colaborador de campo");
    expect(texto($("[data-ficha-escore]"))).toBe("88,0%");
    expect(texto($("[data-ficha-posicao]"))).toBe("1º");
    expect(texto($("[data-resumo-ficha]"))).toContain("Entre 2 colaboradores");
    expect(texto($("[data-ficha-faixas]"))).toBe("Bronze 70% · Prata 80% · Ouro 90%");
    const linhas = $$("[data-metrica]").map((l) => [...l.querySelectorAll("td")].map((c) => texto(c)).join("|"));
    expect(linhas).toEqual(["Concluídas no prazo|3 de 4 atividades|75,0%|40%|30,0", "Relatórios completos|4 de 4 relatórios|100,0%|30%|30,0", "Avaliação do cliente|sem avaliação no mês|—|30%|—"]);
    expect(texto($("[data-ficha-base]"))).toBe("88,0");
    expect(texto($("[data-ficha-desconto]"))).toBe("0,0");
    expect(texto($("[data-sem-penalidades]"))).toBe("Nada registrado em 11/2026.");
  });

  it("bônus projetado: aparece em reais quando o servidor manda; sem o valor, a tela diz que é só para a gestão", async () => {
    await abrir();
    expect(texto($("[data-ficha-bonus]"))).toMatch(/^R\$\s200,00$/);
    act(() => root.unmount()); caixa.remove();
    await abrir(ficha({ linha: linha({ bonus: null }), regra: regra() }));
    expect($("[data-ficha-bonus]")?.getAttribute("data-ficha-bonus")).toBe("oculto");
    expect(texto()).not.toContain("R$");
  });

  it("penalidades do mês com a situação; o desconto só aparece para o que CONTA; encarregado tem os rótulos de gestão", async () => {
    await abrir(ficha({
      perfil: { id: "p4", nome: "Encarregado", tipo: "GESTAO" },
      linha: linha({ escore: 78, base: 88, desconto: 10, penalidades: { retornos: 1, reclamacoes: 1, pontosRetorno: 5, pontosReclamacao: 5 }, bonus: 100 }),
      penalidades: [
        { id: "x1", tipo: "RETORNO", situacao: "CONTA", descricao: "OS-2 aberta 5 dias depois", dataFato: "2026-11-10T15:00:00Z", motivo: "Faltou reaperto" },
        { id: "x2", tipo: "RESSALVA", situacao: "A_REVISAR", descricao: "OS-3: ficou barulho", dataFato: "2026-11-11T15:00:00Z", motivo: null },
      ],
    }));
    expect($$("[data-metrica] td:first-child").map((c) => texto(c))).toEqual(["Equipe no prazo", "Relatórios completos da equipe", "Satisfação da equipe"]);
    expect(texto($("[data-ficha-desconto]"))).toBe("− 10,0");
    expect(texto($("[data-linha-desconto]"))).toContain("1 de retorno, 1 de reclamação");
    expect($$("[data-penalidade-ficha]").map((p) => `${p.getAttribute("data-penalidade-ficha")}|${texto(p)}`)).toEqual([
      "CONTA|10/11/2026RetornoOS-2 aberta 5 dias depoisMotivo da decisão: Faltou reapertoConta", "A_REVISAR|11/11/2026Ressalva do clienteOS-3: ficou barulhoA revisar",
    ]);
  });

  it("perfil sem regra no mês: não há escore — e a tela diz por quê; colaborador que não participa: a mensagem do servidor", async () => {
    await abrir(ficha({ regra: null, linha: linha({ escore: null, posicao: null, composicao: [] }) }));
    expect(texto($("[data-ficha-sem-regra]"))).toBe("O perfil Preventiva não tem regra em vigor em novembro de 2026: não há escore neste mês.");
    expect($("[data-composicao]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await abrir({ erro: "Este colaborador não participa do Desempenho." }, 404);
    expect(texto($("[data-erro-ficha]"))).toBe("Este colaborador não participa do Desempenho.");
    expect(texto($("[data-ficha-nome]"))).toBe("Ficha do colaborador");
  });
});

/* ───────── a revisar ───────── */
describe("Lista 'A revisar'", () => {
  const item = (x: Record<string, unknown> = {}) => ({
    id: "pe1", tipo: "RETORNO", situacao: "A_REVISAR", descricao: "OS-2 (corretiva) aberta 5 dias depois do serviço da OS-1", dataFato: "2026-11-10T15:00:00Z", competencia: MES, motivo: null,
    revisadoEm: null, revisadoPor: null, criadoPor: null, tecnico: { id: "t3", nome: "Edu Prado" }, ordemServico: { id: "os1", numero: "OS-1" }, osRetorno: { id: "os2", numero: "OS-2" }, manual: false, ...x,
  });
  const manual = item({ id: "pe2", tipo: "RECLAMACAO", descricao: "Cliente ligou reclamando", osRetorno: null, manual: true, criadoPor: "Gil", tecnico: { id: "t1", nome: "Ana Dias" } });
  const lista = (itens: unknown[], x: Record<string, unknown> = {}) => ({ ativo: true, itens, aRevisar: itens.length, colaboradores: [{ id: "t1", nome: "Ana Dias" }, { id: "t3", nome: "Edu Prado" }], ...x });
  async function abrir(dados: unknown = lista([item(), manual])) {
    responder("GET /api/desempenho/penalidades?situacao=A_REVISAR", dados);
    const { RevisaoDesempenho } = await import("@/components/desempenho/revisao-client");
    await montar(createElement(RevisaoDesempenho, { pode: TUDO }));
  }

  it("abre no filtro 'A revisar' e mostra o fato, as OS envolvidas e o mês em que pesa", async () => {
    await abrir();
    expect(enviados("GET").map((p) => p.url)).toEqual(["/api/desempenho/penalidades?situacao=A_REVISAR"]);
    const retorno = $('[data-penalidade="pe1"]')!;
    expect(texto(retorno.querySelector("[data-penalidade-colaborador]"))).toBe("Edu Prado");
    expect(retorno.querySelector("[data-penalidade-colaborador]")?.getAttribute("href")).toBe(`/desempenho/colaborador/t3?mes=${MES}`);
    expect(texto(retorno)).toContain("Pesa em 11/2026");
    expect(retorno.querySelector("[data-penalidade-os]")?.getAttribute("href")).toBe("/ordens/os1");
    expect(texto(retorno.querySelector("[data-penalidade-retorno]"))).toBe("Corretiva: OS-2");
    expect(texto($("[data-selo-revisar]"))).toBe("2");
  });

  it("'Conta' PEDE MOTIVO antes de chamar o servidor; com motivo, grava a decisão e recarrega a lista", async () => {
    await abrir();
    await clicar('[data-penalidade="pe1"] [data-conta]');
    expect(texto($("[data-modal-decisao]"))).toContain("Desconta pontos do escore de 11/2026.");
    await clicar("[data-confirmar-decisao]");
    expect(texto($("[data-erro-decisao]"))).toBe("Explique o motivo da decisão (mínimo 5 caracteres).");
    await digitar("[data-campo-motivo]", "abc ");
    await clicar("[data-confirmar-decisao]");
    expect(enviados("POST")).toHaveLength(0);
    await digitar("[data-campo-motivo]", "Faltou reapertar a conexão");
    expect($("[data-erro-decisao]")).toBeNull(); // o erro some ao corrigir
    await clicar("[data-confirmar-decisao]");
    expect(enviados("POST")).toEqual([{ url: "/api/desempenho/penalidades/pe1/decisao", metodo: "POST", corpo: { situacao: "CONTA", motivo: "Faltou reapertar a conexão" } }]);
    expect($("[data-modal-decisao]")).toBeNull();
    expect(enviados("GET")).toHaveLength(2);
  });

  it("'Não conta' também pede motivo e manda a situação certa; erro do servidor fica no diálogo", async () => {
    await abrir();
    await clicar('[data-penalidade="pe1"] [data-nao-conta]');
    expect($("[data-modal-decisao]")?.getAttribute("data-modal-decisao")).toBe("NAO_CONTA");
    expect(texto($("[data-modal-decisao]"))).toContain("não desconta nada do escore");
    responder("POST /api/desempenho/penalidades/pe1/decisao", { erro: "Não é possível revisar a própria penalidade." }, 403);
    await digitar("[data-campo-motivo]", "Queda de energia no prédio");
    await clicar("[data-confirmar-decisao]");
    expect(enviados("POST")[0].corpo).toEqual({ situacao: "NAO_CONTA", motivo: "Queda de energia no prédio" });
    expect(texto($("[data-erro-decisao]"))).toBe("Não é possível revisar a própria penalidade.");
    expect($("[data-modal-decisao]")).toBeTruthy();
  });

  it("item já decidido mostra quem decidiu e o motivo, e oferece 'Rever decisão' (volta para a revisar)", async () => {
    await abrir(lista([item({ situacao: "CONTA", motivo: "Faltou reaperto", revisadoPor: "Gil Gestor", revisadoEm: "2026-11-12T15:00:00Z" })]));
    expect(texto($("[data-penalidade-motivo]"))).toBe("Decisão de Gil Gestor em 12/11/2026: Faltou reaperto");
    expect($("[data-conta]")).toBeNull();
    await clicar("[data-rever]");
    expect(enviados("POST")).toEqual([{ url: "/api/desempenho/penalidades/pe1/decisao", metodo: "POST", corpo: { situacao: "A_REVISAR" } }]);
  });

  it("editar e excluir só existem na reclamação registrada à mão — nunca no retorno, ressalva ou nota detectados", async () => {
    await abrir();
    expect($('[data-penalidade="pe1"] [data-editar]')).toBeNull();
    expect($('[data-penalidade="pe1"] [data-excluir]')).toBeNull();
    expect($('[data-penalidade="pe2"] [data-editar]')).toBeTruthy();
    expect(texto($('[data-penalidade="pe2"]'))).toContain("Registrada por Gil");
    await clicar('[data-penalidade="pe2"] [data-excluir]');
    expect(texto($("[data-modal-excluir-reclamacao]"))).toContain("Ana Dias");
    await clicar("[data-confirmar-exclusao]");
    expect(enviados("DELETE").map((p) => p.url)).toEqual(["/api/desempenho/penalidades/pe2"]);
  });

  it("registrar reclamação: manda colaborador, data, descrição e a OS; editar usa a mesma tela com os dados", async () => {
    await abrir();
    await clicar("[data-nova-reclamacao]");
    expect(texto($("[data-modal-reclamacao]"))).toContain("registrar não é penalizar");
    expect($$("[data-campo-colaborador] option").map((o) => texto(o))).toEqual(["Escolha…", "Ana Dias", "Edu Prado"]);
    await escolher("[data-campo-colaborador]", "t3");
    await digitar("[data-campo-descricao]", "Cliente ligou: o aparelho voltou a pingar");
    await digitar("[data-campo-os]", "OS-77");
    responder("POST /api/desempenho/penalidades", { erro: "OS não encontrada. Confira o número ou deixe em branco." }, 404);
    await clicar("[data-salvar-reclamacao]");
    expect(enviados("POST")[0].corpo).toMatchObject({ tecnicoId: "t3", descricao: "Cliente ligou: o aparelho voltou a pingar", osNumero: "OS-77" });
    expect(enviados("POST")[0].corpo.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(texto($("[data-erro-reclamacao]"))).toContain("OS não encontrada");
    await digitar("[data-campo-os]", "");
    responder("POST /api/desempenho/penalidades", {}, 201);
    await clicar("[data-salvar-reclamacao]");
    expect(enviados("POST")[1].corpo.osNumero).toBeNull();
    expect($("[data-modal-reclamacao]")).toBeNull();
    // Editar: a tela abre com o que estava gravado
    await clicar('[data-penalidade="pe2"] [data-editar]');
    expect(($("[data-campo-colaborador]") as HTMLSelectElement).value).toBe("t1");
    expect(($("[data-campo-descricao]") as HTMLTextAreaElement).value).toBe("Cliente ligou reclamando");
    expect(($("[data-campo-os]") as HTMLInputElement).value).toBe("OS-1");
    await clicar("[data-salvar-reclamacao]");
    expect(enviados("PUT")).toEqual([{ url: "/api/desempenho/penalidades/pe2", metodo: "PUT", corpo: { tecnicoId: "t1", data: "2026-11-10", descricao: "Cliente ligou reclamando", osNumero: "OS-1" } }]);
  });

  it("filtro por situação pede ao servidor; lista vazia e módulo não configurado têm mensagem própria", async () => {
    await abrir(lista([]));
    expect(texto($("[data-revisao-vazia]"))).toBe("Nada esperando revisão.");
    responder("GET /api/desempenho/penalidades?situacao=CONTA", lista([]));
    await escolher("[data-filtro-situacao]", "CONTA");
    expect(texto($("[data-revisao-vazia]"))).toBe("Nenhum item nesta situação.");
    responder("GET /api/desempenho/penalidades", lista([], { ativo: false }));
    await escolher("[data-filtro-situacao]", "");
    expect(enviados("GET").map((p) => p.url)).toEqual(["/api/desempenho/penalidades?situacao=A_REVISAR", "/api/desempenho/penalidades?situacao=CONTA", "/api/desempenho/penalidades"]);
    expect(texto($("[data-revisao-inativa]"))).toContain("ainda não foi configurado");
    expect($("[data-nova-reclamacao]")).toBeNull();
  });
});

/* ───────── premiação ───────── */
describe("Premiação do mês", () => {
  const premio = { id: "pr1", competencia: MES, titulo: "Kit de ferramentas", descricao: "Para o 1º lugar", perfilId: "p1", perfil: "Preventiva", temImagem: true };
  const PERFIS = [{ id: "p1", nome: "Preventiva" }, { id: "p2", nome: "Corretiva" }];
  async function abrir(pode = TUDO, lista: unknown[] = [premio, { ...premio, id: "pr2", titulo: "Vale-jantar", descricao: null, perfilId: null, perfil: null, temImagem: false }]) {
    responder(`GET /api/desempenho/premiacoes?mes=${MES}`, lista);
    const { PremiacoesDesempenho } = await import("@/components/desempenho/premiacoes-client");
    await montar(createElement(PremiacoesDesempenho, { mesAtual: MES, pode, perfis: PERFIS }));
  }

  it("mostra o brinde (texto, imagem, quem disputa); quem só visualiza não tem cadastrar, editar nem excluir", async () => {
    await abrir(SO_VER);
    expect($$("[data-premiacao]").map((p) => `${p.getAttribute("data-premiacao")}|${texto(p.querySelector("[data-premiacao-disputa]"))}`)).toEqual(["Kit de ferramentas|Disputa do perfil Preventiva", "Vale-jantar|Disputa de todos os perfis"]);
    expect($("[data-premiacao-imagem]")?.getAttribute("src")).toBe("/api/desempenho/premiacoes/pr1/imagem?v=0");
    expect($$("[data-premiacao-sem-imagem]")).toHaveLength(1);
    expect($("[data-nova-premiacao]")).toBeNull();
    expect($$("[data-premiacao] [data-editar], [data-premiacao] [data-excluir]")).toHaveLength(0);
  });

  it("cadastrar: título obrigatório; manda o mês da tela, o perfil que disputa e a imagem já reduzida", async () => {
    await abrir(TUDO, []);
    expect(texto($("[data-sem-premiacao]"))).toBe("Nenhuma premiação cadastrada para novembro de 2026.");
    await clicar("[data-nova-premiacao]");
    expect(texto($("[data-premiacao-mes]"))).toBe("Premiação de novembro de 2026.");
    await clicar("[data-salvar-premiacao]");
    expect(texto($("[data-erro-premiacao]"))).toBe("Dê um título à premiação.");
    expect(enviados("POST")).toHaveLength(0);
    await digitar("[data-campo-titulo]", "Kit de ferramentas");
    await escolher("[data-campo-perfil]", "p2");
    const entrada = $("[data-arquivo-imagem]") as HTMLInputElement;
    Object.defineProperty(entrada, "files", { value: [new File(["x"], "brinde.png", { type: "image/png" })], configurable: true });
    await act(async () => { entrada.dispatchEvent(new Event("change", { bubbles: true })); }); await esperar();
    expect($("[data-previa-imagem] img")?.getAttribute("src")).toBe(reducao.dataUrl);
    await clicar("[data-salvar-premiacao]");
    expect(enviados("POST")).toEqual([{ url: "/api/desempenho/premiacoes", metodo: "POST", corpo: { competencia: MES, titulo: "Kit de ferramentas", descricao: null, perfilId: "p2", imagem: reducao.dataUrl } }]);
  });

  it("arquivo que não é imagem é recusado na tela; editar sem trocar a imagem NÃO manda o campo (a imagem fica); 'Excluir imagem' manda vazio", async () => {
    await abrir();
    await clicar('[data-premiacao="Kit de ferramentas"] [data-editar]');
    expect(($("[data-campo-titulo]") as HTMLInputElement).value).toBe("Kit de ferramentas");
    expect($("[data-previa-imagem] img")?.getAttribute("src")).toBe("/api/desempenho/premiacoes/pr1/imagem?v=0");
    const entrada = $("[data-arquivo-imagem]") as HTMLInputElement;
    Object.defineProperty(entrada, "files", { value: [new File(["x"], "contrato.pdf", { type: "application/pdf" })], configurable: true });
    await act(async () => { entrada.dispatchEvent(new Event("change", { bubbles: true })); }); await esperar();
    expect(texto($("[data-erro-premiacao]"))).toBe("A imagem do brinde precisa ser JPG, PNG ou WebP.");
    await digitar("[data-campo-titulo]", "Kit Bosch");
    await clicar("[data-salvar-premiacao]");
    expect(enviados("PUT")[0]).toEqual({ url: "/api/desempenho/premiacoes/pr1", metodo: "PUT", corpo: { competencia: MES, titulo: "Kit Bosch", descricao: "Para o 1º lugar", perfilId: "p1" } });
    await clicar('[data-premiacao="Kit de ferramentas"] [data-editar]');
    await clicar("[data-tirar-imagem]");
    expect($("[data-previa-imagem]")).toBeNull();
    await clicar("[data-salvar-premiacao]");
    expect(enviados("PUT")[1].corpo.imagem).toBeNull();
  });

  it("excluir pede confirmação; a premiação é por mês (o mês seguinte já pode ser cadastrado)", async () => {
    await abrir();
    await clicar('[data-premiacao="Vale-jantar"] [data-excluir]');
    expect(enviados("DELETE")).toHaveLength(0);
    expect(texto($("[data-modal-excluir-premiacao]"))).toContain("Vale-jantar");
    await clicar("[data-confirmar-exclusao]");
    expect(enviados("DELETE").map((p) => p.url)).toEqual(["/api/desempenho/premiacoes/pr2"]);
    responder("GET /api/desempenho/premiacoes?mes=2026-12", []);
    await clicar("[data-mes-seguinte]");
    expect(texto($("[data-sem-premiacao]"))).toContain("dezembro de 2026");
    await clicar("[data-nova-premiacao]");
    await digitar("[data-campo-titulo]", "Folga extra");
    await clicar("[data-salvar-premiacao]");
    expect(enviados("POST")[0].corpo).toMatchObject({ competencia: "2026-12", titulo: "Folga extra" });
  });
});

/* ───────── configuração ───────── */
describe("Configuração do Desempenho", () => {
  const perfil = (x: Record<string, unknown> = {}) => ({ id: "p1", nome: "Preventiva", tipo: "TECNICO", ordem: 0, vigente: null, agendada: null, participantes: [], ...x });
  const cfg = (x: Record<string, unknown> = {}) => ({
    competencia: MES, competenciaSeguinte: "2026-12", ajustes: { retornoDias: 30, tiposRetorno: ["to1"] },
    tiposOs: [{ id: "to1", nome: "Manutenção Corretiva", ativo: true }, { id: "to2", nome: "Preventiva", ativo: true }], tvToken: null,
    perfis: [perfil(), perfil({ id: "p4", nome: "Encarregado", tipo: "GESTAO", ordem: 3 })], disponiveis: [{ id: "t1", nome: "Ana Dias", cargo: "Técnica" }, { id: "t2", nome: "Bia Reis", cargo: null }], ...x,
  });
  async function abrir(dados: unknown = cfg()) {
    responder("GET /api/desempenho/configuracao", dados);
    const { ConfiguracaoDesempenho } = await import("@/components/desempenho/configuracao-client");
    await montar(createElement(ConfiguracaoDesempenho, { pode: TUDO }));
  }
  const campo = (nome: string) => `[data-modal-regra] [data-campo="${nome}"]`;

  it("perfil sem regra avisa que ninguém é medido; a PRIMEIRA regra vale já no mês e a tela diz que fica travada", async () => {
    await abrir();
    expect(texto($('[data-perfil="Preventiva"] [data-perfil-sem-regra]'))).toBe("Sem regra: ninguém é medido por este perfil ainda.");
    expect(texto($('[data-perfil="Preventiva"] [data-definir-regra]'))).toBe("Definir regra");
    await clicar('[data-perfil="Preventiva"] [data-definir-regra]');
    const aviso = $("[data-vigencia-da-regra]")!;
    expect(aviso.getAttribute("data-vigencia-da-regra")).toBe(MES);
    expect(texto(aviso)).toBe("Vale já em novembro de 2026 e fica travada até o fim do mês. Mudança depois só vale no mês seguinte.");
    expect(texto($("[data-salvar-regra]"))).toBe("Salvar regra");
    // Sugestão de pesos e faixas, com os VALORES em branco (zero): ninguém inventa o bônus
    expect(["pesoPrazo", "pesoRelatorio", "pesoAvaliacao", "metaMinima"].map((c) => ($(campo(c)) as HTMLInputElement).value)).toEqual(["40", "30", "30", "70"]);
    expect($$("[data-faixa-linha]").map((l) => [...l.querySelectorAll("input")].map((i) => i.value).join("|"))).toEqual(["Bronze|70|0", "Prata|80|0", "Ouro|90|0"]);
  });

  it("a soma dos pesos aparece ao digitar e trava o salvar enquanto não der 100; salva o que foi digitado, com centavos", async () => {
    await abrir();
    await clicar('[data-perfil="Preventiva"] [data-definir-regra]');
    await digitar(campo("pesoPrazo"), "50");
    expect($("[data-soma-pesos]")?.getAttribute("data-soma-pesos")).toBe("110");
    await clicar("[data-salvar-regra]");
    expect(texto($("[data-erro-regra]"))).toBe("Os pesos precisam somar 100.");
    expect(enviados("PUT")).toHaveLength(0);
    await digitar(campo("pesoRelatorio"), "20");
    expect($("[data-soma-pesos]")?.getAttribute("data-soma-pesos")).toBe("100");
    await digitar('[data-faixa-linha="0"] [data-faixa-valor]', "100");
    await digitar('[data-faixa-linha="1"] [data-faixa-valor]', "1.250,50");
    await digitar('[data-faixa-linha="2"] [data-faixa-valor]', "350,5");
    await digitar(campo("penalidadeRetorno"), "8x");
    await clicar("[data-salvar-regra]");
    expect(enviados("PUT")).toEqual([{ url: "/api/desempenho/perfis/p1/regra", metodo: "PUT", corpo: {
      pesoPrazo: 50, pesoRelatorio: 20, pesoAvaliacao: 30, exigirFotoAntesDepois: true, penalidadeRetorno: 8, penalidadeReclamacao: 5, metaMinima: 70,
      faixas: [{ nome: "Bronze", minimo: 70, valor: 100 }, { nome: "Prata", minimo: 80, valor: 1250.5 }, { nome: "Ouro", minimo: 90, valor: 350.5 }],
    } }]);
  });

  it("faixas: adicionar e excluir linhas; faixa abaixo da meta ou valor em branco é recusada na tela", async () => {
    await abrir();
    await clicar('[data-perfil="Preventiva"] [data-definir-regra]');
    await clicar('[data-faixa-linha="1"] [data-excluir-faixa]');
    expect($$("[data-faixa-linha] [data-faixa-nome]").map((i) => (i as HTMLInputElement).value)).toEqual(["Bronze", "Ouro"]);
    await clicar("[data-nova-faixa]");
    await digitar('[data-faixa-linha="2"] [data-faixa-nome]', "Diamante");
    await digitar('[data-faixa-linha="2"] [data-faixa-minimo]', "60");
    await clicar("[data-salvar-regra]");
    expect(texto($("[data-erro-regra]"))).toBe("Nenhuma faixa pode começar abaixo da meta mínima.");
    await digitar('[data-faixa-linha="2"] [data-faixa-minimo]', "98");
    await digitar('[data-faixa-linha="2"] [data-faixa-valor]', "");
    await clicar("[data-salvar-regra]");
    expect(texto($("[data-erro-regra]"))).toBe("Valor da faixa: informe um número.");
    await digitar('[data-faixa-linha="2"] [data-faixa-valor]', "900");
    await clicar("[data-salvar-regra]");
    expect(enviados("PUT")[0].corpo.faixas).toEqual([{ nome: "Bronze", minimo: 70, valor: 0 }, { nome: "Ouro", minimo: 90, valor: 0 }, { nome: "Diamante", minimo: 98, valor: 900 }]);
    // A última faixa não pode ser excluída (precisa de pelo menos uma)
    await clicar('[data-perfil="Preventiva"] [data-definir-regra]');
    await clicar('[data-faixa-linha="0"] [data-excluir-faixa]'); await clicar('[data-faixa-linha="0"] [data-excluir-faixa]');
    expect(($('[data-faixa-linha="0"] [data-excluir-faixa]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("perfil COM regra: mostra a regra em vigor (travada) e os valores; mudar avisa que só vale no mês seguinte", async () => {
    const vigente = regra(1);
    await abrir(cfg({ perfis: [perfil({ vigente, participantes: [{ tecnicoId: "t3", nome: "Edu Prado" }] })] }));
    const cartao = $('[data-perfil="Preventiva"]')!;
    expect(texto(cartao.querySelector("[data-regra-vigente]"))).toBe("Regra em vigor desde 11/2026 (travada neste mês)");
    expect(texto(cartao.querySelector("[data-regra-pesos]"))).toBe("Concluídas no prazo 40% · Relatórios completos 30% · Avaliação do cliente 30%");
    expect(texto(cartao.querySelector("[data-regra-faixas]"))).toMatch(/Bronze a partir de 70% \(R\$\s100,00\) · Prata a partir de 80% \(R\$\s200,00\) · Ouro a partir de 90% \(R\$\s350,00\)/);
    expect(texto(cartao.querySelector("[data-regra-penalidades]"))).toBe("5 pontos por retorno · 5 por reclamação");
    expect(texto(cartao.querySelector("[data-definir-regra]"))).toBe("Editar regra");
    await clicar(cartao.querySelector("[data-definir-regra]"));
    expect($("[data-vigencia-da-regra]")?.getAttribute("data-vigencia-da-regra")).toBe("2026-12");
    expect(texto($("[data-vigencia-da-regra]"))).toBe("A regra em vigor não muda. Esta mudança vale a partir de dezembro de 2026.");
    expect(texto($("[data-salvar-regra]"))).toBe("Agendar mudança");
    expect(($('[data-faixa-linha="2"] [data-faixa-valor]') as HTMLInputElement).value).toBe("350"); // parte da regra atual
  });

  it("mudança agendada aparece à parte, com a data, e pode ser descartada; o formulário parte dela", async () => {
    const agendada = { ...regra(1), vigenteDesde: "2026-12", metaMinima: 60 };
    await abrir(cfg({ perfis: [perfil({ vigente: regra(1), agendada })] }));
    const bloco = $("[data-regra-agendada]")!;
    expect(bloco.getAttribute("data-regra-agendada")).toBe("2026-12");
    expect(texto(bloco)).toContain("Mudança que vale a partir de 12/2026");
    expect(texto(bloco.querySelector("[data-regra-meta]"))).toBe("60%");
    expect(texto($("[data-regra-vigente] ~ [data-resumo-regra] [data-regra-meta]"))).toBe("70%"); // a do mês continua 70
    await clicar("[data-definir-regra]");
    expect(($(campo("metaMinima")) as HTMLInputElement).value).toBe("60");
    await clicar("[data-modal-regra] button"); // Cancelar não manda nada
    await clicar("[data-descartar-agendada]");
    expect(enviados("DELETE").map((p) => p.url)).toEqual(["/api/desempenho/perfis/p1/regra"]);
  });

  it("perfil de gestão usa os rótulos da equipe; criar, editar (tipo travado com regra) e excluir perfil", async () => {
    await abrir(cfg({ perfis: [perfil({ vigente: regra(1) }), perfil({ id: "p4", nome: "Encarregado", tipo: "GESTAO", vigente: regra(1) })] }));
    expect(texto($('[data-perfil="Encarregado"] [data-regra-pesos]'))).toBe("Equipe no prazo 40% · Relatórios completos da equipe 30% · Satisfação da equipe 30%");
    await clicar("[data-novo-perfil]");
    await clicar("[data-salvar-perfil]");
    expect(texto($("[data-erro-modal-perfil]"))).toBe("Dê um nome ao perfil (mínimo 2 caracteres).");
    await digitar("[data-campo-nome]", "Instalação");
    await clicar('[data-tipo-opcao="GESTAO"]');
    await clicar("[data-salvar-perfil]");
    expect(enviados("POST")).toEqual([{ url: "/api/desempenho/perfis", metodo: "POST", corpo: { nome: "Instalação", tipo: "GESTAO" } }]);
    await clicar('[data-perfil="Preventiva"] [data-editar-perfil]');
    expect(($("[data-campo-nome]") as HTMLInputElement).value).toBe("Preventiva");
    expect($$("[data-tipo-opcao]").map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, true]); // tem regra: o tipo não muda
    await digitar("[data-campo-nome]", "Preventiva A");
    await clicar("[data-salvar-perfil]");
    expect(enviados("PUT").at(-1)).toEqual({ url: "/api/desempenho/perfis/p1", metodo: "PUT", corpo: { nome: "Preventiva A", tipo: "TECNICO" } });
    responder("DELETE /api/desempenho/perfis/p1", { erro: "Este perfil tem colaboradores. Mude-os de perfil ou tire-os do Desempenho antes de excluir." }, 409);
    await clicar('[data-perfil="Preventiva"] [data-excluir-perfil]');
    await clicar("[data-confirmar-exclusao]");
    expect(texto($("[data-erro-excluir-perfil]"))).toContain("Este perfil tem colaboradores");
  });

  it("participantes: adicionar (com o cargo ao lado do nome), mudar de perfil e tirar do Desempenho", async () => {
    await abrir(cfg({ perfis: [perfil({ participantes: [{ tecnicoId: "t3", nome: "Edu Prado" }] }), perfil({ id: "p4", nome: "Encarregado", tipo: "GESTAO" })] }));
    const prev = '[data-perfil="Preventiva"]';
    expect($$(`${prev} [data-novo-participante] option`).map((o) => texto(o))).toEqual(["Adicionar colaborador…", "Ana Dias (Técnica)", "Bia Reis"]);
    expect(($(`${prev} [data-adicionar-participante]`) as HTMLButtonElement).disabled).toBe(true);
    await escolher(`${prev} [data-novo-participante]`, "t1");
    await clicar(`${prev} [data-adicionar-participante]`);
    expect(enviados("POST")[0]).toEqual({ url: "/api/desempenho/participantes", metodo: "POST", corpo: { tecnicoId: "t1", perfilId: "p1" } });
    await escolher(`${prev} [data-participante="Edu Prado"] [data-mudar-perfil]`, "p4");
    expect(enviados("POST")[1].corpo).toEqual({ tecnicoId: "t3", perfilId: "p4" });
    responder("DELETE /api/desempenho/participantes/t3", { erro: "Este colaborador não está no Desempenho." }, 404);
    await clicar(`${prev} [data-participante="Edu Prado"] [data-tirar-participante]`);
    expect(enviados("DELETE").map((p) => p.url)).toEqual(["/api/desempenho/participantes/t3"]);
    expect(texto($(`${prev} [data-erro-perfil]`))).toBe("Este colaborador não está no Desempenho.");
    expect(texto($('[data-perfil="Encarregado"] [data-sem-participantes]'))).toBe("Ninguém neste perfil.");
  });

  it("ajustes: prazo do retorno e os tipos que contam como corretiva; nota baixa NÃO é ajuste (a tela explica); prazo fora de 1 a 365 é recusado", async () => {
    await abrir();
    expect($("[data-campo-nota-baixa]")).toBeNull();
    expect(texto($("[data-aviso-nota-baixa]"))).toBe("Nota baixa do cliente não entra aqui: ela já pesa na média da avaliação.");
    act(() => root.unmount()); caixa.remove();
    await abrir();
    expect(($('[data-tipo-corretiva="Manutenção Corretiva"]') as HTMLInputElement).checked).toBe(true);
    expect(($('[data-tipo-corretiva="Preventiva"]') as HTMLInputElement).checked).toBe(false);
    await digitar("[data-campo-retorno-dias]", "0");
    await clicar("[data-salvar-ajustes]");
    expect(texto($("[data-erro-ajustes]"))).toBe("Prazo do retorno: de 1 a 365 dias.");
    expect(enviados("PUT")).toHaveLength(0);
    await digitar("[data-campo-retorno-dias]", "45");
    await clicar('[data-tipo-corretiva="Preventiva"]');
    await clicar('[data-tipo-corretiva="Manutenção Corretiva"]');
    await clicar("[data-salvar-ajustes]");
    expect(enviados("PUT")).toEqual([{ url: "/api/desempenho/configuracao", metodo: "PUT", corpo: { retornoDias: 45, tiposRetorno: ["to2"] } }]);
    expect(texto($("[data-ajustes-salvos]"))).toBe("Ajustes salvos.");
  });

  it("modo TV: desligado oferece gerar o link; ligado mostra o link público, trocar e desligar", async () => {
    await abrir();
    expect($("[data-secao-tv]")?.getAttribute("data-tv")).toBe("desligado");
    expect(texto($("[data-secao-tv]"))).toContain("Nunca mostra valor em reais");
    await clicar("[data-gerar-link]");
    expect(enviados("POST", "/api/desempenho/tv")).toHaveLength(1);
    act(() => root.unmount()); caixa.remove();
    await abrir(cfg({ tvToken: "tok-abc" }));
    expect(($("[data-link-tv]") as HTMLInputElement).value).toBe(`${window.location.origin}/relatorio/desempenho/tok-abc`);
    expect($("[data-abrir-tv]")?.getAttribute("href")).toBe(`${window.location.origin}/relatorio/desempenho/tok-abc`);
    await clicar("[data-trocar-link]");
    await clicar("[data-desligar-tv]");
    expect(pedidos.filter((p) => p.url === "/api/desempenho/tv").map((p) => p.metodo)).toEqual(["POST", "POST", "DELETE"]);
  });
});

/* ───────── modo TV ───────── */
describe("Modo TV", () => {
  const tv = (x: Record<string, unknown> = {}) => ({
    empresa: "Clima Total", competencia: MES, atualizadoEm: "2026-11-13T15:00:00Z",
    grupos: [{ perfil: "Preventiva", linhas: [{ posicao: 1, nome: "Ana Dias", escore: 88, faixa: "Prata" }, { posicao: 2, nome: "Bia Reis", escore: 66, faixa: null }] }],
    premiacoes: [{ id: "pr1", titulo: "Kit de ferramentas", descricao: null, perfil: null, temImagem: true }], ...x,
  });
  async function abrir(inicial: unknown = tv()) {
    const { PainelDaTv } = await import("@/components/desempenho/tv-client");
    await montar(createElement(PainelDaTv, { token: "tok-abc", inicial: inicial as never }));
  }

  it("ranking e prêmio em disputa — sem valor em reais; a imagem do brinde vem pela rota pública do token", async () => {
    await abrir();
    expect(texto($("[data-tv-empresa]"))).toBe("Clima Total");
    expect(texto($("[data-tv-mes]"))).toBe("novembro de 2026");
    expect($$("[data-tv-linha]").map((l) => `${texto(l.querySelector("[data-tv-posicao]"))}|${l.getAttribute("data-tv-linha")}|${texto(l.querySelector("[data-tv-faixa]")) || "-"}|${texto(l.querySelector("[data-tv-escore]"))}`))
      .toEqual(["1º|Ana Dias|Prata|88,0%", "2º|Bia Reis|-|66,0%"]);
    expect($("[data-premio-imagem]")?.getAttribute("src")).toBe("/api/publico/desempenho/tok-abc/premiacoes/pr1/imagem");
    expect(texto()).not.toContain("R$");
    expect(texto($("[data-tv-atualizado]"))).toBe("Atualizado às 12:00");
    expect(pedidos).toHaveLength(0); // abre com o que o servidor já mandou
  });

  it("ATUALIZA SOZINHO: a cada minuto busca de novo na rota pública e troca o ranking, sem recarregar; sem conexão avisa e mantém a tela", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { INTERVALO_TV_MS } = await import("@/components/desempenho/tv-client");
    expect(INTERVALO_TV_MS).toBe(60_000);
    await abrir();
    responder("GET /api/publico/desempenho/tok-abc", tv({ atualizadoEm: "2026-11-13T15:01:00Z", grupos: [{ perfil: "Preventiva", linhas: [{ posicao: 1, nome: "Bia Reis", escore: 91, faixa: "Ouro" }] }] }));
    await act(async () => { vi.advanceTimersByTime(59_000); }); await esperar();
    expect(pedidos).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1_000); }); await esperar();
    expect(pedidos.map((p) => p.url)).toEqual(["/api/publico/desempenho/tok-abc"]);
    expect($$("[data-tv-linha]").map((l) => l.getAttribute("data-tv-linha"))).toEqual(["Bia Reis"]);
    expect(texto($("[data-tv-atualizado]"))).toBe("Atualizado às 12:01");
    responder("GET /api/publico/desempenho/tok-abc", { erro: "Painel não encontrado" }, 404);
    await act(async () => { vi.advanceTimersByTime(60_000); }); await esperar();
    expect(texto($("[data-tv-atualizado]"))).toBe("Sem conexão · Atualizado às 12:01");
    expect($$("[data-tv-linha]")).toHaveLength(1); // a última tela boa continua no ar
  });

  it("ninguém no ranking ainda: mensagem no lugar das colunas", async () => {
    await abrir(tv({ grupos: [], premiacoes: [] }));
    expect(texto($("[data-tv-vazio]"))).toBe("Nenhum colaborador no ranking ainda.");
    expect($("[data-premio-em-disputa]")).toBeNull();
  });
});
