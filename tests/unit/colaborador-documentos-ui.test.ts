// @vitest-environment happy-dom
/**
 * A SEÇÃO DOCUMENTOS da ficha do colaborador num DOM de verdade.
 *
 * O que se prova:
 *  - a lista mostra nome, categoria, validade, quando chegou e QUEM pôs ali — e o que veio pela
 *    admissão aparece na MESMA lista, marcado como enviado pelo colaborador (sem lista paralela);
 *  - os SELOS de validade: vencido em vermelho, vence em breve em amarelo, e o aviso do topo com
 *    a contagem — o mesmo cálculo do servidor, não um segundo cálculo na tela;
 *  - EXCLUIR só existe com a permissão de excluir, pede confirmação que diz que fica o rastro, e a
 *    linha só sai da tela quando a rota aceita (rota que recusa não muda a tela);
 *  - BAIXAR aponta para a rota do documento, e some quando o documento não tem arquivo;
 *  - ANEXAR só manda com arquivo escolhido, e manda categoria, nome e validade;
 *  - o contrato assinado da admissão aparece na seção e abre o texto congelado — e, quando o
 *    PDF dele já está guardado nos anexos, aparece UMA vez só (o PDF manda);
 *  - somente leitura não mostra anexar, editar nem excluir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentosColaborador } from "@/components/colaborador/documentos-colaborador";
import { TIPO_CONTRATO_ASSINADO } from "@/lib/admissao/admissao-entrega-regras";
import type { DocumentoLinha } from "@/lib/colaborador/documentos-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
/** A confirmação da casa: o teste decide a resposta e guarda o que foi perguntado */
const aviso = vi.hoisted(() => ({ confirmou: true, perguntas: [] as any[], toasts: [] as string[] }));
vi.mock("@/components/ui/avisos", () => ({
  toast: (m: string) => aviso.toasts.push(m),
  confirmar: async (o: any) => { aviso.perguntas.push(o); return aviso.confirmou; },
}));

let caixa: HTMLDivElement; let root: Root;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let resposta: (url: string, metodo: string, corpo: any) => { status: number; dados: any } = () => ({ status: 200, dados: {} });

/** 16/11/2026, 09:00 em Brasília */
const AGORA = new Date("2026-11-16T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  chamadas.length = 0;
  aviso.confirmou = true; aviso.perguntas = []; aviso.toasts = [];
  resposta = () => ({ status: 200, dados: {} });
  (globalThis as any).fetch = vi.fn(async (url: string, op: any = {}) => {
    const corpo = op.body ? JSON.parse(op.body) : undefined;
    // A preferência da planilha (TabelaPro, Leva I.2) não é chamada da tela
    if (String(url).startsWith("/api/preferencias/")) return { ok: true, status: 200, json: async () => ({ valor: null }) } as never;
    chamadas.push({ url: String(url), metodo: op.method ?? "GET", corpo });
    const r = resposta(String(url), op.method ?? "GET", corpo);
    return { ok: r.status < 400, status: r.status, json: async () => r.dados } as never;
  });
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; vi.useRealTimers(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const corpo = () => txt(document.body);
const clicar = async (el: Element | null) => { expect(el, "o elemento existe").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const digitar = async (sel: string, valor: string) => {
  const campo = $<HTMLInputElement>(sel);
  expect(campo, `o campo ${sel} existe`).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
};
const montar = async (el: any) => { await act(async () => { root.render(el); }); await esperar(); };
/** Abre o ⋮ de uma linha e devolve os itens do menu */
const abrirMenu = async (docId: string) => {
  const linha = $(`[data-documento="${docId}"]`);
  await clicar(linha!.querySelector("button"));
  return $$("[data-item]");
};
const item = (id: string) => $(`[data-item="${id}"]`);

/* ───────── fixtures ───────── */

const DOC = (extra: Partial<DocumentoLinha> = {}): DocumentoLinha => ({
  id: "d1", nome: "Contrato de trabalho 2024", categoria: "contrato", tipo: "contrato",
  origem: "MANUAL", arquivoTipo: "application/pdf", tamanho: 245_760,
  dataVencimento: null, criadoEm: "2026-10-02T12:00:00.000Z",
  criadoPorNome: "Ana Souza", temArquivo: true, ...extra,
});

const props = (extra: Record<string, unknown> = {}) => ({
  colaboradorId: "t1", documentosIniciais: [DOC()], podeExcluir: true, ...extra,
});

describe("Documentos da ficha: a lista", () => {
  it("mostra nome, categoria, formato, data e quem anexou", async () => {
    await montar(createElement(DocumentosColaborador, props()));
    const linha = $('[data-documento="d1"]');
    expect(txt(linha)).toContain("Contrato de trabalho 2024");
    expect(txt(linha)).toContain("Contrato de trabalho"); // a categoria
    expect(txt(linha)).toContain("PDF · 240 KB");
    expect(txt(linha)).toContain("Anexado pelo RH: Ana Souza");
  });

  it("o que veio pela admissão fica na MESMA lista, dizendo que foi o colaborador que mandou", async () => {
    await montar(createElement(DocumentosColaborador, props({
      documentosIniciais: [
        DOC(),
        DOC({ id: "d2", nome: "RG (frente e verso)", categoria: "documento_pessoal", tipo: "rg", origem: "ADMISSAO", criadoPorNome: null, arquivoTipo: "image/png", tamanho: 51_200 }),
      ],
    })));
    expect($$("[data-documento]")).toHaveLength(2);
    const vindo = $('[data-documento="d2"]');
    expect(txt(vindo)).toContain("Enviado na admissão");
    expect(txt(vindo)).toContain("Documento pessoal");
    expect(txt(vindo)).not.toContain("Anexado pelo RH");
  });

  it("documento ANTIGO (sem categoria) mostra o que estava gravado, sem inventar gaveta", async () => {
    await montar(createElement(DocumentosColaborador, props({
      documentosIniciais: [DOC({ id: "d9", nome: "Diploma (papel)", categoria: null, tipo: "Diploma", arquivoTipo: null, tamanho: null, temArquivo: false })],
    })));
    expect(txt($('[data-documento="d9"]'))).toContain("Diploma");
  });

  it("ficha sem documento nenhum diz o que fazer, em vez de uma lista vazia", async () => {
    await montar(createElement(DocumentosColaborador, props({ documentosIniciais: [] })));
    expect(corpo()).toContain("Nenhum documento nesta ficha");
    expect($("[data-tabela-documentos]")).toBeNull();
    expect($("[data-anexar-documento]"), "o caminho de anexar continua à mão").toBeTruthy();
  });
});

describe("Documentos da ficha: os selos de validade", () => {
  it("vencido é vermelho, vence em breve é amarelo, e o que está em dia só mostra a data", async () => {
    await montar(createElement(DocumentosColaborador, props({
      documentosIniciais: [
        DOC({ id: "dv", nome: "ASO 2025", dataVencimento: "2026-11-01T00:00:00.000Z" }),
        DOC({ id: "db", nome: "NR-35", dataVencimento: "2026-11-26T00:00:00.000Z" }),
        DOC({ id: "dk", nome: "NR-10", dataVencimento: "2027-08-01T00:00:00.000Z" }),
        DOC({ id: "ds", nome: "Contrato", dataVencimento: null }),
      ],
    })));
    expect($('[data-documento="dv"] [data-validade]')!.getAttribute("data-validade")).toBe("VENCIDO");
    expect(txt($('[data-documento="dv"] [data-validade]'))).toBe("Vencido há 15 dias");
    expect($('[data-documento="db"] [data-validade]')!.getAttribute("data-validade")).toBe("VENCE_EM_BREVE");
    expect(txt($('[data-documento="db"] [data-validade]'))).toBe("Vence em 10 dias");
    // em dia e sem validade não ganham selo
    expect($('[data-documento="dk"] [data-validade]')).toBeNull();
    expect($('[data-documento="ds"] [data-validade]')).toBeNull();
  });

  it("o aviso do topo conta os vencidos e os que vencem em breve", async () => {
    await montar(createElement(DocumentosColaborador, props({
      documentosIniciais: [
        DOC({ id: "a", dataVencimento: "2026-11-01T00:00:00.000Z" }),
        DOC({ id: "b", dataVencimento: "2026-10-01T00:00:00.000Z" }),
        DOC({ id: "c", dataVencimento: "2026-11-26T00:00:00.000Z" }),
      ],
    })));
    const banner = $("[data-aviso-validade]");
    expect(banner!.getAttribute("data-aviso-validade")).toBe("vencido");
    expect(txt(banner)).toContain("2 documentos vencidos");
    expect(txt(banner)).toContain("1 documento vence em breve");
  });

  it("sem nada vencido não existe aviso nenhum (a ficha não grita à toa)", async () => {
    await montar(createElement(DocumentosColaborador, props()));
    expect($("[data-aviso-validade]")).toBeNull();
  });
});

describe("Documentos da ficha: baixar", () => {
  it("baixar aponta para a rota do documento", async () => {
    await montar(createElement(DocumentosColaborador, props()));
    await abrirMenu("d1");
    expect(item("baixar")!.getAttribute("href")).toBe("/api/tecnicos/t1/documentos/d1");
  });

  it("documento sem arquivo não oferece download: o item fica desabilitado, com o motivo", async () => {
    await montar(createElement(DocumentosColaborador, props({
      documentosIniciais: [DOC({ temArquivo: false })],
    })));
    await abrirMenu("d1");
    expect(item("baixar")!.hasAttribute("data-desabilitado")).toBe(true);
    expect(item("baixar")!.getAttribute("href")).toBeNull();
    expect(item("baixar")!.getAttribute("title")).toContain("não tem arquivo");
  });
});

describe("Documentos da ficha: excluir", () => {
  it("sem a permissão de excluir, o item NÃO existe (e o resto continua)", async () => {
    await montar(createElement(DocumentosColaborador, props({ podeExcluir: false })));
    await abrirMenu("d1");
    expect(item("excluir")).toBeNull();
    expect(item("baixar")).toBeTruthy();
    expect(item("alterar")).toBeTruthy();
  });

  it("pede confirmação dizendo que fica o rastro, e só então chama a rota", async () => {
    await montar(createElement(DocumentosColaborador, props()));
    await abrirMenu("d1");
    await clicar(item("excluir"));

    expect(aviso.perguntas).toHaveLength(1);
    expect(aviso.perguntas[0].mensagem).toContain("Fica registrado");
    expect(aviso.perguntas[0].perigo).toBe(true);
    expect(chamadas).toEqual([{ url: "/api/tecnicos/t1/documentos/d1", metodo: "DELETE", corpo: undefined }]);
    expect($('[data-documento="d1"]'), "a linha sai da tela").toBeNull();
    expect(aviso.toasts).toEqual(["Documento excluído."]);
  });

  it("cancelando a confirmação, nada é chamado e o documento fica", async () => {
    aviso.confirmou = false;
    await montar(createElement(DocumentosColaborador, props()));
    await abrirMenu("d1");
    await clicar(item("excluir"));
    expect(chamadas).toHaveLength(0);
    expect($('[data-documento="d1"]')).toBeTruthy();
  });

  it("quando a ROTA recusa (403), a tela NÃO muda: o documento continua lá, com o aviso do erro", async () => {
    resposta = () => ({ status: 403, dados: { erro: "Sem permissão para esta ação" } });
    await montar(createElement(DocumentosColaborador, props()));
    await abrirMenu("d1");
    await clicar(item("excluir"));
    expect($('[data-documento="d1"]'), "a tela só muda com a resposta boa").toBeTruthy();
    expect(aviso.toasts).toEqual(["Sem permissão para esta ação"]);
  });
});

describe("Documentos da ficha: anexar", () => {
  it("o botão de anexar só manda depois de escolher o arquivo", async () => {
    await montar(createElement(DocumentosColaborador, props()));
    await clicar($("[data-anexar-documento]"));
    const salvar = $<HTMLButtonElement>("[data-salvar-documento]");
    expect(salvar!.disabled, "sem arquivo não manda").toBe(true);
    await clicar(salvar);
    expect(chamadas).toHaveLength(0);
  });

  it("manda categoria, nome e validade, e a linha nova entra na lista", async () => {
    resposta = (_u, _m, c) => ({ status: 201, dados: { documento: DOC({ id: "novo", nome: c.nome, categoria: c.categoria, dataVencimento: "2027-05-10T00:00:00.000Z" }) } });
    await montar(createElement(DocumentosColaborador, props()));
    await clicar($("[data-anexar-documento]"));

    // escolher o arquivo (o FileReader do happy-dom devolve o data URL)
    const campo = $<HTMLInputElement>("[data-campo-arquivo]")!;
    const arquivo = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "aso-2026.pdf", { type: "application/pdf" });
    Object.defineProperty(campo, "files", { value: [arquivo], configurable: true });
    await act(async () => { campo.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();

    await act(async () => {
      const sel = $<HTMLSelectElement>("[data-categoria]")!;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "aso");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();

    await clicar($("[data-salvar-documento]"));
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe("/api/tecnicos/t1/documentos");
    expect(chamadas[0].metodo).toBe("POST");
    expect(chamadas[0].corpo.categoria).toBe("aso");
    expect(chamadas[0].corpo.nome).toBe("aso-2026.pdf");
    expect(String(chamadas[0].corpo.arquivoUrl)).toContain("base64");
    expect($$("[data-documento]"), "a lista cresceu sem recarregar a página").toHaveLength(2);
  });

  it("categoria que costuma vencer lembra de preencher a validade; com a data, o lembrete some", async () => {
    await montar(createElement(DocumentosColaborador, props()));
    await clicar($("[data-anexar-documento]"));
    expect($("[data-lembrete-validade]"), "\"Outros\" não vence: nada a lembrar").toBeNull();

    const escolher = async (v: string) => {
      await act(async () => {
        const sel = $<HTMLSelectElement>("[data-categoria]")!;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, v);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
    };

    await escolher("aso");
    expect(txt($("[data-lembrete-validade]"))).toContain("ASO (exame) costuma ter validade");
    await escolher("contrato");
    expect($("[data-lembrete-validade]"), "contrato não vence: o lembrete some").toBeNull();
  });

  it("arquivo recusado pelo servidor mostra o motivo e não entra na lista", async () => {
    resposta = () => ({ status: 400, dados: { erro: "Tipo de arquivo não aceito." } });
    await montar(createElement(DocumentosColaborador, props()));
    await clicar($("[data-anexar-documento]"));
    const campo = $<HTMLInputElement>("[data-campo-arquivo]")!;
    Object.defineProperty(campo, "files", { value: [new File(["x"], "x.pdf", { type: "application/pdf" })], configurable: true });
    await act(async () => { campo.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    await clicar($("[data-salvar-documento]"));

    expect(txt($("[data-erro]"))).toBe("Tipo de arquivo não aceito.");
    expect($$("[data-documento]")).toHaveLength(1);
  });
});

describe("Documentos da ficha: o contrato da admissão e a leitura", () => {
  it("o contrato assinado aparece na seção e abre o texto congelado", async () => {
    await montar(createElement(DocumentosColaborador, props({
      contratoAssinado: { texto: "CONTRATO DE TRABALHO\nEntre as partes…", assinadoEm: "2026-11-10T12:00:00.000Z", assinadoPor: "Marina Alves" },
    })));
    expect($("[data-linha-contrato]"), "na MESMA tabela, não numa lista à parte").toBeTruthy();
    expect(txt($("[data-linha-contrato]"))).toContain("Enviado na admissão");

    await clicar($("[data-ver-contrato]"));
    expect(corpo()).toContain("CONTRATO DE TRABALHO");
    expect(corpo()).toContain("Marina Alves");
  });

  it("sem admissão assinada não há linha de contrato", async () => {
    await montar(createElement(DocumentosColaborador, props()));
    expect($("[data-linha-contrato]")).toBeNull();
  });

  it("com o PDF do contrato guardado, o contrato aparece UMA vez — o PDF, não o texto", async () => {
    const pdfDoContrato = DOC({
      id: "d-contrato", tipo: TIPO_CONTRATO_ASSINADO, categoria: "contrato",
      nome: "Contrato assinado - Marina Alves", origem: "ADMISSAO", criadoPorNome: null,
    });
    await montar(createElement(DocumentosColaborador, props({
      documentosIniciais: [pdfDoContrato, DOC()],
      contratoAssinado: { texto: "CONTRATO DE TRABALHO\nEntre as partes…", assinadoEm: "2026-11-10T12:00:00.000Z", assinadoPor: "Marina Alves" },
    })));
    // o PDF é o anexo de verdade: dá para baixar, e traz a prova e a foto
    expect($("[data-documento='d-contrato']")).toBeTruthy();
    // e a linha do texto congelado sai de cena, em vez de repetir "Contrato assinado"
    expect($("[data-linha-contrato]"), "sem linha repetida").toBeNull();
    expect($("[data-cartao-contrato]"), "nem no celular").toBeNull();
  });

  it("somente leitura: nem anexar, nem editar, nem excluir — mas baixar continua", async () => {
    await montar(createElement(DocumentosColaborador, props({ somenteLeitura: true })));
    expect($("[data-anexar-documento]")).toBeNull();
    await abrirMenu("d1");
    expect(item("alterar")).toBeNull();
    expect(item("excluir")).toBeNull();
    expect(item("baixar")).toBeTruthy();
  });
});
