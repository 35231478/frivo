// @vitest-environment happy-dom
/**
 * OS BOTÕES DE DOWNLOAD da entrega ao contador, num DOM de verdade.
 *
 * O que se prova:
 *  - a ficha, o pacote e o contrato só aparecem de ASSINADO em diante — a MESMA regra do servidor,
 *    para o botão nunca oferecer o que a rota recusaria;
 *  - cada botão aponta para a sua rota, com o id da admissão;
 *  - numa admissão cancelada ou ainda em preenchimento, os downloads não existem (nem desabilitados:
 *    botão que não faz nada é dívida visual);
 *  - os downloads são `<a>` de verdade — baixar é navegação, não ação.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AcoesAdmissao } from "@/components/admissao/acoes-admissao";
import { SITUACOES_COM_ENTREGA, temEntrega } from "@/lib/admissao/admissao-entrega-regras";
import { SITUACOES, type SituacaoAdmissao } from "@/lib/admissao/admissao";
import type { AdmissaoDoRh } from "@/lib/admissao/admissao-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/ui/avisos", () => ({ toast: () => {}, confirmar: async () => true }));

let caixa: HTMLDivElement; let root: Root;

beforeEach(() => {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  (globalThis as any).fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as never);
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const montar = async (el: any) => { await act(async () => { root.render(el); }); await esperar(); };
const remontar = async (el: any) => { await act(async () => { root.render(null); }); await montar(el); };
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

const ADMISSAO = (situacao: SituacaoAdmissao): AdmissaoDoRh => ({
  id: "a1", token: "tok-abc", situacao, situacaoRotulo: situacao,
  expiraEm: "2026-11-23T12:00:00.000Z", expirado: false, etapa: null, envios: 1,
  enviadoEm: "2026-11-10T12:00:00.000Z", enviadoCanal: "EMAIL", enviadoPara: "marina@exemplo.com",
  abertoEm: null, consentimentoEm: null, concluidoEm: null,
  assinaturaEm: situacao === "CONVIDADO" ? null : "2026-11-12T12:00:00.000Z",
  assinaturaNome: "Marina Alves Pereira", assinaturaIp: "200.1.2.3",
  emailVerificado: null, canceladaEm: null, cancelamentoMotivo: null, canceladaPor: null,
  enviadoContadorEm: null, admitidoEm: null,
  criadoEm: "2026-11-10T12:00:00.000Z", criadoPor: "Ana Souza",
  colaborador: { id: "t1", nome: "Marina Alves Pereira", cpf: "52998224725", email: null, telefone: "11988887777", cargo: "Técnico" },
  documentosEnviados: 4, documentosObrigatorios: 4,
});

/** Abre o ⋮ (a variante de menu, que é a da lista /admissoes) */
const abrirMenu = async () => clicar($("[data-acao='menu']"));

describe("entrega ao contador: a regra, pura", () => {
  it("de ASSINADO em diante, e em mais nenhuma situação", () => {
    expect([...SITUACOES_COM_ENTREGA]).toEqual(["ASSINADO", "ENVIADO_CONTADOR", "ADMITIDO"]);
    for (const s of SITUACOES) {
      expect(temEntrega(s), s).toBe(SITUACOES_COM_ENTREGA.includes(s));
    }
    expect(temEntrega("QUALQUER_OUTRA")).toBe(false);
  });
});

describe("entrega ao contador: o menu da lista", () => {
  it("assinada: os três downloads aparecem, cada um na sua rota", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("ASSINADO") }));
    await abrirMenu();

    expect($("[data-item='ficha-pdf']")!.getAttribute("href")).toBe("/api/admissoes/a1/ficha");
    expect($("[data-item='pacote']")!.getAttribute("href")).toBe("/api/admissoes/a1/documentos");
    expect($("[data-item='contrato-pdf']")!.getAttribute("href")).toBe("/api/admissoes/a1/contrato");
    // baixar é navegação: âncora de verdade, não botão
    expect($("[data-item='ficha-pdf']")!.tagName).toBe("A");
  });

  it("ainda preenchendo: nenhum download — nem desabilitado", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("PREENCHENDO") }));
    await abrirMenu();
    for (const item of ["ficha-pdf", "pacote", "contrato-pdf"]) {
      expect($(`[data-item='${item}']`), item).toBeNull();
    }
    // e o resto do menu continua lá
    expect($("[data-item='progresso']")).toBeTruthy();
  });

  it("cancelada: nenhum download", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("CANCELADA") }));
    await abrirMenu();
    expect($("[data-item='ficha-pdf']")).toBeNull();
    expect($("[data-item='pacote']")).toBeNull();
  });

  it("admitida: os downloads continuam (o contador pode precisar depois)", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("ADMITIDO") }));
    await abrirMenu();
    expect($("[data-item='ficha-pdf']")).toBeTruthy();
    expect($("[data-item='pacote']")).toBeTruthy();
  });
});

describe("entrega ao contador: os botões da aba Admissão", () => {
  it("assinada: ficha e pacote como botões, apontando para as rotas", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("ASSINADO"), variante: "botoes" }));
    expect($("[data-acao-ficha]")!.getAttribute("href")).toBe("/api/admissoes/a1/ficha");
    expect($("[data-acao-pacote]")!.getAttribute("href")).toBe("/api/admissoes/a1/documentos");
    expect($("[data-acao-ficha]")!.tagName).toBe("A");
  });

  it("antes de assinar, os botões de download não existem", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("AGUARDANDO_ASSINATURA"), variante: "botoes" }));
    expect($("[data-acao-ficha]")).toBeNull();
    expect($("[data-acao-pacote]")).toBeNull();

    await remontar(createElement(AcoesAdmissao, { admissao: ADMISSAO("ASSINADO"), variante: "botoes" }));
    expect($("[data-acao-ficha]"), "e aparecem assim que ela é assinada").toBeTruthy();
  });
});
