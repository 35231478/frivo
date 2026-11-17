// @vitest-environment happy-dom
/**
 * AS TELAS dos modelos de documento, num DOM de verdade.
 *
 * O que se prova:
 *  - o EDITOR do modelo: os campos que o sistema preenche aparecem, ficam VERDES quando o texto os
 *    usa, e o campo desconhecido vira aviso — nunca some;
 *  - trocar para EPI liga a lista de itens sozinho (é o que a NR-6 pede) e o campo fica travado;
 *  - GERAR: sem permissão de advertência, o modelo disciplinar nem aparece na lista de escolha;
 *  - a ficha de EPI pede o CA antes de ir ao servidor — e a mensagem diz o que fazer sem ele;
 *  - a prévia mostra o texto preenchido, e o que o sistema não conhece sai marcado;
 *  - depois de gerar, o diálogo vira a assinatura: sem nome e foto o botão não deixa seguir;
 *  - o botão "Gerar documento" só existe com a permissão, e some em somente leitura;
 *  - o papel aguardando assinatura aparece na MESMA lista, com baixar a prévia, assinar e cancelar;
 *  - a linha do papel já assinado troca "Excluir" por "Cancelar o documento";
 *  - campo obrigatório do tipo em branco trava na tela, antes de ir ao servidor;
 *  - papel CANCELADO não volta a aparecer como aguardando assinatura;
 *  - a foto grande demais é recusada, e o X descarta a que foi tirada;
 *  - a tela não muda quando a rota recusa.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorModeloDocumento } from "@/components/cadastros/editores/editor-modelo-documento";
import { GerarDocumento, type EmitidoDaTela, type ModeloDaLista } from "@/components/colaborador/gerar-documento";
import { DocumentosColaborador } from "@/components/colaborador/documentos-colaborador";
import { CapturaFoto, TAMANHO_MAX_FOTO } from "@/components/ui/captura-foto";
import type { DocumentoLinha } from "@/lib/colaborador/documentos-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
const aviso = vi.hoisted(() => ({ confirmou: true, toasts: [] as string[] }));
vi.mock("@/components/ui/avisos", () => ({
  toast: (m: string) => aviso.toasts.push(m),
  confirmar: async () => aviso.confirmou,
}));

let caixa: HTMLDivElement; let root: Root;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let resposta: (url: string, metodo: string, corpo: any) => { status: number; dados: any } = () => ({ status: 200, dados: {} });

beforeEach(() => {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  chamadas.length = 0;
  aviso.confirmou = true; aviso.toasts = [];
  resposta = () => ({ status: 200, dados: {} });
  (globalThis as any).fetch = vi.fn(async (url: string, op: any = {}) => {
    const corpo = op.body ? JSON.parse(op.body) : undefined;
    chamadas.push({ url: String(url), metodo: op.method ?? "GET", corpo });
    const r = resposta(String(url), op.method ?? "GET", corpo);
    return { ok: r.status < 400, status: r.status, json: async () => r.dados } as never;
  });
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const corpoTexto = () => txt(document.body);
const montar = async (el: any) => { await act(async () => { root.render(el); }); await esperar(); };
const clicar = async (el: Element | null) => { expect(el, "o elemento existe").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const digitar = async (sel: string, valor: string) => {
  const campo = $<HTMLInputElement | HTMLTextAreaElement>(sel);
  expect(campo, `o campo ${sel} existe`).toBeTruthy();
  const proto = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(campo, valor);
    campo!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
};
const escolher = async (sel: string, valor: string) => {
  const campo = $<HTMLSelectElement>(sel);
  expect(campo, `o seletor ${sel} existe`).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(campo, valor);
    campo!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
};

/* ───────── fixtures ───────── */

const MODELO_EPI: ModeloDaLista = {
  id: "m-epi", nome: "Ficha de entrega de EPI", tipo: "EPI",
  texto: "{{empresa}} entrega a {{nome}} os equipamentos abaixo, em {{entregaEm}}.",
  temItens: true, exigeAssinatura: true, validadeDias: 180,
};
const MODELO_ADV: ModeloDaLista = {
  id: "m-adv", nome: "Advertência", tipo: "ADVERTENCIA",
  texto: "Fica {{nome}} advertido por {{motivo}}.",
  temItens: false, exigeAssinatura: true, validadeDias: null,
};

const EMITIDO = (extra: Partial<EmitidoDaTela> = {}): EmitidoDaTela => ({
  id: "e1", tipo: "EPI", tipoRotulo: "Ficha de entrega de EPI", titulo: "Ficha de entrega de EPI",
  criadoEm: "2026-11-17T12:00:00.000Z", criadoPor: "Ana Souza",
  assinadoEm: null, assinadoPor: null, exigeAssinatura: true,
  canceladoEm: null, cancelamentoMotivo: null, documentoId: null, itens: 1, ...extra,
});

const DOC = (extra: Partial<DocumentoLinha> = {}): DocumentoLinha => ({
  id: "d1", nome: "ASO admissional", categoria: "aso", tipo: "aso",
  origem: "MANUAL", arquivoTipo: "application/pdf", tamanho: 120_000,
  dataVencimento: null, criadoEm: "2026-10-02T12:00:00.000Z",
  criadoPorNome: "Ana Souza", temArquivo: true, ...extra,
});

/* ───────────────────────── o editor do modelo ───────────────────────── */

describe("Modelos de documento: o editor", () => {
  const abrirEditor = (item: any = null) => montar(createElement(EditorModeloDocumento, {
    item, aberto: true, onFechar: () => {}, onSalvo: () => {},
  } as any));

  it("mostra os campos que o sistema preenche e marca em VERDE os que o texto usa", async () => {
    await abrirEditor();
    expect($("[data-campo-modelo='nome']")).toBeTruthy();
    expect($("[data-campo-modelo='nome']")!.getAttribute("data-usado")).toBe("nao");

    await digitar("[data-campo-texto]", "A empresa {{empresa}} entrega a {{nome}} o material.");
    expect($("[data-campo-modelo='nome']")!.getAttribute("data-usado")).toBe("sim");
    expect($("[data-campo-modelo='empresa']")!.getAttribute("data-usado")).toBe("sim");
    expect($("[data-campo-modelo='cpf']")!.getAttribute("data-usado")).toBe("nao");
  });

  it("campo que o sistema não conhece vira aviso, com o nome do campo", async () => {
    await abrirEditor();
    expect($("[data-campos-desconhecidos]")).toBeNull();
    await digitar("[data-campo-texto]", "Visto do {{supervisor}} em {{nome}}.");
    expect(txt($("[data-campos-desconhecidos]"))).toContain("{{supervisor}}");
    expect(txt($("[data-campos-desconhecidos]"))).toContain("sem ser preenchido");
  });

  it("clicar num campo o insere no texto", async () => {
    await abrirEditor();
    await clicar($("[data-campo-modelo='cargo']"));
    expect($<HTMLTextAreaElement>("[data-campo-texto]")!.value).toContain("{{cargo}}");
  });

  it("trocar para EPI liga a lista de itens, e o campo fica travado", async () => {
    await abrirEditor({ id: "m1", nome: "Termo", tipo: "TERMO", texto: "Recebi o notebook.", temItens: false, exigeAssinatura: true, validadeDias: null, ativo: true });
    const itens = () => $<HTMLInputElement>("[data-campo-itens]")!;
    expect(itens().checked).toBe(false);
    expect(itens().disabled).toBe(false);

    await escolher("[data-campo-tipo]", "EPI");
    expect(itens().checked, "a ficha de EPI sempre tem itens").toBe(true);
    expect(itens().disabled, "e não dá para desligar").toBe(true);
  });

  it("o que as regras recusam não vai ao servidor — e a mensagem é a mesma do motor", async () => {
    await abrirEditor();
    await digitar("[data-campo-texto]", "Texto comprido o bastante para passar.");
    await clicar($("[data-salvar-modelo]"));
    expect(txt($("[data-erro]"))).toContain("nome");
    expect(chamadas).toHaveLength(0);
  });

  it("salvar manda o modelo inteiro para a rota do cadastro", async () => {
    resposta = () => ({ status: 201, dados: { id: "novo" } });
    await abrirEditor();
    await digitar("[data-campo-nome]", "Ficha de EPI");
    await digitar("[data-campo-texto]", "{{empresa}} entrega a {{nome}} os itens abaixo.");
    await digitar("[data-campo-validade]", "180");
    await clicar($("[data-salvar-modelo]"));

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toContain("/api/cadastros/modelos-documento");
    expect(chamadas[0].corpo).toMatchObject({ nome: "Ficha de EPI", tipo: "EPI", temItens: true, validadeDias: 180, exigeAssinatura: true });
  });
});

/* ───────────────────────── gerar o documento ───────────────────────── */

describe("Gerar documento: o diálogo", () => {
  const abrir = (props: Partial<Parameters<typeof GerarDocumento>[0]> = {}) => montar(createElement(GerarDocumento, {
    colaboradorId: "t1", modelos: [MODELO_EPI, MODELO_ADV], podeDisciplinar: true,
    aberto: true, onFechar: () => {}, onGerado: () => {}, ...props,
  } as any));

  it("sem a permissão de advertência, o modelo disciplinar nem aparece", async () => {
    await abrir({ podeDisciplinar: false });
    const valores = $$("[data-escolher-modelo] option").map((o) => (o as HTMLOptionElement).value);
    expect(valores).toContain("m-epi");
    expect(valores).not.toContain("m-adv");
  });

  it("com a permissão, a advertência aparece e pede os campos dela", async () => {
    await abrir();
    await escolher("[data-escolher-modelo]", "m-adv");
    expect($("[data-campo-valor='motivo']"), "o motivo é campo do tipo").toBeTruthy();
    expect($("[data-itens-documento]"), "advertência não tem lista de itens").toBeNull();
  });

  it("a ficha de EPI pede o CA antes de ir ao servidor, e diz o que fazer sem ele", async () => {
    await abrir();
    await escolher("[data-escolher-modelo]", "m-epi");
    await digitar("[data-item-descricao='0']", "Luva de vaqueta");
    await clicar($("[data-gerar]"));

    expect(txt($("[data-erro-gerar]"))).toContain("CA");
    expect(txt($("[data-erro-gerar]"))).toContain("termo de responsabilidade");
    expect(chamadas, "nada foi ao servidor").toHaveLength(0);
  });

  it("campo obrigatório do tipo em branco trava aqui, sem ida ao servidor", async () => {
    await abrir();
    await escolher("[data-escolher-modelo]", "m-adv");
    // a data do ocorrido já nasce hoje; o motivo é escrito, e sem ele não há papel
    await clicar($("[data-gerar]"));
    expect(txt($("[data-erro-gerar]"))).toContain("Preencha:");
    expect(txt($("[data-erro-gerar]"))).toContain("Motivo");
    expect(chamadas, "nada foi ao servidor").toHaveLength(0);
  });

  it("a prévia mostra o texto preenchido e marca o campo que o sistema não conhece", async () => {
    resposta = () => ({ status: 200, dados: { texto: "Clima Total entrega a Marina os itens. Visto: {{supervisor}}", desconhecidos: ["supervisor"] } });
    await abrir();
    await escolher("[data-escolher-modelo]", "m-epi");
    await digitar("[data-item-descricao='0']", "Luva");
    await digitar("[data-item-ca='0']", "12345");
    await clicar($("[data-ver-previa]"));

    expect(chamadas[0].url).toContain("/documentos-gerados/previa");
    expect(txt($("[data-previa-documento]"))).toContain("Clima Total entrega a Marina");
    expect(txt($("[data-previa-desconhecidos]"))).toContain("{{supervisor}}");
    // prévia não grava nada: o diálogo continua no passo de montar
    expect($("[data-assinar-documento]")).toBeNull();
  });

  it("gerar manda os itens limpos e abre a assinatura", async () => {
    resposta = (url) => url.includes("/previa")
      ? { status: 200, dados: { texto: "x", desconhecidos: [] } }
      : { status: 201, dados: EMITIDO() };
    await abrir();
    await escolher("[data-escolher-modelo]", "m-epi");
    await digitar("[data-item-descricao='0']", "  Luva de vaqueta  ");
    await digitar("[data-item-ca='0']", "12345");
    await digitar("[data-item-quantidade='0']", "2");
    await clicar($("[data-gerar]"));

    expect(chamadas[0].corpo.itens).toEqual([{ descricao: "Luva de vaqueta", ca: "12345", quantidade: 2, entregaEm: expect.any(String) }]);
    // o diálogo virou a assinatura
    expect($("[data-assinar-documento]")).toBeTruthy();
    expect(corpoTexto()).toContain("aguardando a assinatura");
  });

  it("sem nome e foto, o botão de assinar não deixa seguir", async () => {
    resposta = () => ({ status: 201, dados: EMITIDO() });
    await abrir();
    await escolher("[data-escolher-modelo]", "m-epi");
    await digitar("[data-item-descricao='0']", "Luva");
    await digitar("[data-item-ca='0']", "12345");
    await clicar($("[data-gerar]"));

    expect($<HTMLButtonElement>("[data-assinar-documento]")!.disabled).toBe(true);
    await digitar("[data-assinatura-nome]", "Marina Alves Pereira");
    expect($<HTMLButtonElement>("[data-assinar-documento]")!.disabled, "falta a foto").toBe(true);
  });

  it("quando a rota recusa, a mensagem aparece e o diálogo não avança", async () => {
    resposta = () => ({ status: 403, dados: { erro: "Sem permissão para esta ação" } });
    await abrir();
    await escolher("[data-escolher-modelo]", "m-adv");
    // o modelo só usa {{motivo}}: a tela não pergunta "medida", que ele não cita
    expect($("[data-campo-valor='medida']"), "campo do tipo que o modelo não usa não é perguntado").toBeNull();
    await digitar("[data-campo-valor='motivo']", "atraso reiterado");
    await clicar($("[data-gerar]"));

    expect(txt($("[data-erro-gerar]"))).toContain("Sem permissão");
    expect($("[data-assinar-documento]")).toBeNull();
  });
});

/* ───────────────────────── a seção Documentos ───────────────────────── */

describe("Seção Documentos: o papel gerado", () => {
  const props = (extra: Record<string, unknown> = {}) => ({
    colaboradorId: "t1", documentosIniciais: [DOC()], podeExcluir: true,
    podeGerar: true, podeDisciplinar: true, modelos: [MODELO_EPI], emitidosIniciais: [],
    ...extra,
  });

  it("o botão de gerar só existe com a permissão", async () => {
    await montar(createElement(DocumentosColaborador, props()));
    expect($("[data-gerar-documento]")).toBeTruthy();

    await act(async () => { root.render(null); });
    await montar(createElement(DocumentosColaborador, props({ podeGerar: false })));
    expect($("[data-gerar-documento]")).toBeNull();
    expect($("[data-anexar-documento]"), "anexar continua").toBeTruthy();
  });

  it("em somente leitura não há anexar nem gerar", async () => {
    await montar(createElement(DocumentosColaborador, props({ somenteLeitura: true })));
    expect($("[data-gerar-documento]")).toBeNull();
    expect($("[data-anexar-documento]")).toBeNull();
  });

  it("o papel aguardando assinatura aparece na MESMA lista, marcado", async () => {
    await montar(createElement(DocumentosColaborador, props({ emitidosIniciais: [EMITIDO()] })));
    const linha = $("[data-linha-pendente='e1']");
    expect(linha, "na mesma tabela, não numa lista à parte").toBeTruthy();
    expect(txt(linha)).toContain("Aguardando assinatura");
    expect(txt(linha)).toContain("Gerado por Ana Souza");
  });

  it("papel CANCELADO não volta a aparecer como aguardando assinatura", async () => {
    const cancelado = EMITIDO({ id: "e3", canceladoEm: "2026-11-17T13:00:00.000Z", cancelamentoMotivo: "trocado" });
    await montar(createElement(DocumentosColaborador, props({ emitidosIniciais: [cancelado] })));
    expect($("[data-linha-pendente='e3']"), "cancelado some da lista de pendentes").toBeNull();
    expect(corpoTexto()).not.toContain("Aguardando assinatura");
  });

  it("o pendente oferece baixar a prévia, assinar e cancelar", async () => {
    await montar(createElement(DocumentosColaborador, props({ emitidosIniciais: [EMITIDO()] })));
    await clicar($("[data-linha-pendente='e1'] [data-acao='menu']"));
    expect($("[data-item='baixar']")!.getAttribute("href")).toBe("/api/documentos-gerados/e1/pdf");
    expect($("[data-item='assinar']")).toBeTruthy();
    expect($("[data-item='cancelar-documento']")).toBeTruthy();
  });

  it("a linha do papel JÁ assinado troca excluir por cancelar", async () => {
    const assinado = EMITIDO({ id: "e2", assinadoEm: "2026-11-17T12:00:00.000Z", assinadoPor: "Marina", documentoId: "d9" });
    const anexo = DOC({ id: "d9", nome: "Ficha de entrega de EPI - Marina", origem: "GERADO", categoria: "ficha_epi" });
    await montar(createElement(DocumentosColaborador, props({ documentosIniciais: [anexo], emitidosIniciais: [assinado] })));

    await clicar($("[data-documento='d9'] [data-acao='menu']"));
    expect($("[data-item='cancelar-documento']"), "cancelar o papel").toBeTruthy();
    expect($("[data-item='excluir']"), "excluir some: o caminho é cancelar").toBeNull();
    expect($("[data-item='baixar']")!.getAttribute("href")).toBe("/api/tecnicos/t1/documentos/d9");
  });

  it("cancelar pede o motivo e só então chama a rota", async () => {
    const assinado = EMITIDO({ id: "e2", documentoId: "d9", assinadoEm: "2026-11-17T12:00:00.000Z" });
    const anexo = DOC({ id: "d9", origem: "GERADO" });
    resposta = () => ({ status: 200, dados: { ...assinado, canceladoEm: "2026-11-17T13:00:00.000Z", cancelamentoMotivo: "trocado no mesmo dia" } });
    await montar(createElement(DocumentosColaborador, props({ documentosIniciais: [anexo], emitidosIniciais: [assinado] })));

    await clicar($("[data-documento='d9'] [data-acao='menu']"));
    await clicar($("[data-item='cancelar-documento']"));
    expect($("[data-cancelar-documento]"), "o diálogo do motivo").toBeTruthy();

    await clicar($("[data-confirmar-cancelamento]"));
    expect(txt($("[data-erro-cancelar]")), "sem motivo não vai").toContain("por que");
    expect(chamadas).toHaveLength(0);

    await digitar("[data-motivo-cancelamento]", "trocado no mesmo dia");
    await clicar($("[data-confirmar-cancelamento]"));
    expect(chamadas[0].url).toContain("/api/documentos-gerados/e2/cancelar");
    expect(chamadas[0].corpo).toEqual({ motivo: "trocado no mesmo dia" });
    // o anexo sai da lista da tela, como saiu da ficha
    expect($("[data-documento='d9']")).toBeNull();
  });

  it("quando a rota recusa o cancelamento, a linha continua lá", async () => {
    const assinado = EMITIDO({ id: "e2", documentoId: "d9" });
    const anexo = DOC({ id: "d9", origem: "GERADO" });
    resposta = () => ({ status: 409, dados: { erro: "Este documento foi cancelado." } });
    await montar(createElement(DocumentosColaborador, props({ documentosIniciais: [anexo], emitidosIniciais: [assinado] })));

    await clicar($("[data-documento='d9'] [data-acao='menu']"));
    await clicar($("[data-item='cancelar-documento']"));
    await digitar("[data-motivo-cancelamento]", "qualquer coisa");
    await clicar($("[data-confirmar-cancelamento]"));

    expect(txt($("[data-erro-cancelar]"))).toContain("cancelado");
    expect($("[data-documento='d9']"), "a tela não muda quando a rota recusa").toBeTruthy();
  });
});

/* ───────────────────────── a captura de foto (compartilhada com a admissão) ───────────────────────── */

describe("Captura de foto", () => {
  /** Põe um arquivo no input escondido e dispara o change, como o seletor do aparelho faria. */
  async function escolherArquivo(bytes: number, tipo = "image/png") {
    const entrada = $<HTMLInputElement>("input[type=file]")!;
    const arquivo = new File([new Uint8Array(bytes)], "foto.png", { type: tipo });
    Object.defineProperty(entrada, "files", { value: [arquivo], configurable: true });
    await act(async () => { entrada.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
  }

  it("foto acima do teto é recusada, com a mensagem — e nada é guardado", async () => {
    const guardadas: (string | null)[] = [];
    const erros: string[] = [];
    await montar(createElement(CapturaFoto, {
      valor: null, onValor: (v: string | null) => guardadas.push(v), onErro: (m: string) => erros.push(m),
    } as any));

    await escolherArquivo(TAMANHO_MAX_FOTO + 1);
    expect(erros[0]).toContain("MB");
    expect(guardadas, "nenhuma foto entrou").toHaveLength(0);
  });

  it("o X descarta a foto tirada", async () => {
    const guardadas: (string | null)[] = [];
    await montar(createElement(CapturaFoto, {
      valor: "data:image/png;base64,iVBORw0KGgo=", onValor: (v: string | null) => guardadas.push(v),
    } as any));

    expect($("[data-selfie]"), "a foto aparece").toBeTruthy();
    await clicar($("[data-tirar-selfie]"));
    expect(guardadas).toEqual([null]);
  });
});
