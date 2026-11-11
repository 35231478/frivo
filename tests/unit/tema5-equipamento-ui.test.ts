// @vitest-environment happy-dom
/**
 * Tema 5 nas telas:
 *  (A) a galeria do cadastro de equipamento reduz a foto NA HORA da escolha (1280 px, qualidade 0,8)
 *      — o original do celular (3–8 MB) nunca vai para o formulário;
 *  (C) o aviso de nº de série duplicado: espera a pessoa parar de digitar, só avisa (não bloqueia),
 *      ignora o próprio equipamento na edição — e agora aparece também no cadastro rápido da OS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => "/equipamentos/novo", useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));

const reducoes = vi.hoisted(() => ({ chamadas: [] as { nome: string; bytes: number; ladoMax: number; qualidade: number }[], falhar: "" }));
vi.mock("@/lib/imagem-cliente", async (original) => ({
  ...(await original<typeof import("@/lib/imagem-cliente")>()),
  reduzirImagem: vi.fn(async (file: File, ladoMax: number, qualidade: number) => {
    reducoes.chamadas.push({ nome: file.name, bytes: file.size, ladoMax, qualidade });
    if (file.name === reducoes.falhar) throw new Error("arquivo corrompido");
    return { imagem: { dataUrl: `data:image/jpeg;base64,REDUZIDA-${file.name}`, largura: 1280, altura: 960, bytes: 200_000 }, qualidade: { escura: false, borrada: false, nitidez: 1, brilho: 1 } };
  }),
}));

let root: Root; let caixa: HTMLDivElement;
let buscas: string[]; let duplicados: unknown[]; let statusSerie: number;
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });
beforeEach(() => {
  buscas = []; duplicados = []; statusSerie = 200; reducoes.chamadas = []; reducoes.falhar = "";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/equipamentos/serie")) {
      buscas.push(String(url));
      return new Response(JSON.stringify(statusSerie === 200 ? { duplicados } : { erro: "x" }), { status: statusSerie, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }));
});
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const esperar = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const digitar = async (el: Element | null, v: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
};
async function montar(el: any) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
const DUP = { id: "eq1", descricao: "Split Hi-Wall — 12.000 BTU/h", fabricanteModelo: "LG S4-W12", local: "Hospital Santa Clara › Matriz › Recepção", ativo: true };

/* ───────── (A) foto comprimida na galeria ───────── */
describe("galeria de fotos do equipamento", () => {
  const arquivo = (nome: string, bytes: number, tipo = "image/jpeg") => new File([new Uint8Array(bytes)], nome, { type: tipo });
  async function escolher(fotos: string[], arquivos: File[]) {
    const onChange = vi.fn();
    const { GaleriaImagens } = await import("@/components/ui/galeria-imagens");
    await montar(createElement(GaleriaImagens, { fotos, onChange }));
    const input = $<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: arquivos });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    return onChange;
  }

  it("a foto do celular (6 MB) é reduzida ao escolher — 1280 px, qualidade 0,8 — e o que vai para o formulário é a reduzida", async () => {
    const onChange = await escolher([], [arquivo("etiqueta.jpg", 6_000_000)]);
    expect(reducoes.chamadas).toEqual([{ nome: "etiqueta.jpg", bytes: 6_000_000, ladoMax: 1280, qualidade: 0.8 }]);
    expect(onChange).toHaveBeenCalledWith(["data:image/jpeg;base64,REDUZIDA-etiqueta.jpg"]);
  });

  it("várias de uma vez: todas reduzidas; arquivo que não é JPG/PNG/WEBP nem é lido, com aviso", async () => {
    const onChange = await escolher(["data:image/jpeg;base64,JA"], [arquivo("a.jpg", 4_000_000), arquivo("manual.pdf", 9_000_000, "application/pdf"), arquivo("b.png", 5_000_000, "image/png")]);
    expect(reducoes.chamadas.map((c) => c.nome)).toEqual(["a.jpg", "b.png"]);
    expect(onChange).toHaveBeenCalledWith(["data:image/jpeg;base64,JA", "data:image/jpeg;base64,REDUZIDA-a.jpg", "data:image/jpeg;base64,REDUZIDA-b.png"]);
    expect(document.body.textContent).toContain("Apenas JPG, PNG ou WEBP são aceitos.");
  });

  it("no máximo 5 fotos: o que passa do limite não é lido", async () => {
    const quatro = ["1", "2", "3", "4"].map((n) => `data:image/jpeg;base64,${n}`);
    const onChange = await escolher(quatro, [arquivo("c.jpg", 3_000_000), arquivo("d.jpg", 3_000_000)]);
    expect(reducoes.chamadas.map((c) => c.nome)).toEqual(["c.jpg"]);
    expect(onChange.mock.calls[0][0]).toHaveLength(5);
  });

  it("foto que não dá para ler não trava as outras: entra a boa e a pessoa é avisada", async () => {
    reducoes.falhar = "ruim.jpg";
    const onChange = await escolher([], [arquivo("ruim.jpg", 2_000_000), arquivo("boa.jpg", 2_000_000)]);
    expect(onChange).toHaveBeenCalledWith(["data:image/jpeg;base64,REDUZIDA-boa.jpg"]);
    expect(document.body.textContent).toContain("Não foi possível ler uma das imagens. Tente outra foto.");
  });
});

/* ───────── (C) aviso de nº de série duplicado ───────── */
describe("aviso de nº de série duplicado", () => {
  async function montarAviso(numero: string, ignorarId?: string) {
    const { AvisoSerieDuplicada } = await import("@/components/equipamentos/aviso-serie-duplicada");
    await montar(createElement(AvisoSerieDuplicada, { numero, ignorarId }));
  }

  it("série que já existe: avisa qual equipamento e onde está, com link para conferir — e diz que dá para salvar", async () => {
    duplicados = [DUP];
    await montarAviso("ABC123XYZ");
    expect($("[data-aviso-serie]")).toBeNull(); // espera a pessoa parar de digitar
    await esperar(480);
    const aviso = $("[data-aviso-serie]")!;
    expect(aviso.textContent).toContain("Este nº de série já está cadastrado. Confira se não é a mesma etiqueta.");
    expect(aviso.textContent).toContain("Split Hi-Wall — 12.000 BTU/h · LG S4-W12 — Hospital Santa Clara › Matriz › Recepção");
    expect(aviso.querySelector("a")!.getAttribute("href")).toBe("/equipamentos/eq1");
    expect(aviso.querySelector("a")!.getAttribute("target")).toBe("_blank"); // não perde o que já foi digitado
    expect(aviso.textContent).toContain("Apenas um aviso: é possível salvar assim mesmo.");
  });

  it("mais de um com a mesma série: diz quantos e marca o que está inativo", async () => {
    duplicados = [DUP, { ...DUP, id: "eq2", local: "", ativo: false }];
    await montarAviso("ABC123XYZ");
    await esperar(480);
    expect($("[data-aviso-serie]")!.textContent).toContain("já está cadastrado em 2 equipamentos");
    expect($$("[data-aviso-serie] li")[1].textContent).toContain("(inativo)");
  });

  it("consulta sem os espaços das pontas; na edição manda o próprio equipamento para ser ignorado", async () => {
    await montarAviso("  abc123  ", "eq9");
    await esperar(480);
    expect(buscas).toEqual(["/api/equipamentos/serie?numero=abc123&ignorar=eq9"]);
    expect($("[data-aviso-serie]")).toBeNull(); // série inédita: nada na tela
  });

  it("menos de 3 caracteres não consulta; servidor fora do ar não mostra erro nem aviso (nunca atrapalha o cadastro)", async () => {
    await montarAviso("AB");
    await esperar(480);
    expect(buscas).toEqual([]);
    act(() => root.unmount()); caixa.remove();
    statusSerie = 500;
    await montarAviso("ABC123XYZ");
    await esperar(480);
    expect(buscas).toHaveLength(1);
    expect($("[data-aviso-serie]")).toBeNull();
  });
});

/* ───────── (C) o mesmo aviso no cadastro rápido de equipamento (dentro da OS) ───────── */
describe("cadastro rápido de equipamento", () => {
  async function abrirRapido(criar = vi.fn(async () => ({ value: "novo", label: "Novo" }))) {
    const { CadastroRapidoModal } = await import("@/components/ui/select-cadastro-rapido");
    const { EQUIPAMENTO } = await import("@/components/cadastro-rapido/definicoes");
    const onCriado = vi.fn();
    await montar(createElement(CadastroRapidoModal, { aberto: true, onFechar() {}, titulo: "Novo equipamento", campos: EQUIPAMENTO.campos(), criar, onCriado }));
    const campo = (rotulo: string) => $$("label").find((l) => l.textContent!.startsWith(rotulo))!.querySelector("input, select")!;
    return { criar, onCriado, campo };
  }

  it("ao digitar uma série que já existe, o aviso aparece — e o Salvar continua liberado", async () => {
    duplicados = [DUP];
    const { campo } = await abrirRapido();
    expect($("[data-aviso-serie]")).toBeNull();
    await digitar(campo("Nº de série"), "ABC123XYZ");
    await esperar(480);
    expect(buscas).toEqual(["/api/equipamentos/serie?numero=ABC123XYZ"]);
    expect($("[data-aviso-serie]")!.textContent).toContain("Este nº de série já está cadastrado");
    const salvar = $$("button").find((b) => /Salvar/.test(b.textContent ?? ""))!;
    expect((salvar as HTMLButtonElement).disabled).toBe(false);
  });

  it("os outros campos do cadastro rápido não consultam nada", async () => {
    const { campo } = await abrirRapido();
    await digitar(campo("Marca"), "Carrier");
    await digitar(campo("Modelo"), "ABC123XYZ");
    await esperar(480);
    expect(buscas).toEqual([]);
  });

  it("a série vai para o servidor sem espaços nas pontas", async () => {
    const postado: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") postado.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: "eqN", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "X" }), { status: 201, headers: { "content-type": "application/json" } });
    }));
    const { EQUIPAMENTO } = await import("@/components/cadastro-rapido/definicoes");
    await EQUIPAMENTO.criar("un1", { tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "X", numeroSerie: "  ABC123XYZ " });
    await EQUIPAMENTO.criar("un1", { tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "X", numeroSerie: "   " });
    expect(postado[0].url).toBe("/api/equipamentos");
    expect(postado[0].corpo.numeroSerie).toBe("ABC123XYZ");
    expect("numeroSerie" in postado[1].corpo).toBe(false);
  });
});
