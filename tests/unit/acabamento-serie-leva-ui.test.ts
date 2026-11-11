// @vitest-environment happy-dom
/**
 * Acabamento do Tema 5 — nº de série repetido DENTRO da mesma leva do cadastro por foto.
 * A leva é a sequência de "Cadastrar outro" (mesmo cliente e endereço). Se a mesma etiqueta é
 * fotografada duas vezes, o aviso aparece na hora — conferido no aparelho, sem depender do
 * servidor — e continua sendo SÓ aviso: salvar segue liberado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";
import { mesmaSerie } from "@/components/equipamentos/aviso-serie-duplicada";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => "/equipamentos/novo/foto", useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));
vi.mock("@/lib/imagem-cliente", async (original) => ({
  ...(await original<typeof import("@/lib/imagem-cliente")>()),
  reduzirImagem: vi.fn(async (file: File) => ({ imagem: { dataUrl: `data:image/jpeg;base64,${file.name}`, largura: 1, altura: 1, bytes: 10 }, qualidade: { escura: false, borrada: false, nitidez: 1, brilho: 1 } })),
}));
// O cliente é escolhido num toque (a busca de clientes não é o que este teste prova)
vi.mock("@/components/ui/cliente-combobox", () => ({
  ClienteCombobox: ({ onChange }: { onChange: (id: string) => void }) => createElement("button", { type: "button", "data-escolher-cliente": "", onClick: () => onChange("c1") }, "Hospital"),
}));

let root: Root; let caixa: HTMLDivElement;
let serieLida: string; let duplicadosServidor: unknown[]; let salvos: any[]; let consultas: string[];
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });
beforeEach(() => {
  serieLida = "LG24K8891X"; duplicadosServidor = []; salvos = []; consultas = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
    const u = String(url);
    if (u.startsWith("/api/equipamentos/ocr")) return json({ legivel: true, duvidosos: [], campos: {
      tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4-W12JA3AA", capacidade_valor: "12000", capacidade_unidade: "BTU/h", tensao: "220V", fluido: "R410A",
      numero_serie: serieLida, fase: "Monofásico", tag_patrimonio: "TAG-1", ano_fabricacao: "2024", potencia_kw: "1,1", corrente_nominal_a: "5,2",
    } });
    if (u.startsWith("/api/equipamentos/serie")) { consultas.push(u); return json({ duplicados: duplicadosServidor }); }
    if (u === "/api/equipamentos" && init.method === "POST") { const corpo = JSON.parse(String(init.body)); salvos.push(corpo); return json({ id: `eq${salvos.length}`, qrcode: { codigo: `QR-${salvos.length}` } }, 201); }
    if (u.startsWith("/api/unidades")) return json([{ id: "un1", nome: "Matriz", clienteId: "c1" }]);
    return json([]);
  }));
});
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const esperar = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const botao = (texto: RegExp) => [...document.body.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement;
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function escolherFoto(rotulo: string, nome: string) {
  const input = $<HTMLInputElement>(`input[aria-label="${rotulo} (arquivo)"]`)!;
  expect(input).toBeTruthy();
  Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array(8)], nome, { type: "image/jpeg" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montar() {
  const { CadastroPorFoto } = await import("@/components/equipamentos/cadastro-por-foto");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children: createElement(CadastroPorFoto) })); });
  await esperar();
}
/** Fotografa etiqueta + equipamento e manda ler: para na conferência */
async function fotografarELer() {
  await escolherFoto("Foto da etiqueta", "etiqueta.jpg");
  await escolherFoto("Foto do equipamento", "frente.jpg");
  await clicar(botao(/Ler etiqueta com IA/));
  expect($("[data-conferencia]")).toBeTruthy();
}
/** Da conferência até a revisão (na 1ª vez escolhe o cliente; nas seguintes o local da leva já está lá) */
async function ateRevisao() {
  await clicar(botao(/Conferi, continuar/));
  if (!salvos.length) await clicar($("[data-escolher-cliente]"));
  await clicar(botao(/^Continuar/));
  expect($("[data-revisao]")).toBeTruthy();
}
const salvar = async () => { await clicar(botao(/Salvar e gerar QR Code/)); expect($("[data-pronto]")).toBeTruthy(); };

describe("mesma etiqueta (regra)", () => {
  it("ignora maiúsculas e espaços nas pontas; série curta demais ou vazia nunca é 'a mesma'", () => {
    expect(mesmaSerie(" lg24k8891x ", "LG24K8891X")).toBe(true);
    expect(mesmaSerie("LG24K8891X", "LG24K8891Y")).toBe(false);
    expect(mesmaSerie("AB", "ab")).toBe(false);
    expect(mesmaSerie("", "")).toBe(false);
    expect(mesmaSerie(null, undefined)).toBe(false);
  });
});

describe("cadastro por foto: série repetida na mesma leva", () => {
  it("1º equipamento da leva: nenhum aviso; salva normalmente", async () => {
    await montar();
    await fotografarELer();
    await esperar(480);
    expect($("[data-aviso-serie]")).toBeNull();
    await ateRevisao(); await esperar(480);
    expect($("[data-aviso-serie]")).toBeNull();
    await salvar();
    expect(salvos[0].numeroSerie).toBe("LG24K8891X");
  });

  it("a mesma etiqueta fotografada de novo: avisa NA HORA, logo depois da leitura — mesmo sem resposta do servidor", async () => {
    await montar();
    await fotografarELer(); await ateRevisao(); await salvar();
    await clicar(botao(/Cadastrar outro/));
    serieLida = " lg24k8891x "; // a IA leu em minúsculas e com espaço: é a mesma etiqueta
    await fotografarELer();
    // sem esperar o servidor (que aqui nem conhece a série): o aviso vem da leva, conferida no aparelho
    const aviso = $("[data-aviso-serie-leva]")!;
    expect(aviso).toBeTruthy();
    expect(aviso.textContent).toContain("Este nº de série já foi cadastrado nesta leva. Confira se não fotografou a mesma etiqueta duas vezes.");
    expect(aviso.textContent).toContain("LG S4-W12JA3AA");
    expect(aviso.textContent).toContain("(cadastrado agora, nesta leva)");
    expect(aviso.querySelector("a")!.getAttribute("href")).toBe("/equipamentos/eq1");
    expect(aviso.textContent).toContain("Apenas um aviso: é possível salvar assim mesmo.");
  });

  it("é só aviso: na revisão ele aparece de novo e o Salvar continua liberado (grava o segundo)", async () => {
    await montar();
    await fotografarELer(); await ateRevisao(); await salvar();
    await clicar(botao(/Cadastrar outro/));
    await fotografarELer(); await ateRevisao();
    expect($("[data-revisao] [data-aviso-serie-leva]")).toBeTruthy();
    expect(botao(/Salvar e gerar QR Code/).disabled).toBe(false);
    await salvar();
    expect(salvos).toHaveLength(2);
    expect(salvos.map((s) => s.numeroSerie)).toEqual(["LG24K8891X", "LG24K8891X"]);
  });

  it("quando o servidor também acha o equipamento, ele aparece UMA vez (com o local) — sem aviso em dobro", async () => {
    await montar();
    await fotografarELer(); await ateRevisao(); await salvar();
    duplicadosServidor = [
      { id: "eq1", descricao: "Split Hi-Wall — 12.000 BTU/h", fabricanteModelo: "LG S4-W12JA3AA", local: "Hospital › Matriz", ativo: true },
      { id: "eqAntigo", descricao: "Split Hi-Wall", fabricanteModelo: "LG S4", local: "Hospital › Anexo", ativo: false },
    ];
    await clicar(botao(/Cadastrar outro/));
    await fotografarELer(); await esperar(480);
    const linhas = [...document.body.querySelectorAll("[data-aviso-serie] li")].map((l) => l.textContent);
    expect(linhas).toEqual([
      "Split Hi-Wall — 12.000 BTU/h · LG S4-W12JA3AA — Hospital › Matriz (cadastrado agora, nesta leva)",
      "Split Hi-Wall · LG S4 — Hospital › Anexo (inativo)",
    ]);
    expect(document.body.querySelectorAll("[data-aviso-serie]")).toHaveLength(1);
  });

  it("outra etiqueta na mesma leva não avisa; equipamento sem série não entra na conta", async () => {
    await montar();
    await fotografarELer(); await ateRevisao(); await salvar();
    await clicar(botao(/Cadastrar outro/));
    serieLida = "OUTRA-777";
    await fotografarELer(); await esperar(480);
    expect($("[data-aviso-serie]")).toBeNull();
  });
});
