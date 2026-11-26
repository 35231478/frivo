// @vitest-environment happy-dom
/**
 * AS TELAS DA DOCUMENTAÇÃO DA EQUIPE num DOM de verdade.
 *
 * O que se prova:
 *  - HISTÓRICO: cada ação da linha só aparece quando a rota aceitaria (copiar e revogar pedem link
 *    ativo; gerar link pede que não haja um); revogar pede confirmação; reenviar leva os contatos
 *    do cadastro do cliente; e quando o SERVIDOR recusa, a razão dele aparece e a tela não finge
 *    que deu certo;
 *  - a LINHA DO TEMPO separa o que a empresa fez do que o cliente fez — e a prova de recebimento
 *    traz o IP e o navegador;
 *  - NOVO ENVIO: o cliente traz quem atende já marcado; segurança do trabalho vem marcada, contrato
 *    e documento pessoal não, e advertência/dado bancário nem aparecem; a prévia com VENCIDO segura
 *    (não existe "enviar assim mesmo") e dá as duas saídas; falta pede a confirmação; as três
 *    saídas mandam o que a rota espera; a recusa do servidor não leva ao resultado;
 *  - LOTE: zip sai das opções, cada cliente vai com os SEUS colaboradores e os SEUS e-mails, e o
 *    cliente segurado fica de fora sem segurar os outros;
 *  - a PÁGINA DO CLIENTE: baixar tudo e item a item, na organização que a empresa escolheu;
 *  - o ATALHO das fichas do cliente e do contrato só aparece com a permissão, e o novo envio abre
 *    com aquele cliente (e contrato) já escolhido;
 *  - quem entra: o menu, o middleware e a matriz de permissões.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AcoesEnvio } from "@/components/documentacao/acoes-envio";
import { DetalheEnvio } from "@/components/documentacao/detalhe-envio";
import { NovoEnvio } from "@/components/documentacao/novo-envio";
import { DocumentacaoPublicaLista } from "@/components/documentacao/documentacao-publica";
import { SeloLink } from "@/components/documentacao/selo-link";
import { Avisos } from "@/components/ui/avisos";
import { CATEGORIAS_PROIBIDAS, fraseEmailNaoSaiu } from "@/lib/documentacao/pacote";
import { PRESETS, moduloDaRota, montarPermissoes, pode, portaoBarra, type Permissoes } from "@/lib/permissoes";
import { AtalhoDocumentacao, hrefNovoEnvio } from "@/components/documentacao/atalho-documentacao";
import { PermissoesProvider } from "@/components/providers/permissoes-provider";
import type { DocumentacaoPublica, EnvioDaLista, EnvioDetalhe, Previa } from "@/lib/documentacao/pacote-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const rota = vi.hoisted(() => ({ refresh: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => { rota.refresh++; }, push: () => {} }) }));

let caixa: HTMLDivElement; let root: Root;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
type Resposta = { status: number; dados: any; blob?: boolean };
let resposta: (url: string, corpo: any, metodo: string) => Resposta = () => ({ status: 200, dados: {} });

/**
 * Os toasts da casa somem sozinhos depois de alguns segundos — tempo demais para um teste e de
 * menos para a suíte (um toast de um teste apareceria no seguinte). Os temporizadores longos ficam
 * guardados e são disparados no fim de cada teste: cada um começa sem aviso na tela.
 */
const relogio = globalThis.setTimeout;
const adiados: (() => void)[] = [];

beforeEach(() => {
  (globalThis as any).setTimeout = (f: () => void, ms?: number, ...resto: unknown[]) =>
    (ms ?? 0) >= 2000 ? (adiados.push(f), 0) : (relogio as any)(f, ms, ...resto);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  chamadas.length = 0; rota.refresh = 0;
  resposta = () => ({ status: 200, dados: {} });
  (globalThis as any).fetch = vi.fn(async (url: string, op: any = {}) => {
    const corpo = op.body ? JSON.parse(op.body) : undefined;
    const metodo = op.method ?? "GET";
    chamadas.push({ url: String(url), metodo, corpo });
    const r = resposta(String(url), corpo, metodo);
    return {
      ok: r.status < 400, status: r.status, json: async () => r.dados,
      blob: async () => new Blob(["zip"]), headers: { get: () => 'attachment; filename="documentacao.zip"' },
    } as never;
  });
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
  (URL as any).createObjectURL = () => "blob:x"; (URL as any).revokeObjectURL = () => {};
});
afterEach(() => {
  act(() => { adiados.splice(0).forEach((f) => f()); });
  (globalThis as any).setTimeout = relogio;
  act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
});

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el, "o elemento existe").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const montar = async (el: any) => { await act(async () => { root.render(createElement("div", null, el, createElement(Avisos))); }); await esperar(); };
const escolher = async (sel: string, valor: string) => {
  const campo = $<HTMLSelectElement>(sel);
  expect(campo, `o seletor ${sel} existe`).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(campo, valor);
    campo!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
};
const toasts = (tipo: string) => $$(`[data-toast='${tipo}']`).map(txt);
const feitas = (trecho: string, metodo = "POST") => chamadas.filter((c) => c.url.includes(trecho) && c.metodo === metodo);

/* ───────── fixtures ───────── */

const ENVIO = (extra: Partial<EnvioDaLista> = {}): EnvioDaLista => ({
  id: "env1", clienteId: "c1", clienteNome: "Shopping Ibirapuera", contratoId: null, categorias: ["aso", "nr_10"],
  organizacao: "POR_COLABORADOR", colaboradores: 2, arquivos: 4, link: "ATIVO", caminho: "/documentacao/tok-1",
  expiraEm: "2026-11-23T12:00:00.000Z", revogadoEm: null, loteId: null, criadoEm: "2026-11-16T12:00:00.000Z", criadoPor: "Ana Souza",
  vias: ["LINK"], clienteAbriuEm: null, clienteBaixouEm: null,
  ...extra,
});

const ITEM = (colaboradorId: string, colaboradorNome: string, categoria: string, rotulo: string, extra: object = {}) => ({
  documentoId: `d-${colaboradorId}-${categoria}`, colaboradorId, colaboradorNome, categoria, categoriaRotulo: rotulo,
  nome: `${rotulo} de ${colaboradorNome}`, dataVencimento: "2027-06-01T00:00:00.000Z", tamanho: 2048, venceEmBreve: false, ...extra,
});

const PREVIA = (extra: Partial<Previa> = {}): Previa => ({
  itens: [ITEM("t1", "Marina Alves", "aso", "ASO"), ITEM("t2", "João Lima", "aso", "ASO")],
  vencidos: [], faltando: [], liberado: true,
  cliente: { id: "c1", nome: "Shopping Ibirapuera" }, organizacao: "POR_COLABORADOR",
  email: { para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"] }, mensagemVencidos: "",
  ...extra,
});

const VENCIDO = { colaboradorId: "t2", colaboradorNome: "João Lima", categoria: "aso", categoriaRotulo: "ASO", documentoId: "d-t2-aso", nome: "ASO periódico", dataVencimento: "2026-10-01T00:00:00.000Z" };
const PREVIA_COM_VENCIDO = () => PREVIA({
  itens: [ITEM("t1", "Marina Alves", "aso", "ASO")], vencidos: [VENCIDO], liberado: false,
  mensagemVencidos: "Há documento vencido no pacote: ASO de João Lima. Renove o documento ou tire o colaborador do pacote.",
});

const CLIENTES = [
  { id: "c1", nome: "Shopping Ibirapuera S.A.", nomeFantasia: "Shopping Ibirapuera", cpfCnpj: "11111111000111" },
  { id: "c2", nome: "Hospital Santa Clara", nomeFantasia: null, cpfCnpj: "22222222000122" },
];
const SUGESTAO: Record<string, any> = {
  c1: { colaboradores: [{ id: "t1", nome: "Marina Alves", ativo: true, motivo: "CONTRATO" }, { id: "t2", nome: "João Lima", ativo: true, motivo: "ATENDEU" }], email: { para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"] }, contratos: [{ id: "k1", numero: "CT-1" }, { id: "k2", numero: "CT-2" }] },
  c2: { colaboradores: [{ id: "t3", nome: "Carla Reis", ativo: true, motivo: "ATENDEU" }], email: { para: ["compras@hospital.com"], cc: [] }, contratos: [] },
};
const EQUIPES = [{ id: "eq1", nome: "Equipe A" }];
const TODOS = [{ id: "t1", nome: "Marina Alves" }, { id: "t2", nome: "João Lima" }, { id: "t3", nome: "Carla Reis" }, { id: "t5", nome: "Davi Prado" }];

const CRIADO = (via: string, extra: object = {}) => ({
  envio: { ...ENVIO({ id: "novo1", link: via === "ZIP" ? "SEM_LINK" : "ATIVO", caminho: via === "ZIP" ? null : "/documentacao/tok-novo" }) },
  ...extra,
});

/** O servidor de mentira do Novo envio: cada teste troca só o que interessa. */
function servidor(over: { previa?: (corpo: any) => Resposta; envio?: (corpo: any) => Resposta; lote?: (corpo: any) => Resposta; zip?: () => Resposta } = {}) {
  resposta = (url, corpo, metodo) => {
    if (url === "/api/clientes") return { status: 200, dados: CLIENTES };
    if (url.includes("/api/documentacao/sugestoes")) {
      const q = new URLSearchParams(url.split("?")[1]);
      if (q.get("equipeId")) return { status: 200, dados: { colaboradores: [{ id: "t3", nome: "Carla Reis", ativo: true, motivo: "EQUIPE" }], email: { para: [], cc: [] }, contratos: [] } };
      const s = SUGESTAO[q.get("clienteId") ?? ""];
      if (q.get("contratoId") === "k2") return { status: 200, dados: { ...s, colaboradores: [s.colaboradores[0]] } };
      return { status: 200, dados: s };
    }
    if (url.includes("/api/documentacao/previa")) return over.previa ? over.previa(corpo) : { status: 200, dados: PREVIA({ cliente: { id: corpo.clienteId, nome: "x" } }) };
    if (url.includes("/envios/lote")) return over.lote ? over.lote(corpo) : { status: 201, dados: { loteId: "L1", resultados: [] } };
    if (url.endsWith("/zip")) return over.zip ? over.zip() : { status: 200, dados: {} };
    if (url.endsWith("/api/documentacao/envios") && metodo === "POST") return over.envio ? over.envio(corpo) : { status: 201, dados: CRIADO(corpo.via) };
    return { status: 200, dados: {} };
  };
}

/** Abre o seletor de cliente e escolhe pelo nome. */
async function escolherCliente(nome: string, caixaSel = "[data-cliente]") {
  const campo = $<HTMLInputElement>(`${caixaSel} input`);
  expect(campo, "o campo de cliente existe").toBeTruthy();
  await act(async () => { campo!.focus(); campo!.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
  await esperar();
  const opcao = $$(`${caixaSel} button`).find((b) => txt(b).includes(nome));
  await clicar(opcao ?? null);
}

const novo = () => montar(createElement(NovoEnvio, { equipes: EQUIPES, colaboradores: TODOS }));
const marcados = () => $$("[data-colaborador]").filter((c) => (c as HTMLInputElement).checked).map((c) => c.getAttribute("data-colaborador"));
const tiposMarcados = () => $$("[data-tipo]").filter((c) => (c as HTMLInputElement).checked).map((c) => c.getAttribute("data-tipo"));

/** Do começo até a prévia de um cliente só. */
async function ateAPrevia(cliente = "Shopping Ibirapuera") {
  await novo();
  await escolherCliente(cliente);
  await clicar($("[data-avancar]"));
  await clicar($("[data-ver-previa]"));
}

/* ───────── o histórico ───────── */

describe("as ações do envio no histórico", () => {
  const abrirMenu = async (envio: EnvioDaLista) => { await montar(createElement(AcoesEnvio, { envio })); await clicar($("[data-acao='menu']")); };
  const itens = () => $$("[data-menu-acoes] [data-item]").map((i) => i.getAttribute("data-item"));

  it("link ativo: copiar, baixar, enviar por e-mail e revogar — sem \"gerar link novo\"", async () => {
    await abrirMenu(ENVIO());
    expect(itens()).toEqual(["ver", "copiar-link", "baixar-zip", "enviar-email", "revogar"]);
    expect(txt($("[data-item='enviar-email']"))).toBe("Enviar por e-mail");
  });

  it("sem link, expirado ou revogado: aparece gerar link novo, e somem copiar e revogar", async () => {
    for (const link of ["SEM_LINK", "EXPIRADO", "REVOGADO"] as const) {
      await act(async () => { root.render(null); });
      await abrirMenu(ENVIO({ link, caminho: null }));
      expect(itens(), link).toEqual(["ver", "baixar-zip", "enviar-email", "gerar-link"]);
    }
  });

  it("quem já recebeu por e-mail vê \"enviar de novo\" (reenviar)", async () => {
    await abrirMenu(ENVIO({ vias: ["LINK", "EMAIL"] }));
    expect(txt($("[data-item='enviar-email']"))).toBe("Enviar o e-mail de novo");
  });

  it("revogar pede confirmação: sem confirmar nada sai; confirmando, chama a rota e atualiza a lista", async () => {
    await abrirMenu(ENVIO());
    await clicar($("[data-item='revogar']"));
    expect(txt($("[data-confirmacao]"))).toContain("Shopping Ibirapuera");
    await clicar($("[data-confirmar-nao]"));
    expect(feitas("/revogar")).toHaveLength(0);

    await clicar($("[data-acao='menu']"));
    await clicar($("[data-item='revogar']"));
    await clicar($("[data-confirmar-sim]"));
    expect(feitas("/revogar").map((c) => c.url)).toEqual(["/api/documentacao/envios/env1/revogar"]);
    expect(toasts("sucesso")).toEqual(["Link revogado."]);
    expect(rota.refresh).toBe(1);
  });

  it("o servidor recusa (sem permissão): a razão dele aparece e a tela não finge que revogou", async () => {
    resposta = () => ({ status: 403, dados: { erro: "Sem permissão para enviar documentos ao cliente." } });
    await abrirMenu(ENVIO());
    await clicar($("[data-item='revogar']"));
    await clicar($("[data-confirmar-sim]"));
    expect(toasts("erro")).toEqual(["Sem permissão para enviar documentos ao cliente."]);
    expect(toasts("sucesso")).toEqual([]);
    expect(rota.refresh, "a lista não é recarregada como se tivesse mudado").toBe(0);
  });

  it("reenviar: o diálogo já traz os contatos do cadastro do cliente, e manda Para e Cópia à rota", async () => {
    resposta = (url) => url.includes("sugestoes")
      ? { status: 200, dados: SUGESTAO.c1 }
      : { status: 200, dados: { envio: ENVIO(), email: { ok: true, para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"] } } };
    await abrirMenu(ENVIO({ vias: ["EMAIL"] }));
    await clicar($("[data-item='enviar-email']"));
    expect(feitas("sugestoes", "GET").map((c) => c.url)).toEqual(["/api/documentacao/sugestoes?clienteId=c1"]);
    expect($$("[data-email-para] [data-chip]").map((c) => c.getAttribute("data-chip"))).toEqual(["seguranca@shopping.com"]);
    expect($$("[data-email-cc] [data-chip]").map((c) => c.getAttribute("data-chip"))).toEqual(["manutencao@shopping.com"]);
    expect($("[data-dialogo-email] [data-validade-link]"), "link ativo: não se escolhe prazo de novo").toBeNull();

    await clicar($("[data-confirmar-email]"));
    const [c] = feitas("/email");
    expect(c.url).toBe("/api/documentacao/envios/env1/email");
    expect(c.corpo).toMatchObject({ para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"], copiaParaMim: false });
    expect(toasts("sucesso")).toEqual(["E-mail enviado para seguranca@shopping.com."]);
    expect($("[data-dialogo-email]"), "o diálogo fecha quando o e-mail saiu").toBeNull();
  });

  it("e-mail que não saiu: o motivo fica à vista e o diálogo continua aberto para tentar de novo", async () => {
    resposta = (url) => url.includes("sugestoes")
      ? { status: 200, dados: SUGESTAO.c1 }
      : { status: 200, dados: { envio: ENVIO(), email: { ok: false, erro: "Resend fora do ar", para: ["seguranca@shopping.com"], cc: [] } } };
    await abrirMenu(ENVIO());
    await clicar($("[data-item='enviar-email']"));
    await clicar($("[data-confirmar-email]"));
    expect(txt($("[data-erro-acao]"))).toBe("O e-mail não saiu: Resend fora do ar.");
    expect($("[data-dialogo-email]")).toBeTruthy();
    expect(toasts("sucesso")).toEqual([]);
  });

  it("sem destinatário o botão de enviar não libera; link expirado pede o prazo do link novo", async () => {
    resposta = () => ({ status: 200, dados: { colaboradores: [], email: { para: [], cc: [] }, contratos: [] } });
    await abrirMenu(ENVIO({ link: "EXPIRADO", caminho: null }));
    await clicar($("[data-item='enviar-email']"));
    expect($<HTMLButtonElement>("[data-confirmar-email]")!.disabled).toBe(true);
    expect($("[data-dialogo-email] [data-validade-link]"), "o e-mail gera um link novo junto").toBeTruthy();
    expect(txt($("[data-dialogo-email]"))).toContain("um link novo é gerado junto");
  });

  it("gerar link novo manda o prazo escolhido", async () => {
    resposta = () => ({ status: 200, dados: ENVIO({ caminho: "/documentacao/tok-2" }) });
    await abrirMenu(ENVIO({ link: "REVOGADO", caminho: null }));
    await clicar($("[data-item='gerar-link']"));
    await escolher("[data-dialogo-link] [data-validade-link]", "15");
    await clicar($("[data-confirmar-link]"));
    expect(feitas("/link").map((c) => [c.url, c.corpo])).toEqual([["/api/documentacao/envios/env1/link", { validadeDias: 15 }]]);
    expect(toasts("sucesso")).toEqual(["Link gerado e copiado."]);
    expect($("[data-dialogo-link]")).toBeNull();
  });

  it("gerar link recusado (documento venceu depois do envio): a razão aparece no diálogo, que não fecha", async () => {
    resposta = () => ({ status: 409, dados: { erro: "Há documento vencido no pacote: ASO de João Lima. Renove o documento ou tire o colaborador do pacote." } });
    await abrirMenu(ENVIO({ link: "EXPIRADO", caminho: null }));
    await clicar($("[data-item='gerar-link']"));
    await clicar($("[data-confirmar-link]"));
    expect(txt($("[data-erro-acao]"))).toContain("ASO de João Lima");
    expect($("[data-dialogo-link]")).toBeTruthy();
    expect(toasts("sucesso")).toEqual([]);
  });

  it("baixar o zip recusado mostra a razão em vez de levar a uma página de erro", async () => {
    resposta = () => ({ status: 409, dados: { erro: "Há documento vencido no pacote: ASO de João Lima." } });
    await abrirMenu(ENVIO());
    await clicar($("[data-item='baixar-zip']"));
    expect(feitas("/zip", "GET").map((c) => c.url)).toEqual(["/api/documentacao/envios/env1/zip"]);
    expect(toasts("erro")).toEqual(["Há documento vencido no pacote: ASO de João Lima."]);
  });

  it("o selo do link fala a situação com as palavras da casa", async () => {
    for (const [situacao, rotulo] of [["ATIVO", "Link ativo"], ["EXPIRADO", "Link expirado"], ["REVOGADO", "Link revogado"], ["SEM_LINK", "Sem link"]]) {
      await act(async () => { root.render(null); });
      await montar(createElement(SeloLink, { situacao }));
      expect(txt($(`[data-selo-link='${situacao}']`))).toBe(rotulo);
    }
  });
});

describe("a linha do tempo do envio", () => {
  const DETALHE: EnvioDetalhe = {
    ...ENVIO(),
    itens: [
      { id: "i1", colaboradorNome: "Marina Alves", categoria: "aso", categoriaRotulo: "ASO", nome: "ASO periódico", caminho: "Marina Alves/ASO.pdf", dataVencimento: "2027-06-01T00:00:00.000Z", tamanho: 2048, vencido: false, disponivel: true },
      { id: "i2", colaboradorNome: "João Lima", categoria: "aso", categoriaRotulo: "ASO", nome: "ASO periódico", caminho: "João Lima/ASO.pdf", dataVencimento: "2026-10-01T00:00:00.000Z", tamanho: 2048, vencido: true, disponivel: false },
    ],
    eventos: [
      { id: "e1", tipo: "CRIADO", em: "2026-11-16T12:00:00.000Z", por: "Ana Souza", ip: "10.0.0.1", navegador: "Chrome", detalhe: {} },
      { id: "e2", tipo: "EMAIL_ENVIADO", em: "2026-11-16T12:00:00.000Z", por: "Ana Souza", ip: null, navegador: null, detalhe: { para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"] } },
      { id: "e3", tipo: "ACESSO", em: "2026-11-17T13:00:00.000Z", por: null, ip: "200.1.2.3", navegador: "Mozilla/5.0 (iPhone)", detalhe: {} },
      { id: "e4", tipo: "DOWNLOAD", em: "2026-11-17T13:01:00.000Z", por: null, ip: "200.1.2.3", navegador: "Mozilla/5.0 (iPhone)", detalhe: { caminho: "Marina Alves/ASO.pdf" } },
    ],
  };

  it("separa o que a empresa fez do que o cliente fez, e a prova de recebimento traz IP e navegador", async () => {
    resposta = () => ({ status: 200, dados: DETALHE });
    await montar(createElement(DetalheEnvio, { envioId: "env1", aberto: true, onFechar: () => {} }));
    expect(feitas("/api/documentacao/envios/env1", "GET")).toHaveLength(1);
    expect($$("[data-evento]").map((e) => [e.getAttribute("data-evento"), e.getAttribute("data-do-cliente")])).toEqual([
      ["CRIADO", "nao"], ["EMAIL_ENVIADO", "nao"], ["ACESSO", "sim"], ["DOWNLOAD", "sim"],
    ]);
    const acesso = txt($("[data-evento='ACESSO']"));
    expect(acesso).toContain("IP 200.1.2.3");
    expect(acesso).toContain("Mozilla/5.0 (iPhone)");
    expect(txt($("[data-evento='CRIADO']")), "o IP de quem enviou não é a prova de ninguém").not.toContain("IP ");
    expect(txt($("[data-evento='EMAIL_ENVIADO']"))).toContain("seguranca@shopping.com · cópia: manutencao@shopping.com");
    expect(txt($("[data-evento='DOWNLOAD']"))).toContain("Marina Alves/ASO.pdf");
  });

  it("mostra o que foi no pacote e avisa o que venceu ou saiu da ficha depois", async () => {
    resposta = () => ({ status: 200, dados: DETALHE });
    await montar(createElement(DetalheEnvio, { envioId: "env1", aberto: true, onFechar: () => {} }));
    expect($$("[data-item-do-envio]")).toHaveLength(2);
    expect(txt($("[data-item-do-envio='i2']"))).toContain("Venceu em 01/10/2026");
    expect(txt($("[data-item-do-envio='i2']"))).toContain("Excluído da ficha");
    expect(txt($("[data-item-do-envio='i1']"))).not.toContain("Venceu");
  });

  it("recusa do servidor vira a razão dele, não uma tela vazia", async () => {
    resposta = () => ({ status: 403, dados: { erro: "Sem permissão para enviar documentos ao cliente." } });
    await montar(createElement(DetalheEnvio, { envioId: "env1", aberto: true, onFechar: () => {} }));
    expect(txt($("[data-erro-detalhe]"))).toBe("Sem permissão para enviar documentos ao cliente.");
    expect($("[data-linha-do-tempo]")).toBeNull();
  });
});

/* ───────── novo envio ───────── */

describe("novo envio: cliente e colaboradores", () => {
  it("escolher o cliente traz quem atende, já marcado e dizendo por quê", async () => {
    servidor();
    await novo();
    expect($<HTMLButtonElement>("[data-avancar]")!.disabled, "sem cliente não anda").toBe(true);
    await escolherCliente("Shopping Ibirapuera");
    expect(feitas("sugestoes", "GET").map((c) => c.url)).toEqual(["/api/documentacao/sugestoes?clienteId=c1"]);
    expect(marcados()).toEqual(["t1", "t2"]);
    expect($$("[data-colaborador]").map((c) => txt(c.closest("label")))).toEqual([
      "Marina AlvesTécnico do contrato", "João LimaAtendeu nos últimos 12 meses",
    ]);
    expect(txt($("[data-colaboradores-contagem]"))).toBe("2 de 2 no pacote");
    expect($<HTMLButtonElement>("[data-avancar]")!.disabled).toBe(false);
  });

  it("estreitar por contrato refaz a sugestão com o contrato na consulta", async () => {
    servidor();
    await novo();
    await escolherCliente("Shopping Ibirapuera");
    expect($$("[data-contrato] option").map(txt)).toEqual(["Todos os contratos ativos", "Contrato CT-1", "Contrato CT-2"]);
    await escolher("[data-contrato]", "k2");
    expect(feitas("sugestoes", "GET").at(-1)!.url).toBe("/api/documentacao/sugestoes?clienteId=c1&contratoId=k2");
    expect(marcados()).toEqual(["t1"]);
  });

  it("desmarcar todo mundo trava o passo e diz o que falta", async () => {
    servidor();
    await novo();
    await escolherCliente("Shopping Ibirapuera");
    await clicar($("[data-marcar-todos]"));
    expect(marcados()).toEqual([]);
    expect($<HTMLButtonElement>("[data-avancar]")!.disabled).toBe(true);
    expect(txt($("[data-aviso-sem-gente]"))).toBe("Marque pelo menos um colaborador para continuar.");
  });

  it("puxar uma equipe e acrescentar pelo nome somam à lista, marcados e com a origem", async () => {
    servidor();
    await novo();
    await escolherCliente("Shopping Ibirapuera");
    await escolher("[data-puxar-equipe]", "eq1");
    expect(feitas("sugestoes", "GET").at(-1)!.url).toBe("/api/documentacao/sugestoes?equipeId=eq1");
    expect(marcados()).toEqual(["t1", "t2", "t3"]);
    expect($("[data-colaborador='t3']")!.getAttribute("data-motivo")).toBe("EQUIPE");

    await clicar($("[data-acrescentar-colaborador] [data-busca-select]"));
    expect($$("[data-lista-busca] [data-opcao]").map((o) => o.getAttribute("data-opcao")), "quem já está na lista não é oferecido de novo").toEqual(["t5"]);
    await clicar($("[data-opcao='t5']"));
    expect(marcados()).toEqual(["t1", "t2", "t3", "t5"]);
    expect($("[data-colaborador='t5']")!.getAttribute("data-motivo")).toBe("MANUAL");
  });

  it("cliente que ninguém atendeu: a tela diz isso e oferece equipe e nome, sem inventar lista", async () => {
    servidor();
    SUGESTAO.c9 = { colaboradores: [], email: { para: [], cc: [] }, contratos: [] };
    CLIENTES.push({ id: "c9", nome: "Padaria Nova", nomeFantasia: null, cpfCnpj: "99999999000199" });
    await novo();
    await escolherCliente("Padaria Nova");
    CLIENTES.pop();
    expect(txt($("[data-colaboradores-vazio]"))).toContain("Ninguém atendeu este cliente nos últimos 12 meses");
    expect($<HTMLButtonElement>("[data-avancar]")!.disabled).toBe(true);
    expect($("[data-puxar-equipe]")).toBeTruthy();
  });

  it("a sugestão recusada pelo servidor aparece com a razão e trava o passo", async () => {
    resposta = (url) => url === "/api/clientes" ? { status: 200, dados: CLIENTES } : { status: 403, dados: { erro: "Sem permissão para enviar documentos ao cliente." } };
    await novo();
    await escolherCliente("Shopping Ibirapuera");
    expect(txt($("[data-erro-sugestao]"))).toBe("Sem permissão para enviar documentos ao cliente.");
    expect($<HTMLButtonElement>("[data-avancar]")!.disabled).toBe(true);
  });
});

describe("o atalho \"Enviar documentação da equipe\" (ficha do cliente e do contrato)", () => {
  const comPermissao = (permissoes: Permissoes, el: any) => createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el });

  it("só aparece para quem tem \"Documentos › Enviar ao cliente\" — gerar documento ou gerenciar colaborador não bastam", async () => {
    await montar(comPermissao(montarPermissoes({ documentos: ["enviar"] }), createElement(AtalhoDocumentacao, { clienteId: "c1" })));
    expect($("[data-atalho-documentacao]")!.getAttribute("href")).toBe("/documentacao-equipe/novo?clienteId=c1");
    expect(txt($("[data-atalho-documentacao]"))).toContain("Enviar documentação da equipe");

    await act(async () => { root.render(null); });
    const quaseTudo = montarPermissoes({ documentos: ["criar", "gerenciar", "disciplinar"], equipes: ["visualizar", "gerenciar"], clientes: ["visualizar", "editar"], contratos: ["visualizar", "editar"] });
    await montar(comPermissao(quaseTudo, createElement(AtalhoDocumentacao, { clienteId: "c1" })));
    expect($("[data-atalho-documentacao]")).toBeNull();
  });

  it("do contrato leva o cliente e o contrato; sem cliente não há atalho", async () => {
    const pode = montarPermissoes({ documentos: ["enviar"] });
    await montar(comPermissao(pode, createElement(AtalhoDocumentacao, { clienteId: "c1", contratoId: "k2" })));
    expect($("[data-atalho-documentacao]")!.getAttribute("href")).toBe("/documentacao-equipe/novo?clienteId=c1&contratoId=k2");
    expect(hrefNovoEnvio("c 1/é", null)).toBe("/documentacao-equipe/novo?clienteId=c+1%2F%C3%A9");

    await act(async () => { root.render(null); });
    await montar(comPermissao(pode, createElement(AtalhoDocumentacao, { clienteId: null })));
    expect($("[data-atalho-documentacao]")).toBeNull();
  });

  it("as duas fichas usam o mesmo atalho, e a do contrato só manda o contrato quando ele está ativo", () => {
    const fonte = (arquivo: string) => readFileSync(path.resolve(__dirname, "../..", arquivo), "utf8");
    expect(fonte("components/forms/cliente-form.tsx")).toContain("<AtalhoDocumentacao clienteId={initialData!.id} compact={compact} />");
    expect(fonte("components/forms/contrato-form.tsx")).toContain('<AtalhoDocumentacao clienteId={initialData?.clienteId} contratoId={statusVal === "ATIVO" ? initialData?.id : null} compact={compact} />');
  });
});

describe("novo envio vindo do atalho: o cliente já chega escolhido", () => {
  it("abre com o cliente no campo e quem atende já marcado, sem ninguém escolher nada", async () => {
    servidor();
    await montar(createElement(NovoEnvio, { equipes: EQUIPES, colaboradores: TODOS, inicial: { clienteId: "c1", clienteNome: "Shopping Ibirapuera" } }));
    expect(feitas("sugestoes", "GET").map((c) => c.url)).toEqual(["/api/documentacao/sugestoes?clienteId=c1"]);
    expect(txt($("[data-cliente]"))).toContain("Shopping Ibirapuera");
    expect(marcados()).toEqual(["t1", "t2"]);
    expect($<HTMLButtonElement>("[data-avancar]")!.disabled).toBe(false);

    // e segue o fluxo normal até a prévia, com esse cliente
    await clicar($("[data-avancar]"));
    await clicar($("[data-ver-previa]"));
    expect(feitas("/previa")[0].corpo).toMatchObject({ clienteId: "c1", contratoId: null, colaboradorIds: ["t1", "t2"] });
  });

  it("vindo do contrato: a sugestão já sai estreitada por ele, e o contrato fica escolhido", async () => {
    servidor();
    await montar(createElement(NovoEnvio, { equipes: EQUIPES, colaboradores: TODOS, inicial: { clienteId: "c1", clienteNome: "Shopping Ibirapuera", contratoId: "k2" } }));
    expect(feitas("sugestoes", "GET").map((c) => c.url)).toEqual(["/api/documentacao/sugestoes?clienteId=c1&contratoId=k2"]);
    expect($<HTMLSelectElement>("[data-contrato]")!.value).toBe("k2");
    expect(marcados()).toEqual(["t1"]);
    await clicar($("[data-avancar]"));
    await clicar($("[data-ver-previa]"));
    expect(feitas("/previa")[0].corpo).toMatchObject({ clienteId: "c1", contratoId: "k2", colaboradorIds: ["t1"] });
  });

  it("sem atalho nada muda: a tela abre vazia e não busca ninguém", async () => {
    servidor();
    await novo();
    expect(feitas("sugestoes", "GET")).toHaveLength(0);
    expect($("[data-seletor-colaboradores]")).toBeNull();
  });
});

describe("novo envio: os tipos de documento", () => {
  // Mudou de propósito (acabamento): antes TODO o grupo de segurança do trabalho vinha marcado, e o
  // aviso de "falta" aparecia em todo envio (quase ninguém tem NR-13 e integração). Agora vêm
  // marcados só os quatro que praticamente todo técnico tem.
  it("vêm marcados ASO, NR-10, NR-35 e ficha de EPI; NR-13, integração, contrato e documento pessoal não; advertência e dado bancário nem aparecem", async () => {
    servidor();
    await novo();
    await escolherCliente("Shopping Ibirapuera");
    await clicar($("[data-avancar]"));
    expect($("[data-novo-envio]")!.getAttribute("data-passo")).toBe("o-que");

    const doGrupo = (g: string) => $$(`[data-grupo-tipos='${g}'] [data-tipo]`) as HTMLInputElement[];
    expect(tiposMarcados().sort()).toEqual(["aso", "ficha_epi", "nr_10", "nr_35"]);
    expect(doGrupo("SMT").map((c) => c.getAttribute("data-tipo")), "NR-13 e integração continuam na tela, para quem precisa marcar")
      .toEqual(expect.arrayContaining(["nr_13", "integracao"]));
    for (const fora of ["nr_13", "integracao"]) expect(($(`[data-tipo='${fora}']`) as HTMLInputElement).checked, fora).toBe(false);
    expect(txt($("[data-tipos]"))).not.toContain("já vem marcada");
    for (const g of ["CONTRATO", "PESSOAL"]) {
      expect(doGrupo(g).length, g).toBeGreaterThan(0);
      expect(doGrupo(g).some((c) => c.checked), `${g} começa desmarcado`).toBe(false);
    }
    for (const proibida of CATEGORIAS_PROIBIDAS) expect($(`[data-tipo='${proibida}']`), proibida).toBeNull();
    expect($$("[data-organizacao] option").map(txt)).toEqual(["Uma pasta por colaborador", "Uma pasta por tipo de documento", "Colaborador e, dentro, tipo"]);
  });

  it("sem nenhum tipo marcado não há prévia; a prévia leva exatamente o que foi marcado", async () => {
    servidor();
    await novo();
    await escolherCliente("Shopping Ibirapuera");
    await clicar($("[data-avancar]"));
    for (const c of $$("[data-tipo]").filter((x) => (x as HTMLInputElement).checked)) await clicar(c);
    expect(tiposMarcados()).toEqual([]);
    expect($<HTMLButtonElement>("[data-ver-previa]")!.disabled).toBe(true);

    await clicar($("[data-tipo='aso']"));
    await clicar($("[data-tipo='contrato']"));
    await escolher("[data-organizacao]", "POR_TIPO");
    await clicar($("[data-ver-previa]"));
    expect(feitas("/previa").map((c) => c.corpo)).toEqual([
      { clienteId: "c1", contratoId: null, colaboradorIds: ["t1", "t2"], categorias: ["aso", "contrato"], organizacao: "POR_TIPO" },
    ]);
  });
});

describe("novo envio: a prévia segura o que não pode sair", () => {
  it("pacote limpo: mostra o que entra, agrupado por pessoa, e libera o envio", async () => {
    servidor();
    await ateAPrevia();
    expect($("[data-previa-pacote]")!.getAttribute("data-liberado")).toBe("sim");
    expect(txt($("[data-previa-resumo]"))).toBe("2 arquivos de 2 colaboradores");
    expect($$("[data-previa-grupo]").map((g) => g.getAttribute("data-previa-grupo"))).toEqual(["João Lima", "Marina Alves"]);
    expect($("[data-previa-vencidos]")).toBeNull();
    expect($<HTMLButtonElement>("[data-enviar]")!.disabled).toBe(false);
    expect(txt($("[data-enviar]"))).toBe("Gerar o link");
  });

  it("VENCIDO segura: o botão de enviar trava em qualquer saída e não existe \"enviar assim mesmo\"", async () => {
    servidor({ previa: () => ({ status: 200, dados: PREVIA_COM_VENCIDO() }) });
    await ateAPrevia();
    expect($("[data-previa-pacote]")!.getAttribute("data-liberado")).toBe("nao");
    expect(txt($("[data-previa-vencidos]"))).toContain("O pacote está segurado: há documento vencido");
    expect(txt($("[data-vencido-de='t2']"))).toContain("João Lima");
    expect(txt($("[data-vencido-de='t2']"))).toContain("ASO (venceu em 01/10/2026)");
    expect($("[data-ciente-das-faltas]"), "vencido não tem caixa de confirmar").toBeNull();
    for (const via of ["LINK", "ZIP", "EMAIL"]) {
      await clicar($(`[data-via='${via}']`));
      expect($<HTMLButtonElement>("[data-enviar]")!.disabled, via).toBe(true);
    }
    expect(txt($("[data-motivo-bloqueio]"))).toBe("Segurado: há documento vencido.");
    await clicar($("[data-enviar]"));
    expect(feitas("/api/documentacao/envios")).toHaveLength(0);
  });

  it("as duas saídas do vencido: abrir a ficha (renovar) ou tirar a pessoa — que refaz a prévia sem ela", async () => {
    let n = 0;
    servidor({ previa: () => ({ status: 200, dados: n++ === 0 ? PREVIA_COM_VENCIDO() : PREVIA({ itens: [ITEM("t1", "Marina Alves", "aso", "ASO")] }) }) });
    await ateAPrevia();
    expect($("[data-vencido-de='t2'] [data-abrir-ficha]")!.getAttribute("href")).toBe("/colaboradores/t2/editar");
    await clicar($("[data-tirar-do-pacote='t2']"));
    expect(feitas("/previa").at(-1)!.corpo.colaboradorIds).toEqual(["t1"]);
    expect($("[data-previa-vencidos]")).toBeNull();
    expect($<HTMLButtonElement>("[data-enviar]")!.disabled).toBe(false);

    await clicar($("[data-enviar]"));
    expect(feitas("/api/documentacao/envios").at(-1)!.corpo.colaboradorIds, "o envio leva a lista já sem a pessoa").toEqual(["t1"]);
  });

  it("FALTA não segura, mas pede a confirmação de quem envia — e ela vai para a rota", async () => {
    servidor({ previa: () => ({ status: 200, dados: PREVIA({ faltando: [{ colaboradorId: "t2", colaboradorNome: "João Lima", categoria: "nr_10", categoriaRotulo: "NR-10" }] }) }) });
    await ateAPrevia();
    expect(txt($("[data-faltando-de='t2']"))).toBe("João Lima: NR-10");
    expect($<HTMLButtonElement>("[data-enviar]")!.disabled).toBe(true);
    expect(txt($("[data-motivo-bloqueio]"))).toBe("Falta confirmar os documentos ausentes.");
    await clicar($("[data-ciente-das-faltas]"));
    expect($<HTMLButtonElement>("[data-enviar]")!.disabled).toBe(false);
    await clicar($("[data-enviar]"));
    expect(feitas("/api/documentacao/envios").at(-1)!.corpo.cienteDasFaltas).toBe(true);
  });

  it("nenhum documento encontrado: a prévia diz isso e não há o que enviar", async () => {
    servidor({ previa: () => ({ status: 200, dados: PREVIA({ itens: [], liberado: false, faltando: [{ colaboradorId: "t1", colaboradorNome: "Marina Alves", categoria: "aso", categoriaRotulo: "ASO" }] }) }) });
    await ateAPrevia();
    expect(txt($("[data-previa-vazia]"))).toContain("Nenhum documento dos tipos marcados");
    expect($("[data-ciente-das-faltas]"), "não há o que confirmar num pacote vazio").toBeNull();
    expect($<HTMLButtonElement>("[data-enviar]")!.disabled).toBe(true);
  });

  it("a prévia recusada pelo servidor mostra a razão dele e não libera nada", async () => {
    servidor({ previa: () => ({ status: 403, dados: { erro: "Sem permissão para enviar documentos ao cliente." } }) });
    await ateAPrevia();
    expect(txt($("[data-erro-previa]"))).toBe("Sem permissão para enviar documentos ao cliente.");
    expect($("[data-previa-pacote]")).toBeNull();
    expect($<HTMLButtonElement>("[data-enviar]")!.disabled).toBe(true);
  });
});

describe("novo envio: as três saídas", () => {
  it("gerar link: manda a seleção, a via e o prazo — e o resultado traz o link para copiar", async () => {
    servidor();
    await ateAPrevia();
    await escolher("[data-saidas] [data-validade-link]", "30");
    await clicar($("[data-enviar]"));
    expect(feitas("/api/documentacao/envios").map((c) => c.corpo)).toEqual([{
      clienteId: "c1", contratoId: null, colaboradorIds: ["t1", "t2"], categorias: tiposDoPadrao(), organizacao: "POR_COLABORADOR",
      via: "LINK", validadeDias: 30, cienteDasFaltas: false,
    }]);
    expect($("[data-resultado-envio='UM']")!.getAttribute("data-envio-criado")).toBe("novo1");
    expect($<HTMLInputElement>("[data-link-valor]")!.value).toMatch(/\/documentacao\/tok-novo$/);
    expect(txt($("[data-link-validade]"))).toBe("Vale até 23/11/2026");
    expect($("[data-novo-envio]"), "o assistente deu lugar ao resultado").toBeNull();
  });

  it("baixar zip: não há prazo de link, cria o envio e baixa o arquivo dele", async () => {
    servidor();
    await ateAPrevia();
    await clicar($("[data-via='ZIP']"));
    expect($("[data-saidas] [data-validade-link]"), "zip não tem link, logo não tem prazo").toBeNull();
    expect(txt($("[data-enviar]"))).toBe("Baixar o zip");
    await clicar($("[data-enviar]"));
    expect(feitas("/api/documentacao/envios")[0].corpo.via).toBe("ZIP");
    expect(feitas("/zip", "GET").map((c) => c.url)).toEqual(["/api/documentacao/envios/novo1/zip"]);
    expect($("[data-link-do-envio]"), "zip não mostra link").toBeNull();
    expect(txt($("[data-baixar-zip]"))).toBe("Baixar o zip de novo");
  });

  it("enviar e-mail: os destinatários vêm do cadastro do cliente, são editáveis, e vão com a cópia para mim", async () => {
    servidor({ envio: (corpo) => ({ status: 201, dados: CRIADO("EMAIL", { email: { ok: true, para: corpo.email.para, cc: corpo.email.cc } }) }) });
    await ateAPrevia();
    await clicar($("[data-via='EMAIL']"));
    expect($$("[data-email-para] [data-chip]").map((c) => c.getAttribute("data-chip"))).toEqual(["seguranca@shopping.com"]);
    expect($$("[data-email-cc] [data-chip]").map((c) => c.getAttribute("data-chip"))).toEqual(["manutencao@shopping.com"]);
    await clicar($("[data-email-cc] [data-chip] button"));
    await clicar($("[data-email-copia-para-mim]"));
    await clicar($("[data-enviar]"));
    const corpo = feitas("/api/documentacao/envios")[0].corpo;
    expect(corpo.via).toBe("EMAIL");
    expect(corpo.email).toEqual({ para: ["seguranca@shopping.com"], cc: [], copiaParaMim: true });
    expect(txt($("[data-email-resultado='ok']"))).toBe("E-mail enviado para seguranca@shopping.com.");
  });

  it("e-mail sem destinatário não envia: o botão trava e diz por quê", async () => {
    servidor({ previa: () => ({ status: 200, dados: PREVIA() }) });
    SUGESTAO.c2.email = { para: [], cc: [] };
    await ateAPrevia("Hospital Santa Clara");
    SUGESTAO.c2.email = { para: ["compras@hospital.com"], cc: [] };
    await clicar($("[data-via='EMAIL']"));
    expect($<HTMLButtonElement>("[data-enviar]")!.disabled).toBe(true);
    expect(txt($("[data-motivo-bloqueio]"))).toBe("Sem e-mail de destino.");
  });

  it("o e-mail que falhou não vira \"enviado\": o resultado mostra o link e o motivo", async () => {
    servidor({ envio: () => ({ status: 201, dados: CRIADO("EMAIL", { email: { ok: false, erro: "Resend fora do ar", para: ["seguranca@shopping.com"], cc: [] } }) }) });
    await ateAPrevia();
    await clicar($("[data-via='EMAIL']"));
    await clicar($("[data-enviar]"));
    expect(txt($("[data-email-resultado='falhou']"))).toContain("O e-mail não saiu: Resend fora do ar.");
    expect($("[data-email-resultado='ok']")).toBeNull();
    expect($("[data-link-valor]"), "o link existe e pode ir por outro meio").toBeTruthy();
  });

  it("o motivo que já vem com ponto não vira ponto duplo (\"inativo..\") — no resultado e no histórico", async () => {
    servidor({ envio: () => ({ status: 201, dados: CRIADO("EMAIL", { email: { ok: false, erro: "E-mail não configurado ou inativo.", para: ["seguranca@shopping.com"], cc: [] } }) }) });
    await ateAPrevia();
    await clicar($("[data-via='EMAIL']"));
    await clicar($("[data-enviar]"));
    expect(txt($("[data-email-resultado='falhou']"))).toBe("O e-mail não saiu: E-mail não configurado ou inativo. O link acima vale e pode ser mandado por outro meio.");
    expect(fraseEmailNaoSaiu("Resend fora do ar")).toBe("O e-mail não saiu: Resend fora do ar.");
    expect(fraseEmailNaoSaiu("Caixa cheia. ")).toBe("O e-mail não saiu: Caixa cheia.");
    expect(fraseEmailNaoSaiu(undefined)).toBe("O e-mail não saiu: erro no envio.");
  });

  it("o servidor recusa o envio (sem permissão): a razão aparece e a tela NÃO anda para o resultado", async () => {
    servidor({ envio: () => ({ status: 403, dados: { erro: "Sem permissão para enviar documentos ao cliente." } }) });
    await ateAPrevia();
    await clicar($("[data-enviar]"));
    expect(txt($("[data-erro-envio]"))).toBe("Sem permissão para enviar documentos ao cliente.");
    expect(toasts("erro")).toEqual(["Sem permissão para enviar documentos ao cliente."]);
    expect($("[data-resultado-envio]")).toBeNull();
    expect($("[data-novo-envio]")!.getAttribute("data-passo")).toBe("previa");
    expect(feitas("/previa"), "403 não é motivo para refazer a prévia").toHaveLength(1);
  });

  it("o servidor segura por vencido na hora do envio (venceu entre a prévia e o clique): a prévia é refeita e mostra o bloqueio", async () => {
    let n = 0;
    servidor({
      previa: () => ({ status: 200, dados: n++ === 0 ? PREVIA() : PREVIA_COM_VENCIDO() }),
      envio: () => ({ status: 409, dados: { erro: "Há documento vencido no pacote: ASO de João Lima. Renove o documento ou tire o colaborador do pacote." } }),
    });
    await ateAPrevia();
    await clicar($("[data-enviar]"));
    expect(txt($("[data-erro-envio]"))).toContain("ASO de João Lima");
    expect($("[data-resultado-envio]")).toBeNull();
    expect(feitas("/previa")).toHaveLength(2);
    expect($("[data-previa-vencidos]")).toBeTruthy();
    expect($<HTMLButtonElement>("[data-enviar]")!.disabled).toBe(true);
  });

  it("voltar da prévia mantém o que foi escolhido", async () => {
    servidor();
    await ateAPrevia();
    await clicar($("[data-voltar]"));
    expect($("[data-novo-envio]")!.getAttribute("data-passo")).toBe("o-que");
    expect(tiposMarcados()).toEqual(tiposDoPadrao());
    await clicar($("[data-voltar]"));
    expect(marcados()).toEqual(["t1", "t2"]);
  });
});

/** Os tipos que nascem marcados, lidos da tela (a regra é de lib/documentacao/pacote). */
function tiposDoPadrao(): string[] {
  return JSON.parse(JSON.stringify(PADRAO));
}
let PADRAO: string[] = [];
beforeEach(async () => { PADRAO = (await import("@/lib/documentacao/pacote")).CATEGORIAS_PADRAO; });

describe("novo envio em lote (avançado)", () => {
  async function montarLote() {
    await novo();
    expect($("[data-novo-envio]")!.getAttribute("data-lote")).toBe("nao");
    await clicar($("[data-ligar-lote]"));
    expect($("[data-novo-envio]")!.getAttribute("data-lote")).toBe("sim");
    await escolherCliente("Shopping Ibirapuera", "[data-cliente-lote]");
    await escolherCliente("Hospital Santa Clara", "[data-cliente-lote]");
  }

  it("cada cliente entra com quem atende a ELE; o mesmo cliente não entra duas vezes", async () => {
    servidor();
    await montarLote();
    expect($$("[data-destino]").map((d) => [d.getAttribute("data-destino"), txt(d.querySelector("[data-destino-resumo]"))])).toEqual([
      ["c1", "2 colaboradores"], ["c2", "1 colaborador"],
    ]);
    await escolherCliente("Hospital Santa Clara", "[data-cliente-lote]");
    expect($$("[data-destino]")).toHaveLength(2);
    expect(toasts("erro")).toEqual(["Este cliente já está no envio."]);

    await clicar($("[data-destino='c1'] [data-abrir-destino]"));
    expect(marcados(), "dá para ajustar a lista de um cliente sem mexer nos outros").toEqual(["t1", "t2"]);
    await clicar($("[data-colaborador='t2']"));
    expect(txt($("[data-destino='c1'] [data-destino-resumo]"))).toBe("1 colaborador");
    expect(txt($("[data-destino='c2'] [data-destino-resumo]"))).toBe("1 colaborador");
  });

  it("zip não entra em lote; o envio manda UM pedido por cliente, com os colaboradores e os e-mails DELE", async () => {
    servidor({
      previa: (corpo) => ({ status: 200, dados: PREVIA({ cliente: { id: corpo.clienteId, nome: "x" } }) }),
      lote: (corpo) => ({ status: 201, dados: { loteId: "L1", resultados: corpo.envios.map((e: any, i: number) => ({
        clienteId: e.clienteId, ok: true, envio: ENVIO({ id: `n${i}`, clienteId: e.clienteId, clienteNome: e.clienteId === "c1" ? "Shopping Ibirapuera" : "Hospital Santa Clara", caminho: `/documentacao/tok-${e.clienteId}` }),
        email: { ok: true, para: e.email.para, cc: e.email.cc },
      })) } }),
    });
    await montarLote();
    await clicar($("[data-avancar]"));
    await clicar($("[data-ver-previa]"));
    expect(feitas("/previa").map((c) => [c.corpo.clienteId, c.corpo.colaboradorIds])).toEqual([["c1", ["t1", "t2"]], ["c2", ["t3"]]]);
    expect($$("[data-via]").map((v) => v.getAttribute("data-via")), "zip é download de quem está na tela: um por vez").toEqual(["LINK", "EMAIL"]);

    await clicar($("[data-via='EMAIL']"));
    expect($$("[data-previa-de]").map((p) => txt(p.querySelector("[data-previa-situacao]")))).toEqual([
      "2 arquivos · para seguranca@shopping.com", "2 arquivos · para compras@hospital.com",
    ]);
    expect(txt($("[data-enviar]"))).toBe("Enviar e-mail para 2 de 2 clientes");
    await clicar($("[data-enviar]"));

    const [lote] = feitas("/envios/lote");
    expect(lote.corpo.via).toBe("EMAIL");
    expect(lote.corpo.envios.map((e: any) => [e.clienteId, e.colaboradorIds, e.email])).toEqual([
      ["c1", ["t1", "t2"], { para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"] }],
      ["c2", ["t3"], { para: ["compras@hospital.com"], cc: [] }],
    ]);
    expect(feitas("/api/documentacao/envios").filter((c) => !c.url.includes("lote")), "lote não usa a rota de um envio só").toHaveLength(0);

    expect($$("[data-resultado-cliente]").map((r) => [r.getAttribute("data-resultado-cliente"), r.getAttribute("data-ok"), (r.querySelector("[data-link-valor]") as HTMLInputElement).value.replace(/^.*\/documentacao\//, "")])).toEqual([
      ["c1", "sim", "tok-c1"], ["c2", "sim", "tok-c2"],
    ]);
    expect(txt($("[data-resultado-resumo]"))).toBe("2 de 2 clientes receberam o pacote");
  });

  it("cliente com vencido fica de fora sem segurar os outros — e o resultado diz quem não recebeu e por quê", async () => {
    servidor({
      previa: (corpo) => ({ status: 200, dados: corpo.clienteId === "c1" ? PREVIA_COM_VENCIDO() : PREVIA({ cliente: { id: "c2", nome: "x" } }) }),
      lote: (corpo) => ({ status: 201, dados: { loteId: "L1", resultados: corpo.envios.map((e: any) => ({ clienteId: e.clienteId, ok: true, envio: ENVIO({ id: "n2", clienteId: "c2", clienteNome: "Hospital Santa Clara", caminho: "/documentacao/tok-c2" }) })) } }),
    });
    await montarLote();
    await clicar($("[data-avancar]"));
    await clicar($("[data-ver-previa]"));
    expect($$("[data-previa-de]").map((p) => [p.getAttribute("data-previa-de"), p.getAttribute("data-pronto"), txt(p.querySelector("[data-previa-situacao]"))])).toEqual([
      ["c1", "nao", "Segurado: há documento vencido"], ["c2", "sim", "2 arquivos"],
    ]);
    expect(txt($("[data-enviar]"))).toBe("Gerar link para 1 de 2 clientes");
    await clicar($("[data-enviar]"));
    expect(feitas("/envios/lote")[0].corpo.envios.map((e: any) => e.clienteId), "o segurado nem é pedido ao servidor").toEqual(["c2"]);
    expect(txt($("[data-resultado-de-fora]"))).toBe("Shopping IbirapueraFicou de fora: segurado: há documento vencido.");
    expect(txt($("[data-resultado-resumo]"))).toBe("1 de 2 clientes receberam o pacote");
  });

  it("o que o servidor recusa cliente a cliente aparece com a razão dele; o lote inteiro recusado não vira resultado", async () => {
    servidor({
      lote: (corpo) => ({ status: 201, dados: { loteId: "L1", resultados: [
        { clienteId: "c1", ok: false, erro: "Informe pelo menos um e-mail de destino." },
        { clienteId: "c2", ok: true, envio: ENVIO({ id: "n2", clienteId: "c2", clienteNome: "Hospital Santa Clara", caminho: "/documentacao/tok-c2" }) },
      ].filter((r) => corpo.envios.some((e: any) => e.clienteId === r.clienteId)) } }),
    });
    await montarLote();
    await clicar($("[data-avancar]"));
    await clicar($("[data-ver-previa]"));
    await clicar($("[data-enviar]"));
    expect(txt($("[data-resultado-cliente='c1']"))).toBe("Shopping IbirapueraNão saiu: Informe pelo menos um e-mail de destino.");
    expect($("[data-resultado-cliente='c1']")!.getAttribute("data-ok")).toBe("nao");
    expect(txt($("[data-resultado-resumo]"))).toBe("1 de 2 clientes receberam o pacote");

    await act(async () => { root.render(null); });
    servidor({ lote: () => ({ status: 403, dados: { erro: "Sem permissão para enviar documentos ao cliente." } }) });
    await montarLote();
    await clicar($("[data-avancar]"));
    await clicar($("[data-ver-previa]"));
    await clicar($("[data-enviar]"));
    expect(txt($("[data-erro-envio]"))).toBe("Sem permissão para enviar documentos ao cliente.");
    expect($("[data-resultado-envio]")).toBeNull();
  });

  it("desligar o lote volta a um cliente só", async () => {
    servidor();
    await montarLote();
    await clicar($("[data-ligar-lote]"));
    expect($("[data-novo-envio]")!.getAttribute("data-lote")).toBe("nao");
    expect($("[data-destinos-lote]")).toBeNull();
    expect(marcados(), "fica o primeiro cliente, com a lista dele").toEqual(["t1", "t2"]);
    // o segundo cliente saiu de verdade — não ficou escondido para ganhar prévia (ou envio) por baixo
    await clicar($("[data-avancar]"));
    await clicar($("[data-ver-previa]"));
    expect(feitas("/previa").map((c) => c.corpo.clienteId)).toEqual(["c1"]);
    expect(txt($("[data-enviar]"))).toBe("Gerar o link");
  });

  it("quem tinha escolhido zip e liga o lote cai em link — zip não existe em lote", async () => {
    servidor();
    await ateAPrevia();
    await clicar($("[data-via='ZIP']"));
    await clicar($("[data-voltar]"));
    await clicar($("[data-voltar]"));
    await clicar($("[data-ligar-lote]"));
    await clicar($("[data-avancar]"));
    await clicar($("[data-ver-previa]"));
    expect(($("[data-via='LINK']") as HTMLInputElement).checked).toBe(true);
    expect(txt($("[data-enviar]"))).toBe("Gerar link para 1 de 1 cliente");
    await clicar($("[data-enviar]"));
    expect(feitas("/envios/lote")[0].corpo.via).toBe("LINK");
  });
});

/* ───────── a página do cliente ───────── */

describe("a página do cliente (/documentacao/[token])", () => {
  const PUBLICO = (organizacao: string): DocumentacaoPublica => ({
    empresa: { nome: "Clima Total", logo: null }, cliente: "Shopping Ibirapuera", expiraEm: "2026-11-23T12:00:00.000Z", organizacao,
    itens: [
      { id: "i1", colaboradorNome: "Marina Alves", categoriaRotulo: "ASO", nome: "ASO periódico", caminho: "Marina Alves/ASO.pdf", tamanho: 2048, dataVencimento: "2027-06-01T00:00:00.000Z", vencido: false },
      { id: "i2", colaboradorNome: "Marina Alves", categoriaRotulo: "NR-10", nome: "Certificado", caminho: "Marina Alves/NR-10.pdf", tamanho: 2048, dataVencimento: null, vencido: false },
      { id: "i3", colaboradorNome: "João Lima", categoriaRotulo: "ASO", nome: "ASO periódico", caminho: "João Lima/ASO.pdf", tamanho: 2048, dataVencimento: "2026-11-10T00:00:00.000Z", vencido: true },
    ],
  } as DocumentacaoPublica);

  it("baixar tudo e item a item, um cartão por pessoa — e os endereços levam o token", async () => {
    await montar(createElement(DocumentacaoPublicaLista, { token: "tok/1", dados: PUBLICO("POR_COLABORADOR") }));
    expect(txt($("[data-documentacao-resumo]"))).toBe("3 arquivos de 2 colaboradores");
    expect($("[data-baixar-tudo]")!.getAttribute("href")).toBe("/api/publico/documentacao/tok%2F1/zip");
    expect($$("[data-grupo]").map((g) => g.getAttribute("data-grupo"))).toEqual(["João Lima", "Marina Alves"]);
    expect($("[data-item-documentacao='i1'] [data-baixar-item]")!.getAttribute("href")).toBe("/api/publico/documentacao/tok%2F1/arquivo/i1");
    expect($("[data-item-documentacao='i1'] [data-ver-item]")!.getAttribute("href")).toBe("/api/publico/documentacao/tok%2F1/arquivo/i1?ver=1");
    expect(txt($("[data-item-documentacao='i1'] [data-ver-item]"))).toBe("ASO · ASO periódico");
  });

  it("organizado por tipo: o cartão é o tipo e cada linha diz de quem é", async () => {
    await montar(createElement(DocumentacaoPublicaLista, { token: "t", dados: PUBLICO("POR_TIPO") }));
    expect($$("[data-grupo]").map((g) => g.getAttribute("data-grupo"))).toEqual(["ASO", "NR-10"]);
    expect(txt($("[data-item-documentacao='i3'] [data-ver-item]"))).toBe("João Lima · ASO periódico");
  });

  it("pacote cujos arquivos saíram da ficha: diz a quem pedir, sem botão de baixar o nada", async () => {
    await montar(createElement(DocumentacaoPublicaLista, { token: "t", dados: { ...PUBLICO("POR_COLABORADOR"), itens: [] } }));
    expect(txt($("[data-documentacao-vazia]"))).toBe("Os arquivos deste pacote não estão mais disponíveis. Peça um novo envio a Clima Total.");
    expect($("[data-baixar-tudo]")).toBeNull();
  });

  it("a página não tem nada de interno: nem login, nem link para o sistema", async () => {
    await montar(createElement(DocumentacaoPublicaLista, { token: "t", dados: PUBLICO("POR_COLABORADOR") }));
    const destinos = $$("a").map((a) => a.getAttribute("href") ?? "");
    expect(destinos.every((h) => h.startsWith("/api/publico/documentacao/t/")), destinos.join(" | ")).toBe(true);
  });
});

/* ───────── quem entra ───────── */

describe("quem entra nas telas da documentação", () => {
  const fonte = (arquivo: string) => readFileSync(path.resolve(__dirname, "../..", arquivo), "utf8");

  it("o item do menu fica em Equipes e pede \"Documentos › Enviar ao cliente\" — e só ela", () => {
    const linha = fonte("components/layout/sidebar.tsx").split("\n").find((l) => l.includes('"/documentacao-equipe"'))!;
    expect(linha).toContain('label: "Documentação da equipe"');
    expect(linha).toContain('modulo: "documentos"');
    expect(linha).toContain('acao: "enviar"');
    expect(linha, "a ação basta sozinha: não é \"ver documentos\"").toContain("somenteAcao: true");
  });

  it("gerar documento na ficha e gerenciar colaboradores NÃO abrem o envio ao cliente", () => {
    expect(pode(PRESETS.ADMINISTRADOR, "documentos", "enviar")).toBe(true);
    const quaseTudo = montarPermissoes({ documentos: ["criar", "gerenciar", "disciplinar"], equipes: ["visualizar", "gerenciar", "excluir"], admissao: ["gerenciar"] });
    expect(pode(quaseTudo, "documentos", "enviar")).toBe(false);
    expect(pode(montarPermissoes({ documentos: ["enviar"] }), "documentos", "enviar")).toBe(true);
  });

  it("as páginas internas conferem a permissão sozinhas (a rota não tem módulo de \"visualizar\" no middleware)", () => {
    // (26/11) No mapa do portão de novo, sem exigir "visualizar" (o módulo não tem): quem só tem
    // "enviar" entra; quem não tem nada de Documentos é barrado já no portão
    expect(moduloDaRota("/documentacao-equipe")).toBe("documentos");
    expect(portaoBarra("/documentacao-equipe", montarPermissoes({ documentos: ["enviar"] }), "OPERADOR")).toBe(false);
    expect(portaoBarra("/documentacao-equipe", montarPermissoes({}), "OPERADOR")).toBe(true);
    for (const pagina of ["app/(dashboard)/documentacao-equipe/page.tsx", "app/(dashboard)/documentacao-equipe/novo/page.tsx"]) {
      expect(fonte(pagina), pagina).toContain('if (!pode(user.permissoes, "documentos", "enviar", user.role)) redirect("/sem-permissao");');
    }
  });

  it("só o link do cliente é público: /documentacao/ sim, /documentacao-equipe não", () => {
    const m = fonte("middleware.ts");
    const publicas = m.slice(m.indexOf("rotasPublicas"), m.indexOf("]", m.indexOf("rotasPublicas")));
    expect(publicas).toContain('"/documentacao/"');
    expect(publicas, "com a barra no fim, o prefixo não alcança a tela interna").not.toContain('"/documentacao"');
    expect("/documentacao-equipe".startsWith("/documentacao/")).toBe(false);
    expect("/documentacao-equipe/novo".startsWith("/documentacao/")).toBe(false);
  });
});
