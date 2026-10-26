// @vitest-environment happy-dom
/**
 * "Fotos & Anexos do serviço" (aba Relatórios & Anexos da OS) num DOM de verdade (happy-dom), API simulada:
 *  - uma seção por equipamento da OS + "Geral da OS", com as fotos de TODAS as origens (execução,
 *    serviço adicional, enviadas), legenda, atividade e quem/quando; documentos à parte;
 *  - lightbox: abre na foto, passa com as setas, baixa, fecha no Esc;
 *  - foto nova exige a foto, a referência e a legenda (sem isso nem chama o servidor); comprime no
 *    navegador; entra na seção certa com toast;
 *  - excluir: confirmação da casa, rota certa por origem, foto de atividade concluída travada;
 *  - sem permissão de editar: só olha.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, permissoesVazias } from "@/lib/permissoes";
import type { Galeria } from "@/lib/os/galeria";

const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async () => true) }));
vi.mock("@/components/ui/avisos", () => ({ toast: avisos.toast, confirmar: avisos.confirmar }));
vi.mock("@/lib/imagem-cliente", async (original) => ({
  ...(await original<typeof import("@/lib/imagem-cliente")>()),
  FOTO_GALERIA: { ladoMax: 1280, qualidade: 0.8 },
  reduzirImagem: vi.fn(async () => ({ imagem: { dataUrl: "data:image/jpeg;base64,/9j/RkFLRQ==", largura: 10, altura: 10, bytes: 9 }, qualidade: {} })),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([import("@/components/os/os-fotos-anexos"), import("@/components/providers/permissoes-provider")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0;
  avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: { ok: true } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

const foto = (chave: string, extra: Record<string, unknown>) => {
  const [origem, id] = chave.split(":");
  return {
    chave, origem, id, src: `/img/${id}`, baixar: `/baixar/${id}`, legenda: "Foto", equipamentoId: null, atividade: null, item: null, momento: null,
    enviadoPor: "Ana Souza", enviadoEm: "2026-10-20T13:00:00.000Z", ...extra,
  };
};
const GALERIA = (): Galeria => ({
  equipamentos: [{ id: "eqA", titulo: "Split Recepção", detalhe: "Daikin FTXS · TAG AC-01" }, { id: "eqB", titulo: "Split Sala 2", detalhe: null }],
  fotos: [
    foto("EXECUCAO:f2", { legenda: "Checklist: Limpeza dos filtros", equipamentoId: "eqA", item: "Limpeza dos filtros", atividade: { id: "a2", titulo: "Visita anterior", aberta: false }, enviadoPor: "João Silva", enviadoEm: "2026-10-21T10:00:00.000Z" }),
    foto("EXECUCAO:f1", { legenda: "Antes do serviço", equipamentoId: "eqA", momento: "ANTES", atividade: { id: "a1", titulo: "Preventiva mensal", aberta: true }, enviadoPor: "João Silva" }),
    foto("ANEXO:an1", { legenda: "Fachada do prédio", enviadoEm: "2026-10-22T10:00:00.000Z" }),
    foto("ANEXO:an0", { legenda: "Foto enviada (sem legenda)", semReferencia: true, enviadoPor: null, enviadoEm: "2026-10-01T10:00:00.000Z" }),
  ] as Galeria["fotos"],
  documentos: [{ id: "d1", nome: "laudo-art.pdf", tipo: "application/pdf", tamanho: 2048, legenda: null, enviadoPor: "Ana Souza", enviadoEm: "2026-10-22T10:00:00.000Z", src: "/doc/d1?inline=1", baixar: "/doc/d1" }],
});

async function montar(galeria = GALERIA(), permissoes = permissoesTotais(), onMudou = vi.fn()) {
  const [{ PermissoesProvider }, { OsFotosAnexos }] = await Promise.all([import("@/components/providers/permissoes-provider"), import("@/components/os/os-fotos-anexos")]);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(OsFotosAnexos, { osId: "os1", galeria, onMudou }) })); });
  await esperar();
  return onMudou;
}
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string, base: ParentNode = document) => base.querySelector(sel) as T | null;
const $$ = (sel: string, base: ParentNode = document) => [...base.querySelectorAll(sel)];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const secao = (chave: string) => $(`[data-secao-fotos="${chave}"]`)!;
const fotosDa = (chave: string) => $$("[data-foto]", secao(chave)).map((f) => f.getAttribute("data-foto"));
async function tecla(key: string) { await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); }); await esperar(); }
async function digitar(el: Element | null, v: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function anexar(input: Element | null, arquivo: File) {
  expect(input).not.toBeNull();
  await act(async () => {
    Object.defineProperty(input, "files", { value: [arquivo], configurable: true });
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar(); await esperar();
}

describe("galeria por equipamento", () => {
  it("uma seção por equipamento da OS (inclusive o sem foto) + Geral da OS por último; fotos da mais antiga para a mais nova", async () => {
    await montar();
    expect($$("[data-secao-fotos]").map((s) => s.getAttribute("data-secao-fotos"))).toEqual(["eqA", "eqB", "GERAL"]);
    expect(txt($("h4", secao("eqA")))).toBe("Split Recepção");
    expect(txt(secao("eqA"))).toContain("Daikin FTXS · TAG AC-01");
    expect(fotosDa("eqA")).toEqual(["EXECUCAO:f1", "EXECUCAO:f2"]);
    expect(fotosDa("eqB")).toEqual([]);
    expect(txt($("[data-secao-vazia]", secao("eqB")))).toBe("Nenhuma foto deste equipamento ainda.");
    expect(fotosDa("GERAL")).toEqual(["ANEXO:an0", "ANEXO:an1"]);
    expect(txt($("[data-resumo-fotos]"))).toBe("4 fotos em 1 equipamento · 1 documento");
  });

  it("cada foto: miniatura, legenda, de onde veio, atividade e quem/quando", async () => {
    await montar();
    const f2 = $('[data-foto="EXECUCAO:f2"]')!;
    expect(txt($("[data-legenda]", f2))).toBe("Checklist: Limpeza dos filtros");
    expect(txt(f2)).toContain("Execução");
    expect(txt(f2)).toContain("Visita anterior");
    expect(txt(f2)).toContain("João Silva · 21/10/2026 às 07:00"); // horário de Brasília
    expect($("img", f2)!.getAttribute("src")).toBe("/img/f2");
    expect(txt($('[data-foto="ANEXO:an0"]'))).toContain("Sem referência");
    expect(txt($('[data-foto="ANEXO:an0"]'))).toContain("Autor não registrado");
    expect(txt($('[data-foto="ANEXO:an1"]'))).toContain("Escritório");
  });

  it("documentos ficam à parte, com ver/baixar/excluir", async () => {
    await montar();
    const d = $('[data-documento="d1"]')!;
    expect(txt(d)).toContain("laudo-art.pdf");
    expect(txt(d)).toContain("2 KB");
    expect($('a[aria-label="Baixar laudo-art.pdf"]', d)!.getAttribute("href")).toBe("/doc/d1");
    expect($('a[aria-label="Ver laudo-art.pdf"]', d)!.getAttribute("href")).toBe("/doc/d1?inline=1");
  });

  it("estado vazio: sem fotos nem documentos explica de onde as fotos vêm", async () => {
    await montar({ equipamentos: [], fotos: [], documentos: [] });
    expect(txt($("[data-resumo-fotos]"))).toContain("As da execução (checklist, antes e depois) aparecem aqui sozinhas");
    expect($$("[data-secao-fotos]").map((s) => s.getAttribute("data-secao-fotos"))).toEqual(["GERAL"]);
    expect($("[data-documentos-vazio]")).not.toBeNull();
  });
});

describe("lightbox", () => {
  it("abre na foto clicada, passa com as setas (dentro do equipamento), baixa e fecha no Esc", async () => {
    await montar();
    await clicar($('[data-foto="EXECUCAO:f1"] button[aria-label^="Ampliar"]'));
    const lb = () => $("[data-lightbox]");
    expect(lb()!.getAttribute("role")).toBe("dialog");
    expect(txt($("[data-lightbox-legenda]"))).toBe("Antes do serviço");
    expect(txt(lb())).toContain("Split Recepção");
    expect(txt(lb())).toContain("Atividade: Preventiva mensal");
    expect(txt(lb())).toContain("1 de 2");
    const baixar = $<HTMLAnchorElement>("[data-lightbox-baixar]")!;
    expect(baixar.getAttribute("href")).toBe("/baixar/f1");
    expect(baixar.getAttribute("download")).toMatch(/^antes-do-servico-.+\.jpg$/);
    await tecla("ArrowRight");
    expect(txt($("[data-lightbox-legenda]"))).toBe("Checklist: Limpeza dos filtros");
    await tecla("ArrowRight"); // volta ao começo
    expect(txt($("[data-lightbox-legenda]"))).toBe("Antes do serviço");
    await clicar($('[data-lightbox] button[aria-label="Foto anterior"]'));
    expect(txt($("[data-lightbox-legenda]"))).toBe("Checklist: Limpeza dos filtros");
    await tecla("Escape");
    expect(lb()).toBeNull();
  });
});

describe("excluir", () => {
  it("foto da execução: confirma, chama a rota da origem, some e avisa; anexo vai pela rota do anexo", async () => {
    const onMudou = await montar();
    await clicar($('[data-foto="EXECUCAO:f1"] [data-excluir-foto]'));
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({ perigo: true, titulo: "Excluir foto?" }));
    expect(chamadas.map((c) => `${c.metodo} ${c.url}`)).toEqual(["DELETE /api/ordens/os1/fotos/f1?origem=EXECUCAO"]);
    expect(fotosDa("eqA")).toEqual(["EXECUCAO:f2"]);
    expect(avisos.toast).toHaveBeenCalledWith("Foto excluída.");
    expect(onMudou).toHaveBeenLastCalledWith(expect.objectContaining({ fotos: expect.not.arrayContaining([expect.objectContaining({ chave: "EXECUCAO:f1" })]) }));

    await clicar($('[data-foto="ANEXO:an1"] [data-excluir-foto]'));
    expect(chamadas.at(-1)).toMatchObject({ metodo: "DELETE", url: "/api/ordens/os1/anexos/an1" });
    expect(fotosDa("GERAL")).toEqual(["ANEXO:an0"]);
  });

  it("foto de atividade concluída: botão travado dizendo por quê; cancelar a confirmação não exclui; erro do servidor mantém a foto", async () => {
    await montar();
    const travado = $<HTMLButtonElement>('[data-foto="EXECUCAO:f2"] [data-excluir-foto]')!;
    expect(travado.disabled).toBe(true);
    expect(travado.getAttribute("aria-label")).toContain("Atividade concluída: reabra a atividade");

    avisos.confirmar.mockImplementationOnce(async () => false);
    await clicar($('[data-foto="EXECUCAO:f1"] [data-excluir-foto]'));
    expect(chamadas).toEqual([]);

    respostas["DELETE /api/ordens/os1/fotos/f1?origem=EXECUCAO"] = { status: 409, corpo: { erro: "Atividade concluída: reabra a atividade para alterar a execução." } };
    await clicar($('[data-foto="EXECUCAO:f1"] [data-excluir-foto]'));
    expect(fotosDa("eqA")).toEqual(["EXECUCAO:f1", "EXECUCAO:f2"]);
    expect(avisos.toast).toHaveBeenCalledWith("Atividade concluída: reabra a atividade para alterar a execução.", "erro");
  });

  it("documento: confirma e exclui", async () => {
    await montar();
    await clicar($('button[aria-label="Excluir laudo-art.pdf"]'));
    expect(chamadas.at(-1)).toMatchObject({ metodo: "DELETE", url: "/api/ordens/os1/anexos/d1" });
    expect($('[data-documento="d1"]')).toBeNull();
    expect($("[data-documentos-vazio]")).not.toBeNull();
  });
});

describe("adicionar foto", () => {
  it("exige foto, referência e legenda (sem isso não chama o servidor); aberto pela seção, já vem com o equipamento", async () => {
    await montar();
    await clicar($("[data-adicionar-foto]"));
    const modal = $("[data-modal-foto]")!;
    expect($<HTMLSelectElement>("[data-referencia-foto]", modal)!.value).toBe("");
    // opções: equipamentos da OS + Geral
    expect([...$<HTMLSelectElement>("[data-referencia-foto]", modal)!.options].map((o) => o.value)).toEqual(["", "eqA", "eqB", "GERAL"]);
    await clicar($("[data-enviar-foto]", modal));
    expect(txt($("[data-erro-foto]"))).toContain("Escolha a foto.");
    expect(txt($("[data-erro-foto]"))).toContain("Escolha a que a foto se refere");
    expect(txt($("[data-erro-foto]"))).toContain("Escreva uma legenda");
    expect($("[data-erro-foto]")!.getAttribute("role")).toBe("alert");
    expect(chamadas).toEqual([]);
    await clicar($('button[aria-label="Fechar"]'));

    await clicar($("[data-adicionar-foto-secao]", secao("eqB")));
    expect($<HTMLSelectElement>("[data-referencia-foto]")!.value).toBe("eqB");
  });

  it("comprime no navegador, envia com a referência e a legenda e a foto entra na seção certa com toast", async () => {
    const onMudou = await montar();
    respostas["POST /api/ordens/os1/anexos"] = { status: 201, corpo: { tipo: "foto", foto: foto("ANEXO:novo", { legenda: "Placa da condensadora", equipamentoId: "eqB", enviadoEm: "2026-10-26T12:00:00.000Z" }) } };
    await clicar($("[data-adicionar-foto-secao]", secao("eqB")));
    await anexar($("[data-input-foto]"), new File([new Uint8Array([0xff, 0xd8, 0xff])], "IMG_9999.jpg", { type: "image/jpeg" }));
    const { reduzirImagem } = await import("@/lib/imagem-cliente");
    expect(vi.mocked(reduzirImagem).mock.calls.map((c) => [(c[0] as File).name, c[1], c[2]])).toEqual([["IMG_9999.jpg", 1280, 0.8]]);
    expect($("[data-previa-foto]")!.getAttribute("src")).toBe("data:image/jpeg;base64,/9j/RkFLRQ==");
    await digitar($("[data-legenda-foto]"), "Placa da condensadora");
    await clicar($("[data-enviar-foto]"));

    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.url).toBe("/api/ordens/os1/anexos");
    const fd = post.corpo as FormData;
    expect(fd.get("referencia")).toBe("eqB");
    expect(fd.get("legenda")).toBe("Placa da condensadora");
    const arquivo = fd.get("arquivo") as File;
    expect(arquivo.type).toBe("image/jpeg");
    expect(arquivo.name).toMatch(/^placa-da-condensadora-.+\.jpg$/);
    expect(new Uint8Array(await arquivo.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode("FAKE")]));

    expect($("[data-modal-foto]")).toBeNull();
    expect(fotosDa("eqB")).toEqual(["ANEXO:novo"]);
    expect(avisos.toast).toHaveBeenCalledWith("Foto adicionada em “Split Sala 2”.");
    expect(onMudou).toHaveBeenCalled();
  });

  it("documento: o servidor recusa → toast de erro; aceita → entra em Documentos", async () => {
    await montar();
    respostas["POST /api/ordens/os1/anexos"] = { status: 400, corpo: { erro: "Tipo de arquivo não permitido." } };
    await anexar($('input[aria-label="Arquivo do documento"]'), new File(["x"], "virus.exe", { type: "application/octet-stream" }));
    expect(avisos.toast).toHaveBeenCalledWith("Tipo de arquivo não permitido.", "erro");
    respostas["POST /api/ordens/os1/anexos"] = { status: 201, corpo: { tipo: "documento", documento: { id: "d2", nome: "orcamento.xlsx", tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", tamanho: 4096, legenda: null, enviadoPor: "Ana Souza", enviadoEm: "2026-10-26T12:00:00.000Z", src: "/doc/d2?inline=1", baixar: "/doc/d2" } } };
    await anexar($('input[aria-label="Arquivo do documento"]'), new File(["x"], "orcamento.xlsx"));
    expect($$("[data-documento]").map((d) => d.getAttribute("data-documento"))).toEqual(["d2", "d1"]);
    expect(avisos.toast).toHaveBeenCalledWith("Documento “orcamento.xlsx” adicionado.");
  });
});

describe("permissão", () => {
  it("sem editar a OS: vê tudo, sem adicionar nem excluir", async () => {
    const p = permissoesVazias() as any;
    p.ordens = { ...p.ordens, visualizar: true };
    await montar(GALERIA(), p);
    expect($$("[data-foto]")).toHaveLength(4);
    expect($("[data-adicionar-foto]")).toBeNull();
    expect($("[data-adicionar-documento]")).toBeNull();
    expect($("[data-adicionar-foto-secao]")).toBeNull();
    expect($("[data-excluir-foto]")).toBeNull();
    expect($('button[aria-label="Excluir laudo-art.pdf"]')).toBeNull();
  });
});
